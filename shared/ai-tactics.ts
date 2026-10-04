import { ARENA } from './arena';
import type { AttackAction, Character, FighterSnapshot, SkillMove } from './types';

// Small, bounded move forecasts. These describe public animations, not future
// inputs. They only rank legal inputs; the shared combat engine still resolves hits.
interface MovePlan {
  action: AttackAction;
  start: number;
  end: number;
  duration: number;
  damage: number;
  reach: number;
  speed?: number;
  travelFrames?: number;
  backReach?: number;
  retryDuringActive?: boolean;
  top?: number;
  bottom?: number;
  invuln?: number;
  armor?: number;
  tracking?: boolean;
}
const SKILLS: Partial<Record<SkillMove, MovePlan>> = {
  iron_s0: { action: 'special', start: 5, end: 14, duration: 26, damage: 37.4, reach: 120, backReach: 30, speed: 6, travelFrames: 8, top: -100, bottom: 100, retryDuringActive: true },
  iron_s2: { action: 'skill2', start: 6, end: 14, duration: 23, damage: 38.2, reach: 141, speed: 7.2, top: -114, bottom: 123, armor: 30 },
  iron_ult: { action: 'ult', start: 10, end: 14, duration: 52, damage: 94, reach: 189, speed: 5, travelFrames: 8, top: -150, bottom: 123, armor: 44 },
  gale_s0: { action: 'special', start: 8, end: 24, duration: 28, damage: 35.7, reach: 150, top: -150, bottom: 126, armor: 10 },
  gale_s1: { action: 'skill1', start: 1, end: 16, duration: 16, damage: 22.7, reach: 138, speed: 13, top: -120, bottom: 123, invuln: 5 },
  gale_s2: { action: 'skill2', start: 6, end: 9, duration: 34, damage: 48, reach: 129, speed: 5.5, top: -105, bottom: 108 },
  gale_ult: { action: 'ult', start: 8, end: 12, duration: 42, damage: 80, reach: 201, top: -159, bottom: 129, invuln: 18, tracking: true },
  shadow_s1: { action: 'skill1', start: 10, end: 14, duration: 22, damage: 35.7, reach: 162, top: -132, bottom: 126, tracking: true },
  shadow_s2: { action: 'skill2', start: 8, end: 14, duration: 24, damage: 8, reach: 210, backReach: 35, top: -120, bottom: 120, retryDuringActive: true },
  shadow_ult: { action: 'ult', start: 7, end: 9, duration: 50, damage: 82, reach: 153, tracking: true, invuln: 36 },
  bastion_s0: { action: 'special', start: 10, end: 16, duration: 28, damage: 35.7, reach: 210, top: -105, bottom: 141 },
  bastion_s1: { action: 'skill1', start: 40, end: 44, duration: 48, damage: 48, reach: 303, top: -138, bottom: 135, armor: 48 },
  bastion_s2: { action: 'skill2', start: 5, end: 9, duration: 26, damage: 40, reach: 141, speed: 8, top: -108, bottom: 126 },
  bastion_ult: { action: 'ult', start: 8, end: 22, duration: 52, damage: 68, reach: 121, top: -150, bottom: 138, invuln: 10 },
};
const MULTI_HITS: Partial<Record<SkillMove, readonly (readonly [number, number])[]>> = {
  gale_s2: [[6, 9], [14, 17], [22, 26]], gale_ult: [[8, 12], [18, 22], [28, 34]],
  iron_ult: [[10, 14], [22, 26], [36, 42]], shadow_ult: [[7, 9], [15, 16], [23, 24], [31, 32], [39, 41]],
  bastion_s2: [[5, 9], [12, 17]],
};
const clampX = (x: number) => Math.max(ARENA.leftWall, Math.min(ARENA.rightWall, x));
const free = (f: FighterSnapshot) => f.state === 'idle' || f.state === 'walk' || f.state === 'jump';
const punch = (def: Character): MovePlan => ({ action: 'punch', start: def.punch.startup,
  end: def.punch.startup + def.punch.active - 1,
  duration: def.punch.startup + def.punch.active + def.punch.recover,
  damage: def.punch.dmg + 4, reach: def.punch.reach * 1.5 + 48, top: -108, bottom: 69 });

function forecast(f: FighterSnapshot, t: number) {
  let x = f.x, y = f.y;
  if (f.state === 'skill') {
    const move = f.skillMove && SKILLS[f.skillMove];
    if (move?.speed) x += f.facing * move.speed * Math.min(t, Math.max(0, (move.travelFrames ?? move.duration) - f.stateT));
    // Most skills suspend the fighter, even if its stored velocity is nonzero.
    if (f.skillMove === 'gale_s0') {
      let vy = f.vy;
      for (let n = 1; n <= t; n++) {
        const phase = f.stateT + n;
        if (phase === 8) vy = 9.5;
        x += f.facing * (phase <= 7 ? 5.4 : 9.5);
        y = Math.min(ARENA.ground, y + vy);
        vy += .82 * (phase <= 7 ? .72 : .85);
        if (phase > 8 && y >= ARENA.ground || phase >= 28) break;
      }
    }
  } else {
    const friction = f.state === 'stun' || f.state === 'punch';
    x += f.vx * (friction ? (1 - .86 ** t) / .14 : t) * (f.state === 'punch' ? .4 : 1);
    y = Math.min(ARENA.ground, y + f.vy * t + .41 * t * (t + 1));
  }
  return { x: clampX(x), y };
}

