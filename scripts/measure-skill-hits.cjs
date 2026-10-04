'use strict';
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { availableParallelism } = require('node:os');
const { isMainThread, parentPort, Worker } = require('node:worker_threads');
const game = require('../shared/combat.ts');

const slots = ['punch', 's0', 's1', 's2', 'ult'];
const maxHits = {
  gale: [1, 1, 1, 3, 3], iron: [1, 1, null, 1, 3], shadow: [1, null, 1, 1, 5],
  pyro: [1, 2, 1, 1, 1], bastion: [1, 1, 1, 2, 4],
};
const definitions = game.characters.flatMap(c => slots.map((slot, index) => ({
  id: `${c.id}_${slot}`, character: c.id, characterName: c.name, slot, name: c[slot].name,
  kind: maxHits[c.id][index] === null ? 'support' : c.id === 'shadow' && slot === 's2' ? 'control' : 'damage',
  maximumHits: maxHits[c.id][index],
})));
const byId = new Map(definitions.map(def => [def.id, def]));
const pairs = game.characters.flatMap((a, ai) => game.characters.slice(ai).map(b => ({ a: a.id, b: b.id })));
const keys = ['casts', 'landedCasts', 'fullHitCasts', 'hitEvents', 'damage', 'stolenMana', 'unfinishedAtEnd'];
const emptyCounts = () => Object.fromEntries(keys.map(key => [key, 0]));
const sourcePaths = ['shared/combat.ts', 'shared/ai.ts', 'shared/ai-tactics.ts', 'shared/arena.ts', 'shared/locomotion.ts', 'shared/ladder.ts', 'scripts/measure-skill-hits.cjs'];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(file => [file, createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));

// Read the ordinary, sequence-numbered combat events. No fighter, input, timer,
// hit box, RNG or combat constant is modified for measurement.
function createCollector() {
  let lastSeq = 0;
  const latest = new Map(), casts = [];
  function consume(snapshot) {
    for (const event of snapshot.events) {
      if (event.seq <= lastSeq) continue;
      lastSeq = event.seq;
      if (!['attack', 'skill', 'hit'].includes(event.kind)) continue;
      const def = byId.get(event.id);
      if (!def || (event.actor !== 0 && event.actor !== 1)) throw new Error(`Unattributed ${event.kind}: ${JSON.stringify(event)}`);
      const key = `${event.actor}:${event.id}`;
      if (event.kind !== 'hit') {
        if (snapshot.fighters[event.actor].id !== def.character) throw new Error('Cast owner mismatch');
        // Same-slot effects must have expired before another cast. If this ever
        // changes, fail explicitly instead of crediting an old projectile to a
        // new cast; production would then need an explicit cast identifier.
        if (latest.has(key) && [...snapshot.projectiles, ...snapshot.hazards].some(effect => effect.owner === event.actor && effect.sfx === event.id)) {
          throw new Error(`Overlapping casts require explicit attribution: ${key}`);
        }
        const cast = { id: event.id, actor: event.actor, seq: event.seq, frame: event.frame,
          opponent: snapshot.fighters[1 - event.actor].id, hits: 0, damage: 0, stolenMana: 0 };
        casts.push(cast); latest.set(key, cast);
      } else {
        const cast = latest.get(key);
        if (!cast || event.target !== 1 - event.actor) throw new Error(`Hit has no matching cast: ${JSON.stringify(event)}`);
        if (def.kind === 'support') throw new Error(`Support skill unexpectedly hit: ${def.id}`);
        cast.hits++; cast.damage += event.damage ?? 0; cast.stolenMana += event.stolen ?? 0;
        if (cast.hits > def.maximumHits) throw new Error(`Too many hit events for one cast: ${JSON.stringify(cast)}`);
      }
    }
  }
  function totals(snapshot) {
    const result = {};
    for (const cast of casts) {
      const def = byId.get(cast.id), key = `${cast.id}/${cast.opponent}`;
      const row = result[key] ??= emptyCounts();
      row.casts++; row.landedCasts += Number(cast.hits > 0);
      row.fullHitCasts += Number(def.maximumHits !== null && cast.hits === def.maximumHits);
      row.hitEvents += cast.hits; row.damage += cast.damage; row.stolenMana += cast.stolenMana;
      const fighter = snapshot.fighters[cast.actor];
      const stillActing = latest.get(`${cast.actor}:${cast.id}`) === cast && (fighter.skillMove === cast.id || def.slot === 'punch' && fighter.state === 'punch');
      const stillTravelling = latest.get(`${cast.actor}:${cast.id}`) === cast && [...snapshot.projectiles, ...snapshot.hazards].some(effect => effect.owner === cast.actor && effect.sfx === cast.id);
      if (!cast.hits && (stillActing || stillTravelling)) row.unfinishedAtEnd++;
    }
    return result;
  }
  return { consume, totals };
}

