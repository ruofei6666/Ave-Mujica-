'use strict';

// Split the eight generated figures by their alpha components, not by blind
// grid cuts: guitar necks and keyboards can extend across a nominal grid line.
// This only packages the generated pixels; it does not draw replacement art.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const specs = JSON.parse(fs.readFileSync(path.join(root, 'scripts/character-art-spec.json'), 'utf8'));
const sharp = require(process.env.CHARACTER_SHARP || 'C:/Users/ruofa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const names = ['idle', 'walk-a', 'walk-b', 'jump', 'attack', 'skill', 'hurt', 'bust'];
const CELL = 768, FOOT = 732, HEIGHT = 600;

function components(data, w, h, threshold = 64) {
  const labels = new Int32Array(w * h), queue = new Int32Array(w * h), parts = [];
  let label = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4 + 3] < threshold) continue;
    label++;
    let tail = 1, head = 0, count = 0, left = w, top = h, right = 0, bottom = 0;
    queue[0] = start; labels[start] = label;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w);
      count++; left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of neighbours) if (q >= 0 && !labels[q] && data[q * 4 + 3] >= threshold) {
        labels[q] = label; queue[tail++] = q;
      }
    }
    if (count > 10000) parts.push({ label, count, left, top, right, bottom });
  }
  if (parts.length !== 8) {
    // A faint alpha bridge can join a guitar neck to a neighbouring figure.
    // Find eight opaque cores, then restore translucent pixels by growing all
    // eight labels together; the frontier separates them without a grid cut.
    if (threshold < 220) return components(data, w, h, threshold === 64 ? 128 : threshold === 128 ? 192 : 220);
    throw new Error(`Expected eight separate figures, found ${parts.length}: ${JSON.stringify(parts)}`);
  }
  const upper = parts.filter(p => (p.top + p.bottom) / 2 < h / 2).sort((a, b) => a.left - b.left);
  const lower = parts.filter(p => (p.top + p.bottom) / 2 >= h / 2).sort((a, b) => a.left - b.left);
  if (upper.length !== 4 || lower.length !== 4) throw new Error('Atlas rows do not contain four figures each');
  const ordered = upper.concat(lower), mainLabels = new Set(ordered.map(p => p.label));
  const grown = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let p = 0; p < labels.length; p++) if (mainLabels.has(labels[p])) {
    grown[p] = labels[p]; queue[tail++] = p;
  }
  while (head < tail) {
    const p = queue[head++], x = p % w, y = Math.floor(p / w);
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !grown[q] && data[q * 4 + 3] > 0) { grown[q] = grown[p]; queue[tail++] = q; }
    }
  }
  const byLabel = new Map(ordered.map(p => [p.label, { ...p, left: w, top: h, right: 0, bottom: 0 }]));
  for (let p = 0; p < grown.length; p++) if (grown[p]) {
    const part = byLabel.get(grown[p]), x = p % w, y = Math.floor(p / w);
    part.left = Math.min(part.left, x); part.right = Math.max(part.right, x);
    part.top = Math.min(part.top, y); part.bottom = Math.max(part.bottom, y);
  }
  return { labels: grown, parts: ordered.map(p => byLabel.get(p.label)) };
}

function isolate(data, w, h, labels, part) {
  const margin = 3;
  const left = Math.max(0, part.left - margin), top = Math.max(0, part.top - margin);
  const width = Math.min(w, part.right + margin + 1) - left;
  const height = Math.min(h, part.bottom + margin + 1) - top;
  const pixels = Buffer.alloc(width * height * 4);
  let footSum = 0, footCount = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = left + x, gy = top + y, p = gy * w + gx;
    let belongs = labels[p] === part.label;
    if (!belongs && !labels[p] && data[p * 4 + 3] > 0) {
      // Retain the original alpha of antialiased border pixels near this figure.
      for (let dy = -margin; !belongs && dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && labels[ny * w + nx] === part.label) { belongs = true; break; }
      }
    }
    if (belongs) data.copy(pixels, (y * width + x) * 4, p * 4, p * 4 + 4);
    if (labels[p] === part.label && gy > part.bottom - Math.max(8, (part.bottom - part.top) * .045)) {
      footSum += x; footCount++;
    }
  }
  return { pixels, width, height, pivotX: footCount ? footSum / footCount : width / 2 };
}

async function buildPortrait(spec, output, idle) {
  const target = path.join(output, 'portrait.png');
  if (spec.portraitSourceImage) {
    await sharp(path.resolve(root, spec.portraitSourceImage)).trim({ threshold: 2 }).png().toFile(target);
  } else {
    if (!idle) throw new Error(`${spec.id} has no standalone portrait source`);
    await sharp(idle.pixels, { raw: { width: idle.width, height: idle.height, channels: 4 } }).resize({ height: 1000 }).png().toFile(target);
  }
  const image = await sharp(target).metadata();
  return [image.width, image.height];
}

