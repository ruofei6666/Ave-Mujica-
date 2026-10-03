import { ARENA } from '../../shared/arena';
import type { Seat } from '../../shared/types';

export interface CameraView { left: number; top: number; width: number; height: number }
interface Subject { x: number; y: number }
// Artwork is 190 units tall at a 0.9 sprite scale: one third of the viewport.
export const FIGHTER_HEIGHT = 171;
export const VIEW_HEIGHT = FIGHTER_HEIGHT * 3;
const BASE_TOP = ARENA.ground - VIEW_HEIGHT * 0.72;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class BattleCamera {
  private left = 0;
  private top = BASE_TOP;
  private width = VIEW_HEIGHT * 16 / 9;
  private ready = false;

  get view(): CameraView { return { left: this.left, top: this.top, width: this.width, height: VIEW_HEIGHT }; }

  resize(width: number, height: number) {
    this.width = Math.min(ARENA.width, VIEW_HEIGHT * Math.max(1, width) / Math.max(1, height));
    this.left = clamp(this.left, 0, ARENA.width - this.width);
  }

  reset() { this.ready = false; }

  update(fighters: readonly Subject[], seat: Seat, elapsedMs: number) {
    const own = fighters[seat];
    if (!own) return this.view;
    const other = fighters[1 - seat] || own;
    // Frame both players at close range; at long range keep the local player in view.
    const center = (own.x + other.x) / 2;
    const targetLeft = clamp(clamp(center - this.width / 2, own.x - this.width * 0.68, own.x - this.width * 0.32), 0, ARENA.width - this.width);
    const targetTop = clamp(Math.min(BASE_TOP, own.y - FIGHTER_HEIGHT - VIEW_HEIGHT * 0.2), -24, BASE_TOP);
    const blend = this.ready ? 1 - Math.exp(-clamp(elapsedMs, 0, 80) / 140) : 1;
    this.left += (targetLeft - this.left) * blend;
    this.top += (targetTop - this.top) * blend;
    // A dash, teleport or orientation change must never leave the player offscreen.
    const margin = Math.min(90, this.width * 0.25);
    this.left = clamp(clamp(this.left, own.x - this.width + margin, own.x - margin), 0, ARENA.width - this.width);
    this.top = clamp(Math.min(this.top, own.y - FIGHTER_HEIGHT - 24), -24, BASE_TOP);
    this.ready = true;
    return this.view;
  }
}
