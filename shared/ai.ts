import { ARENA } from './arena';
import type { Character, Difficulty, DifficultyConfig, FighterSnapshot, Hazard, Input, Projectile, Seat } from './types';

// Difficulty changes decisions only. Health, damage, movement and cooldowns stay shared.
export const AI_DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { label: '普通', miss: .14, skill: .6, ult: .6, aggro: .72, jump: .04, think: 14, precision: .64 },
  normal: { label: '困难', miss: .06, skill: .86, ult: .86, aggro: .92, jump: .08, think: 8, precision: .82 },
  hard: { label: '挑战', miss: .008, skill: .99, ult: .99, aggro: .995, jump: .12, think: 4, precision: .98 },
};

export interface AiMemory { wait: number; left: boolean; right: boolean; evade: number }
type Owner = Seat | { seat: Seat } | null;
interface AiScene {
  difficulty: Difficulty;
  projectiles: readonly Projectile<Owner>[];
  hazards: readonly Hazard<Owner>[];
  random: () => number;
}
export const createAiMemory = (): AiMemory => ({ wait: 0, left: false, right: false, evade: 0 });
const ownerSeat = (owner: Owner) => typeof owner === 'object' ? owner?.seat : owner;
const clampX = (x: number) => Math.max(ARENA.leftWall, Math.min(ARENA.rightWall, x));
const futureY = (f: FighterSnapshot, t: number) => f.state === 'skill' && f.skillMove !== 'gale_s0'
  ? f.y : Math.min(ARENA.ground, f.y + f.vy * t + .41 * t * t);
const futureX = (f: FighterSnapshot, t: number) => clampX(f.x + f.vx * (f.state === 'stun' ? (1 - .86 ** t) / .14 : t));
const busy = (f: FighterSnapshot) => ['punch', 'skill', 'stun', 'dead'].includes(f.state);
const ATTACK_WINDOWS: Readonly<Record<string, readonly [number, number]>> = {
  iron_s0: [10, 135], iron_s2: [14, 220], iron_ult: [44, 190],
  gale_s0: [23, 195], gale_s1: [16, 265], gale_s2: [26, 190], gale_ult: [34, 300],
  shadow_s1: [14, 300], shadow_s2: [10, 145], shadow_ult: [41, 300],
  bastion_s0: [16, 210], bastion_s1: [44, 305], bastion_s2: [17, 240], bastion_ult: [34, 260],
};

