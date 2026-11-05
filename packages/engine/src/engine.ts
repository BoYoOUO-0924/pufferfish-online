/**
 * 規則引擎核心：(狀態, 動作) → 新狀態 + 事件。
 * 對應 docs/規則規格書.md。本模組不依賴任何平台，也不讀取真實時間；
 * 計時由 state.timer 告知外部，外部到期時送入 { type: 'timeout' }。
 */
import { CARD_COUNTS, LAYERS, isSpecies, type Card, type CardKind, type Species } from './cards';
import { randInt, shuffle, type Rng } from './rng';
import {
  SINGLE_TARGET_PLAYS,
  type Action,
  type ApplyResult,
  type Chain,
  type GameEvent,
  type GameState,
  type PlayKind,
  type PlayLabel,
  type PlayerSeat,
  type Prompt,
  type Step,
  type Variant,
} from './types';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;
export const HAND_SIZE = 6;

export const TIMING = {
  turnMs: 30_000,
  choiceMs: 30_000,
  responseMs: 6_000,
  slapMs: 5_000,
};

export const isDeep = (s: GameState) => s.variant === 'deep';

export class EngineError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}

interface Ctx {
  s: GameState;
  rng: Rng;
  events: GameEvent[];
}

// ───────────────────────── 建立遊戲 ─────────────────────────

export function createGame(
  seats: PlayerSeat[],
  rng: Rng,
  opts: { firstPlayer?: number; variant?: Variant } = {},
): ApplyResult {
  const n = seats.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new EngineError('badPlayerCount', `玩家人數需為 ${MIN_PLAYERS}～${MAX_PLAYERS} 人`);
  }
  // 先把 75 張牌洗亂後再編號，讓 id 不透露種類
  const kinds: CardKind[] = [];
  for (const [kind, count] of Object.entries(CARD_COUNTS) as [CardKind, number][]) {
    for (let i = 0; i < count; i++) kinds.push(kind);
  }
  shuffle(rng, kinds);
  const all: Card[] = kinds.map((kind, i) => ({ id: `c${i + 1}`, kind }));

  const base = shuffle(rng, all.filter((c) => c.kind !== 'puffer' && c.kind !== 'chill'));
  const chills = all.filter((c) => c.kind === 'chill');
  const puffers = all.filter((c) => c.kind === 'puffer');

  const players = seats.map((seat) => ({
    id: seat.id,
    name: seat.name,
    isBot: seat.isBot,
    alive: true,
    hand: base.splice(0, HAND_SIZE),
  }));
  for (const p of players) p.hand.push(chills.pop()!);

  const deck = shuffle(rng, [...base, ...chills, ...puffers.slice(0, n)]);
  const removed = puffers.slice(n);

  const first = opts.firstPlayer ?? 0;
  const s: GameState = {
    players,
    deck,
    discard: [],
    removed,
    direction: 1,
    turn: first,
    turnCount: 0,
    phase: 'playing',
    winner: null,
    winReason: null,
    prompt: null,
    queue: [{ kind: 'beginTurn' }],
    chain: null,
    timer: null,
    timerSeq: 0,
    nextTurnOverride: null,
    variant: opts.variant ?? 'classic',
    deepDive: players.map(() => false),
    turnPlays: 0,
    known: players.map(() => []),
  };
  const ctx: Ctx = { s, rng, events: [] };
  run(ctx);
  return { state: s, events: ctx.events };
}

/**
 * 深海變體：玩家記得的牌堆頂只在「牌堆頂還是那張」時有效。
 * 抽走最上面一張後，第二張變成牌堆頂，記憶往前移一格；其他情況全部失效。
 */
function syncKnown(s: GameState): void {
  if (!s.known) return;
  s.known = s.known.map((list) => {
    const out = [...list];
    while (out.length && s.deck[0]?.id !== out[0]!.id) {
      if (out[1] && s.deck[0]?.id === out[1].id) out.shift();
      else return [];
    }
    // 中間被塞了牌（例如河豚放回第 2 張）：只保留仍對得上的部分
    const keep = out.findIndex((c, i) => s.deck[i]?.id !== c.id);
    return keep === -1 ? out : out.slice(0, keep);
  });
}

// ───────────────────────── 套用動作 ─────────────────────────

export function applyAction(state: GameState, action: Action, rng: Rng): ApplyResult {
  if (state.phase === 'ended') throw new EngineError('gameOver', '遊戲已結束');
  const s = structuredClone(state);
  const ctx: Ctx = { s, rng, events: [] };
  handle(ctx, action);
  run(ctx);
  syncKnown(s);
  return { state: s, events: ctx.events };
}

