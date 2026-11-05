/** 音效：全部用 Web Audio 即時合成，不需要音檔 */
import { useSyncExternalStore } from 'react';

const MUTE_KEY = 'pufferfish:muted';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

/** 瀏覽器規定要有使用者操作後才能出聲：第一次點擊時建立 AudioContext */
function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}
if (typeof window !== 'undefined') {
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // ignore
  }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
  listeners.forEach((l) => l());
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const m = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
  );
  return [m, setMuted];
}

const ready = () => !!ctx && !!master && !muted && ctx.state === 'running';

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  vol?: number;
  attack?: number;
}

function tone({ type = 'sine', freq, to, at = 0, dur, vol = 0.3, attack = 0.005 }: ToneOpts) {
  const c = ctx!;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noise({
  at = 0,
  dur,
  vol = 0.3,
  filter = 'bandpass',
  freq = 1200,
  to,
  q = 1,
}: {
  at?: number;
  dur: number;
  vol?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
}) {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

const notes = (seq: number[], step: number, o: Omit<ToneOpts, 'freq' | 'at'>) =>
  seq.forEach((f, i) => tone({ ...o, freq: f, at: i * step }));

const SOUNDS = {
  /** 選牌、按鈕 */
  tap: () => tone({ type: 'triangle', freq: 880, to: 1320, dur: 0.06, vol: 0.12 }),
  /** 抽牌：紙牌滑動聲 */
  draw: () => noise({ dur: 0.18, freq: 3000, to: 1200, q: 0.8, vol: 0.25 }),
  /** 出牌：拍到桌上 */
  play: () => {
    noise({ dur: 0.09, filter: 'lowpass', freq: 1800, vol: 0.4 });
    tone({ freq: 180, to: 90, dur: 0.12, vol: 0.25 });
  },
  /** 輪到你 */
  turn: () => notes([660, 990], 0.11, { type: 'triangle', dur: 0.25, vol: 0.22 }),
  /** 有人輪到（小聲） */
  tick: () => tone({ type: 'sine', freq: 1500, dur: 0.04, vol: 0.06 }),
  /** 倒數最後幾秒 */
  urgent: () => tone({ type: 'square', freq: 1200, dur: 0.05, vol: 0.06 }),
  /** 泡泡 */
  bubble: () => tone({ type: 'sine', freq: 300 + Math.random() * 300, to: 1400, dur: 0.12, vol: 0.12 }),
  noway: () => {
    tone({ type: 'sawtooth', freq: 220, to: 110, dur: 0.35, vol: 0.18 });
    tone({ type: 'square', freq: 233, to: 116, dur: 0.35, vol: 0.1 });
  },
  pass: () => {
    noise({ dur: 0.3, freq: 600, to: 4000, q: 2, vol: 0.25 });
    tone({ type: 'triangle', freq: 500, to: 1000, dur: 0.2, vol: 0.12 });
  },
  cancel: () => notes([440, 330, 220], 0.09, { type: 'square', dur: 0.12, vol: 0.1 }),
  steal: () => {
    tone({ type: 'triangle', freq: 1200, to: 300, dur: 0.18, vol: 0.18 });
    noise({ at: 0.05, dur: 0.15, freq: 2500, to: 600, vol: 0.15 });
  },
  switch: () => {
    tone({ type: 'triangle', freq: 400, to: 900, dur: 0.18, vol: 0.15 });
    tone({ type: 'triangle', freq: 900, to: 400, at: 0.18, dur: 0.18, vol: 0.15 });
  },
  reverse: () => {
    tone({ type: 'sine', freq: 300, to: 1200, dur: 0.25, vol: 0.2 });
    tone({ type: 'sine', freq: 1200, to: 300, at: 0.25, dur: 0.25, vol: 0.2 });
  },
  wave: () => {
    noise({ dur: 1.2, filter: 'lowpass', freq: 300, to: 2400, vol: 0.35, q: 0.5 });
    noise({ at: 0.6, dur: 0.9, filter: 'lowpass', freq: 2400, to: 200, vol: 0.25, q: 0.5 });
  },
  chef: () => notes([1047, 1319, 1568], 0.08, { type: 'sine', dur: 0.5, vol: 0.18 }),
  salmon: () => notes([523, 659], 0.1, { type: 'triangle', dur: 0.2, vol: 0.18 }),
  net: () => noise({ dur: 0.35, freq: 900, to: 300, q: 3, vol: 0.3 }),
  fisher: () => notes([392, 523, 659, 784], 0.07, { type: 'triangle', dur: 0.2, vol: 0.15 }),
  /** 河豚出現：膨脹聲 */
  inflate: () => tone({ type: 'sawtooth', freq: 80, to: 420, dur: 0.6, vol: 0.12, attack: 0.1 }),
  defuse: () => notes([523, 659, 784, 1047, 1319], 0.06, { type: 'triangle', dur: 0.35, vol: 0.18 }),
  explode: () => {
    noise({ dur: 1.1, filter: 'lowpass', freq: 1800, to: 80, vol: 0.9, q: 0.3 });
    tone({ type: 'sine', freq: 140, to: 30, dur: 0.9, vol: 0.6 });
  },
  siren: () => {
    for (let i = 0; i < 3; i++) {
      tone({ type: 'sawtooth', freq: 500, to: 900, at: i * 0.4, dur: 0.2, vol: 0.1 });
      tone({ type: 'sawtooth', freq: 900, to: 500, at: i * 0.4 + 0.2, dur: 0.2, vol: 0.1 });
    }
  },
  alarm: () => notes([880, 0, 880, 0, 880], 0.08, { type: 'square', dur: 0.07, vol: 0.12 }),
  slap: () => {
    noise({ dur: 0.12, filter: 'highpass', freq: 800, vol: 0.6 });
    tone({ freq: 200, to: 60, dur: 0.15, vol: 0.4 });
  },
  lose: () => notes([392, 370, 349, 330], 0.18, { type: 'triangle', dur: 0.3, vol: 0.18 }),
  win: () => {
    notes([523, 659, 784, 1047], 0.12, { type: 'triangle', dur: 0.3, vol: 0.2 });
    tone({ type: 'triangle', freq: 1319, at: 0.5, dur: 0.8, vol: 0.2 });
    tone({ type: 'sine', freq: 1568, at: 0.5, dur: 0.8, vol: 0.12 });
  },
  join: () => notes([660, 880], 0.07, { type: 'sine', dur: 0.15, vol: 0.15 }),
} satisfies Record<string, () => void>;

export type SoundName = keyof typeof SOUNDS;

export function sfx(name: SoundName) {
  if (!ready()) return;
  try {
    SOUNDS[name]();
  } catch {
    // 音效失敗不影響遊戲
  }
}

/** 延遲播放（配合動畫時間軸） */
export function sfxAt(name: SoundName, ms: number) {
  if (ms <= 0) return sfx(name);
  setTimeout(() => sfx(name), ms);
}
