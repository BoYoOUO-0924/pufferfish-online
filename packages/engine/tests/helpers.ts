import {
  applyAction,
  seededRng,
  type Action,
  type ApplyResult,
  type Card,
  type CardKind,
  type GameState,
  type Prompt,
} from '../src';

let seq = 0;
export function card(kind: CardKind): Card {
  seq += 1;
  return { id: `t${seq}`, kind };
}

export interface SetupOpts {
  hands: CardKind[][];
  deck?: CardKind[];
  discard?: CardKind[];
  turn?: number;
  direction?: 1 | -1;
  /** 從抽牌階段或出牌階段開始，預設 draw */
  at?: 'draw' | 'play';
  dead?: number[];
}

/** 直接組出指定局面（不經過洗牌發牌） */
export function setup(o: SetupOpts): GameState {
  const turn = o.turn ?? 0;
  const prompt: Prompt =
    o.at === 'play' ? { kind: 'play', player: turn } : { kind: 'draw', player: turn };
  return {
    players: o.hands.map((h, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      isBot: false,
      alive: !(o.dead ?? []).includes(i),
      hand: h.map(card),
    })),
    deck: (o.deck ?? []).map(card),
    discard: (o.discard ?? []).map(card),
    removed: [],
    direction: o.direction ?? 1,
    turn,
    turnCount: 1,
    phase: 'playing',
    winner: null,
    winReason: null,
    prompt,
    queue: [],
    chain: null,
    timer: { id: 1, ms: 30_000 },
    timerSeq: 1,
    nextTurnOverride: null,
  };
}

export function act(s: GameState, a: Action, seed = 1): ApplyResult {
  return applyAction(s, a, seededRng(seed));
}

/** 連續套用動作，回傳最後狀態 */
export function chain(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce((st, a) => act(st, a).state, s);
}

export function ids(s: GameState, player: number, kind: CardKind): string[] {
  return s.players[player]!.hand.filter((c) => c.kind === kind).map((c) => c.id);
}

export function id(s: GameState, player: number, kind: CardKind): string {
  const found = ids(s, player, kind)[0];
  if (!found) throw new Error(`P${player} 沒有 ${kind}`);
  return found;
}

export function kinds(cards: Card[]): CardKind[] {
  return cards.map((c) => c.kind);
}

export function handKinds(s: GameState, player: number): CardKind[] {
  return kinds(s.players[player]!.hand);
}

/** 用計時器到期關閉回應時間窗 */
export function closeWindow(s: GameState): GameState {
  if (s.prompt?.kind !== 'response') throw new Error('現在不是回應時間窗');
  return act(s, { type: 'timeout', timerId: s.timer!.id }).state;
}

export function play(s: GameState, player: number, cards: string[], target?: number): GameState {
  return act(s, { type: 'play', player, cards, target }).state;
}
