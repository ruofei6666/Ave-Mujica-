import type { CharacterId, FighterSnapshot, SkillMove } from '../../shared/types';
import type { AssetKind, CharacterLook, DrawCharacterOptions, LoadedCharacter, ShowcaseOptions } from './asset-types';
import { context2d } from './canvas';
import manifest from './character-assets';
import Combat from '../../shared/combat';
import { prepareWalkFrames, drawWalking, walkPose } from './walk-animation';
const root = window;
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (v: number) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const CHARS: Record<CharacterId, CharacterLook> = {
  pyro: { id: 'pyro', name: '祥子', full: '丰川祥子', code: 'Oblivionis', role: '键盘', accent: '#8fb1ea', accent2: '#dbe8ff', glow: '#7ea4f2', dark: '#243a78', flowerCN: '唐菖蒲', meaning: '忘却', flowerA: '#a9c1f6', flowerB: '#f2f6ff', flowerC: '#6d9c82' },
  shadow: { id: 'shadow', name: '初华', full: '三角初华', code: 'Doloris', role: '主唱 / 吉他', accent: '#e8c36e', accent2: '#fff1c4', glow: '#f2c35c', dark: '#3a2c12', flowerCN: '万寿菊', meaning: '悲伤', flowerA: '#f59e1b', flowerB: '#ffd04d', flowerC: '#c46a10' },
  gale: { id: 'gale', name: '睦', full: '若叶睦', code: 'Mortis', role: '吉他', accent: '#97cc9f', accent2: '#e4f8dd', glow: '#7fe0a4', dark: '#16301f', flowerCN: '菊花', meaning: '死亡', flowerA: '#ffffff', flowerB: '#f6c944', flowerC: '#b9e0b8' },
  bastion: { id: 'bastion', name: '海铃', full: '八幡海铃', code: 'Timoris', role: '贝斯', accent: '#4fa4bd', accent2: '#cdeff7', glow: '#53c5e0', dark: '#10252d', flowerCN: '彼岸花', meaning: '恐惧', flowerA: '#e0344c', flowerB: '#ff7b8c', flowerC: '#8f1228' },
  iron: { id: 'iron', name: '喵梦', full: '祐天寺若麦', code: 'Amoris', role: '鼓手', accent: '#e4659f', accent2: '#ffd9ec', glow: '#ff7fc0', dark: '#3a1128', flowerCN: '蝴蝶兰', meaning: '爱', flowerA: '#ffd8ec', flowerB: '#ffffff', flowerC: '#c2185b' },
};
const rgbCache = new Map<string, number[]>();
function rgbOf(hex: string) {
  if (!rgbCache.has(hex)) {
    let h = hex.replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    rgbCache.set(hex, [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)));
  }
  return rgbCache.get(hex)!;
}
const rgba = (hex: string, a: number) => `rgba(${rgbOf(hex).join(',')},${clamp(a, 0, 1)})`;
function mixHex(a: string, b: string, t: number) {
  const first = rgbOf(a), second = rgbOf(b);
  return '#' + first.map((v, i) => Math.round(lerp(v, second[i], clamp(t, 0, 1))).toString(16).padStart(2, '0')).join('');
}
// Petals belong to the stage/skill effects, not to the character artwork.
function petal(c: CanvasRenderingContext2D, w: number, h: number) {
  c.beginPath(); c.moveTo(-w, 0);
  c.bezierCurveTo(-w * .45, -h, w * .45, -h, w, 0);
  c.bezierCurveTo(w * .4, h, -w * .4, h, -w, 0); c.closePath();
}


if (!manifest || !manifest.characters) throw new Error('Character asset manifest did not load');
const loaded = new Map<CharacterId, LoadedCharacter>(), failures: string[] = [];
const assetUrl = (id: CharacterId, kind: AssetKind = 'avatar') => {
  const url = manifest.characters[id]?.[kind === 'atlas' ? 'url' : kind] || '';
  return url ? `${url}?v=${manifest.version}` : url;
};
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => { failures.push(url); console.error(`Character image could not load: ${url}`); resolve(null); };
    img.src = url;
  });
}
const ready = Promise.all((Object.keys(CHARS) as CharacterId[]).map(async id => {
  const [atlas, portrait, cutin] = await Promise.all((['atlas', 'portrait', 'cutin'] as const).map(kind => loadImage(assetUrl(id, kind))));
  loaded.set(id, { atlas, portrait, cutin, walkFrames: atlas ? prepareWalkFrames(atlas, manifest.characters[id]) : undefined });
  root.dispatchEvent(new CustomEvent('mujica:assets', { detail: { id, ready: !!(atlas && portrait && cutin) } }));
  return !!(atlas && portrait && cutin);
})).then(results => results.every(Boolean));
const assetReady = (id: CharacterId) => { const rec = loaded.get(id); return !!(rec?.atlas && rec.portrait && rec.cutin); };

