'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BattleCamera, FIGHTER_HEIGHT } = require('../src/game/camera.ts');
const { ARENA } = require('../shared/arena.ts');
const { createWorld } = require('../shared/combat.ts');
const fighter = (x, y = ARENA.ground) => ({ x, y });
const settle = (camera, fighters, seat = 0) => {
  for (let i = 0; i < 180; i++) camera.update(fighters, seat, 1000 / 60);
  return camera.view;
};

test('fighters keep one-third viewport height at any aspect or opponent distance', () => {
  const camera = new BattleCamera();
  for (const [width, height] of [[844, 390], [390, 844], [1440, 900], [320, 568], [3440, 1440]]) {
    camera.resize(width, height);
    for (const other of [980, 1360, ARENA.rightWall]) {
      const view = settle(camera, [fighter(880), fighter(other)]);
      assert.ok(Math.abs(FIGHTER_HEIGHT / view.height - 1 / 3) < 1e-12);
      assert.ok(880 >= view.left && 880 <= view.left + view.width);
    }
  }
});

test('close fighters share the landscape frame and panning is smooth', () => {
  const camera = new BattleCamera(); camera.resize(844, 390);
  const before = camera.update([fighter(880), fighter(1360)], 0, 16);
  for (const x of [880, 1360]) assert.ok(x - before.left > 90 && x - before.left < before.width - 90);
  const after = camera.update([fighter(1040), fighter(1520)], 0, 16);
  assert.ok(after.left > before.left && after.left < before.left + 160);
  const settled = settle(camera, [fighter(1040), fighter(1520)]);
  assert.ok(Math.abs(settled.left - before.left - 160) < 0.001);
});

test('both seats stay visible through long-distance teleports and orientation changes', () => {
  const camera = new BattleCamera(); camera.resize(844, 390);
  for (const seat of [0, 1]) for (const ownX of [70, 1900, 400, 2170]) {
    const fighters = [fighter(ARENA.width - ownX), fighter(ARENA.width - ownX)];
    fighters[seat] = fighter(ownX);
    for (const [width, height] of [[844, 390], [390, 844]]) {
      camera.resize(width, height);
      const view = camera.update(fighters, seat, 16);
      const margin = Math.min(70, view.width * 0.25) - 1e-8;
      assert.ok(ownX - view.left >= margin && ownX - view.left <= view.width - margin, JSON.stringify({ownX, seat, view}));
      assert.ok(view.left >= 0 && view.left + view.width <= ARENA.width);
    }
  }
});

test('camera stops at both outer walls and resets immediately for a new round', () => {
  const camera = new BattleCamera(); camera.resize(844, 390);
  assert.equal(settle(camera, [fighter(70), fighter(148)]).left, 0);
  const right = settle(camera, [fighter(2170), fighter(2092)]);
  assert.ok(Math.abs(right.left + right.width - ARENA.width) < 0.001);
  camera.reset();
  const view = camera.update([fighter(880), fighter(1360)], 0, 0);
  const fresh = new BattleCamera(); fresh.resize(844, 390);
  assert.deepEqual(view, fresh.update([fighter(880), fighter(1360)], 0, 0));
});

test('jumping keeps the head visible without changing scale and settles on landing', () => {
  const camera = new BattleCamera(); camera.resize(844, 390);
  const ground = camera.update([fighter(880), fighter(1360)], 0, 16);
  const air = camera.update([fighter(880, 300), fighter(1360)], 0, 16);
  assert.ok(300 - FIGHTER_HEIGHT - air.top >= 24);
  assert.equal(air.height, ground.height);
  assert.ok(Math.abs(settle(camera, [fighter(880), fighter(1360)]).top - ground.top) < 0.001);
});

test('combat uses the extended arena and clamps movement at the new walls', () => {
  const world = createWorld({ mode: 'pvp', introFrames: 0 });
  for (let frame = 0; frame < 600; frame++) world.step([{ left: true }, { right: true }]);
  assert.equal(world.fighters[0].x, ARENA.leftWall);
  assert.equal(world.fighters[1].x, ARENA.rightWall);
  assert.ok(world.fighters[1].x > 2000);
});

test('projectiles continue past the old right edge', () => {
  const world = createWorld({ mode: 'pvp', left: 'pyro', introFrames: 0 });
  world.fighters[0].x = 1240; world.fighters[1].x = 2100;
  world.step([{ skill1: true }, {}]);
  for (let frame = 0; frame < 14; frame++) world.step([{}, {}]);
  assert.ok(world.snapshot().projectiles.some(p => p.x > 1280 && p.x < 2100));
});
