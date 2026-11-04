/** 與房間伺服器的連線：自動重連、token 保存、時間校正、延遲量測 */
import type { GameEvent, PlayerView } from '@pufferfish/engine';
import type { ClientAction, ClientMessage, ServerMessage } from '@pufferfish/protocol';
import PartySocket from 'partysocket';
import { useCallback, useEffect, useRef, useState } from 'react';

export type RoomInfo = Extract<ServerMessage, { type: 'room' }>;

export interface LogEntry {
  id: number;
  event: GameEvent;
  /** 當下的玩家名稱（事件發生時） */
  names: string[];
  you: number;
}

export interface RoomClient {
  status: 'connecting' | 'open' | 'reconnecting' | 'notFound';
  playerId: string | null;
  room: RoomInfo | null;
  view: PlayerView | null;
  /** 本機時間的截止時刻 */
  deadline: number | null;
  log: LogEntry[];
  /** 最近一批事件（給動畫／提示用） */
  lastEvents: GameEvent[];
  error: { code: string; message: string; at: number } | null;
}

const INITIAL: RoomClient = {
  status: 'connecting',
  playerId: null,
  room: null,
  view: null,
  deadline: null,
  log: [],
  lastEvents: [],
  error: null,
};

const tokenKey = (code: string) => `pufferfish:token:${code}`;
let logSeq = 0;

/** token 存在 sessionStorage：同一分頁重新整理會回到原座位，不同分頁是不同玩家 */
function loadToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(code: string, token: string) {
  try {
    sessionStorage.setItem(tokenKey(code), token);
  } catch {
    // 無痕模式等情況，重新整理後就無法回到原座位
  }
}

export function clearToken(code: string) {
  try {
    sessionStorage.removeItem(tokenKey(code));
  } catch {
    // ignore
  }
}

export function useRoom(code: string, name: string | null) {
  const [state, setState] = useState<RoomClient>(INITIAL);
  const sockRef = useRef<PartySocket | null>(null);
  const rttRef = useRef(0);
  const viewRef = useRef<PlayerView | null>(null);

  useEffect(() => {
    if (!name) return;
    setState(INITIAL);
    const ws = new PartySocket({ host: location.host, party: 'room', room: code });
    sockRef.current = ws;
    const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
    let rttReported = false;

    const onOpen = () => {
      setState((s) => ({ ...s, status: 'open' }));
      send({ type: 'join', name, token: loadToken(code) });
      // 一連上就量延遲，讓 Watch Out 的延遲補償從第一回合就有效
      send({ type: 'ping', t: Date.now(), rtt: rttRef.current });
    };
    const onClose = () => setState((s) => (s.status === 'notFound' ? s : { ...s, status: 'reconnecting' }));
    const onMessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      switch (msg.type) {
        case 'joined':
          saveToken(code, msg.token);
          setState((s) => ({ ...s, playerId: msg.playerId }));
          break;
        case 'room':
          setState((s) => ({ ...s, room: msg }));
          break;
        case 'state': {
          const offset = msg.serverNow - Date.now();
          viewRef.current = msg.view;
          setState((s) => ({
            ...s,
            view: msg.view,
            deadline: msg.deadline === null ? null : msg.deadline - offset,
          }));
          break;
        }
        case 'events': {
          const v = viewRef.current;
          const names = v?.players.map((p) => p.name) ?? [];
          const you = v?.you ?? -1;
          const entries = msg.events.map((event) => ({ id: ++logSeq, event, names, you }));
          setState((s) => ({ ...s, lastEvents: msg.events, log: [...s.log, ...entries].slice(-80) }));
          break;
        }
        case 'error':
          if (msg.code === 'roomNotFound') {
            setState((s) => ({ ...s, status: 'notFound' }));
            ws.close();
          } else {
            setState((s) => ({ ...s, error: { code: msg.code, message: msg.message, at: Date.now() } }));
          }
          break;
        case 'pong': {
          rttRef.current = Date.now() - msg.t;
          // 第一次量到後立刻回報給伺服器
          if (!rttReported) {
            rttReported = true;
            send({ type: 'ping', t: Date.now(), rtt: rttRef.current });
          }
          break;
        }
      }
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
    ws.addEventListener('message', onMessage);
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) send({ type: 'ping', t: Date.now(), rtt: rttRef.current });
    }, 5000);
    return () => {
      clearInterval(ping);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('message', onMessage);
      ws.close();
      sockRef.current = null;
    };
  }, [code, name]);

  const send = useCallback((m: ClientMessage) => {
    sockRef.current?.send(JSON.stringify(m));
  }, []);
  const act = useCallback((action: ClientAction) => send({ type: 'action', action }), [send]);
  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, send, act, dismissError };
}

export type RoomHandle = ReturnType<typeof useRoom>;

/** 剩餘秒數，每 200ms 更新 */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, (deadline - now) / 1000);
}
