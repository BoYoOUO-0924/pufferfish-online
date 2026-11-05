/**
 * 特效層：把伺服器送來的每個事件排成時間軸，依序播放飛牌、粒子、震動、字卡與音效。
 * 放在牌桌最前面，讓它的 layout effect 比手牌／棄牌先執行（先登記「牌從哪裡來」）。
 */
import type { CardKind, GameEvent, PlayerView } from '@pufferfish/engine';
import type { Card } from '@pufferfish/engine';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PLAY_NAMES, cardName } from '../cards';
import {
  burstAt,
  fly,
  flash,
  handRects,
  incoming,
  outgoing,
  pulse,
  rectAnchor,
  reducedMotion,
  setFxLayer,
  setHandDefault,
  setParticleCanvas,
  shake,
} from '../fx/fx';
import type { RoomHandle } from '../net';
import { sfxAt, type SoundName } from '../sfx';
import { CardView } from './CardView';
import { Icon, type IconName } from './Icon';

type Tone = 'info' | 'danger' | 'good' | 'warn';

interface Callout {
  id: number;
  kind?: CardKind | null;
  icon?: IconName;
  text: string;
  sub?: string;
  tone: Tone;
  /** stamp：大字蓋章；card：卡片展示；toast：小提示 */
  style: 'stamp' | 'card' | 'toast' | 'hero';
  dur: number;
}

const FUNCTION_SOUND: Partial<Record<string, SoundName>> = {
  steal: 'steal',
  salmon: 'salmon',
  switch: 'switch',
  chef: 'chef',
  wave: 'wave',
  reverse: 'reverse',
  watchout: 'alarm',
  net: 'net',
  fisher: 'fisher',
  torpedo: 'siren',
};

const S = (i: number) => `seat:${i}`;
let calloutSeq = 0;

export function FxLayer({ room }: { room: RoomHandle }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [toast, setToast] = useState<Callout | null>(null);
  // 只播掛上之後的新事件（重新連線不重播）
  const seen = useRef(room.log.at(-1)?.id ?? 0);
  const timers = useRef<number[]>([]);
  const viewRef = useRef<PlayerView | null>(room.view);
  viewRef.current = room.view;

  useEffect(() => {
    setFxLayer(layerRef.current);
    setParticleCanvas(canvasRef.current);
    const ts = timers.current;
    return () => {
      setFxLayer(null);
      setParticleCanvas(null);
      ts.forEach(clearTimeout);
    };
  }, []);

  useLayoutEffect(() => {
    const fresh = room.log.filter((e) => e.id > seen.current);
    const v = viewRef.current;
    if (!fresh.length || !v) return;
    seen.current = fresh.at(-1)!.id;
    const later = (ms: number, fn: () => void) => {
      if (ms <= 0) return fn();
      timers.current.push(window.setTimeout(fn, ms));
    };
    const show = (c: Omit<Callout, 'id'>, at: number) =>
      later(at, () => {
        const item = { ...c, id: ++calloutSeq };
        const set = c.style === 'toast' ? setToast : setCallout;
        set(item);
        timers.current.push(window.setTimeout(() => set((x) => (x?.id === item.id ? null : x)), c.dur));
      });
    direct(
      fresh.map((x) => x.event),
      v,
      { later, show },
    );
  }, [room.log]);

  return (
    <div className="fx-root" aria-hidden={false}>
      <canvas ref={canvasRef} className="fx-canvas" />
      <div ref={layerRef} className="fx-layer" />
      {callout && <CalloutView key={callout.id} c={callout} />}
      {toast && <CalloutView key={toast.id} c={toast} />}
    </div>
  );
}

function CalloutView({ c }: { c: Callout }) {
  return (
    <div
      className={`callout callout-${c.style} tone-${c.tone}`}
      style={{ ['--dur' as string]: `${c.dur}ms` }}
      role="status"
      aria-live="polite"
    >
      {c.kind && <CardView kind={c.kind} size="md" />}
      {c.icon && <Icon name={c.icon} className="callout-icon" />}
      <div className="callout-text">
        <strong>{c.text}</strong>
        {c.sub && <span>{c.sub}</span>}
      </div>
    </div>
  );
}

interface Ctx {
  later: (ms: number, fn: () => void) => void;
  show: (c: Omit<Callout, 'id'>, at: number) => void;
}

