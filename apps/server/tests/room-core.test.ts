import { botAction, seededRng, TIMING, type Rng } from '@pufferfish/engine';
import type { ClientMessage, ServerMessage } from '@pufferfish/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, newRoomData, RoomCore, type RoomConfig } from '../src/room-core';

type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

class Harness {
  now = 1_000_000;
  sent: Record<string, ServerMessage[]> = {};
  rng: Rng;
  core: RoomCore;

  constructor(cfg: Partial<RoomConfig> = {}, seed = 7) {
    this.rng = seededRng(seed);
    this.core = new RoomCore(
      newRoomData('ABCDEF', this.now),
      { now: () => this.now, rng: this.rng, send: (c, m) => (this.sent[c] ??= []).push(m) },
      { ...DEFAULT_CONFIG, ...cfg },
    );
  }

  connect(conn: string) {
    this.core.onConnect(conn);
  }

  send(conn: string, msg: ClientMessage) {
    this.core.onMessage(conn, JSON.stringify(msg));
  }

  join(conn: string, name: string, token?: string) {
    this.connect(conn);
    this.send(conn, { type: 'join', name, token });
    return this.last(conn, 'joined');
  }

  last<T extends ServerMessage['type']>(conn: string, type: T): Msg<T> {
    const found = [...(this.sent[conn] ?? [])].reverse().find((m) => m.type === type);
    if (!found) throw new Error(`${conn} 沒有收到 ${type}`);
    return found as Msg<T>;
  }

  all<T extends ServerMessage['type']>(conn: string, type: T): Msg<T>[] {
    return (this.sent[conn] ?? []).filter((m) => m.type === type) as Msg<T>[];
  }

  clear() {
    this.sent = {};
  }

  /** 推進時間，途中依序觸發 Alarm */
  advance(ms: number) {
    const target = this.now + ms;
    for (let guard = 0; guard < 100_000; guard++) {
      const next = this.core.nextAlarm();
      if (next === null || next > target) break;
      this.now = Math.max(this.now, next);
      this.core.onAlarm();
      if (this.core.nextAlarm() === next) break; // 沒有進展（例如清除房間的時間）
    }
    this.now = target;
  }

  /** 建立 3 人房並開局 */
  startWith(humans: string[], bots = 0) {
    humans.forEach((h, i) => this.join(h, `玩家${i + 1}`));
    for (let i = 0; i < bots; i++) this.send(humans[0]!, { type: 'addBot' });
    this.send(humans[0]!, { type: 'start' });
  }
}

describe('房間：加入與大廳', () => {
  it('第一位加入者是房主，拿到重新連線用的 token', () => {
    const h = new Harness();
    const joined = h.join('c1', '阿明');
    expect(joined.token).toHaveLength(32);
    expect(joined.code).toBe('ABCDEF');
    const room = h.last('c1', 'room');
    expect(room.hostId).toBe(joined.playerId);
    expect(room.you).toBe(joined.playerId);
    expect(room.seats).toEqual([
      { id: joined.playerId, name: '阿明', isBot: false, connected: true, botControlled: false },
    ]);
    expect(JSON.stringify(h.last('c1', 'room'))).not.toContain(joined.token);
  });

  it('其他人加入時，所有人都會收到更新；別人收不到你的 token', () => {
    const h = new Harness();
    h.join('c1', 'A');
    const b = h.join('c2', 'B');
    expect(h.last('c1', 'room').seats).toHaveLength(2);
    expect(JSON.stringify(h.sent['c1'])).not.toContain(b.token);
  });

  it('暱稱需為 1～12 字', () => {
    const h = new Harness();
    h.connect('c1');
    h.send('c1', { type: 'join', name: '   ' });
    expect(h.last('c1', 'error').code).toBe('badName');
    h.send('c1', { type: 'join', name: '一二三四五六七八九十一二三' });
    expect(h.last('c1', 'error').code).toBe('badName');
  });

  it('最多 5 人', () => {
    const h = new Harness();
    for (let i = 1; i <= 5; i++) h.join(`c${i}`, `P${i}`);
    h.connect('c6');
    h.send('c6', { type: 'join', name: 'P6' });
    expect(h.last('c6', 'error').code).toBe('roomFull');
  });

  it('只有房主能加電腦、開始；少於 3 人不能開始', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.join('c2', 'B');
    h.send('c2', { type: 'addBot' });
    expect(h.last('c2', 'error').code).toBe('notHost');
    h.send('c1', { type: 'start' });
    expect(h.last('c1', 'error').code).toBe('notEnoughPlayers');
    h.send('c1', { type: 'addBot' });
    expect(h.last('c1', 'room').seats.map((s) => s.name)).toEqual(['A', 'B', '電腦 1']);
    h.send('c2', { type: 'start' });
    expect(h.last('c2', 'error').code).toBe('notHost');
  });

  it('房主可以移除電腦玩家', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.send('c1', { type: 'addBot' });
    const bot = h.last('c1', 'room').seats[1]!;
    h.send('c1', { type: 'removeBot', seatId: bot.id });
    expect(h.last('c1', 'room').seats).toHaveLength(1);
  });

  it('房主在大廳離開時，由下一位真人接手', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.send('c1', { type: 'addBot' });
    const b = h.join('c2', 'B');
    h.send('c1', { type: 'leave' });
    const room = h.last('c2', 'room');
    expect(room.hostId).toBe(b.playerId);
    expect(room.seats.map((s) => s.name)).toEqual(['電腦 1', 'B']);
  });

  it('遊戲開始後不能用新身分加入', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.connect('c4');
    h.send('c4', { type: 'join', name: 'D' });
    expect(h.last('c4', 'error').code).toBe('gameInProgress');
  });

  it('格式錯誤的訊息會回傳錯誤', () => {
    const h = new Harness();
    h.connect('c1');
    h.core.onMessage('c1', '{bad json');
    expect(h.last('c1', 'error').code).toBe('badMessage');
    h.core.onMessage('c1', JSON.stringify({ type: 'start' }));
    expect(h.last('c1', 'error').code).toBe('notJoined');
  });
});