function handle(ctx: Ctx, a: Action): void {
  switch (a.type) {
    case 'draw':
      return onDraw(ctx, a.player);
    case 'play':
      return onPlay(ctx, a.player, a.cards, a.target);
    case 'respond':
      return onRespond(ctx, a.player, a.card);
    case 'decline':
      return onDecline(ctx, a.player);
    case 'placePuffer':
      return onPlacePuffer(ctx, a.player, a.position);
    case 'fisherChoose':
      return onFisherChoose(ctx, a.player, a.keep, a.returnOrder);
    case 'chefArrange':
      return onChefArrange(ctx, a.player, a.keep, a.order);
    case 'endPlays':
      return onEndPlays(ctx, a.player);
    case 'sonarArrange':
      return onSonarArrange(ctx, a.player, a.order);
    case 'slap':
      return onSlap(ctx, a.player, a.t);
    case 'timeout':
      return onTimeout(ctx, a.timerId);
  }
}

// ───────────────────────── 流程推進 ─────────────────────────

function run(ctx: Ctx): void {
  const { s } = ctx;
  while (s.phase === 'playing' && !s.prompt && s.queue.length > 0) {
    exec(ctx, s.queue.shift()!);
  }
}

function pushFront(ctx: Ctx, ...steps: Step[]): void {
  ctx.s.queue.unshift(...steps);
}

function promptMs(p: Prompt): number {
  switch (p.kind) {
    case 'response':
      return TIMING.responseMs;
    case 'slap':
      return TIMING.slapMs;
    case 'draw':
    case 'play':
      return TIMING.turnMs;
    default:
      return TIMING.choiceMs;
  }
}

function setPrompt(ctx: Ctx, p: Prompt): void {
  const { s } = ctx;
  s.prompt = p;
  s.timerSeq += 1;
  s.timer = { id: s.timerSeq, ms: promptMs(p) };
}

function clearPrompt(ctx: Ctx): void {
  ctx.s.prompt = null;
  ctx.s.timer = null;
}

function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

/** 同一件事對「知情者」與「其他人」送出不同內容 */
function emitSplit(ctx: Ctx, insiders: number[], secret: GameEvent, open: GameEvent): void {
  const others = ctx.s.players.map((_, i) => i).filter((i) => !insiders.includes(i));
  emit(ctx, { ...secret, to: insiders });
  if (others.length) emit(ctx, { ...open, to: others });
}

function exec(ctx: Ctx, step: Step): void {
  const { s } = ctx;
  switch (step.kind) {
    case 'beginTurn': {
      s.turnCount += 1;
      emit(ctx, { type: 'turnStart', player: s.turn });
      if (isDeep(s)) {
        // 深海變體：先出牌（可以連續出），最後才抽牌
        s.turnPlays = 0;
        return pushFront(ctx, { kind: 'promptPlay' });
      }
      setPrompt(ctx, { kind: 'draw', player: s.turn });
      return;
    }
    case 'drawPhase':
      if (!s.players[s.turn]!.alive) return pushFront(ctx, { kind: 'endTurn' });
      setPrompt(ctx, { kind: 'draw', player: s.turn });
      return;
    case 'promptPlay': {
      const p = s.turn;
      if (!s.players[p]!.alive) return pushFront(ctx, { kind: 'endTurn' });
      if (isDeep(s) && legalPlays(s, p).length === 0) {
        // 沒有能出的牌：還沒出過就公告跳過，然後抽牌
        if (!s.turnPlays) emit(ctx, { type: 'skipPlay', player: p });
        return pushFront(ctx, { kind: 'drawPhase' });
      }
      if (legalPlays(s, p).length === 0) {
        emit(ctx, { type: 'skipPlay', player: p });
        return pushFront(ctx, { kind: 'endTurn' });
      }
      setPrompt(ctx, { kind: 'play', player: p });
      return;
    }
    case 'endTurn': {
      // 深潛只在這回合有效（例如出了魚雷沒抽牌）
      if (s.deepDive) s.deepDive[s.turn] = false;
      if (s.nextTurnOverride !== null) {
        s.turn = s.nextTurnOverride;
        s.nextTurnOverride = null;
      } else {
        s.turn = nextAlive(s, s.turn);
      }
      pushFront(ctx, { kind: 'beginTurn' });
      return;
    }
    case 'gain':
      return gainCard(ctx, step.player, step.card);
    case 'resolveChain':
      return resolveChain(ctx);
    case 'bomb':
      return bombStep(ctx, step.player, step.aside);
  }
}

// ───────────────────────── 共用工具 ─────────────────────────

export function aliveCount(s: GameState): number {
  return s.players.filter((p) => p.alive).length;
}

/** 依目前方向找下一位存活玩家（from 本身可以已淘汰） */
export function nextAlive(s: GameState, from: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + s.direction * i) % n) + n) % n;
    if (s.players[idx]!.alive) return idx;
  }
  return from;
}

function drawCards(ctx: Ctx, player: number, count: number, fromBottom = false): Card[] {
  const { s } = ctx;
  const n = Math.min(count, s.deck.length);
  const cards = fromBottom ? s.deck.splice(s.deck.length - n, n).reverse() : s.deck.splice(0, n);
  if (cards.length) {
    emit(
      ctx,
      fromBottom
        ? { type: 'draw', player, count: cards.length, bottom: true }
        : { type: 'draw', player, count: cards.length },
    );
    emit(ctx, { type: 'gotCards', player, cards, to: [player] });
  }
  if (cards.length < count) emit(ctx, { type: 'deckEmpty', player });
  return cards;
}

