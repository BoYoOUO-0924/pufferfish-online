/**
 * 動畫核心：錨點定位、飛牌、粒子、震動。
 * 畫面上的元素用 data-anchor 標記位置（deck / discard / center / seat:<i>），
 * 手牌與棄牌用 data-card-id 讓新出現的牌從來源位置「飛進來」（FLIP）。
 */
import type { CardKind } from '@pufferfish/engine';
import { cardImg } from '../cards';

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Box {
  x: number;
  y: number;
  w: number;
}

/** 錨點位置（中心點與代表寬度） */
export function anchorBox(name: string): Box | null {
  if (name.startsWith('rect:')) {
    const [x, y, w] = name.slice(5).split(',').map(Number) as [number, number, number];
    return { x, y, w };
  }
  const el = document.querySelector<HTMLElement>(`[data-anchor="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const isCard = el.dataset.cardAnchor !== undefined;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: isCard ? r.width : Math.min(44, r.width * 0.7) };
}

export const rectAnchor = (r: DOMRect) => `rect:${r.left + r.width / 2},${r.top + r.height / 2},${r.width}`;

let layer: HTMLElement | null = null;
export function setFxLayer(el: HTMLElement | null) {
  layer = el;
}

/** 卡片元素：正反兩面，可翻牌 */
function makeCard(kind: CardKind | 'back', w: number, flip: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fly-card';
  el.style.width = `${w}px`;
  const front = document.createElement('img');
  front.src = cardImg(kind);
  front.className = 'fly-face';
  front.draggable = false;
  el.append(front);
  if (flip) {
    const back = document.createElement('img');
    back.src = cardImg('back');
    back.className = 'fly-face fly-back';
    back.draggable = false;
    el.append(back);
    el.classList.add('flipping');
  }
  return el;
}

export interface FlyOpts {
  kind: CardKind | 'back';
  from: string;
  to: string;
  delay?: number;
  dur?: number;
  /** 從牌背翻成正面 */
  flip?: boolean;
  /** 弧線高度（px） */
  arc?: number;
  spin?: number;
  /** 抵達後停留再淡出 */
  hold?: number;
  onLand?: () => void;
}

/** 在覆蓋層上飛一張牌 */
export function fly({ kind, from, to, delay = 0, dur = 520, flip, arc = 60, spin = 0, hold = 0, onLand }: FlyOpts) {
  const a = anchorBox(from);
  const b = anchorBox(to);
  if (!layer || !a || !b) {
    if (onLand) setTimeout(onLand, delay + dur);
    return;
  }
  if (reducedMotion()) {
    dur = Math.min(dur, 160);
    arc = 0;
    spin = 0;
  }
  const w = b.w;
  const el = makeCard(kind, w, !!flip);
  layer.append(el);
  const s0 = a.w / w;
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - arc;
  const at = (x: number, y: number, s: number, r: number, ry = 0) =>
    `translate(${x - w / 2}px, ${y - (w * 1.55) / 2}px) scale(${s}) rotate(${r}deg) rotateY(${ry}deg)`;
  const ry0 = flip ? 180 : 0;
  const anim = el.animate(
    [
      { transform: at(a.x, a.y, s0, 0, ry0), opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.06 },
      { transform: at(mx, my, (s0 + 1) / 2 + 0.15, spin / 2, ry0 / 2), offset: 0.5 },
      { transform: at(b.x, b.y, 1, spin, 0), opacity: 1, offset: 1 },
    ],
    { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' },
  );
  anim.onfinish = () => {
    onLand?.();
    const out = el.animate([{ opacity: 1 }, { opacity: 0, transform: `${at(b.x, b.y, 0.9, spin, 0)}` }], {
      duration: 160,
      delay: hold,
      fill: 'forwards',
    });
    out.onfinish = () => el.remove();
  };
}

/** 在錨點上把元素做一次動畫（例如座位閃光、抖動） */
export function pulse(anchor: string, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
  const el = document.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`);
  if (!el || reducedMotion()) return;
  el.animate(keyframes, opts);
}

export const SHAKE: Keyframe[] = [
  { transform: 'translate(0,0)' },
  { transform: 'translate(-8px,4px) rotate(-.6deg)' },
  { transform: 'translate(7px,-5px) rotate(.5deg)' },
  { transform: 'translate(-6px,-3px)' },
  { transform: 'translate(5px,5px) rotate(.3deg)' },
  { transform: 'translate(-3px,2px)' },
  { transform: 'translate(0,0)' },
];

