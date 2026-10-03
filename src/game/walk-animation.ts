import type { AssetFrame, CharacterAsset } from './asset-types';
import { context2d } from './canvas';
import { cyclePhase } from '../../shared/locomotion';

interface AlignedFrame { frame: AssetFrame; x: number; y: number; width: number; height: number }
export interface WalkFrames { idle: AlignedFrame; walk: AlignedFrame[]; canvas: HTMLCanvasElement; scale: number; key: string }

// Generated cels were packed by the centre of their boots. A lifted foot
// changes that centre, making the whole head and instrument jump sideways.
// Register the head and supporting sole once, without deforming the artwork.
export function prepareWalkFrames(atlas: HTMLImageElement, asset: CharacterAsset): WalkFrames {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = context2d(canvas, { willReadFrequently: true });
  const names = ['idle-0', ...Array.from({ length: 6 }, (_, i) => `walk-${i}`)];
  const measures = names.map(name => {
    const frame = asset.frames[name];
    c.clearRect(0, 0, 512, 512); c.drawImage(atlas, ...frame.rect, 0, 0, 512, 512);
    const pixels = c.getImageData(0, 0, 512, 512).data;
    let top = 512, floor = 0;
    for (let y = 0; y < 512; y++) {
      let count = 0;
      for (let x = 0; x < 512; x++) if (pixels[(y * 512 + x) * 4 + 3] >= 192) count++;
      if (count >= 5) { top = Math.min(top, y); floor = y + 1; }
    }
    let sum = 0, count = 0;
    const start = Math.round(top + (floor - top) * .04), end = Math.round(top + (floor - top) * .17);
    for (let y = start; y < end; y++) for (let x = 0; x < 512; x++) {
      if (pixels[(y * 512 + x) * 4 + 3] >= 192) { sum += x; count++; }
    }
    return { frame, top, floor, head: count ? sum / count : 256 };
  });
  const idle = measures[0], scale = 190 / asset.height;
  const aligned = measures.map(m => {
    const size = Math.max(.94, Math.min(1.06, (idle.floor - idle.top) / Math.max(1, m.floor - m.top)));
    return { frame: m.frame, x: ((idle.head - 256) - m.head * size) * scale, y: -m.floor * size * scale,
      width: 512 * size * scale, height: 512 * size * scale };
  });
  return { idle: aligned[0], walk: aligned.slice(1), canvas, scale, key: '' };
}

export function walkPose(phase: number) {
  const value = cyclePhase(phase) * 6, step = Math.floor(value);
  const t = Math.max(0, Math.min(1, (value - step - .55) / .45));
  return { step, blend: t * t * (3 - 2 * t) };
}

export function drawWalking(c: CanvasRenderingContext2D, atlas: HTMLImageElement, frames: WalkFrames, phase: number, amount: number, reduced: boolean) {
  const weight = Math.max(0, Math.min(1, amount)), pose = walkPose(phase);
  c.save();
  // Small weight transfer, anchored at the sole; idle has no clock animation.
  if (!reduced && weight) c.transform(1, 0, -.008 * weight, 1 - .006 * weight * (1 + Math.cos(phase * Math.PI * 4)) / 2, 0, 0);
  const key = `${pose.step}:${Math.round(pose.blend * 256)}:${Math.round(weight * 256)}`;
  if (frames.key !== key) {
    const blendContext = context2d(frames.canvas);
    blendContext.setTransform(1,0,0,1,0,0); blendContext.clearRect(0,0,512,512);
    blendContext.setTransform(1 / frames.scale, 0, 0, 1 / frames.scale, 256, 488);
    blendContext.globalCompositeOperation = 'lighter';
    const draw = (frame: AlignedFrame, opacity: number) => {
      if (opacity <= 0) return;
      blendContext.globalAlpha = opacity;
      blendContext.drawImage(atlas, ...frame.frame.rect, frame.x, frame.y, frame.width, frame.height);
    };
    draw(frames.idle, 1 - weight);
    draw(frames.walk[pose.step], weight * (1 - pose.blend));
    draw(frames.walk[(pose.step + 1) % 6], weight * pose.blend);
    blendContext.globalAlpha = 1; blendContext.globalCompositeOperation = 'source-over'; frames.key = key;
  }
  c.drawImage(frames.canvas, -256 * frames.scale, -488 * frames.scale, 512 * frames.scale, 512 * frames.scale);
  c.restore();
}