/** 牌抽到後依序判定（河豚 → Chill／淘汰） */
function queueGains(ctx: Ctx, player: number, cards: Card[]): void {
  pushFront(ctx, ...cards.map((card): Step => ({ kind: 'gain', player, card })));
}

function gainCard(ctx: Ctx, player: number, card: Card): void {
  const { s } = ctx;
  const p = s.players[player]!;
  if (!p.alive) {
    // 已淘汰者不再拿牌：河豚洗回牌堆、其他牌進棄牌堆
    if (card.kind === 'puffer') s.deck.splice(randInt(ctx.rng, s.deck.length + 1), 0, card);
    else s.discard.push(card);
    return;
  }
  if (card.kind !== 'puffer') {
    p.hand.push(card);
    return;
  }
  const chillIdx = p.hand.findIndex((c) => c.kind === 'chill');
  if (chillIdx >= 0) {
    const [chill] = p.hand.splice(chillIdx, 1);
    s.removed.push(chill!);
    emit(ctx, { type: 'pufferDefused', player });
    setPrompt(ctx, { kind: 'placePuffer', player, card });
  } else {
    eliminate(ctx, player, card, 'puffer');
  }
}

function eliminate(ctx: Ctx, player: number, puffer: Card, reason: 'puffer' | 'torpedo'): void {
  const { s } = ctx;
  const p = s.players[player]!;
  p.alive = false;
  s.discard.push(...p.hand);
  p.hand = [];
  s.removed.push(puffer);
  emit(ctx, { type: 'eliminated', player, reason });
  if (aliveCount(s) === 1) {
    endGame(ctx, s.players.findIndex((x) => x.alive), 'lastStanding');
  }
}

function endGame(ctx: Ctx, winner: number, reason: 'lastStanding' | 'collection'): void {
  const { s } = ctx;
  s.phase = 'ended';
  s.winner = winner;
  s.winReason = reason;
  // 還沒發完的牌放回牌堆，保持 75 張守恆
  for (const step of s.queue) {
    if (step.kind === 'gain') s.deck.push(step.card);
    if (step.kind === 'bomb') s.deck.push(...step.aside);
  }
  s.prompt = null;
  s.timer = null;
  s.queue = [];
  s.chain = null;
  emit(ctx, { type: 'gameOver', winner, reason });
}

function requirePrompt<K extends Prompt['kind']>(
  s: GameState,
  kind: K,
): Extract<Prompt, { kind: K }> {
  if (!s.prompt || s.prompt.kind !== kind) throw new EngineError('wrongPhase', '現在不能這樣做');
  return s.prompt as Extract<Prompt, { kind: K }>;
}

function requirePlayer(s: GameState, player: number): void {
  if (!Number.isInteger(player) || player < 0 || player >= s.players.length) {
    throw new EngineError('badPlayer', '玩家不存在');
  }
}

function takeFromHand(s: GameState, player: number, ids: string[]): Card[] {
  const hand = s.players[player]!.hand;
  return ids.map((id) => {
    const idx = hand.findIndex((c) => c.id === id);
    if (idx < 0) throw new EngineError('cardNotInHand', '手牌中沒有這張牌');
    return hand.splice(idx, 1)[0]!;
  });
}

function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]) && new Set(a).size === a.length;
}

// ───────────────────────── 出牌分類 ─────────────────────────

interface Classified {
  label: PlayLabel;
  target?: number;
  netCardId?: string;
}

function validTarget(s: GameState, player: number, target: number | undefined): target is number {
  return (
    target !== undefined &&
    Number.isInteger(target) &&
    target >= 0 &&
    target < s.players.length &&
    target !== player &&
    s.players[target]!.alive
  );
}