describe('房間：遊戲進行', () => {
  it('開局後每人只拿到自己的視角，房主先手', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    const v1 = h.last('c1', 'state').view;
    const v2 = h.last('c2', 'state').view;
    expect(v1.you).toBe(0);
    expect(v2.you).toBe(1);
    expect(v1.hand).toHaveLength(7);
    expect(v1.hand.map((c) => c.id)).not.toEqual(v2.hand.map((c) => c.id));
    expect(v1.prompt).toEqual({ kind: 'draw', player: 0 });
    expect(h.last('c1', 'state').deadline).toBe(h.now + TIMING.turnMs);
    expect(h.last('c1', 'room').phase).toBe('playing');
  });

  it('玩家送出動作，伺服器補上座位；不是你的回合會收到錯誤', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.send('c2', { type: 'action', action: { type: 'draw' } });
    expect(h.last('c2', 'error').code).toBe('notYourTurn');
    h.send('c1', { type: 'action', action: { type: 'draw' } });
    expect(h.last('c1', 'state').view.hand).toHaveLength(8);
    expect(h.last('c2', 'state').view.players[0]!.handCount).toBe(8);
    // 抽到什麼只有自己知道
    const drew = h.last('c1', 'events').events.find((e) => e.type === 'gotCards');
    expect(drew).toBeDefined();
    expect(h.all('c2', 'events').flatMap((m) => m.events).some((e) => e.type === 'gotCards')).toBe(false);
  });

  it('不能假冒逾時', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.send('c1', { type: 'action', action: { type: 'timeout', timerId: 1 } as never });
    expect(h.last('c1', 'error').code).toBe('badMessage');
  });

  it('出牌逾時：30 秒後自動抽牌', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.advance(TIMING.turnMs - 1);
    expect(h.last('c1', 'state').view.prompt).toEqual({ kind: 'draw', player: 0 });
    h.advance(1);
    expect(h.last('c1', 'state').view.prompt?.kind).not.toBe('draw');
  });

  it('電腦玩家會在幾秒內自己行動', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.send('c1', { type: 'addBot' });
    h.send('c1', { type: 'addBot' });
    // 讓電腦先手：把房主移到最後
    h.core.d.seats.push(h.core.d.seats.shift()!);
    h.send('c1', { type: 'start' });
    expect(h.last('c1', 'state').view.prompt).toEqual({ kind: 'draw', player: 2 });
    h.core.d.game!.turn = 0;
    h.core.d.game!.prompt = { kind: 'draw', player: 0 };
    h.advance(3000);
    const turnCount = h.last('c1', 'state').view.turnCount;
    expect(h.last('c1', 'state').view.prompt).not.toEqual({ kind: 'draw', player: 0 });
    expect(turnCount).toBeGreaterThanOrEqual(1);
  });

  it('1 真人 + 2 電腦：真人完全不動，遊戲仍會靠逾時與電腦打完', () => {
    const h = new Harness();
    h.startWith(['c1'], 2);
    h.advance(6 * 60 * 60 * 1000);
    expect(h.last('c1', 'room').phase).toBe('ended');
    const view = h.last('c1', 'state').view;
    expect(view.phase).toBe('ended');
    expect(view.winner).not.toBeNull();
  });

  it('3 位真人透過訊息打完整局', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = new Harness({}, seed);
      const conns = ['c1', 'c2', 'c3'];
      h.startWith(conns);
      const policy = seededRng(seed * 100);
      for (let step = 0; step < 20_000 && h.core.phase === 'playing'; step++) {
        const g = h.core.d.game!;
        let acted = false;
        for (const [i, conn] of conns.entries()) {
          const a = botAction(g, i, policy);
          if (!a) continue;
          const { player: _p, ...action } = a;
          h.send(conn, { type: 'action', action: action as never });
          acted = true;
          break;
        }
        if (!acted) h.advance(100);
      }
      expect(h.core.phase).toBe('ended');
      for (const conn of conns) expect(h.all(conn, 'error')).toEqual([]);
    }
  });
});

