import type { PlayerView, PlayKind } from '@pufferfish/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAY_NAMES, cardName, describeEvent, describeSelection, sortHand } from '../cards';
import { useCountdown, type RoomHandle } from '../net';
import { CardView } from './CardView';
import { ChefDialog, FisherDialog, GameOverDialog, PlacePufferDialog, SlapOverlay } from './Dialogs';

const PLAY_KIND_NAMES: Record<PlayKind, string> = {
  steal: 'Steal!',
  salmon: 'Salmon',
  switch: 'Switch!!',
  chef: 'Chef',
  wave: 'Wave!',
  reverse: 'Reverse',
  watchout: 'Watch Out!',
  net: PLAY_NAMES.net!,
  fisher: PLAY_NAMES.fisher!,
  torpedo: PLAY_NAMES.torpedo!,
};

export function Table({ room, onLeave }: { room: RoomHandle; onLeave: () => void }) {
  const v = room.view!;
  const me = v.you;
  const info = room.room!;
  const prompt = v.prompt;
  const remaining = useCountdown(room.deadline);
  const [selected, setSelected] = useState<string[]>([]);
  const [targeting, setTargeting] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const alive = v.players[me]?.alive ?? false;
  const myDraw = prompt?.kind === 'draw' && prompt.player === me;
  const myPlay = prompt?.kind === 'play' && prompt.player === me;
  const hand = useMemo(() => sortHand(v.hand), [v.hand]);

  // 手牌變動時移除已不在手上的選取；不是出牌階段時取消指定對象
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => v.hand.some((c) => c.id === id)));
  }, [v.hand]);
  useEffect(() => {
    if (!myPlay) setTargeting(false);
  }, [myPlay]);

  const selCards = selected.map((id) => v.hand.find((c) => c.id === id)).filter((c) => c !== undefined);
  const selInfo = describeSelection(selCards, v.discard.length);

  const toggle = (id: string) => {
    if (!myPlay) return;
    setTargeting(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const playSelected = (target?: number) => {
    room.act({ type: 'play', cards: selected, target });
    setSelected([]);
    setTargeting(false);
  };

  // 從自己的下一位開始，依座位順序排對手
  const others = v.players.map((_, i) => (me + 1 + i) % v.players.length).filter((i) => i !== me);
  const seatOf = (i: number) => info.seats.find((s) => s.id === v.players[i]!.id);
  const nameOf = (i: number) => (i === me ? '你' : v.players[i]!.name);
  const top = v.discard[v.discard.length - 1];

  const canTarget = (i: number) =>
    targeting &&
    v.players[i]!.alive &&
    !(selCards[0]?.kind === 'steal' && v.players[i]!.handCount === 0);

  return (
    <main className="table">
      <header className="table-head">
        <button className="btn ghost small" onClick={onLeave}>
          ← 離開
        </button>
        <span className="head-info">
          房號 <strong>{info.code}</strong> · 第 {v.turnCount} 回合 · {v.direction === 1 ? '↻ 順時針' : '↺ 逆時針'}
        </span>
        <button className="btn ghost small" onClick={() => setShowLog((x) => !x)}>
          {showLog ? '關閉紀錄' : '出牌紀錄'}
        </button>
      </header>

      <section className="opponents">
        {others.map((i) => {
          const p = v.players[i]!;
          const seat = seatOf(i);
          const isTurn = v.turn === i && v.phase === 'playing';
          const clickable = canTarget(i);
          return (
            <button
              key={p.id}
              type="button"
              className={`opponent${isTurn ? ' turn' : ''}${p.alive ? '' : ' dead'}${clickable ? ' targetable' : ''}`}
              disabled={!clickable}
              onClick={() => clickable && playSelected(i)}
            >
              <span className="avatar">{p.isBot ? '🤖' : p.name.slice(0, 1)}</span>
              <span className="opp-name">{p.name}</span>
              <span className="opp-meta">
                {p.alive ? `手牌 ${p.handCount}` : '已淘汰'}
                {seat?.botControlled && ' · 代打中'}
                {seat && !seat.connected && !seat.isBot && ' · 離線'}
              </span>
              {isTurn && <span className="turn-dot" aria-label="輪到他" />}
            </button>
          );
        })}
      </section>

      <section className="center">
        <div className="piles">
          <div className="pile">
            <CardView
              kind="back"
              size="lg"
              onClick={myDraw ? () => room.act({ type: 'draw' }) : undefined}
              selected={myDraw}
            />
            <span className="pile-label">牌堆 {v.deckCount}</span>
          </div>
          <div className="pile">
            {top ? <CardView kind={top.kind} size="lg" /> : <div className="card card-lg empty-slot" />}
            <span className="pile-label">棄牌 {v.discard.length}</span>
          </div>
        </div>
        <StatusBar view={v} nameOf={nameOf} remaining={remaining} />
        {v.chain && <ChainInfo view={v} nameOf={nameOf} />}
        {prompt?.kind === 'response' && alive && (
          <ResponseBar room={room} view={v} />
        )}
      </section>

      <section className={`my-area${v.turn === me && v.phase === 'playing' ? ' my-turn' : ''}`}>
        <div className="my-head">
          <span>
            {v.players[me]!.name}（你）{alive ? `· ${v.hand.length} 張` : '· 已淘汰，觀戰中'}
          </span>
          {myPlay && (
            <div className="play-controls">
              {targeting ? (
                <>
                  <span className="hint">點選上方玩家作為對象</span>
                  <button className="btn small ghost" onClick={() => setTargeting(false)}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className={`hint${selInfo.valid ? '' : ' muted'}`}>{selInfo.label}</span>
                  <button
                    className="btn primary"
                    disabled={!selInfo.valid}
                    onClick={() => (selInfo.needsTarget ? setTargeting(true) : playSelected())}
                  >
                    {selInfo.needsTarget ? '選擇對象' : '出牌'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className={`hand${hand.length > 8 ? ' crowded' : ''}`}>
          {hand.map((c) => (
            <CardView
              key={c.id}
              kind={c.kind}
              selected={selected.includes(c.id)}
              onClick={myPlay ? () => toggle(c.id) : undefined}
            />
          ))}
          {hand.length === 0 && <p className="hint">沒有手牌</p>}
        </div>
      </section>

      {showLog && <EventLog room={room} onClose={() => setShowLog(false)} />}

      {prompt?.kind === 'placePuffer' && prompt.player === me && (
        <PlacePufferDialog deckCount={prompt.deckCount} onPlace={(position) => room.act({ type: 'placePuffer', position })} />
      )}
      {prompt?.kind === 'fisher' && prompt.player === me && prompt.cards && (
        <FisherDialog
          cards={prompt.cards}
          onDone={(keep, returnOrder) => room.act({ type: 'fisherChoose', keep, returnOrder })}
        />
      )}
      {prompt?.kind === 'chef' && prompt.player === me && prompt.cards && (
        <ChefDialog
          cards={prompt.cards}
          recipients={chefRecipients(v).map(nameOf)}
          onDone={(keep, order) => room.act({ type: 'chefArrange', keep, order })}
        />
      )}
      {prompt?.kind === 'slap' && (
        <SlapOverlay
          isActor={prompt.actor === me}
          mustSlap={prompt.players.includes(me) && !prompt.slappedByYou}
          slapped={prompt.slappedByYou}
          actorName={nameOf(prompt.actor)}
          onSlap={() => room.act({ type: 'slap' })}
        />
      )}
      {v.phase === 'ended' && (
        <GameOverDialog
          winner={v.winner === null ? '?' : nameOf(v.winner)}
          youWon={v.winner === me}
          reason={v.winReason}
          isHost={info.hostId === room.playerId}
          onRematch={() => room.send({ type: 'rematch' })}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}

/** Chef 分牌對象：自己的下一位起，依方向的存活玩家 */
function chefRecipients(v: PlayerView): number[] {
  const n = v.players.length;
  const out: number[] = [];
  let cur = v.you;
  for (let i = 0; i < n; i++) {
    cur = (((cur + v.direction) % n) + n) % n;
    if (cur === v.you) break;
    if (v.players[cur]!.alive) out.push(cur);
  }
  return out;
}

function StatusBar({
  view: v,
  nameOf,
  remaining,
}: {
  view: PlayerView;
  nameOf: (i: number) => string;
  remaining: number | null;
}) {
  const p = v.prompt;
  const me = v.you;
  let text = '';
  if (v.phase === 'ended') text = '遊戲結束';
  else if (p) {
    switch (p.kind) {
      case 'draw':
        text = p.player === me ? '你的回合：點牌堆抽一張牌' : `${nameOf(p.player)} 抽牌中`;
        break;
      case 'play':
        text = p.player === me ? '你的回合：選擇要打出的牌' : `${nameOf(p.player)} 正在出牌`;
        break;
      case 'placePuffer':
        text = p.player === me ? '選擇河豚要放回的位置' : `${nameOf(p.player)} 正在把河豚放回牌堆`;
        break;
      case 'response':
        text = '回應時間';
        break;
      case 'fisher':
        text = p.player === me ? '漁販：挑選要留下的牌' : `${nameOf(p.player)} 正在挑牌（漁販）`;
        break;
      case 'chef':
        text = p.player === me ? 'Chef：挑一張，分配其餘的牌' : `${nameOf(p.player)} 正在分配牌（Chef）`;
        break;
      case 'slap':
        text = 'Watch Out！快拍！';
        break;
    }
  }
  const total = v.timer ? v.timer.ms / 1000 : null;
  const pct = remaining !== null && total ? Math.min(100, (remaining / total) * 100) : 0;
  return (
    <div className="status">
      <span className="status-text">{text}</span>
      {remaining !== null && v.phase === 'playing' && (
        <>
          <span className={`status-time${remaining <= 5 ? ' urgent' : ''}`}>{Math.ceil(remaining)}s</span>
          <div className="timer-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

function ChainInfo({ view: v, nameOf }: { view: PlayerView; nameOf: (i: number) => string }) {
  const ch = v.chain!;
  return (
    <div className="chain">
      {ch.items.map((it, i) => (
        <span key={i} className={`chain-item${it.cancelled ? ' cancelled' : ''}`}>
          {it.kind === 'base' && (
            <>
              {nameOf(it.player)} 打出 <strong>{PLAY_KIND_NAMES[ch.play]}</strong>
              {ch.items.length === 1 && ch.target !== undefined && ` → ${nameOf(ch.target)}`}
            </>
          )}
          {it.kind === 'noway' && (
            <>
              {nameOf(it.player)}：<strong>No way!</strong>
            </>
          )}
          {it.kind === 'pass' && (
            <>
              {nameOf(it.player)}：<strong>Pass</strong> → {nameOf(it.to!)}
            </>
          )}
        </span>
      ))}
      <span className="chain-result">
        {ch.baseCancelled ? '目前：會被取消' : `目前：會生效${ch.target !== undefined ? `（對象 ${nameOf(ch.target)}）` : ''}`}
      </span>
    </div>
  );
}

function ResponseBar({ room, view: v }: { room: RoomHandle; view: PlayerView }) {
  const p = v.prompt;
  if (p?.kind !== 'response') return null;
  const noway = v.hand.find((c) => c.kind === 'noway');
  const pass = v.hand.find((c) => c.kind === 'pass');
  return (
    <div className="response-bar">
      {noway && (
        <button
          className="btn danger"
          disabled={!p.canNoway}
          onClick={() => room.act({ type: 'respond', card: noway.id })}
        >
          {cardName('noway')}！
        </button>
      )}
      {pass && p.canPassTo !== null && (
        <button className="btn warn" onClick={() => room.act({ type: 'respond', card: pass.id })}>
          Pass → {v.players[p.canPassTo]!.name}
        </button>
      )}
      <button className="btn ghost" disabled={p.declinedByYou} onClick={() => room.act({ type: 'decline' })}>
        {p.declinedByYou ? '已表示不回應' : '不回應'}
      </button>
    </div>
  );
}

function EventLog({ room, onClose }: { room: RoomHandle; onClose: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [room.log.length]);
  return (
    <aside className="log">
      <header>
        <strong>出牌紀錄</strong>
        <button className="btn ghost small" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="log-body">
        {room.log.map((entry) => {
          // 玩家名稱整局不變，用目前視角的名單（開局第一批事件可能比視角早到）
          const v = room.view;
          const names = v ? v.players.map((p) => p.name) : entry.names;
          const text = describeEvent(entry.event, names, v?.you ?? entry.you);
          return text ? (
            <p key={entry.id} className={entry.event.type === 'turnStart' ? 'log-turn' : ''}>
              {text}
            </p>
          ) : null;
        })}
        <div ref={end} />
      </div>
    </aside>
  );
}
