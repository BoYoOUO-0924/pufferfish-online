/**
 * 房間邏輯（不依賴 Cloudflare）：座位、房主、電腦玩家、開局、計時、斷線代打。
 * 時間與傳送由外部注入，方便用假時鐘測試；Durable Object 只負責轉接（index.ts）。
 */
import {
  applyAction,
  awaitingPlayers,
  botAction,
  botSlapDelay,
  createGame,
  EngineError,
  eventsFor,
  MAX_PLAYERS,
  MIN_PLAYERS,
  randInt,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type Rng,
} from '@pufferfish/engine';
import {
  MAX_NAME_LENGTH,
  type ClientMessage,
  type RoomPhase,
  type SeatInfo,
  type ServerMessage,
} from '@pufferfish/protocol';

export interface Seat {
  id: string;
  /** 重新連線用的秘密，只發給本人 */
  token: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  rtt: number;
}

export interface RoomData {
  code: string;
  createdAt: number;
  hostId: string | null;
  seats: Seat[];
  /** 連線 id → 座位 id（尚未加入為 null） */
  conns: Record<string, string | null>;
  game: GameState | null;
  /** 遊戲中的玩家順序（引擎 index → 座位 id） */
  gameSeatIds: string[];
  deadline: number | null;
  deadlineTimerId: number | null;
  slapStartedAt: number | null;
  /** `${timerId}:${玩家 index}` → 電腦預定動作時間 */
  botDue: Record<string, number>;
  botCount: number;
  lastActivity: number;
  /** 已通知大家「代打中」的座位，用來偵測變化 */
  botControlledIds?: string[];
}

export interface RoomIO {
  now(): number;
  rng: Rng;
  send(connId: string, msg: ServerMessage): void;
}

export interface RoomConfig {
  /** 電腦玩家思考時間倍率（測試時調小） */
  botDelayScale: number;
  /** 斷線多久後由電腦代打 */
  disconnectGraceMs: number;
  /** 沒有任何連線多久後清除房間 */
  idleCleanupMs: number;
}

export const DEFAULT_CONFIG: RoomConfig = {
  botDelayScale: 1,
  disconnectGraceMs: 5_000,
  idleCleanupMs: 2 * 60 * 60 * 1000,
};

/** 電腦玩家在各種提示下的思考時間範圍（毫秒） */
const BOT_DELAY: Record<string, [number, number]> = {
  draw: [600, 1100],
  play: [900, 1800],
  placePuffer: [1000, 1800],
  fisher: [1200, 2000],
  chef: [1200, 2000],
  response: [700, 1500],
};

const MAX_MESSAGE_BYTES = 4096;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function newRoomData(code: string, now: number): RoomData {
  return {
    code,
    createdAt: now,
    hostId: null,
    seats: [],
    conns: {},
    game: null,
    gameSeatIds: [],
    deadline: null,
    deadlineTimerId: null,
    slapStartedAt: null,
    botDue: {},
    botCount: 0,
    lastActivity: now,
  };
}

class RoomError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RoomCore {
  constructor(
    public d: RoomData,
    private io: RoomIO,
    private cfg: RoomConfig = DEFAULT_CONFIG,
  ) {}

  get phase(): RoomPhase {
    if (!this.d.game) return 'lobby';
    return this.d.game.phase === 'ended' ? 'ended' : 'playing';
  }

  // ───────────────────────── 連線事件 ─────────────────────────

  onConnect(connId: string): void {
    this.d.conns[connId] = null;
    this.d.lastActivity = this.io.now();
  }

  onClose(connId: string): void {
    const seatId = this.d.conns[connId];
    delete this.d.conns[connId];
    this.d.lastActivity = this.io.now();
    if (!seatId) return;
    const stillConnected = Object.values(this.d.conns).includes(seatId);
    const seat = this.seat(seatId);
    if (seat && !stillConnected) {
      seat.connected = false;
      seat.disconnectedAt = this.io.now();
      this.broadcastRoom();
    }
    this.pump();
  }

  onMessage(connId: string, raw: string): void {
    this.d.lastActivity = this.io.now();
    let msg: ClientMessage;
    try {
      if (raw.length > MAX_MESSAGE_BYTES) throw new Error('too large');
      msg = JSON.parse(raw) as ClientMessage;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new Error('bad');
    } catch {
      return this.sendError(connId, 'badMessage', '訊息格式錯誤');
    }
    try {
      this.handle(connId, msg);
    } catch (e) {
      if (e instanceof RoomError || e instanceof EngineError) {
        return this.sendError(connId, e.code, e.message);
      }
      throw e;
    }
    this.pump();
  }