/** 整個畫面震動 */
export function shake(strength = 1, delay = 0) {
  if (reducedMotion()) return;
  const el = document.querySelector<HTMLElement>('.table');
  if (!el) return;
  el.animate(
    SHAKE.map((k) => ({
      transform: String(k.transform).replace(/-?\d+(\.\d+)?px/g, (m) => `${parseFloat(m) * strength}px`),
    })),
    { duration: 480, delay, easing: 'ease-out' },
  );
}

/** 畫面閃光（爆炸、魚雷） */
export function flash(color: string, delay = 0, dur = 500) {
  if (!layer || reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.background = color;
  layer.append(el);
  el.animate([{ opacity: 0 }, { opacity: 0.75, offset: 0.12 }, { opacity: 0 }], {
    duration: dur,
    delay,
    fill: 'both',
  }).onfinish = () => el.remove();
}

/* ───────── 粒子 ───────── */

export type BurstKind = 'confetti' | 'explosion' | 'sparkle' | 'bubbles' | 'splash' | 'smoke';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  g: number;
  drag: number;
  shape: 'rect' | 'circle' | 'star' | 'ring';
  rot: number;
  vr: number;
}

const PALETTES: Record<BurstKind, string[]> = {
  confetti: ['#ffd23f', '#ff6b6b', '#3ddc97', '#4cc9f0', '#f72585', '#ffffff'],
  explosion: ['#fff3b0', '#ffd23f', '#ff9f1c', '#ff5a36', '#d62828'],
  sparkle: ['#ffffff', '#b8fff0', '#6ef3d6', '#ffe66d'],
  bubbles: ['rgba(200,240,255,0.9)'],
  splash: ['#bff0ff', '#7fd8f5', '#ffffff', '#3fb6e0'],
  smoke: ['rgba(60,60,70,0.55)', 'rgba(90,90,100,0.45)'],
};

let canvas: HTMLCanvasElement | null = null;
let c2d: CanvasRenderingContext2D | null = null;
const parts: Particle[] = [];
let raf = 0;
let last = 0;

export function setParticleCanvas(el: HTMLCanvasElement | null) {
  canvas = el;
  c2d = el?.getContext('2d') ?? null;
  if (!el) {
    cancelAnimationFrame(raf);
    raf = 0;
    parts.length = 0;
  }
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    c2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function star(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.35 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  if (!c2d || !canvas) return;
  resize();
  c2d.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    p.life += dt;
    if (p.life >= p.max) {
      parts.splice(i, 1);
      continue;
    }
    p.vx *= 1 - p.drag * dt;
    p.vy = p.vy * (1 - p.drag * dt) + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const k = 1 - p.life / p.max;
    c2d.save();
    c2d.globalAlpha = Math.min(1, k * 1.6);
    c2d.translate(p.x, p.y);
    c2d.rotate(p.rot);
    c2d.fillStyle = p.color;
    c2d.strokeStyle = p.color;
    switch (p.shape) {
      case 'rect':
        c2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        break;
      case 'circle':
        c2d.beginPath();
        c2d.arc(0, 0, p.size * (p.color.startsWith('rgba(60') || p.color.startsWith('rgba(90') ? 1 + (1 - k) * 2 : k + 0.2), 0, Math.PI * 2);
        c2d.fill();
        break;
      case 'ring':
        c2d.lineWidth = 1.5;
        c2d.beginPath();
        c2d.arc(0, 0, p.size, 0, Math.PI * 2);
        c2d.stroke();
        break;
      case 'star':
        star(c2d, p.size * (0.4 + k * 0.6));
        break;
    }
    c2d.restore();
  }
  raf = parts.length ? requestAnimationFrame(frame) : 0;
  if (!raf) c2d.clearRect(0, 0, innerWidth, innerHeight);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 在某點爆出粒子 */
export function burst(kind: BurstKind, x: number, y: number, n?: number) {
  if (!c2d || reducedMotion()) return;
  const colors = PALETTES[kind];
  const count = n ?? { confetti: 90, explosion: 70, sparkle: 36, bubbles: 18, splash: 40, smoke: 18 }[kind];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const color = colors[Math.floor(Math.random() * colors.length)]!;
    const base = { x, y, life: 0, color, rot: rand(0, 6), vr: rand(-8, 8) };
    let p: Particle;
    switch (kind) {
      case 'confetti': {
        const sp = rand(250, 750);
        p = { ...base, vx: Math.cos(a) * sp * 0.7, vy: -Math.abs(Math.sin(a)) * sp - 120, max: rand(1.8, 3), size: rand(7, 12), g: 900, drag: 1.6, shape: 'rect' };
        break;
      }
      case 'explosion': {
        const sp = rand(120, 620);
        p = { ...base, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(0.5, 1.1), size: rand(3, 9), g: 260, drag: 2.6, shape: 'circle' };
        break;
      }
      case 'sparkle': {
        const sp = rand(80, 320);
        p = { ...base, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(0.6, 1.2), size: rand(5, 11), g: -40, drag: 2.2, shape: 'star', vr: rand(-3, 3) };
        break;
      }
      case 'bubbles': {
        p = { ...base, x: x + rand(-30, 30), y: y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-160, -60), max: rand(1, 2), size: rand(3, 9), g: -60, drag: 0.6, shape: 'ring' };
        break;
      }
      case 'splash': {
        const sp = rand(150, 450);
        p = { ...base, vx: Math.cos(a) * sp * 0.8, vy: -Math.abs(Math.sin(a)) * sp, max: rand(0.6, 1.1), size: rand(2, 6), g: 900, drag: 0.8, shape: 'circle' };
        break;
      }
      case 'smoke': {
        p = { ...base, x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-40, 40), vy: rand(-90, -30), max: rand(0.9, 1.6), size: rand(8, 16), g: -20, drag: 1, shape: 'circle' };
        break;
      }
    }
    parts.push(p);
  }
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