/** 驗證並分類一次出牌；不合法時丟出 EngineError */
export function classifyPlay(
  s: GameState,
  player: number,
  cards: Card[],
  target?: number,
): Classified {
  if (cards.length === 0) throw new EngineError('emptyPlay', '請選擇要出的牌');
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    throw new EngineError('duplicateCard', '重複的牌');
  }
  const deep = isDeep(s);
  if (cards.length === 1) {
    const kind = cards[0]!.kind;
    if (isSpecies(kind)) {
      if (!deep) return { label: 'discard' };
      return { label: (LAYERS.shallow as readonly string[]).includes(kind) ? 'snorkel' : 'deepdive' };
    }
    switch (kind) {
      case 'chill':
        throw new EngineError('chillNotPlayable', 'Chill 不能主動打出');
      case 'puffer':
        throw new EngineError('notPlayable', '這張牌不能打出');
      case 'noway':
      case 'pass':
        throw new EngineError('responseOnly', '這張牌只能在回應時間打出');
      case 'steal':
        if (!validTarget(s, player, target) || s.players[target]!.hand.length === 0) {
          throw new EngineError('badTarget', '請指定一位有手牌的玩家');
        }
        return { label: 'steal', target };
      case 'switch':
        if (!validTarget(s, player, target)) throw new EngineError('badTarget', '請指定一位玩家');
        return { label: 'switch', target };
      case 'salmon':
        return { label: 'salmon', target: nextAlive(s, player) };
      default:
        return { label: kind };
    }
  }
  const kinds = cards.map((c) => c.kind);
  if (kinds.every(isSpecies) && deep) {
    const species = kinds as Species[];
    const same = species.every((k) => k === species[0]);
    if (same && cards.length === 2) {
      const top = s.discard[s.discard.length - 1];
      if (!top) throw new EngineError('emptyDiscard', '棄牌堆是空的，不能使用拖網');
      return { label: 'net', netCardId: top.id };
    }
    if (same && cards.length === 3) return { label: 'torpedo' };
    if (sameLayer(species) && new Set(species).size === cards.length) {
      if (cards.length === 3) return { label: 'sonar' };
      if (cards.length === 5) return { label: 'win' };
    }
    throw new EngineError('badCombo', '這個組合不能打出');
  }
  if (kinds.every(isSpecies)) {
    const species = kinds as Species[];
    if (cards.length <= 4 && species.every((k) => k === species[0])) {
      if (cards.length === 2) {
        const top = s.discard[s.discard.length - 1];
        if (!top) throw new EngineError('emptyDiscard', '棄牌堆是空的，不能使用漁網');
        return { label: 'net', netCardId: top.id };
      }
      return { label: cards.length === 3 ? 'fisher' : 'torpedo' };
    }
    if (cards.length === 5 && new Set(species).size === 5) {
      for (const layer of Object.values(LAYERS)) {
        if (species.every((k) => (layer as readonly string[]).includes(k))) return { label: 'win' };
      }
    }
  }
  throw new EngineError('badCombo', '這個組合不能打出');
}

/** 全部屬於同一海洋層時回傳該層 */
function sameLayer(species: Species[]): keyof typeof LAYERS | null {
  for (const [name, layer] of Object.entries(LAYERS) as [keyof typeof LAYERS, readonly string[]][]) {
    if (species.every((k) => layer.includes(k))) return name;
  }
  return null;
}

/** 從陣列取出所有 k 個的組合 */
function combos<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [head!, ...c]), ...combos(rest, k)];
}

export interface LegalPlay {
  cards: string[];
  label: PlayLabel;
  target?: number;
}

/** 列出代表性的合法出牌（同種牌只列一次），供電腦玩家與自動出牌使用 */
export function legalPlays(s: GameState, player: number): LegalPlay[] {
  const hand = s.players[player]!.hand;
  const res: LegalPlay[] = [];
  const others = s.players.map((_, i) => i).filter((i) => validTarget(s, player, i));
  const seen = new Set<CardKind>();
  for (const c of hand) {
    if (seen.has(c.kind)) continue;
    seen.add(c.kind);
    if (isSpecies(c.kind)) {
      res.push({ cards: [c.id], label: classifyPlay(s, player, [c]).label });
      continue;
    }
    switch (c.kind) {
      case 'chill':
      case 'puffer':
      case 'noway':
      case 'pass':
        break;
      case 'steal':
        for (const t of others) {
          if (s.players[t]!.hand.length > 0) res.push({ cards: [c.id], label: 'steal', target: t });
        }
        break;
      case 'switch':
        for (const t of others) res.push({ cards: [c.id], label: 'switch', target: t });
        break;
      case 'salmon':
        res.push({ cards: [c.id], label: 'salmon', target: nextAlive(s, player) });
        break;
      default:
        res.push({ cards: [c.id], label: c.kind });
    }
  }
  const bySpecies = new Map<Species, Card[]>();
  for (const c of hand) {
    if (isSpecies(c.kind)) bySpecies.set(c.kind, [...(bySpecies.get(c.kind) ?? []), c]);
  }
  if (isDeep(s)) {
    for (const group of bySpecies.values()) {
      if (group.length >= 2 && s.discard.length > 0) {
        res.push({ cards: group.slice(0, 2).map((c) => c.id), label: 'net' });
      }
      if (group.length >= 3) res.push({ cards: group.slice(0, 3).map((c) => c.id), label: 'torpedo' });
    }
    for (const layer of Object.values(LAYERS)) {
      const have = layer.filter((sp) => bySpecies.has(sp));
      for (const trio of combos(have, 3)) {
        res.push({ cards: trio.map((sp) => bySpecies.get(sp)![0]!.id), label: 'sonar' });
      }
      if (have.length === 5) res.push({ cards: have.map((sp) => bySpecies.get(sp)![0]!.id), label: 'win' });
    }
    return res;
  }
  for (const group of bySpecies.values()) {
    for (let k = 2; k <= Math.min(4, group.length); k++) {
      if (k === 2 && s.discard.length === 0) continue;
      const label: PlayLabel = k === 2 ? 'net' : k === 3 ? 'fisher' : 'torpedo';
      res.push({ cards: group.slice(0, k).map((c) => c.id), label });
    }
  }
  for (const layer of Object.values(LAYERS)) {
    const picks = layer.map((sp) => bySpecies.get(sp)?.[0]);
    if (picks.every(Boolean)) res.push({ cards: picks.map((c) => c!.id), label: 'win' });
  }
  return res;
}

