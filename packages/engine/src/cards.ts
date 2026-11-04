/** 卡牌定義：種類、張數、海洋層、顯示名稱與圖檔。對應 docs/規則規格書.md 第 1 節。 */

export const SHALLOW = ['clownfish', 'dolphin', 'seal', 'stingray', 'sacabambaspis'] as const;
export const DEEP = ['isopod', 'barreleye', 'catshark', 'jellyfish', 'anglerfish'] as const;
export const SPECIES = [...SHALLOW, ...DEEP] as const;
export const LAYERS = { shallow: SHALLOW, deep: DEEP } as const;

export type Species = (typeof SPECIES)[number];
export type Layer = keyof typeof LAYERS;

export const FUNCTION_KINDS = [
  'noway',
  'watchout',
  'wave',
  'chef',
  'steal',
  'salmon',
  'pass',
  'reverse',
  'switch',
] as const;
export type FunctionKind = (typeof FUNCTION_KINDS)[number];

export type CardKind = Species | FunctionKind | 'puffer' | 'chill';

export interface Card {
  id: string;
  kind: CardKind;
}

export const CARD_COUNTS: Record<CardKind, number> = {
  clownfish: 4,
  dolphin: 4,
  seal: 4,
  stingray: 4,
  jellyfish: 4,
  isopod: 4,
  barreleye: 4,
  catshark: 4,
  sacabambaspis: 4,
  anglerfish: 4,
  puffer: 5,
  chill: 7,
  noway: 4,
  watchout: 1,
  wave: 2,
  chef: 2,
  steal: 4,
  salmon: 4,
  pass: 4,
  reverse: 1,
  switch: 1,
};

export const TOTAL_CARDS = Object.values(CARD_COUNTS).reduce((a, b) => a + b, 0); // 75

export const CARD_INFO: Record<CardKind, { name: string; image: string }> = {
  clownfish: { name: '小丑魚', image: '小丑魚.png' },
  dolphin: { name: '海豚', image: '海豚.png' },
  seal: { name: '海豹', image: '海豹.png' },
  stingray: { name: '魟魚', image: '魟魚.png' },
  jellyfish: { name: '水母', image: '水母.png' },
  isopod: { name: '大王具足蟲', image: '大王具足蟲.png' },
  barreleye: { name: '深海大眼魚', image: '深海大眼魚.png' },
  catshark: { name: '深海貓鯊', image: '深海貓鯊.png' },
  sacabambaspis: { name: '薩卡班甲魚', image: '薩卡班甲魚.png' },
  anglerfish: { name: '鮟鱇魚', image: '鮟鱇魚.png' },
  puffer: { name: '生氣的河豚', image: '河豚.png' },
  chill: { name: 'Chill', image: '胡蘿蔔.png' },
  noway: { name: 'No way', image: 'Noway.png' },
  watchout: { name: 'Watch Out!', image: 'WatchOut.png' },
  wave: { name: 'Wave!', image: 'Wave.png' },
  chef: { name: 'Chef', image: 'Chef.png' },
  steal: { name: 'Steal!', image: 'steal.png' },
  salmon: { name: 'Salmon', image: 'Salmon.png' },
  pass: { name: 'Pass', image: 'Pass.png' },
  reverse: { name: 'Reverse', image: 'reverse.png' },
  switch: { name: 'Switch!!', image: 'Switch.png' },
};

const speciesSet = new Set<string>(SPECIES);

export function isSpecies(kind: CardKind): kind is Species {
  return speciesSet.has(kind);
}

export function layerOf(kind: Species): Layer {
  return (SHALLOW as readonly string[]).includes(kind) ? 'shallow' : 'deep';
}
