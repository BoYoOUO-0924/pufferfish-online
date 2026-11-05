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
  | 'torpedo'
  /** 深海變體：同一海洋層 3 種不同生物 */
  | 'sonar';

/** 規則版本：classic 原版；deep 深海變體（單張生物有效果、組合技改版） */
export type Variant = 'classic' | 'deep';

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
  /** 深海變體：聲納看到的牌堆頂幾張，重新排序後放回 */
  | { kind: 'sonar'; player: number; cards: Card[] }
  | { kind: 'slap'; actor: number; players: number[]; slaps: { player: number; t: number }[] };

export type Step =
  | { kind: 'beginTurn' }
  | { kind: 'promptPlay' }
  | { kind: 'endTurn' }
  | { kind: 'gain'; player: number; card: Card }
  | { kind: 'resolveChain' }
  /** 深海變體：出牌結束後的抽牌階段 */
  | { kind: 'drawPhase' }
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
  /** 規則版本（未設定視為 classic） */
  variant?: Variant;
  /** 深海變體：這回合抽牌改從牌堆底抽 */
  deepDive?: boolean[];
  /** 深海變體：這回合已經出了幾次牌（至少 1 次才能結束出牌） */
  turnPlays?: number;
  /** 深海變體：每位玩家確實知道的牌堆頂順序（浮潛、聲納看到的），牌堆頂變了就失效 */
  known?: Card[][];
}

export type Action =
  | { type: 'draw'; player: number }
  | { type: 'play'; player: number; cards: string[]; target?: number }
  | { type: 'respond'; player: number; card: string }
  | { type: 'decline'; player: number }
  | { type: 'placePuffer'; player: number; position: number }
  | { type: 'fisherChoose'; player: number; keep: string[]; returnOrder: string[] }
  | { type: 'chefArrange'; player: number; keep: string; order: string[] }
  /** 深海變體：結束出牌，進入抽牌 */
  | { type: 'endPlays'; player: number }
  | { type: 'sonarArrange'; player: number; order: string[] }
  | { type: 'slap'; player: number; t: number }
  | { type: 'timeout'; timerId: number };

/** snorkel／deepdive：深海變體的單張生物效果（不開回應時間） */
export type PlayLabel = 'discard' | 'win' | 'snorkel' | 'deepdive' | PlayKind;

export type GameEvent = (
  | { type: 'turnStart'; player: number }
  | { type: 'draw'; player: number; count: number; bottom?: boolean }
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
  /** deckOnly：深海變體只重洗牌堆，count 是牌堆張數 */
  | { type: 'waved'; count: number; deckOnly?: boolean }
  | { type: 'netTaken'; player: number; card: Card }
  | { type: 'chefDealt'; player: number; recipients: number[] }
  | { type: 'fisherDone'; player: number; kept: number; returned: number }
  | { type: 'snorkeled'; player: number }
  | { type: 'sonarDone'; player: number; count: number }
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
