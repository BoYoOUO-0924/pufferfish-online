/**
 * 深海變體的電腦玩家（普通強度），和原版電腦玩家分開調整。
 *
 * 公平性：只用自己的手牌、自己確實知道的牌堆頂（浮潛／聲納看到的）、棄牌堆、
 * 各家手牌張數、牌堆張數、淘汰人數與動作鏈。不讀取牌堆內容或別人的手牌。
 */
import { LAYERS, isSpecies, layerOf, type Card, type Layer, type Species } from './cards';
import { canNoway, canPass, evalChain, legalPlays, nextAlive, type LegalPlay } from './engine';
import { randInt, type Rng } from './rng';
import type { Action, GameState } from './types';

interface Knowledge {
  me: number;
  hand: Card[];
  chill: number;
  goal: Layer;
  missing: Species[];
  /** 隨機抽一張是河豚的機率（公開資訊估計） */
  risk: number;
  /** 這回合抽牌抽到河豚的機率：知道牌堆頂就是 0 或 1，深潛則用平均機率 */
  danger: number;
  /** 這回合已出牌次數 */
  plays: number;
  deepDive: boolean;
  handCounts: number[];
  alive: number;
}

function know(s: GameState, me: number, rng: Rng): Knowledge {
  const hand = s.players[me]!.hand;
  const dead = s.players.filter((p) => !p.alive).length;
  const puffers = s.players.length - dead;
  const risk = s.deck.length ? Math.min(1, puffers / s.deck.length) : 1;
  const top = s.known?.[me]?.[0];
  const deepDive = !!s.deepDive?.[me];
  const danger = deepDive || !top ? risk : top.kind === 'puffer' ? 1 : 0;
  const goal = goalLayer(hand, rng);
  const have = new Set(hand.map((c) => c.kind));
  return {
    me,
    hand,
    chill: hand.filter((c) => c.kind === 'chill').length,
    goal,
    missing: LAYERS[goal].filter((sp) => !have.has(sp)),
    risk,
    danger,
    plays: s.turnPlays ?? 0,
    deepDive,
    handCounts: s.players.map((p) => p.hand.length),
    alive: s.players.length - dead,
  };
}

function goalLayer(hand: Card[], rng: Rng): Layer {
  const count = (layer: Layer) =>
    new Set(hand.filter((c) => isSpecies(c.kind) && layerOf(c.kind) === layer).map((c) => c.kind)).size;
  const a = count('shallow');
  const b = count('deep');
  if (a === b) return rng.next() < 0.5 ? 'shallow' : 'deep';
  return a > b ? 'shallow' : 'deep';
}

/** 一張牌對自己的價值（越高越想留著） */
function cardValue(card: Card, k: Knowledge, pool: Card[] = k.hand): number {
  switch (card.kind) {
    case 'puffer':
      return -1000;
    case 'chill':
      return k.chill >= 2 ? 120 : 220;
    case 'noway':
      return 70;
    case 'pass':
      return 55;
    case 'chef':
      return 60;
    case 'steal':
      return 50;
    case 'wave':
      return 45; // 深海變體：可以打亂別人排好的牌堆
    case 'salmon':
      return 40;
    case 'switch':
      return 35;
    case 'watchout':
      return 25;
    case 'reverse':
      return 20;
  }
  const owned = pool.filter((c) => c.kind === card.kind && c.id !== card.id).length;
  if (layerOf(card.kind as Species) === k.goal) return owned === 0 ? 90 + 10 * (5 - k.missing.length) : 22;
  return owned >= 1 ? 24 : 10; // 湊同種可以拖網／魚雷
}

const value = (p: LegalPlay, k: Knowledge) =>
  p.cards.reduce((sum, id) => sum + cardValue(k.hand.find((c) => c.id === id)!, k), 0);
const cheapest = (plays: LegalPlay[], k: Knowledge) => plays.reduce((a, b) => (value(b, k) < value(a, k) ? b : a));
const toAction = (player: number, p: LegalPlay): Action => ({ type: 'play', player, cards: p.cards, target: p.target });

function richest(k: Knowledge, candidates: number[]): number | undefined {
  return [...candidates].sort((a, b) => k.handCounts[b]! - k.handCounts[a]!)[0];
}

// ───────────────────────── 出牌 ─────────────────────────

