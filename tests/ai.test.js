'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { thinkAi, createAiMemory, AI_DIFFICULTIES } = require('../shared/ai.ts');
const { createWorld, characters } = require('../shared/combat.ts');
const { ARENA } = require('../shared/arena.ts');

const attacks = ['punch', 'special', 'skill1', 'skill2', 'ult'];
function situation(id = 'bastion', opponent = 'pyro') {
  const world = createWorld({ left: id, right: opponent, mode: 'pvp', introFrames: 0, seed: 131 });
  const [me, opp] = world.snapshot().fighters;
  Object.assign(me, { x: 500, mp: 0, cd0: 600, cd1: 600, cd2: 600 });
  Object.assign(opp, { x: 900, mp: 0 });
  return { me, opp, def: characters.find(character => character.id === id) };
}
function decide(state, scene = {}, memory = createAiMemory()) {
  return thinkAi(state.me, state.opp, state.def, memory,
    { difficulty: 'hard', random: () => .5, projectiles: [], hazards: [], ...scene });
}
function wave(overrides = {}) {
  return { type: 'wave', owner: 1, x: 700, y: ARENA.ground - 24,
    vx: -8.8, vy: 0, life: 44, color: '#fff', dmg: 20, kb: 8, stun: 16,
    r: 32, sfx: 'pyro_s2', ...overrides };
}
function noAttack(input) { assert.ok(attacks.every(action => !input[action]), JSON.stringify(input)); }

test('hard difficulty inherits the complete former challenge configuration', () => {
  assert.deepEqual(AI_DIFFICULTIES.normal, { label: '困难', miss: .008, skill: .99, ult: .99,
    aggro: .995, jump: .12, think: 4, precision: .98 });
});

test('challenge counters a visible jab quickly and chooses a multi-hit combo during stun', () => {
  const scenario = situation('gale');
  Object.assign(scenario.me, { cd1: 0, cd2: 0 });
  Object.assign(scenario.opp, { x: 600, state: 'punch', stateT: 1 });
  assert.equal(decide(scenario).skill1, true, 'one-frame dash can interrupt a jab');
  Object.assign(scenario.opp, { state: 'stun', stunMax: 24, stateT: 1 });
  assert.equal(decide(scenario).skill2, true, 'longer combo exploits confirmed hitstun');
});

test('challenge can punish a missed charge during recovery even if attackHit is false', () => {
  const scenario = situation('bastion', 'bastion');
  scenario.me.cd0 = 0;
  Object.assign(scenario.opp, { x: 680, state: 'skill', skillMove: 'bastion_s1',
    stateT: 45, armor: 3, attackHit: false });
  assert.equal(decide(scenario).special, true);
});

test('challenge drain interrupts an armored charge before it releases', () => {
  const world = createWorld({ left: 'shadow', right: 'bastion', mode: 'pvp', introFrames: 0 });
  const [me, opp] = world.fighters;
  Object.assign(me, { x: 500, mp: 0, cd0: 600, cd1: 600, cd2: 0 });
  Object.assign(opp, { x: 620, mp: 150, state: 'skill', skillMove: 'bastion_s1', stateT: 12, armor: 36 });
  const input = decide({ me, opp, def: characters.find(c => c.id === me.id) });
  assert.equal(input.skill2, true);
  world.step([input, {}]);
  for (let n = 0; n < 14 && opp.state !== 'stun'; n++) world.step([{}, {}]);
  assert.equal(opp.skillMove, null);
  assert.equal(opp.state, 'stun');
  assert.equal(opp.mp, 110);
  assert.equal(me.hp, me.maxHp);
});

test('challenge counter lands against a close jab where the old slow opener is interrupted', () => {
  const damage = {};
  for (const difficulty of ['normal', 'hard']) {
    const world = createWorld({ left: 'bastion', right: 'pyro', mode: 'pvp', introFrames: 0 });
    const [me, opp] = world.fighters;
    Object.assign(me, { x: 500, mp: 0 }); Object.assign(opp, { x: 590, mp: 0 });
    const input = decide({ me, opp, def: characters.find(c => c.id === me.id) }, { difficulty });
    world.step([input, { punch: true }]);
    for (let n = 0; n < 40; n++) world.step([{}, {}]);
    damage[difficulty] = opp.maxHp - opp.hp;
  }
  assert.equal(damage.normal, 0);
  assert.ok(damage.hard > 18, JSON.stringify(damage));
});

test('challenge keeps ranged cooldowns when a retreating target will leave projectile range', () => {
  const scenario = situation('pyro');
  Object.assign(scenario.me, { cd1: 0, cd2: 0 });
  Object.assign(scenario.opp, { x: 1080, state: 'walk', vx: 5.15 });
  noAttack(decide(scenario));
  assert.equal(decide(scenario).right, true);
});

test('challenge forecasts approach using actual skill travel, not stale stored velocity', () => {
  const scenario = situation('bastion', 'gale');
  scenario.me.cd0 = 0;
  Object.assign(scenario.opp, { x: 730, state: 'skill', skillMove: 'gale_s1',
    stateT: 10, facing: 1, vx: 0, attackHit: true });
  assert.equal(decide(scenario).special, false, 'dash is visibly travelling out of reach');
});

