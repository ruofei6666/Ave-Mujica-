import type { WebSocket } from 'ws';
import type { CharacterId, CombatWorld, Input, Seat, RoomState } from '../src/game/types';

export interface ServerOptions {
  staticRoot?: string; assetRoot?: string;
  host?: string; port?: number;
  tickRate?: number; snapshotRate?: number; duration?: number; introFrames?: number;
  maxRooms?: number; maxConnections?: number; maxConnectionsPerIp?: number;
  maxMessagesPerSecond?: number; maxPayload?: number; maxBufferedAmount?: number;
  inputTimeoutMs?: number; heartbeatIntervalMs?: number;
}
export interface Client {
  ws: WebSocket; ip: string; room: Room | null; seat: Seat | null;
  character: CharacterId | null; ready: boolean; rematch: boolean;
  lastSeq: number; lastInputAt: number; input: Input; actions: Input;
  rateWindow: number; rateCount: number; alive: boolean;
}
export interface Room {
  code: string; players: [Client | null, Client | null];
  phase: RoomState['phase']; world: CombatWorld | null; snapshotCounter: number;
}
