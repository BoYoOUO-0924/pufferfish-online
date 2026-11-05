/** 牌桌元件：座位、計時圈、牌堆、棄牌堆、手牌（含飛入動畫） */
import type { Card, CardKind, PlayerView } from '@pufferfish/engine';
import type { SeatInfo } from '@pufferfish/protocol';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  clearHandDefault,
  flipIn,
  fly,
  handRects,
  rectAnchor,
  takeIncoming,
  takeOutgoing,
} from '../fx/fx';
import { CardView } from './CardView';
import { Icon } from './Icon';
import { Avatar } from './Mascot';

/** 頭像外的倒數圈：用負的 animation-delay 對齊剩餘時間 */
export function TimerRing({ deadline, totalMs, size }: { deadline: number | null; totalMs: number | null; size: number }) {
  if (deadline === null || !totalMs) return null;
  const remaining = Math.max(0, deadline - Date.now());
  const elapsed = Math.max(0, totalMs - remaining);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg className="timer-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="timer-ring-bg" />
      <circle
        key={deadline}
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="timer-ring-fg"
        style={{
          strokeDasharray: c,
          ['--c' as string]: `${c}px`,
          animationDuration: `${totalMs}ms`,
          animationDelay: `-${elapsed}ms`,
        }}
      />
    </svg>
  );
}

export function Seat({
  view: v,
  index: i,
  seat,
  turn,
  targetable,
  onTarget,
  deadline,
}: {
  view: PlayerView;
  index: number;
  seat: SeatInfo | undefined;
  turn: boolean;
  targetable: boolean;
  onTarget: () => void;
  deadline: number | null;
}) {
  const p = v.players[i]!;
  const fan = Math.min(p.handCount, 7);
  return (
    <button
      type="button"
      className={`seat${turn ? ' turn' : ''}${p.alive ? '' : ' dead'}${targetable ? ' targetable' : ''}`}
      disabled={!targetable}
      onClick={() => targetable && onTarget()}
      aria-label={`${p.name}${p.alive ? `，手牌 ${p.handCount} 張` : '，已淘汰'}${targetable ? '，點選作為對象' : ''}`}
    >
      <span className="seat-avatar" data-anchor={`seat:${i}`}>
        <Avatar name={p.name} isBot={p.isBot} seat={i} size={52} />
        {turn && <TimerRing deadline={deadline} totalMs={v.timer?.ms ?? null} size={64} />}
        {!p.alive && (
          <span className="seat-dead">
            <Icon name="skull" size={26} />
          </span>
        )}
        {seat && !seat.connected && !seat.isBot && (
          <span className="seat-offline" title="離線">
            <Icon name="wifiOff" size={14} />
          </span>
        )}
      </span>
      <span className="seat-name">{p.name}</span>
      {p.alive ? (
        <span className="seat-fan" aria-hidden="true">
          {Array.from({ length: fan }, (_, k) => (
            <i key={k} style={{ ['--k' as string]: k - (fan - 1) / 2 }} />
          ))}
          <b>{p.handCount}</b>
        </span>
      ) : (
        <span className="seat-tag dead-tag">淘汰</span>
      )}
      {seat?.botControlled && <span className="seat-tag">代打</span>}
      {p.alive && p.deepDive && (
        <span className="seat-tag dive" title="這回合從牌堆底抽牌">
          深潛中
        </span>
      )}
    </button>
  );
}

/** 牌堆：依剩餘張數疊出厚度 */
export function Deck({
  count,
  canDraw,
  onDraw,
  known = [],
}: {
  count: number;
  canDraw: boolean;
  onDraw: () => void;
  /** 深海變體：只有你知道的牌堆頂幾張（第 1 張是最上面） */
  known?: Card[];
}) {
  const layers = Math.min(6, Math.ceil(count / 8));
  return (
    <div className={`pile deck${canDraw ? ' can-draw' : ''}`}>
      <div className="deck-stack">
        {known.length > 0 && (
          <div className="deck-known" title="你知道的牌堆頂（左邊是最上面）" key={known.map((c) => c.id).join()}>
            {known.map((c, i) => (
              <CardView key={c.id} kind={c.kind} size="xs" className={i === 0 ? 'is-top' : undefined} />
            ))}
          </div>
        )}
        {Array.from({ length: layers }, (_, k) => (
          <span key={k} className="deck-layer" style={{ ['--k' as string]: layers - k }} />
        ))}
        <button
          type="button"
          className="card card-lg deck-top"
          data-anchor="deck"
          data-card-anchor=""
          onClick={canDraw ? onDraw : undefined}
          disabled={!canDraw}
          aria-label={canDraw ? '抽一張牌' : `牌堆剩 ${count} 張`}
        >
          <img src="/cards/back.webp" alt="" draggable={false} />
          {canDraw && <span className="draw-hint">抽牌</span>}
        </button>
      </div>
      <span className="pile-label">牌堆 {count}</span>
    </div>
  );
}

/** 依 id 算出固定的小角度，讓棄牌堆看起來是亂丟的 */
function tilt(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return { r: (h % 17) - 8, x: ((h >> 5) % 9) - 4, y: ((h >> 9) % 7) - 3 };
}

