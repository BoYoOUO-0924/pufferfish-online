/**
 * Cloudflare Worker 入口與房間 Durable Object。
 * 房間邏輯都在 room-core.ts；這裡只負責：讀寫儲存、轉送 WebSocket 訊息、設定 Alarm。
 */
import { cryptoRng } from '@pufferfish/engine';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode, type ServerMessage } from '@pufferfish/protocol';
import { getServerByName, routePartykitRequest, Server, type Connection } from 'partyserver';
import { DEFAULT_CONFIG, newRoomData, RoomCore, type RoomConfig, type RoomData } from './room-core';

interface Env {
  Room: DurableObjectNamespace<Room>;
  /** 電腦玩家思考時間倍率（測試用，例如 "0.05"） */
  BOT_DELAY_SCALE?: string;
}

const STORAGE_KEY = 'room';

export class Room extends Server<Env> {
  static override options = { hibernate: true };

  private data: RoomData | null = null;

  override async onStart(): Promise<void> {
    this.data = (await this.ctx.storage.get<RoomData>(STORAGE_KEY)) ?? null;
    if (this.data) {
      // 房間重新啟動後，清掉已經不存在的連線
      const live = new Set([...this.getConnections()].map((c) => c.id));
      const core = this.core()!;
      for (const connId of Object.keys(this.data.conns)) {
        if (!live.has(connId)) core.onClose(connId);
      }
      await this.persist();
    }
  }

  /** 由 Worker 呼叫（RPC）：建立新房間；房號已被使用時回傳 false */
  async create(): Promise<boolean> {
    if (this.data) return false;
    this.data = newRoomData(this.name, Date.now());
    await this.persist();
    return true;
  }

  override async onConnect(conn: Connection): Promise<void> {
    const core = this.core();
    if (!core) {
      const msg: ServerMessage = { type: 'error', code: 'roomNotFound', message: '找不到這個房間' };
      conn.send(JSON.stringify(msg));
      conn.close(4004, 'room not found');
      return;
    }
    core.onConnect(conn.id);
    await this.persist();
  }

  override async onMessage(conn: Connection, message: string | ArrayBuffer | ArrayBufferView): Promise<void> {
    const core = this.core();
    if (!core || typeof message !== 'string') return;
    core.onMessage(conn.id, message);
    await this.persist();
  }

  override async onClose(conn: Connection): Promise<void> {
    const core = this.core();
    if (!core) return;
    core.onClose(conn.id);
    await this.persist();
  }

  override async onAlarm(): Promise<void> {
    const core = this.core();
    if (!core) return;
    core.onAlarm();
    if (core.shouldDestroy()) {
      this.data = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.persist();
  }

  private config(): RoomConfig {
    const scale = Number(this.env.BOT_DELAY_SCALE);
    return { ...DEFAULT_CONFIG, botDelayScale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
  }

  private core(): RoomCore | null {
    if (!this.data) return null;
    return new RoomCore(
      this.data,
      {
        now: () => Date.now(),
        rng: cryptoRng,
        send: (connId, msg) => {
          try {
            this.getConnection(connId)?.send(JSON.stringify(msg));
          } catch {
            // 連線已關閉
          }
        },
      },
      this.config(),
    );
  }

  private async persist(): Promise<void> {
    if (!this.data) return;
    await this.ctx.storage.put(STORAGE_KEY, this.data);
    const at = this.core()!.nextAlarm();
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 10));
  }
}

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(cryptoRng.next() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        const stub = await getServerByName(env.Room as never, code);
        if (await (stub as unknown as DurableObjectStub<Room>).create()) return json({ code });
      }
      return json({ error: '無法建立房間，請再試一次' }, 503);
    }

    // WebSocket：/parties/room/<房號>
    const match = url.pathname.match(/^\/parties\/room\/([^/]+)/);
    if (match && !isValidRoomCode(decodeURIComponent(match[1]!))) {
      return json({ error: '房號格式錯誤' }, 404);
    }
    const routed = await routePartykitRequest(request, env as never);
    if (routed) return routed;

    if (url.pathname === '/api/health') return json({ ok: true });
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