test('AI decisions do not mutate either fighter, including facing during a skill', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const state of ['idle', 'skill']) {
      const scenario = situation('gale');
      Object.assign(scenario.me, { state, skillMove: state === 'skill' ? 'gale_s1' : null, facing: -1 });
      const before = structuredClone({ me: scenario.me, opp: scenario.opp });
      Object.freeze(scenario.me); Object.freeze(scenario.opp);
      const input = decide(scenario, { difficulty });
      assert.deepEqual({ me: scenario.me, opp: scenario.opp }, before);
      if (state === 'skill') noAttack(input);
    }
  }
});

test('new attacks and projectile defenses both respect a pending reaction delay', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const scenario = situation('iron');
    Object.assign(scenario.me, { cd0: 0, cd1: 0, cd2: 0, mp: 200 });
    scenario.opp.x = 590;
    const memory = { ...createAiMemory(), wait: 3, left: false, right: true };
    const input = decide(scenario, { difficulty, projectiles: [wave({ x: 600 })] }, memory);
    noAttack(input);
    assert.equal(input.up, false, `${difficulty}: no instant defense between decisions`);
    assert.equal(input.right, true, 'movement can continue between decisions');
  }
});

test('difficulty produces ordered reaction delays without changing fighter attributes', () => {
  const waits = [];
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const scenario = situation();
    const memory = createAiMemory();
    const before = structuredClone(scenario);
    decide(scenario, { difficulty }, memory);
    waits.push(memory.wait);
    assert.deepEqual(scenario, before);
  }
  assert.ok(waits[0] > waits[1] && waits[1] > waits[2], JSON.stringify(waits));
});

test('high, receding, expired and friendly projectiles do not trigger evasive jumping', () => {
  const scenario = situation();
  const irrelevant = [
    wave({ type: 'note', x: 600, y: 150, r: 16 }),
    wave({ x: 300, vx: -8.8 }),
    wave({ life: 0 }),
    wave({ owner: 0 }),
    wave({ owner: { seat: 0 } }),
  ];
  for (const projectile of irrelevant) {
    const input = decide(scenario, { projectiles: [projectile] });
    assert.equal(input.up, false, JSON.stringify(projectile));
    assert.equal(input.right, true, 'continue approaching the opponent');
  }
});

test('an approaching ground wave is detected early enough to start a jump', () => {
  for (const owner of [1, { seat: 1 }]) {
    const input = decide(situation(), { projectiles: [wave({ owner })] });
    assert.equal(input.up, true);
    assert.equal(input.left, true);
  }
});

test('wave danger uses its full ground rectangle rather than its decorative radius', () => {
  const scenario = situation('iron');
  Object.assign(scenario.me, { y: ARENA.ground - 82, vy: 0, state: 'jump', cd1: 0 });
  const input = decide(scenario, { projectiles: [wave({ x: 560 })] });
  assert.equal(input.skill1, true, 'wave intersects feet although its radius does not');
});

test('a harmless first projectile cannot hide a later colliding curtain', () => {
  const scenario = situation();
  const harmless = wave({ type: 'note', x: 620, y: 100, r: 16 });
  const dangerous = wave({ type: 'curtain', x: 740, y: ARENA.ground - 52, vx: -13.5, life: 170, r: 34 });
  const first = decide(scenario, { projectiles: [harmless, dangerous] });
  const reversed = decide(scenario, { projectiles: [dangerous, harmless] });
  assert.equal(first.up, true);
  assert.deepEqual(first, reversed);
});

test('evading at either wall turns back into the arena instead of walking into the wall', () => {
  for (const leftWall of [true, false]) {
    const scenario = situation();
    scenario.me.x = leftWall ? ARENA.leftWall : ARENA.rightWall;
    scenario.opp.x = scenario.me.x + (leftWall ? 400 : -400);
    const projectile = wave({ x: scenario.me.x + (leftWall ? 200 : -200), vx: leftWall ? -8.8 : 8.8 });
    const input = decide(scenario, { projectiles: [projectile] });
    assert.equal(input.up, true);
    assert.equal(input.left, !leftWall);
    assert.equal(input.right, leftWall);
  }
});

test('previous movement into a wall is cleared even while waiting to react', () => {
  const scenario = situation(); scenario.me.x = ARENA.leftWall;
  const input = decide(scenario, {}, { ...createAiMemory(), wait: 10, left: true, right: false });
  assert.equal(input.left, false);
});

test('iron does not refresh long remaining armor merely because a projectile is close', () => {
  const scenario = situation('iron');
  Object.assign(scenario.me, { armor: 90, cd1: 0 });
  const input = decide(scenario, { projectiles: [wave({ x: 570 })] });
  assert.equal(input.skill1, false);
});

test('shadow does not sacrifice health when mana and both attacks are already ready', () => {
  const scenario = situation('shadow');
  Object.assign(scenario.me, { mp: 200, cd0: 0, cd1: 0, cd2: 0 });
  scenario.opp.invuln = 100;
  assert.equal(decide(scenario).special, false);
});

