'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

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
  for (const args of [['0'], ['1.5'], ['1', 'impossible'], ['1', 'hard', '-1'], ['1', 'hard', '0', '--workers', '0']]) {
    assert.notEqual(cli(args).status, 0, args.join(' '));
  }
});
