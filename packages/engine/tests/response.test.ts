import { describe, expect, it } from 'vitest';
import { viewFor } from '../src';
import { act, closeWindow, handKinds, id, play, setup } from './helpers';

const respond = (s: Parameters<typeof act>[0], player: number, card: string) =>
  act(s, { type: 'respond', player, card }).state;

describe('§6 回應時間窗與 No way', () => {
  it('功能牌打出後開啟回應時間窗', () => {
    let s = setup({ hands: [['steal'], ['seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(s.prompt).toEqual({ kind: 'response', declined: [0] });
    expect(s.timer?.ms).toBe(6000);
  });

  it('No way 取消 Steal：牌照樣進棄牌堆，回合結束', () => {
    let s = setup({ hands: [['steal'], ['noway', 'seal'], ['seal']], at: 'play', deck: ['dolphin'] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = respond(s, 1, id(s, 1, 'noway'));
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual([]);
    expect(handKinds(s, 1)).toEqual(['seal']);
    expect(s.discard.map((c) => c.kind)).toEqual(['steal', 'noway']);
    expect(s.prompt).toEqual({ kind: 'draw', player: 1 });
  });

  it('No way 可以被另一張 No way 反制', () => {
    let s = setup({
      hands: [['steal', 'noway'], ['noway', 'seal'], ['seal']],
      at: 'play',
      deck: ['dolphin'],
    });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = respond(s, 1, id(s, 1, 'noway'));
    s = respond(s, 0, id(s, 0, 'noway'));
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['seal']);
    expect(handKinds(s, 1)).toEqual(['dolphin']);
  });

  it('三張 No way：取消成立', () => {
    let s = setup({
      hands: [['steal', 'noway'], ['noway', 'noway', 'seal'], ['seal']],
      at: 'play',
    });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = respond(s, 1, id(s, 1, 'noway'));
    s = respond(s, 0, id(s, 0, 'noway'));
    s = respond(s, 1, id(s, 1, 'noway'));
    s = closeWindow(s);
    expect(handKinds(s, 1)).toEqual(['seal']);
  });

  it('不能對自己剛打出的動作出 No way', () => {
    let s = setup({ hands: [['steal', 'noway'], ['seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(() => respond(s, 0, id(s, 0, 'noway'))).toThrow();
  });

  it('有人回應時重新倒數；舊計時器失效', () => {
    let s = setup({ hands: [['steal'], ['noway', 'seal'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    const oldTimer = s.timer!.id;
    s = respond(s, 1, id(s, 1, 'noway'));
    expect(s.timer!.id).not.toBe(oldTimer);
    expect(s.prompt).toEqual({ kind: 'response', declined: [1] });
    const same = act(s, { type: 'timeout', timerId: oldTimer }).state;
    expect(same.prompt?.kind).toBe('response');
  });

  it('所有存活玩家都不回應時提早結束', () => {
    let s = setup({ hands: [['reverse'], ['seal'], ['seal'], ['seal']], at: 'play', dead: [3] });
    s = play(s, 0, [id(s, 0, 'reverse')]);
    s = act(s, { type: 'decline', player: 1 }).state;
    expect(s.prompt?.kind).toBe('response');
    s = act(s, { type: 'decline', player: 2 }).state;
    expect(s.direction).toBe(-1);
    expect(s.prompt).toEqual({ kind: 'draw', player: 2 });
  });

  it('No way 不能取消收集勝利（直接結束，不開時間窗）', () => {
    const s = setup({
      hands: [['clownfish', 'dolphin', 'seal', 'stingray', 'sacabambaspis'], ['noway'], ['seal']],
      at: 'play',
    });
    const r = act(s, { type: 'play', player: 0, cards: s.players[0]!.hand.map((c) => c.id) });
    expect(r.state.phase).toBe('ended');
  });

  it('視角會告訴玩家能否 No way / Pass', () => {
    let s = setup({ hands: [['steal'], ['noway', 'pass'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(viewFor(s, 1).prompt).toMatchObject({ kind: 'response', canNoway: true, canPassTo: 2 });
    expect(viewFor(s, 2).prompt).toMatchObject({ kind: 'response', canNoway: false, canPassTo: null });
  });
});

describe('§8 Pass', () => {
  it('Pass 把 Steal 轉給自己的下一位', () => {
    let s = setup({
      hands: [['steal'], ['pass', 'seal'], ['dolphin'], ['jellyfish']],
      at: 'play',
      deck: ['clownfish'],
    });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    const r = act(s, { type: 'respond', player: 1, card: id(s, 1, 'pass') });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'responded', passTo: 2 }));
    s = closeWindow(r.state);
    expect(handKinds(s, 0)).toEqual(['dolphin']);
    expect(handKinds(s, 1)).toEqual(['seal']);
    expect(handKinds(s, 2)).toEqual(['clownfish']);
  });

  it('Pass 會跳過原出牌者（三人局在兩人之間來回）', () => {
    let s = setup({ hands: [['steal'], ['pass', 'seal'], ['pass', 'dolphin']], at: 'play', deck: ['jellyfish'] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = respond(s, 1, id(s, 1, 'pass')); // → P2
    s = respond(s, 2, id(s, 2, 'pass')); // → 跳過 P0 → P1
    expect(viewFor(s, 0).chain?.target).toBe(1);
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['seal']);
    expect(handKinds(s, 1)).toEqual(['jellyfish']);
  });

  it('No way 取消 Pass 後效果回到原目標', () => {
    let s = setup({ hands: [['steal'], ['pass', 'seal'], ['noway', 'dolphin']], at: 'play', deck: ['jellyfish'] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    s = respond(s, 1, id(s, 1, 'pass'));
    s = respond(s, 2, id(s, 2, 'noway'));
    expect(viewFor(s, 0).chain?.target).toBe(1);
    s = closeWindow(s);
    expect(handKinds(s, 0)).toEqual(['seal']);
    expect(handKinds(s, 2)).toEqual(['dolphin']);
  });

  it('不是目標的人不能 Pass', () => {
    let s = setup({ hands: [['steal'], ['seal'], ['pass']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(() => respond(s, 2, id(s, 2, 'pass'))).toThrow(/Pass/);
  });

  it('非單體功能牌不能 Pass', () => {
    let s = setup({ hands: [['wave'], ['pass'], ['seal']], at: 'play' });
    s = play(s, 0, [id(s, 0, 'wave')]);
    expect(() => respond(s, 1, id(s, 1, 'pass'))).toThrow(/Pass/);
  });

  it('只剩兩人存活時無人可轉，不能 Pass', () => {
    let s = setup({ hands: [['steal'], ['pass', 'seal'], ['seal']], at: 'play', dead: [2] });
    s = play(s, 0, [id(s, 0, 'steal')], 1);
    expect(() => respond(s, 1, id(s, 1, 'pass'))).toThrow(/Pass/);
  });

  it('Salmon 被 Pass 後由再下一位抽兩張', () => {
    let s = setup({
      hands: [['salmon'], ['pass'], ['seal'], ['seal']],
      at: 'play',
      deck: ['dolphin', 'jellyfish'],
    });
    s = play(s, 0, [id(s, 0, 'salmon')]);
    s = respond(s, 1, id(s, 1, 'pass'));
    s = closeWindow(s);
    expect(handKinds(s, 1)).toEqual([]);
    expect(handKinds(s, 2)).toEqual(['seal', 'dolphin', 'jellyfish']);
  });
});
