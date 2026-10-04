'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createCollector, summarize, definitions, checkAccuracy } = require('../scripts/measure-skill-hits.cjs');

function snapshot(left, right, events = [], projectiles = []) {
  return { fighters: [{ id: left, state: 'idle', skillMove: null }, { id: right, state: 'idle', skillMove: null }], events, projectiles, hazards: [] };
}
const cast = (seq, actor, id) => ({ seq, frame: seq, kind: id.endsWith('_punch') ? 'attack' : 'skill', actor, id });
const hit = (seq, actor, id, damage = 10) => ({ seq, frame: seq, kind: 'hit', actor, target: 1 - actor, id, damage });

test('accuracy gate checks every attack, sample size and unrounded counts', () => {
  const rows = definitions.map(def => ({ ...def, casts: 10000, landedCasts: def.kind === 'support' ? 0 : 7000 }));
  const result = checkAccuracy(rows, 70, 1000);
  assert.equal(result.passed, true); assert.equal(result.checkedAttacks, 23);
  assert.deepEqual(result.excludedSupport, ['iron_s1', 'shadow_s0']);
  assert.equal(checkAccuracy(rows.slice(1), 70, 1000).passed, false, 'missing attacks cannot silently pass');
  rows[1].casts = 30; rows[1].landedCasts = 30;
  assert.equal(checkAccuracy(rows, 70, 1000).passed, false, 'rare perfect casts are not sufficient evidence');
  rows[1].casts = 100000; rows[1].landedCasts = 69999; rows[1].hitRate = 70;
  assert.equal(checkAccuracy(rows, 70, 1000).passed, false, 'display rounding cannot satisfy the target');
});

test('multi-hit activations and repeated snapshot events are counted once per cast', () => {
  const collector = createCollector();
  const state = snapshot('gale', 'iron', [cast(1, 0, 'gale_s2'), hit(2, 0, 'gale_s2'), hit(3, 0, 'gale_s2'), hit(4, 0, 'gale_s2')]);
  collector.consume(state); collector.consume(state);
  state.events.push(cast(5, 0, 'gale_s2'));
  collector.consume(state);
  assert.deepEqual(collector.totals(state)['gale_s2/iron'], {
    casts: 2, landedCasts: 1, fullHitCasts: 1, hitEvents: 3, damage: 30, stolenMana: 0, unfinishedAtEnd: 0,
  });
});

test('zero-damage control counts as a hit; support and unused attacks are distinct', () => {
  const collector = createCollector();
  const state = snapshot('shadow', 'iron', [cast(1, 0, 'shadow_s2'), { ...hit(2, 0, 'shadow_s2', 0), stolen: 32 }, cast(3, 1, 'iron_s1')]);
  collector.consume(state);
  const totals = collector.totals(state);
  const control = summarize(definitions.find(def => def.id === 'shadow_s2'), totals['shadow_s2/iron']);
  assert.equal(control.hitRate, 100); assert.equal(control.damage, 0); assert.equal(control.stolenMana, 32);
  const support = summarize(definitions.find(def => def.id === 'iron_s1'), totals['iron_s1/shadow']);
  assert.equal(support.status, 'support'); assert.equal(support.hitRate, null);
  const unused = summarize(definitions.find(def => def.id === 'gale_s0'), { casts: 0 });
  assert.equal(unused.status, 'unobserved'); assert.equal(unused.hitRate, null);
});

test('delayed projectiles remain attributed to their own skill after another action', () => {
  const collector = createCollector();
  const state = snapshot('pyro', 'gale', [cast(1, 0, 'pyro_s0'), cast(2, 0, 'pyro_s1'), hit(3, 0, 'pyro_s0')]);
  collector.consume(state);
  const totals = collector.totals(state);
  assert.equal(totals['pyro_s0/gale'].landedCasts, 1);
  assert.equal(totals['pyro_s1/gale'].landedCasts, 0);
});

test('ambiguous overlapping activations and missing cast events fail visibly', () => {
  const collector = createCollector();
  collector.consume(snapshot('pyro', 'gale', [cast(1, 0, 'pyro_s0')]));
  assert.throws(() => collector.consume(snapshot('pyro', 'gale', [cast(2, 0, 'pyro_s0')], [{ owner: 0, sfx: 'pyro_s0' }])), /Overlapping casts/);
  assert.throws(() => createCollector().consume(snapshot('pyro', 'gale', [hit(1, 0, 'pyro_s0')])), /no matching cast/);
});

test('an unresolved final projectile does not mark older misses as unfinished', () => {
  const collector = createCollector();
  const state = snapshot('pyro', 'gale', [cast(1, 0, 'pyro_s0'), cast(2, 0, 'pyro_s0')]);
  collector.consume(state);
  state.projectiles = [{ owner: 0, sfx: 'pyro_s0' }];
  assert.equal(collector.totals(state)['pyro_s0/gale'].unfinishedAtEnd, 1);
});

test('actual combat measurements are identical across worker counts and cover all pairings', () => {
  const root = path.resolve(__dirname, '..'), dir = mkdtempSync(path.join(tmpdir(), 'mujica-hit-rates-'));
  try {
    const reports = [1, 3].map(workers => {
      const file = path.join(dir, `workers-${workers}.json`);
      const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/measure-skill-hits.cjs', '2', '0', file, String(workers)],
        { cwd: root, encoding: 'utf8', timeout: 60000 });
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(readFileSync(file, 'utf8'));
      delete report.elapsedMs; delete report.reproduce;
      return report;
    });
    assert.deepEqual(reports[0], reports[1]);
    assert.equal(reports[0].seed, 0); assert.equal(reports[0].matches, 50);
    assert.equal(reports[0].rows.length, 25);
    for (const row of reports[0].rows) {
      assert.equal(row.opponents.length, 5);
      assert.equal(row.casts, row.opponents.reduce((sum, opponent) => sum + opponent.casts, 0));
      assert.ok(row.landedCasts <= row.casts);
      assert.ok(row.fullHitCasts <= row.landedCasts);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('mujica-hit-rates-'));
    rmSync(dir, { recursive: true, force: true });
  }
});
