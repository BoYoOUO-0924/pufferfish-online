/** 每位玩家只能看到自己該看的資訊（規格書第 10 節：公開／隱藏資訊）。 */
import type { Card } from './cards';
import { canNoway, canPass, evalChain, isDeep } from './engine';
import type { GameEvent, GameState, PlayKind, Timer, Variant, WinReason } from './types';

export type PromptView =
  | { kind: 'draw'; player: number }
  | { kind: 'play'; player: number; canEnd: boolean; plays: number }
  | { kind: 'placePuffer'; player: number; deckCount: number }
  | { kind: 'response'; declinedByYou: boolean; canNoway: boolean; canPassTo: number | null }
  | { kind: 'fisher'; player: number; cards?: Card[] }
  | { kind: 'chef'; player: number; cards?: Card[]; cardCount: number }
  | { kind: 'slap'; actor: number; players: number[]; slappedByYou: boolean }
  | { kind: 'sonar'; player: number; cards?: Card[]; cardCount: number };

export interface ChainView {
  actor: number;
  play: PlayKind;
  target: number | undefined;
  baseCancelled: boolean;
  items: { kind: 'base' | 'noway' | 'pass'; player: number; to?: number; cancelled: boolean }[];
}

export interface PlayerView {
  you: number;
  phase: GameState['phase'];
  winner: number | null;
  winReason: WinReason | null;
  turn: number;
  turnCount: number;
  direction: 1 | -1;
  players: { id: string; name: string; isBot: boolean; alive: boolean; handCount: number; deepDive: boolean }[];
  variant: Variant;
  /** 深海變體：你確實知道的牌堆頂（由上往下） */
  knownTop: Card[];
  hand: Card[];
  deckCount: number;
  discard: Card[];
  removedCount: number;
  prompt: PromptView | null;
  chain: ChainView | null;
  timer: Timer | null;
}

export function viewFor(s: GameState, you: number): PlayerView {
  let prompt: PromptView | null = null;
  const p = s.prompt;
  if (p) {
    switch (p.kind) {
      case 'draw':
        prompt = { kind: 'draw', player: p.player };
        break;
      case 'play':
        prompt = {
          kind: 'play',
          player: p.player,
          canEnd: isDeep(s) && !!s.turnPlays,
          plays: isDeep(s) ? (s.turnPlays ?? 0) : 0,
        };
        break;
      case 'placePuffer':
        prompt = { kind: 'placePuffer', player: p.player, deckCount: s.deck.length };
        break;
      case 'response':
        prompt = {
          kind: 'response',
          declinedByYou: p.declined.includes(you),
          canNoway: canNoway(s, you) && !!s.players[you]?.hand.some((c) => c.kind === 'noway'),
          canPassTo: s.players[you]?.hand.some((c) => c.kind === 'pass') ? canPass(s, you) : null,
        };
        break;
      case 'fisher':
        prompt = { kind: 'fisher', player: p.player, cards: p.player === you ? p.cards : undefined };
        break;
      case 'chef':
        prompt = {
          kind: 'chef',
          player: p.player,
          cards: p.player === you ? p.cards : undefined,
          cardCount: p.cards.length,
        };
        break;
      case 'sonar':
        prompt = {
          kind: 'sonar',
          player: p.player,
          cards: p.player === you ? p.cards : undefined,
          cardCount: p.cards.length,
        };
        break;
      case 'slap':
        prompt = {
          kind: 'slap',
          actor: p.actor,
          players: p.players,
          slappedByYou: p.slaps.some((x) => x.player === you),
        };
        break;
    }
  }

  let chain: ChainView | null = null;
  if (s.chain) {
    const ev = evalChain(s.chain);
    chain = {
      actor: s.chain.actor,
      play: s.chain.play,
      target: ev.target,
      baseCancelled: ev.baseCancelled,
      items: s.chain.items.map((it, i) => ({
        kind: it.kind,
        player: it.player,
        to: it.to,
        cancelled: ev.cancelled[i]!,
      })),
    };
  }

  return {
    you,
    phase: s.phase,
    winner: s.winner,
    winReason: s.winReason,
    turn: s.turn,
    turnCount: s.turnCount,
    direction: s.direction,
    variant: s.variant ?? 'classic',
    knownTop: s.known?.[you] ?? [],
    players: s.players.map((pl, i) => ({
      id: pl.id,
      name: pl.name,
      isBot: pl.isBot,
      alive: pl.alive,
      handCount: pl.hand.length,
      deepDive: !!s.deepDive?.[i],
    })),
    hand: s.players[you]?.hand ?? [],
    deckCount: s.deck.length,
    discard: s.discard,
    removedCount: s.removed.length,
    prompt,
    chain,
    timer: s.timer,
  };
}

/** 過濾出這位玩家可以收到的事件 */
export function eventsFor(events: GameEvent[], you: number): GameEvent[] {
  return events
    .filter((e) => !e.to || e.to.includes(you))
    .map(({ to: _to, ...rest }) => rest as GameEvent);
}
