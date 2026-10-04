'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
function cli(args) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'simulate-balance.ts', ...args],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
}

test('balance simulation is identical across worker counts and preserves seed zero', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mujica-balance-'));
  try {
    const reports = [1, 3].map(workers => {
      const file = path.join(dir, `workers-${workers}.json`);
      const run = cli(['2', 'hard', '0', '--workers', String(workers), '--json', file]);
      assert.equal(run.status, 0, run.stderr);
      const report = JSON.parse(readFileSync(file, 'utf8'));
      delete report.result.elapsedMs;
      return report;
    });
    assert.deepEqual(reports[0].result, reports[1].result);
    const { result, aiLabel, currentDifficulty } = reports[0];
    assert.equal(result.seed, 0);
    assert.equal(aiLabel, '挑战 AI');
    assert.equal(currentDifficulty, 'hard');
    assert.equal(result.matches, 40);
    assert.equal(result.matrix.length, 10);
    assert.equal(new Set(result.matrix.map(row => [row.a, row.b].sort().join('/'))).size, 10);
    for (const stat of result.stats) {
      const rows = result.matrix.filter(row => row.a === stat.id || row.b === stat.id);
      const wins = rows.reduce((sum, row) => sum + (row.a === stat.id ? row.aWins : row.bWins), 0);
      const losses = rows.reduce((sum, row) => sum + (row.a === stat.id ? row.bWins : row.aWins), 0);
      const draws = rows.reduce((sum, row) => sum + row.draws, 0);
      assert.equal(rows.length, 4);
      assert.equal(stat.matches, 16);
      assert.deepEqual([stat.wins, stat.losses, stat.draws], [wins, losses, draws]);
      assert.equal(wins + losses + draws, stat.matches);
      assert.equal(stat.rate, (wins + draws / 2) / stat.matches * 100);
    }
    const rates = result.stats.map(stat => stat.rate);
    assert.equal(result.gap, Math.max(...rates) - Math.min(...rates));
    assert.equal(result.stats.reduce((sum, stat) => sum + stat.rate, 0), 250);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('mujica-balance-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('balance CLI rejects invalid sample sizes, difficulties, seeds and worker counts', () => {
  for (const args of [['0'], ['1.5'], ['1', 'impossible'], ['1', 'hard', '-1'], ['1', 'hard', '0', '--workers', '0'],
    ['1', 'hard', '0', '--max-gap', '-1'], ['1', 'hard', '0', '--max-gap', 'NaN'], ['1', 'hard', '0', '--max-gap', '101']]) {
    assert.notEqual(cli(args).status, 0, args.join(' '));
  }
});

test('balance target fails the command without discarding an unsuccessful report', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mujica-balance-'));
  try {
    const file = path.join(dir, 'gate.json');
    const args = ['1', 'hard', '0', '--workers', '1', '--json', file, '--max-gap'];
    const failed = cli([...args, '0']);
    assert.equal(failed.status, 1, failed.stderr);
    const report = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(report.result.gap > 0);
    assert.equal(report.acceptance.passed, false);
    assert.equal(report.acceptance.actualGap, report.result.gap);
    assert.equal(report.acceptance.maximumGap, 0);
    assert.match(report.reproduce, /--max-gap 0$/);
    assert.match(failed.stdout, /Balance target FAIL/);
    const passed = cli([...args, '100']);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).acceptance.passed, true);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('mujica-balance-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('published balance evidence matches production code and the one-point release target', () => {
  const report = JSON.parse(readFileSync(path.join(root, 'tests/balance-report.json'), 'utf8'));
  const { result, acceptance } = report;
  assert.equal(acceptance.maximumGap, 1);
  assert.equal(acceptance.passed, true);
  assert.equal(acceptance.actualGap, result.gap);
  assert.ok(result.gap <= 1);
  assert.ok(result.rounds >= 10000, 'release evidence needs at least 200,000 matches');
  assert.equal(result.matches, result.rounds * 20);
  assert.equal(result.difficulty, 'hard');
  assert.equal(report.rules.swappedSeats, true);
  assert.equal(report.rules.sameSeedForBothSeats, true);
  assert.deepEqual(report.rules.cooldownFrameRange, [120, 300]);
  assert.deepEqual(Object.keys(report.sourceSha256).sort(), [
    'shared/combat.ts', 'shared/ai.ts', 'shared/ai-tactics.ts', 'shared/arena.ts',
    'shared/locomotion.ts', 'shared/ladder.ts', 'simulate-balance.ts',
  ].sort());
  for (const [file, expected] of Object.entries(report.sourceSha256)) {
    const source = readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, `stale report: ${file}`);
  }
  const { characters } = require('../shared/combat.ts');
  assert.deepEqual(result.cds, characters.flatMap(c => [c.s0.cd, c.s1.cd, c.s2.cd]));
  for (const c of characters) for (const move of [c.s0, c.s1, c.s2]) {
    assert.ok(Number.isInteger(move.cd) && move.cd >= 120 && move.cd <= 300, `${c.id}: cooldown must be 2–5 seconds`);
    assert.ok(move.detail.includes(`冷却 ${(move.cd / 60).toFixed(2)} 秒`), `${c.id}: stale cooldown description`);
  }
  assert.equal(result.matrix.length, 10);
  for (const row of result.matrix) {
    assert.equal(row.matches, result.rounds * 2);
    assert.equal(row.aWins + row.bWins + row.draws, row.matches);
    assert.equal(row.aRate, (row.aWins + row.draws / 2) / row.matches * 100);
    assert.equal(row.bRate, (row.bWins + row.draws / 2) / row.matches * 100);
  }
  for (const stat of result.stats) {
    const rows = result.matrix.filter(row => row.a === stat.id || row.b === stat.id);
    assert.equal(rows.length, 4);
    assert.equal(stat.wins, rows.reduce((sum, row) => sum + (row.a === stat.id ? row.aWins : row.bWins), 0));
    assert.equal(stat.losses, rows.reduce((sum, row) => sum + (row.a === stat.id ? row.bWins : row.aWins), 0));
    assert.equal(stat.draws, rows.reduce((sum, row) => sum + row.draws, 0));
    assert.equal(stat.matches, result.rounds * 8);
    assert.equal(stat.rate, (stat.wins + stat.draws / 2) / stat.matches * 100);
  }
  assert.equal(result.gap, Math.max(...result.stats.map(s => s.rate)) - Math.min(...result.stats.map(s => s.rate)));
});
