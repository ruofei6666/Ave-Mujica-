'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { characters, createWorld } = require('../shared/combat.ts');
const { AI_DIFFICULTIES } = require('../shared/ai.ts');
const { getLadderStage, CHALLENGE_LEVEL } = require('../shared/ladder.ts');
const { readLadderProgress, mergeLadderProgress, settleLadderMatch, ladderLevel } = require('../src/game/ladder-progress.ts');

test('each of the 25 ordered character pairings starts at level 1 and advances independently', () => {
  const fresh = readLadderProgress(null);
  for (const player of characters) for (const opponent of characters) {
    assert.equal(ladderLevel(fresh, player.id, opponent.id), 1);
    const won = settleLadderMatch(fresh, { player: player.id, opponent: opponent.id, level: 1 }, { winner: 0, reason: 'ko' });
    for (const p of characters) for (const o of characters) {
      assert.equal(ladderLevel(won, p.id, o.id), p === player && o === opponent ? 2 : 1);
    }
    assert.deepEqual(readLadderProgress(JSON.parse(JSON.stringify(won))), won, 'serialized saves survive reload');
    assert.equal(ladderLevel(fresh, player.id, opponent.id), 1, 'settlement does not mutate the previous save');
  }
});

test('losses, draws, unfinished games, repeated settlement and skipped levels cannot advance a save', () => {
  const match = { player: 'gale', opponent: 'iron', level: 1 };
  const fresh = readLadderProgress(null);
  for (const result of [null, { winner: 1, reason: 'ko' }, { winner: null, reason: 'double-ko' }, { winner: null, reason: 'timeout' }]) {
    assert.deepEqual(settleLadderMatch(fresh, match, result), fresh);
  }
  const result = { winner: 0, reason: 'timeout' };
  const won = settleLadderMatch(fresh, match, result);
  assert.equal(ladderLevel(won, 'gale', 'iron'), 2);
  assert.deepEqual(settleLadderMatch(won, match, result), won);
  assert.deepEqual(settleLadderMatch(fresh, { ...match, level: 8 }, result), fresh);
});

test('malformed progress is recovered per pairing without erasing valid saves', () => {
  const fresh = readLadderProgress(null);
  for (const raw of [null, 42, [], 'bad JSON', { version: 2, cleared: { pyro: { gale: 9 } } }]) {
    assert.deepEqual(readLadderProgress(raw), fresh);
  }
  for (const invalid of [-1, 1.2, '8', Infinity, NaN, Number.MAX_SAFE_INTEGER, {}, []]) {
    const restored = readLadderProgress({ version: 1, cleared: { pyro: { gale: 8, iron: invalid }, shadow: null } });
    assert.equal(ladderLevel(restored, 'pyro', 'gale'), 9);
    assert.equal(ladderLevel(restored, 'pyro', 'iron'), 1);
    assert.equal(ladderLevel(restored, 'shadow', 'gale'), 1);
  }
});

test('merging an older tab cannot roll back or overwrite other pairing progress', () => {
  const first = readLadderProgress({ version: 1, cleared: { pyro: { gale: 3 } } });
  const second = readLadderProgress({ version: 1, cleared: { pyro: { gale: 1, iron: 8 }, gale: { pyro: 4 } } });
  const merged = mergeLadderProgress(first, second);
  assert.equal(ladderLevel(merged, 'pyro', 'gale'), 4);
  assert.equal(ladderLevel(merged, 'pyro', 'iron'), 9);
  assert.equal(ladderLevel(merged, 'gale', 'pyro'), 5);
  assert.deepEqual(mergeLadderProgress(second, first), merged);
});

test('every early level strengthens decisions while preserving character attributes', () => {
  let previous = getLadderStage(1);
  for (let level = 2; level <= CHALLENGE_LEVEL; level++) {
    const stage = getLadderStage(level);
    assert.ok(stage.ai.config.think < previous.ai.config.think);
    assert.ok(stage.ai.config.miss < previous.ai.config.miss);
    for (const key of ['skill', 'ult', 'aggro', 'precision', 'jump']) assert.ok(stage.ai.config[key] > previous.ai.config[key], key);
    assert.ok(stage.ai.rank > previous.ai.rank && stage.ai.tactics > previous.ai.tactics);
    assert.equal(stage.healthMultiplier, 1);
    assert.equal(stage.damageMultiplier, 1);
    previous = stage;
  }
  assert.deepEqual({ ...previous.ai.config, label: '挑战' }, AI_DIFFICULTIES.hard);
});

test('level 20 exactly reproduces original challenge decisions for all 25 pairings', () => {
  for (const left of characters) for (const right of characters) {
    const options = { left: left.id, right: right.id, difficulty: 'hard', autoplay: true, autoplayDifficulty: 'hard', seed: 20261004, introFrames: 0, duration: 8 };
    const baseline = createWorld(options), ladder = createWorld({ ...options, ladderLevel: CHALLENGE_LEVEL });
    while (!baseline.getResult()) {
      baseline.step(); ladder.step();
      assert.deepEqual(ladder.snapshot(), baseline.snapshot(), `${left.id}/${right.id}`);
    }
  }
});

test('later levels scale only CPU health and actual damage, including projectiles and counters', () => {
  for (const level of [21, 22, 50, 100, 1000]) {
    const stage = getLadderStage(level);
    assert.ok(stage.healthMultiplier > getLadderStage(level - 1).healthMultiplier);
    assert.ok(stage.damageMultiplier > getLadderStage(level - 1).damageMultiplier);
    for (const kind of ['punch', 'skill', 'projectile', 'counter']) {
      const world = createWorld({ left: 'gale', right: 'gale', ladderLevel: level, introFrames: 0 });
      const [player, cpu] = world.fighters;
      assert.equal(player.maxHp, 600);
      assert.equal(cpu.maxHp, 600 * stage.healthMultiplier);
      player.takeHit({ dmg: 1, kb: 0, stun: 1, kind }, cpu);
      const hit = world.snapshot().events.find(event => event.kind === 'hit');
      assert.ok(Math.abs(hit.damage - stage.damageMultiplier) < 1e-8, `${kind} scales once`);
      cpu.takeHit({ dmg: 1, kb: 0, stun: 1, kind }, player);
      assert.ok(Math.abs(cpu.maxHp - cpu.hp - 1) < 1e-8, 'player damage stays unchanged');
    }
  }
  assert.equal(getLadderStage(21).healthMultiplier, 1.05);
  assert.equal(getLadderStage(21).damageMultiplier, 1.03);
  for (const level of [NaN, Infinity, -1, 0]) assert.equal(getLadderStage(level).level, 1);
});

test('PVP ignores ladder options and keeps human fighters on equal attributes', () => {
  const plain = createWorld({ mode: 'pvp', left: 'gale', right: 'gale', seed: 8, introFrames: 0 });
  const ladder = createWorld({ mode: 'pvp', left: 'gale', right: 'gale', seed: 8, introFrames: 0, ladderLevel: 1000 });
  for (let frame = 0; frame < 250; frame++) {
    const inputs = [{ right: true, skill1: true, punch: true }, { left: true, punch: true, skill2: true }];
    plain.step(inputs); ladder.step(inputs);
    assert.deepEqual(ladder.snapshot(), plain.snapshot());
  }
});
