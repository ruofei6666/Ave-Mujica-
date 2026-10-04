import { CHARACTER_IDS, type CharacterId, type MatchResult } from '../../shared/types';

export const LADDER_STORAGE_KEY = 'ave-theatre-ladder-v1';
export interface LadderMatch { player: CharacterId; opponent: CharacterId; level: number }
export interface LadderProgress {
  version: 1;
  cleared: Record<CharacterId, Record<CharacterId, number>>;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

// Store completed levels, so a new pairing naturally starts at level 1. Only
// known characters and safe whole numbers survive a damaged or older save.
export function readLadderProgress(raw: unknown): LadderProgress {
  const source = object(raw);
  const saved = source.version === 1 ? object(source.cleared) : {};
  const cleared = {} as LadderProgress['cleared'];
  for (const player of CHARACTER_IDS) {
    const row = object(saved[player]);
    cleared[player] = {} as Record<CharacterId, number>;
    for (const opponent of CHARACTER_IDS) {
      const value = row[opponent];
      cleared[player][opponent] = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
        ? value : 0;
    }
  }
  return { version: 1, cleared };
}

export function mergeLadderProgress(a: LadderProgress, b: LadderProgress): LadderProgress {
  const merged = readLadderProgress(a);
  for (const player of CHARACTER_IDS) for (const opponent of CHARACTER_IDS) {
    merged.cleared[player][opponent] = Math.max(a.cleared[player][opponent], b.cleared[player][opponent]);
  }
  return merged;
}

export const ladderLevel = (progress: LadderProgress, player: CharacterId, opponent: CharacterId) => progress.cleared[player][opponent] + 1;

export function settleLadderMatch(progress: LadderProgress, match: LadderMatch, result: MatchResult | null): LadderProgress {
  const next = readLadderProgress(progress);
  // A win advances exactly the pairing captured at match start. Replayed,
  // unfinished, lost, drawn and stale matches can never grant extra levels.
  if (result?.winner === 0 && match.level === ladderLevel(next, match.player, match.opponent)) {
    next.cleared[match.player][match.opponent] = Math.min(match.level, Number.MAX_SAFE_INTEGER - 1);
  }
  return next;
}
