import type { Card } from './cards';

/** 會開啟回應時間窗的出牌種類 */
export type PlayKind =
  | 'steal'
  | 'salmon'
  | 'switch'
  | 'chef'
  | 'wave'
  | 'reverse'
  | 'watchout'
  | 'net'
  | 'fisher'
  | 'torpedo';

/** 單體功能牌（可被 Pass 轉移） */
export const SINGLE_TARGET_PLAYS: readonly PlayKind[] = ['steal', 'salmon', 'switch'];

export type WinReason = 'lastStanding' | 'collection';

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  alive: boolean;
  hand: Card[];
}

export interface ChainItem {
  kind: 'base' | 'noway' | 'pass';
  player: number;
  cardIds: string[];
  /** pass：轉移到的玩家 */
  to?: number;
}

/** 等待回應時間窗結算的動作鏈 */
export interface Chain {
  actor: number;
  play: PlayKind;
  /** 單體功能牌原始目標 */
  target?: number;
  /** 漁網：出牌前棄牌堆頂那張 */
  netCardId?: string;
  items: ChainItem[];
}

export type Prompt =
  | { kind: 'draw'; player: number }
  | { kind: 'play'; player: number }
  | { kind: 'placePuffer'; player: number; card: Card }
  | { kind: 'response'; declined: number[] }
  | { kind: 'fisher'; player: number; cards: Card[] }
  | { kind: 'chef'; player: number; cards: Card[] }
  | { kind: 'slap'; actor: number; players: number[]; slaps: { player: number; t: number }[] };

export type Step =
  | { kind: 'beginTurn' }
  | { kind: 'promptPlay' }
  | { kind: 'endTurn' }
  | { kind: 'gain'; player: number; card: Card }
  | { kind: 'resolveChain' }
  | { kind: 'bomb'; player: number; aside: Card[] };

export interface Timer {
  id: number;
  ms: number;
}

export interface GameState {
  players: PlayerState[];
  /** deck[0] 是牌堆頂 */
  deck: Card[];
  /** 最後一張是棄牌堆頂 */
  discard: Card[];
  /** 移出遊戲的牌 */
  removed: Card[];
  direction: 1 | -1;
  turn: number;
  turnCount: number;
  phase: 'playing' | 'ended';
  winner: number | null;
  winReason: WinReason | null;
  prompt: Prompt | null;
  queue: Step[];
  chain: Chain | null;
  timer: Timer | null;
  timerSeq: number;
  nextTurnOverride: number | null;
}

export type Action =
  | { type: 'draw'; player: number }
  | { type: 'play'; player: number; cards: string[]; target?: number }
  | { type: 'respond'; player: number; card: string }
  | { type: 'decline'; player: number }
  | { type: 'placePuffer'; player: number; position: number }
  | { type: 'fisherChoose'; player: number; keep: string[]; returnOrder: string[] }
  | { type: 'chefArrange'; player: number; keep: string; order: string[] }
  | { type: 'slap'; player: number; t: number }
  | { type: 'timeout'; timerId: number };

export type PlayLabel = 'discard' | 'win' | PlayKind;

export type GameEvent = (
  | { type: 'turnStart'; player: number }
  | { type: 'draw'; player: number; count: number }
  | { type: 'gotCards'; player: number; cards: Card[] }
  /** 只有自己看得到、但還沒進手牌的牌（漁販、Chef） */
  | { type: 'peek'; player: number; cards: Card[] }
  | { type: 'deckEmpty'; player: number }
  | { type: 'pufferDefused'; player: number }
  | { type: 'pufferPlaced'; player: number; position?: number }
  | { type: 'eliminated'; player: number; reason: 'puffer' | 'torpedo' }
  | { type: 'played'; player: number; cards: Card[]; play: PlayLabel; target?: number }
  | { type: 'responded'; player: number; card: Card; passTo?: number }
  | { type: 'windowClosed'; cancelled: boolean }
  | { type: 'stole'; player: number; target: number; card?: Card }
  | { type: 'switched'; player: number; target: number }
  | { type: 'reversed'; direction: 1 | -1 }
  | { type: 'waved'; count: number }
  | { type: 'netTaken'; player: number; card: Card }
  | { type: 'chefDealt'; player: number; recipients: number[] }
  | { type: 'fisherDone'; player: number; kept: number; returned: number }
  | { type: 'slapResult'; loser: number; slaps: { player: number; t: number }[] }
  | { type: 'handReset'; player: number; count: number }
  | { type: 'bombStart'; player: number }
  | { type: 'bombDraw'; player: number; card: Card }
  | { type: 'skipPlay'; player: number }
  | { type: 'gameOver'; winner: number; reason: WinReason }
) & { to?: number[] };

export interface PlayerSeat {
  id: string;
  name: string;
  isBot: boolean;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}