async function build(spec) {
  const { data, info } = await sharp(path.resolve(root, spec.generatedImage)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { labels, parts } = components(data, info.width, info.height);
  const figures = parts.map(p => isolate(data, info.width, info.height, labels, p));
  const output = path.join(root, 'assets/characters', spec.id);
  fs.mkdirSync(output, { recursive: true });
  const factor = HEIGHT / figures[0].height, composites = [], frames = {};
  for (let i = 0; i < 7; i++) {
    const f = figures[i], width = Math.round(f.width * factor), height = Math.round(f.height * factor);
    const px = Math.round(f.pivotX * factor), left = CELL / 2 - px, top = FOOT - height;
    if (left < 4 || left + width > CELL - 4 || top < 4) throw new Error(`${spec.id} ${names[i]} does not fit, enlarge packing cells`);
    const image = await sharp(f.pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).resize(width, height).png().toBuffer();
    const col = i % 4, row = Math.floor(i / 4);
    composites.push({ input: image, left: col * CELL + left, top: row * CELL + top });
    frames[names[i]] = { rect: [col * CELL, row * CELL, CELL, CELL], pivot: [CELL / 2, FOOT], weapon: spec.weapon };
  }
  const bust = figures[7];
  const bustImage = await sharp(bust.pixels, { raw: { width: bust.width, height: bust.height, channels: 4 } }).png().toBuffer();
  await sharp({ create: { width: CELL * 4, height: CELL * 2, channels: 4, background: '#00000000' } })
    .composite(composites).webp({ quality: 94, alphaQuality: 100, effort: 6 }).toFile(path.join(output, 'atlas.webp'));
  const idle = figures[0];
  // Large selection portraits are generated separately from the tiny poses.
  // Preserve their native detail when repacking the combat atlases.
  const portraitSize = await buildPortrait(spec, output, idle);
  await sharp(bustImage).resize({ height: 800 }).png().toFile(path.join(output, 'cutin.png'));
  await sharp(bustImage).extract({ left: 0, top: 0, width: bust.width, height: Math.min(bust.height, Math.round(bust.width * 1.02)) })
    .resize(512, 512, { fit: 'contain', background: '#00000000' }).png().toFile(path.join(output, 'avatar.png'));
  return { id: spec.id, name: spec.name, weapon: spec.weapon, url: `assets/characters/${spec.id}/atlas.webp`,
    portrait: `assets/characters/${spec.id}/portrait.png`, portraitSize, avatar: `assets/characters/${spec.id}/avatar.png`,
    cutin: `assets/characters/${spec.id}/cutin.png`, height: HEIGHT, frames };
}

async function buildAnimations(spec, old) {
  const figures = [];
  for (const sheet of spec.sheets) {
    const { data, info } = await sharp(path.resolve(root, sheet.generatedImage)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { labels, parts } = components(data, info.width, info.height);
    const isolated = parts.map(p => isolate(data, info.width, info.height, labels, p));
    const standing = isolated[sheet.sheet === 'combat' ? 5 : sheet.sheet === 'skill' ? 3 : 0];
    isolated.forEach((f, index) => figures.push({ ...f, name: sheet.frames[index], factor: 400 / standing.height }));
  }
  const cell = 512, foot = 488, height = 400;
  const composites = [], frames = {};
  for (let index = 0; index < figures.length; index++) {
    const f = figures[index], factor = f.factor, width = Math.round(f.width * factor), h = Math.round(f.height * factor);
    const px = Math.round(f.pivotX * factor), left = cell / 2 - px, top = foot - h;
    if (left < 4 || left + width > cell - 4 || top < 4) throw new Error(`${spec.id} ${f.name} does not fit: ${left},${top},${width},${h}`);
    const image = await sharp(f.pixels, { raw: { width: f.width, height: f.height, channels: 4 } }).resize(width, h).png().toBuffer();
    const col = index % 4, row = Math.floor(index / 4);
    composites.push({ input: image, left: col * cell + left, top: row * cell + top });
    frames[f.name] = { rect: [col * cell, row * cell, cell, cell], pivot: [cell / 2, foot], weapon: old.weapon };
  }
  await sharp({ create: { width: cell * 4, height: cell * 6, channels: 4, background: '#00000000' } })
    .composite(composites).webp({ quality: 94, alphaQuality: 100, effort: 6 }).toFile(path.join(root, old.url));
  return { ...old, height, frames, animationFrameCount: figures.length };
}

async function main() {
  const manifestPath = path.join(root, 'assets/characters/manifest.json');
  const args = process.argv.slice(2), portraitsOnly = args.includes('--portraits-only'), animations = args.includes('--animations');
  const selected = new Set(args.filter(arg => !arg.startsWith('--')));
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const characters = selected.size || portraitsOnly || animations ? previous.characters : {};
  if (animations) {
    const animationSpecs = JSON.parse(fs.readFileSync(path.join(root, 'scripts/character-animation-spec.json'), 'utf8'));
    for (const spec of animationSpecs.characters.filter(s => !selected.size || selected.has(s.id))) {
      characters[spec.id] = await buildAnimations(spec, characters[spec.id]);
      console.log(`Packed ${spec.id}: ${characters[spec.id].animationFrameCount} distinct instrument animation frames`);
    }
  } else {
  for (const spec of specs.characters.filter(s => !selected.size || selected.has(s.id))) {
    if (portraitsOnly) {
      characters[spec.id].portraitSize = await buildPortrait(spec, path.join(root, 'assets/characters', spec.id));
      console.log(`Packed standalone portrait ${spec.name}: ${characters[spec.id].portraitSize.join(' x ')}`);
    } else {
      characters[spec.id] = await build(spec);
      console.log(`Packed ${spec.name}: seven instrument poses, portrait, avatar, cut-in`);
    }
  }
  }
  const manifest = { version: animations ? Math.max(6, (previous.version || 5) + 1) : Object.values(characters).some(c => c.animationFrameCount === 24) ? previous.version : specs.characters.every(s => s.portraitSourceImage) ? 5 : 4, generatedAt: specs.generatedAt, generator: 'built-in image_gen', characters };
  fs.writeFileSync(path.join(root, 'assets/characters/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'src/game/character-assets.ts'), `// Generated by scripts/prepare-character-assets.cjs\nimport type { CharacterAssetManifest } from './asset-types';\nconst manifest: CharacterAssetManifest = ${JSON.stringify(manifest, null, 2)};\nexport default manifest;\n`);
}
module.exports = { components, isolate };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