export function Discard({ cards }: { cards: Card[] }) {
  const top = cards.slice(-4);
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const els = [...ref.current!.querySelectorAll<HTMLElement>('[data-discard-id]')];
    const ids = new Set(els.map((e) => e.dataset.discardId!));
    if (prev.current) {
      for (const el of els) {
        const id = el.dataset.discardId!;
        if (prev.current.has(id)) continue;
        const inc = takeIncoming(id, null);
        if (inc) flipIn(el, inc.from, inc.delay, { dur: 440, spin: tilt(id).r * 4 });
      }
    }
    prev.current = ids;
  }, [cards]);
  return (
    <div className="pile discard">
      <div className="discard-stack" ref={ref}>
        <div className="card card-lg empty-slot" data-anchor="discard" data-card-anchor="" />
        {top.map((c) => {
          const t = tilt(c.id);
          return (
            <div
              key={c.id}
              className="discard-card"
              data-discard-id={c.id}
              style={{ transform: `translate(${t.x}px, ${t.y}px) rotate(${t.r}deg)` }}
            >
              <CardView kind={c.kind} size="lg" />
            </div>
          );
        })}
      </div>
      <span className="pile-label">棄牌 {cards.length}</span>
    </div>
  );
}

/** 方向環：繞著桌面慢慢轉 */
export function DirectionRing({ direction }: { direction: 1 | -1 }) {
  return (
    <svg className={`dir-ring ${direction === 1 ? 'cw' : 'ccw'}`} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="92" />
      {[0, 120, 240].map((a) => (
        <path
          key={a}
          d="M100 2 l-9 -6 v12z"
          transform={`rotate(${a} 100 100) ${direction === 1 ? '' : 'scale(-1 1) translate(-200 0)'}`}
        />
      ))}
    </svg>
  );
}

/**
 * 手牌：絕對定位排成扇形，增減牌時位置用 CSS transition 滑動；
 * 新拿到的牌從來源位置飛進來，失去的牌從原位置飛到目的地。
 */
export function Hand({
  cards,
  selected,
  onToggle,
  playable,
}: {
  cards: Card[];
  selected: string[];
  onToggle: (id: string) => void;
  playable: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [cardW, setCardW] = useState(96);
  const prev = useRef<Map<string, CardKind> | null>(null);
  const rects = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      setWidth(el.clientWidth);
      // CSS 變數是 clamp() 算式，直接量隱藏的樣本卡寬度
      const probe = el.querySelector<HTMLElement>('.hand-probe');
      setCardW(probe?.offsetWidth || 96);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = ref.current!;
    const els = [...root.querySelectorAll<HTMLElement>('[data-card-id]')];
    const now = new Map(cards.map((c) => [c.id, c.kind]));
    const before = prev.current;
    if (before) {
      let changed = false;
      for (const el of els) {
        const id = el.dataset.cardId!;
        if (before.has(id)) continue;
        changed = true;
        const inc = takeIncoming(id, 'deck');
        if (inc) flipIn(el, inc.from, inc.delay, { spin: -14 });
      }
      for (const [id, kind] of before) {
        if (now.has(id)) continue;
        changed = true;
        const out = takeOutgoing(id, 'discard');
        // 出到棄牌堆的牌由棄牌堆自己飛進去
        if (out.to === 'discard' && root.ownerDocument.querySelector(`[data-discard-id="${id}"]`)) continue;
        const r = rects.current.get(id);
        if (r) fly({ kind, from: rectAnchor(r), to: out.to, delay: out.delay, spin: 120, arc: 70 });
      }
      if (changed) clearHandDefault();
    }
    prev.current = now;
    // 等飛入動畫的延遲結束前，位置可能還在來源；只記沒在動畫中的牌
    const map = new Map<string, DOMRect>();
    for (const el of els) {
      const id = el.dataset.cardId!;
      const animating = el.getAnimations().length > 0;
      map.set(id, animating ? (rects.current.get(id) ?? el.getBoundingClientRect()) : el.getBoundingClientRect());
    }
    rects.current = map;
    handRects.clear();
    map.forEach((r, id) => handRects.set(id, r));
  });

  const n = cards.length;
  const avail = Math.max(0, width - cardW - 28);
  const step = n > 1 ? Math.min(cardW * 0.82, avail / (n - 1)) : 0;
  const total = step * (n - 1) + cardW;
  const start = (width - total) / 2;
  const spread = Math.min(3.5, 20 / Math.max(1, n));
  return (
    <div className={`hand${playable ? ' playable' : ''}`} ref={ref}>
      {cards.map((c, i) => {
        const off = i - (n - 1) / 2;
        return (
          <div
            key={c.id}
            className="hand-slot"
            style={{
              left: start + i * step,
              zIndex: i + 1,
              transform: `translateY(${Math.abs(off) ** 1.6 * 2.2}px) rotate(${off * spread}deg)`,
            }}
          >
            <CardView
              kind={c.kind}
              size="hand"
              cardId={c.id}
              selected={selected.includes(c.id)}
              onClick={playable ? () => onToggle(c.id) : undefined}
            />
          </div>
        );
      })}
      {n === 0 && <p className="hand-empty">沒有手牌</p>}
      <span className="card card-hand hand-probe" aria-hidden="true" />
    </div>
  );
}
