/** 卡牌顯示與前端出牌提示（真正的規則判定在伺服器） */
import {
  CARD_INFO,
  LAYERS,
  isSpecies,
  layerOf,
  type Card,
  type CardKind,
  type GameEvent,
  type PlayLabel,
} from '@pufferfish/engine';

export const cardImg = (kind: CardKind | 'back') => `/cards/${kind}.webp`;

/** 在等待室先載入所有卡圖，開局後不會邊玩邊載 */
export function preloadCards() {
  for (const kind of [...(Object.keys(CARD_INFO) as CardKind[]), 'back' as const]) {
    const img = new Image();
    img.src = cardImg(kind);
  }
}
export const cardName = (kind: CardKind) => CARD_INFO[kind].name;

export const PLAY_NAMES: Partial<Record<PlayLabel, string>> = {
  net: '漁網',
  fisher: '漁販',
  torpedo: '魚雷',
  win: '收集勝利',
};

export const CARD_HELP: Record<CardKind, string> = {
  clownfish: '淺海生物',
  dolphin: '淺海生物',
  seal: '淺海生物',
  stingray: '淺海生物',
  jellyfish: '淺海生物',
  isopod: '深海生物',
  barreleye: '深海生物',
  catshark: '深海生物',
  sacabambaspis: '深海生物',
  anglerfish: '深海生物',
  puffer: '抽到時沒有 Chill 就淘汰',
  chill: '抽到河豚時自動擋下一次',
  noway: '回應時使用：取消上一個動作',
  watchout: '大家搶拍，最慢的人手牌重洗',
  wave: '棄牌堆洗回牌堆',
  chef: '拿「存活人數」張，自己挑一張，其餘分給大家',
  steal: '隨機偷一位玩家 1 張牌',
  salmon: '下一位玩家抽 2 張',
  pass: '被指定時使用：把效果轉給下一位',
  reverse: '出牌方向反轉',
  switch: '和一位玩家交換整副手牌',
};

const KIND_ORDER: CardKind[] = [
  ...LAYERS.shallow,
  ...LAYERS.deep,
  'steal',
  'salmon',
  'switch',
  'chef',
  'wave',
  'reverse',
  'watchout',
  'noway',
  'pass',
  'chill',
  'puffer',
];

/** 手牌顯示順序：生物（依海洋層）→ 功能牌 → Chill */
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

export interface SelectionInfo {
  valid: boolean;
  label: string;
  needsTarget: boolean;
}

/** 依選取的牌給出提示 */
export function describeSelection(cards: Card[], discardCount: number): SelectionInfo {
  if (cards.length === 0) return { valid: false, label: '選擇要出的牌', needsTarget: false };
  if (cards.length === 1) {
    const kind = cards[0]!.kind;
    if (isSpecies(kind)) return { valid: true, label: `打出 ${cardName(kind)}（無效果）`, needsTarget: false };
    if (kind === 'chill') return { valid: false, label: 'Chill 不能主動打出', needsTarget: false };
    if (kind === 'noway' || kind === 'pass') return { valid: false, label: '這張牌只能在回應時使用', needsTarget: false };
    if (kind === 'steal' || kind === 'switch') return { valid: true, label: `打出 ${cardName(kind)}`, needsTarget: true };
    return { valid: true, label: `打出 ${cardName(kind)}`, needsTarget: false };
  }
  const kinds = cards.map((c) => c.kind);
  if (!kinds.every(isSpecies)) return { valid: false, label: '功能牌不能組合', needsTarget: false };
  if (cards.length <= 4 && kinds.every((k) => k === kinds[0])) {
    if (cards.length === 2) {
      return discardCount > 0
        ? { valid: true, label: '漁網：拿走棄牌堆最上面那張', needsTarget: false }
        : { valid: false, label: '棄牌堆是空的，不能用漁網', needsTarget: false };
    }
    if (cards.length === 3) return { valid: true, label: '漁販：抽 5 張留 3 張', needsTarget: false };
    return { valid: true, label: '魚雷：開啟轟炸模式！', needsTarget: false };
  }
  if (cards.length === 5 && new Set(kinds).size === 5) {
    const layers = new Set(kinds.map((k) => layerOf(k as never)));
    if (layers.size === 1) return { valid: true, label: '🏆 收集勝利！', needsTarget: false };
  }
  return { valid: false, label: '組合技需為同種生物 2～4 張，或同一海洋層 5 種', needsTarget: false };
}