// ───────────────────────── 動作處理 ─────────────────────────

function onDraw(ctx: Ctx, player: number): void {
  const p = requirePrompt(ctx.s, 'draw');
  if (p.player !== player) throw new EngineError('notYourTurn', '還沒輪到你');
  clearPrompt(ctx);
  // 深潛：這次從牌堆底抽
  const bottom = !!ctx.s.deepDive?.[player];
  if (bottom) ctx.s.deepDive![player] = false;
  const cards = drawCards(ctx, player, 1, bottom);
  pushFront(ctx, ...cards.map((card): Step => ({ kind: 'gain', player, card })), {
    kind: isDeep(ctx.s) ? 'endTurn' : 'promptPlay',
  });
}

function onPlay(ctx: Ctx, player: number, ids: string[], target?: number): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'play');
  if (p.player !== player) throw new EngineError('notYourTurn', '還沒輪到你');
  const hand = s.players[player]!.hand;
  const cards = ids.map((id) => {
    const c = hand.find((h) => h.id === id);
    if (!c) throw new EngineError('cardNotInHand', '手牌中沒有這張牌');
    return c;
  });
  const cl = classifyPlay(s, player, cards, target);
  const deep = isDeep(s);
  // 深海變體：出完一次後回到出牌階段，可以繼續出或結束出牌
  const after: Step = deep ? { kind: 'promptPlay' } : { kind: 'endTurn' };
  if (deep) s.turnPlays = (s.turnPlays ?? 0) + 1;
  takeFromHand(s, player, ids);
  clearPrompt(ctx);
  s.discard.push(...cards);
  emit(ctx, { type: 'played', player, cards, play: cl.label, target: cl.target });

  if (cl.label === 'win') return endGame(ctx, player, 'collection');
  if (cl.label === 'discard') return pushFront(ctx, after);
  if (cl.label === 'deepdive') {
    if (s.deepDive) s.deepDive[player] = true;
    return pushFront(ctx, after);
  }
  if (cl.label === 'snorkel') {
    // 浮潛：只看不動
    const top = s.deck[0];
    if (top) {
      emit(ctx, { type: 'peek', player, cards: [top], to: [player] });
      if (s.known) s.known[player] = [top];
    }
    emit(ctx, { type: 'snorkeled', player });
    return pushFront(ctx, after);
  }

  s.chain = {
    actor: player,
    play: cl.label,
    target: cl.target,
    netCardId: cl.netCardId,
    items: [{ kind: 'base', player, cardIds: ids }],
  };
  pushFront(ctx, { kind: 'resolveChain' }, after);
  setPrompt(ctx, { kind: 'response', declined: [player] });
}

function onEndPlays(ctx: Ctx, player: number): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'play');
  if (!isDeep(s)) throw new EngineError('wrongPhase', '原版規則每回合只出一次牌');
  if (p.player !== player) throw new EngineError('notYourTurn', '還沒輪到你');
  if (!s.turnPlays) throw new EngineError('mustPlay', '每回合至少要出一次牌');
  clearPrompt(ctx);
  pushFront(ctx, { kind: 'drawPhase' });
}

export interface ChainEval {
  baseCancelled: boolean;
  target: number | undefined;
  cancelled: boolean[];
}

/** 由上往下結算 No way：每張有效的 No way 取消它正下方那一項 */
export function evalChain(chain: Chain): ChainEval {
  const { items } = chain;
  const cancelled = items.map(() => false);
  for (let i = items.length - 1; i > 0; i--) {
    if (items[i]!.kind === 'noway' && !cancelled[i]) cancelled[i - 1] = true;
  }
  let target = chain.target;
  items.forEach((it, i) => {
    if (it.kind === 'pass' && !cancelled[i]) target = it.to;
  });
  return { baseCancelled: cancelled[0]!, target, cancelled };
}

/** Pass 的轉移對象：被指定者的下一位，跳過原出牌者；無人可轉時回傳 null */
export function passTarget(s: GameState, from: number, actor: number): number | null {
  let t = nextAlive(s, from);
  if (t === actor) t = nextAlive(s, t);
  return t === from ? null : t;
}

/** 這位玩家現在能否打出 Pass（回傳轉移對象或 null） */
export function canPass(s: GameState, player: number): number | null {
  const ch = s.chain;
  if (!ch || s.prompt?.kind !== 'response' || !SINGLE_TARGET_PLAYS.includes(ch.play)) return null;
  const ev = evalChain(ch);
  if (ev.baseCancelled || ev.target !== player) return null;
  return passTarget(s, player, ch.actor);
}

export function canNoway(s: GameState, player: number): boolean {
  const ch = s.chain;
  if (!ch || s.prompt?.kind !== 'response' || !s.players[player]?.alive) return false;
  return ch.items[ch.items.length - 1]!.player !== player;
}

