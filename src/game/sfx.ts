// Sound recipes for combat and interface cues, built only from oscillators and filtered noise.
//
// Target feel: modern anime-action games (Zenless Zone Zero and similar). Every cue is a stack of
// short layers instead of one beep:
//   transient  a band-passed noise crack and a tiny square chirp give the hit its edge
//   body       a sine that falls in pitch (a kick); heavier hits go lower and last longer
//   crunch     a distorted saw closing a low-pass, for mid-range weight
//   air/tail   bright noise, metallic partials, sub boom on the big ones
// Characters keep their instrument: keys (pyro) sparkle, guitars (shadow/gale) pluck and slice,
// bass (bastion) is all sub, drums (iron) are kicks, toms and cymbals.
//
// Recipes never touch Web Audio themselves. They call Synth, which GameAudio implements, so they can
// be counted in unit tests and rendered offline for auditioning.
import type { CharacterId } from '../../shared/types';

/** Filter tuples are [from, to?, q?]: the cutoff glides from -> to over the note. */
export interface ToneOptions {
  attack?: number; pan?: number; drive?: number; detune?: number;
  lp?: readonly number[]; hp?: readonly number[]; fm?: readonly [number, number];
}
export interface HissOptions { type?: BiquadFilterType; to?: number; q?: number; attack?: number; pan?: number }
export interface Synth {
  tone(note: number, at: number, duration: number, level: number, type: OscillatorType, endNote: number, options?: ToneOptions): void;
  hiss(at: number, duration: number, level: number, frequency: number, options?: HissOptions): void;
  rand(): number;
}
export interface HitInfo { damage: number; armored?: boolean; ultimate?: boolean; stolen?: number; impact?: boolean }
type SkillSlot = 's0' | 's1' | 's2' | 'ult' | 'punch';

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

/** Binds a recipe to a start time and a stereo position so layers read as offsets in seconds. */
function layers(s: Synth, at: number, pan: number) {
  return {
    tone: (note: number, dt: number, duration: number, level: number, type: OscillatorType = 'sine', end: number = note, options: ToneOptions = {}) =>
      s.tone(note, at + dt, duration, level, type, end, { pan, ...options }),
    hiss: (dt: number, duration: number, level: number, frequency: number, options: HissOptions = {}) =>
      s.hiss(at + dt, duration, level, frequency, { pan, ...options }),
  };
}

/* ---------------- impacts ---------------- */

export function hit(s: Synth, at: number, e: HitInfo, pan: number) {
  const v = layers(s, at, pan);
  const j = (s.rand() - 0.5) * 2; // per-hit variation so repeated hits do not machine-gun
  if (e.stolen) {
    // energy drain: a fast upward zip
    v.hiss(0, 0.24, 0.1, 800, { type: 'bandpass', to: 5200, q: 2, attack: 0.03 });
    v.tone(70, 0, 0.26, 0.09, 'sine', 100, { fm: [2, 0.5] });
    return;
  }
  const w = e.armored ? 0.35 : clamp(e.damage / 38, 0, 1); // 0 light .. 1 devastating
  // snap: the band-passed crack is what small phone speakers actually reproduce, so it leads
  v.hiss(0, 0.028 + 0.02 * w, 0.14 + 0.1 * w, 3400 + j * 400, { type: 'bandpass', to: 1000, q: 1.0 });
  v.tone(95 + j, 0, 0.018, 0.05 + 0.025 * w, 'square', 80, { hp: [1400] });
  // punch: a distorted saw closing its filter gives every hit mid-range weight
  v.tone(66 - 6 * w + j, 0, 0.06 + 0.07 * w, 0.085 + 0.1 * w, 'sawtooth', 50 - 4 * w, { lp: [3200, 380, 2], drive: 0.7 });
  // thump: a short falling sine; only heavy hits add a real sub below
  v.tone(52 - 10 * w + j, 0, 0.08 + 0.15 * w, 0.11 + 0.13 * w, 'sine', 34 - 8 * w);
  v.hiss(0, 0.04, 0.045 + 0.025 * w, 8500, { type: 'highpass' });
  if (w > 0.3) {
    v.tone(91.4, 0, 0.12 + 0.1 * w, 0.014 + 0.01 * w, 'triangle');
    v.tone(96.6, 0.004, 0.1 + 0.06 * w, 0.012 + 0.008 * w, 'triangle');
  }
  if (w > 0.6 || e.impact) {
    v.tone(35, 0, 0.46, 0.15, 'sine', 22);
    v.hiss(0.01, 0.36, 0.1, 1600, { type: 'lowpass', to: 140, q: 0.8 });
    v.hiss(0, 0.09, 0.12, 2600, { type: 'bandpass', to: 700, q: 1.2 });
    v.tone(62, 0, 0.16, 0.09, 'sawtooth', 45, { lp: [2800, 300, 2], drive: 0.8 });
  }
  if (e.ultimate) {
    v.hiss(0.02, 0.55, 0.045, 5200, { type: 'bandpass', to: 1700, q: 3.5, attack: 0.02 });
    v.tone(88, 0.02, 0.3, 0.03, 'sine', 91);
  }
  if (e.armored) {
    // shield clang
    v.tone(86.5, 0, 0.26, 0.05, 'square', 86, { hp: [2200] });
    v.tone(92.3, 0, 0.2, 0.035, 'square', 92, { hp: [2400] });
    v.hiss(0, 0.06, 0.06, 5600, { type: 'bandpass', q: 7 });
  }
}

