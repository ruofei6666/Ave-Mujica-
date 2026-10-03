import type { CharacterId, CombatEvent, FighterSnapshot, Hazard, Projectile, SkillActionSlot, SkillMove, Snapshot } from '../../shared/types';
import type { EmitterOptions, Flash, FloatingText, Ghost, Item, ItemSpec, Particle, ParticleSpec, Point, PrimitiveOptions, SpeedLines, TextOptions } from './fx-types';
import { context2d } from './canvas';
import { ARENA } from '../../shared/arena';
import A from './art';
const TAU = Math.PI * 2;
const W = ARENA.width, H = ARENA.height, GROUND = ARENA.ground;
const CS = 0.9; // 角色在场上的绘制缩放
// 角色精灵缓冲：以脚底为原点，单位为角色坐标（含乐器挥舞与倒地姿势）
const SPRITE = { ox: 220, oy: 245, w: 440, h: 290 };
const { clamp, lerp, ease } = A;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[(Math.random() * list.length) | 0];

// 角色特效配色：main 主色 / hi 高光 / alt 副色
const TONES = {
  pyro: { main: '#7ea4f2', hi: '#e6efff', alt: '#b48cff', dark: '#243a78' },
  shadow: { main: '#f2c35c', hi: '#fff4cf', alt: '#a678ee', dark: '#6b4a10' },
  gale: { main: '#7fe0a4', hi: '#effff0', alt: '#f3dc7a', dark: '#17603a' },
  bastion: { main: '#53c5e0', hi: '#dff8ff', alt: '#ff4d6a', dark: '#0f4a5c' },
  iron: { main: '#ff7fc0', hi: '#fff0f8', alt: '#b58bff', dark: '#8a2560' },
};
const tone = (id: CharacterId) => TONES[id] || TONES.shadow;

/* ---------------- 发光精灵 ---------------- */
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string) {
  let s = glowCache.get(color);
  if (!s) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = context2d(cv);
    const [r, gg, b] = A.rgbOf(color);
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.16, `rgba(${r},${gg},${b},.95)`);
    rg.addColorStop(0.5, `rgba(${r},${gg},${b},.32)`);
    rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    glowCache.set(color, cv); s = cv;
  }
  return s;
}
function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number) {
  if (a <= 0.01 || r <= 0.5) return;
  c.globalAlpha = a > 1 ? 1 : a;
  c.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
}

