/** 電腦玩家：簡單策略。伺服器負責加上延遲，這裡只做決定。 */
import { LAYERS, isSpecies, layerOf, type Card, type Layer, type Species } from './cards';
import { canNoway, canPass, evalChain, legalPlays, type LegalPlay } from './engine';
import { pick, randInt, shuffle, type Rng } from './rng';
import type { Action, GameState } from './types';

/** 依手牌決定要收集的海洋層（種類較多的那一層） */
function goalLayer(hand: Card[], rng: Rng): Layer {
  const count = (layer: Layer) =>
    new Set(hand.filter((c) => isSpecies(c.kind) && layerOf(c.kind as Species) === layer).map((c) => c.kind)).size;
  const a = count('shallow');
  const b = count('deep');
  if (a === b) return rng.next() < 0.5 ? 'shallow' : 'deep';
  return a > b ? 'shallow' : 'deep';
}

function cardValue(card: Card, hand: Card[], goal: Layer): number {
  if (card.kind === 'puffer') return -100;
  if (card.kind === 'chill') return 100;
  if (isSpecies(card.kind)) {
    const needed =
      layerOf(card.kind) === goal && !hand.some((c) => c.kind === card.kind && c.id !== card.id);
    return needed ? 50 : 10;
  }
  if (card.kind === 'noway' || card.kind === 'pass') return 40;
  return 25;
}

function chooseByValue(cards: Card[], hand: Card[], goal: Layer): Card[] {
  return [...cards].sort((x, y) => cardValue(y, hand, goal) - cardValue(x, hand, goal));
}

function toAction(player: number, p: LegalPlay): Action {
  return { type: 'play', player, cards: p.cards, target: p.target };
}

function botPlay(s: GameState, player: number, rng: Rng): Action | null {
  const plays = legalPlays(s, player);
  if (plays.length === 0) return null;
  const win = plays.find((p) => p.label === 'win');
  if (win) return toAction(player, win);

  const hand = s.players[player]!.hand;
  const goal = goalLayer(hand, rng);
  const goalSpecies = LAYERS[goal] as readonly string[];

  const top = s.discard[s.discard.length - 1];
  const net = plays.find((p) => p.label === 'net');
  if (net && top && (top.kind === 'chill' || (goalSpecies.includes(top.kind) && !hand.some((c) => c.kind === top.kind)))) {
    return toAction(player, net);
  }
  const torpedo = plays.find((p) => p.label === 'torpedo');
  if (torpedo && rng.next() < 0.6) return toAction(player, torpedo);
  const fisher = plays.find((p) => p.label === 'fisher');
  if (fisher && rng.next() < 0.5) return toAction(player, fisher);

  const steals = plays.filter((p) => p.label === 'steal');
  if (steals.length && rng.next() < 0.35) {
    const best = steals.reduce((a, b) =>
      s.players[b.target!]!.hand.length > s.players[a.target!]!.hand.length ? b : a,
    );
    return toAction(player, best);
  }

  // 丟掉用不到的生物：非目標層，或目標層裡重複的
  const junk = plays.filter((p) => {
    if (p.label !== 'discard') return false;
    const card = hand.find((c) => c.id === p.cards[0])!;
    const dup = hand.filter((c) => c.kind === card.kind).length > 1;
    return !goalSpecies.includes(card.kind) || dup;
  });
  if (junk.length && rng.next() < 0.7) return toAction(player, pick(rng, junk));

  const functions = plays.filter((p) => p.cards.length === 1 && p.label !== 'discard');
  if (functions.length) return toAction(player, pick(rng, functions));
  if (junk.length) return toAction(player, pick(rng, junk));
  const singles = plays.filter((p) => p.label === 'discard');
  return toAction(player, pick(rng, singles.length ? singles : plays));
}

function botRespond(s: GameState, player: number, rng: Rng): Action {
  const decline: Action = { type: 'decline', player };
  const ch = s.chain;
  if (!ch) return decline;
  const hand = s.players[player]!.hand;
  const noway = hand.find((c) => c.kind === 'noway');
  const pass = hand.find((c) => c.kind === 'pass');
  const ev = evalChain(ch);
  const singleTarget = ch.play === 'steal' || ch.play === 'salmon' || ch.play === 'switch';

  if (!ev.baseCancelled && singleTarget && ev.target === player) {
    if (pass && canPass(s, player) !== null && rng.next() < 0.8) {
      return { type: 'respond', player, card: pass.id };
    }
    if (noway && canNoway(s, player) && rng.next() < 0.7) {
      return { type: 'respond', player, card: noway.id };
    }
  }
  if (ev.baseCancelled && ch.actor === player && noway && canNoway(s, player) && rng.next() < 0.7) {
    return { type: 'respond', player, card: noway.id };
  }
  if (!ev.baseCancelled && ch.play === 'torpedo' && ch.actor !== player && noway && canNoway(s, player) && rng.next() < 0.4) {
    return { type: 'respond', player, card: noway.id };
  }
  return decline;
}

/** 電腦玩家（或斷線代打）在目前提示下的決定；不需要它動作時回傳 null */
export function botAction(s: GameState, player: number, rng: Rng): Action | null {
  const p = s.prompt;
  if (!p || s.phase !== 'playing' || !s.players[player]?.alive) return null;
  switch (p.kind) {
    case 'draw':
      return p.player === player ? { type: 'draw', player } : null;
    case 'play':
      return p.player === player ? botPlay(s, player, rng) : null;
    case 'placePuffer':
      if (p.player !== player) return null;
      return {
        type: 'placePuffer',
        player,
        position: rng.next() < 0.5 ? 0 : randInt(rng, s.deck.length + 1),
      };
    case 'response':
      return p.declined.includes(player) ? null : botRespond(s, player, rng);
    case 'fisher': {
      if (p.player !== player) return null;
      const hand = s.players[player]!.hand;
      const ranked = chooseByValue(p.cards, hand, goalLayer(hand, rng));
      const k = Math.min(3, ranked.length);
      const rest = ranked.slice(k);
      // 河豚放在最上面，留給下一位
      rest.sort((a, b) => (b.kind === 'puffer' ? 1 : 0) - (a.kind === 'puffer' ? 1 : 0));
      return {
        type: 'fisherChoose',
        player,
        keep: ranked.slice(0, k).map((c) => c.id),
        returnOrder: rest.map((c) => c.id),
      };
    }
    case 'chef': {
      if (p.player !== player) return null;
      const hand = s.players[player]!.hand;
      const ranked = chooseByValue(p.cards, hand, goalLayer(hand, rng));
      const rest = shuffle(rng, ranked.slice(1));
      rest.sort((a, b) => (b.kind === 'puffer' ? 1 : 0) - (a.kind === 'puffer' ? 1 : 0));
      return { type: 'chefArrange', player, keep: ranked[0]!.id, order: rest.map((c) => c.id) };
    }
    case 'slap':
      if (!p.players.includes(player) || p.slaps.some((x) => x.player === player)) return null;
      return { type: 'slap', player, t: botSlapDelay(rng) };
  }
}

/** Watch Out 電腦反應時間（毫秒） */
export function botSlapDelay(rng: Rng): number {
  return 400 + Math.round(rng.next() * 800);
}