describe('房間：斷線與重連', () => {
  it('用 token 重新連線會回到原座位，並收到目前局面', () => {
    const h = new Harness();
    const a = h.join('c1', 'A');
    h.join('c2', 'B');
    h.join('c3', 'C');
    h.send('c1', { type: 'start' });
    h.core.onClose('c1');
    expect(h.last('c2', 'room').seats[0]!.connected).toBe(false);
    h.clear();
    h.connect('c1b');
    h.send('c1b', { type: 'join', name: '', token: a.token });
    expect(h.last('c1b', 'joined').playerId).toBe(a.playerId);
    expect(h.last('c1b', 'state').view.you).toBe(0);
    expect(h.last('c2', 'room').seats[0]!.connected).toBe(true);
  });

  it('錯誤的 token 不能搶別人的座位', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.connect('x');
    h.send('x', { type: 'join', name: 'X', token: 'wrong-token' });
    expect(h.last('x', 'error').code).toBe('gameInProgress');
  });

  it('斷線超過 5 秒後由電腦代打，不用等 30 秒逾時', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.core.onClose('c1');
    h.advance(4_000);
    expect(h.last('c2', 'state').view.prompt).toEqual({ kind: 'draw', player: 0 });
    h.advance(4_000);
    expect(h.last('c2', 'state').view.prompt).not.toEqual({ kind: 'draw', player: 0 });
    expect(h.last('c2', 'room').seats[0]!.botControlled).toBe(true);
  });

  it('遊戲中主動離開，電腦立刻接手', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2', 'c3']);
    h.send('c1', { type: 'leave' });
    h.advance(2_000);
    expect(h.last('c2', 'state').view.prompt).not.toEqual({ kind: 'draw', player: 0 });
  });

  it('ping 會回 pong，並記錄延遲', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.send('c1', { type: 'ping', t: 123, rtt: 80 });
    expect(h.last('c1', 'pong')).toEqual({ type: 'pong', t: 123, serverNow: h.now });
    expect(h.core.d.seats[0]!.rtt).toBe(80);
  });
});

describe('房間：結束與再來一局', () => {
  it('結束後房主可以再開一局，已離開的真人不保留座位', () => {
    const h = new Harness();
    h.startWith(['c1', 'c2'], 1);
    h.core.onClose('c2');
    h.advance(6 * 60 * 60 * 1000);
    expect(h.core.phase).toBe('ended');
    h.send('c1', { type: 'rematch' });
    const room = h.last('c1', 'room');
    expect(room.phase).toBe('lobby');
    expect(room.seats.map((s) => s.name)).toEqual(['玩家1', '電腦 1']);
  });

  it('沒有人連線 2 小時後可以清除房間', () => {
    const h = new Harness();
    h.join('c1', 'A');
    h.core.onClose('c1');
    expect(h.core.shouldDestroy()).toBe(false);
    h.now += 2 * 60 * 60 * 1000;
    expect(h.core.shouldDestroy()).toBe(true);
  });
});