/* ---------------- 形状工具 ---------------- */
function starPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, rot: number, inner: number, jit?: readonly number[]) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n;
    const rr = i % 2 ? r * inner : r * (jit ? 0.72 + 0.28 * jit[(i >> 1) % jit.length] : 1);
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}
function crescent(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, a0: number, a1: number, k: number) {
  // 沿外圆弧从 a0 到 a1，再以内凹曲线回到起点，k 越小越粗
  const mid = (a0 + a1) / 2;
  c.beginPath();
  c.arc(cx, cy, R, a0, a1, a1 < a0);
  c.quadraticCurveTo(cx + Math.cos(mid) * R * k, cy + Math.sin(mid) * R * k, cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
  c.closePath();
}
function note(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  c.save(); c.translate(x, y); c.rotate(rot || 0);
  c.beginPath(); c.ellipse(-s * 0.22, s * 0.3, s * 0.36, s * 0.24, -0.4, 0, TAU); c.fill();
  c.fillRect(s * 0.06, -s * 0.72, s * 0.11, s * 1.0);
  c.beginPath(); c.moveTo(s * 0.06, -s * 0.72); c.quadraticCurveTo(s * 0.7, -s * 0.5, s * 0.5, -s * 0.05); c.quadraticCurveTo(s * 0.46, -s * 0.4, s * 0.06, -s * 0.46); c.fill();
  c.restore();
}
function bolt(x0: number, y0: number, x1: number, y1: number, jitter: number, seg: number) {
  const pts: Point[] = [[x0, y0]];
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  for (let i = 1; i < seg; i++) {
    const t = i / seg, o = rnd(-jitter, jitter) * (1 - Math.abs(t - 0.5) * 0.6);
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}

/* ---------------- 特效引擎 ---------------- */
class Fx {
  declare parts: Particle[];
  declare items: Item[];
  declare texts: FloatingText[];
  declare ghosts: Ghost[];
  declare reduced: boolean;
  declare shakeAmp: number;
  declare shakeT: number;
  declare zoomAmt: number;
  declare zoomLife: number;
  declare zoomMax: number;
  declare zoomX: number;
  declare zoomY: number;
  declare zoomLen: number;
  declare flashes: Flash[];
  declare lines: SpeedLines | null;
  declare vig: Flash | null;
  /** One-to-four-frame color inversion: the "impact frame" anime uses for ultimates and finishers. */
  declare inv: { life: number; max: number } | null;
  declare now: number;
  declare acc: Record<string, number>;
  declare density: number | undefined;
  declare spriteOf: ((fighter: FighterSnapshot) => HTMLCanvasElement | null) | undefined;

  constructor() {
    this.parts = [];
    this.items = [];
    this.texts = [];
    this.ghosts = [];
    this.reduced = false;
    this.shakeAmp = 0; this.shakeT = 0;
    this.zoomAmt = 0; this.zoomLife = 0; this.zoomMax = 1; this.zoomX = W / 2; this.zoomY = H / 2;
    this.flashes = [];
    this.lines = null;
    this.vig = null;
    this.inv = null;
    this.now = 0;
    this.acc = {};
  }
  reset() { this.parts.length = 0; this.items.length = 0; this.texts.length = 0; this.ghosts.length = 0; this.flashes.length = 0; this.lines = null; this.vig = null; this.inv = null; this.shakeAmp = 0; this.zoomAmt = 0; this.acc = {}; }
  get count() { return (this.reduced ? 0.35 : 1) * (this.density || 1); }

  /* ---- 屏幕级 ---- */
  shake(a: number) { if (this.reduced) return; this.shakeAmp = Math.min(18, Math.max(this.shakeAmp, a)); this.shakeT = 1; }
  flash(color: string, a: number, life: number) { if (this.reduced) return; this.flashes.push({ color, a, life, max: life }); if (this.flashes.length > 6) this.flashes.shift(); }
  zoom(amount: number, life: number, x: number, y: number) {
    if (this.reduced) return;
    // a small punch-in must not cut a bigger, longer zoom short
    const running = this.zoomLife > 0 ? this.zoomAmt * Math.min(1, this.zoomLife / this.zoomLen) : 0;
    if (amount < running) return;
    this.zoomAmt = amount; this.zoomMax = amount; this.zoomLife = life; this.zoomLen = life; this.zoomX = x; this.zoomY = y; }
  speedLines(color: string, life: number, x: number, y: number) { if (this.reduced) return; this.lines = { color, life, max: life, x, y, seed: Math.random() * 100 }; }
  vignette(color: string, a: number, life: number) { if (this.reduced) return; this.vig = { color, a, life, max: life }; }
  invert(life: number) {
    if (this.reduced) return;
    if (this.now - (this.acc.inv ?? -9999) < 1200) return; // never twice inside 1.2 s
    this.acc.inv = this.now; this.inv = { life, max: life };
  }
  camera() {
    // 返回 { sx, sy, z, zx, zy } 供渲染器应用
    let sx = 0, sy = 0;
    if (this.shakeAmp > 0.2 && !this.reduced) {
      const k = this.shakeAmp;
      sx = (Math.random() * 2 - 1) * k; sy = (Math.random() * 2 - 1) * k * 0.8;
    }
    const z = 1 + (this.zoomLife > 0 ? this.zoomAmt * Math.sin(Math.min(1, this.zoomLife / this.zoomLen) * Math.PI * 0.5) : 0);
    return { sx, sy, z, zx: this.zoomX, zy: this.zoomY };
  }

  /* ---- 基础发射器 ---- */
  add(p: ParticleSpec) {
    if (this.parts.length > 760) this.parts.splice(0, 40);
    const particle: Particle = Object.assign(p, { max: p.life, rot: p.rot || 0, vr: p.vr || 0, g: p.g || 0,
      drag: p.drag === undefined ? 1 : p.drag, size1: p.size1 === undefined ? p.size * 0.2 : p.size1 });
    this.parts.push(particle); return particle;
  }
  sparks(x: number, y: number, n: number, v0: number, v1: number, color: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-(o.spread || 1), o.spread || 1) : rnd(0, TAU), v = rnd(v0, v1);
      this.add({ kind: 'spark', add: true, x: x + rnd(-(o.jx || 0), o.jx || 0), y: y + rnd(-(o.jy || 0), o.jy || 0), vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.g === undefined ? 0.12 : o.g, drag: 0.93, life: rnd(o.l0 || 14, o.l1 || 26), size: rnd(1.6, 3.2) * (o.size || 1), color });
    }
  }
  glows(x: number, y: number, n: number, v0: number, v1: number, color: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-(o.spread || 1), o.spread || 1) : rnd(0, TAU), v = rnd(v0, v1);
      this.add({ kind: 'glow', add: true, x: x + rnd(-(o.jx || 0), o.jx || 0), y: y + rnd(-(o.jy || 0), o.jy || 0), vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.g || 0, drag: o.drag || 0.95, life: rnd(o.l0 || 18, o.l1 || 34), size: rnd(o.s0 || 5, o.s1 || 11), size1: 0, color });
    }
  }
  twinkles(x: number, y: number, n: number, spread: number, color: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'star', add: true, x: x + rnd(-spread, spread), y: y + rnd(-(o.sy || spread), o.sy || spread), vx: rnd(-0.4, 0.4), vy: o.vy === undefined ? rnd(-1.4, -0.3) : o.vy, g: 0, drag: 0.98, life: rnd(o.l0 || 24, o.l1 || 46), size: rnd(o.s0 || 4, o.s1 || 9), size1: 0, rot: rnd(0, 1), vr: rnd(-0.06, 0.06), color });
    }
  }
  dust(x: number, y: number, n: number, color: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      const dir = o.dir === undefined ? (Math.random() < 0.5 ? -1 : 1) : o.dir;
      this.add({ kind: 'dust', x: x + rnd(-(o.jx || 10), o.jx || 10), y: y - rnd(0, 6), vx: dir * rnd(0.6, 3.4), vy: -rnd(0.2, 1.4), g: -0.01, drag: 0.94, life: rnd(22, 40), size: rnd(6, 13), size1: rnd(16, 28), color: color || '#cfc6e6' });
    }
  }
  petals(x: number, y: number, n: number, id: CharacterId, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    const def = A.CHARS[id] || A.CHARS.shadow;
    const cols = [def.flowerA, def.flowerB, def.flowerC];
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-(o.spread || 1), o.spread || 1) : rnd(0, TAU), v = rnd(o.v0 || 1, o.v1 || 4);
      this.add({ kind: 'petal', x: x + rnd(-(o.jx || 6), o.jx || 6), y: y + rnd(-(o.jy || 6), o.jy || 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v + (o.up || 0), g: o.g === undefined ? 0.04 : o.g, drag: 0.97, life: rnd(o.l0 || 40, o.l1 || 80), size: rnd(4, 7.5), size1: 0, rot: rnd(0, TAU), vr: rnd(-0.12, 0.12), color: pick(cols), sway: rnd(0, TAU) });
    }
  }
  notes(x: number, y: number, n: number, color: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'note', add: true, x: x + rnd(-(o.jx || 8), o.jx || 8), y: y + rnd(-(o.jy || 8), o.jy || 8), vx: rnd(-1.2, 1.2) + (o.vx || 0), vy: rnd(-2.2, -0.6), g: -0.01, drag: 0.98, life: rnd(34, 62), size: rnd(9, 15), size1: 0, rot: rnd(-0.5, 0.5), vr: rnd(-0.03, 0.03), color });
    }
  }
  coins(x: number, y: number, n: number) {
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'coin', x, y, vx: rnd(-3.5, 3.5), vy: -rnd(4, 9), g: 0.42, drag: 0.99, life: rnd(34, 50), size: rnd(3.4, 5), size1: 3, rot: rnd(0, TAU), vr: rnd(-0.3, 0.3), color: '#ffd978' });
    }
  }
  // 玻璃般的碎片：三角形、自带旋转与重力，每第三片用高光色
  shards(x: number, y: number, n: number, color: string, hi: string, o?: EmitterOptions) {
    o = o || {};
    n = Math.max(1, Math.round(n * this.count));
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + rnd(-(o.spread || 1.2), o.spread || 1.2) : rnd(0, TAU), v = rnd(o.v0 || 3, o.v1 || 11);
      this.add({ kind: 'shard', add: true, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, g: 0.24, drag: 0.96, life: rnd(26, 52), size: rnd(4, 10), size1: 0, rot: rnd(0, TAU), vr: rnd(-0.35, 0.35), color: i % 3 === 0 ? hi : color });
    }
  }

  /* ---- 图元：持续数帧的特效 ---- */
  item(o: ItemSpec) {
    const item: Item = Object.assign(o, { max: o.life, age: 0 });
    if (this.items.length > 90) this.items.splice(0, 10);
    this.items.push(item); return item;
  }
  ring(x: number, y: number, r0: number, r1: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    return this.item({ t: 'ring', x, y, r0, r1, ry: o.ry === undefined ? 0.26 : o.ry, w: o.w || 4, life, color, front: !!o.front, a: o.a === undefined ? 1 : o.a, ease: o.ease || 'out' });
  }
  burst(x: number, y: number, r: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    const jit = []; for (let i = 0; i < 12; i++) jit.push(Math.random());
    return this.item({ t: 'burst', x, y, r, n: o.n || 8, life, color, hi: o.hi || '#ffffff', rot: o.rot === undefined ? rnd(0, TAU) : o.rot, jit, inner: o.inner || 0.32, front: true });
  }
  slash(x: number, y: number, facing: number, R: number, a0: number, a1: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    return this.item({ t: 'slash', x, y, f: facing, R, a0, a1, life, color, hi: o.hi || '#ffffff', k: o.k || 0.62, tilt: o.tilt || 0, front: true });
  }
  bolt(x0: number, y0: number, x1: number, y1: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    const main = bolt(x0, y0, x1, y1, o.jitter || 38, o.seg || 9);
    const branches = [];
    if (!this.reduced) for (let i = 0; i < (o.branches === undefined ? 2 : o.branches); i++) {
      const k = 2 + ((Math.random() * (main.length - 4)) | 0), p = main[k];
      branches.push(bolt(p[0], p[1], p[0] + rnd(-90, 90), p[1] + rnd(30, 120), 14, 4));
    }
    return this.item({ t: 'bolt', main, branches, life, color, hi: o.hi || '#ffffff', w: o.w || 7, front: true });
  }
  pillar(x: number, y: number, w: number, h: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    return this.item({ t: 'pillar', x, y, w, h, life, color, hi: o.hi || '#ffffff', grow: o.grow === undefined ? 0.2 : o.grow, front: !!o.front });
  }
  circle(x: number, y: number, r: number, life: number, color: string, o?: PrimitiveOptions) {
    o = o || {};
    return this.item({ t: 'circle', x, y, r, life, color, ry: o.ry === undefined ? 0.24 : o.ry, spin: o.spin === undefined ? 0.04 : o.spin, glyphs: o.glyphs || 8, hold: o.hold === undefined ? 0.55 : o.hold });
  }
  crack(x: number, y: number, dir: number, len: number, life: number, color: string) {
    const pts: Point[] = [[x, y]];
    let cx = x, cy = y;
    const n = 9;
    for (let i = 1; i <= n; i++) { cx += dir * len / n; cy = y + rnd(-5, 7) * (i / n) + 2; pts.push([cx, cy]); }
    const forks: [Point, Point][] = [];
    for (let i = 2; i < n; i += 2) forks.push([pts[i], [pts[i][0] + dir * rnd(10, 26), pts[i][1] + rnd(8, 22)]]);
    return this.item({ t: 'crack', pts, forks, life, color });
  }
  brackets(x: number, y: number, w: number, h: number, life: number, color: string) { return this.item({ t: 'brackets', x, y, w, h, life, color, front: true }); }
  // 炽白闪光核心 + 横向拉丝，命中与大招的第一帧
  flare(x: number, y: number, r: number, life: number, color: string, o?: PrimitiveOptions) {
    if (this.reduced) return null;
    o = o || {};
    // front: false puts the glow behind the fighters, so big moments frame them instead of washing them out
    return this.item({ t: 'flare', x, y, r, life, color, hi: o.hi || '#ffffff', rot: o.rot === undefined ? 0 : o.rot, front: o.front === undefined ? true : o.front });
  }
  // 放射状冲击线；给定 dir 时朝命中方向的线更长
  rays(x: number, y: number, r0: number, r1: number, life: number, color: string, o?: PrimitiveOptions) {
    if (this.reduced) return null;
    o = o || {};
    const n = Math.max(6, Math.round((o.n || 10) * Math.min(1, this.count + 0.25)));
    const angles: number[] = [], lens: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.12, 0.12);
      angles.push(a);
      lens.push(rnd(0.55, 1) * (1 + 0.9 * (o.dir === undefined ? 0 : Math.max(0, Math.cos(a - o.dir)))));
    }
    return this.item({ t: 'rays', x, y, r0, r1, w: o.w || 3, life, color, hi: o.hi || color, angles, lens, front: o.front === undefined ? true : o.front });
  }
  // 残影：复制当前角色精灵并整体染色；精灵由渲染器提供（spriteOf）
  ghost(f: FighterSnapshot, life: number, color: string, a: number) {
    const src = this.spriteOf ? this.spriteOf(f) : null;
    if (!src) return;
    const g = (this.ghosts.length >= 8 ? this.ghosts.shift() : null) || { canvas: document.createElement('canvas') };
    const cv = g.canvas;
    if (cv.width !== src.width || cv.height !== src.height) { cv.width = src.width; cv.height = src.height; }
    const c = context2d(cv);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.clearRect(0, 0, cv.width, cv.height); c.drawImage(src, 0, 0);
    c.globalCompositeOperation = 'source-atop'; c.globalAlpha = 0.8; c.fillStyle = color; c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    this.ghosts.push(Object.assign(g, { x: f.x, y: f.y, facing: f.facing, life, max: life, a: a || 0.5 }));
  }
  text(x: number, y: number, str: string, o?: TextOptions) {
    o = o || {};
    if (this.texts.length > 24) this.texts.shift();
    this.texts.push({ x, y, str, color: o.color || '#ffffff', size: o.size || 26, life: o.life || 56, max: o.life || 56, vy: o.vy === undefined ? -1.1 : o.vy, vx: o.vx || 0, edge: o.edge || '#3a1b35', pop: o.pop === undefined ? 1.8 : o.pop });
  }

  /* ---------------- 事件：命中 ---------------- */
  hit(e: CombatEvent, attacker?: FighterSnapshot, target?: FighterSnapshot) {
    const aid = attacker ? attacker.id : 'shadow';
    const T = tone(aid);
    const x = e.x, y = e.y - 4;
    const dmg = Math.max(0, e.damage || 0);
    const dir = attacker && target ? (Math.sign(target.x - attacker.x) || attacker.facing || 1) : 1;
    const big = dmg >= 36 ? 3 : dmg >= 22 ? 2 : dmg >= 11 ? 1 : 0;
    if (e.armored) {
      this.burst(x, y, 30 + big * 8, 10, '#bfe6ff', { n: 6, hi: '#ffffff', inner: 0.5 });
      this.ring(x, y, 8, 46, 16, '#9fd5ff', { ry: 1, w: 3, front: true });
      this.sparks(x, y, 10, 3, 9, '#cfeaff', { dir: dir > 0 ? 0 : Math.PI, spread: 1.2 });
    } else if (dmg > 0) {
      const r = 24 + Math.min(54, dmg * 1.1), face = dir > 0 ? 0 : Math.PI;
      // layered impact: a white-hot flare and radial lines land first, then the star burst, ring and sparks
      this.flare(x, y, r * 1.25, 7 + big * 2, T.main, { hi: '#ffffff', rot: rnd(-0.35, 0.35) });
      this.rays(x, y, r * 0.45, r * (1.9 + big * 0.35), 9 + big * 2, T.hi, { n: 9 + big * 3, dir: face, w: 2.6 + big * 0.9 });
      this.burst(x, y, r, 12 + big * 2, T.main, { n: 7 + big, hi: '#ffffff' });
      this.ring(x, y, 6, r * 1.5, 14, T.hi, { ry: 1, w: 3 + big, front: true });
      this.sparks(x, y, 10 + big * 5, 4, 12 + big * 3, T.hi, { dir: face, spread: 1.5 });
      this.sparks(x, y, 6 + big * 3, 3, 8, T.main, {});
      this.slash(x, y, dir, 52 + big * 14, -1.0, 1.0, 9, '#ffffff', { k: 0.82, hi: T.main });
      if (big >= 2) {
        this.flash('#ffffff', 0.16 + big * 0.04, 6); this.ring(x, GROUND - 2, 10, 90 + big * 18, 22, T.main, {});
        this.shards(x, y, 3 + big * 3, T.main, T.hi, { dir: face, spread: 1.7 });
        this.zoom(0.014 + big * 0.006, 9, x, y); // a short punch-in on heavy hits
      }
      this.shake(Math.min(14, 2 + dmg * 0.24 + (e.ultimate ? 3 : 0)));
      if (e.ultimate) { this.zoom(0.035, 16, x, y); }
    }
    if (e.stolen) {
      // 抽蓝：蓝色光点从受击者飞向施术者
      const n = Math.round(14 * this.count) + 2;
      for (let i = 0; i < n; i++) {
        this.add({ kind: 'glow', add: true, x: x + rnd(-14, 14), y: y + rnd(-26, 26), vx: -dir * rnd(2, 6), vy: rnd(-1.5, 1.5), g: 0, drag: 0.97, life: rnd(26, 44), size: rnd(4, 9), size1: 0, color: pick(['#8fe0ff', '#b99aff', '#ffffff']), homeId: attacker ? attacker.seat : null });
      }
      this.text(x, y - 66, `-${Math.round(e.stolen)} MP`, { color: '#9be3ff', edge: '#10315a', size: 24, life: 56, vy: -2 });
      this.ring(x, y, 10, 64, 20, '#9be3ff', { ry: 1, w: 3, front: true });
    } else if (dmg > 0) {
      const col = big >= 3 ? '#ffe36b' : big === 2 ? '#ffb15c' : big === 1 ? '#fff3d6' : '#ffffff';
      // starts at neck height and floats clear of the head, so a number never sits on the body for long
      this.text(x + rnd(-10, 10), y - 62, String(Math.round(dmg)), { color: col, edge: e.armored ? '#1f3f66' : '#4a1738', size: 24 + big * 7, life: 46 + big * 6, vy: -2.3, pop: 1.9 + big * 0.2 });
    }
  }

  /* ---------------- 事件：普攻出招 ---------------- */
  punch(f: FighterSnapshot) {
    const T = tone(f.id), cx = f.x + f.facing * 26, cy = f.y - 96 * CS;
    this.slash(cx, cy, f.facing, 74, -1.15, 0.95, 9, T.hi, { k: 0.7, hi: T.main });
    if (!this.reduced) this.sparks(cx + f.facing * 40, cy, 3, 2, 5, T.hi, { dir: f.facing > 0 ? 0 : Math.PI, spread: 0.6 });
  }

  /* ---------------- 事件：技能 ---------------- */
  cast(f: FighterSnapshot, slot: SkillActionSlot) {
    const T = tone(f.id), ult = slot === 'ult';
    this.ring(f.x, GROUND - 3, 14, ult ? 150 : 80, ult ? 30 : 20, T.main, { w: ult ? 5 : 3 });
    this.twinkles(f.x, f.y - 90 * CS, ult ? 14 : 6, 30, T.hi, { sy: 60 });
    if (ult) {
      this.circle(f.x, GROUND - 2, 150, 54, T.main, { glyphs: 12 });
      this.pillar(f.x, GROUND, 120, 560, 34, T.main, { hi: T.hi });
      // the call-out strip is only a banner now, so the canvas carries the drama: flare, rays, a wide shockwave and an impact frame.
      // The flare and rays sit behind the fighters and the rays start outside the body, so the caster stays readable.
      this.flare(f.x, f.y - 90 * CS, 190, 20, T.main, { hi: T.hi, front: false });
      this.rays(f.x, f.y - 90 * CS, 120, 540, 22, T.hi, { n: 24, w: 6, front: false });
      this.ring(f.x, f.y - 90 * CS, 20, 640, 26, T.hi, { ry: 0.5, w: 4 });
      this.invert(3);
      this.flash(T.hi, 0.5, 14);
      this.vignette(T.dark, 0.7, 54);
      this.speedLines(T.hi, 26, f.x, f.y - 90);
      this.zoom(0.06, 30, f.x, f.y - 90);
      this.shake(5);
      this.petals(f.x, f.y - 70, 22, f.id, { v0: 2, v1: 7, spread: Math.PI, g: 0.03 });
    } else {
      this.flare(f.x, f.y - 90 * CS, 50, 8, T.main, { hi: T.hi });
      this.petals(f.x, f.y - 60, 6, f.id, { v0: 1, v1: 3.5, spread: Math.PI, g: 0.02 });
    }
  }

  // 技能进行中经过关键帧时触发。f 为插值后的角色，o 为对手，prev 为上一帧位置
  mark(f: FighterSnapshot, move: SkillMove, m: number, o: FighterSnapshot, prev: Pick<FighterSnapshot, 'x' | 'y' | 'facing'> | null) {
    const id = f.id, T = tone(id), fa = f.facing, fx = f.x, fy = f.y;
    switch (move) {
      /* ---- 祥子 ---- */
      case 'pyro_s0':
        if (m === 9) {
          for (const [sx, col] of [[82, '#7ea4f2'], [1198, '#f0a0d8']] as const) {
            this.burst(sx, o ? clamp(o.y - 80, 160, 540) : 400, 60, 14, col, { n: 10 });
            this.ring(sx, GROUND - 3, 8, 70, 18, col, {});
            this.notes(sx, o ? o.y - 80 : 400, 3, col, {});
            this.twinkles(sx, 400, 8, 40, '#ffffff', { sy: 90 });
          }
          this.shake(4);
        }
        break;
      case 'pyro_s1':
        if (m === 11) {
          const x = fx + fa * 36 * CS, y = fy - 58 * CS * 1.55;
          this.burst(x, y, 44, 12, T.main, { n: 6 });
          this.ring(x, y, 6, 50, 14, T.hi, { ry: 1, w: 3, front: true });
          this.notes(x, y, 5, T.hi, { vx: fa * 2 });
          this.sparks(x, y, 10, 3, 9, T.hi, { dir: fa > 0 ? 0 : Math.PI, spread: 0.9 });
        }
        break;
      case 'pyro_s2':
        if (m === 10) {
          const x = fx + fa * 40, y = GROUND - 6;
          this.burst(x, y - 10, 56, 12, T.main, { n: 7 });
          this.ring(x, GROUND - 3, 10, 110, 20, T.hi, {});
          this.dust(x, GROUND - 2, 8, '#cdd8ff', { dir: fa });
          this.sparks(x, y, 12, 3, 10, T.hi, { dir: -Math.PI / 2 + (fa > 0 ? 0.5 : -0.5), spread: 0.9, g: 0.25 });
          this.shake(5);
        }
        break;
      case 'pyro_ult':
        if (m === 6) {
          this.flash(T.hi, 0.22, 8);
          this.sparks(fx, fy - 140 * CS, 14, 3, 10, T.hi, { dir: -Math.PI / 2, spread: 1.1 });
        }
        break;
      /* ---- 初华 ---- */
      case 'shadow_s0':
        if (m === 7) {
          for (const s of [-1, 1]) {
            this.burst(fx + s * 46, fy - 72 * CS * 1.4, 52, 14, s < 0 ? T.main : T.alt, { n: 8 });
            this.petals(fx + s * 46, fy - 80, 10, 'shadow', { v0: 1.5, v1: 5, spread: Math.PI });
          }
          this.ring(fx, fy - 70, 10, 120, 24, T.hi, { ry: 1, w: 4, front: true });
          this.flash('#fff1c4', 0.34, 10);
          this.sparks(fx, fy - 90, 18, 3, 11, T.hi, {});
        }
        break;
      case 'shadow_s1':
        if (m === 8) {
          if (prev) { this.ghost({ ...f, x: prev.x, y: prev.y, facing: prev.facing || fa }, 18, T.alt, 0.6); this.burst(prev.x, prev.y - 90, 44, 12, T.alt, { n: 6 }); this.sparks(prev.x, prev.y - 90, 12, 3, 9, T.alt, {}); }
          this.burst(fx, fy - 90, 56, 14, T.main, { n: 8 });
          this.ring(fx, GROUND - 3, 8, 90, 18, T.main, {});
          this.speedLines(T.hi, 12, fx, fy - 90);
        } else if (m === 10) {
          this.slash(fx + fa * 20, fy - 96, fa, 112, -1.2, 1.1, 14, '#fff4cf', { k: 0.6, hi: T.main });
          this.slash(fx + fa * 26, fy - 86, fa, 96, -0.9, 1.25, 12, T.alt, { k: 0.74, hi: '#ffffff' });
          this.shake(5);
        }
        break;
      case 'shadow_s2':
        if (m === 10) {
          this.ghost({ ...f, x: fx + fa * 62, facing: fa }, 22, '#6b3fb5', 0.55);
          this.ring(fx + fa * 62, GROUND - 3, 10, 80, 22, T.alt, {});
          this.circle(fx + fa * 62, GROUND - 2, 70, 30, T.alt, { glyphs: 6 });
          this.glows(fx + fa * 62, fy - 80, 8, 1, 3, T.alt, { g: -0.04 });
        }
        break;
      case 'shadow_ult':
        if (m >= 6) {
          if (prev) { this.ghost({ ...f, x: prev.x, y: prev.y, facing: prev.facing || fa }, 20, T.main, 0.55); this.burst(prev.x, prev.y - 90, 40, 10, T.main, { n: 6 }); }
          this.burst(fx, fy - 90, 60, 12, T.alt, { n: 8 });
          this.slash(fx + fa * 10, fy - 90, fa, 100, -1.15, 1.15, 12, '#fff4cf', { k: 0.62, hi: T.main });
          this.slash(fx + fa * 10, fy - 90, fa, 100, -1.15 + 0.5, 1.15 - 0.4, 12, T.alt, { k: 0.7, hi: '#ffffff', tilt: 0.5 });
          this.sparks(fx, fy - 90, 14, 3, 12, T.hi, {});
          this.petals(fx, fy - 90, 6, 'shadow', { v0: 1, v1: 4, spread: Math.PI });
          this.shake(4);
        }
        break;
      /* ---- 睦 ---- */
      case 'gale_s0':
        if (m === 0) {
          this.dust(fx, GROUND - 2, 8, '#cfeedd', {});
          this.sparks(fx, GROUND - 6, 10, 2, 8, T.main, { dir: -Math.PI / 2, spread: 0.8 });
          this.strings(fx, 5);
        } else if (m === 13) {
          this.burst(fx, fy - 90, 56, 12, T.hi, { n: 8 });
          this.speedLines(T.main, 14, fx, fy - 70);
        }
        break;
      case 'gale_s1':
        if (m === 0) {
          this.burst(fx, fy - 90, 60, 12, T.main, { n: 8 });
          this.ring(fx, GROUND - 3, 8, 80, 18, T.main, {});
          this.speedLines(T.hi, 16, fx, fy - 90);
          this.sparks(fx, fy - 90, 14, 3, 11, T.hi, { dir: fa > 0 ? Math.PI : 0, spread: 0.7 });
        }
        break;
      case 'gale_s2':
        if (m === 6) this.slash(fx + fa * 18, fy - 100, fa, 96, -1.35, 0.9, 12, '#effff0', { k: 0.62, hi: T.main });
        if (m === 14) this.slash(fx + fa * 24, fy - 84, fa, 96, 1.0, -1.25, 12, '#effff0', { k: 0.62, hi: T.main });
        if (m === 22) { this.slash(fx + fa * 30, fy - 94, fa, 124, -1.3, 1.25, 16, '#ffffff', { k: 0.56, hi: T.main }); this.shake(4); this.petals(fx + fa * 50, fy - 90, 8, 'gale', { v0: 1.5, v1: 5, spread: Math.PI }); }
        if (!this.reduced) this.sparks(fx + fa * 50, fy - 90, 8, 3, 9, T.hi, { dir: fa > 0 ? 0 : Math.PI, spread: 1 });
        break;
      case 'gale_ult':
        if (m === 0) {
          this.strings(fx, 9);
          this.sparks(fx, fy - 100, 24, 3, 12, T.hi, {});
        } else if (m === 8 || m === 18 || m === 28) {
          const tx = o ? o.x : fx + fa * 72;
          this.bolt(tx + rnd(-16, 16), -20, tx, GROUND - 6, 16, T.main, { w: 9, jitter: 46, seg: 11, branches: 3 });
          this.ring(tx, GROUND - 3, 10, 150, 22, T.hi, {});
          this.burst(tx, GROUND - 40, 90, 12, T.main, { n: 9 });
          this.flash(T.hi, 0.32, 8);
          this.shake(m === 28 ? 14 : 10);
          this.dust(tx, GROUND - 2, 10, '#d8f5e2', {});
          this.petals(tx, GROUND - 60, 12, 'gale', { v0: 2, v1: 7, spread: Math.PI, up: -2 });
          this.sparks(tx, GROUND - 30, 20, 4, 13, T.hi, { dir: -Math.PI / 2, spread: 1.4 });
          if (prev) this.ghost({ ...f, x: prev.x, y: prev.y, facing: prev.facing || fa }, 16, T.main, 0.5);
        }
        break;
      /* ---- 喵梦 ---- */
      case 'iron_s0':
        if (m === 0) { this.speedLines(T.hi, 10, fx, fy - 90); this.sparks(fx, fy - 70, 10, 2, 8, T.main, { dir: fa > 0 ? Math.PI : 0, spread: 0.6 }); }
        if (m === 10) {
          const tx = o ? o.x : fx + fa * 60, ty = o ? o.y - 90 * CS : fy - 80;
          this.flash('#ffffff', 0.5, 9);
          this.brackets(tx, ty, 120, 150, 22, '#ffffff');
          this.burst(tx, ty, 60, 12, T.main, { n: 10 });
          this.twinkles(tx, ty, 10, 40, '#ffffff', {});
        }
        break;
      case 'iron_s1':
        if (m === 8) {
          this.burst(fx, fy - 100, 78, 16, T.main, { n: 10 });
          this.ring(fx, fy - 90, 10, 110, 24, T.hi, { ry: 1, w: 4, front: true });
          this.petals(fx, fy - 90, 16, 'iron', { v0: 2, v1: 6, spread: Math.PI });
          this.flash('#ffe4f2', 0.28, 8);
          this.sparks(fx, fy - 90, 16, 3, 10, T.hi, {});
        }
        break;
      case 'iron_s2':
        if (m === 0) { this.speedLines(T.hi, 12, fx, fy - 90); this.burst(fx, fy - 80, 56, 10, T.main, { n: 8 }); }
        if (m === 6) { this.slash(fx + fa * 30, fy - 90, fa, 100, -0.9, 1.0, 12, '#ffffff', { k: 0.5, hi: T.main }); this.shake(4); }
        break;
      case 'iron_ult':
        if (m === 12 || m === 24 || m === 38) {
          const x = fx + fa * 36;
          this.ring(x, GROUND - 3, 12, m === 38 ? 220 : 170, 22, T.main, { w: 6 });
          this.ring(x, GROUND - 3, 6, m === 38 ? 140 : 100, 18, T.hi, { w: 3 });
          this.crack(x, GROUND, fa, m === 38 ? 190 : 140, 30, T.main);
          this.crack(x, GROUND, -fa, m === 38 ? 90 : 60, 26, T.main);
          this.dust(x, GROUND - 2, 12, '#ffd7ec', {});
          this.sparks(x, GROUND - 6, 22, 4, 14, T.hi, { dir: -Math.PI / 2, spread: 1.4 });
          this.petals(x, GROUND - 30, 10, 'iron', { v0: 2, v1: 7, spread: Math.PI, up: -2 });
          this.shake(m === 38 ? 15 : 11);
          this.flash(T.hi, 0.22, 6);
          if (m === 38) this.pillar(x, GROUND, 140, 400, 22, T.main, { hi: T.hi });
        }
        break;
      /* ---- 海铃 ---- */
      case 'bastion_s0':
        if (m === 10) {
          const x = fx + fa * 40;
          this.crack(x, GROUND, fa, 200, 34, T.main);
          this.ring(x + fa * 8, GROUND - 3, 12, 130, 20, T.hi, {});
          this.dust(x, GROUND - 2, 10, '#bfe8ef', { dir: fa });
          this.coins(x, GROUND - 14, 8);
          this.sparks(x, GROUND - 6, 18, 4, 13, T.hi, { dir: -Math.PI / 2, spread: 1.3 });
          for (let i = 0; i < 3; i++) this.spike(x + fa * (30 + i * 36), GROUND, 30 + (2 - i) * 12, 18 + i * 3, T.main);
          this.shake(10);
        }
        break;
      case 'bastion_s1':
        if (m === 40) {
          this.ring(fx, fy - 70, 14, 230, 26, T.main, { ry: 1, w: 7, front: true });
          this.ring(fx, GROUND - 3, 14, 250, 26, T.hi, { w: 5 });
          this.burst(fx, fy - 80, 120, 16, T.main, { n: 12 });
          this.flash(T.hi, 0.42, 10);
          this.shake(13);
          this.petals(fx, fy - 80, 22, 'bastion', { v0: 3, v1: 9, spread: Math.PI });
          this.sparks(fx, fy - 80, 30, 5, 16, T.hi, {});
          this.zoom(0.04, 16, fx, fy - 80);
        }
        break;
      case 'bastion_s2':
        if (m === 5) { this.slash(fx + fa * 22, fy - 90, fa, 100, -1.2, 1.0, 11, '#dff8ff', { k: 0.58, hi: T.main }); this.speedLines(T.hi, 10, fx, fy - 90); }
        if (m === 12) { this.slash(fx + fa * 30, fy - 88, fa, 118, 1.15, -1.25, 13, '#ffffff', { k: 0.54, hi: T.main }); this.shake(5); this.petals(fx + fa * 60, fy - 90, 5, 'bastion', { v0: 1, v1: 4, spread: Math.PI }); }
        break;
      case 'bastion_ult':
        if (m === 8 || m === 16 || m === 24 || m === 34) {
          const wave = m === 8 ? 0 : m === 16 ? 1 : m === 24 ? 2 : 3;
          const x = fx + fa * (56 + wave * 48);
          this.ring(x, GROUND - 3, 10, 100, 20, T.hi, { w: 4 });
          this.sparks(x, GROUND - 8, 18, 4, 14, T.hi, { dir: -Math.PI / 2, spread: 0.9 });
          this.dust(x, GROUND - 2, 6, '#bfe8ef', {});
          this.shake(10);
          if (m === 34) { this.flash(T.hi, 0.25, 8); this.petals(x, GROUND - 50, 16, 'bastion', { v0: 2, v1: 8, spread: Math.PI, up: -2 }); }
        }
        break;
      default: break;
    }
  }

  spike(x: number, y: number, h: number, w: number, color: string) {
    return this.item({ t: 'spike', x, y, h, w, life: 26, color, front: false });
  }
  landing(f: FighterSnapshot) {
    const T = tone(f.id);
    this.ring(f.x, GROUND - 3, 12, 140, 22, T.main, { w: 5 });
    this.rays(f.x, GROUND - 8, 20, 150, 14, T.hi, { n: 14, w: 4 });
    this.crack(f.x, GROUND, f.facing, 120, 28, T.main);
    this.dust(f.x, GROUND - 2, 10, '#d8f2e2', {});
    this.sparks(f.x, GROUND - 8, 18, 4, 13, T.hi, { dir: -Math.PI / 2, spread: 1.3 });
    this.petals(f.x, GROUND - 40, 8, f.id, { v0: 2, v1: 6, spread: Math.PI, up: -2 });
    this.shake(11);
  }
  strings(x: number, n: number) {
    // 天上垂下的细线（人偶线）
    for (let i = 0; i < n; i++) {
      this.item({ t: 'string', x: x + rnd(-70, 70), y0: -10, y1: rnd(260, 470), life: rnd(22, 36), color: '#d8ffe6', delay: i * 1.2, sway: rnd(0, TAU) });
    }
  }

  /* ---------------- 持续效果：由状态推导 ---------------- */
  sustain(f: FighterSnapshot, o: FighterSnapshot, dt: number, ts: number) {
    const T = tone(f.id), move = f.skillMove || '', t = f.stateT || 0;
    const a = this.acc;
    const key = (n: string) => f.id + n;
    const every = (n: string, ms: number) => { if (ts - (a[key(n)] || 0) >= ms) { a[key(n)] = ts; return true; } return false; };
    if (f.dead) return;
    // 冲刺残影
    const dashing = (f.state === 'skill' && (move === 'gale_s1' || move === 'iron_s2' || move === 'bastion_s2' || (move === 'shadow_s1' && t >= 9) || (move === 'gale_s0' && t >= 13) || move === 'shadow_ult')) || (f.dashT > 0);
    if (dashing && every('ghost', 34)) this.ghost(f, 14, T.main, 0.4);
    if (f.state === 'skill' && every('trail', 40) && (move === 'gale_s1' || move === 'iron_s2' || move === 'bastion_s2')) {
      this.sparks(f.x - f.facing * 20, f.y - 90 * CS * rnd(0.5, 1.4), 2, 1, 4, T.hi, { dir: f.facing > 0 ? Math.PI : 0, spread: 0.3, g: 0 });
    }
    // 霸体光环
    if (f.armor > 0 && every('armor', 80)) {
      if (f.id === 'iron') this.petals(f.x + rnd(-30, 30), f.y - rnd(30, 150), 1, 'iron', { v0: 0.2, v1: 1, spread: Math.PI, g: -0.02, l0: 30, l1: 50 });
      else this.twinkles(f.x, f.y - 80, 1, 36, T.hi, { sy: 70 });
    }
    // 巴斯蒂翁蓄力：光点向胸口汇聚
    if (move === 'bastion_s1' && f.state === 'skill' && t < 40 && every('charge', 34)) {
      const ang = rnd(0, TAU), r = rnd(70, 130) * (1 - t / 52);
      this.add({ kind: 'glow', add: true, x: f.x + Math.cos(ang) * r, y: f.y - 82 + Math.sin(ang) * r * 0.8, vx: -Math.cos(ang) * 2.4, vy: -Math.sin(ang) * 1.9, g: 0, drag: 0.98, life: 22, size: rnd(5, 9), size1: 0, color: pick([T.main, T.hi, T.alt]) });
    }
    // 大招蓄满：脚下缓缓上升的星点
    if (f.mp >= 199.5 && f.state !== 'skill' && every('ready', 150)) {
      this.twinkles(f.x, f.y - 6, 1, 30, T.hi, { sy: 4, vy: -1.1, s0: 3, s1: 6, l0: 36, l1: 56 });
    }
    // 初华 s0：金色花瓣环绕
    if (move === 'shadow_s0' && f.state === 'skill' && every('s0', 70)) this.petals(f.x, f.y - 70, 1, 'shadow', { v0: 0.3, v1: 1.2, spread: Math.PI, jx: 40, jy: 60, g: 0.03 });
    // 祥子 s1：右手音符萦绕
    if (move === 'pyro_s1' && f.state === 'skill' && t < 11 && every('s1', 90)) this.notes(f.x + f.facing * 26, f.y - 96, 1, T.hi, {});
    // 祥子 s0 / ult：舞台灯环绕的光点
    if (move === 'pyro_s0' && f.state === 'skill' && t < 9 && every('p0', 60)) this.twinkles(f.x, f.y - 96, 1, 46, T.hi, { sy: 40 });
    if (f.id === 'pyro' && move === 'pyro_ult' && f.state === 'skill' && every('pu', 50)) {
      this.add({ kind: 'glow', add: true, x: f.x + rnd(-50, 50), y: f.y - rnd(30, 130), vx: 0, vy: -2.6, g: 0, drag: 0.99, life: 36, size: rnd(5, 10), size1: 0, color: pick([T.main, T.hi, T.alt]) });
    }
  }

  // 场上弹射物 / 危险物的持续粒子
  sustainWorld(snap: Snapshot, ts: number) {
    const a = this.acc;
    for (let i = 0; i < (snap.projectiles || []).length; i++) {
      const p = snap.projectiles[i];
      const owner = p.owner === null ? undefined : snap.fighters[p.owner];
      const T = tone(owner ? owner.id : 'pyro');
      const k = 'p' + i + p.type;
      if (ts - (a[k] || 0) < 32) continue;
      a[k] = ts;
      if (p.type === 'note') {
        this.notes(p.x - Math.sign(p.vx) * 10, p.y, 1, T.hi, { jx: 4, jy: 8 });
        this.twinkles(p.x - Math.sign(p.vx) * 18, p.y, 1, 8, '#ffffff', { l0: 14, l1: 24, s0: 3, s1: 6 });
      } else if (p.type === 'curtain') {
        const col = p.vx > 0 ? '#9db8ff' : '#f4b4e8';
        this.glows(p.x - Math.sign(p.vx) * 22, p.y + rnd(-34, 34), 1, 0.3, 1.2, col, { s0: 5, s1: 10, l0: 14, l1: 22 });
      } else if (p.type === 'wave') {
        this.dust(p.x, GROUND - 2, 1, '#cdd8ff', { dir: -Math.sign(p.vx) });
        this.sparks(p.x, GROUND - 6, 1, 2, 6, T.hi, { dir: -Math.PI / 2, spread: 0.6, g: 0.2 });
      }
    }
    for (let i = 0; i < (snap.hazards || []).length; i++) {
      const h = snap.hazards[i];
      const k = 'h' + i + h.type;
      if (ts - (a[k] || 0) < 38) continue;
      a[k] = ts;
      if (h.type === 'meteor') {
        const T = tone('pyro');
        this.glows(h.x + rnd(-14, 14), h.y - rnd(0, 50), 1, 0.2, 1, pick([T.main, T.hi, '#ffffff']), { s0: 8, s1: 16, l0: 16, l1: 26 });
        this.sparks(h.x + rnd(-14, 14), h.y - rnd(0, 40), 1, 1, 4, T.hi, { dir: -Math.PI / 2, spread: 0.5, g: 0.05 });
      } else if (h.type === 'pillar') {
        const T = tone('bastion');
        this.twinkles(h.x + rnd(-24, 24), GROUND - rnd(0, 140), 1, 4, T.hi, { vy: -2.2, l0: 14, l1: 24, s0: 3, s1: 6 });
      }
    }
  }

  // 地图事件：陨石落地
  impact(e: CombatEvent) {
    const T = tone('pyro'), x = e.x;
    this.burst(x, GROUND - 60, 150, 18, T.main, { n: 12 });
    this.ring(x, GROUND - 3, 14, 260, 30, T.main, { w: 8 });
    this.ring(x, GROUND - 3, 8, 170, 22, T.hi, { w: 4 });
    this.ring(x, GROUND - 40, 10, 170, 24, '#ffffff', { ry: 1, w: 3, front: true });
    this.pillar(x, GROUND, 150, 620, 30, T.main, { hi: T.hi, front: true });
    this.flare(x, GROUND - 40, 260, 20, T.main, { hi: '#ffffff', front: false });
    this.rays(x, GROUND - 40, 90, 520, 22, T.hi, { n: 24, w: 7, dir: -Math.PI / 2, front: false });
    this.invert(3);
    this.flash('#ffffff', 0.62, 16);
    this.shake(18);
    this.zoom(0.05, 24, x, GROUND - 80);
    this.speedLines(T.hi, 18, x, GROUND - 60);
    this.dust(x, GROUND - 2, 16, '#dbe4ff', {});
    this.sparks(x, GROUND - 20, 40, 5, 18, T.hi, { dir: -Math.PI / 2, spread: 1.5, g: 0.25, l1: 40 });
    this.petals(x, GROUND - 60, 24, 'pyro', { v0: 2, v1: 9, spread: Math.PI, up: -3 });
    this.crack(x, GROUND, 1, 150, 40, T.main); this.crack(x, GROUND, -1, 150, 40, T.main);
    for (let i = 0; i < 7; i++) this.spike(x + (i - 3) * 30, GROUND, 40 + (3 - Math.abs(i - 3)) * 22, 14, T.hi);
  }

  ko(f: FighterSnapshot) {
    const T = tone(f.id);
    // finisher: impact frame, a huge flare, radial lines and a spray of glass
    this.invert(4);
    this.flare(f.x, f.y - 90, 230, 22, T.main, { hi: '#ffffff', front: false });
    this.rays(f.x, f.y - 90, 110, 640, 24, T.hi, { n: 30, w: 8, front: false });
    this.shards(f.x, f.y - 90, 26, T.main, T.hi, { v0: 4, v1: 14, spread: Math.PI });
    this.ring(f.x, f.y - 90, 20, 520, 28, T.hi, { ry: 0.55, w: 4 });
    this.burst(f.x, f.y - 90, 130, 20, T.main, { n: 12 });
    this.ring(f.x, GROUND - 3, 10, 210, 30, T.main, { w: 5 });
    this.ring(f.x, f.y - 90, 10, 160, 24, '#ffffff', { ry: 1, w: 4, front: true });
    this.petals(f.x, f.y - 90, 36, f.id, { v0: 2, v1: 10, spread: Math.PI, g: 0.05, l1: 120 });
    this.sparks(f.x, f.y - 90, 40, 4, 18, T.hi, {});
    this.flash('#ffffff', 0.62, 16);
    this.shake(16);
    this.zoom(0.07, 40, f.x, f.y - 90);
    this.vignette('#000000', 0.5, 60);
  }

  /* ---------------- 更新 ---------------- */
  update(dt: number, ts: number, fighters: readonly FighterSnapshot[]) {
    this.now = ts;
    const dtf = clamp(dt, 0, 3);
    // 粒子
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dtf;
      if (p.life <= 0) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      if (p.homeId !== undefined && p.homeId !== null && fighters && fighters[p.homeId]) {
        const t = fighters[p.homeId];
        p.vx += (t.x - p.x) * 0.012 * dtf; p.vy += ((t.y - 90) - p.y) * 0.012 * dtf;
      }
      const d = Math.pow(p.drag, dtf);
      p.vx *= d; p.vy = p.vy * d + p.g * dtf;
      p.x += p.vx * dtf; p.y += p.vy * dtf; p.rot += p.vr * dtf;
      if (p.kind === 'petal') { p.x += Math.sin(p.sway + p.life * 0.15) * 0.5 * dtf; }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.age += dtf; it.life -= dtf;
      if (it.life <= -(it.delay || 0)) { this.items[i] = this.items[this.items.length - 1]; this.items.pop(); }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.life -= dtf; t.x += t.vx * dtf; t.y += t.vy * dtf; t.vy *= Math.pow(0.96, dtf);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { this.ghosts[i].life -= dtf; if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1); }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].life -= dtf; if (this.flashes[i].life <= 0) this.flashes.splice(i, 1); }
    if (this.lines) { this.lines.life -= dtf; if (this.lines.life <= 0) this.lines = null; }
    if (this.vig) { this.vig.life -= dtf; if (this.vig.life <= 0) this.vig = null; }
    if (this.inv) { this.inv.life -= dtf; if (this.inv.life <= 0) this.inv = null; }
    if (this.shakeAmp > 0) { this.shakeAmp *= Math.pow(0.86, dtf); if (this.shakeAmp < 0.2) this.shakeAmp = 0; }
    if (this.zoomLife > 0) { this.zoomLife -= dtf; if (this.zoomLife <= 0) { this.zoomLife = 0; this.zoomAmt = 0; } }
  }

  /* ---------------- 绘制：角色后方 ---------------- */
  drawBack(c: CanvasRenderingContext2D) {
    for (const it of this.items) {
      if (it.front) continue;
      const k = 1 - it.life / it.max;
      if (it.age < (it.delay || 0)) continue;
      c.save();
      this.drawItem(c, it, k);
      c.restore();
    }
  }
  drawGhosts(c: CanvasRenderingContext2D) {
    for (const g of this.ghosts) {
      const k = g.life / g.max;
      c.save();
      c.translate(g.x, g.y); c.scale(g.facing < 0 ? -1 : 1, 1);
      c.globalAlpha = g.a * k;
      c.drawImage(g.canvas, -SPRITE.ox * CS, -SPRITE.oy * CS, SPRITE.w * CS, SPRITE.h * CS);
      c.restore();
    }
  }
  /* ---------------- 绘制：角色前方 ---------------- */
  drawFront(c: CanvasRenderingContext2D) {
    // 普通混合粒子
    for (const p of this.parts) if (!p.add) this.drawPart(c, p);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const it of this.items) {
      if (!it.front) continue;
      if (it.age < (it.delay || 0)) continue;
      c.save(); this.drawItem(c, it, 1 - it.life / it.max); c.restore();
    }
    for (const p of this.parts) if (p.add) this.drawPart(c, p);
    c.restore();
    c.globalAlpha = 1;
  }
  drawText(c: CanvasRenderingContext2D) {
    for (const t of this.texts) {
      const k = 1 - t.life / t.max;
      const pop = k < 0.12 ? lerp(t.pop, 1, ease(k / 0.12)) : 1;
      const a = t.life < 14 ? t.life / 14 : 1;
      c.save();
      c.globalAlpha = a; c.translate(t.x, t.y); c.scale(pop, pop);
      // bundled Barlow Condensed (the HUD face) so numbers match the interface; narrower than Arial Black, hence the 1.18
      c.font = `italic 800 ${Math.round(t.size * 1.18)}px "Barlow Condensed", "Arial Black", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 0, 0, t.size * 1.2, t.color, a * 0.16); c.restore();
      c.globalAlpha = a;
      const off = t.size * 0.09;
      c.fillStyle = t.edge; c.fillText(t.str, off, off); // hard offset shadow, the street-poster look
      c.lineWidth = Math.max(4, t.size * 0.26); c.strokeStyle = t.edge; c.strokeText(t.str, 0, 0);
      const g = c.createLinearGradient(0, -t.size * 0.5, 0, t.size * 0.5);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, t.color); g.addColorStop(1, t.color);
      c.fillStyle = g; c.fillText(t.str, 0, 0);
      c.restore();
    }
  }
  // 屏幕空间叠层（闪白 / 暗角 / 速度线），ctx 已重置为屏幕坐标
  drawScreen(c: CanvasRenderingContext2D, w: number, h: number, ts: number) {
    void ts;
    if (this.reduced) return;
    if (this.vig) {
      const k = this.vig.life / this.vig.max, a = this.vig.a * Math.min(1, k * 2.4) * Math.min(1, (1 - k) * 6 + 0.2);
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, rgbaOf(this.vig.color, a));
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    if (this.lines) {
      const L = this.lines, k = L.life / L.max;
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 * k; c.strokeStyle = L.color; c.lineWidth = 2;
      const cx = w / 2, cy = h / 2, n = 38;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + L.seed + Math.sin(i * 7.13 + L.seed) * 0.06;
        const r0 = Math.max(w, h) * (0.3 + 0.12 * ((i * 37) % 7) / 7), r1 = Math.max(w, h) * 0.8;
        c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.7);
      }
      c.stroke(); c.restore();
    }
    if (this.inv) {
      // impact frame: invert the picture for a few frames (difference against white)
      c.save(); c.globalCompositeOperation = 'difference'; c.globalAlpha = this.inv.life / this.inv.max > 0.5 ? 0.9 : 0.5;
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.restore();
    }
    for (const f of this.flashes) {
      const k = f.life / f.max;
      c.globalAlpha = f.a * k * k; c.fillStyle = f.color; c.fillRect(0, 0, w, h);
    }
    c.globalAlpha = 1;
  }

  drawPart(c: CanvasRenderingContext2D, p: Particle) {
    const k = p.life / p.max;
    const a = p.kind === 'dust' ? k * 0.32 : p.kind === 'petal' ? Math.min(1, k * 3) : p.kind === 'coin' ? Math.min(1, k * 4) : Math.min(1, k * 2.2);
    const s = lerp(p.size1, p.size, k);
    if (a <= 0.01) return;
    switch (p.kind) {
      case 'spark': {
        c.globalAlpha = a; c.strokeStyle = p.color; c.lineWidth = p.size * k + 0.4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 1.8, p.y - p.vy * 1.8); c.stroke();
        // hot head on the bigger sparks; skipped when the renderer has thinned the effects out
        if (p.size > 2.2 && (this.density === undefined || this.density >= 1)) glow(c, p.x, p.y, p.size * 2.4, p.color, a * 0.55);
        break;
      }
      case 'shard': {
        c.globalAlpha = a; c.fillStyle = p.color;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
        c.beginPath(); c.moveTo(s * 1.4, 0); c.lineTo(-s * 0.7, s * 0.7); c.lineTo(-s * 0.35, -s * 0.9); c.closePath(); c.fill();
        c.globalAlpha = a * 0.7; c.strokeStyle = '#ffffff'; c.lineWidth = 0.9; c.stroke();
        c.restore();
        break;
      }
      case 'glow': glow(c, p.x, p.y, s * 1.6, p.color, a); break;
      case 'star': {
        c.globalAlpha = a; c.fillStyle = p.color;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
        starPath(c, 0, 0, s, 4, 0, 0.18); c.fill();
        c.restore();
        glow(c, p.x, p.y, s * 1.2, p.color, a * 0.5);
        break;
      }
      case 'dust': {
        c.globalAlpha = a; c.fillStyle = p.color;
        c.beginPath(); c.arc(p.x, p.y, s, 0, TAU); c.fill();
        break;
      }
      case 'petal': {
        c.globalAlpha = a; c.fillStyle = p.color; c.strokeStyle = 'rgba(40,10,40,.35)'; c.lineWidth = 0.5;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, 0.6 + 0.4 * Math.sin(p.life * 0.2));
        A.petal(c, s * 1.3, s * 0.55); c.fill(); c.stroke(); c.restore();
        break;
      }
      case 'note': {
        c.globalAlpha = a; c.fillStyle = p.color;
        note(c, p.x, p.y, s, p.rot + Math.sin(p.life * 0.2) * 0.2);
        glow(c, p.x, p.y, s * 1.6, p.color, a * 0.35);
        break;
      }
      case 'coin': {
        c.globalAlpha = a; c.fillStyle = p.color; c.strokeStyle = '#9a6a1a'; c.lineWidth = 0.8;
        c.save(); c.translate(p.x, p.y); c.scale(Math.abs(Math.cos(p.rot)) * 0.8 + 0.2, 1);
        c.beginPath(); c.arc(0, 0, p.size, 0, TAU); c.fill(); c.stroke(); c.restore();
        break;
      }
      default: break;
    }
  }

  drawItem(c: CanvasRenderingContext2D, it: Item, k: number) {
    switch (it.t) {
      case 'ring': {
        const r = lerp(it.r0, it.r1, 1 - Math.pow(1 - k, 2.2));
        c.globalCompositeOperation = 'lighter';
        // a faint filled disc under the line makes the shockwave read as energy, not a wire.
        // Only for rings drawn behind the fighters: in front it would wash out whoever stands inside it.
        if (!it.front) { c.save(); c.translate(it.x, it.y); c.scale(1, it.ry); glow(c, 0, 0, r * 1.02, it.color, (1 - k) * it.a * 0.2); c.restore(); }
        c.globalAlpha = (1 - k) * it.a; c.strokeStyle = it.color; c.lineWidth = Math.max(0.8, it.w * (1 - k * 0.8));
        c.beginPath(); c.ellipse(it.x, it.y, r, r * it.ry, 0, 0, TAU); c.stroke();
        c.globalAlpha = (1 - k) * it.a * 0.5; c.lineWidth = Math.max(0.5, it.w * 0.4 * (1 - k)); c.strokeStyle = '#ffffff';
        c.beginPath(); c.ellipse(it.x, it.y, r * 0.96, r * 0.96 * it.ry, 0, 0, TAU); c.stroke();
        break;
      }
      case 'burst': {
        const e = ease(Math.min(1, k * 2.2)), r = it.r * (0.35 + 0.65 * e), a = 1 - Math.pow(k, 1.6);
        c.globalCompositeOperation = 'lighter';
        glow(c, it.x, it.y, r * 1.5, it.color, a * 0.75);
        c.globalAlpha = a; c.fillStyle = it.color;
        starPath(c, it.x, it.y, r, it.n, it.rot, it.inner, it.jit); c.fill();
        c.globalAlpha = a; c.fillStyle = it.hi;
        starPath(c, it.x, it.y, r * 0.55, it.n, it.rot + 0.2, 0.4, it.jit); c.fill();
        break;
      }
      case 'slash': {
        const head = ease(Math.min(1, k / 0.55)), tail = ease(clamp((k - 0.15) / 0.85, 0, 1));
        const a0 = lerp(it.a0, it.a1, tail * 0.85), a1 = lerp(it.a0, it.a1, head);
        const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        c.translate(it.x, it.y); c.scale(it.f, 1); c.rotate(it.tilt);
        c.globalCompositeOperation = 'lighter';
        // echoes of the blade a moment ago give the swing a motion-blur trail
        for (const [lag, wide, fade] of [[0.5, 1.16, 0.2], [0.25, 1.1, 0.32]] as const) {
          c.globalAlpha = alpha * fade; c.fillStyle = it.color;
          crescent(c, 0, 0, it.R * wide, lerp(it.a0, it.a1, tail * lag), lerp(a0, a1, 0.7), Math.max(0.2, it.k - 0.2)); c.fill();
        }
        c.globalAlpha = alpha * 0.55; c.fillStyle = it.color;
        crescent(c, 0, 0, it.R * 1.08, a0, a1, Math.max(0.2, it.k - 0.14)); c.fill();
        c.globalAlpha = alpha; c.fillStyle = it.hi;
        crescent(c, 0, 0, it.R, a0, a1, it.k); c.fill();
        c.globalAlpha = alpha * 0.9; c.fillStyle = '#ffffff';
        crescent(c, 0, 0, it.R * 0.985, lerp(a0, a1, 0.35), a1, Math.min(0.92, it.k + 0.18)); c.fill();
        glow(c, Math.cos(a1) * it.R, Math.sin(a1) * it.R, it.R * 0.3, it.hi, alpha * 0.8); // bright tip
        break;
      }
      case 'bolt': {
        if (it.age % 3 === 2 && k < 0.8) break; // 闪烁
        const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
        const draw = (pts: readonly Point[], wMul: number) => {
          c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
          c.globalAlpha = a * 0.28; c.strokeStyle = it.color; c.lineWidth = it.w * 2.8 * wMul; c.stroke();
          c.globalAlpha = a * 0.8; c.lineWidth = it.w * 1.2 * wMul; c.stroke();
          c.globalAlpha = a; c.strokeStyle = it.hi; c.lineWidth = Math.max(1, it.w * 0.45 * wMul); c.stroke();
        };
        draw(it.main, 1);
        for (const b of it.branches) draw(b, 0.5);
        const end = it.main[it.main.length - 1];
        glow(c, end[0], end[1], 70 * (1 - k * 0.5), it.color, a * 0.8);
        break;
      }
      case 'pillar': {
        const e = Math.min(1, k / it.grow || 1), a = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
        const h = it.h * (k < it.grow ? ease(e) : 1), w = it.w * (1 - k * 0.5);
        c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(it.x - w / 2, 0, it.x + w / 2, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, rgbaOf(it.hi, 0.85 * a)); g.addColorStop(1, 'rgba(0,0,0,0)');
        const v = c.createLinearGradient(0, it.y, 0, it.y - h);
        v.addColorStop(0, rgbaOf(it.color, 0.9 * a)); v.addColorStop(1, rgbaOf(it.color, 0));
        c.fillStyle = v; c.fillRect(it.x - w * 0.8, it.y - h, w * 1.6, h);
        c.fillStyle = g; c.globalAlpha = 1; c.fillRect(it.x - w / 2, it.y - h, w, h);
        glow(c, it.x, it.y - 4, w * 1.3, it.color, a);
        break;
      }
      case 'circle': {
        const a = k < 0.15 ? k / 0.15 : k > it.hold ? 1 - (k - it.hold) / (1 - it.hold) : 1;
        const r = it.r * (0.6 + 0.4 * ease(Math.min(1, k * 3)));
        drawMagicCircle(c, it.x, it.y, r, it.ry, it.age * it.spin, it.color, a, it.glyphs);
        break;
      }
      case 'crack': {
        const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3, reveal = Math.min(1, k / 0.2 + 0.1);
        const n = Math.max(2, Math.ceil(it.pts.length * reveal));
        c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
        const path = () => { c.beginPath(); for (let i = 0; i < n; i++) { if (i) c.lineTo(it.pts[i][0], it.pts[i][1]); else c.moveTo(it.pts[i][0], it.pts[i][1]); } };
        path(); c.globalAlpha = a * 0.4; c.strokeStyle = it.color; c.lineWidth = 9; c.stroke();
        path(); c.globalAlpha = a; c.strokeStyle = '#ffffff'; c.lineWidth = 2.2; c.stroke();
        c.globalAlpha = a * 0.8; c.strokeStyle = it.color; c.lineWidth = 2;
        for (const f of it.forks) { if (f[0][0] === undefined) continue; c.beginPath(); c.moveTo(f[0][0], f[0][1]); c.lineTo(f[1][0], f[1][1]); c.stroke(); }
        break;
      }
      case 'brackets': {
        const a = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2, s = lerp(1.4, 1, ease(Math.min(1, k * 5)));
        const w = it.w * s / 2, h = it.h * s / 2, l = 22;
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.strokeStyle = it.color; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.moveTo(it.x + sx * w, it.y + sy * (h - l)); c.lineTo(it.x + sx * w, it.y + sy * h); c.lineTo(it.x + sx * (w - l), it.y + sy * h);
        }
        c.stroke();
        break;
      }
      case 'spike': {
        const e = ease(Math.min(1, k / 0.25)), a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4, h = it.h * e;
        c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(0, it.y, 0, it.y - h);
        g.addColorStop(0, rgbaOf(it.color, 0.95 * a)); g.addColorStop(1, rgbaOf('#ffffff', 0.9 * a));
        c.fillStyle = g;
        c.beginPath(); c.moveTo(it.x - it.w / 2, it.y); c.lineTo(it.x + it.w * 0.1, it.y - h); c.lineTo(it.x + it.w / 2, it.y); c.closePath(); c.fill();
        break;
      }
      case 'string': {
        const grow = ease(Math.min(1, k / 0.3)), a = k < 0.6 ? 0.9 : 0.9 * (1 - (k - 0.6) / 0.4);
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.strokeStyle = it.color; c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(it.x, it.y0);
        const y1 = lerp(it.y0, it.y1, grow);
        c.quadraticCurveTo(it.x + Math.sin(it.sway + it.age * 0.2) * 7, (it.y0 + y1) / 2, it.x, y1); c.stroke();
        glow(c, it.x, y1, 7, it.color, a);
        break;
      }
      case 'flare': {
        const e = ease(Math.min(1, k / 0.25)), a = 1 - Math.pow(k, 1.4), r = it.r * (0.55 + 0.45 * e);
        c.globalCompositeOperation = 'lighter';
        glow(c, it.x, it.y, r * 1.1, it.color, a * 0.75);
        glow(c, it.x, it.y, r * 0.45, it.hi, a * 0.85);
        // anamorphic streak and a shorter cross spike, plus a half-length pair at 45 degrees
        c.fillStyle = it.hi;
        c.translate(it.x, it.y); c.rotate(it.rot);
        for (const [deg, long, thin, fade] of [[0, 1.5, 0.07, 0.95], [Math.PI / 2, 0.9, 0.05, 0.7], [Math.PI / 4, 0.7, 0.04, 0.5], [-Math.PI / 4, 0.7, 0.04, 0.5]] as const) {
          c.save(); c.rotate(deg); c.globalAlpha = a * fade;
          c.beginPath(); c.moveTo(-r * long, 0); c.quadraticCurveTo(0, -r * thin, r * long, 0); c.quadraticCurveTo(0, r * thin, -r * long, 0); c.fill();
          c.restore();
        }
        break;
      }
      case 'rays': {
        const e = ease(Math.min(1, k / 0.4)), a = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
        c.globalCompositeOperation = 'lighter'; c.fillStyle = it.hi; c.globalAlpha = a * 0.9;
        for (let i = 0; i < it.angles.length; i++) {
          const cs = Math.cos(it.angles[i]), sn = Math.sin(it.angles[i]);
          const near = it.r0 + (it.r1 - it.r0) * 0.3 * e, far = it.r0 + (it.r1 - it.r0) * e * it.lens[i], half = it.w * (1 - k);
          c.beginPath();
          c.moveTo(it.x + cs * near - sn * half, it.y + sn * near + cs * half);
          c.lineTo(it.x + cs * far, it.y + sn * far);
          c.lineTo(it.x + cs * near + sn * half, it.y + sn * near - cs * half);
          c.closePath(); c.fill();
        }
        break;
      }
      default: break;
    }
  }
}

function rgbaOf(hex: string, a: number) { return A.rgba(hex, a); }

function drawMagicCircle(c: CanvasRenderingContext2D, x: number, y: number, r: number, ry: number, rot: number, color: string, a: number, glyphs: number) {
  c.save();
  c.translate(x, y); c.scale(1, ry);
  c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = color; c.fillStyle = color;
  c.globalAlpha = a * 0.9; c.lineWidth = 3.2 / Math.max(0.5, ry * 2);
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
  c.lineWidth = 1.4 / Math.max(0.5, ry * 2); c.globalAlpha = a * 0.75;
  c.beginPath(); c.arc(0, 0, r * 0.88, 0, TAU); c.stroke();
  c.beginPath(); c.arc(0, 0, r * 0.52, 0, TAU); c.stroke();
  // 刻度与符文
  c.save(); c.rotate(rot);
  c.lineWidth = 1.6 / Math.max(0.5, ry * 2);
  for (let i = 0; i < glyphs * 2; i++) {
    const aa = i * Math.PI / glyphs, r0 = r * 0.88, r1 = r * (i % 2 ? 0.95 : 1.0);
    c.beginPath(); c.moveTo(Math.cos(aa) * r0, Math.sin(aa) * r0); c.lineTo(Math.cos(aa) * r1, Math.sin(aa) * r1); c.stroke();
  }
  c.restore();
  // 反向旋转的星形
  c.save(); c.rotate(-rot * 1.4);
  c.globalAlpha = a * 0.8; c.lineWidth = 2 / Math.max(0.5, ry * 2);
  const n = Math.max(3, Math.min(8, glyphs >> 1));
  c.beginPath();
  for (let i = 0; i <= n; i++) { const aa = i * TAU * Math.floor((n - 1) / 2 || 1) / n; (i ? c.lineTo : c.moveTo).call(c, Math.cos(aa) * r * 0.5, Math.sin(aa) * r * 0.5); }
  c.stroke();
  for (let i = 0; i < n; i++) { const aa = i * TAU / n; c.beginPath(); c.arc(Math.cos(aa) * r * 0.7, Math.sin(aa) * r * 0.7, r * 0.045, 0, TAU); c.fill(); }
  c.restore();
  // 内部柔光
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgbaOf(color, 0.42 * a)); g.addColorStop(1, rgbaOf(color, 0));
  c.fillStyle = g; c.globalAlpha = 1;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  c.restore();
}

/* ---------------- 场上物体的绘制（弹射物 / 危险物） ---------------- */
function drawProjectile(c: CanvasRenderingContext2D, p: Projectile, ownerId: CharacterId, frame: number) {
  const T = tone(ownerId), dir = p.facing || Math.sign(p.vx) || 1;
  c.save();
  c.globalCompositeOperation = 'lighter';
  if (p.type === 'curtain') {
    const col = p.vx > 0 ? '#9db8ff' : '#f4b4e8', R = p.r || 34;
    c.translate(p.x, p.y); c.scale(dir, 1);
    // 拖尾：几条波浪状的丝带
    for (let i = 0; i < 5; i++) {
      const o = i * 15, wob = Math.sin(frame * 0.25 + i) * 4;
      c.globalAlpha = 0.28 - i * 0.045; c.fillStyle = col;
      c.beginPath(); c.moveTo(-8 - o, -R * (1.25 - i * 0.12)); c.quadraticCurveTo(-34 - o, wob, -8 - o, R * (1.25 - i * 0.12));
      c.quadraticCurveTo(-24 - o, wob * 0.5, -8 - o, -R * (1.25 - i * 0.12)); c.fill();
    }
    glow(c, 0, 0, R * 2.2, col, 0.55);
    c.globalAlpha = 1; c.fillStyle = col;
    crescent(c, -22, 0, R * 1.5, -1.0, 1.0, 0.7); c.fill();
    c.fillStyle = '#ffffff'; c.globalAlpha = 0.95;
    crescent(c, -22, 0, R * 1.46, -0.8, 0.8, 0.86); c.fill();
  } else if (p.type === 'note') {
    c.translate(p.x, p.y);
    const pulse = 1 + Math.sin(frame * 0.4) * 0.08;
    glow(c, 0, 0, 40 * pulse, T.main, 0.85);
    glow(c, 0, 0, 22, T.hi, 0.9);
    c.fillStyle = '#ffffff'; c.globalAlpha = 1;
    c.scale(dir, 1);
    note(c, 0, 2, 32 * pulse, Math.sin(frame * 0.2) * 0.2);
    c.globalAlpha = 0.5; c.strokeStyle = T.main; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-26, -4); c.lineTo(-70, -4); c.moveTo(-24, 5); c.lineTo(-56, 5); c.stroke();
  } else if (p.type === 'wave') {
    c.translate(p.x, GROUND); c.scale(dir, 1);
    glow(c, 6, -20, 70, T.main, 0.5);
    c.globalAlpha = 0.95; c.fillStyle = T.main;
    c.beginPath(); c.moveTo(-50, -2); c.quadraticCurveTo(-18, -62, 18, -58); c.quadraticCurveTo(46, -42, 54, -3); c.quadraticCurveTo(10, -30, -50, -2); c.fill();
    c.fillStyle = '#ffffff'; c.globalAlpha = 0.95;
    c.beginPath(); c.moveTo(-30, -3); c.quadraticCurveTo(-6, -38, 20, -36); c.quadraticCurveTo(36, -26, 38, -4); c.quadraticCurveTo(10, -22, -30, -3); c.fill();
    for (let i = 0; i < 4; i++) {
      const sx = -34 + i * 24, sh = 24 + Math.sin(frame * 0.3 + i * 2) * 8 + (i % 2) * 10;
      c.globalAlpha = 0.85; c.fillStyle = T.hi;
      c.beginPath(); c.moveTo(sx - 7, 0); c.lineTo(sx + 1, -sh); c.lineTo(sx + 8, 0); c.closePath(); c.fill();
    }
  } else {
    c.translate(p.x, p.y);
    glow(c, 0, 0, (p.r || 14) * 2.4, p.color || T.main, 0.8);
  }
  c.restore();
}

function drawHazardBack(c: CanvasRenderingContext2D, h: Hazard, ownerId: CharacterId, frame: number) {
  const T = tone(ownerId);
  if (h.type === 'meteor') {
    const fall = clamp((h.y - 80) / (GROUND - 100), 0, 1);
    const pulse = 0.75 + Math.sin(frame * 0.5) * 0.25;
    c.save();
    // 落点警示：旋转法阵
    drawMagicCircle(c, h.x, GROUND - 2, 64 + fall * 24, 0.24, frame * 0.07, T.main, 0.35 + fall * 0.55, 8);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = (0.15 + fall * 0.35) * pulse;
    const g = c.createLinearGradient(h.x, 0, h.x, GROUND);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, rgbaOf(T.main, 0.6));
    c.fillStyle = g; c.fillRect(h.x - 3, 0, 6, GROUND);
    c.restore();
  } else if (h.type === 'boom' || h.type === 'shock' || h.type === 'skillShock') {
    const life = h.life || 1, k = clamp(1 - life / 14, 0, 1), rad = h.radius || 120;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.globalAlpha = (1 - k) * 0.55;
    glow(c, h.x, GROUND - 30, rad * (0.9 + k * 0.7), T.main, 1);
    c.restore();
  }
}
function drawHazardFront(c: CanvasRenderingContext2D, h: Hazard, ownerId: CharacterId, frame: number) {
  const T = tone(ownerId);
  c.save();
  if (h.type === 'meteor') {
    // 彗星：大光球 + 向上的长尾 + 周围碎晶
    const x = h.x, y = h.y;
    c.globalCompositeOperation = 'lighter';
    const tail = c.createLinearGradient(x, y - 340, x, y);
    tail.addColorStop(0, 'rgba(0,0,0,0)'); tail.addColorStop(1, rgbaOf(T.main, 0.85));
    c.fillStyle = tail;
    c.beginPath(); c.moveTo(x - 7, y - 340); c.lineTo(x + 7, y - 340); c.lineTo(x + 34, y - 6); c.lineTo(x - 34, y - 6); c.closePath(); c.fill();
    c.globalAlpha = 0.6; c.fillStyle = rgbaOf('#ffffff', 0.55);
    c.beginPath(); c.moveTo(x - 3, y - 260); c.lineTo(x + 3, y - 260); c.lineTo(x + 15, y - 6); c.lineTo(x - 15, y - 6); c.closePath(); c.fill();
    c.globalAlpha = 1;
    glow(c, x, y, 120, T.main, 0.8);
    glow(c, x, y, 70, T.hi, 0.95);
    c.fillStyle = '#ffffff';
    starPath(c, x, y, 34, 7, frame * 0.1, 0.5); c.fill();
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + frame * 0.08, rr = 52 + Math.sin(frame * 0.3 + i) * 8;
      c.fillStyle = T.hi; c.globalAlpha = 0.85;
      starPath(c, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, 7, 4, a, 0.25); c.fill();
    }
  } else if (h.type === 'pillar') {
    const life = h.life || 1, k = clamp(1 - life / 16, 0, 1);
    const rise = ease(Math.min(1, k / 0.22)), height = 190 * rise, a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    c.globalCompositeOperation = 'lighter';
    const w = 66 * (1 - k * 0.2);
    // 音柱：带均衡器条纹的青色光柱
    const g = c.createLinearGradient(0, GROUND, 0, GROUND - height);
    g.addColorStop(0, rgbaOf(T.main, 0.95 * a)); g.addColorStop(0.7, rgbaOf(T.main, 0.55 * a)); g.addColorStop(1, rgbaOf(T.hi, 0.1 * a));
    c.fillStyle = g; c.fillRect(h.x - w / 2, GROUND - height, w, height);
    const core = c.createLinearGradient(h.x - w / 2, 0, h.x + w / 2, 0);
    core.addColorStop(0, 'rgba(255,255,255,0)'); core.addColorStop(0.5, `rgba(255,255,255,${0.9 * a})`); core.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = core; c.fillRect(h.x - w / 2, GROUND - height, w, height);
    c.fillStyle = rgbaOf('#ffffff', 0.7 * a);
    for (let i = 0; i < 6; i++) {
      const bh = (0.35 + 0.65 * Math.abs(Math.sin(frame * 0.4 + i * 1.7))) * height * 0.9, bx = h.x - w / 2 + 4 + i * (w - 8) / 6;
      c.fillRect(bx, GROUND - bh, (w - 8) / 6 - 3, bh);
    }
    glow(c, h.x, GROUND - 6, 80, T.main, 0.9 * a);
    glow(c, h.x, GROUND - height, 50, T.hi, 0.7 * a);
  } else if (h.type === 'boom') {
    const life = h.life || 1, k = clamp(1 - life / 14, 0, 1);
    c.globalCompositeOperation = 'lighter';
    glow(c, h.x, GROUND - 50, 190 * (0.7 + k * 0.6), T.main, (1 - k) * 0.9);
    glow(c, h.x, GROUND - 40, 110 * (0.7 + k * 0.5), '#ffffff', (1 - k));
  }
  c.restore();
}

const effects = { Fx, TONES, tone, glow, glowSprite, starPath, crescent, note, drawProjectile, drawHazardBack, drawHazardFront, drawMagicCircle, CS, SPRITE };
export default effects;
