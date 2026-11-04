/**
 * M0 骨架：確認 Worker + Durable Object + 規則引擎可以一起運作。
 * 完整的房間邏輯（邀請碼、視角、計時器）在 M2 實作。
 */
import { routePartykitRequest, Server, type Connection } from 'partyserver';
import { TOTAL_CARDS } from '@pufferfish/engine';

interface Env {
  Room: DurableObjectNamespace<Room>;
}

export class Room extends Server<Env> {
  override onConnect(conn: Connection): void {
    conn.send(JSON.stringify({ type: 'hello', room: this.name, totalCards: TOTAL_CARDS }));
  }

  override onMessage(conn: Connection, message: string | ArrayBuffer): void {
    if (message === 'ping') conn.send(JSON.stringify({ type: 'pong' }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env as unknown as Record<string, unknown>)) ??
      new Response('河豚愛生氣 server', { status: 200 })
    );
  },
} satisfies ExportedHandler<Env>;
