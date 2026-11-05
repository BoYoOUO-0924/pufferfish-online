/** 深海變體：先出牌（可連續）再抽牌、浮潛／深潛、拖網、3 張魚雷、聲納、Wave 只洗牌堆 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaitingPlayers,
  botAction,
  createGame,
  eventsFor,
  legalPlays,
  pick,
  seededRng,
  shuffle,
  TOTAL_CARDS,
  viewFor,
  type GameState,
  type Rng,
} from '../src';
import { act, closeWindow, handKinds, id, ids, play, setup } from './helpers';

const deckKinds = (s: GameState) => s.deck.map((c) => c.kind);
const endPlays = (s: GameState, player: number) => act(s, { type: 'endPlays', player }).state;
const draw = (s: GameState, player: number) => act(s, { type: 'draw', player }).state;

describe('深海變體：回合流程（先出牌、可以連續出、最後抽牌）', () => {
  it('開局第一位直接進入出牌階段', () => {
    const seats = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: false }));
    const s = createGame(seats, seededRng(1), { variant: 'deep' }).state;
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
    expect(viewFor(s, 0).prompt).toEqual({ kind: 'play', player: 0, canEnd: false, plays: 0 });
  });

  it('至少出 1 次；出完可以繼續出或結束出牌，結束後抽牌、回合結束', () => {
    let s = setup({
      variant: 'deep',
      hands: [['isopod', 'barreleye', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['dolphin', 'stingray', 'jellyfish'],
    });
    expect(() => endPlays(s, 0)).toThrow(/至少/);
    s = play(s, 0, [id(s, 0, 'isopod')]);
    expect(viewFor(s, 0).prompt).toEqual({ kind: 'play', player: 0, canEnd: true, plays: 1 });
    s = play(s, 0, [id(s, 0, 'barreleye')]);
    s = endPlays(s, 0);
    expect(s.prompt).toEqual({ kind: 'draw', player: 0 });
    s = draw(s, 0);
    expect(s.prompt).toEqual({ kind: 'play', player: 1 });
    expect(s.turnPlays).toBe(0);
  });

  it('沒有能出的牌：公告跳過，直接抽牌', () => {
    const s = setup({ variant: 'deep', hands: [['chill', 'noway'], ['seal'], ['seal']], at: 'draw', deck: ['dolphin', 'seal'] });
    // 從上一位結束回合進入 P0 的回合
    const prev = { ...s, turn: 2, prompt: { kind: 'draw' as const, player: 2 }, players: s.players.map((p, i) => (i === 2 ? { ...p, hand: [] } : p)) };
    const r = act(prev, { type: 'draw', player: 2 });
    expect(r.events).toContainEqual({ type: 'skipPlay', player: 0 });
    expect(r.state.prompt).toEqual({ kind: 'draw', player: 0 });
  });

  it('出牌逾時：已經出過就自動結束出牌', () => {
    let s = setup({ variant: 'deep', hands: [['isopod', 'seal'], ['seal'], ['seal']], at: 'play', deck: ['dolphin'] });
    s = play(s, 0, [id(s, 0, 'isopod')]);
    s = act(s, { type: 'timeout', timerId: s.timer!.id }).state;
    expect(s.prompt).toEqual({ kind: 'draw', player: 0 });
  });

  it('抽牌時用 Chill 擋下：放回河豚後回合結束', () => {
    let s = setup({ variant: 'deep', hands: [['dolphin', 'chill', 'seal'], ['seal'], ['seal']], at: 'play', deck: ['puffer', 'seal'] });
    s = endPlays(play(s, 0, [id(s, 0, 'dolphin')]), 0);
    s = draw(s, 0);
    expect(s.prompt).toMatchObject({ kind: 'placePuffer', player: 0 });
    s = act(s, { type: 'placePuffer', player: 0, position: 0 }).state;
    expect(s.prompt).toEqual({ kind: 'play', player: 1 });
  });
});

describe('深海變體：單張生物', () => {
  it('浮潛：只有自己看到牌堆頂，不開回應時間，可以繼續出牌', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'seal'], ['noway'], ['seal']],
      at: 'play',
      deck: ['puffer', 'dolphin', 'isopod'],
    });
    const r = act(s, { type: 'play', player: 0, cards: [id(s, 0, 'clownfish')] });
    s = r.state;
    expect(eventsFor(r.events, 0).find((e) => e.type === 'peek')).toMatchObject({ cards: [{ kind: 'puffer' }] });
    expect(eventsFor(r.events, 1).some((e) => e.type === 'peek')).toBe(false);
    expect(r.events).toContainEqual({ type: 'snorkeled', player: 0 });
    expect(viewFor(s, 0).knownTop.map((c) => c.kind)).toEqual(['puffer']);
    expect(viewFor(s, 1).knownTop).toEqual([]);
    expect(deckKinds(s)).toEqual(['puffer', 'dolphin', 'isopod']); // 牌堆不動
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
  });

  it('看到河豚 → 再打深潛 → 從牌底抽，河豚留給下一位', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'anglerfish', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['puffer', 'dolphin', 'stingray'],
    });
    s = play(s, 0, [id(s, 0, 'clownfish')]);
    s = play(s, 0, [id(s, 0, 'anglerfish')]);
    expect(viewFor(s, 1).players[0]!.deepDive).toBe(true);
    s = endPlays(s, 0);
    const r = act(s, { type: 'draw', player: 0 });
    expect(r.events).toContainEqual({ type: 'draw', player: 0, count: 1, bottom: true });
    expect(handKinds(r.state, 0)).toEqual(['seal', 'stingray']);
    expect(deckKinds(r.state)).toEqual(['puffer', 'dolphin']);
    expect(r.state.deepDive![0]).toBe(false);
    // 看到的牌堆頂還是河豚，記憶仍有效
    expect(viewFor(r.state, 0).knownTop.map((c) => c.kind)).toEqual(['puffer']);
  });

  it('記得的牌堆頂在牌堆被動過後失效', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['dolphin', 'puffer', 'isopod'],
    });
    s = play(s, 0, [id(s, 0, 'clownfish')]);
    s = draw(endPlays(s, 0), 0);
    expect(viewFor(s, 0).knownTop).toEqual([]);
  });

  it('原版規則下單張生物仍然沒有效果、先抽後出', () => {
    const s = setup({ hands: [['clownfish'], ['seal'], ['seal']], at: 'play', deck: ['puffer'] });
    expect(play(s, 0, [id(s, 0, 'clownfish')]).prompt).toEqual({ kind: 'draw', player: 1 });
  });
});

describe('深海變體：組合技與功能牌', () => {
  it('2 張同種「拖網」：拿走棄牌堆頂', () => {
    let s = setup({ variant: 'deep', hands: [['seal', 'seal', 'isopod'], ['seal'], ['seal']], at: 'play', discard: ['chill'] });
    s = closeWindow(play(s, 0, ids(s, 0, 'seal')));
    expect(handKinds(s, 0)).toEqual(['isopod', 'chill']);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 }); // 可以繼續出牌
  });

  it('3 張同種魚雷：出完回合直接結束（不用抽牌），輪到被炸者的下一位；4 張同種不能打', () => {
    let s = setup({
      variant: 'deep',
      hands: [['seal', 'seal', 'seal', 'seal'], ['dolphin'], ['dolphin'], ['dolphin']],
      at: 'play',
      deck: ['isopod', 'puffer', 'chill', 'stingray'],
    });
    expect(() => play(s, 0, ids(s, 0, 'seal'))).toThrow();
    s = closeWindow(play(s, 0, ids(s, 0, 'seal').slice(0, 3)));
    expect(s.players[2]!.alive).toBe(false);
    expect(handKinds(s, 0)).toEqual(['seal']); // P0 沒有抽牌
    expect(s.prompt).toEqual({ kind: 'play', player: 3 });
  });

  it('魚雷被 No way 取消：照常繼續出牌', () => {
    let s = setup({
      variant: 'deep',
      hands: [['seal', 'seal', 'seal', 'dolphin'], ['noway'], ['dolphin']],
      at: 'play',
      deck: ['puffer'],
    });
    s = play(s, 0, ids(s, 0, 'seal').slice(0, 3));
    s = act(s, { type: 'respond', player: 1, card: id(s, 1, 'noway') }).state;
    s = closeWindow(s);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
  });

  it('聲納：看牌堆頂 4 張並重排，記住排好的順序；可以被 No way', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'dolphin', 'seal', 'isopod'], ['seal'], ['seal']],
      at: 'play',
      deck: ['puffer', 'chill', 'isopod', 'seal', 'dolphin'],
    });
    s = closeWindow(play(s, 0, [id(s, 0, 'clownfish'), id(s, 0, 'dolphin'), id(s, 0, 'seal')]));
    expect(s.prompt).toMatchObject({ kind: 'sonar', player: 0 });
    expect(viewFor(s, 1).prompt).toEqual({ kind: 'sonar', player: 0, cards: undefined, cardCount: 4 });
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const order = [...cards].reverse().map((c) => c.id);
    s = act(s, { type: 'sonarArrange', player: 0, order }).state;
    expect(deckKinds(s)).toEqual(['seal', 'isopod', 'chill', 'puffer', 'dolphin']);
    expect(viewFor(s, 0).knownTop.map((c) => c.kind)).toEqual(['seal', 'isopod', 'chill', 'puffer']);
    expect(s.prompt).toEqual({ kind: 'play', player: 0 });
    // 抽走第一張後，記憶往前移一格
    s = draw(endPlays(s, 0), 0);
    expect(viewFor(s, 0).knownTop.map((c) => c.kind)).toEqual(['isopod', 'chill', 'puffer']);

    let t = setup({
      variant: 'deep',
      hands: [['clownfish', 'dolphin', 'seal'], ['noway'], ['seal']],
      at: 'play',
      deck: ['puffer', 'chill'],
    });
    t = play(t, 0, [id(t, 0, 'clownfish'), id(t, 0, 'dolphin'), id(t, 0, 'seal')]);
    t = act(t, { type: 'respond', player: 1, card: id(t, 1, 'noway') }).state;
    t = closeWindow(t);
    expect(deckKinds(t)).toEqual(['puffer', 'chill']);
    expect(t.prompt).toEqual({ kind: 'draw', player: 0 }); // 手牌出完了，自動進入抽牌
  });

  it('Wave：只重洗牌堆，棄牌堆不動', () => {
    let s = setup({
      variant: 'deep',
      hands: [['wave', 'seal'], ['seal'], ['seal']],
      at: 'play',
      discard: ['dolphin', 'isopod'],
      deck: ['puffer', 'chill', 'seal', 'stingray', 'jellyfish'],
    });
    s = closeWindow(play(s, 0, [id(s, 0, 'wave')]));
    expect(s.deck).toHaveLength(5);
    expect(s.discard.map((c) => c.kind)).toEqual(['dolphin', 'isopod', 'wave']);
    expect(s.removed).toHaveLength(0);
  });

  it('不同海洋層混搭不行；5 種同層仍是收集勝利', () => {
    const s = setup({
      variant: 'deep',
      hands: [['clownfish', 'dolphin', 'isopod', 'seal', 'stingray', 'sacabambaspis'], ['seal'], ['seal']],
      at: 'play',
    });
    expect(() => play(s, 0, [id(s, 0, 'clownfish'), id(s, 0, 'dolphin'), id(s, 0, 'isopod')])).toThrow();
    const win = play(s, 0, ['clownfish', 'dolphin', 'seal', 'stingray', 'sacabambaspis'].map((k) => id(s, 0, k as never)));
    expect(win.winReason).toBe('collection');
  });

  it('legalPlays 列出深海變體的組合', () => {
    const s = setup({
      variant: 'deep',
      hands: [['clownfish', 'dolphin', 'seal', 'seal', 'seal', 'anglerfish'], ['seal'], ['seal']],
      at: 'play',
      discard: ['chill'],
    });
    const labels = new Set(legalPlays(s, 0).map((p) => p.label));
    expect(labels).toEqual(new Set(['snorkel', 'deepdive', 'net', 'torpedo', 'sonar']));
  });
});

describe('深海變體：電腦玩家', () => {
  it('知道牌堆頂是河豚時用深潛躲開', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'anglerfish', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['puffer', 'dolphin', 'stingray', 'seal', 'isopod'],
    });
    s = play(s, 0, [id(s, 0, 'clownfish')]);
    expect(botAction(s, 0, seededRng(1))).toEqual({ type: 'play', player: 0, cards: [id(s, 0, 'anglerfish')] });
  });

  it('知道牌堆頂安全時結束出牌，保留手牌', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'anglerfish', 'chill'], ['seal'], ['seal']],
      at: 'play',
      deck: ['dolphin', 'puffer', 'stingray'],
    });
    s = play(s, 0, [id(s, 0, 'clownfish')]);
    expect(botAction(s, 0, seededRng(1))).toEqual({ type: 'endPlays', player: 0 });
  });

  it('聲納：自己先抽安全的，河豚排第二張', () => {
    let s = setup({
      variant: 'deep',
      hands: [['clownfish', 'dolphin', 'seal'], ['seal'], ['seal']],
      at: 'play',
      deck: ['puffer', 'isopod', 'chill', 'seal'],
    });
    s = closeWindow(play(s, 0, [id(s, 0, 'clownfish'), id(s, 0, 'dolphin'), id(s, 0, 'seal')]));
    const a = botAction(s, 0, seededRng(1)) as { order: string[] };
    const cards = (s.prompt as { cards: { id: string; kind: string }[] }).cards;
    const kind = (cid: string) => cards.find((c) => c.id === cid)!.kind;
    expect(kind(a.order[0]!)).toBe('chill');
    expect(kind(a.order[1]!)).toBe('puffer');
  });
});

/** 打亂電腦不該知道的資訊（牌堆內容、別人的手牌），張數與它自己記得的牌堆頂不變 */
function scramble(s: GameState, me: number, rng: Rng): GameState {
  const t = structuredClone(s);
  const keep = new Set((t.known?.[me] ?? []).map((c) => c.id));
  const others = t.players.map((_, i) => i).filter((i) => i !== me);
  const fixedTop = t.deck.slice(0, keep.size);
  if (!fixedTop.every((c) => keep.has(c.id))) return t;
  const rest = t.deck.slice(keep.size);
  const pool = shuffle(rng, [...rest, ...others.flatMap((i) => t.players[i]!.hand)]);
  t.deck = [...fixedTop, ...pool.splice(0, rest.length)];
  for (const i of others) t.players[i]!.hand = pool.splice(0, t.players[i]!.hand.length);
  return t;
}