function botPlay(s: GameState, me: number, rng: Rng): Action {
  const plays = legalPlays(s, me);
  const k = know(s, me, rng);
  const end: Action = { type: 'endPlays', player: me };
  if (plays.length === 0) return end;
  const find = (label: LegalPlay['label']) => plays.filter((p) => p.label === label);
  const pickOne = (list: LegalPlay[]) => (list.length ? cheapest(list, k) : null);

  // 1. 能贏就贏
  const win = find('win')[0];
  if (win) return toAction(me, win);

  // 2. 知道這次會抽到河豚：想辦法躲
  if (k.danger >= 1) {
    const dodge =
      pickOne(find('deepdive')) ?? // 改從牌底抽
      pickOne(find('torpedo')) ?? // 魚雷結束回合，不用抽牌
      pickOne(find('sonar')) ?? // 把河豚排到第二張
      (k.chill === 0 ? (find('chef')[0] ?? find('wave')[0] ?? null) : null);
    if (dodge) return toAction(me, dodge);
    if (k.plays > 0) return end; // 有 Chill 就認了
  }

  // 3. 牌堆很危險又不知道牌堆頂：先浮潛看一眼（很便宜的資訊）
  const knowsTop = !!s.known?.[me]?.length;
  if (!knowsTop && !k.deepDive && k.risk >= 0.1) {
    const snorkel = pickOne(find('snorkel'));
    if (snorkel && (k.plays === 0 || k.chill === 0 || k.risk >= 0.2)) return toAction(me, snorkel);
  }

  // 4. 攻擊：魚雷（也可以省掉這回合的抽牌）
  const torpedo = find('torpedo')[0];
  if (torpedo && rng.next() < (k.alive >= 4 ? 0.8 : 0.55)) return toAction(me, torpedo);

  // 5. 拖網：棄牌堆頂是 Chill 或缺的種類
  const top = s.discard[s.discard.length - 1];
  const nets = find('net');
  if (nets.length && top && (top.kind === 'chill' || (k.missing as string[]).includes(top.kind))) {
    return toAction(me, cheapest(nets, k));
  }

  // 6. 沒有 Chill：自保
  if (k.chill === 0) {
    const chef = find('chef')[0];
    if (chef) return toAction(me, chef);
    const steals = find('steal');
    if (steals.length) {
      const t = richest(k, steals.map((p) => p.target!));
      return toAction(me, steals.find((p) => p.target === t)!);
    }
  }

  // 7. 已經出過牌：沒有明顯好處就結束，留著手牌
  if (k.plays > 0) {
    const salmon = find('salmon')[0];
    if (salmon && k.risk >= 0.15 && rng.next() < 0.5) return toAction(me, salmon);
    return end;
  }

  // 8. 第一次出牌：河豚密時攻擊下一位，否則丟最沒用的牌
  if (k.risk >= 0.15) {
    const salmon = find('salmon')[0];
    if (salmon && rng.next() < 0.6) return toAction(me, salmon);
    const watchout = find('watchout')[0];
    if (watchout && rng.next() < 0.3) return toAction(me, watchout);
  }
  const steals = find('steal');
  if (steals.length && rng.next() < 0.2) {
    const t = richest(k, steals.map((p) => p.target!));
    return toAction(me, steals.find((p) => p.target === t)!);
  }
  const creatures = [...find('snorkel'), ...find('deepdive')];
  const junk = creatures.filter((p) => value(p, k) < 50);
  // 便宜的生物優先用浮潛（多一點資訊）
  const snorkelJunk = junk.filter((p) => p.label === 'snorkel');
  if (snorkelJunk.length && !knowsTop) return toAction(me, cheapest(snorkelJunk, k));
  if (junk.length) return toAction(me, cheapest(junk, k));
  const singles = plays.filter((p) => p.cards.length === 1 && !creatures.includes(p));
  if (singles.length) return toAction(me, cheapest(singles, k));
  return toAction(me, cheapest(creatures.length ? creatures : plays, k));
}

// ───────────────────────── 回應 ─────────────────────────

