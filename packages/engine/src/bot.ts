/**
 * 電腦玩家（普通強度），也用於斷線代打。伺服器負責加上思考延遲，這裡只做決定。
 *
 * 公平性：只使用玩家本來就知道的資訊——自己的手牌、自己正在挑的牌（漁販／Chef）、
 * 棄牌堆、各家手牌張數、牌堆張數、淘汰人數與動作鏈。絕不讀取牌堆內容或別人的手牌。
 */
import { LAYERS, isSpecies, layerOf, type Card, type Layer, type Species } from './cards';
import { canNoway, canPass, evalChain, legalPlays, nextAlive, type LegalPlay } from './engine';
import { pick, randInt, type Rng } from './rng';
import type { Action, GameState } from './types';

// ───────────────────────── 公開資訊 ─────────────────────────

interface Knowledge {
  me: number;
  hand: Card[];
  hasChill: boolean;
  chillCount: number;
  goal: Layer;
  /** 目標層還缺的種類 */
  missing: Species[];
  /** 下一張抽到河豚的機率（只用公開資訊估計） */
  pufferRisk: number;
  handCounts: number[];
  alive: boolean[];
}

function know(s: GameState, me: number, rng: Rng): Knowledge {
  const hand = s.players[me]!.hand;
  const alive = s.players.map((p) => p.alive);
  const dead = alive.filter((a) => !a).length;
  // 河豚只在淘汰時離開，所以牌堆裡的河豚數 = 開局人數 − 已淘汰人數
  const puffersInDeck = s.players.length - dead;
  const pufferRisk = s.deck.length > 0 ? Math.min(1, puffersInDeck / s.deck.length) : 1;
  const chillCount = hand.filter((c) => c.kind === 'chill').length;
  const goal = goalLayer(hand, rng);
  const have = new Set(hand.map((c) => c.kind));
  return {
    me,
    hand,
    hasChill: chillCount > 0,
    chillCount,
    goal,
    missing: LAYERS[goal].filter((sp) => !have.has(sp)),
    pufferRisk,
    handCounts: s.players.map((p) => p.hand.length),
    alive,
  };
}

/** 目標層：已收集種類較多的那一層 */
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
      return k.chillCount >= 2 ? 120 : 200;
    case 'noway':
      return 70;
    case 'pass':
      return 55;
    case 'chef':
      return 60;
    case 'steal':
      return 50;
    case 'switch':
      return 35;
    case 'salmon':
      return 40;
    case 'wave':
      return 30;
    case 'watchout':
      return 25;
    case 'reverse':
      return 20;
  }
  // 生物：目標層缺的種類最有價值；已經有的重複牌價值低
  const owned = pool.filter((c) => c.kind === card.kind && c.id !== card.id).length;
  if (layerOf(card.kind as Species) === k.goal) return owned === 0 ? 90 + 10 * (5 - k.missing.length) : 15;
  return owned >= 2 ? 18 : 8; // 湊成 3 張可以用漁販
}

function toAction(player: number, p: LegalPlay): Action {
  return { type: 'play', player, cards: p.cards, target: p.target };
}

/** 手牌最多的存活對手（偷到 Chill 的機會較大） */
function richestOpponent(k: Knowledge, candidates: number[]): number | undefined {
  return [...candidates].sort((a, b) => k.handCounts[b]! - k.handCounts[a]!)[0];
}

// ───────────────────────── 出牌 ─────────────────────────

function botPlay(s: GameState, me: number, rng: Rng): Action | null {
  const plays = legalPlays(s, me);
  if (plays.length === 0) return null;
  const k = know(s, me, rng);
  const find = (label: LegalPlay['label']) => plays.filter((p) => p.label === label);

  // 1. 能贏就贏
  const win = find('win')[0];
  if (win) return toAction(me, win);

  // 2. 漁網：棄牌堆頂是 Chill 或目標層缺的種類
  const top = s.discard[s.discard.length - 1];
  const nets = find('net');
  if (nets.length && top && (top.kind === 'chill' || (k.missing as string[]).includes(top.kind))) {
    // 用價值最低的那組
    return toAction(me, cheapest(nets, k));
  }

  // 3. 魚雷：手上 4 張同種，存活人數越多越划算
  const torpedo = find('torpedo')[0];
  const aliveCount = k.alive.filter(Boolean).length;
  if (torpedo && rng.next() < (aliveCount >= 4 ? 0.85 : 0.6)) return toAction(me, torpedo);

  // 4. 沒有 Chill：優先自保
  if (!k.hasChill) {
    const chef = find('chef')[0];
    if (chef) return toAction(me, chef); // 先看牌，挑安全的、把河豚分給別人
    const steals = find('steal');
    if (steals.length) {
      const t = richestOpponent(k, steals.map((p) => p.target!));
      return toAction(me, steals.find((p) => p.target === t)!);
    }
    const fisher = find('fisher')[0];
    if (fisher) return toAction(me, fisher); // 抽 5 選 3，有機會拿到 Chill
    const switches = find('switch');
    if (switches.length && k.hand.length <= 3) {
      const t = richestOpponent(k, switches.map((p) => p.target!));
      if (t !== undefined && k.handCounts[t]! >= k.hand.length + 2) {
        return toAction(me, switches.find((p) => p.target === t)!);
      }
    }
    const wave = find('wave')[0];
    if (wave && s.discard.length >= 6 && k.pufferRisk > 0.12) return toAction(me, wave); // 稀釋河豚
  }

  // 5. 漁販：有 3 張同種且不是目標層缺的牌
  const fishers = find('fisher').filter((p) => {
    const kind = k.hand.find((c) => c.id === p.cards[0])!.kind;
    return layerOf(kind as Species) !== k.goal || k.hand.filter((c) => c.kind === kind).length >= 4;
  });
  if (fishers.length && rng.next() < 0.7) return toAction(me, fishers[0]!);

  // 6. 河豚很密時攻擊下一位
  if (k.pufferRisk >= 0.15) {
    const salmon = find('salmon')[0];
    if (salmon && rng.next() < 0.7) return toAction(me, salmon);
    const watchout = find('watchout')[0];
    if (watchout && rng.next() < 0.4) return toAction(me, watchout);
  }

  // 7. 偶爾偷牌（目標層還缺很多時，偷牌可能偷到需要的）
  const steals = find('steal');
  if (steals.length && k.hasChill && rng.next() < 0.25) {
    const t = richestOpponent(k, steals.map((p) => p.target!));
    return toAction(me, steals.find((p) => p.target === t)!);
  }

  // 8. 丟掉最沒用的單張生物
  const discards = find('discard');
  const junk = discards.filter((p) => singleValue(p, k) < 50);
  if (junk.length) return toAction(me, cheapest(junk, k));

  // 9. 打出價值最低的單張功能牌（保留 No way／Pass，它們本來就不能主動打）
  const singles = plays.filter((p) => p.cards.length === 1 && p.label !== 'discard');
  if (singles.length) return toAction(me, cheapest(singles, k));
  if (discards.length) return toAction(me, cheapest(discards, k));
  return toAction(me, pick(rng, plays));
}