// Only visible positions, velocities and attack animations are inspected. No future
// player input or RNG is read, and this controller never writes fighter state.
export function thinkAi(me: FighterSnapshot, opp: FighterSnapshot, def: Character, memory: AiMemory, scene: AiScene): Input {
  const cfg = AI_DIFFICULTIES[scene.difficulty];
  const rank = scene.difficulty === 'hard' ? 2 : scene.difficulty === 'normal' ? 1 : 0;
  const out: Input = { left: memory.left, right: memory.right, down: false, up: false,
    punch: false, special: false, skill1: false, skill2: false, ult: false };
  const move = (direction: number) => {
    // Never keep pushing into a wall. Turning out of a corner is decided below.
    out.left = direction < 0 && me.x > ARENA.leftWall + 2;
    out.right = direction > 0 && me.x < ARENA.rightWall - 2;
  };
  const done = () => { memory.left = out.left; memory.right = out.right; return out; };
  if (me.dead || opp.dead) { move(0); return done(); }
  if ((out.left && me.x <= ARENA.leftWall + 2) || (out.right && me.x >= ARENA.rightWall - 2)) move(0);
  // Defense, attack and movement all obey the same reaction clock, including hitstun.
  memory.wait--;
  memory.evade = Math.max(0, memory.evade - 1);
  if (memory.wait > 0) return done();
  memory.wait = cfg.think + Math.floor(scene.random() * (rank === 0 ? 5 : 3));
  if (busy(me)) { move(0); return done(); }
  // Finish clearing a projectile before committing to an animation that stops a jump.
  if (memory.evade > 0 && me.y < ARENA.ground - .01) return done();

  const roll = (p: number) => scene.random() < p;
  const dist = opp.x - me.x, abs = Math.abs(dist), toward = Math.sign(dist) || me.facing;
  const cornered = toward > 0 ? me.x < ARENA.leftWall + 130 : me.x > ARENA.rightWall - 130;
  const grounded = me.y >= ARENA.ground - .01;
  const lead = rank * 3;
  const projected = (frames: number) => Math.abs(futureX(opp, Math.min(frames, lead + 4)) - me.x);
  const aligned = (frames: number, tolerance = 85) => Math.abs(futureY(opp, frames) - futureY(me, frames)) < tolerance;
  const vulnerable = opp.invuln <= 3 + lead;
  const stunLeft = opp.state === 'stun' ? Math.max(0, (opp.stunMax || 0) - opp.stateT) : 0;
  const recovery = (opp.state === 'punch' && opp.stateT >= 12) || (opp.state === 'skill' && opp.attackHit && !opp.hitOn);
  const punish = rank > 0 && (stunLeft > 5 || recovery);
  const use = (action: 'punch' | 'special' | 'skill1' | 'skill2' | 'ult') => { move(0); out[action] = true; return done(); };

  // Find the earliest actual collision along the current path, including height.
  // Waves have a ground rectangle; notes and curtains have their own radii.
  let incomingAt = Infinity;
  // Leave time for one decision interval and the jump's ascent. Looking much
  // farther ahead makes a fast controller land back into a still-arriving wave.
  const horizon = Math.max(20, cfg.think + 10);
  for (const p of scene.projectiles) {
    if (ownerSeat(p.owner) === me.seat) continue;
    for (let t = 1; t <= Math.min(horizon, p.life); t += 2) {
      const px = p.x + p.vx * t, py = p.y + p.vy * t;
      const mx = clampX(me.x + me.vx * t), my = futureY(me, t);
      const rx = p.type === 'wave' ? 48 : p.r;
      const top = p.type === 'wave' ? ARENA.ground - 92 : py - p.r;
      const bottom = p.type === 'wave' ? ARENA.ground : py + p.r;
      if (Math.abs(px - mx) < rx + 33 && bottom > my - 138 && top < my) {
        incomingAt = Math.min(incomingAt, t); break;
      }
    }
  }
  let hazardX: number | null = null, hazardAt = Infinity;
  for (const h of scene.hazards) {
    if (ownerSeat(h.owner) === me.seat || h.hit) continue;
    for (let t = 1; t <= horizon; t += 2) {
      if (t < h.delay || t - h.delay > h.life) continue;
      const my = futureY(me, t), mx = clampX(me.x + me.vx * t);
      const hy = h.y + (h.type === 'meteor' ? (h.vy || 14) * Math.max(0, t - h.delay) : 0);
      const landed = h.type === 'meteor' && hy >= ARENA.ground - 20;
      const radius = h.type === 'pillar' ? 32 : h.type === 'skillShock' ? h.radius : h.type === 'meteor' && !landed ? 18 : 90;
      const top = h.type === 'meteor' && !landed ? hy - 18 : ARENA.ground - (h.type === 'pillar' ? 150 : h.type === 'skillShock' ? h.radius * 1.45 : 80);
      const bottom = h.type === 'meteor' && !landed ? hy + 18 : ARENA.ground;
      if (Math.abs(h.x - mx) < radius + 33 && bottom > my - 138 && top < my && t < hazardAt) {
        hazardX = h.x; hazardAt = t; break;
      }
    }
  }
  const attack = opp.skillMove;
  const inFront = (me.x - opp.x) * opp.facing > -35;
  let meleeThreat = opp.state === 'punch' && opp.stateT < 12 && !opp.attackHit && abs < 140 && inFront && aligned(4, 95);
  if (opp.state === 'skill' && aligned(5, 105)) {
    const w = attack ? ATTACK_WINDOWS[attack] : undefined;
    // A charging move is a visible warning, not a hit throughout its recovery.
    meleeThreat ||= !!w && opp.stateT < w[0] && abs < w[1] && (inFront || attack?.startsWith('shadow_') === true || attack === 'gale_ult');
  }
  const threatened = incomingAt < Infinity || hazardX !== null || meleeThreat;
  if (threatened && me.invuln <= 3 && roll(cfg.precision)) {
    if (hazardX !== null) {
      let escape = Math.sign(me.x - hazardX) || -toward;
      if ((escape < 0 && me.x < ARENA.leftWall + 125) || (escape > 0 && me.x > ARENA.rightWall - 125)) escape = -escape;
      move(escape);
      if (rank > 0 && me.id === 'shadow' && me.cd1 <= 0 && Math.abs(opp.x - hazardX) > 145) return use('skill1');
      if (rank > 0 && me.id === 'gale' && me.cd1 <= 0 && toward === escape) return use('skill1');
      return done();
    }
    if (incomingAt < Infinity) {
      // Invulnerable/armored movement is useful only if it also reaches the opponent.
      if (rank > 0 && me.id === 'iron' && me.cd2 <= 0 && abs < 200 && aligned(6)) return use('skill2');
      if (rank > 0 && me.id === 'shadow' && me.cd1 <= 0 && incomingAt >= 8) return use('skill1');
      if (rank > 0 && me.id === 'gale' && me.cd1 <= 0 && incomingAt <= 5 && abs < 240 && aligned(4)) return use('skill1');
      if (me.id === 'iron' && me.cd1 <= 0 && me.armor < 12 && incomingAt < 10) return use('skill1');
      if (grounded && me.heavyT <= 0) {
        out.up = true; memory.evade = 22; move(cornered ? toward : -toward); return done();
      }
    }
    if (meleeThreat && !punish) {
      if (attack === 'iron_s0' && opp.stateT < 7 && grounded) {
        move(cornered ? toward : -toward); out.up = true; return done();
      }
      if (rank > 0 && me.mp >= def.ult.cost && (me.id === 'gale' || me.id === 'shadow') && vulnerable && roll(cfg.ult)) return use('ult');
      if (rank > 0 && me.id === 'gale' && me.cd1 <= 0 && aligned(3)) return use('skill1');
      if (rank > 0 && me.id === 'iron' && me.cd2 <= 0 && abs < 185) return use('skill2');
      if (rank > 0 && me.id === 'shadow' && me.cd1 <= 0 && opp.stateT < 5) return use('skill1');
      if (me.id === 'iron' && me.cd1 <= 0 && me.armor < 12) return use('skill1');
      // Back out of a slow startup; don't try a ten-frame interrupt against an active punch.
      if (attack === 'bastion_s1' || attack === 'iron_ult' || opp.invuln > 5) {
        move(cornered ? toward : -toward);
        if (cornered && grounded) out.up = true;
        return done();
      }
    }
  }

  const skillChance = punish ? Math.max(.9, cfg.skill) : cfg.skill;
  if (!punish && roll(cfg.miss)) { move(abs > 120 ? toward : 0); return done(); }
  if (me.mp >= def.ult.cost && vulnerable && roll(cfg.ult)) {
    const ultOk = me.id === 'shadow' || (me.id === 'gale' && aligned(8, 115)) ||
      (me.id === 'pyro' && (stunLeft > 12 || abs > 180 || recovery)) ||
      (me.id === 'iron' && projected(12) < 175 && aligned(12, 95)) ||
      (me.id === 'bastion' && projected(8) > 40 && projected(8) < 220 && futureY(opp, 8) > ARENA.ground - 150);
    if (ultOk) return use('ult');
  }
  if (roll(skillChance)) {
    if (me.id === 'pyro') {
      const travel = Math.min(35, 10 + abs / 9);
      if (vulnerable && me.cd2 <= 0 && projected(10) < 360 && futureY(opp, travel) > ARENA.ground - 80) return use('skill2');
      const noteY = me.y - 58, targetY = futureY(opp, Math.min(45, 11 + abs / 12));
      if (vulnerable && me.cd1 <= 0 && projected(11) < 610 && noteY + 16 > targetY - 138 && noteY - 16 < targetY) return use('skill1');
      if (me.cd0 <= 0 && (abs > 160 || punish || me.cd1 > 0 && me.cd2 > 0)) return use('special');
    } else if (me.id === 'gale') {
      if (vulnerable && me.cd2 <= 0 && projected(6) < 150 && aligned(6, 80)) return use('skill2');
      if (opp.invuln <= Math.max(1, Math.ceil((abs - 138) / 13)) && me.cd1 <= 0 && abs > 115 && projected(8) < 285 && aligned(4, 90)) return use('skill1');
      if (vulnerable && me.cd0 <= 0 && abs > 90 && abs < 240 && opp.y < ARENA.ground - 45) return use('special');
    } else if (me.id === 'iron') {
      if (vulnerable && me.cd0 <= 0 && projected(10) < 127 && aligned(10, 85)) return use('special');
      if (vulnerable && me.cd2 <= 0 && projected(6) < 215 && aligned(6, 85)) return use('skill2');
      if (rank > 0 && me.cd1 <= 0 && me.armor <= 0 && abs > 145 && abs < 290 && opp.vx * toward < 0) return use('skill1');
    } else if (me.id === 'shadow') {
      if (vulnerable && me.cd2 <= 0 && projected(10) < 135 && aligned(10, 100) &&
        (opp.mp >= 30 || attack === 'bastion_s1' || stunLeft > 10)) return use('skill2');
      if (vulnerable && me.cd1 <= 0) return use('skill1');
      // Spend the ready attacks first. Refresh only when it buys a new attack/ultimate.
      const refreshWorth = me.mp < 80 || (me.cd1 > 90 && me.cd2 > 90);
      if (me.cd0 <= 0 && refreshWorth && me.hp > (rank > 0 ? 72 : me.maxHp * .4) && (abs > 150 || opp.state === 'stun' || me.invuln > 8)) return use('special');
    } else if (me.id === 'bastion') {
      if (vulnerable && me.cd0 <= 0 && projected(10) < 188 && aligned(10, 90)) return use('special');
      if (vulnerable && me.cd2 <= 0 && projected(5) < 225 && aligned(5, 90)) return use('skill2');
      // Charge when they are committed or approaching; don't root at a retreating target.
      if (me.cd1 <= 0 && abs < 235 && aligned(15, 95) &&
        (stunLeft > 14 || meleeThreat || opp.vx * toward < -1 || cornered && abs < 140)) return use('skill1');
    }
  }
  if (opp.invuln <= def.punch.startup && projected(5) < def.punch.reach * 1.5 + 40 && aligned(5, 65) && roll(cfg.aggro)) return use('punch');

  const rangedReady = me.id === 'pyro' && (me.cd0 < 35 || me.cd1 < 35 || me.cd2 < 35);
  const preferred = rangedReady && !punish ? 260 : 96;
  if (cornered && abs < 190 && rangedReady) {
    move(toward);
    if (rank > 0 && grounded && roll(cfg.jump + .45)) out.up = true;
  } else if (abs > preferred + 16 || punish && abs > 115) move(toward);
  else if (abs < preferred - 32 && rangedReady && !cornered) move(-toward);
  else move(0);
  // Chase an airborne opponent only when a jump can put melee attacks in reach.
  if (rank > 0 && !rangedReady && abs < 180 && opp.y < ARENA.ground - 95 && opp.vy <= 2 && grounded && roll(cfg.jump + .3)) out.up = true;
  return done();
}
