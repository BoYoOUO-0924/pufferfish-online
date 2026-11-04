/**
 * 模擬測試：讓電腦玩家打大量完整對局（含隨機逾時），
 * 每一步都檢查不變量，確保規則引擎不會卡住、不會掉牌。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  awaitingPlayers,
  botAction,
  createGame,
  pick,
  seededRng,
  TOTAL_CARDS,
  type GameState,
} from '../src';

function cardsInPlay(s: GameState) {
  const cards = [...s.deck, ...s.discard, ...s.removed, ...s.players.flatMap((p) => p.hand)];
  const p = s.prompt;
  if (p?.kind === 'placePuffer') cards.push(p.card);
  if (p?.kind === 'fisher' || p?.kind === 'chef') cards.push(...p.cards);
  for (const step of s.queue) {
    if (step.kind === 'gain') cards.push(step.card);
    if (step.kind === 'bomb') cards.push(...step.aside);
  }
  return cards;
}

function checkInvariants(s: GameState) {
  const cards = cardsInPlay(s);
  expect(cards).toHaveLength(TOTAL_CARDS);
  expect(new Set(cards.map((c) => c.id)).size).toBe(TOTAL_CARDS);
  for (const p of s.players) {
    expect(p.hand.some((c) => c.kind === 'puffer')).toBe(false);
    if (!p.alive) expect(p.hand).toHaveLength(0);
  }
  if (s.phase === 'playing') {
    // 不會卡住：遊戲進行中一定在等某個決定
    expect(s.prompt).not.toBeNull();
    expect(s.timer).not.toBeNull();
    // §9：遊戲進行中，流通中的河豚至少 1 張
    const live = cards.filter((c) => c.kind === 'puffer').length - s.removed.filter((c) => c.kind === 'puffer').length;
    expect(live).toBeGreaterThanOrEqual(1);
    expect(s.players.filter((p) => p.alive).length).toBeGreaterThanOrEqual(2);
  } else {
    expect(s.winner).not.toBeNull();
    expect(s.players[s.winner!]!.alive).toBe(true);
  }
}

function simulate(seed: number) {
  const rng = seededRng(seed);
  const n = 3 + (seed % 3);
  const seats = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, isBot: true }));
  let s = createGame(seats, rng, { firstPlayer: seed % n }).state;
  checkInvariants(s);
  let steps = 0;
  while (s.phase === 'playing') {
    steps += 1;
    if (steps > 20_000) throw new Error(`seed ${seed} 沒有結束`);
    const waiting = awaitingPlayers(s);
    let action = null;
    if (waiting.length && rng.next() > 0.05) {
      action = botAction(s, pick(rng, waiting), rng);
    }
    s = applyAction(s, action ?? { type: 'timeout', timerId: s.timer!.id }, rng).state;
    checkInvariants(s);
  }
  return { winReason: s.winReason!, turns: s.turnCount };
}

describe('§9 模擬對局', () => {
  it('600 局電腦對戰都能正常結束，且全程不掉牌', () => {
    const reasons = { lastStanding: 0, collection: 0 };
    for (let seed = 1; seed <= 600; seed++) {
      reasons[simulate(seed).winReason] += 1;
    }
    expect(reasons.lastStanding + reasons.collection).toBe(600);
    // 兩種勝利方式都會出現
    expect(reasons.lastStanding).toBeGreaterThan(0);
    expect(reasons.collection).toBeGreaterThan(0);
    console.log('勝利方式統計', reasons);
  }, 120_000);
});
