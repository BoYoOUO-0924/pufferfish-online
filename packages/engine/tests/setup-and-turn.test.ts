import { describe, expect, it } from 'vitest';
import { createGame, eventsFor, seededRng, TOTAL_CARDS, viewFor, type GameState } from '../src';
import { act, chain, handKinds, id, play, setup } from './helpers';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));

function allCards(s: GameState) {
  return [...s.deck, ...s.discard, ...s.removed, ...s.players.flatMap((p) => p.hand)];
}

describe('§1-2 牌組與準備', () => {
  it('牌組共 75 張', () => {
    expect(TOTAL_CARDS).toBe(75);
  });

  for (const n of [3, 4, 5]) {
    it(`${n} 人：起手 7 張含 1 張 Chill、牌堆有 ${n} 張河豚`, () => {
      const { state: s } = createGame(seats(n), seededRng(n));
      expect(allCards(s)).toHaveLength(75);
      expect(new Set(allCards(s).map((c) => c.id)).size).toBe(75);
      for (const p of s.players) {
        expect(p.hand).toHaveLength(7);
        expect(p.hand.filter((c) => c.kind === 'chill')).toHaveLength(1);
        expect(p.hand.some((c) => c.kind === 'puffer')).toBe(false);
      }
      expect(s.deck.filter((c) => c.kind === 'puffer')).toHaveLength(n);
      expect(s.deck.filter((c) => c.kind === 'chill')).toHaveLength(7 - n);
      expect(s.removed.filter((c) => c.kind === 'puffer')).toHaveLength(5 - n);
      expect(s.deck).toHaveLength(70 - 6 * n);
      expect(s.prompt).toEqual({ kind: 'draw', player: 0 });
    });
  }

  it('人數不是 3～5 人時拒絕開局', () => {
    expect(() => createGame(seats(2), seededRng(1))).toThrow();
    expect(() => createGame(seats(6), seededRng(1))).toThrow();
  });

  it('可以指定先手玩家', () => {
    const { state } = createGame(seats(3), seededRng(1), { firstPlayer: 2 });
    expect(state.prompt).toEqual({ kind: 'draw', player: 2 });
  });
});

