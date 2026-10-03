import type { Seat } from '../../shared/types';

export type Point = [number, number];
export interface EmitterOptions {
  dir?: number; spread?: number; jx?: number; jy?: number; g?: number; size?: number;
  l0?: number; l1?: number; drag?: number; s0?: number; s1?: number; sy?: number;
  vy?: number; v0?: number; v1?: number; up?: number; vx?: number;
}
export interface PrimitiveOptions {
  ry?: number; w?: number; front?: boolean; a?: number; ease?: string;
  n?: number; hi?: string; rot?: number; inner?: number; k?: number; tilt?: number;
  jitter?: number; seg?: number; branches?: number; grow?: number; spin?: number;
  glyphs?: number; hold?: number; dir?: number;
}
export interface TextOptions {
  color?: string; size?: number; life?: number; vy?: number; vx?: number; edge?: string; pop?: number;
}
interface ParticleBase {
  x: number; y: number; vx: number; vy: number; life: number; size: number; color: string;
  add?: boolean; homeId?: Seat | null;
}
type ParticleShape = { kind: 'petal'; sway: number }
  | { kind: 'spark' | 'glow' | 'star' | 'dust' | 'note' | 'coin' | 'shard' };
interface ParticlePhysics { rot: number; vr: number; g: number; drag: number; size1: number }
export type ParticleSpec = ParticleBase & ParticleShape & Partial<ParticlePhysics>;
export type Particle = ParticleBase & ParticleShape & ParticlePhysics & { max: number };
interface ItemBase { life: number; color: string; front?: boolean; delay?: number }
type ItemShape =
  | { t: 'ring'; x: number; y: number; r0: number; r1: number; ry: number; w: number; a: number; ease: string }
  | { t: 'burst'; x: number; y: number; r: number; n: number; hi: string; rot: number; jit: number[]; inner: number }
  | { t: 'slash'; x: number; y: number; f: number; R: number; a0: number; a1: number; hi: string; k: number; tilt: number }
  | { t: 'bolt'; main: Point[]; branches: Point[][]; hi: string; w: number }
  | { t: 'pillar'; x: number; y: number; w: number; h: number; hi: string; grow: number }
  | { t: 'circle'; x: number; y: number; r: number; ry: number; spin: number; glyphs: number; hold: number }
  | { t: 'crack'; pts: Point[]; forks: [Point, Point][] }
  | { t: 'brackets' | 'spike'; x: number; y: number; w: number; h: number }
  | { t: 'string'; x: number; y0: number; y1: number; sway: number }
  // flare: white-hot core with an anamorphic streak; rays: tapered radial impact lines (lens = per-ray length factor)
  | { t: 'flare'; x: number; y: number; r: number; rot: number; hi: string }
  | { t: 'rays'; x: number; y: number; r0: number; r1: number; w: number; hi: string; angles: number[]; lens: number[] };
export type ItemSpec = ItemBase & ItemShape;
export type Item = ItemSpec & { max: number; age: number };
export interface Flash { color: string; a: number; life: number; max: number }
export interface SpeedLines { color: string; life: number; max: number; x: number; y: number; seed: number }
export interface Ghost { canvas: HTMLCanvasElement; x: number; y: number; facing: number; life: number; max: number; a: number }
export interface FloatingText { x: number; y: number; str: string; color: string; size: number; life: number; max: number; vy: number; vx: number; edge: string; pop: number }