function onRespond(ctx: Ctx, player: number, cardId: string): void {
  const { s } = ctx;
  requirePrompt(s, 'response');
  requirePlayer(s, player);
  const ch = s.chain!;
  if (!s.players[player]!.alive) throw new EngineError('eliminated', '你已被淘汰');
  const card = s.players[player]!.hand.find((c) => c.id === cardId);
  if (!card) throw new EngineError('cardNotInHand', '手牌中沒有這張牌');
  if (card.kind === 'noway') {
    if (!canNoway(s, player)) throw new EngineError('cannotNoway', '不能對自己的動作出 No way');
    takeFromHand(s, player, [cardId]);
    s.discard.push(card);
    ch.items.push({ kind: 'noway', player, cardIds: [cardId] });
    emit(ctx, { type: 'responded', player, card });
  } else if (card.kind === 'pass') {
    const to = canPass(s, player);
    if (to === null) throw new EngineError('cannotPass', '現在不能出 Pass');
    takeFromHand(s, player, [cardId]);
    s.discard.push(card);
    ch.items.push({ kind: 'pass', player, cardIds: [cardId], to });
    emit(ctx, { type: 'responded', player, card, passTo: to });
  } else {
    throw new EngineError('notResponseCard', '只能用 No way 或 Pass 回應');
  }
  setPrompt(ctx, { kind: 'response', declined: [player] });
}

function onDecline(ctx: Ctx, player: number): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'response');
  requirePlayer(s, player);
  if (!p.declined.includes(player)) p.declined.push(player);
  const allDeclined = s.players.every((pl, i) => !pl.alive || p.declined.includes(i));
  if (allDeclined) clearPrompt(ctx);
}

function onPlacePuffer(ctx: Ctx, player: number, position: number): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'placePuffer');
  if (p.player !== player) throw new EngineError('notYou', '不是你要放河豚');
  if (!Number.isInteger(position) || position < 0 || position > s.deck.length) {
    throw new EngineError('badPosition', '位置不正確');
  }
  s.deck.splice(position, 0, p.card);
  emitSplit(
    ctx,
    [player],
    { type: 'pufferPlaced', player, position },
    { type: 'pufferPlaced', player },
  );
  clearPrompt(ctx);
  // 自己回合抽牌時用 Chill 擋下：回合直接結束，不用再出牌
  if (!isDeep(s) && s.queue[0]?.kind === 'promptPlay' && s.turn === player) s.queue[0] = { kind: 'endTurn' };
}

function onFisherChoose(ctx: Ctx, player: number, keep: string[], returnOrder: string[]): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'fisher');
  if (p.player !== player) throw new EngineError('notYou', '不是你在選牌');
  const keepCount = Math.min(3, p.cards.length);
  const ids = p.cards.map((c) => c.id);
  if (keep.length !== keepCount || !isPermutation([...keep, ...returnOrder], ids)) {
    throw new EngineError('badChoice', `請選 ${keepCount} 張留下，其餘排好順序放回`);
  }
  const byId = new Map(p.cards.map((c) => [c.id, c]));
  s.deck.unshift(...returnOrder.map((id) => byId.get(id)!));
  clearPrompt(ctx);
  emit(ctx, { type: 'fisherDone', player, kept: keep.length, returned: returnOrder.length });
  const kept = keep.map((id) => byId.get(id)!);
  emit(ctx, { type: 'gotCards', player, cards: kept, to: [player] });
  queueGains(ctx, player, kept);
}

function onChefArrange(ctx: Ctx, player: number, keep: string, order: string[]): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'chef');
  if (p.player !== player) throw new EngineError('notYou', '不是你在分配');
  if (!isPermutation([keep, ...order], p.cards.map((c) => c.id))) {
    throw new EngineError('badChoice', '請挑 1 張並排好其餘順序');
  }
  const byId = new Map(p.cards.map((c) => [c.id, c]));
  const recipients: number[] = [];
  let cur = player;
  for (let i = 0; i < order.length; i++) {
    cur = nextAlive(s, cur);
    if (cur === player) break;
    recipients.push(cur);
  }
  clearPrompt(ctx);
  emit(ctx, { type: 'chefDealt', player, recipients });
  emit(ctx, { type: 'gotCards', player, cards: [byId.get(keep)!], to: [player] });
  const steps: Step[] = [{ kind: 'gain', player, card: byId.get(keep)! }];
  order.forEach((id, i) => {
    const r = recipients[i];
    const card = byId.get(id)!;
    if (r === undefined) {
      // 理論上不會發生（張數 = 存活人數），保險起見放回牌堆頂
      s.deck.unshift(card);
      return;
    }
    emit(ctx, { type: 'gotCards', player: r, cards: [card], to: [r] });
    steps.push({ kind: 'gain', player: r, card });
  });
  pushFront(ctx, ...steps);
}

function onSonarArrange(ctx: Ctx, player: number, order: string[]): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'sonar');
  if (p.player !== player) throw new EngineError('notYou', '不是你在排序');
  if (!isPermutation(order, p.cards.map((c) => c.id))) {
    throw new EngineError('badChoice', '請排好所有牌的順序');
  }
  const byId = new Map(p.cards.map((c) => [c.id, c]));
  const arranged = order.map((id) => byId.get(id)!);
  s.deck.unshift(...arranged);
  if (s.known) s.known[player] = arranged;
  clearPrompt(ctx);
  emit(ctx, { type: 'sonarDone', player, count: order.length });
}