  onAlarm(): void {
    this.pump();
  }

  /** 下一次需要叫醒房間的時間（給 Durable Object Alarm） */
  nextAlarm(): number | null {
    const now = this.io.now();
    const times: number[] = [];
    if (this.phase === 'playing') {
      if (this.d.deadline !== null) times.push(this.d.deadline);
      times.push(...Object.values(this.d.botDue));
      for (const id of this.d.gameSeatIds) {
        const seat = this.seat(id);
        if (seat && !seat.isBot && !seat.connected && seat.disconnectedAt !== null) {
          const at = seat.disconnectedAt + this.cfg.disconnectGraceMs;
          if (at > now) times.push(at);
        }
      }
    }
    if (Object.keys(this.d.conns).length === 0) times.push(this.d.lastActivity + this.cfg.idleCleanupMs);
    return times.length ? Math.min(...times) : null;
  }

  /** 沒人連線太久，可以清除房間 */
  shouldDestroy(): boolean {
    return (
      Object.keys(this.d.conns).length === 0 &&
      this.io.now() >= this.d.lastActivity + this.cfg.idleCleanupMs
    );
  }

  // ───────────────────────── 訊息處理 ─────────────────────────

  private handle(connId: string, msg: ClientMessage): void {
    if (msg.type === 'ping') {
      const seatId = this.d.conns[connId];
      const seat = seatId ? this.seat(seatId) : undefined;
      if (seat && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) {
        seat.rtt = Math.max(0, Math.min(2000, msg.rtt));
      }
      this.io.send(connId, { type: 'pong', t: msg.t, serverNow: this.io.now() });
      return;
    }
    if (msg.type === 'join') return this.join(connId, msg.name, msg.token);

    const seatId = this.d.conns[connId];
    const seat = seatId ? this.seat(seatId) : undefined;
    if (!seat) throw new RoomError('notJoined', '請先加入房間');

    switch (msg.type) {
      case 'addBot': {
        this.requireHost(seat);
        this.requireLobby();
        if (this.d.seats.length >= MAX_PLAYERS) throw new RoomError('roomFull', `最多 ${MAX_PLAYERS} 人`);
        this.d.botCount += 1;
        this.d.seats.push({
          id: this.newId(8),
          token: '',
          name: `電腦 ${this.d.botCount}`,
          isBot: true,
          connected: true,
          disconnectedAt: null,
          rtt: 0,
        });
        return this.broadcastRoom();
      }
      case 'removeBot': {
        this.requireHost(seat);
        this.requireLobby();
        const idx = this.d.seats.findIndex((s) => s.id === msg.seatId && s.isBot);
        if (idx < 0) throw new RoomError('notFound', '找不到這個電腦玩家');
        this.d.seats.splice(idx, 1);
        return this.broadcastRoom();
      }
      case 'start':
        return this.start(seat);
      case 'action':
        return this.gameAction(seat, msg.action);
      case 'rematch': {
        this.requireHost(seat);
        if (this.phase !== 'ended') throw new RoomError('wrongPhase', '遊戲還沒結束');
        this.d.game = null;
        this.d.gameSeatIds = [];
        this.d.deadline = null;
        this.d.deadlineTimerId = null;
        this.d.slapStartedAt = null;
        this.d.botDue = {};
        // 已離開的真人玩家不保留座位
        this.d.seats = this.d.seats.filter((s) => s.isBot || s.connected);
        this.fixHost();
        return this.broadcastRoom();
      }
      case 'leave': {
        this.d.conns[connId] = null;
        const others = Object.values(this.d.conns).includes(seat.id);
        if (this.phase === 'lobby') {
          if (!others) {
            this.d.seats = this.d.seats.filter((s) => s.id !== seat.id);
            this.fixHost();
          }
        } else if (!others) {
          seat.connected = false;
          seat.disconnectedAt = this.io.now() - this.cfg.disconnectGraceMs; // 立刻由電腦接手
        }
        return this.broadcastRoom();
      }
      default:
        throw new RoomError('badMessage', '未知的訊息');
    }
  }

