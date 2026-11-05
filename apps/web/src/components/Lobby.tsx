import { MAX_PLAYERS, MIN_PLAYERS, type Variant } from '@pufferfish/engine';
import { useEffect, useRef, useState } from 'react';
import { VARIANT_INFO, preloadCards } from '../cards';
import type { RoomHandle } from '../net';
import { Bubbles } from '../pages/Home';
import { sfx, useMuted } from '../sfx';
import { Icon } from './Icon';
import { Avatar } from './Mascot';
import { RulesDialog } from './RulesDialog';

export function Lobby({ room, onLeave }: { room: RoomHandle; onLeave: () => void }) {
  const info = room.room!;
  const isHost = info.hostId === room.playerId;
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [muted, setMuted] = useMuted();
  useEffect(preloadCards, []);
  const link = `${location.origin}/r/${info.code}`;

  // 有人加入時播音效
  const count = useRef(info.seats.length);
  useEffect(() => {
    if (info.seats.length > count.current) sfx('join');
    count.current = info.seats.length;
  }, [info.seats.length]);

  async function copy() {
    sfx('tap');
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: '河豚愛生氣', text: `來玩河豚愛生氣！房號 ${info.code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 使用者取消分享或不支援剪貼簿
    }
  }

  const n = info.seats.length;
  return (
    <main className="lobby">
      <Bubbles count={10} />
      <header className="lobby-head">
        <button className="icon-btn" onClick={onLeave} aria-label="離開房間" title="離開">
          <Icon name="exit" />
        </button>
        <span className="lobby-title">等待室</span>
        <button className="icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? '開啟音效' : '關閉音效'}>
          <Icon name={muted ? 'volumeOff' : 'volume'} />
        </button>
      </header>

      <section className="room-code-card">
        <span className="label">房號</span>
        <div className="code-tiles" aria-label={`房號 ${info.code}`}>
          {[...info.code].map((ch, i) => (
            <span key={i} style={{ ['--i' as string]: i }} aria-hidden="true">
              {ch}
            </span>
          ))}
        </div>
        <button className={`btn${copied ? ' ok' : ''}`} onClick={copy}>
          <Icon name={copied ? 'check' : 'link'} size={18} />
          {copied ? '已複製連結！' : '邀請朋友'}
        </button>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <Icon name="users" size={20} /> 玩家 {n}/{MAX_PLAYERS}
        </h2>
        <ul className="seat-list">
          {info.seats.map((s, i) => (
            <li key={s.id} className={`seat-row${s.connected ? '' : ' offline'}`}>
              <Avatar name={s.name} isBot={s.isBot} seat={i} size={44} />
              <span className="seat-name">
                {s.name}
                {s.id === room.playerId && <em>（你）</em>}
              </span>
              {s.id === info.hostId && (
                <span className="tag host">
                  <Icon name="crown" size={14} /> 房主
                </span>
              )}
              {s.isBot && <span className="tag">電腦</span>}
              {!s.connected && <span className="tag muted">離線</span>}
              {isHost && s.isBot && (
                <button
                  className="icon-btn small"
                  onClick={() => room.send({ type: 'removeBot', seatId: s.id })}
                  aria-label={`移除 ${s.name}`}
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - n }, (_, i) => (
            <li key={`empty${i}`} className="seat-row empty">
              <span className="avatar ghost-avatar">
                <Icon name="plus" size={18} />
              </span>
              <span className="seat-name">等待加入…</span>
            </li>
          ))}
        </ul>

        {isHost ? (
          <div className="lobby-actions">
            <button className="btn" disabled={n >= MAX_PLAYERS} onClick={() => room.send({ type: 'addBot' })}>
              <Icon name="robot" size={18} /> 加入電腦
            </button>
            <button
              className="btn primary big"
              disabled={n < MIN_PLAYERS}
              onClick={() => room.send({ type: 'start' })}
            >
              <Icon name="play" size={18} />
              {n < MIN_PLAYERS ? `還差 ${MIN_PLAYERS - n} 人` : '開始遊戲'}
            </button>
          </div>
        ) : (
          <p className="hint waiting">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            等待房主開始遊戲
          </p>
        )}
      </section>
      <section className="panel variant-panel">
        <h2 className="panel-title">
          <Icon name="sparkle" size={20} /> 規則版本
        </h2>
        <div className="variant-switch" role="radiogroup" aria-label="規則版本">
          {(Object.keys(VARIANT_INFO) as Variant[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={info.variant === key}
              className={`variant-opt${info.variant === key ? ' on' : ''}`}
              disabled={!isHost}
              onClick={() => {
                sfx('tap');
                room.send({ type: 'setVariant', variant: key });
              }}
            >
              <strong>{VARIANT_INFO[key].name}</strong>
              <span>{VARIANT_INFO[key].short}</span>
            </button>
          ))}
        </div>
        {!isHost && <p className="hint">由房主決定規則版本</p>}
      </section>
      <button className="btn ghost" onClick={() => setShowRules(true)}>
        <Icon name="book" size={18} /> {info.variant === 'deep' ? '深海變體規則' : '遊戲規則'}
      </button>
      {showRules && <RulesDialog variant={info.variant} onClose={() => setShowRules(false)} />}
    </main>
  );
}
