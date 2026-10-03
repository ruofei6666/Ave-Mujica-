import type { CharacterId } from '../../shared/types';
import type { WalkFrames } from './walk-animation';

export type AssetKind = 'atlas' | 'portrait' | 'avatar' | 'cutin';
export interface AssetFrame {
  rect: [number, number, number, number];
  pivot: [number, number];
  weapon: string;
}
export interface CharacterAsset {
  id: CharacterId; name: string; weapon: string;
  url: string; portrait: string; avatar: string; cutin: string; height: number;
  frames: Record<string, AssetFrame>; portraitSize: [number, number];
  animationFrameCount?: number; faceCropSource?: string;
  instrument?: { description: string; strings: number | null; reference: string };
}
export interface CharacterAssetManifest {
  version: number; generatedAt: string; generator: string;
  characters: Record<CharacterId, CharacterAsset>;
}
export interface LoadedCharacter {
  atlas: HTMLImageElement | null; portrait: HTMLImageElement | null; cutin: HTMLImageElement | null;
  walkFrames?: WalkFrames;
}
export interface CharacterLook {
  id: CharacterId; name: string; full: string; code: string; role: string;
  accent: string; accent2: string; glow: string; dark: string;
  flowerCN: string; meaning: string; flowerA: string; flowerB: string; flowerC: string;
}
export interface DrawCharacterOptions { reduced?: boolean; lw?: number; noFlicker?: boolean; walkAmount?: number }
export interface ShowcaseOptions { mode?: 'bust' | 'full'; reduced?: boolean; fill?: number }
