/** 事件聚光燈：把重要事件依序放大顯示在桌面中央，讓大家都注意到發生了什麼 */
import type { CardKind, GameEvent } from '@pufferfish/engine';
import { useEffect, useRef, useState } from 'react';
import { PLAY_NAMES, cardName } from '../cards';
import type { RoomHandle } from '../net';
import { CardView } from './CardView';

interface Spot {
  id: number;
  kind: CardKind | null;
  text: string;
  sub?: string;
  ms: number;
  tone: 'info' | 'danger' | 'good';
  /** 重要訊息：一定顯示完，不會被新事件蓋掉 */
  sticky?: boolean;
}

function toSpot(id: number, e: GameEvent, n: (i: number) => string): Spot | null {
  const base = { id, ms: 1600, tone: 'info' as const };
  switch (e.type) {
    case 'played': {
      if (e.play === 'discard') return null;
      if (e.play === 'win') return null; // 結算畫面會顯示
      const name = PLAY_NAMES[e.play] ?? cardName(e.cards[0]!.kind);
      const target = e.target !== undefined ? ` → ${n(e.target)}` : '';
      return { ...base, kind: e.cards[0]!.kind, text: `${n(e.player)} 打出 ${name}${target}` };
    }
    case 'responded':
      return e.card.kind === 'pass'
        ? { ...base, kind: 'pass', text: `${n(e.player)}：Pass！`, sub: `轉給 ${n(e.passTo!)}` }
        : { ...base, kind: 'noway', text: `${n(e.player)}：No way！`, tone: 'danger' };
    case 'windowClosed':
      return e.cancelled ? { ...base, kind: null, text: '❌ 被取消了', ms: 1200 } : null;
    case 'pufferDefused':
      return { ...base, kind: 'chill', text: `🐡 ${n(e.player)} 抽到生氣的河豚！`, sub: '用 Chill 擋下了', tone: 'good', ms: 2000, sticky: true };
    case 'eliminated':
      return {
        ...base,
        kind: 'puffer',
        text: `💥 ${n(e.player)} 淘汰！`,
        sub: e.reason === 'torpedo' ? '被魚雷炸到了' : '河豚生氣了',
        tone: 'danger',
        ms: 2400,
        sticky: true,
      };
    case 'stole':
      return e.card
        ? { ...base, kind: e.card.kind, text: `${n(e.player)} 偷走 ${n(e.target)} 的 ${cardName(e.card.kind)}` }
        : null;
    case 'switched':
      return { ...base, kind: 'switch', text: `${n(e.player)} 和 ${n(e.target)} 交換手牌` };
    case 'reversed':
      return { ...base, kind: 'reverse', text: e.direction === 1 ? '↻ 改成順時針' : '↺ 改成逆時針' };
    case 'waved':
      return { ...base, kind: 'wave', text: `🌊 ${e.count} 張棄牌洗回牌堆` };
    case 'netTaken':
      return { ...base, kind: e.card.kind, text: `${n(e.player)} 用漁網撈走 ${cardName(e.card.kind)}` };
    case 'bombStart':
      return { ...base, kind: null, text: `💣 ${n(e.player)} 發動魚雷！`, sub: '大家輪流抽牌，Chill 無效', tone: 'danger', ms: 2000, sticky: true };
    case 'bombDraw':
      return { ...base, kind: e.card.kind, text: `${n(e.player)} 抽到 ${cardName(e.card.kind)}`, ms: 900 };
    case 'slapResult': {
      const times = [...e.slaps]
        .sort((a, b) => a.t - b.t)
        .map((s) => `${n(s.player)} ${(s.t / 1000).toFixed(2)}s`)
        .join(' · ');
      return { ...base, kind: 'watchout', text: `🖐️ ${n(e.loser)} 最慢！`, sub: times || '沒有人拍', tone: 'danger', ms: 2600, sticky: true };
    }
    default:
      return null;
  }
}

export function Spotlight({ room }: { room: RoomHandle }) {
  const [queue, setQueue] = useState<Spot[]>([]);
  // 只顯示掛上之後的新事件（重新連線不重播）
  const seen = useRef(room.log.at(-1)?.id ?? 0);
  const v = room.view;

  useEffect(() => {
    const fresh = room.log.filter((e) => e.id > seen.current);
    if (!fresh.length || !v) return;
    seen.current = fresh.at(-1)!.id;
    const n = (i: number) => (i === v.you ? '你' : (v.players[i]?.name ?? '?'));
    const spots = fresh.map((e) => toSpot(e.id, e.event, n)).filter((s) => s !== null);
    // 一般訊息被新事件直接取代，避免畫面落後；重要訊息照順序顯示完
    if (spots.length) setQueue((q) => [...q.filter((x) => x.sticky), ...spots].slice(-6));
  }, [room.log, v]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    // 後面還有排隊時加快
    const ms = queue.length > 2 ? Math.min(current.ms, 900) : current.ms;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), ms);
    return () => clearTimeout(t);
  }, [current, queue.length]);

  if (!current) return null;
  return (
    <div className={`spotlight tone-${current.tone}`} key={current.id} role="status" aria-live="polite">
      {current.kind && <CardView kind={current.kind} size="md" />}
      <div className="spot-text">
        <strong>{current.text}</strong>
        {current.sub && <span>{current.sub}</span>}
      </div>
    </div>
  );
}