/** Rising pings stacked on consecutive hits by the same fighter. n is the hit count (2 and up). */
export function comboPing(s: Synth, at: number, n: number, pan: number) {
  const v = layers(s, at, pan);
  const steps = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
  const note = 88 + steps[clamp(n - 2, 0, steps.length - 1)];
  v.tone(note, 0, 0.1, 0.04);
  v.tone(note + 12, 0.015, 0.08, 0.02);
  v.hiss(0, 0.012, 0.02, 9000, { type: 'highpass' });
}

/* ---------------- swings and casts ---------------- */

export function swing(s: Synth, at: number, id: CharacterId, pan: number) {
  const v = layers(s, at, pan);
  const j = s.rand() * 0.12;
  switch (id) {
    case 'bastion': // heavy low sweep
      v.hiss(0, 0.13, 0.1, 700, { type: 'bandpass', to: 260, q: 1, attack: 0.02 });
      v.tone(45, 0, 0.12, 0.12, 'sine', 36);
      break;
    case 'iron': // stick whip
      v.hiss(0, 0.075, 0.08, 7000, { type: 'highpass', to: 3000 });
      v.tone(76 + j * 8, 0, 0.07, 0.05, 'triangle', 64);
      break;
    case 'pyro': // airy whoosh and a keys blip
      v.hiss(0, 0.1, 0.075, 900 + j * 1000, { type: 'bandpass', to: 3400, q: 1.4, attack: 0.02 });
      v.tone(88, 0.01, 0.06, 0.035, 'square', 95, { hp: [900] });
      break;
    default: // guitars: pick scrape
      v.hiss(0, 0.1, 0.07, 900 + j * 1000, { type: 'bandpass', to: 3400, q: 1.4, attack: 0.02 });
      v.tone(64, 0, 0.09, 0.05, 'sawtooth', 67, { lp: [3200, 900, 1], drive: 0.3 });
  }
}

export function cast(s: Synth, at: number, id: CharacterId, slot: SkillSlot, pan: number) {
  const v = layers(s, at, pan);
  const heavy = slot === 's2' ? 1.1 : 1;
  v.hiss(0, 0.26, 0.04 * heavy, 400, { type: 'bandpass', to: 3800, q: 1.6, attack: 0.05 });
  v.tone(52, 0, 0.22, 0.05, 'sawtooth', 64, { lp: [600, 3200, 1.5], attack: 0.1 });
  switch (id) {
    case 'pyro': // key arpeggio
      [88, 92, 95, 100].forEach((n, i) => v.tone(n, 0.06 + i * 0.045, 0.09, 0.028));
      break;
    case 'shadow': // power-chord pluck
      v.tone(59, 0.06, 0.3, 0.045, 'sawtooth', 59, { lp: [3600, 500, 2], drive: 0.5 });
      v.tone(66, 0.06, 0.26, 0.025, 'sawtooth', 66, { lp: [3600, 500, 2], drive: 0.5 });
      break;
    case 'gale': // twang
      v.tone(66, 0.06, 0.28, 0.04, 'triangle', 65.6, { fm: [2, 0.8] });
      v.hiss(0.06, 0.05, 0.03, 5000, { type: 'bandpass', q: 5 });
      break;
    case 'bastion': // sub swell
      v.tone(33, 0, 0.3, 0.16, 'sine', 31);
      v.hiss(0, 0.3, 0.06, 300, { type: 'lowpass', to: 120 });
      break;
    case 'iron': // tom roll
      [52, 48, 44].forEach((n, i) => v.tone(n, 0.06 + i * 0.06, 0.11, 0.13, 'sine', n - 10));
      break;
  }
}

