import { describe, expect, it } from 'vitest';
import { eventsFor, viewFor, type GameState } from '../src';
import { act, closeWindow, handKinds, id, ids, play, setup } from './helpers';

const deckKinds = (s: GameState) => s.deck.map((c) => c.kind);

describe('§8 功能牌', () => {
  it('Steal：隨機拿走目標 1 張手牌，目標再抽 1 張', () => {
    let s = setup({ hands: [['steal'], ['seal', 'dolphin'], ['jellyfish']], at: 'play', deck: ['clownfish'] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    const r = act(s, { type: 'timeout', timerId: s.timer!.id });
    s = r.state;
    expect(s.players[0]!.hand).toHaveLength(1);
    expect(['seal', 'dolphin']).toContain(s.players[0]!.hand[0]!.kind);
    expect(s.players[1]!.hand).toHaveLength(2);
    expect(handKinds(s, 1)).toContain('clownfish');
    // 旁觀者不知道偷了哪張
    const stolen = s.players[0]!.hand[0]!.kind;
    expect(JSON.stringify(eventsFor(r.events, 2).filter((e) => e.type === 'stole'))).not.toContain(stolen);
    expect(eventsFor(r.events, 0).find((e) => e.type === 'stole')).toHaveProperty('card');
  });

  it('Steal：目標沒有手牌時不能指定；不能指定自己或淘汰者', () => {
    const s = setup({ hands: [['steal'], [], ['seal'], ['seal']], at: 'play', dead: [3] });
    expect(() => play(s, 0, [id(s, 0, 'steal')], 1)).toThrow(/指定/);
    expect(() => play(s, 0, [id(s, 0, 'steal')], 0)).toThrow(/指定/);
    expect(() => play(s, 0, [id(s, 0, 'steal')], 3)).toThrow(/指定/);
    expect(() => play(s, 0, [id(s, 0, 'steal')])).toThrow(/指定/);
  });

  it('Steal：被偷者補牌抽到河豚又沒有 Chill → 淘汰', () => {
    let s = setup({ hands: [['steal'], ['chill'], ['seal']], at: 'play', deck: ['puffer'] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['chill']);
    expect(s.players[1]!.alive).toBe(false);
  });

  it('Salmon：下一位抽 2 張收下', () => {
    let s = setup({ hands: [['salmon'], ['seal'], ['seal']], at: 'play', deck: ['clownfish', 'dolphin', 'jellyfish'] });
    s = play(s, 0, [id(s, 0, 'salmon')]);
    expect(s.chain?.target).toBe(1);
    s = closeWindow(s);
    expect(handKinds(s, 1)).toEqual(['seal', 'clownfish', 'dolphin']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('Salmon：抽到河豚時用 Chill 擋下，再收下第二張', () => {
    let s = setup({ hands: [['salmon'], ['chill'], ['seal']], at: 'play', deck: ['puffer', 'dolphin', 'seal'] });
    s = play(s, 0, [id(s, 0, 'salmon')]);
    s = closeWindow(s);
    expect(s.prompt).toMatchObject({ kind: 'placePuffer', player: 1 });
    s = act(s, { type: 'placePuffer', player: 1, position: 0 }).state;
    expect(handKinds(s, 1)).toEqual(['dolphin']);
    expect(deckKinds(s)).toEqual(['puffer', 'seal']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('Switch：交換整副手牌', () => {
    let s = setup({ hands: [['switch', 'seal'], ['chill', 'dolphin', 'jellyfish'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'switch')], 1);
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['chill', 'dolphin', 'jellyfish']);
    expect(handKinds(s, 1)).toEqual(['seal']);
  });

  it('Reverse：方向反轉，下一位變成逆時針', () => {
    let s = setup({ hands: [['reverse'], ['seal'], ['seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'reverse')]);
    s = closeWindow(s);
    expect(s.direction).toBe(-1);
    expect(s.prompt).toEqual({ kind: 'draw', player: 3 });
  });

  it('Wave：棄牌堆洗回牌堆，Wave 本身移出遊戲', () => {
    let s = setup({ hands: [['wave'], ['seal'], ['seal']], at: 'play', discard: ['seal', 'dolphin'], deck: ['jellyfish'] });
    s = play(s, 0, [id(s, 0, 'wave')]);
    s = closeWindow(s);
    expect(s.discard).toEqual([]);
    expect(s.removed.map((c) => c.kind)).toEqual(['wave']);
    expect([...deckKinds(s)].sort()).toEqual(['dolphin', 'jellyfish', 'seal']);
  });

  it('Wave 被 No way 取消時，Wave 和 No way 都留在棄牌堆', () => {
    let s = setup({ hands: [['wave'], ['noway'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'wave')]);
    s = act(s, { type: 'respond', player: 1, card: id(s, 1, 'noway') }).state;
    s = closeWindow(s);
    expect(s.discard.map((c) => c.kind)).toEqual(['wave', 'noway']);
    expect(s.removed).toEqual([]);
  });

  describe('Chef', () => {
    const start = () => {
      let s = setup({
        hands: [['chef'], ['seal'], ['chill']],
        at: 'play',
        deck: ['seal', 'puffer', 'dolphin', 'clownfish'],
      });
      s = play(s, 0, [id(s, 0, 'chef')]);
      return closeWindow(s);
    };

    it('拿「存活人數」張，只有出牌者看得到', () => {
      const s = start();
      expect(s.prompt).toMatchObject({ kind: 'chef', player: 0 });
      expect(viewFor(s, 0).prompt).toMatchObject({ kind: 'chef', cardCount: 3 });
      expect((viewFor(s, 0).prompt as { cards?: unknown[] }).cards).toHaveLength(3);
      expect((viewFor(s, 1).prompt as { cards?: unknown[] }).cards).toBeUndefined();
      expect(deckKinds(s)).toEqual(['clownfish']);
    });

    it('自己挑 1 張，其餘依順序發給下一位起的玩家；拿到河豚照常判定', () => {
      let s = start();
      const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
      const byKind = (k: string) => cards.find((c) => c.kind === k)!.id;
      s = act(s, {
        type: 'chefArrange',
        player: 0,
        keep: byKind('seal'),
        order: [byKind('puffer'), byKind('dolphin')],
      }).state;
      expect(handKinds(s, 0)).toEqual(['seal']);
      expect(s.players[1]!.alive).toBe(false); // P1 沒有 Chill
      expect(handKinds(s, 2)).toEqual(['chill', 'dolphin']);
      expect(s.prompt).toEqual({ kind: 'draw', player: 2 });
    });

    it('拿到河豚的人有 Chill 時要放回河豚', () => {
      let s = start();
      const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
      const byKind = (k: string) => cards.find((c) => c.kind === k)!.id;
      s = act(s, {
        type: 'chefArrange',
        player: 0,
        keep: byKind('seal'),
        order: [byKind('dolphin'), byKind('puffer')],
      }).state;
      expect(s.prompt).toMatchObject({ kind: 'placePuffer', player: 2 });
    });

    it('分配內容不正確會被拒絕', () => {
      const s = start();
      const cards = (s.prompt as { cards: { id: string }[] }).cards;
      expect(() =>
        act(s, { type: 'chefArrange', player: 0, keep: cards[0]!.id, order: [cards[1]!.id] }),
      ).toThrow();
    });
  });

  describe('Watch Out', () => {
    const start = () => {
      let s = setup({
        hands: [['watchout'], ['seal'], ['dolphin', 'chill'], ['jellyfish']],
        at: 'play',
        deck: ['clownfish', 'stingray', 'isopod'],
      });
      s = play(s, 0, [id(s, 0, 'watchout')]);
      return closeWindow(s);
    };

    it('除出牌者外都要拍；最慢的人手牌洗回牌堆再抽回同樣張數', () => {
      let s = start();
      expect(s.prompt).toMatchObject({ kind: 'slap', actor: 0, players: [1, 2, 3] });
      expect(s.timer?.ms).toBe(5000);
      s = act(s, { type: 'slap', player: 1, t: 300 }).state;
      s = act(s, { type: 'slap', player: 3, t: 500 }).state;
      const r = act(s, { type: 'slap', player: 2, t: 900 });
      s = r.state;
      expect(r.events).toContainEqual(expect.objectContaining({ type: 'slapResult', loser: 2 }));
      expect(s.players[2]!.hand).toHaveLength(2);
      expect(s.deck).toHaveLength(3);
      expect(handKinds(s, 1)).toEqual(['seal']);
    });

    it('時間到還沒拍的人就是最慢的', () => {
      let s = start();
      s = act(s, { type: 'slap', player: 1, t: 1500 }).state;
      s = act(s, { type: 'slap', player: 2, t: 1600 }).state;
      const r = act(s, { type: 'timeout', timerId: s.timer!.id });
      expect(r.events).toContainEqual(expect.objectContaining({ type: 'slapResult', loser: 3 }));
    });

    it('出牌者不能拍', () => {
      const s = start();
      expect(() => act(s, { type: 'slap', player: 0, t: 1 })).toThrow();
    });
  });
});

describe('§7 組合技', () => {
  it('只能用同種生物；功能牌不能組合', () => {
    const s = setup({ hands: [['steal', 'steal', 'seal', 'dolphin'], ['seal'], ['seal']], at: 'play', discard: ['seal'] });
    expect(() => play(s, 0, ids(s, 0, 'steal'))).toThrow(/組合/);
    expect(() => play(s, 0, [id(s, 0, 'seal'), id(s, 0, 'dolphin')])).toThrow(/組合/);
  });

  it('漁網（2 張）：拿走出牌前的棄牌堆頂', () => {
    let s = setup({ hands: [['seal', 'seal'], ['seal'], ['seal']], at: 'play', discard: ['dolphin', 'chill'] });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['chill']);
    expect(s.discard.map((c) => c.kind)).toEqual(['dolphin', 'seal', 'seal']);
  });

  it('漁網：中間有 No way 攻防，拿的仍是出牌前的頂牌', () => {
    let s = setup({
      hands: [['seal', 'seal', 'noway'], ['noway'], ['seal']],
      at: 'play',
      discard: ['chill'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = act(s, { type: 'respond', player: 1, card: id(s, 1, 'noway') }).state;
    s = act(s, { type: 'respond', player: 0, card: id(s, 0, 'noway') }).state;
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['chill']);
  });

  it('漁網：棄牌堆是空的不能用', () => {
    const s = setup({ hands: [['seal', 'seal'], ['seal'], ['seal']], at: 'play' });
    expect(() => play(s, 0, ids(s, 0, 'seal'))).toThrow(/棄牌堆/);
  });

  it('漁販（3 張）：抽 5 留 3，其餘依自訂順序放回牌堆頂', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['clownfish', 'dolphin', 'stingray', 'jellyfish', 'isopod', 'barreleye'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = closeWindow(s);
    expect(s.prompt).toMatchObject({ kind: 'fisher', player: 0 });
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const k = (kind: string) => cards.find((c) => c.kind === kind)!.id;
    expect(() =>
      act(s, { type: 'fisherChoose', player: 0, keep: [k('clownfish')], returnOrder: [] }),
    ).toThrow();
    s = act(s, {
      type: 'fisherChoose',
      player: 0,
      keep: [k('clownfish'), k('stingray'), k('isopod')],
      returnOrder: [k('jellyfish'), k('dolphin')],
    }).state;
    expect(handKinds(s, 0)).toEqual(['clownfish', 'stingray', 'isopod']);
    expect(deckKinds(s)).toEqual(['jellyfish', 'dolphin', 'barreleye']);
  });

  it('漁販：留下河豚 → 消耗 Chill 並放回', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal', 'chill'], ['seal'], ['seal']],
      at: 'play',
      deck: ['puffer', 'dolphin', 'stingray', 'jellyfish', 'isopod'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = closeWindow(s);
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const k = (kind: string) => cards.find((c) => c.kind === kind)!.id;
    s = act(s, {
      type: 'fisherChoose',
      player: 0,
      keep: [k('puffer'), k('dolphin'), k('stingray')],
      returnOrder: [k('jellyfish'), k('isopod')],
    }).state;
    expect(s.prompt).toMatchObject({ kind: 'placePuffer', player: 0 });
    expect(handKinds(s, 0)).toEqual([]);
  });

  it('漁販：牌堆不足 3 張時全部收下', () => {
    let s = setup({ hands: [['seal', 'seal', 'seal'], ['seal'], ['seal']], at: 'play', deck: ['dolphin', 'stingray'] });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['dolphin', 'stingray']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('魚雷（4 張）：從下一位輪流抽，第一個抽到河豚的人淘汰（Chill 無效）', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal', 'seal'], ['chill'], ['chill', 'dolphin'], ['seal']],
      at: 'play',
      deck: ['jellyfish', 'puffer', 'clownfish', 'stingray'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    const r = act(s, { type: 'timeout', timerId: s.timer!.id });
    s = r.state;
    const bombDraws = r.events.filter((e) => e.type === 'bombDraw');
    expect(bombDraws.map((e) => e.player)).toEqual([1, 2]);
    expect(s.players[2]!.alive).toBe(false);
    expect(handKinds(s, 1)).toEqual(['chill']); // 轟炸時抽的牌不進手牌
    expect([...deckKinds(s)].sort()).toEqual(['clownfish', 'jellyfish', 'stingray']);
    expect(s.removed.map((c) => c.kind)).toEqual(['puffer']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 3 }); // 被淘汰者的下一位
  });

  it('魚雷：輪流包含出牌者自己', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['jellyfish', 'dolphin', 'clownfish', 'puffer'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    const r = act(s, { type: 'timeout', timerId: s.timer!.id });
    expect(r.events.filter((e) => e.type === 'bombDraw').map((e) => e.player)).toEqual([1, 2, 0, 1]);
    expect(r.state.players[1]!.alive).toBe(false);
    expect(r.state.prompt).toEqual({ kind: 'draw', player: 2 });
  });

  it('魚雷可以被 No way 取消', () => {
    let s = setup({
      hands: [['seal', 'seal', 'seal', 'seal'], ['noway'], ['seal']],
      at: 'play',
      deck: ['puffer'],
    });
    s = play(s, 0, ids(s, 0, 'seal'));
    s = act(s, { type: 'respond', player: 1, card: id(s, 1, 'noway') }).state;
    s = closeWindow(s);
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });
});