function botRespond(s: GameState, me: number, rng: Rng): Action {
  const decline: Action = { type: 'decline', player: me };
  const ch = s.chain;
  if (!ch) return decline;
  const k = know(s, me, rng);
  const noway = k.hand.find((c) => c.kind === 'noway');
  const pass = k.hand.find((c) => c.kind === 'pass');
  const ev = evalChain(ch);
  const respondNoway = (): Action | null =>
    noway && canNoway(s, me) ? { type: 'respond', player: me, card: noway.id } : null;
  const respondPass = (): Action | null =>
    pass && canPass(s, me) !== null ? { type: 'respond', player: me, card: pass.id } : null;

  if (ev.baseCancelled) {
    if (ch.actor === me && ['torpedo', 'chef', 'sonar', 'net', 'steal'].includes(ch.play)) {
      return (rng.next() < 0.75 && respondNoway()) || decline;
    }
    return decline;
  }
  if (ev.target === me) {
    const threat =
      (ch.play === 'steal' && (k.chill > 0 || k.hand.length <= 3)) ||
      (ch.play === 'salmon' && (k.chill === 0 || k.risk >= 0.12)) ||
      (ch.play === 'switch' && (k.chill > 0 || k.missing.length <= 2));
    if (threat) return respondPass() ?? respondNoway() ?? decline;
    return decline;
  }
  if (ch.play === 'torpedo' && ch.actor !== me) return (rng.next() < 0.55 && respondNoway()) || decline;
  if (ch.play === 'net' && ch.actor !== me) {
    const taken = s.discard.find((c) => c.id === ch.netCardId);
    if (taken?.kind === 'chill' && rng.next() < 0.5) return respondNoway() ?? decline;
  }
  return decline;
}

// ───────────────────────── 其他選擇 ─────────────────────────

/** 聲納排序：自己先抽最好的那張，河豚排第二張留給下一位 */
function sonarOrder(cards: Card[], k: Knowledge): Card[] {
  const safe = cards.filter((c) => c.kind !== 'puffer').sort((a, b) => cardValue(b, k) - cardValue(a, k));
  const puffers = cards.filter((c) => c.kind === 'puffer');
  if (!safe.length) return puffers;
  return [safe[0]!, ...puffers, ...safe.slice(1)];
}

function chefOrder(s: GameState, me: number, rest: Card[]): Card[] {
  const recipients: number[] = [];
  let cur = me;
  for (let i = 0; i < rest.length; i++) {
    cur = nextAlive(s, cur);
    if (cur === me) break;
    recipients.push(cur);
  }
  const puffers = rest.filter((c) => c.kind === 'puffer');
  const others = rest.filter((c) => c.kind !== 'puffer');
  const weak = recipients.map((r, slot) => ({ slot, n: s.players[r]!.hand.length })).sort((a, b) => a.n - b.n);
  const order: (Card | undefined)[] = Array.from({ length: rest.length });
  puffers.forEach((p, i) => {
    const slot = weak[i]?.slot;
    if (slot !== undefined) order[slot] = p;
  });
  for (let i = 0; i < order.length; i++) if (!order[i]) order[i] = others.shift() ?? puffers.pop();
  return order as Card[];
}

/** 深海變體電腦玩家的決定；不需要它動作時回傳 null */
export function deepBotAction(s: GameState, player: number, rng: Rng): Action | null {
  const p = s.prompt;
  if (!p || s.phase !== 'playing' || !s.players[player]?.alive) return null;
  switch (p.kind) {
    case 'draw':
      return p.player === player ? { type: 'draw', player } : null;
    case 'play':
      return p.player === player ? botPlay(s, player, rng) : null;
    case 'placePuffer': {
      if (p.player !== player) return null;
      // 下一位可以浮潛／深潛躲開，所以不一定放最上面
      const r = rng.next();
      const position = r < 0.5 || s.deck.length === 0 ? 0 : r < 0.75 ? Math.min(1, s.deck.length) : randInt(rng, s.deck.length + 1);
      return { type: 'placePuffer', player, position };
    }
    case 'response':
      return p.declined.includes(player) ? null : botRespond(s, player, rng);
    case 'sonar':
      return p.player === player
        ? { type: 'sonarArrange', player, order: sonarOrder(p.cards, know(s, player, rng)).map((c) => c.id) }
        : null;
    case 'chef': {
      if (p.player !== player) return null;
      const k = know(s, player, rng);
      const pool = [...k.hand, ...p.cards];
      const ranked = [...p.cards].sort((a, b) => cardValue(b, k, pool) - cardValue(a, k, pool));
      return { type: 'chefArrange', player, keep: ranked[0]!.id, order: chefOrder(s, player, ranked.slice(1)).map((c) => c.id) };
    }
    case 'fisher':
      return null; // 深海變體沒有漁販
    case 'slap':
      if (!p.players.includes(player) || p.slaps.some((x) => x.player === player)) return null;
      return { type: 'slap', player, t: 400 + Math.round(rng.next() * 800) };
  }
}