function onSlap(ctx: Ctx, player: number, t: number): void {
  const { s } = ctx;
  const p = requirePrompt(s, 'slap');
  if (!p.players.includes(player)) throw new EngineError('notYou', '你不用拍這張牌');
  if (p.slaps.some((x) => x.player === player)) return;
  p.slaps.push({ player, t: Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER });
  if (p.slaps.length === p.players.length) closeSlap(ctx);
}

function closeSlap(ctx: Ctx): void {
  const { s, rng } = ctx;
  const p = requirePrompt(s, 'slap');
  const missing = p.players.filter((pl) => !p.slaps.some((x) => x.player === pl));
  let loser: number;
  if (missing.length) {
    loser = missing[randInt(rng, missing.length)]!;
  } else {
    const max = Math.max(...p.slaps.map((x) => x.t));
    const slowest = p.slaps.filter((x) => x.t === max);
    loser = slowest[randInt(rng, slowest.length)]!.player;
  }
  clearPrompt(ctx);
  emit(ctx, { type: 'slapResult', loser, slaps: p.slaps });
  const pl = s.players[loser]!;
  const count = pl.hand.length;
  s.deck.push(...pl.hand);
  pl.hand = [];
  shuffle(rng, s.deck);
  emit(ctx, { type: 'handReset', player: loser, count });
  queueGains(ctx, loser, drawCards(ctx, loser, count));
}

function onTimeout(ctx: Ctx, timerId: number): void {
  const { s } = ctx;
  if (!s.timer || s.timer.id !== timerId || !s.prompt) return; // 過期的計時器
  const p = s.prompt;
  switch (p.kind) {
    case 'response':
      clearPrompt(ctx);
      return;
    case 'slap':
      return closeSlap(ctx);
    default: {
      const action = defaultAction(s, ctx.rng);
      if (action) handle(ctx, action);
      else clearPrompt(ctx);
    }
  }
}

/** 逾時的預設動作（規格書第 10 節） */
export function defaultAction(s: GameState, rng: Rng): Action | null {
  const p = s.prompt;
  if (!p) return null;
  switch (p.kind) {
    case 'draw':
      return { type: 'draw', player: p.player };
    case 'play': {
      // 深海變體：已經出過牌就直接結束出牌
      if (isDeep(s) && s.turnPlays) return { type: 'endPlays', player: p.player };
      const plays = legalPlays(s, p.player);
      const hand = s.players[p.player]!.hand;
      const creatures = plays.filter(
        (x) => x.cards.length === 1 && isSpecies(hand.find((c) => c.id === x.cards[0])!.kind),
      );
      if (creatures.length) {
        const c = creatures[randInt(rng, creatures.length)]!;
        return { type: 'play', player: p.player, cards: c.cards };
      }
      // 最左邊一張可以出的單張牌；需要對象時隨機挑
      for (const card of s.players[p.player]!.hand) {
        const options = plays.filter((x) => x.cards.length === 1 && x.cards[0] === card.id);
        if (options.length) {
          const o = options[randInt(rng, options.length)]!;
          return { type: 'play', player: p.player, cards: o.cards, target: o.target };
        }
      }
      const any = plays[0];
      return any ? { type: 'play', player: p.player, cards: any.cards, target: any.target } : null;
    }
    case 'placePuffer':
      return { type: 'placePuffer', player: p.player, position: randInt(rng, s.deck.length + 1) };
    case 'fisher': {
      const ids = shuffle(rng, p.cards.map((c) => c.id));
      const k = Math.min(3, ids.length);
      return { type: 'fisherChoose', player: p.player, keep: ids.slice(0, k), returnOrder: ids.slice(k) };
    }
    case 'chef': {
      const ids = shuffle(rng, p.cards.map((c) => c.id));
      return { type: 'chefArrange', player: p.player, keep: ids[0]!, order: ids.slice(1) };
    }
    case 'sonar':
      return { type: 'sonarArrange', player: p.player, order: p.cards.map((c) => c.id) };
    default:
      return null;
  }
}

// ───────────────────────── 效果結算 ─────────────────────────