export function ultCast(s: Synth, at: number, pan: number) {
  const v = layers(s, at, pan);
  // riser
  v.hiss(0, 0.4, 0.11, 300, { type: 'highpass', to: 9000, attack: 0.34 });
  v.tone(30, 0, 0.42, 0.18, 'sine', 54, { attack: 0.3 });
  v.tone(60, 0, 0.4, 0.05, 'sawtooth', 84, { lp: [500, 6000, 1], attack: 0.32 });
  v.tone(60.2, 0, 0.4, 0.05, 'sawtooth', 84.2, { lp: [500, 6000, 1], attack: 0.32 });
  // drop
  v.tone(40, 0.36, 0.5, 0.3, 'sine', 24);
  v.hiss(0.36, 0.4, 0.13, 2400, { type: 'lowpass', to: 200 });
  v.hiss(0.36, 0.05, 0.1, 6000, { type: 'highpass' });
  [76, 83, 88, 95].forEach((n, i) => v.tone(n, 0.36 + i * 0.02, 0.7, 0.025, 'triangle'));
}

/* ---------------- signature moments (the combat core's `sfx` events) ---------------- */

type Recipe = (v: ReturnType<typeof layers>) => void;
const SIGNATURES: Record<string, Recipe> = {
  bastion_s0_stomp: (v) => {
    v.tone(40, 0, 0.34, 0.26, 'sine', 22);
    v.tone(60, 0, 0.14, 0.12, 'sawtooth', 44, { lp: [2800, 300, 2], drive: 0.7 });
    v.hiss(0, 0.08, 0.14, 3000, { type: 'bandpass', q: 1.2 });
    v.hiss(0, 0.3, 0.12, 1200, { type: 'lowpass', to: 120, q: 0.8 });
    v.hiss(0, 0.05, 0.1, 5000, { type: 'highpass' });
    v.hiss(0.03, 0.22, 0.05, 700, { type: 'bandpass', to: 300, q: 1.4 });
    v.tone(86, 0, 0.2, 0.03, 'triangle');
  },
  gale_s2_cut: (v) => {
    v.hiss(0, 0.1, 0.11, 8500, { type: 'highpass', to: 4200 });
    v.hiss(0, 0.08, 0.07, 2200, { type: 'bandpass', q: 2 });
    v.tone(103, 0, 0.14, 0.045);
    v.tone(108.3, 0.005, 0.12, 0.035);
  },
  gale_ult_bolt: (v) => {
    v.hiss(0, 0.2, 0.12, 3200, { type: 'bandpass', to: 6400, q: 0.9 });
    v.tone(100, 0, 0.16, 0.07, 'sawtooth', 55, { drive: 0.9, hp: [600] });
    v.hiss(0.02, 0.5, 0.1, 500, { type: 'lowpass', to: 90, q: 0.9 });
    v.tone(36, 0, 0.5, 0.2, 'sine', 24);
  },
  iron_s1_smash: (v) => {
    v.tone(50, 0, 0.2, 0.28, 'sine', 32);
    v.hiss(0, 0.14, 0.17, 2000, { type: 'bandpass', q: 0.9 });
    v.hiss(0, 0.5, 0.08, 6500, { type: 'highpass' });
    v.tone(55, 0, 0.1, 0.07, 'triangle', 45);
  },
  iron_ult_slam: (v) => {
    v.tone(44, 0, 0.35, 0.34, 'sine', 26);
    v.tone(52, 0.04, 0.2, 0.2, 'sine', 34);
    v.hiss(0, 0.2, 0.12, 2200, { type: 'bandpass', q: 1 });
    v.hiss(0, 0.9, 0.1, 6000, { type: 'highpass' });
  },
  shadow_s1_slash: (v) => {
    v.hiss(0, 0.13, 0.11, 6500, { type: 'highpass', to: 2800 });
    v.hiss(0, 0.12, 0.07, 1000, { type: 'bandpass', to: 2400, q: 1.2 });
    v.tone(103, 0, 0.3, 0.035);
    v.tone(108.4, 0, 0.26, 0.03);
  },
  shadow_ult_cut: (v) => {
    v.hiss(0, 0.15, 0.12, 6500, { type: 'highpass', to: 2400 });
    v.hiss(0.05, 0.13, 0.1, 7000, { type: 'highpass', to: 3000 });
    v.tone(103, 0, 0.34, 0.04);
    v.tone(108.4, 0.05, 0.3, 0.035);
    v.tone(42, 0, 0.2, 0.18, 'sine', 30);
  },
  pyro_s1_shot: (v) => {
    v.tone(100, 0, 0.12, 0.06, 'square', 72, { lp: [6000, 1500] });
    v.tone(108, 0, 0.1, 0.035, 'sine', 96);
    v.hiss(0, 0.06, 0.05, 6000, { type: 'highpass' });
  },
  pyro_s2_wave: (v) => {
    v.hiss(0, 0.36, 0.14, 300, { type: 'lowpass', to: 2500, attack: 0.1 });
    v.hiss(0, 0.3, 0.08, 600, { type: 'bandpass', to: 3000, q: 1.4, attack: 0.1 });
    v.tone(40, 0, 0.36, 0.16, 'sine', 52, { attack: 0.1 });
  },
  pyro_ult_fall: (v) => {
    v.tone(98, 0, 0.8, 0.045, 'sine', 45, { fm: [2, 0.2] });
    v.hiss(0, 0.8, 0.04, 6000, { type: 'highpass', to: 900 });
  },
  pyro_ult_boom: (v) => {
    v.tone(36, 0, 1.0, 0.28, 'sine', 18);
    v.tone(60, 0, 0.4, 0.1, 'sawtooth', 40, { lp: [2500, 200, 2], drive: 0.6 });
    v.hiss(0, 0.6, 0.12, 1800, { type: 'bandpass', to: 400, q: 0.8 });
    v.hiss(0, 1.0, 0.18, 2400, { type: 'lowpass', to: 70, q: 0.8 });
    v.hiss(0, 0.08, 0.15, 6000, { type: 'highpass' });
    [76, 83, 88].forEach((n, i) => v.tone(n, 0.02 + i * 0.03, 0.8, 0.025, 'triangle'));
  },
  bastion_s1_shot: (v) => {
    v.tone(45, 0, 0.3, 0.26, 'sine', 28);
    v.tone(58, 0, 0.12, 0.1, 'sawtooth', 42, { lp: [2600, 300, 2], drive: 0.7 });
    v.hiss(0, 0.1, 0.16, 2200, { type: 'bandpass', q: 1 });
    v.hiss(0, 0.25, 0.12, 1500, { type: 'bandpass', to: 300, q: 1 });
    v.hiss(0, 0.03, 0.12, 5200, { type: 'highpass' });
  },
  bastion_s2_bash: (v) => {
    v.tone(42, 0, 0.2, 0.3, 'sine', 30);
    v.tone(84, 0, 0.22, 0.08, 'square', 83, { hp: [1800] });
    v.hiss(0, 0.08, 0.16, 3000, { type: 'bandpass', q: 2 });
  },
  bastion_ult_quake: (v) => {
    v.tone(28, 0, 1.0, 0.26, 'sine', 22);
    v.tone(52, 0, 0.5, 0.1, 'sawtooth', 36, { lp: [800, 150, 1], drive: 0.5 });
    v.hiss(0, 1.0, 0.16, 260, { type: 'lowpass', to: 90 });
    v.hiss(0, 0.9, 0.14, 900, { type: 'bandpass', to: 200, q: 1 });
    [0.05, 0.2, 0.4].forEach((d) => v.hiss(d, 0.07, 0.2, 2000, { type: 'bandpass', q: 2 }));
  },
};
export const hasSignature = (id: string) => Object.hasOwn(SIGNATURES, id);
export function signature(s: Synth, at: number, id: string, pan: number) {
  const recipe = SIGNATURES[id];
  if (recipe) recipe(layers(s, at, pan));
}