function matchSeed(base, pairId, round) {
  let x = (base >>> 0) ^ Math.imul(pairId + 1, 0x9e3779b9) ^ Math.imul(round + 1, 0x85ebca6b);
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
function merge(into, from) {
  for (const [key, counts] of Object.entries(from)) {
    const row = into[key] ??= emptyCounts();
    for (const field of keys) row[field] += counts[field];
  }
}
function simulate(job) {
  const pair = pairs[job.pairId], result = { counts: {}, matches: 0, frames: 0 };
  for (let round = job.start; round < job.start + job.count; round++) {
    for (const swapped of pair.a === pair.b ? [false] : [false, true]) {
      const world = game.createWorld({ left: swapped ? pair.b : pair.a, right: swapped ? pair.a : pair.b,
        mode: 'pve', difficulty: 'hard', autoplay: true, seed: matchSeed(job.seed, job.pairId, round), duration: 90, introFrames: 0 });
      const collector = createCollector(); let snapshot;
      for (let step = 0; step < 21600 && !world.getResult(); step++) {
        world.step(); snapshot = world.snapshot(); collector.consume(snapshot); result.frames++;
      }
      if (!world.getResult()) throw new Error(`Unfinished match ${JSON.stringify({ ...job, round, swapped })}`);
      merge(result.counts, collector.totals(snapshot)); result.matches++;
    }
  }
  return result;
}

function summarize(def, counts) {
  const applicable = def.kind !== 'support' && counts.casts > 0;
  return { ...def, ...counts, status: def.kind === 'support' ? 'support' : counts.casts > 0 ? 'measured' : 'unobserved',
    hitRate: applicable ? counts.landedCasts / counts.casts * 100 : null,
    fullHitRate: applicable ? counts.fullHitCasts / counts.casts * 100 : null,
    meanHitsPerCast: applicable ? counts.hitEvents / counts.casts : null,
    meanDamagePerCast: counts.casts ? counts.damage / counts.casts : null };
}
function checkAccuracy(rows, minimumHitRate, minimumCasts) {
  const checked = definitions.filter(def => def.kind !== 'support');
  const failures = [];
  for (const def of checked) {
    const row = rows.find(row => row.id === def.id);
    const reasons = [];
    const hitRate = row?.casts > 0 ? row.landedCasts / row.casts * 100 : null;
    if (!row) reasons.push('missing result');
    if (!row || row.casts < minimumCasts) reasons.push('insufficient casts');
    if (hitRate === null || !Number.isFinite(hitRate) || hitRate < minimumHitRate) reasons.push('below hit-rate target');
    if (reasons.length) failures.push({ id: def.id, name: def.name, casts: row?.casts ?? 0, hitRate, reasons });
  }
  return { minimumHitRate, minimumCasts, checkedAttacks: checked.length,
    excludedSupport: definitions.filter(def => def.kind === 'support').map(def => def.id), passed: failures.length === 0, failures };
}
async function main() {
  const rounds = Number(process.argv[2] ?? 400), seed = Number(process.argv[3] ?? 20261004);
  const output = process.argv[4] ?? 'tests/skill-hit-report.json';
  const workers = Number(process.argv[5] ?? Math.min(8, availableParallelism()));
  let minimumHitRate = null, minimumCasts = 1000;
  for (let i = 6; i < process.argv.length; i += 2) {
    if (process.argv[i + 1] === undefined) throw new Error(`Missing value for ${process.argv[i]}`);
    if (process.argv[i] === '--min-hit-rate') minimumHitRate = Number(process.argv[i + 1]);
    else if (process.argv[i] === '--min-casts') minimumCasts = Number(process.argv[i + 1]);
    else throw new Error(`Unknown option: ${process.argv[i]}`);
  }
  if (minimumHitRate !== null && (!Number.isFinite(minimumHitRate) || minimumHitRate < 0 || minimumHitRate > 100)) throw new Error('Minimum hit rate must be in [0, 100]');
  if (!Number.isSafeInteger(minimumCasts) || minimumCasts < 1) throw new Error('Minimum casts must be a positive integer');
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100000) throw new Error('Rounds must be an integer in [1, 100000]');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw new Error('Workers must be in [1, 32]');
  const sourceSha256 = sourceHashes();
  const jobs = [], chunk = Math.min(25, rounds), started = performance.now();
  for (let pairId = 0; pairId < pairs.length; pairId++) for (let start = 0; start < rounds; start += chunk) {
    jobs.push({ pairId, start, count: Math.min(chunk, rounds - start), seed });
  }
  const counts = {}, results = new Map();
  const accept = (index, result) => { results.set(index, result); if (results.size % 30 === 0 || results.size === jobs.length) console.error(`Completed ${results.size}/${jobs.length} batches`); };
  if (workers === 1) jobs.forEach((job, index) => accept(index, simulate(job)));
  else {
    const pool = Array.from({ length: Math.min(workers, jobs.length) }, () => new Worker("require('tsx/cjs'); require(require('node:worker_threads').workerData.script);", { eval: true, workerData: { script: __filename } }));
    let next = 0;
    try {
      await Promise.all(pool.map(worker => new Promise((resolve, reject) => {
        const dispatch = () => { if (next === jobs.length) resolve(); else { const index = next++; worker.postMessage({ index, job: jobs[index] }); } };
        worker.on('message', ({ index, result }) => { accept(index, result); dispatch(); });
        worker.once('error', reject); worker.once('exit', code => reject(new Error(`Worker unexpectedly exited: ${code}`))); dispatch();
      })));
    } finally { await Promise.all(pool.map(worker => worker.terminate())); }
  }
  // Fixed merge order makes floating damage totals reproducible across workers.
  let matches = 0, frames = 0;
  for (let index = 0; index < jobs.length; index++) {
    const result = results.get(index); merge(counts, result.counts); matches += result.matches; frames += result.frames;
  }
  const rows = definitions.map(def => {
    const total = emptyCounts();
    const opponents = game.characters.map(opponent => {
      const row = counts[`${def.id}/${opponent.id}`] || emptyCounts();
      for (const key of keys) total[key] += row[key];
      return { opponent: opponent.id, opponentName: opponent.name, ...summarize(def, row) };
    });
    return { ...summarize(def, total), opponents };
  });
  if (JSON.stringify(sourceSha256) !== JSON.stringify(sourceHashes())) throw new Error('Source changed during measurement; repeat the run');
  const report = { rules: { ai: 'hard / challenge', ladderBonuses: false, duration: 90, roundsPerOrderedPair: rounds,
    orderedPairs: 25, includingMirrors: true, swappedSeats: true, sameSeedForSwappedSeats: true,
    metric: 'casts with at least one actual hit / all successful skill activations; multi-hit casts count once; zero-damage control hits count; support skills are not applicable',
    interruptedAndUnresolvedCasts: 'included in all activations; no combat is simulated after match end',
    aggregation: 'pooled by actual casts; each character has equal matches against all five opponents; not a human-player accuracy estimate' },
    seed, matches, frames, elapsedMs: Math.round(performance.now() - started),
    reproduce: `node --import tsx scripts/measure-skill-hits.cjs ${rounds} ${seed} ${output} ${workers}${process.argv.length > 6 ? ' ' + process.argv.slice(6).join(' ') : ''}`,
    sourceSha256,
    rows };
  if (minimumHitRate !== null) report.acceptance = checkAccuracy(rows, minimumHitRate, minimumCasts);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.table(rows.map(row => ({ 角色: row.characterName, 技能: row.name, 释放: row.casts, 命中次数: row.landedCasts,
    命中率: row.hitRate === null ? row.status === 'support' ? '不适用' : '未施放' : row.hitRate.toFixed(2) + '%',
    全段命中率: row.fullHitRate === null ? row.status === 'support' ? '不适用' : '未施放' : row.fullHitRate.toFixed(2) + '%', 每次平均伤害: row.meanDamagePerCast?.toFixed(2) })));
  console.log(`${matches} matches; ${Math.round(report.elapsedMs / 1000)}s; report: ${output}`);
  if (report.acceptance) {
    console.log(`Accuracy check: ${report.acceptance.passed ? 'PASS' : 'FAIL'} (${minimumHitRate}%, at least ${minimumCasts} casts per attack)`);
    if (!report.acceptance.passed) { console.error(JSON.stringify(report.acceptance.failures)); process.exitCode = 1; }
  }
}
module.exports = { createCollector, simulate, summarize, definitions, checkAccuracy };
if (!isMainThread) parentPort.on('message', ({ index, job }) => parentPort.postMessage({ index, result: simulate(job) }));
else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