test('shadow can use its tracking slash beyond the obsolete local range limit', () => {
  const scenario = situation('shadow');
  scenario.me.cd1 = 0; scenario.opp.x = 1700;
  assert.equal(decide(scenario).skill1, true);
});

test('tracking shadow and gale ultimates remain usable across the arena', () => {
  for (const id of ['shadow', 'gale']) {
    const scenario = situation(id);
    scenario.me.mp = 200; scenario.opp.x = 1800;
    assert.equal(decide(scenario).ult, true, id);
  }
});

test('short-range grab and drain are not spent on a rising opponent outside vertical reach', () => {
  for (const id of ['iron', 'shadow']) {
    const scenario = situation(id);
    scenario.me[id === 'iron' ? 'cd0' : 'cd2'] = 0;
    Object.assign(scenario.opp, { x: 590, y: ARENA.ground - 180, vy: -7, state: 'jump', mp: 100 });
    const input = decide(scenario);
    assert.equal(input[id === 'iron' ? 'special' : 'skill2'], false, id);
  }
});

test('iron does not grab a retreating opponent that will outrun the grab startup', () => {
  const scenario = situation('iron'); scenario.me.cd0 = 0;
  Object.assign(scenario.opp, { x: 650, vx: 5.15, state: 'walk' });
  assert.equal(decide(scenario).special, false);
});

test('bastion does not root itself in a long charge against a retreating opponent', () => {
  const scenario = situation('bastion'); scenario.me.cd1 = 0;
  Object.assign(scenario.opp, { x: 680, vx: 5.15, state: 'walk' });
  assert.equal(decide(scenario).skill1, false);
});

test('bastion closes to punch range while all skills are cooling down', () => {
  const scenario = situation('bastion'); scenario.opp.x = 655;
  assert.equal(decide(scenario).right, true);
});

test('an airborne armor animation is not mistaken for a falling grab target', () => {
  const scenario = situation('iron', 'iron'); scenario.me.cd0 = 0;
  Object.assign(scenario.opp, { x: 590, y: ARENA.ground - 102, vy: 0,
    state: 'skill', skillMove: 'iron_s1', stateT: 1, armor: 119 });
  // iron_s1 keeps its caster's y unchanged for the remaining 25 frames.
  // The grab starts at frame 5 and requires an actual foot-height gap below 100.
  assert.equal(decide(scenario).special, false);
});

test('a ground wave is not spent on a target suspended above it during a long charge', () => {
  const scenario = situation('pyro', 'bastion'); scenario.me.cd2 = 0;
  Object.assign(scenario.opp, { x: 650, y: ARENA.ground - 202, vy: 0,
    state: 'skill', skillMove: 'bastion_s1', stateT: 1, armor: 47 });
  // The wave passes in well under 47 frames; this charging target does not fall.
  assert.equal(decide(scenario).skill2, false);
});

test('gale does not consume its one-hit dash on invulnerability before it expires', () => {
  const scenario = situation('gale'); scenario.me.cd1 = 0;
  Object.assign(scenario.opp, { x: 650, invuln: 8 });
  // At this gap the dash makes contact on its first active frame. A blocked
  // contact consumes attackHit, so staying in the dash until frame 8 cannot help.
  assert.equal(decide(scenario).skill1, false);
});

test('a close punch is held when its first active frame would hit invulnerability', () => {
  const scenario = situation();
  Object.assign(scenario.opp, { x: 590, invuln: 8 });
  assert.equal(decide(scenario).punch, false);
});

test('pyro completes a wave dodge instead of freezing its jump with a ready skill', () => {
  const world = createWorld({ left: 'pyro', right: 'pyro', mode: 'pvp', introFrames: 0, seed: 47 });
  Object.assign(world.fighters[0], { x: 500, mp: 0 });
  Object.assign(world.fighters[1], { x: 1000, mp: 0 });
  const memory = createAiMemory();
  const def = characters.find(character => character.id === 'pyro');
  const projectile = wave({ x: 725 });
  const frameInput = () => {
    const [me, opp] = world.snapshot().fighters;
    return thinkAi(me, opp, def, memory, {
      difficulty: 'hard', random: () => .5, projectiles: [projectile], hazards: [],
    });
  };
  const initial = frameInput();
  assert.equal(initial.up, true);
  world.step([initial, {}]);
  projectile.x += projectile.vx;
  for (let frame = 1; frame <= 5; frame++) {
    const input = frameInput();
    noAttack(input);
    world.step([input, {}]);
    projectile.x += projectile.vx;
  }
  const fighter = world.fighters[0];
  assert.ok(fighter.y < ARENA.ground && fighter.y > ARENA.ground - 92, 'still below safe wave-clearing height');
  assert.equal(fighter.state, 'jump', 'available skills must not interrupt the low part of the dodge');
  assert.ok(memory.evade > 0);
  assert.equal(fighter.cd0 + fighter.cd1 + fighter.cd2, 0, 'all attacks remained ready while dodging');
});