/** 事件 → 時間軸 */
function direct(events: GameEvent[], v: PlayerView, { later, show }: Ctx) {
  const me = v.you;
  const n = (i: number) => (i === me ? '你' : (v.players[i]?.name ?? '?'));
  const now = performance.now();
  let t = 0;
  // 下一個 gotCards 的來源（抽牌、Chef、漁販…）
  let pend: { from: string; delay: number; step: number } | null = null;
  // 一批事件太長時壓縮節奏，避免畫面落後
  const pace = events.length > 14 ? 0.55 : events.length > 8 ? 0.75 : 1;
  const beat = (ms: number) => (t += ms * pace);
  const sound = (name: SoundName, at = t) => sfxAt(name, at);
  const fromOf = (p: number, id: string) => {
    const r = p === me ? handRects.get(id) : undefined;
    return r ? rectAnchor(r) : S(p);
  };
  const toDiscard = (p: number, cards: { id: string; kind: CardKind }[], at: number) => {
    cards.forEach((c, i) => {
      const delay = at + i * 90;
      incoming.set(c.id, { from: fromOf(p, c.id), delay, at: now });
      if (p === me) outgoing.set(c.id, { to: 'discard', delay, at: now });
      sound('play', delay + 380);
    });
  };

  let lastPeek: Card | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'turnStart': {
        later(t, () => pulse(S(e.player), [{ scale: 1 }, { scale: 1.12 }, { scale: 1 }], { duration: 420, easing: 'ease-out' }));
        if (e.player === me) {
          show({ text: '輪到你了！', tone: 'warn', style: 'hero', dur: 1100, icon: 'sparkle' }, t);
          sound('turn');
          later(t, () => burstAt('sparkle', S(me), 0, 18));
        } else sound('tick');
        beat(200);
        break;
      }
      case 'draw': {
        if (e.bottom) {
          show({ text: `${n(e.player)} 深潛：從牌堆底抽牌`, tone: 'info', style: 'toast', dur: 1300 }, t);
          later(t, () => burstAt('bubbles', 'deck', 0, 20));
        }
        if (e.player === me) pend = { from: 'deck', delay: t, step: 150 };
        else for (let k = 0; k < e.count; k++) fly({ kind: 'back', from: 'deck', to: S(e.player), delay: t + k * 150, arc: 40 });
        for (let k = 0; k < e.count; k++) sound('draw', t + k * 150);
        beat(380 + 150 * (e.count - 1));
        break;
      }
      case 'gotCards': {
        const p = pend ?? { from: 'deck', delay: t, step: 120 };
        e.cards.forEach((c, i) => {
          const delay = p.delay + i * p.step;
          if (c.kind === 'puffer') {
            // 河豚不會進手牌：翻開飛到桌子中央，接著播擋下或淘汰
            fly({ kind: 'puffer', from: p.from, to: 'center', delay, dur: 600, flip: true, hold: 900, arc: 30 });
          } else incoming.set(c.id, { from: p.from, delay, at: now });
        });
        pend = null;
        break;
      }
      case 'deckEmpty':
        show({ text: '牌堆沒牌了', tone: 'info', style: 'toast', dur: 1400 }, t);
        break;
      case 'pufferDefused': {
        sound('inflate');
        show({ kind: 'puffer', text: `${n(e.player)} 抽到生氣的河豚！`, sub: '幸好有 Chill……', tone: 'danger', style: 'card', dur: 900 }, t);
        later(t + 300, () => shake(0.5));
        beat(800);
        show({ kind: 'chill', text: '用 Chill 擋下了！', sub: '河豚偷偷放回牌堆', tone: 'good', style: 'card', dur: 1300 }, t);
        sound('defuse');
        later(t, () => {
          burstAt('sparkle', 'center', 0, 50);
          burstAt('bubbles', 'center', 0, 24);
        });
        if (e.player === me) setHandDefault(null, { to: 'center', delay: t, at: now });
        beat(900);
        break;
      }
      case 'pufferPlaced': {
        fly({ kind: 'back', from: e.player === me ? 'center' : S(e.player), to: 'deck', delay: t, arc: 80, spin: 180 });
        sound('draw');
        if (e.position !== undefined) {
          show({ text: `河豚放在第 ${e.position + 1} 張`, tone: 'info', style: 'toast', dur: 1400 }, t);
        }
        beat(550);
        break;
      }
      case 'eliminated': {
        const seat = S(e.player);
        sound('inflate');
        later(t, () => pulse(seat, [{ scale: 1 }, { scale: 1.35, filter: 'hue-rotate(-40deg) saturate(2)' }, { scale: 1.5 }], { duration: 550, easing: 'ease-in' }));
        beat(550);
        sound('explode');
        later(t, () => {
          burstAt('explosion', seat, 0, 110);
          burstAt('smoke', seat, 120);
          shake(1.6);
          flash('radial-gradient(circle, rgba(255,200,80,.9), rgba(255,60,40,.6))');
        });
        show(
          {
            kind: 'puffer',
            text: e.player === me ? '你被淘汰了……' : `${n(e.player)} 淘汰！`,
            sub: e.reason === 'torpedo' ? '被魚雷炸到了' : '河豚氣炸了',
            tone: 'danger',
            style: 'card',
            dur: 1800,
          },
          t,
        );
        if (e.player === me) {
          setHandDefault(null, { to: 'discard', delay: t + 300, at: now });
          sound('lose', t + 600);
        } else for (let k = 0; k < 3; k++) fly({ kind: 'back', from: seat, to: 'discard', delay: t + 300 + k * 90, spin: 200 });
        beat(1500);
        break;
      }
      case 'played': {
        toDiscard(e.player, e.cards, t);
        const land = t + 420 + (e.cards.length - 1) * 90;
        if (e.play === 'discard') {
          beat(420);
          break;
        }
        if (e.play === 'snorkel' || e.play === 'deepdive') {
          sound('bubble', land);
          later(land, () => burstAt('bubbles', e.play === 'snorkel' ? 'deck' : S(e.player), 0, 22));
          if (e.play === 'deepdive') {
            show({ kind: e.cards[0]!.kind, text: `${n(e.player)} 深潛`, sub: '這回合從牌堆底抽牌', tone: 'info', style: 'toast', dur: 1500 }, land);
          }
          beat(450);
          break;
        }
        if (e.play === 'win') {
          later(land, () => burstAt('sparkle', 'discard', 0, 60));
          beat(600);
          break;
        }
        const name = PLAY_NAMES[e.play] ?? cardName(e.cards[0]!.kind);
        const key = e.play === 'net' || e.play === 'fisher' || e.play === 'torpedo' ? e.play : e.cards[0]!.kind;
        const snd = FUNCTION_SOUND[key];
        if (snd) sound(snd, land);
        show(
          {
            kind: e.cards[0]!.kind,
            text: `${n(e.player)} 打出 ${name}`,
            sub: e.target !== undefined ? `對象：${n(e.target)}` : undefined,
            tone: e.play === 'torpedo' ? 'danger' : 'info',
            style: 'card',
            dur: 1300,
          },
          land,
        );
        if (e.target !== undefined) {
          const tgt = S(e.target);
          later(land, () => pulse(tgt, [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '-5deg' }, { rotate: '0deg' }], { duration: 500 }));
        }
        beat(420 + (e.cards.length - 1) * 90 + 450);
        break;
      }
      case 'responded': {
        toDiscard(e.player, [e.card], t);
        const land = t + 380;
        if (e.card.kind === 'noway') {
          sound('noway', land);
          show({ text: 'NO WAY!', sub: n(e.player), tone: 'danger', style: 'stamp', dur: 1100 }, land);
          later(land, () => shake(0.7));
        } else {
          sound('pass', land);
          show({ text: 'PASS!', sub: `${n(e.player)} → ${n(e.passTo!)}`, tone: 'warn', style: 'stamp', dur: 1100 }, land);
          if (e.passTo !== undefined) {
            fly({ kind: 'pass', from: S(e.player), to: S(e.passTo), delay: land, arc: 70, hold: 200 });
            later(land + 500, () => pulse(S(e.passTo!), [{ scale: 1 }, { scale: 1.15 }, { scale: 1 }], { duration: 400 }));
          }
        }
        beat(800);
        break;
      }
      case 'windowClosed': {
        if (e.cancelled) {
          sound('cancel');
          show({ text: '取消！', sub: '動作被 No way 擋下', tone: 'danger', style: 'stamp', dur: 900 }, t);
          beat(600);
        }
        break;
      }
      case 'stole': {
        sound('steal');
        if (e.card && e.player === me) incoming.set(e.card.id, { from: S(e.target), delay: t, at: now });
        else if (e.card && e.target === me) outgoing.set(e.card.id, { to: S(e.player), delay: t, at: now });
        else fly({ kind: 'back', from: S(e.target), to: S(e.player), delay: t, arc: 90, spin: 360 });
        if (e.card && (e.player === me || e.target === me)) {
          show({ kind: e.card.kind, text: e.player === me ? `偷到 ${cardName(e.card.kind)}！` : `被偷走 ${cardName(e.card.kind)}`, tone: e.player === me ? 'good' : 'danger', style: 'toast', dur: 1600 }, t + 500);
        }
        beat(650);
        break;
      }
      case 'switched': {
        sound('switch');
        const a = S(e.player);
        const b = S(e.target);
        for (let k = 0; k < 3; k++) {
          fly({ kind: 'back', from: a, to: b, delay: t + k * 80, arc: 100, spin: 180 });
          fly({ kind: 'back', from: b, to: a, delay: t + k * 80, arc: -60, spin: -180 });
        }
        if (e.player === me || e.target === me) {
          const other = S(e.player === me ? e.target : e.player);
          setHandDefault({ from: other, delay: t + 250, at: now }, { to: other, delay: t, at: now });
        }
        beat(900);
        break;
      }
      case 'reversed': {
        sound('reverse');
        show({ icon: e.direction === 1 ? 'rotateCw' : 'rotateCcw', text: e.direction === 1 ? '改成順時針' : '改成逆時針', tone: 'info', style: 'stamp', dur: 1100 }, t);
        beat(700);
        break;
      }
      case 'waved': {
        sound('wave');
        if (e.deckOnly) {
          later(t, () => {
            waveSweep();
            pulse('deck', [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '0deg' }], { duration: 600, easing: 'ease-in-out' });
            burstAt('bubbles', 'deck', 100, 34);
          });
          show({ text: '牌堆重新洗牌', sub: '河豚的位置又不知道了', tone: 'info', style: 'toast', dur: 1600 }, t + 200);
          beat(1100);
          break;
        }
        later(t, () => waveSweep());
        for (let k = 0; k < Math.min(8, e.count); k++) {
          fly({ kind: 'back', from: 'discard', to: 'deck', delay: t + 250 + k * 70, arc: 50, spin: 90 });
        }
        later(t + 300, () => {
          burstAt('splash', 'discard', 0, 50);
          burstAt('bubbles', 'deck', 300, 30);
        });
        show({ text: `${e.count} 張棄牌洗回牌堆`, tone: 'info', style: 'toast', dur: 1600 }, t + 300);
        beat(1300);
        break;
      }
      case 'netTaken': {
        if (e.player === me) incoming.set(e.card.id, { from: 'discard', delay: t, at: now });
        else fly({ kind: e.card.kind, from: 'discard', to: S(e.player), delay: t, arc: 60, hold: 250 });
        show({ kind: e.card.kind, text: `${n(e.player)} 撈走 ${cardName(e.card.kind)}`, tone: 'info', style: 'toast', dur: 1500 }, t);
        beat(600);
        break;
      }
      case 'chefDealt': {
        const idx = e.recipients.indexOf(me);
        e.recipients.forEach((r, i) => {
          if (r !== me) fly({ kind: 'back', from: S(e.player), to: S(r), delay: t + i * 200, arc: 70, spin: 360 });
          sound('draw', t + i * 200);
        });
        // 後面只會有一個給自己的 gotCards：Chef 本人留下的牌，或分到自己的那張
        pend =
          e.player === me
            ? { from: 'center', delay: t, step: 0 }
            : idx >= 0
              ? { from: S(e.player), delay: t + idx * 200, step: 0 }
              : null;
        beat(250 + 200 * e.recipients.length);
        break;
      }
      case 'fisherDone': {
        if (e.player !== me) for (let k = 0; k < e.kept; k++) fly({ kind: 'back', from: 'deck', to: S(e.player), delay: t + k * 120 });
        else pend = { from: 'center', delay: t, step: 120 };
        if (e.returned) for (let k = 0; k < e.returned; k++) fly({ kind: 'back', from: 'center', to: 'deck', delay: t + 200 + k * 120 });
        beat(600);
        break;
      }
      case 'slapResult': {
        sound('slap');
        later(t, () => {
          pulse(S(e.loser), [{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '-4px 0' }, { translate: '0 0' }], { duration: 400 });
          burstAt('smoke', S(e.loser));
          shake(0.6);
        });
        const times = [...e.slaps]
          .sort((a, b) => a.t - b.t)
          .map((s) => `${n(s.player)} ${(s.t / 1000).toFixed(2)}s`)
          .join(' · ');
        show({ kind: 'watchout', text: `${n(e.loser)} 最慢！`, sub: times || '沒有人拍', tone: 'danger', style: 'card', dur: 2000 }, t);
        beat(1200);
        break;
      }
      case 'handReset': {
        if (e.player === me) setHandDefault({ from: 'deck', delay: t + 500, at: now }, { to: 'deck', delay: t, at: now });
        else {
          for (let k = 0; k < Math.min(5, e.count); k++) {
            fly({ kind: 'back', from: S(e.player), to: 'deck', delay: t + k * 80, spin: 180 });
            fly({ kind: 'back', from: 'deck', to: S(e.player), delay: t + 500 + k * 80 });
          }
        }
        sound('draw', t + 500);
        beat(900);
        break;
      }
      case 'bombStart': {
        sound('siren');
        later(t, () => {
          flash('radial-gradient(circle, rgba(255,40,40,.0) 30%, rgba(255,30,30,.85))', 0, 900);
          shake(1.2);
        });
        show({ icon: 'torpedo', text: '魚雷！', sub: `${n(e.player)} 發動轟炸：Chill 無效`, tone: 'danger', style: 'stamp', dur: 1500 }, t);
        beat(1300);
        break;
      }
      case 'bombDraw': {
        const boom = e.card.kind === 'puffer';
        fly({ kind: e.card.kind, from: 'deck', to: S(e.player), delay: t, dur: 600, flip: true, hold: boom ? 500 : 250, arc: 50 });
        sound('draw');
        if (!boom) later(t + 600, () => pulse(S(e.player), [{ scale: 1 }, { scale: 1.08 }, { scale: 1 }], { duration: 300 }));
        beat(boom ? 750 : 700);
        break;
      }
      case 'skipPlay':
        show({ text: `${n(e.player)} 沒有能出的牌，跳過`, tone: 'info', style: 'toast', dur: 1400 }, t);
        beat(400);
        break;
      case 'gameOver': {
        const won = e.winner === me;
        later(t + 200, () => {
          if (won) {
            burstAt('confetti', 'center', 0, 140);
            burstAt('confetti', 'center', 500, 100);
            burstAt('sparkle', 'center', 300, 50);
          } else burstAt('confetti', S(e.winner), 0, 70);
        });
        sound(won ? 'win' : 'lose', t + 200);
        break;
      }
      case 'snorkeled': {
        later(t, () => {
          pulse('deck', [{ translate: '0 0' }, { translate: '0 -10px' }, { translate: '0 0' }], { duration: 450, easing: 'ease-in-out' });
        });
        const seen = e.player === me ? lastPeek : null;
        if (seen) {
          show({ kind: seen.kind, text: `牌堆頂是 ${cardName(seen.kind)}`, tone: seen.kind === 'puffer' ? 'warn' : 'info', style: 'card', dur: 1700 }, t);
          beat(900);
        } else {
          show({ text: `${n(e.player)} 浮潛偷看了牌堆頂`, tone: 'info', style: 'toast', dur: 1400 }, t);
          beat(400);
        }
        break;
      }
      case 'sonarDone': {
        sound('fisher');
        for (let k = 0; k < e.count; k++) fly({ kind: 'back', from: 'center', to: 'deck', delay: t + k * 110, arc: 40 });
        later(t, () => burstAt('sparkle', 'deck', 0, 24));
        show({ text: `${n(e.player)} 用聲納排好了牌堆頂 ${e.count} 張`, tone: 'info', style: 'toast', dur: 1500 }, t);
        beat(600);
        break;
      }
      case 'peek':
        lastPeek = e.cards.length === 1 ? e.cards[0]! : null;
        break;
    }
  }
}

/** 浪潮掃過畫面 */
function waveSweep() {
  if (reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'fx-wave';
  document.querySelector('.fx-layer')?.append(el);
  el.animate([{ transform: 'translateX(-110%)' }, { transform: 'translateX(110%)' }], {
    duration: 1300,
    easing: 'cubic-bezier(.5,0,.4,1)',
  }).onfinish = () => el.remove();
}