// Anticipation, wind-up, active gesture, recovery. Active boundaries follow
// the combat core, so the held instrument strikes when damage can occur.
const SKILL_PHASES: Record<SkillMove, [number, number, number]> = {
  pyro_s0: [4, 9, 17], pyro_s1: [3, 7, 17], pyro_s2: [3, 7, 17], pyro_ult: [3, 6, 26],
  shadow_s0: [3, 7, 14], shadow_s1: [4, 8, 15], shadow_s2: [4, 8, 15], shadow_ult: [3, 6, 40],
  gale_s0: [4, 8, 14], gale_s1: [2, 4, 12], gale_s2: [3, 6, 26], gale_ult: [4, 8, 34],
  iron_s0: [3, 5, 15], iron_s1: [4, 8, 18], iron_s2: [3, 6, 15], iron_ult: [5, 10, 42],
  bastion_s0: [5, 10, 17], bastion_s1: [20, 40, 45], bastion_s2: [2, 5, 18], bastion_ult: [4, 8, 38],
};
function frameName(f: FighterSnapshot, frame: number = 0) {
  const t = f.stateT || 0;
  if (f.dead || f.state === 'dead') return 'hurt-1';
  if (f.win) return `win-${Math.floor(frame / 18) % 2}`;
  if (f.state === 'stun') return `hurt-${t < 5 ? 0 : 1}`;
  if (f.state === 'punch') {
    const def = Combat.characters.find(c => c.id === f.id)!.punch;
    return `attack-${t < Math.ceil(def.startup / 2) ? 0 : t < def.startup ? 1 : t < def.startup + def.active ? 2 : 3}`;
  }
  if (f.state === 'skill') {
    const marks = (f.skillMove && SKILL_PHASES[f.skillMove]) || [4, 8, 18];
    return `skill-${t < marks[0] ? 0 : t < marks[1] ? 1 : t < marks[2] ? 2 : 3}`;
  }
  if (f.state === 'jump') return `jump-${f.vy < 0 ? 0 : 1}`;
  if (f.state === 'walk') return `walk-${Math.floor((((f.walkPhase || 0) % 1 + 1) % 1) * 6)}`;
  return 'idle-0';
}

function animationPose(f: FighterSnapshot, frame: number = 0) {
  const name = frameName(f, frame);
  if (!name.startsWith('walk-')) return { name, next: name, blend: 0 };
  const { step, blend } = walkPose(f.walkPhase || 0);
  return { name, next: `walk-${(step + 1) % 6}`, blend };
}

function drawCharacter(c: CanvasRenderingContext2D, f: FighterSnapshot, frame: number, options: DrawCharacterOptions = {}) {
  const def = manifest.characters[f.id], rec = loaded.get(f.id);
  if (!def || !rec?.atlas) return;
  if (!f.dead && !f.win && rec.walkFrames && (f.state === 'walk' || f.state === 'idle')) {
    drawWalking(c, rec.atlas, rec.walkFrames, f.walkPhase || 0, options.walkAmount ?? (f.state === 'walk' ? 1 : 0), !!options.reduced);
    return;
  }
  const animation = animationPose(f, frame), name = animation.name;
  const legacy = name.startsWith('walk-') ? ((f.walkPhase || 0) % 1 < .5 ? 'walk-a' : 'walk-b') : name.startsWith('win-') ? 'skill' : name.split('-')[0];
  const pose = def.frames[name] || def.frames[legacy];
  const [sx, sy, sw, sh] = pose.rect, [px, py] = pose.pivot;
  const scale = 190 / def.height, reduced = !!options.reduced;
  c.save();
  if (f.dead || f.state === 'dead') {
    // Settle the generated hurt pose onto the floor after K.O.
    c.translate(10, -13); c.rotate(-1.32); c.scale(.9, .9);
  } else if (!reduced) {
    const t = f.stateT || 0;
    if (f.state === 'punch') { c.translate(Math.sin(clamp(t / 18, 0, 1) * Math.PI) * 4, 0); c.rotate(-Math.sin(t * .2) * .025); }
    else if (f.state === 'skill') { c.rotate(Math.sin(t * .13) * .025); }
  }
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  const next = def.frames[animation.next];
  if (animation.blend > 0 && next && next !== pose) {
    const alpha = c.globalAlpha;
    // Weighted additive alpha keeps shared body pixels opaque during a
    // transition; source-over fading would make the figure see-through.
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alpha * (1 - animation.blend);
    c.drawImage(rec.atlas, sx, sy, sw, sh, -px * scale, -py * scale, sw * scale, sh * scale);
    c.globalAlpha = alpha * animation.blend;
    const [nx, ny, nw, nh] = next.rect, [npx, npy] = next.pivot;
    c.drawImage(rec.atlas, nx, ny, nw, nh, -npx * scale, -npy * scale, nw * scale, nh * scale);
  } else c.drawImage(rec.atlas, sx, sy, sw, sh, -px * scale, -py * scale, sw * scale, sh * scale);
  c.restore();
}

function drawShowcase(canvas: HTMLCanvasElement, id: CharacterId, ts: number, options: ShowcaseOptions = {}) {
  void ts;
  const rec = loaded.get(id), image = options.mode === 'bust' ? rec?.cutin : rec?.portrait;
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(root.devicePixelRatio || 1, options.mode === 'bust' ? 2 : 3);
  const w = Math.max(1, Math.round((bounds.width || canvas.width || 420) * dpr));
  const h = Math.max(1, Math.round((bounds.height || canvas.height || 560) * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const c = context2d(canvas); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
  if (!image) return;
  const fill = options.fill || (options.mode === 'bust' ? .98 : .94);
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight) * fill;
  const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(image, (w - iw) / 2, h - ih - h * .01, iw, ih);
}

const Art = { CHARS, TAU, clamp, lerp, ease, rgbOf, mixHex, rgba, petal,
  drawCharacter, drawShowcase, frameName, animationPose, assetReady, assetUrl, ready, failures,
  version: manifest.version, source: 'generated-images', manifest };
export default Art;