describe('深海變體：模擬對局', () => {
  it('300 局電腦對戰都能結束且不掉牌；電腦不偷看隱藏資訊', () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const n = 3 + (seed % 3);
      const seats = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true }));
      let s = createGame(seats, rng, { firstPlayer: seed % n, variant: 'deep' }).state;
      for (let step = 0; s.phase === 'playing'; step++) {
        if (step > 20_000) throw new Error(`seed ${seed} 沒有結束`);
        const waiting = awaitingPlayers(s);
        if (seed <= 40) {
          for (const p of waiting) {
            expect(botAction(scramble(s, p, rng), p, seededRng(step))).toEqual(botAction(s, p, seededRng(step)));
            checked++;
          }
        }
        const a = waiting.length && rng.next() > 0.05 ? botAction(s, pick(rng, waiting), rng) : null;
        s = applyAction(s, a ?? { type: 'timeout', timerId: s.timer!.id }, rng).state;
        const p = s.prompt;
        const extra = p?.kind === 'sonar' || p?.kind === 'chef' || p?.kind === 'fisher' ? p.cards : p?.kind === 'placePuffer' ? [p.card] : [];
        const all = [
          ...s.deck,
          ...s.discard,
          ...s.removed,
          ...s.players.flatMap((x) => x.hand),
          ...extra,
          ...s.queue.flatMap((q) => (q.kind === 'gain' ? [q.card] : q.kind === 'bomb' ? q.aside : [])),
        ];
        expect(new Set(all.map((c) => c.id)).size).toBe(TOTAL_CARDS);
        expect(all).toHaveLength(TOTAL_CARDS);
        if (s.phase === 'playing') expect(s.prompt).not.toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 180_000);
});