// Predict the actual leap and its single turn at the apex. Grounded targets are
// valid: the final part of the dive reaches them without waiting for a jump.
export function galeDiveContact(me: FighterSnapshot, opp: FighterSnapshot) {
  let x = me.x, y = me.y, facing = Math.sign(opp.x - me.x) || me.facing;
  let vx = facing * 5.4, vy = -14;
  for (let t = 1; t <= 24; t++) {
    const target = forecast(opp, t);
    if (t === 8) { facing = Math.sign(target.x - x) || facing; vx = facing * 9.5; vy = 9.5; }
    x = clampX(x + vx); y += vy; vy += .82 * (t <= 7 ? .72 : .85);
    if (t > 8 && y >= ARENA.ground) break;
    const gap = (target.x - x) * facing, dy = target.y - y;
    if (t >= 8 && gap > -33 && gap < 150 && dy > -150 && dy < 126) return opp.invuln <= t ? t : Infinity;
  }
  return Infinity;
}

function remaining(f: FighterSnapshot) {
  if (f.state === 'stun') return Math.max(0, (f.stunMax || 0) - f.stateT);
  if (f.state === 'punch') return Math.max(0, 22 - f.stateT);
  if (f.state === 'skill') return Math.max(0, (f.skillMove && SKILLS[f.skillMove]?.duration || 26) - f.stateT);
  return 0;
}

