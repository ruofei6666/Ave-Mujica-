'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, characters, constants } = require('../shared/combat.ts');
const { thinkAi, createAiMemory } = require('../shared/ai.ts');

function arena(id, seat = 0, distance = 170) {
  const world = createWorld({ left: seat === 0 ? id : 'pyro', right: seat === 1 ? id : 'pyro', mode: 'pvp', introFrames: 0, seed: 31415 });
  const me = world.fighters[seat], opp = world.fighters[1 - seat];
  Object.assign(me, { x: seat === 0 ? 800 : 1200, mp: 0 });
  Object.assign(opp, { x: me.x + (seat === 0 ? distance : -distance), mp: 150 });
  const events = new Map();
  function step(input = {}, other = {}) {
    const inputs = []; inputs[seat] = input; inputs[1 - seat] = other;
    world.step(inputs);
    for (const event of world.snapshot().events) events.set(event.seq, event);
  }
  const advance = (n, other = {}) => { for (let i = 0; i < n; i++) step({}, other); };
  const hits = id => [...events.values()].filter(e => e.kind === 'hit' && e.actor === seat && e.id === id);
  return { world, me, opp, step, advance, hits };
}
function decide(me, opp) {
  return thinkAi(me, opp, characters.find(c => c.id === me.id), createAiMemory(),
    { difficulty: 'hard', random: () => .5, projectiles: [], hazards: [] });
}

test('gale proactively dives at a grounded target and the forecast lands from either seat', () => {
  for (const seat of [0, 1]) {
    const a = arena('gale', seat, 250);
    const input = decide(a.me, a.opp);
    assert.equal(input.special, true, 'dive is competitive even when all normal skills are ready');
    a.step(input); a.advance(45);
    assert.equal(a.hits('gale_s0').length, 1);
    assert.ok(a.opp.hp < a.opp.maxHp);
    assert.equal(a.me.y, constants.GROUND);
  }
});

test('gale keeps the dive when a retreating target will escape its arc', () => {
  const a = arena('gale', 0, 350);
  Object.assign(a.opp, { state: 'walk', vx: 5.15 });
  assert.equal(decide(a.me, a.opp).special, false);
});

test('grab and drain do not get a utility bonus for losing to an already-started jab', () => {
  for (const id of ['iron', 'shadow']) {
    const a = arena(id, 0, 100);
    Object.assign(a.me, { cd0: id === 'iron' ? 0 : 600, cd1: 600, cd2: id === 'shadow' ? 0 : 600 });
    Object.assign(a.opp, { state: 'punch', stateT: 2, facing: -1, mp: 180 });
    const input = decide(a.me, a.opp);
    assert.equal(input.special, false); assert.equal(input.skill2, false);
  }
});

test('stepping grab catches a target later in its window only once, on either seat', () => {
  for (const seat of [0, 1]) {
    const a = arena('iron', seat, 155);
    a.opp.invuln = 12;
    a.step({ special: true }); a.advance(40);
    assert.equal(a.hits('iron_s0').length, 1);
    assert.ok(a.me.mp >= 67 && a.me.mp < 72, 'one hit gain and one grab refund');
    assert.ok(Math.abs(a.opp.maxHp - a.opp.hp - 17.8 * 2.1) < 1e-8);
  }
});

test('grab and binding keep invulnerability, vertical and distance escape routes', () => {
  for (const id of ['iron', 'shadow']) for (const scenario of ['invulnerable', 'far', 'above']) {
    const a = arena(id, 0, scenario === 'far' ? 450 : 150);
    if (scenario === 'invulnerable') a.opp.invuln = 100;
    if (scenario === 'above') Object.assign(a.opp, { y: constants.GROUND - 240, state: 'skill', skillMove: 'pyro_s0', stateT: 0 });
    a.step(id === 'iron' ? { special: true } : { skill2: true }); a.advance(24);
    assert.equal(a.hits(id === 'iron' ? 'iron_s0' : 'shadow_s2').length, 0, `${id}: ${scenario}`);
    assert.equal(a.opp.hp, a.opp.maxHp);
  }
});

test('binding catches a late vulnerable target, pulls within reach and drains only once', () => {
  for (const seat of [0, 1]) {
    const a = arena('shadow', seat, 190);
    a.opp.invuln = 12;
    a.step({ skill2: true }); a.advance(24);
    const hits = a.hits('shadow_s2');
    assert.equal(hits.length, 1); assert.equal(hits[0].damage, 0); assert.equal(hits[0].stolen, 40);
    assert.equal(a.opp.hp, a.opp.maxHp);
    assert.equal(Math.abs(a.opp.x - a.me.x), 110);
    assert.equal(a.opp.state, 'stun');
  }
});

