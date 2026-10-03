import game from './shared/combat';
import type { Character, Difficulty } from './shared/types';
// AI-versus-AI diagnostics use the same isolated combat world as PVE and PVP.
// Run: pnpm balance [rounds per side] [easy|normal|hard] [seed]
const roundsPerSide = Math.max(1, Math.min(10000, Math.floor(Number(process.argv[2]) || 100)));
const requestedDifficulty = process.argv[3] || "hard";
if (requestedDifficulty !== 'easy' && requestedDifficulty !== 'normal' && requestedDifficulty !== 'hard') throw new Error("Difficulty must be easy, normal or hard");
const difficulty: Difficulty = requestedDifficulty;
const baseSeed = Number(process.argv[4]) || 0x51f15e;
if (!game.difficulties[difficulty]) throw new Error("Difficulty must be easy, normal or hard");

function fight(left: Character, right: Character, seed: number) {
  const world = game.createWorld({ left: left.id, right: right.id, mode: "pve", difficulty,
    autoplay: true, seed, introFrames: 0, duration: 90 });
  // Hit stops freeze the match timer, so use a separate generous safety bound.
  for (let frame = 0; frame < 90 * 60 * 4 && !world.getResult(); frame++) world.step([]);
  const result = world.getResult();
  if (!result) throw new Error(`Simulation did not finish: ${left.id} vs ${right.id}`);
  return result.winner === null ? 0 : result.winner === 0 ? 1 : -1;
}

const stats = new Map(game.characters.map(c => [c.id, { name: c.name, wins: 0, losses: 0, draws: 0, matches: 0 }]));
const matrix = [];
// Keep each pairing's seeds stable when increasing the sample count. Both seat
// arrangements use the same seed, matching the offline cooldown search.
function matchSeed(pairId: number, round: number) {
  let x = (baseSeed >>> 0) ^ Math.imul(pairId + 1, 0x9e3779b9) ^ Math.imul(round + 1, 0x85ebca6b);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
let pairId = 0;
for (let i = 0; i < game.characters.length; i++) {
  for (let j = i + 1; j < game.characters.length; j++, pairId++) {
    const a = game.characters[i], b = game.characters[j];
    let aWins = 0, bWins = 0, draws = 0;
    for (let round = 0; round < roundsPerSide; round++) {
      const seed = matchSeed(pairId, round);
      let result = fight(a, b, seed);
      if (result > 0) aWins++; else if (result < 0) bWins++; else draws++;
      result = fight(b, a, seed);
      if (result > 0) bWins++; else if (result < 0) aWins++; else draws++;
    }
    const sa = stats.get(a.id)!, sb = stats.get(b.id)!;
    sa.wins += aWins; sa.losses += bWins; sa.draws += draws; sa.matches += roundsPerSide * 2;
    sb.wins += bWins; sb.losses += aWins; sb.draws += draws; sb.matches += roundsPerSide * 2;
    matrix.push({ 对局: `${a.name} vs ${b.name}`, 前者胜: aWins, 后者胜: bWins, 平: draws });
  }
}
console.log(`AI balance simulation: ${roundsPerSide} rounds/side, ${difficulty}, seed ${baseSeed}`);
console.table([...stats.values()].map(s => ({ 角色: s.name, 胜: s.wins, 负: s.losses, 平: s.draws,
  胜率: `${((s.wins + s.draws * .5) / s.matches * 100).toFixed(1)}%` })));
console.table(matrix);