export function planChallenge(me: FighterSnapshot, opp: FighterSnapshot, def: Character) {
  const distance = Math.abs(opp.x - me.x), toward = Math.sign(opp.x - me.x) || me.facing;
  const locked = remaining(opp);
  const opponentMove = opp.state === 'skill' && opp.skillMove ? SKILLS[opp.skillMove] : undefined;
  // Estimate the next visible hit. A free, nearby opponent can answer with a jab;
  // that is a conservative risk estimate, never a read of their pending input.
  let counterAt = opp.state === 'punch' && !opp.attackHit && opp.stateT < 11 ? Math.max(1, 5 - opp.stateT)
    : free(opp) ? 7 : Infinity;
  if (opponentMove) {
    const windows = opp.skillMove && MULTI_HITS[opp.skillMove] || [[opponentMove.start, opponentMove.end]];
    for (const [start, end] of windows) {
      if (opp.stateT >= end || opp.attackHit && opp.stateT >= start) continue;
      counterAt = Math.max(1, start - opp.stateT); break;
    }
  }
  const counterRange = opponentMove ? opponentMove.reach + (opponentMove.speed || 0) * Math.min(counterAt, 10) : 131;
  const facingThreat = (me.x - opp.x) * opp.facing > -33 || opponentMove?.tracking;
  const counter = Number.isFinite(counterAt) && distance < counterRange && Math.abs(me.y - opp.y) < 110 && (free(opp) || facingThreat);
  let best: AttackAction | undefined, bestScore = 0;
  const offer = (action: AttackAction, score: number) => {
    if (score > bestScore) { best = action; bestScore = score; }
  };
  const moves = [punch(def)];
  for (const [slot, ready] of [['s0', me.cd0 <= 0], ['s1', me.cd1 <= 0], ['s2', me.cd2 <= 0], ['ult', me.mp >= def.ult.cost]] as const) {
    const move = SKILLS[`${me.id}_${slot}`];
    if (ready && move) moves.push(move);
  }
  for (const move of moves) {
    // Long stationary charge is a counter against a committed target, not a chase.
    if (me.id === 'bastion' && move.action === 'skill1' && (opp.vx * toward > 1 || distance > 210 || locked < 16 && !counter)) continue;
    const dive = me.id === 'gale' && move.action === 'special';
    let contact = dive ? galeDiveContact(me, opp) : Infinity;
    for (let t = move.start; !dive && t <= move.end; t++) {
      const target = forecast(opp, t);
      const x = clampX(me.x + toward * (move.speed || 0) * Math.min(t, move.travelFrames ?? t));
      const y = move.action === 'punch' ? forecast(me, t).y : me.y;
      const gap = (target.x - x) * toward;
      const dy = target.y - y;
      const sameHeight = dy > (move.top ?? -120) && dy < (move.bottom ?? 120);
      const inRange = move.tracking || (gap > -(move.backReach ?? 25) && gap < move.reach);
      const height = move.tracking && me.id === 'shadow' || sameHeight;
      // First overlap consumes a one-hit attack even when invulnerability blocks
      // its damage. Waiting for a later active frame would predict a false hit.
      if (inRange && height) {
        if (opp.invuln <= t) { contact = t; break; }
        if (!move.retryDuringActive) break;
      }
    }
    if (!Number.isFinite(contact)) continue;
    // Leave space for takeoff and avoid visible attacks that outlast the short
    // launch armor, rather than treating protection as a guaranteed hit.
    if (dive && me.invuln < contact && Math.max(me.armor, move.armor ?? 0) < contact &&
      (free(opp) && distance < 180 || !opp.attackHit && opponentMove && counterAt <= contact && distance < 350)) continue;
    const armored = (move.armor || me.armor) > contact;
    const protectedUntil = Math.max(me.invuln, move.invuln || 0);
    const teleportsInTime = me.id === 'shadow' && move.action === 'skill1' && counterAt >= 8;
    const canInterrupt = opp.armor <= contact && opp.invuln <= contact && contact < counterAt;
    const interrupted = counter && counterAt <= contact && !armored && protectedUntil < counterAt && !teleportsInTime;
    let score = move.damage / (1 + contact / 26);
    if (canInterrupt && counter) score += 12;
    if (locked >= contact && opp.armor <= contact) score += 9;
    if (opp.armor > contact) score *= .65;
    if (free(opp) && contact > 14 && !dive) score *= .6;
    // Don't trade our remaining health for armor: armor reduces damage, not death.
    if (counter && armored && counterAt <= contact) score -= me.hp < 45 ? 30 : 4;
    if (me.id === 'shadow' && move.action === 'skill2') {
      score += Math.min(40, opp.mp) * .3;
      if (opponentMove && opp.armor > contact && counterAt > contact) score += 42;
      if (me.cd1 < 30 || me.mp >= def.ult.cost - 24) score += 8;
    }
    if (opp.hp < move.damage && opp.armor <= contact) score += 18;
    // A move interrupted before contact earns neither damage nor drain/stun.
    // Apply this after utility bonuses so they cannot promote a losing startup.
    if (interrupted) score *= .12;
    if (score >= 9) offer(move.action, score);
  }

  if (me.id === 'pyro') {
    const safeCast = !counter || counterAt > 12 || me.invuln >= 12 || me.armor >= 12;
    if (safeCast && me.cd1 <= 0) {
      let travel = 7 + Math.max(0, distance - 97) / 18;
      // Refine the interception time, including a target moving away, before
      // spending a projectile with only forty flight frames.
      for (let n = 0; n < 3; n++) travel = 7 + Math.max(0, (forecast(opp, travel).x - me.x) * toward - 97) / 18;
      const target = forecast(opp, travel);
      const gap = (target.x - me.x) * toward;
      if (travel <= 46 && gap > 0 && gap < 780 && opp.invuln < travel && target.y > me.y - 210 && target.y < me.y + 140)
        offer('skill1', 36 + (locked > 10 ? 12 : 0) - travel * .3);
    }
    if (safeCast && me.cd2 <= 0) {
      const travel = 7 + Math.max(0, distance - 121) / 11.5;
      const target = forecast(opp, travel);
      const gap = (target.x - me.x) * toward;
      if (gap > 0 && gap < 490 && target.y > ARENA.ground - 92 && opp.invuln < travel)
        offer('skill2', 40 + (locked > 10 ? 12 : 0) - travel * .3);
    }
    if (safeCast && me.cd0 <= 0 && (distance > 150 || locked > 9)) offer('special', 22);
    if (safeCast && me.mp >= def.ult.cost && opp.invuln < 30) {
      const landing = forecast(opp, 31);
      const aim = clampX(opp.x + opp.vx * 18);
      if (Math.abs(landing.x - aim) < 145) offer('ult', 38 + (locked > 18 ? 14 : 0));
    }
  }
  // Refresh buys a complete ultimate. Do it during breathing room or protected
  // recovery, and never sacrifice health just to refill an already full meter.
  if (me.id === 'shadow' && me.cd0 <= 0 && me.hp > 48 && (me.mp < 150 || me.cd1 > 90 && me.cd2 > 90) &&
    (!counter || counterAt > 7 || me.invuln > 7) && (distance > 145 || locked > 7 || me.invuln > 7)) offer('special', 46);
  if (me.id === 'iron' && me.cd1 <= 0 && me.armor < 12 && distance < 400 && distance > 160 &&
    (!counter || counterAt > 26) && opp.vx * toward <= 0) offer('skill1', 17);
  if (best) return { action: best, direction: 0, jump: false };
  const cornered = toward > 0 ? me.x < ARENA.leftWall + 130 : me.x > ARENA.rightWall - 130;
  if (opp.invuln > 5 && distance < 240 || counter && counterAt < 14) {
    return { direction: cornered ? toward : -toward, jump: cornered };
  }
  const ranged = me.id === 'pyro' && Math.min(me.cd0, me.cd1, me.cd2) < 55;
  const preferred = ranged ? 280 : 116;
  const direction = distance > preferred + 8 ? toward : distance < preferred - 25 && !cornered ? -toward : 0;
  return { direction, jump: !ranged && distance < 185 && opp.y < ARENA.ground - 115 && opp.vy <= 1 };
}
