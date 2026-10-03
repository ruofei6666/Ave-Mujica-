// Optional generated art for the interface.
//
// scripts/prepare-ui-art.py turns whatever sits in art-inbox/ into assets/ui/art/*.webp plus
// manifest.json. Every delivered slot becomes
//   - a CSS variable   --art-<slot>: url(...)
//   - a token in       <html data-art="bg-menu fx-grunge ...">
// so stylesheets can branch on html[data-art~='bg-menu'] and otherwise keep their code-drawn
// look. Arena plates are also kept as decoded images for the canvas stage.
//
// kind 'plate': opaque artwork (webp, no alpha).
// kind 'mask':  white artwork whose alpha carries the shape; tint it with a CSS mask.

export type ArtKind = 'plate' | 'mask';
export interface ArtEntry { slot: string; file: string; url: string; width: number; height: number; kind: ArtKind }
interface ManifestSlot { file: string; width: number; height: number; kind: ArtKind }
interface Manifest { version: number; slots: Record<string, ManifestSlot> }

const entries = new Map<string, ArtEntry>();
const images = new Map<string, HTMLImageElement>();
let revision = 0;

/** Bumps whenever a canvas-side image arrives, so Stage can rebuild lazily. */
export const artRevision = () => revision;
export const artEntry = (slot: string) => entries.get(slot) ?? null;
export const artImage = (slot: string) => images.get(slot) ?? null;
export const artSlots = (prefix = '') => [...entries.keys()].filter((slot) => slot.startsWith(prefix)).sort();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object') return false;
  const slots = (value as Manifest).slots;
  return typeof (value as Manifest).version === 'number' && !!slots && typeof slots === 'object';
}

export async function loadUiArt(): Promise<void> {
  let manifest: unknown;
  try {
    const response = await fetch(new URL(`assets/ui/art/manifest.json?t=${Date.now()}`, document.baseURI), { cache: 'no-store' });
    if (!response.ok) return;
    manifest = await response.json();
  } catch {
    return;
  }
  if (!isManifest(manifest)) return;

  const root = document.documentElement;
  const delivered: string[] = [];
  await Promise.all(Object.entries(manifest.slots).map(async ([slot, meta]) => {
    if (!/^[a-z0-9-]+$/.test(slot) || !meta?.file) return;
    const url = new URL(`assets/ui/art/${meta.file}?v=${manifest.version}`, document.baseURI).href;
    // Plates are preloaded so they fade in complete instead of painting top-down.
    if (meta.kind === 'plate' || slot.startsWith('bg-arena')) {
      const image = await loadImage(url);
      if (!image) return;
      images.set(slot, image);
      revision += 1;
    }
    entries.set(slot, { slot, ...meta, url });
    root.style.setProperty(`--art-${slot}`, `url("${url}")`);
    delivered.push(slot);
  }));
  root.dataset.art = delivered.sort().join(' ');
  window.dispatchEvent(new CustomEvent('mujica:ui-art', { detail: { slots: delivered } }));
}
