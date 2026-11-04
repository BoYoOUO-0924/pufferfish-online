/** 前端與房間伺服器之間的訊息格式（WebSocket，JSON） */
import type { Action, GameEvent, PlayerView } from '@pufferfish/engine';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 玩家可以送出的遊戲動作（player 由伺服器依連線填入；timeout 只有伺服器能送） */
export type ClientAction = DistributiveOmit<Exclude<Action, { type: 'timeout' }>, 'player'>;

export type ClientMessage =
  | { type: 'join'; name: string; token?: string }
  | { type: 'addBot' }
  | { type: 'removeBot'; seatId: string }
  | { type: 'start' }
  | { type: 'action'; action: ClientAction }
  | { type: 'rematch' }
  | { type: 'leave' }
  /** rtt：前端上一次量到的來回延遲（毫秒），用於 Watch Out 公平性 */
  | { type: 'ping'; t: number; rtt?: number };

export interface SeatInfo {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  /** 斷線中由電腦代打 */
  botControlled: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export type ServerMessage =
  | { type: 'joined'; playerId: string; token: string; code: string }
  | { type: 'room'; code: string; phase: RoomPhase; hostId: string | null; seats: SeatInfo[]; you: string | null }
  | { type: 'state'; view: PlayerView; deadline: number | null; serverNow: number }
  | { type: 'events'; events: GameEvent[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number; serverNow: number };

export const MAX_NAME_LENGTH = 12;
export const ROOM_CODE_LENGTH = 6;
/** 避開容易混淆的字元（0/O、1/I/L） */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}
