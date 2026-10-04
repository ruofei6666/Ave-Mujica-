import { characters, createWorld } from './shared/combat';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Actual PVE controllers, with the same hit-stop/reaction clocks as play. Include
// mirrors and all 20 other ordered matchups; repeat each seed with seats swapped.
const rounds = Math.max(1, Math.min(1000, Math.floor(Number(process.argv[2]) || 20)));
const seed = Number(process.argv[3]) >>> 0 || 0x64b19d;
const stats = characters.map(c => ({ id: c.id, name: c.name, wins: 0, losses: 0, draws: 0, mirrors: [0, 0, 0] }));
const started = performance.now();
for (let a = 0; a < characters.length; a++) {
  for (let b = 0; b < characters.length; b++) {
    for (let round = 0; round < rounds; round++) {
      const matchSeed = (seed ^ Math.imul(a * 5 + b + 1, 0x9e3779b9) ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
      for (const seat of [0, 1]) {
        const world = createWorld({ left: characters[seat ? b : a].id, right: characters[seat ? a : b].id,
          mode: 'pve', autoplay: true, autoplayDifficulty: seat ? 'normal' : 'hard',
          difficulty: seat ? 'hard' : 'normal', seed: matchSeed, introFrames: 0, duration: 90 });
        for (let frame = 0; frame < 21600 && !world.getResult(); frame++) world.step();
        const result = world.getResult();
        if (!result) throw new Error('AI match exceeded the safety bound');
        const outcome = result.winner === null ? 2 : result.winner === seat ? 0 : 1;
        const stat = stats[a];
        stat[outcome === 0 ? 'wins' : outcome === 1 ? 'losses' : 'draws']++;
        if (a === b) stat.mirrors[outcome]++;
      }
    }
  }
}
const total = stats.reduce((a, s) => ({ wins: a.wins + s.wins, losses: a.losses + s.losses, draws: a.draws + s.draws }), { wins: 0, losses: 0, draws: 0 });
console.log(JSON.stringify({ roundsPerSeatAndPair: rounds, seed, matches: rounds * 50,
  description: 'Challenge versus hard (former challenge), all 25 ordered character pairs, swapped seats; equal stats and cooldowns.',
  sourceSha256: Object.fromEntries(['shared/ai.ts', 'shared/ai-tactics.ts', 'shared/combat.ts'].map(path =>
    [path, createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
  ...total, scoreRate: (total.wins + total.draws * .5) / (rounds * 50), stats,
  elapsedMs: Math.round(performance.now() - started) }, null, 2));
