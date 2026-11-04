/** 亂數來源。伺服器用 cryptoRng，測試用 seededRng 以便重現。 */
export interface Rng {
  /** 回傳 [0, 1) 的亂數 */
  next(): number;
}

export const cryptoRng: Rng = {
  next() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! / 2 ** 32;
  },
};

/** mulberry32，可重現的亂數（僅供測試／模擬） */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng.next() * n);
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)]!;
}

/** Fisher–Yates，原地洗牌 */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
