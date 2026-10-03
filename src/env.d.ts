/// <reference types="vite/client" />
import type { GameDiagnostics } from './game/types';
import type { SkillDetail } from './game/types';
declare global {
  interface WindowEventMap {
    'mujica:skill': CustomEvent<SkillDetail>;
    'mujica:ko': CustomEvent<{ seat: number; id: string }>;
    'mujica:assets': CustomEvent<{ id: string; ready: boolean }>;
    'mujica:ui-art': CustomEvent<{ slots: string[] }>;
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
  interface Window {
    AveGame?: { getState(): GameDiagnostics };
    webkitAudioContext?: typeof AudioContext;
  }
  interface Navigator { standalone?: boolean }
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  }
}
export {};
