import { inject, reactive, type InjectionKey } from 'vue';
import type { CharacterId, Move, SkillSlot } from './types';

interface RosterState {
  selected: CharacterId | null;
  onSelect: (id: CharacterId) => void;
  levels?: Partial<Record<CharacterId, number>>;
}
export function createTheatreState() {
  return reactive({
    rosters: {} as Record<string, RosterState>,
    ladder: { level: 1, cleared: 0, playerName: '', opponentName: '', strength: '' },
    roomPlayers: [] as ({ id: CharacterId; name: string; ready: boolean } | null)[],
    resultStats: [] as { label: string; value: string }[],
    skills: [] as { slot: SkillSlot; key: string; move: Move }[],
    offscreenOpponent: null as 'left' | 'right' | null,
    previewUltimate: () => {},
    pwaStatus: '',
    pwaUpdateAvailable: false,
    updatePwa: () => {},
  });
}
export type TheatreState = ReturnType<typeof createTheatreState>;
export const theatreKey: InjectionKey<TheatreState> = Symbol('theatre');
export function useTheatreState() {
  const state = inject(theatreKey);
  if (!state) throw new Error('Theatre components must be mounted inside the game page');
  return state;
}