/** 把事件轉成給人看的文字；不需要顯示的回傳 null */
export function describeEvent(e: GameEvent, names: string[], you: number): string | null {
  const n = (i: number) => (i === you ? '你' : (names[i] ?? '?'));
  const list = (cards: Card[]) => cards.map((c) => cardName(c.kind)).join('、');
  switch (e.type) {
    case 'turnStart':
      return `── 輪到 ${n(e.player)} ──`;
    case 'draw':
      return `${n(e.player)} 抽了 ${e.count} 張`;
    case 'gotCards':
      return `你拿到 ${list(e.cards)}`;
    case 'peek':
      return `你看到 ${list(e.cards)}`;
    case 'deckEmpty':
      return '牌堆沒牌了';
    case 'pufferDefused':
      return `🐡 ${n(e.player)} 抽到生氣的河豚，用 Chill 擋下了！`;
    case 'pufferPlaced':
      return e.position === undefined
        ? `${n(e.player)} 把河豚偷偷放回牌堆`
        : `你把河豚放在牌堆第 ${e.position + 1} 張`;
    case 'eliminated':
      return `💥 ${n(e.player)} 被${e.reason === 'torpedo' ? '魚雷' : '生氣的河豚'}淘汰了`;
    case 'played': {
      const what =
        e.play === 'discard'
          ? `${cardName(e.cards[0]!.kind)}（無效果）`
          : (PLAY_NAMES[e.play] ?? cardName(e.cards[0]!.kind));
      return `${n(e.player)} 打出 ${what}${e.target !== undefined ? ` → ${n(e.target)}` : ''}`;
    }
    case 'responded':
      return e.card.kind === 'pass'
        ? `${n(e.player)} 打出 Pass，轉給 ${n(e.passTo!)}`
        : `${n(e.player)} 打出 No way！`;
    case 'windowClosed':
      return e.cancelled ? '❌ 被 No way 取消了' : null;
    case 'stole':
      return `${n(e.player)} 從 ${n(e.target)} 偷走${e.card ? ` ${cardName(e.card.kind)}` : ' 1 張牌'}`;
    case 'switched':
      return `${n(e.player)} 和 ${n(e.target)} 交換了手牌`;
    case 'reversed':
      return `🔄 出牌方向變成${e.direction === 1 ? '順時針' : '逆時針'}`;
    case 'waved':
      return `🌊 棄牌堆 ${e.count} 張洗回牌堆`;
    case 'netTaken':
      return `${n(e.player)} 用漁網拿走 ${cardName(e.card.kind)}`;
    case 'chefDealt':
      return `${n(e.player)} 把牌分給大家`;
    case 'fisherDone':
      return `${n(e.player)} 留下 ${e.kept} 張${e.returned ? `，放回 ${e.returned} 張到牌堆頂` : ''}`;
    case 'slapResult':
      return `🖐️ ${n(e.loser)} 最慢！手牌洗回牌堆重抽`;
    case 'handReset':
      return null;
    case 'bombStart':
      return `💣 ${n(e.player)} 發動魚雷！轟炸模式開始`;
    case 'bombDraw':
      return `${n(e.player)} 抽到 ${cardName(e.card.kind)}`;
    case 'skipPlay':
      return `${n(e.player)} 沒有能出的牌，跳過`;
    case 'gameOver':
      return `🏆 ${n(e.winner)} 獲勝！`;
  }
}
