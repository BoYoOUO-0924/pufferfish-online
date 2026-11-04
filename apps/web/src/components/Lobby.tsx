import { MAX_PLAYERS, MIN_PLAYERS } from '@pufferfish/engine';
import { useState } from 'react';
import type { RoomHandle } from '../net';
import { RulesDialog } from './RulesDialog';

export function Lobby({ room, onLeave }: { room: RoomHandle; onLeave: () => void }) {
  const info = room.room!;
  const isHost = info.hostId === room.playerId;
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const link = `${location.origin}/r/${info.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('複製這個連結給朋友', link);
    }
  }

  const n = info.seats.length;
  return (
    <main className="lobby">
      <header className="lobby-head">
        <button className="btn ghost" onClick={onLeave}>
          ← 離開
        </button>
        <div className="room-code">
          <span>房號</span>
          <strong>{info.code}</strong>
        </div>
        <button className="btn" onClick={copy}>
          {copied ? '已複製！' : '複製邀請連結'}
        </button>
      </header>

      <section className="panel">
        <h2>
          玩家（{n}/{MAX_PLAYERS}）
        </h2>
        <ul className="seat-list">
          {info.seats.map((s) => (
            <li key={s.id} className={s.connected ? '' : 'offline'}>
              <span className="avatar">{s.isBot ? '🤖' : s.name.slice(0, 1)}</span>
              <span className="seat-name">
                {s.name}
                {s.id === room.playerId && <em>（你）</em>}
              </span>
              {s.id === info.hostId && <span className="tag">房主</span>}
              {!s.connected && <span className="tag muted">離線</span>}
              {isHost && s.isBot && (
                <button className="btn small ghost" onClick={() => room.send({ type: 'removeBot', seatId: s.id })}>
                  移除
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - n }, (_, i) => (
            <li key={`empty${i}`} className="empty">
              <span className="avatar">＋</span>
              <span className="seat-name">等待加入…</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <div className="lobby-actions">
            <button className="btn" disabled={n >= MAX_PLAYERS} onClick={() => room.send({ type: 'addBot' })}>
              ＋ 加入電腦玩家
            </button>
            <button className="btn primary big" disabled={n < MIN_PLAYERS} onClick={() => room.send({ type: 'start' })}>
              {n < MIN_PLAYERS ? `還差 ${MIN_PLAYERS - n} 人` : '開始遊戲'}
            </button>
          </div>
        ) : (
          <p className="hint">等待房主開始遊戲…</p>
        )}
      </section>
      <button className="btn ghost" onClick={() => setShowRules(true)}>
        📖 遊戲規則
      </button>
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
    </main>
  );
}