  private join(connId: string, rawName: unknown, token: unknown): void {
    if (this.d.conns[connId]) {
      // 已經加入過，重送目前狀態
      return this.sendSnapshot(connId);
    }
    const now = this.io.now();
    if (typeof token === 'string' && token) {
      const seat = this.d.seats.find((s) => !s.isBot && s.token === token);
      if (seat) {
        this.d.conns[connId] = seat.id;
        seat.connected = true;
        seat.disconnectedAt = null;
        this.io.send(connId, { type: 'joined', playerId: seat.id, token: seat.token, code: this.d.code });
        this.broadcastRoom();
        if (this.d.game) this.sendState(connId);
        return;
      }
    }
    const name = sanitizeName(rawName);
    if (!name) throw new RoomError('badName', `暱稱需為 1～${MAX_NAME_LENGTH} 個字`);
    if (this.phase !== 'lobby') throw new RoomError('gameInProgress', '遊戲已經開始了');
    if (this.d.seats.length >= MAX_PLAYERS) throw new RoomError('roomFull', `房間已滿（${MAX_PLAYERS} 人）`);
    const seat: Seat = {
      id: this.newId(8),
      token: this.newId(32),
      name,
      isBot: false,
      connected: true,
      disconnectedAt: null,
      rtt: 0,
    };
    this.d.seats.push(seat);
    this.d.conns[connId] = seat.id;
    this.d.lastActivity = now;
    this.fixHost();
    this.io.send(connId, { type: 'joined', playerId: seat.id, token: seat.token, code: this.d.code });
    this.broadcastRoom();
  }

