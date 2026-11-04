import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaitingPlayers,
  botAction,
  createGame,
  defaultAction,
  legalPlays,
  pick,
  randInt,
  seededRng,
  shuffle,
  type Action,
  type GameState,
  type Rng,
} from '../src';
import { act, id, ids, play, setup } from './helpers';

describe('電腦玩家：行為', () => {
  it('能收集勝利時直接打出', () => {
    const s = setup({
      hands: [['clownfish', 'dolphin', 'seal', 'stingray', 'jellyfish', 'steal'], ['seal'], ['seal']],
      at: 'play',
    });
    const a = botAction(s, 0, seededRng(1));
    expect(a).toMatchObject({ type: 'play' });
    expect((a as { cards: string[] }).cards).toHaveLength(5);
  });

  it('沒有 Chill 時優先打出 Chef 自保', () => {
    const s = setup({ hands: [['chef', 'seal', 'steal'], ['seal'], ['seal']], at: 'play' });
    expect(botAction(s, 0, seededRng(1))).toMatchObject({ cards: [id(s, 0, 'chef')] });
  });

  it('沒有 Chill 時偷手牌最多的人', () => {
    const s = setup({ hands: [['steal', 'seal'], ['seal'], ['seal', 'dolphin', 'jellyfish']], at: 'play' });
    expect(botAction(s, 0, seededRng(1))).toMatchObject({ cards: [id(s, 0, 'steal')], target: 2 });
  });

  it('棄牌堆頂是 Chill 時用漁網撈', () => {
    const s = setup({ hands: [['seal', 'seal', 'chill'], ['seal'], ['seal']], at: 'play', discard: ['chill'] });
    expect(botAction(s, 0, seededRng(1))).toMatchObject({ cards: ids(s, 0, 'seal') });
  });

  it('平常先丟沒用的生物，保留功能牌', () => {
    const s = setup({
      hands: [['chill', 'clownfish', 'dolphin', 'seal', 'anglerfish', 'salmon', 'reverse'], ['seal'], ['seal']],
      at: 'play',
      deck: Array(40).fill('seal'),
    });
    // 淺海已有 3 種，深海鮟鱇魚是最沒用的
    for (let seed = 1; seed <= 20; seed++) {
      expect(botAction(s, 0, seededRng(seed))).toMatchObject({ cards: [id(s, 0, 'anglerfish')] });
    }
  });

  it('有 Chill 被 Steal 指定時，用 Pass 轉走', () => {
    let s = setup({ hands: [['steal'], ['pass', 'chill', 'seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(botAction(s, 1, seededRng(1))).toEqual({ type: 'respond', player: 1, card: id(s, 1, 'pass') });
  });

  it('沒有威脅時不浪費 No way', () => {
    let s = setup({ hands: [['reverse'], ['noway', 'seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'reverse')]);
    expect(botAction(s, 1, seededRng(1))).toEqual({ type: 'decline', player: 1 });
  });

  it('漁販：留下 Chill，河豚放回最上面', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['dolphin', 'puffer', 'chill', 'jellyfish', 'seal', 'isopod'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = act(s, { type: 'timeout', timerId: s.timer!.id }).state;
    const a = botAction(s, 0, seededRng(1)) as Extract<Action, { type: 'fisherChoose' }>;
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const kind = (cid: string) => cards.find((c) => c.id === cid)!.kind;
    expect(a.keep.map(kind)).toContain('chill');
    expect(a.keep.map(kind)).not.toContain('puffer');
    expect(kind(a.returnOrder[0]!)).toBe('puffer');
  });

  it('Chef：河豚分給手牌最少的人', () => {
    let s = setup({
      hands: [['chef'], ['seal', 'seal', 'seal', 'seal'], ['seal'], ['seal', 'seal']],
      at: 'play',
      deck: ['dolphin', 'puffer', 'chill', 'jellyfish'],
    });
    s = play(s, 0, [id(s, 0, 'chef')]);
    s = act(s, { type: 'timeout', timerId: s.timer!.id }).state;
    const a = botAction(s, 0, seededRng(1)) as Extract<Action, { type: 'chefArrange' }>;
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const kind = (cid: string) => cards.find((c) => c.id === cid)!.kind;
    expect(kind(a.keep)).toBe('chill');
    // 分牌順序是 P1、P2、P3；P2 手牌最少
    expect(a.order.map(kind)[1]).toBe('puffer');
  });
});

/** 把電腦玩家不該知道的資訊（牌堆內容、別人的手牌）打亂，張數不變 */
function scramble(s: GameState, me: number, rng: Rng): GameState {
  const t = structuredClone(s);
  const others = t.players.map((_, i) => i).filter((i) => i !== me);
  const pool = shuffle(rng, [...t.deck, ...others.flatMap((i) => t.players[i]!.hand)]);
  t.deck = pool.splice(0, t.deck.length);
  for (const i of others) t.players[i]!.hand = pool.splice(0, t.players[i]!.hand.length);
  return t;
}

describe('電腦玩家：公平性', () => {
  it('不偷看牌堆和別人的手牌（打亂隱藏資訊後決定完全相同）', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed);
      const n = 3 + (seed % 3);
      const seats = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true }));
      let s = createGame(seats, rng).state;
      for (let step = 0; step < 3000 && s.phase === 'playing'; step++) {
        for (const p of awaitingPlayers(s)) {
          const real = botAction(s, p, seededRng(step));
          const fake = botAction(scramble(s, p, rng), p, seededRng(step));
          expect(fake).toEqual(real);
          checked++;
        }
        const waiting = awaitingPlayers(s);
        const a = waiting.length ? botAction(s, pick(rng, waiting), rng) : null;
        s = applyAction(s, a ?? { type: 'timeout', timerId: s.timer!.id }, rng).state;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

/** 對照組：隨機出牌、從不回應的玩家 */
function randomAction(s: GameState, player: number, rng: Rng): Action | null {
  const p = s.prompt!;
  if (p.kind === 'play') {
    if (p.player !== player) return null;
    const plays = legalPlays(s, player);
    if (!plays.length) return null;
    const c = pick(rng, plays);
    return { type: 'play', player, cards: c.cards, target: c.target };
  }
  if (p.kind === 'response') return p.declined.includes(player) ? null : { type: 'decline', player };
  if (p.kind === 'slap') return { type: 'slap', player, t: 400 + randInt(rng, 800) };
  if ('player' in p && p.player === player) return defaultAction(s, rng);
  return null;
}

describe('電腦玩家：強度', () => {
  it('1 個電腦對 2 個隨機玩家，勝率明顯高於 1/3', () => {
    const games = 600;
    let wins = 0;
    for (let seed = 1; seed <= games; seed++) {
      const rng = seededRng(seed);
      const smart = seed % 3; // 輪流換座位
      const seats = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
      let s = createGame(seats, rng, { firstPlayer: seed % 3 }).state;
      for (let step = 0; step < 20_000 && s.phase === 'playing'; step++) {
        const waiting = awaitingPlayers(s);
        let a: Action | null = null;
        if (waiting.length) {
          const p = pick(rng, waiting);
          a = p === smart ? botAction(s, p, rng) : randomAction(s, p, rng);
        }
        s = applyAction(s, a ?? { type: 'timeout', timerId: s.timer!.id }, rng).state;
      }
      if (s.winner === smart) wins++;
    }
    const rate = wins / games;
    console.log(`電腦玩家勝率：${(rate * 100).toFixed(1)}%（基準 33.3%）`);
    expect(rate).toBeGreaterThan(0.45);
  }, 120_000);
});