/* ---------------- match flow ---------------- */

export function ko(s: Synth, at: number, pan: number) {
  const v = layers(s, at, pan);
  v.tone(38, 0, 0.9, 0.27, 'sine', 20);
  v.tone(52, 0, 0.35, 0.18, 'sine', 30);
  v.tone(55, 0, 0.5, 0.1, 'sawtooth', 36, { lp: [2500, 200, 2], drive: 0.6 });
  v.hiss(0, 0.7, 0.16, 2600, { type: 'lowpass', to: 90, q: 0.8 });
  v.hiss(0, 0.08, 0.14, 6500, { type: 'highpass' });
  [0, 0.045, 0.1].forEach((d, i) => v.hiss(d, 0.09 - i * 0.015, 0.07, 7800 - i * 900, { type: 'bandpass', q: 3 })); // glass
  v.tone(67, 0.02, 0.85, 0.08, 'sawtooth', 28, { lp: [3000, 160, 1], drive: 0.4 }); // tape-stop sag
  v.tone(91, 0.1, 0.9, 0.02);
}
export function matchEnd(s: Synth, at: number) {
  const v = layers(s, at, 0);
  v.tone(76, 0, 0.6, 0.055, 'sawtooth', 52, { lp: [3500, 300, 1] });
  [88, 95].forEach((n, i) => v.tone(n, 0.1 + i * 0.08, 0.5, 0.035, 'triangle'));
  v.hiss(0, 0.35, 0.04, 6500, { type: 'highpass', to: 2000 });
}
export function stinger(s: Synth, at: number, cue: 'round1' | 'fight') {
  const v = layers(s, at, 0);
  if (cue === 'round1') {
    v.hiss(0, 0.5, 0.08, 500, { type: 'bandpass', to: 5000, q: 1.2, attack: 0.4 });
    v.tone(45, 0, 0.5, 0.14, 'sawtooth', 69, { lp: [300, 3000], attack: 0.4 });
    v.tone(40, 0.45, 0.3, 0.2, 'sine', 30);
  } else {
    v.tone(40, 0, 0.5, 0.3, 'sine', 26);
    v.hiss(0, 0.3, 0.12, 2800, { type: 'lowpass', to: 150 });
    v.hiss(0, 0.05, 0.12, 6500, { type: 'highpass' });
    [71, 76, 83].forEach((n) => v.tone(n, 0, 0.25, 0.04, 'square', n, { lp: [3500, 900] }));
  }
}
export function ultReady(s: Synth, at: number) {
  const v = layers(s, at, 0);
  [84, 91, 96, 103].forEach((n, i) => v.tone(n, i * 0.05, 0.22 - i * 0.02, 0.045, 'triangle', n, { fm: [3, 0.3] }));
  v.hiss(0, 0.35, 0.035, 6500, { type: 'highpass', to: 11000, attack: 0.15 });
  v.tone(48, 0, 0.3, 0.08, 'sine', 55);
}

