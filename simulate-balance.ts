import game from './shared/combat';
import type { Character, Difficulty } from './shared/types';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';

// Both seats use the actual PVE controller and production combat clock.
// pnpm balance [rounds/side] [easy|normal|hard] [seed] [--json path] [--workers n] [--max-gap percentage-points]
const pairs: { a: Character; b: Character }[] = [];
for (let a = 0; a < game.characters.length; a++) {
  for (let b = a + 1; b < game.characters.length; b++) pairs.push({ a: game.characters[a], b: game.characters[b] });
}
interface Job { pairId: number; startRound: number; count: number; seed: number; difficulty: Difficulty }
interface Counts { pairId: number; aWins: number; bWins: number; draws: number; matches: number; frames: number; timeouts: number }
const countKeys = ['aWins', 'bWins', 'draws', 'matches', 'frames', 'timeouts'] as const;

// Seeds stay identical across sample sizes, worker counts and seat arrangements.
function matchSeed(seed: number, pairId: number, round: number) {
  let x = (seed >>> 0) ^ Math.imul(pairId + 1, 0x9e3779b9) ^ Math.imul(round + 1, 0x85ebca6b);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function simulate(job: Job): Counts {
  const { a, b } = pairs[job.pairId];
  const counts: Counts = { pairId: job.pairId, aWins: 0, bWins: 0, draws: 0, matches: job.count * 2, frames: 0, timeouts: 0 };
  for (let round = job.startRound; round < job.startRound + job.count; round++) {
    const seed = matchSeed(job.seed, job.pairId, round);
    for (const seat of [0, 1]) {
      const world = game.createWorld({ left: seat ? b.id : a.id, right: seat ? a.id : b.id,
        mode: 'pve', difficulty: job.difficulty, autoplay: true, seed, introFrames: 0, duration: 90 });
      // Hit stops freeze the timer; exceeding this bound is an error, never a skipped game.
      for (let frame = 0; frame < 21600 && !world.getResult(); frame++) { world.step(); counts.frames++; }
      const result = world.getResult();
      if (!result) throw new Error(`Unfinished match: ${a.id} / ${b.id}, seed ${seed}, seat ${seat}`);
      if (result.reason === 'timeout') counts.timeouts++;
      if (result.winner === null) counts.draws++;
      else if (result.winner === seat) counts.aWins++;
      else counts.bWins++;
    }
  }
  return counts;
}

async function main() {
  const rounds = Number(process.argv[2] ?? 100);
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100000) throw new Error('Rounds must be an integer in [1, 100000]');
  const requestedDifficulty = process.argv[3] ?? 'hard';
  if (!['easy', 'normal', 'hard'].includes(requestedDifficulty)) throw new Error('Difficulty must be easy, normal or hard');
  const difficulty = requestedDifficulty as Difficulty;
  const seed = Number(process.argv[4] ?? 0x51f15e);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
  let workers = Math.min(8, availableParallelism()), output: string | undefined, maxGap: number | undefined;
  for (let i = 5; i < process.argv.length; i += 2) {
    if (!process.argv[i + 1]) throw new Error(`Missing value for ${process.argv[i]}`);
    if (process.argv[i] === '--json') output = process.argv[i + 1];
    else if (process.argv[i] === '--workers') workers = Number(process.argv[i + 1]);
    else if (process.argv[i] === '--max-gap') maxGap = Number(process.argv[i + 1]);
    else throw new Error(`Unknown option: ${process.argv[i]}`);
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw new Error('Workers must be an integer in [1, 32]');
  if (maxGap !== undefined && (!Number.isFinite(maxGap) || maxGap < 0 || maxGap > 100)) throw new Error('Maximum gap must be in [0, 100] percentage points');
  const started = performance.now();
  const matrix = pairs.map(({ a, b }, pairId) => ({ pairId, a: a.id, b: b.id, aName: a.name, bName: b.name,
    aWins: 0, bWins: 0, draws: 0, matches: 0, frames: 0, timeouts: 0, aRate: 0, bRate: 0 }));
  const jobs: Job[] = [];
  const chunk = Math.min(100, Math.max(1, Math.ceil(rounds / 4)));
  for (let pairId = 0; pairId < pairs.length; pairId++) {
    for (let startRound = 0; startRound < rounds; startRound += chunk) {
      jobs.push({ pairId, startRound, count: Math.min(chunk, rounds - startRound), seed, difficulty });
    }
  }
  const accept = (counts: Counts) => {
    const row = matrix[counts.pairId];
    for (const key of countKeys) row[key] += counts[key];
    if (row.matches === rounds * 2) console.error(`Completed ${row.aName} / ${row.bName}: ${row.matches} matches`);
  };
  if (workers === 1) {
    for (const job of jobs) accept(simulate(job));
  } else {
    // Register tsx inside each worker so this works on Node 22 as well as newer runtimes.
    const pool = Array.from({ length: workers }, () => new Worker(
      "require('tsx/cjs'); require(require('node:worker_threads').workerData.script);",
      { eval: true, workerData: { script: __filename } },
    ));
    let next = 0;
    try {
      await Promise.all(pool.map(worker => new Promise<void>((resolve, reject) => {
        const dispatch = () => { if (next === jobs.length) resolve(); else worker.postMessage(jobs[next++]); };
        worker.on('message', (counts: Counts) => { accept(counts); dispatch(); });
        worker.once('error', reject);
        worker.once('exit', code => reject(new Error(`Simulation worker exited unexpectedly: ${code}`)));
        dispatch();
      })));
    } finally { await Promise.all(pool.map(worker => worker.terminate())); }
  }
  const stats = game.characters.map(c => ({ id: c.id, name: c.name, wins: 0, losses: 0, draws: 0, matches: 0, rate: 0 }));
  for (const row of matrix) {
    const a = stats.find(s => s.id === row.a)!, b = stats.find(s => s.id === row.b)!;
    a.wins += row.aWins; a.losses += row.bWins;
    b.wins += row.bWins; b.losses += row.aWins;
    for (const stat of [a, b]) { stat.draws += row.draws; stat.matches += row.matches; }
    row.aRate = (row.aWins + row.draws * .5) / row.matches * 100;
    row.bRate = (row.bWins + row.draws * .5) / row.matches * 100;
  }
  for (const stat of stats) stat.rate = (stat.wins + stat.draws * .5) / stat.matches * 100;
  const result = {
    cds: game.characters.flatMap(c => [c.s0.cd, c.s1.cd, c.s2.cd]),
    rounds, seed, difficulty, mode: 'pve', duration: 90, stats, byId: Object.fromEntries(stats.map(s => [s.id, s])), matrix,
    gap: Math.max(...stats.map(s => s.rate)) - Math.min(...stats.map(s => s.rate)),
    matches: matrix.reduce((sum, row) => sum + row.matches, 0),
    frames: matrix.reduce((sum, row) => sum + row.frames, 0),
    timeouts: matrix.reduce((sum, row) => sum + row.timeouts, 0), elapsedMs: Math.round(performance.now() - started),
  };
  const acceptance = maxGap === undefined ? undefined : {
    metric: 'maximum overall score rate minus minimum overall score rate, in percentage points',
    maximumGap: maxGap, actualGap: result.gap, passed: result.gap <= maxGap,
  };
  if (output) {
    const sourcePaths = ['shared/combat.ts', 'shared/ai.ts', 'shared/ai-tactics.ts', 'shared/arena.ts', 'shared/locomotion.ts', 'shared/ladder.ts', 'simulate-balance.ts'];
    const report = {
      description: 'Fixed-cooldown AI round robin using the unmodified production engine. Overall score rates weight all four opponents equally; draws count as half a win. This does not establish human-player or individual-matchup balance.',
      aiLabel: `${game.difficulties[difficulty].label} AI`, currentDifficulty: difficulty,
      reproduce: `pnpm balance ${rounds} ${difficulty} ${seed} --json ${output}${maxGap === undefined ? '' : ` --max-gap ${maxGap}`}`,
      rules: { framesPerSecond: 60, cooldownFrameRange: [120, 300], autoplay: true, introFrames: 0,
        equalOpponents: true, swappedSeats: true, sameSeedForBothSeats: true, drawScore: .5 },
      sourceSha256: Object.fromEntries(sourcePaths.map(path => [path,
        createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
      hashNormalization: 'UTF-8 with LF line endings', result, acceptance,
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`AI balance simulation: ${rounds} rounds/side, ${difficulty}, seed ${seed}`);
  console.table(stats.map(s => ({ 角色: s.name, 胜: s.wins, 负: s.losses, 平: s.draws, 胜率: `${s.rate.toFixed(5)}%` })));
  console.table(matrix.map(row => ({ 对局: `${row.aName} vs ${row.bName}`, 前者胜: row.aWins, 后者胜: row.bWins, 平: row.draws })));
  console.log(`Overall gap: ${result.gap.toFixed(5)} percentage points; ${result.matches} matches`);
  if (acceptance) {
    console.log(`Balance target ${acceptance.passed ? 'PASS' : 'FAIL'}: gap <= ${maxGap} percentage points`);
    if (!acceptance.passed) process.exitCode = 1;
  }
}

if (isMainThread) main().catch(error => { console.error(error); process.exitCode = 1; });
else parentPort!.on('message', (job: Job) => parentPort!.postMessage(simulate(job)));