function singleValue(p: LegalPlay, k: Knowledge): number {
  return p.cards.reduce((sum, id) => sum + cardValue(k.hand.find((c) => c.id === id)!, k), 0);
}

function cheapest(plays: LegalPlay[], k: Knowledge): LegalPlay {
  return plays.reduce((a, b) => (singleValue(b, k) < singleValue(a, k) ? b : a));
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

  // 自己的動作被取消：值得的話反制
  if (ev.baseCancelled) {
    if (ch.actor === me && ['torpedo', 'chef', 'fisher', 'net', 'steal'].includes(ch.play)) {
      return (rng.next() < 0.75 && respondNoway()) || decline;
    }
    return decline;
  }

  // 被單體功能牌指定
  if (ev.target === me) {
    const threat =
      (ch.play === 'steal' && (k.hasChill || k.hand.length <= 3)) ||
      (ch.play === 'salmon' && (!k.hasChill || k.pufferRisk >= 0.12)) ||
      (ch.play === 'switch' && (k.hasChill || k.missing.length <= 2));
    if (threat) return respondPass() ?? respondNoway() ?? decline;
    return decline;
  }

  // 別人的魚雷：自己也可能被炸
  if (ch.play === 'torpedo' && ch.actor !== me) {
    return (rng.next() < 0.5 && respondNoway()) || decline;
  }
  // 別人用漁網撈走 Chill
  if (ch.play === 'net' && ch.actor !== me) {
    const taken = s.discard.find((c) => c.id === ch.netCardId);
    if (taken?.kind === 'chill' && rng.next() < 0.5) return respondNoway() ?? decline;
  }
  return decline;
}

// ───────────────────────── 其他選擇 ─────────────────────────

/** 河豚放回位置：大多放最上面讓下一位抽到 */
function pufferPosition(s: GameState, rng: Rng): number {
  const r = rng.next();
  if (r < 0.7 || s.deck.length === 0) return 0;
  if (r < 0.85) return Math.min(1, s.deck.length);
  return randInt(rng, s.deck.length + 1);
}

/** 牌堆頂的排列：河豚放最上面（下一位先抽），其餘照原順序 */
function pufferFirst(cards: Card[]): Card[] {
  return [...cards.filter((c) => c.kind === 'puffer'), ...cards.filter((c) => c.kind !== 'puffer')];
}

/** Chef 分牌：河豚給手牌最少的對手（比較可能沒有 Chill） */
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
  // 由手牌少到多分配河豚
  const byWeakness = recipients
    .map((r, slot) => ({ slot, n: s.players[r]!.hand.length }))
    .sort((a, b) => a.n - b.n);
  const order: (Card | undefined)[] = Array.from({ length: rest.length });
  puffers.forEach((p, i) => {
    const slot = byWeakness[i]?.slot;
    if (slot !== undefined) order[slot] = p;
  });
  for (let i = 0; i < order.length; i++) if (!order[i]) order[i] = others.shift() ?? puffers.pop();
  return order as Card[];
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
      return p.player === player ? { type: 'placePuffer', player, position: pufferPosition(s, rng) } : null;
    case 'response':
      return p.declined.includes(player) ? null : botRespond(s, player, rng);
    case 'fisher': {
      if (p.player !== player) return null;
      const k = know(s, player, rng);
      const pool = [...k.hand, ...p.cards];
      const ranked = [...p.cards].sort((a, b) => cardValue(b, k, pool) - cardValue(a, k, pool));
      const n = Math.min(3, ranked.length);
      return {
        type: 'fisherChoose',
        player,
        keep: ranked.slice(0, n).map((c) => c.id),
        returnOrder: pufferFirst(ranked.slice(n)).map((c) => c.id),
      };
    }
    case 'chef': {
      if (p.player !== player) return null;
      const k = know(s, player, rng);
      const pool = [...k.hand, ...p.cards];
      const ranked = [...p.cards].sort((a, b) => cardValue(b, k, pool) - cardValue(a, k, pool));
      return {
        type: 'chefArrange',
        player,
        keep: ranked[0]!.id,
        order: chefOrder(s, player, ranked.slice(1)).map((c) => c.id),
      };
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