/* ---------------- interface ---------------- */

const CONFIRM = ['start', 'ready', 'rematch', 'join', 'create'];
const BACK = ['back', 'pause', 'quit'];
const ACTION = ['punch', 'special', 'skill1', 'skill2', 'ult'];

/** Short and dry on purpose: button feedback must never cover combat or speech. */
export function ui(s: Synth, at: number, cue: string) {
  const v = layers(s, at, 0);
  const tick = (level = 0.045) => v.hiss(0, 0.014, level, 6200, { type: 'highpass' });
  if (cue === 'ultReady') return ultReady(s, at);
  if (cue === 'count') {
    tick(0.04);
    return v.tone(88, 0, 0.08, 0.06, 'square', 88, { hp: [1200], lp: [4000] });
  }
  if (ACTION.includes(cue)) {
    tick(0.06);
    return v.tone(cue === 'ult' ? 79 : cue === 'punch' ? 84 : 90, 0, 0.04, 0.06, 'triangle');
  }
  if (BACK.includes(cue)) {
    tick();
    v.tone(88, 0, 0.05, 0.05, 'square', 74, { hp: [500], lp: [3500] });
    return v.tone(55, 0, 0.05, 0.1, 'sine', 45);
  }
  if (CONFIRM.includes(cue)) {
    tick(0.05);
    v.tone(88, 0, 0.045, 0.05, 'square', 88, { hp: [700], lp: [5000] });
    v.tone(95, 0.045, 0.055, 0.055, 'square', 100, { hp: [700], lp: [5200] });
    v.tone(52, 0, 0.055, 0.14, 'sine', 40);
    return v.hiss(0, 0.22, 0.045, 900, { type: 'bandpass', to: 6000, q: 1.2, attack: 0.06 });
  }
  tick();
  v.tone(91, 0, 0.04, 0.05, 'square', 98, { hp: [900], lp: [5200] });
  v.tone(52, 0, 0.055, 0.1, 'sine', 44);
}