test('three-part ultimate stays connected after its first hit without exceeding its damage budget', () => {
  for (const seat of [0, 1]) for (const atWall of [false, true]) {
    const a = arena('iron', seat, 175);
    if (atWall) {
      a.opp.x = seat === 0 ? constants.RIGHT_WALL : constants.LEFT_WALL;
      a.me.x = a.opp.x + (seat === 0 ? -175 : 175);
    }
    const startX = a.me.x; a.me.mp = 200;
    a.step({ ult: true }); a.advance(80);
    assert.equal(a.hits('iron_ult').length, 3);
    assert.equal(a.opp.maxHp - a.opp.hp, 94);
    assert.ok(Math.abs(a.me.x - startX) <= 100, 'pursuit is bounded rather than teleporting');
  }
});

test('the ultimate can still be escaped by retreating before its first hit', () => {
  const a = arena('iron', 0, 280);
  a.me.mp = 200;
  a.step({ ult: true }, { right: true }); a.advance(65, { right: true });
  assert.equal(a.hits('iron_ult').length, 0);
  assert.equal(a.me.mp < 20, true, 'a whiff still spends the meter');
});

test('short dive armor reduces early damage but expires before recovery', () => {
  const a = arena('gale', 0, 800);
  a.step({ special: true });
  const hit = { dmg: 10, kb: 0, stun: 15, kind: 'skill' };
  a.me.takeHit(hit, a.opp);
  assert.equal(a.me.state, 'skill');
  assert.ok(Math.abs(a.me.maxHp - a.me.hp - 7.2) < 1e-8, 'armor is not invulnerability');
  a.advance(11);
  assert.equal(a.me.armor, 0);
  assert.equal(a.me.state, 'skill');
  const hp = a.me.hp;
  a.me.takeHit(hit, a.opp);
  assert.equal(a.me.hp, hp - 10);
  assert.equal(a.me.state, 'stun', 'the unprotected part of the dive can be interrupted');
});

test('aimed note hits ground and elevated targets from either seat', () => {
  for (const seat of [0, 1]) for (const height of [0, 150]) {
    const a = arena('pyro', seat, 400);
    if (height) Object.assign(a.opp, { y: constants.GROUND - height, state: 'skill', skillMove: 'bastion_s1' });
    a.step({ skill1: true }); a.advance(35);
    assert.equal(a.hits('pyro_s1').length, 1, `seat ${seat}, height ${height}`);
    assert.ok(Math.abs(a.opp.maxHp - a.opp.hp - 20.8 * 2.1) < 1e-8);
  }
});

test('aimed note keeps its launch trajectory after the opponent moves', () => {
  const a = arena('pyro', 0, 500);
  Object.assign(a.opp, { y: constants.GROUND - 150, state: 'skill', skillMove: 'bastion_s1' });
  a.step({ skill1: true }); a.advance(7);
  const before = a.world.snapshot().projectiles.find(p => p.sfx === 'pyro_s1');
  assert.ok(before && before.vy < 0, 'launch aims upward at the visible target');
  a.opp.y = constants.GROUND;
  a.advance(3);
  const after = a.world.snapshot().projectiles.find(p => p.sfx === 'pyro_s1');
  assert.equal(after.vx, before.vx); assert.equal(after.vy, before.vy);
  assert.ok(Math.abs(after.y - (before.y + before.vy * 3)) < 1e-8);
});

test('faster ground wave hits once but a jump timed to its release clears it', () => {
  for (const seat of [0, 1]) for (const jump of [false, true]) {
    const a = arena('pyro', seat, 250);
    a.step({ skill2: true }); a.advance(8);
    a.step({}, { up: jump }); a.advance(56);
    assert.equal(a.hits('pyro_s2').length, jump ? 0 : 1);
    assert.ok(Math.abs(a.opp.maxHp - a.opp.hp - (jump ? 0 : 23.8 * 2.1)) < 1e-8);
    assert.equal(a.world.snapshot().projectiles.length, 0);
  }
});

test('meteor covers its blast edge once while preserving escape and invulnerability', () => {
  for (const seat of [0, 1]) for (const scenario of ['direct', 'edge', 'escape', 'invulnerable']) {
    const a = arena('pyro', seat, 350);
    a.me.mp = 200;
    a.step({ ult: true });
    a.opp.x += (seat === 0 ? 1 : -1) * (scenario === 'edge' ? 140 : scenario === 'escape' ? 240 : 0);
    if (scenario === 'invulnerable') a.opp.invuln = 200;
    a.advance(100);
    const hits = scenario === 'direct' || scenario === 'edge' ? 1 : 0;
    assert.equal(a.hits('pyro_ult').length, hits, `seat ${seat}, ${scenario}`);
    assert.equal(a.opp.maxHp - a.opp.hp, hits * 60);
    assert.equal(a.world.snapshot().hazards.length, 0);
  }
});
