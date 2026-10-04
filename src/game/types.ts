import type { CharacterId, Input, Mode, Seat, SkillSlot, Snapshot } from '../../shared/types';
import type { LadderMatch, LadderProgress } from './ladder-progress';
import type { CameraView } from './camera';
export type { Action, AttackAction, Character, CharacterId, CombatEvent, CombatWorld, Difficulty, FighterSnapshot, Input, MatchResult, Mode, Move, Seat, SkillSlot, Snapshot, WorldOptions } from '../../shared/types';
export type Screen = 'menu' | 'room' | 'battle';
export type VolumeChannel = 'music' | 'sfx' | 'voice';
export type Volumes = Record<VolumeChannel, number>;
export type VoiceCue = 'select' | 'ult' | 'ko';

export interface Settings extends Volumes {
  player: CharacterId;
  opponent: CharacterId;
  lowMotion: boolean;
  audioRev?: number;
  artRev?: number;
}
export interface Records {
  played: number; won: number; drawn: number; bestStreak: number; streak: number;
}
export interface RoomPlayer { character: CharacterId; ready: boolean; connected: boolean }
export interface RoomState {
  type: 'room'; code: string; seat: Seat;
  players: [RoomPlayer | null, RoomPlayer | null]; phase: 'lobby' | 'battle' | 'result';
}
export type ServerMessage = RoomState
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'error' | 'left'; message: string }
  | { type: 'pong'; at: number | null };
export type ClientMessage = { type: 'create' | 'select'; character: CharacterId }
  | { type: 'join'; character: CharacterId; code: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'input'; seq: number; input: Partial<Input> }
  | { type: 'ping'; at: number }
  | { type: 'rematch' | 'leave' };
export interface SkillDetail { id: CharacterId; seat: Seat; name?: string; slot?: SkillSlot }
export interface GameDiagnostics {
  mode: Mode; screen: Screen; seat: Seat; room: string | null; snapshot: Snapshot | null;
  paused: boolean; finished: boolean; records: Records;
  ladderMatch: LadderMatch | null; ladderProgress: LadderProgress;
  camera: CameraView;
}