export function burstAt(kind: BurstKind, anchor: string, delay = 0, n?: number) {
  const run = () => {
    const b = anchorBox(anchor);
    if (b) burst(kind, b.x, b.y, n);
  };
  if (delay > 0) setTimeout(run, delay);
  else run();
}

/* ───────── 手牌／棄牌的「飛進來」資訊 ───────── */

/** delay 以 at（登記時刻，performance.now()）為起點 */
export interface Incoming {
  from: string;
  delay: number;
  at: number;
}
export interface Outgoing {
  to: string;
  delay: number;
  at: number;
}
/** 牌 id → 從哪裡飛進來 */
export const incoming = new Map<string, Incoming>();
/** 從手牌消失的牌 id → 飛去哪裡 */
export const outgoing = new Map<string, Outgoing>();
/** 手牌每張牌最後的位置（出牌時從這裡飛出去） */
export const handRects = new Map<string, DOMRect>();
/** 下一次手牌整批變動的預設來源／去向（交換手牌、重洗等） */
const handDefault: { in: Incoming | null; out: Outgoing | null } = { in: null, out: null };

export function setHandDefault(inn: Incoming | null, out: Outgoing | null) {
  handDefault.in = inn;
  handDefault.out = out;
}

const EXPIRE = 6000;
const fresh = (x: { at: number; delay: number } | null | undefined) =>
  !!x && performance.now() - x.at < x.delay + EXPIRE;
/** 剩下的延遲（扣掉登記後已經過的時間） */
const remain = (x: { at: number; delay: number }) => Math.max(0, x.delay - (performance.now() - x.at));

export function takeIncoming(id: string, fallback: string | null): { from: string; delay: number } | null {
  const x = incoming.get(id);
  incoming.delete(id);
  if (fresh(x)) return { from: x!.from, delay: remain(x!) };
  if (fresh(handDefault.in)) return { from: handDefault.in!.from, delay: remain(handDefault.in!) };
  return fallback ? { from: fallback, delay: 0 } : null;
}

export function takeOutgoing(id: string, fallback: string): { to: string; delay: number } {
  const x = outgoing.get(id);
  outgoing.delete(id);
  if (fresh(x)) return { to: x!.to, delay: remain(x!) };
  if (fresh(handDefault.out)) return { to: handDefault.out!.to, delay: remain(handDefault.out!) };
  return { to: fallback, delay: 0 };
}

/** 手牌整批更新後清掉預設值（只套用一次） */
export function clearHandDefault() {
  handDefault.in = null;
  handDefault.out = null;
}

/** 讓真實元素從來源位置飛到自己現在的位置 */
export function flipIn(el: HTMLElement, from: string, delay: number, opts: { dur?: number; spin?: number } = {}) {
  const a = anchorBox(from);
  const r = el.getBoundingClientRect();
  if (!a || !r.width) return;
  const dx = a.x - (r.left + r.width / 2);
  const dy = a.y - (r.top + r.height / 2);
  const s = a.w / r.width;
  const dur = reducedMotion() ? 150 : (opts.dur ?? 520);
  const spin = reducedMotion() ? 0 : (opts.spin ?? 0);
  // 只有位移很小時用簡短動畫
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${spin}deg)`, opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.08 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 50}px) scale(${(s + 1) / 2 + 0.12}) rotate(${spin / 2}deg)`, offset: 0.5 },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
    { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'backwards' },
  );
}