function resolveChain(ctx: Ctx): void {
  const { s, rng } = ctx;
  const ch = s.chain;
  s.chain = null;
  if (!ch) return;
  const ev = evalChain(ch);
  emit(ctx, { type: 'windowClosed', cancelled: ev.baseCancelled });
  if (ev.baseCancelled) return;
  const actor = ch.actor;
  const target = ev.target;

  switch (ch.play as PlayKind) {
    case 'steal': {
      if (target === undefined || !s.players[target]!.alive) return;
      const victim = s.players[target]!;
      if (victim.hand.length > 0) {
        const [card] = victim.hand.splice(randInt(rng, victim.hand.length), 1);
        if (s.players[actor]!.alive) s.players[actor]!.hand.push(card!);
        else s.discard.push(card!);
        emitSplit(
          ctx,
          [actor, target],
          { type: 'stole', player: actor, target, card },
          { type: 'stole', player: actor, target },
        );
      }
      queueGains(ctx, target, drawCards(ctx, target, 1));
      return;
    }
    case 'salmon': {
      if (target === undefined || !s.players[target]!.alive) return;
      queueGains(ctx, target, drawCards(ctx, target, 2));
      return;
    }
    case 'switch': {
      if (target === undefined || !s.players[target]!.alive) return;
      const a = s.players[actor]!;
      const b = s.players[target]!;
      [a.hand, b.hand] = [b.hand, a.hand];
      emit(ctx, { type: 'switched', player: actor, target });
      return;
    }
    case 'reverse':
      s.direction = s.direction === 1 ? -1 : 1;
      emit(ctx, { type: 'reversed', direction: s.direction });
      return;
    case 'wave': {
      if (isDeep(s)) {
        // 深海變體：只重洗牌堆，棄牌堆不動
        shuffle(rng, s.deck);
        emit(ctx, { type: 'waved', count: s.deck.length, deckOnly: true });
        return;
      }
      const waveId = ch.items[0]!.cardIds[0]!;
      const idx = s.discard.findIndex((c) => c.id === waveId);
      if (idx >= 0) s.removed.push(...s.discard.splice(idx, 1));
      const count = s.discard.length;
      s.deck.push(...s.discard);
      s.discard = [];
      shuffle(rng, s.deck);
      emit(ctx, { type: 'waved', count });
      return;
    }
    case 'chef': {
      const cards = s.deck.splice(0, Math.min(aliveCount(s), s.deck.length));
      if (cards.length === 0) return;
      emit(ctx, { type: 'peek', player: actor, cards, to: [actor] });
      setPrompt(ctx, { kind: 'chef', player: actor, cards });
      return;
    }
    case 'watchout': {
      const players = s.players.map((_, i) => i).filter((i) => i !== actor && s.players[i]!.alive);
      if (players.length === 0) return;
      setPrompt(ctx, { kind: 'slap', actor, players, slaps: [] });
      return;
    }
    case 'net': {
      const idx = s.discard.findIndex((c) => c.id === ch.netCardId);
      if (idx < 0) return;
      const [card] = s.discard.splice(idx, 1);
      emit(ctx, { type: 'netTaken', player: actor, card: card! });
      queueGains(ctx, actor, [card!]);
      return;
    }
    case 'fisher': {
      const cards = s.deck.splice(0, Math.min(5, s.deck.length));
      if (cards.length === 0) return;
      if (cards.length <= 3) {
        emit(ctx, { type: 'fisherDone', player: actor, kept: cards.length, returned: 0 });
        emit(ctx, { type: 'gotCards', player: actor, cards, to: [actor] });
        queueGains(ctx, actor, cards);
      } else {
        emit(ctx, { type: 'peek', player: actor, cards, to: [actor] });
        setPrompt(ctx, { kind: 'fisher', player: actor, cards });
      }
      return;
    }
    case 'sonar': {
      const cards = s.deck.splice(0, Math.min(4, s.deck.length));
      if (cards.length === 0) return;
      emit(ctx, { type: 'peek', player: actor, cards, to: [actor] });
      setPrompt(ctx, { kind: 'sonar', player: actor, cards });
      return;
    }
    case 'torpedo': {
      if (isDeep(s)) {
        const i = s.queue.findIndex((q) => q.kind === 'promptPlay');
        if (i >= 0) s.queue[i] = { kind: 'endTurn' };
      }
      emit(ctx, { type: 'bombStart', player: actor });
      pushFront(ctx, { kind: 'bomb', player: nextAlive(s, actor), aside: [] });
      return;
    }
  }
}

function bombStep(ctx: Ctx, player: number, aside: Card[]): void {
  const { s, rng } = ctx;
  const card = s.deck.shift();
  if (!card) {
    // 理論上不會發生（牌堆永遠至少有 1 張河豚）
    s.deck.push(...aside);
    shuffle(rng, s.deck);
    return;
  }
  emit(ctx, { type: 'bombDraw', player, card });
  if (card.kind === 'puffer') {
    s.deck.push(...aside);
    shuffle(rng, s.deck);
    eliminate(ctx, player, card, 'torpedo');
    if (s.phase === 'playing') s.nextTurnOverride = nextAlive(s, player);
    return;
  }
  aside.push(card);
  pushFront(ctx, { kind: 'bomb', player: nextAlive(s, player), aside });
}

/** 目前需要哪些玩家做決定 */
export function awaitingPlayers(s: GameState): number[] {
  const p = s.prompt;
  if (!p || s.phase !== 'playing') return [];
  switch (p.kind) {
    case 'response':
      return s.players.map((_, i) => i).filter((i) => s.players[i]!.alive && !p.declined.includes(i));
    case 'slap':
      return p.players.filter((pl) => !p.slaps.some((x) => x.player === pl));
    default:
      return [p.player];
  }
}
