// The same input, state and event contracts are used by simulation, H5 and rooms.
export const CHARACTER_IDS = ['pyro', 'shadow', 'gale', 'bastion', 'iron'] as const;
export type CharacterId = typeof CHARACTER_IDS[number];
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Mode = 'pve' | 'pvp';
export type Seat = 0 | 1;
export type Action = 'up' | 'punch' | 'special' | 'skill1' | 'skill2' | 'ult';
export type AttackAction = Exclude<Action, 'up'>;
export type SkillSlot = 'punch' | 's0' | 's1' | 's2' | 'ult';
export type SkillActionSlot = Exclude<SkillSlot, 'punch'>;
export type SkillMove = `${CharacterId}_${SkillActionSlot}`;
export type Input = Record<Action | 'left' | 'right' | 'down', boolean>;
export type FighterState = 'idle' | 'walk' | 'jump' | 'punch' | 'skill' | 'stun' | 'dead';
export type HitKind = 'punch' | 'skill' | 'projectile' | 'counter';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Move { name: string; hint?: string; detail?: string; cd?: number; cost?: number }
export interface PunchMove extends Move {
  dmg: number; kb: number; stun: number; reach: number;
  startup: number; active: number; recover: number;
}
export interface CooldownMove extends Move { cd: number }
export interface UltimateMove extends Move { cost: number }
export interface Character {
  id: CharacterId; name: string; tag: string; color: string; accent: string;
  thick: number; hp: number; speed: number; jump: number; airJumps: number;
  punch: PunchMove; s0: CooldownMove; s1: CooldownMove; s2: CooldownMove; ult: UltimateMove;
}
export interface DifficultyConfig {
  label: string; miss: number; skill: number; ult: number; aggro: number;
  jump: number; think: number; precision: number;
}
export interface AiProfile { config: DifficultyConfig; rank: number; tactics: number }
export interface Hit {
  dmg: number; kb: number; stun: number; sfx?: string; id?: string;
  kind?: HitKind; empowered?: number; ultimate?: boolean;
}
export interface HitSpec extends Hit { w: number; h: number; yOff: number; xOff?: number }
export interface AttackBox extends Rect { spec: Hit; kind: HitKind }
export interface FighterSnapshot {
  id: CharacterId; seat: Seat; x: number; y: number; vx: number; vy: number;
  facing: number; hp: number; maxHp: number; mp: number; maxMp: number;
  state: FighterState; stateT: number; anim: number; walkPhase: number; dead: boolean;
  cd0: number; cd1: number; cd2: number; skillMove: SkillMove | null;
  hitFlash: number; invuln: number; armor: number; win?: boolean;
  stepReady: boolean; airJumps: number; attackHit: boolean; hitOn: boolean;
  hitSpec: HitSpec | null; isCpu: boolean; dashT: number; lockX: number; heavyT: number;
  stunMax?: number;
}
export type CombatEventKind = 'attack' | 'skill' | 'hit' | 'ko' | 'impact' | 'sfx' | 'match-end';
export interface CombatEvent {
  seq: number; frame: number; kind: CombatEventKind; actor: Seat | null; id: string;
  x: number; y: number; slot?: SkillSlot; target?: Seat;
  damage?: number; armored?: boolean; ultimate?: boolean; blocked?: boolean;
  stolen?: number; radius?: number; winner?: Seat | null; reason?: MatchResult['reason'];
}
export type CombatEventDetail = Partial<Omit<CombatEvent, 'seq' | 'frame' | 'kind' | 'actor' | 'id'>>;
export interface MatchResult { winner: Seat | null; reason: 'timeout' | 'double-ko' | 'ko' }
export interface Projectile<Owner = Seat | null> {
  type: 'curtain' | 'note' | 'wave'; owner: Owner;
  x: number; y: number; vx: number; vy: number; life: number; color: string;
  dmg: number; kb: number; stun: number; r: number; sfx: string; facing?: number;
}
interface HazardState<Owner> {
  owner: Owner;
  x: number; y: number; delay: number; life: number; color: string; hit: boolean;
  dmg: number; kb: number; stun: number; sfx?: string; vy?: number; scale?: number; radius?: number;
}
export type Hazard<Owner = Seat | null> = HazardState<Owner> & (
  { type: 'skillShock'; radius: number } | { type: 'meteor' | 'boom' | 'pillar' | 'shock' }
);
export interface Snapshot {
  frame: number; timeLeft: number; intro: number;
  fighters: FighterSnapshot[]; events: CombatEvent[]; result: MatchResult | null;
  projectiles: Projectile[]; hazards: Hazard[];
}
export interface WorldOptions {
  left?: CharacterId; right?: CharacterId; mode?: Mode; difficulty?: Difficulty;
  /** PVE ladder only. Omit for the unchanged balance-simulation controllers. */
  ladderLevel?: number;
  seed?: number; duration?: number; introFrames?: number; autoplay?: boolean;
  /** Offline diagnostics: difficulty of the autoplay-controlled left seat. */
  autoplayDifficulty?: Difficulty;
}
export interface CombatWorld {
  step(inputs?: readonly Partial<Input>[]): boolean;
  snapshot(): Snapshot;
  getResult(): MatchResult | null;
  fighters: FighterSnapshot[];
}