describe('§3 回合流程', () => {
  it('抽 1 張 → 出 1 張 → 輪到下一位', () => {
    let s = setup({ hands: [['clownfish'], ['seal'], ['dolphin']], deck: ['jellyfish', 'stingray'] });
    s = act(s, { type: 'draw', player: 0 }).state;
    expect(handKinds(s, 0)).toEqual(['clownfish', 'jellyfish']);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
    s = play(s, 0, [id(s, 0, 'clownfish')]);
    expect(s.discard.map((c) => c.kind)).toEqual(['clownfish']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
    expect(s.turn).toBe(1);
  });

  it('不是自己的回合不能抽牌', () => {
    const s = setup({ hands: [['clownfish'], ['seal'], ['dolphin']], deck: ['jellyfish'] });
    expect(() => act(s, { type: 'draw', player: 1 })).toThrow(/還沒輪到你/);
  });

  it('Chill 不能主動打出；No way 和 Pass 只能用來回應', () => {
    const s = setup({ hands: [['chill', 'noway', 'pass', 'seal'], ['seal'], ['dolphin']], at: 'play' });
    expect(() => play(s, 0, [id(s, 0, 'chill')])).toThrow(/Chill/);
    expect(() => play(s, 0, [id(s, 0, 'noway')])).toThrow(/回應/);
    expect(() => play(s, 0, [id(s, 0, 'pass')])).toThrow(/回應/);
  });

  it('沒有可以出的牌時跳過出牌階段', () => {
    let s = setup({ hands: [['chill'], ['seal'], ['dolphin']], deck: ['noway'] });
    const r = act(s, { type: 'draw', player: 0 });
    s = r.state;
    expect(r.events.some((e) => e.type === 'skipPlay')).toBe(true);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('牌堆空時跳過抽牌，直接出牌', () => {
    const r = act(setup({ hands: [['seal'], ['seal'], ['dolphin']], deck: [] }), {
      type: 'draw',
      player: 0,
    });
    expect(r.events.some((e) => e.type === 'deckEmpty')).toBe(true);
    expect(r.state.prompt).toEqual({ kind: 'play', player: 0 });
  });

  it('單張生物牌打出後沒有回應時間窗', () => {
    let s = setup({ hands: [['seal'], ['noway'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'seal')]);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });
});

describe('§4-5 河豚、Chill 與淘汰', () => {
  it('有 Chill：自動消耗 Chill，選位置放回河豚，之後仍要出牌', () => {
    let s = setup({
      hands: [['chill', 'clownfish'], ['seal'], ['dolphin']],
      deck: ['puffer', 'seal', 'dolphin'],
    });
    let r = act(s, { type: 'draw', player: 0 });
    s = r.state;
    expect(r.events.some((e) => e.type === 'pufferDefused')).toBe(true);
    expect(handKinds(s, 0)).toEqual(['clownfish']);
    expect(s.removed.map((c) => c.kind)).toEqual(['chill']);
    expect(s.prompt?.kind).toBe('placePuffer');

    r = act(s, { type: 'placePuffer', player: 0, position: 2 });
    s = r.state;
    expect(s.deck.map((c) => c.kind)).toEqual(['seal', 'dolphin', 'puffer']);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
    // 位置只有放的人知道
    expect(eventsFor(r.events, 0).find((e) => e.type === 'pufferPlaced')).toMatchObject({ position: 2 });
    expect(eventsFor(r.events, 1).find((e) => e.type === 'pufferPlaced')).not.toHaveProperty('position');
  });

  it('放回位置超出範圍會被拒絕', () => {
    const s = act(setup({ hands: [['chill'], ['seal'], ['dolphin']], deck: ['puffer'] }), {
      type: 'draw',
      player: 0,
    }).state;
    expect(() => act(s, { type: 'placePuffer', player: 0, position: 5 })).toThrow();
    expect(() => act(s, { type: 'placePuffer', player: 1, position: 0 })).toThrow();
  });

  it('沒有 Chill：淘汰，手牌進棄牌堆，河豚移出遊戲，輪到下一位', () => {
    const r = act(
      setup({ hands: [['clownfish', 'steal'], ['seal'], ['dolphin']], deck: ['puffer', 'seal'] }),
      { type: 'draw', player: 0 },
    );
    const s = r.state;
    expect(s.players[0]!.alive).toBe(false);
    expect(s.players[0]!.hand).toEqual([]);
    expect(s.discard.map((c) => c.kind)).toEqual(['clownfish', 'steal']);
    expect(s.removed.map((c) => c.kind)).toEqual(['puffer']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('剩最後一人時獲勝', () => {
    const r = act(
      setup({ hands: [['clownfish'], ['seal'], ['dolphin']], deck: ['puffer'], dead: [1] }),
      { type: 'draw', player: 0 },
    );
    expect(r.state.phase).toBe('ended');
    expect(r.state.winner).toBe(2);
    expect(r.state.winReason).toBe('lastStanding');
    expect(r.state.prompt).toBeNull();
    expect(r.events.at(-1)).toMatchObject({ type: 'gameOver', winner: 2 });
  });

  it('淘汰的玩家會被跳過', () => {
    let s = setup({ hands: [['seal'], ['seal'], ['dolphin'], ['jellyfish']], at: 'play', dead: [1] });
    s = play(s, 0, [id(s, 0, 'seal')]);
    expect(s.prompt).toEqual({ kind: 'draw', player: 2 });
  });

  it('遊戲結束後不能再動作', () => {
    const s = act(setup({ hands: [['clownfish'], ['seal'], ['dolphin']], deck: ['puffer'], dead: [1] }), {
      type: 'draw',
      player: 0,
    }).state;
    expect(() => act(s, { type: 'draw', player: 2 })).toThrow(/結束/);
  });
});

describe('§4 收集勝利', () => {
  it('打出淺海 5 種生物立即獲勝，不開回應時間窗', () => {
    const s = setup({
      hands: [['clownfish', 'dolphin', 'seal', 'stingray', 'sacabambaspis', 'chill'], ['noway'], ['noway']],
      at: 'play',
    });
    const cards = ['clownfish', 'dolphin', 'seal', 'stingray', 'sacabambaspis'].map((k) =>
      id(s, 0, k as never),
    );
    const r = act(s, { type: 'play', player: 0, cards });
    expect(r.state.phase).toBe('ended');
    expect(r.state.winner).toBe(0);
    expect(r.state.winReason).toBe('collection');
  });

  it('深海 5 種也可以', () => {
    const s = setup({
      hands: [['isopod', 'barreleye', 'catshark', 'jellyfish', 'anglerfish'], ['seal'], ['seal']],
      at: 'play',
    });
    const r = act(s, { type: 'play', player: 0, cards: s.players[0]!.hand.map((c) => c.id) });
    expect(r.state.winner).toBe(0);
  });

  it('混合海洋層不算', () => {
    const s = setup({
      hands: [['clownfish', 'dolphin', 'seal', 'stingray', 'anglerfish'], ['seal'], ['seal']],
      at: 'play',
    });
    expect(() => play(s, 0, s.players[0]!.hand.map((c) => c.id))).toThrow(/組合/);
  });
});

describe('§10 逾時', () => {
  it('抽牌逾時自動抽牌', () => {
    const s = act(setup({ hands: [['seal'], ['seal'], ['seal']], deck: ['dolphin'] }), {
      type: 'timeout',
      timerId: 1,
    }).state;
    expect(handKinds(s, 0)).toEqual(['seal', 'dolphin']);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
  });

  it('出牌逾時優先打出生物牌', () => {
    let s = setup({ hands: [['steal', 'reverse', 'seal'], ['seal'], ['seal']], at: 'play' });
    s = act(s, { type: 'timeout', timerId: 1 }).state;
    expect(handKinds(s, 0)).toEqual(['steal', 'reverse']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('沒有生物牌時打出最左邊可以出的牌', () => {
    let s = setup({ hands: [['chill', 'reverse', 'wave'], ['seal'], ['seal']], at: 'play' });
    s = act(s, { type: 'timeout', timerId: 1 }).state;
    expect(handKinds(s, 0)).toEqual(['chill', 'wave']);
    expect(s.prompt?.kind).toBe('response');
  });

  it('過期的計時器會被忽略', () => {
    const s = setup({ hands: [['seal'], ['seal'], ['seal']], deck: ['dolphin'] });
    const r = act(s, { type: 'timeout', timerId: 999 });
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });

  it('放河豚逾時隨機放回', () => {
    let s = act(setup({ hands: [['chill'], ['seal'], ['seal']], deck: ['puffer', 'seal'] }), {
      type: 'draw',
      player: 0,
    }).state;
    s = act(s, { type: 'timeout', timerId: s.timer!.id }).state;
    expect(s.deck.filter((c) => c.kind === 'puffer')).toHaveLength(1);
  });
});

describe('§10 視角', () => {
  it('看不到別人的手牌和牌堆內容', () => {
    const s = setup({ hands: [['seal', 'chill'], ['dolphin'], ['jellyfish']], deck: ['puffer'] });
    const v = viewFor(s, 1);
    expect(v.hand.map((c) => c.kind)).toEqual(['dolphin']);
    expect(v.players[0]!.handCount).toBe(2);
    expect(v.deckCount).toBe(1);
    expect(JSON.stringify(v)).not.toContain('puffer');
    expect(JSON.stringify(v)).not.toContain('chill');
  });

  it('抽到的牌只有自己知道', () => {
    const r = act(setup({ hands: [['seal'], ['seal'], ['seal']], deck: ['chill'] }), {
      type: 'draw',
      player: 0,
    });
    expect(JSON.stringify(eventsFor(r.events, 0))).toContain('chill');
    expect(JSON.stringify(eventsFor(r.events, 1))).not.toContain('chill');
  });

  it('chain 串接 helper 正常', () => {
    const s = chain(
      setup({ hands: [['seal'], ['seal'], ['seal']], deck: ['dolphin', 'jellyfish'] }),
      { type: 'draw', player: 0 },
    );
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
  });
});