  private start(seat: Seat): void {
    this.requireHost(seat);
    this.requireLobby();
    const n = this.d.seats.length;
    if (n < MIN_PLAYERS) throw new RoomError('notEnoughPlayers', `至少需要 ${MIN_PLAYERS} 人（可以加入電腦玩家）`);
    const first = Math.max(0, this.d.seats.findIndex((s) => s.id === this.d.hostId));
    const { state, events } = createGame(
      this.d.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })),
      this.io.rng,
      { firstPlayer: first },
    );
    this.d.game = state;
    this.d.gameSeatIds = this.d.seats.map((s) => s.id);
    this.d.botDue = {};
    this.d.deadlineTimerId = null;
    this.broadcastRoom();
    this.afterGameChange(events);
  }

  private gameAction(seat: Seat, action: unknown): void {
    if (this.phase !== 'playing' || !this.d.game) throw new RoomError('wrongPhase', '遊戲沒有在進行');
    const player = this.d.gameSeatIds.indexOf(seat.id);
    if (player < 0) throw new RoomError('notPlaying', '你不在這局遊戲中');
    if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') {
      throw new RoomError('badMessage', '動作格式錯誤');
    }
    const a = { ...(action as Record<string, unknown>), player } as unknown as Action;
    if (a.type === 'timeout') throw new RoomError('badMessage', '動作格式錯誤');
    if (a.type === 'slap') {
      // 以伺服器收到的時間為準，扣掉單程延遲（上限 250ms）
      const started = this.d.slapStartedAt ?? this.io.now();
      a.t = this.io.now() - started - Math.min(seat.rtt / 2, 250);
    }
    this.apply(a);
  }

  // ───────────────────────── 遊戲推進 ─────────────────────────

  private apply(action: Action): void {
    const r = applyAction(this.d.game!, action, this.io.rng);
    this.d.game = r.state;
    this.afterGameChange(r.events);
  }

  private afterGameChange(events: GameEvent[]): void {
    const g = this.d.game!;
    const now = this.io.now();
    if (!g.timer) {
      this.d.deadline = null;
      this.d.deadlineTimerId = null;
    } else if (g.timer.id !== this.d.deadlineTimerId) {
      this.d.deadline = now + g.timer.ms;
      this.d.deadlineTimerId = g.timer.id;
      if (g.prompt?.kind === 'slap') this.d.slapStartedAt = now;
    }
    for (const [connId, seatId] of Object.entries(this.d.conns)) {
      const idx = seatId ? this.d.gameSeatIds.indexOf(seatId) : -1;
      if (idx < 0) continue;
      const mine = eventsFor(events, idx);
      if (mine.length) this.io.send(connId, { type: 'events', events: mine });
      this.sendState(connId);
    }
    if (g.phase === 'ended') this.broadcastRoom();
  }

  /** 處理到期的計時器與電腦玩家動作 */
  private pump(): void {
    for (let guard = 0; guard < 500; guard++) {
      const g = this.d.game;
      if (!g || g.phase !== 'playing') {
        this.d.botDue = {};
        return;
      }
      const now = this.io.now();
      this.syncBotControl();
      this.scheduleBots(now);
      if (this.d.deadline !== null && this.d.deadline <= now && g.timer) {
        this.apply({ type: 'timeout', timerId: g.timer.id });
        continue;
      }
      const due = Object.entries(this.d.botDue)
        .filter(([, at]) => at <= now)
        .sort((a, b) => a[1] - b[1])[0];
      if (!due) return;
      const [key, at] = due;
      delete this.d.botDue[key];
      const player = Number(key.split(':')[1]);
      const action = botAction(g, player, this.io.rng);
      if (!action) continue;
      if (action.type === 'slap') action.t = at - (this.d.slapStartedAt ?? at);
      try {
        this.apply(action);
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        // 電腦判斷失誤時不處理，等計時器到期自動進行
      }
    }
  }

  private scheduleBots(now: number): void {
    const g = this.d.game!;
    const tid = g.timer?.id;
    for (const key of Object.keys(this.d.botDue)) {
      if (Number(key.split(':')[0]) !== tid) delete this.d.botDue[key];
    }
    if (tid === undefined || !g.prompt) return;
    for (const player of awaitingPlayers(g)) {
      const key = `${tid}:${player}`;
      if (key in this.d.botDue || !this.isBotControlled(player, now)) continue;
      if (g.prompt.kind === 'slap') {
        const start = this.d.slapStartedAt ?? now;
        this.d.botDue[key] = Math.max(now, start + botSlapDelay(this.io.rng));
      } else {
        const [lo, hi] = BOT_DELAY[g.prompt.kind] ?? [800, 1500];
        const delay = (lo + randInt(this.io.rng, hi - lo + 1)) * this.cfg.botDelayScale;
        this.d.botDue[key] = now + Math.round(delay);
      }
    }
  }

  /** 斷線代打狀態有變化時通知所有人 */
  private syncBotControl(): void {
    const ids = this.seatInfos()
      .filter((s) => s.botControlled)
      .map((s) => s.id)
      .join(',');
    if (ids !== (this.d.botControlledIds ?? []).join(',')) {
      this.d.botControlledIds = ids ? ids.split(',') : [];
      this.broadcastRoom();
    }
  }

  private isBotControlled(player: number, now: number): boolean {
    const seat = this.seat(this.d.gameSeatIds[player]!);
    if (!seat) return true;
    if (seat.isBot) return true;
    return !seat.connected && seat.disconnectedAt !== null && now - seat.disconnectedAt >= this.cfg.disconnectGraceMs;
  }

  // ───────────────────────── 傳送 ─────────────────────────

  private seatInfos(): SeatInfo[] {
    const now = this.io.now();
    return this.d.seats.map((s) => {
      const idx = this.d.gameSeatIds.indexOf(s.id);
      return {
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        connected: s.isBot || s.connected,
        botControlled: !s.isBot && idx >= 0 && this.phase === 'playing' && this.isBotControlled(idx, now),
      };
    });
  }

  private broadcastRoom(): void {
    const seats = this.seatInfos();
    for (const [connId, seatId] of Object.entries(this.d.conns)) {
      this.io.send(connId, {
        type: 'room',
        code: this.d.code,
        phase: this.phase,
        hostId: this.d.hostId,
        seats,
        you: seatId,
      });
    }
  }

  private sendState(connId: string): void {
    const seatId = this.d.conns[connId];
    const idx = seatId ? this.d.gameSeatIds.indexOf(seatId) : -1;
    if (!this.d.game || idx < 0) return;
    this.io.send(connId, {
      type: 'state',
      view: viewFor(this.d.game, idx),
      deadline: this.d.deadline,
      serverNow: this.io.now(),
    });
  }

  private sendSnapshot(connId: string): void {
    const seatId = this.d.conns[connId];
    this.io.send(connId, {
      type: 'room',
      code: this.d.code,
      phase: this.phase,
      hostId: this.d.hostId,
      seats: this.seatInfos(),
      you: seatId ?? null,
    });
    this.sendState(connId);
  }

  private sendError(connId: string, code: string, message: string): void {
    this.io.send(connId, { type: 'error', code, message });
  }

  // ───────────────────────── 工具 ─────────────────────────

  private seat(id: string): Seat | undefined {
    return this.d.seats.find((s) => s.id === id);
  }

  private requireHost(seat: Seat): void {
    if (seat.id !== this.d.hostId) throw new RoomError('notHost', '只有房主可以這樣做');
  }

  private requireLobby(): void {
    if (this.phase !== 'lobby') throw new RoomError('wrongPhase', '遊戲已經開始了');
  }

  /** 房主離開時，由下一位真人接手 */
  private fixHost(): void {
    if (this.d.hostId && this.d.seats.some((s) => s.id === this.d.hostId)) return;
    this.d.hostId = this.d.seats.find((s) => !s.isBot)?.id ?? null;
  }

  private newId(len: number): string {
    let out = '';
    for (let i = 0; i < len; i++) out += TOKEN_ALPHABET[randInt(this.io.rng, TOKEN_ALPHABET.length)];
    return out;
  }
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const chars = [...name];
  if (chars.length < 1 || chars.length > MAX_NAME_LENGTH) return null;
  return name;
}
