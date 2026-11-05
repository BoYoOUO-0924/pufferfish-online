import type { CardKind, PlayerView, PlayKind } from '@pufferfish/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAY_NAMES, cardName, describeEvent, describeSelection, sortHand } from '../cards';
import { useCountdown, type RoomHandle } from '../net';
import { sfx, useMuted } from '../sfx';
import { CardView } from './CardView';
import {
  ChefDialog,
  FisherDialog,
  GameOverDialog,
  PlacePufferDialog,
  SlapOverlay,
  SonarDialog,
} from './Dialogs';
import { FxLayer } from './FxLayer';
import { Icon } from './Icon';
import { Avatar } from './Mascot';
import { RulesDialog } from './RulesDialog';
import { Deck, DirectionRing, Discard, Hand, Seat, TimerRing } from './TableParts';

const PLAY_KIND_CARD: Partial<Record<PlayKind, CardKind>> = {
  steal: 'steal',
  salmon: 'salmon',
  switch: 'switch',
  chef: 'chef',
  wave: 'wave',
  reverse: 'reverse',
  watchout: 'watchout',
};

const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

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
  sonar: PLAY_NAMES.sonar!,
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
  const [showRules, setShowRules] = useState(false);
  const [muted, setMuted] = useMuted();

  const alive = v.players[me]?.alive ?? false;
  const myDraw = prompt?.kind === 'draw' && prompt.player === me;
  const myPlay = prompt?.kind === 'play' && prompt.player === me;
  const hand = useMemo(() => sortHand(v.hand), [v.hand]);
  const mustSlap = prompt?.kind === 'slap' && prompt.players.includes(me) && !prompt.slappedByYou;
  const targeted =
    prompt?.kind === 'response' &&
    !!v.chain &&
    !v.chain.baseCancelled &&
    v.chain.target === me &&
    ['steal', 'salmon', 'switch'].includes(v.chain.play);
  const myChoice =
    (prompt?.kind === 'placePuffer' ||
      prompt?.kind === 'fisher' ||
      prompt?.kind === 'chef' ||
      prompt?.kind === 'sonar') &&
    prompt.player === me;
  const needsMe = myDraw || myPlay || myChoice || targeted || mustSlap;

  // 輪到你／被指定／要拍牌時：手機震動，分頁在背景時改標題提醒
  useEffect(() => {
    if (!needsMe) return;
    try {
      // 瀏覽器規定使用者點過頁面後才能震動
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(mustSlap || targeted ? [80, 40, 80] : 60);
    } catch {
      // 不支援震動
    }
    if (targeted) sfx('alarm');
    const original = '河豚愛生氣 線上版';
    const label = mustSlap ? '快拍！' : targeted ? '你被指定了！' : '輪到你了！';
    const update = () => (document.title = document.hidden ? `【${label}】${original}` : original);
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      document.title = original;
    };
  }, [needsMe, mustSlap, targeted]);

  // 自己的回合最後 5 秒滴答聲
  const secLeft = remaining === null ? null : Math.ceil(remaining);
  useEffect(() => {
    if ((myDraw || myPlay || myChoice) && secLeft !== null && secLeft <= 5 && secLeft > 0) sfx('urgent');
  }, [secLeft, myDraw, myPlay, myChoice]);

  // 手牌變動時移除已不在手上的選取；不是出牌階段時取消指定對象
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => v.hand.some((c) => c.id === id)));
  }, [v.hand]);
  useEffect(() => {
    if (!myPlay) setTargeting(false);
  }, [myPlay]);

  const selCards = selected.map((id) => v.hand.find((c) => c.id === id)).filter((c) => c !== undefined);
  const selInfo = describeSelection(selCards, v.discard.length, v.variant);

  const toggle = (id: string) => {
    if (!myPlay) return;
    sfx('tap');
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
  const playing = v.phase === 'playing';

  // 快捷鍵：空白鍵抽牌／拍牌、Enter 出牌、E 結束出牌、N No way、P Pass、Esc 不回應
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === ' ' && (mustSlap || myDraw)) {
        e.preventDefault();
        room.act(mustSlap ? { type: 'slap' } : { type: 'draw' });
      } else if (key === 'enter' && myPlay && !targeting && selInfo.valid) {
        e.preventDefault();
        if (selInfo.needsTarget) setTargeting(true);
        else playSelected();
      } else if (key === 'e' && myPlay && prompt.canEnd && !targeting) {
        e.preventDefault();
        room.act({ type: 'endPlays' });
      } else if (prompt?.kind === 'response' && alive) {
        const noway = v.hand.find((c) => c.kind === 'noway');
        const pass = v.hand.find((c) => c.kind === 'pass');
        if (key === 'n' && noway && prompt.canNoway) room.act({ type: 'respond', card: noway.id });
        else if (key === 'p' && pass && prompt.canPassTo !== null) room.act({ type: 'respond', card: pass.id });
        else if (key === 'escape' && !prompt.declinedByYou) room.act({ type: 'decline' });
      } else if (key === 'escape' && targeting) {
        setTargeting(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const canTarget = (i: number) =>
    targeting && v.players[i]!.alive && !(selCards[0]?.kind === 'steal' && v.players[i]!.handCount === 0);

  return (
    <main className={`table${targeting ? ' is-targeting' : ''}${targeted ? ' is-targeted' : ''}`}>
      <FxLayer room={room} />
      <div className="sea-rays" aria-hidden="true" />

      <header className="table-head">
        <button className="icon-btn" onClick={onLeave} aria-label="離開房間" title="離開">
          <Icon name="exit" />
        </button>
        <div className="head-info">
          <span className="chip">
            房號 <strong>{info.code}</strong>
          </span>
          <span className="chip">第 {v.turnCount} 回合</span>
        </div>
        <div className="head-actions">
          <button
            className="icon-btn"
            onClick={() => setMuted(!muted)}
            aria-label={muted ? '開啟音效' : '關閉音效'}
            title={muted ? '開啟音效' : '關閉音效'}
          >
            <Icon name={muted ? 'volumeOff' : 'volume'} />
          </button>
          <button className="icon-btn" onClick={() => setShowRules(true)} aria-label="遊戲規則" title="規則">
            <Icon name="book" />
          </button>
          <button
            className={`icon-btn${showLog ? ' active' : ''}`}
            onClick={() => setShowLog((x) => !x)}
            aria-label="出牌紀錄"
            title="紀錄"
          >
            <Icon name="list" />
          </button>
        </div>
      </header>

      <section className={`seats n${others.length}`}>
        {others.map((i, k) => (
          <div key={v.players[i]!.id} className="seat-wrap" style={{ ['--k' as string]: k, ['--n' as string]: others.length }}>
            <Seat
              view={v}
              index={i}
              seat={seatOf(i)}
              turn={v.turn === i && playing}
              targetable={canTarget(i)}
              onTarget={() => playSelected(i)}
              deadline={room.deadline}
            />
          </div>
        ))}
      </section>

      <section className="felt">
        <DirectionRing direction={v.direction} />
        <StatusBar view={v} nameOf={nameOf} remaining={remaining} />
        <div className="piles">
          <Deck count={v.deckCount} canDraw={myDraw} onDraw={() => room.act({ type: 'draw' })} known={v.knownTop} />
          <span className="center-anchor" data-anchor="center" />
          <Discard cards={v.discard} />
        </div>
        {v.chain && <ChainInfo view={v} nameOf={nameOf} />}
      </section>

      <section className={`my-area${v.turn === me && playing ? ' my-turn' : ''}${alive ? '' : ' spectating'}`}>
        {prompt?.kind === 'response' && alive && <ResponseBar room={room} view={v} targeted={targeted} />}
        <div className="my-head">
          <span className="me-badge">
            <span className="seat-avatar" data-anchor={`seat:${me}`}>
              <Avatar name={v.players[me]!.name} isBot={false} seat={me} size={40} />
              {v.turn === me && playing && <TimerRing deadline={room.deadline} totalMs={v.timer?.ms ?? null} size={50} />}
            </span>
            <span className="me-name">
              <span>
                {v.players[me]!.name}
                {v.players[me]!.deepDive && <span className="seat-tag dive">深潛中</span>}
              </span>
              <small>{alive ? `${v.hand.length} 張手牌` : '已淘汰・觀戰中'}</small>
            </span>
          </span>
          {myPlay && (
            <div className="play-controls">
              {targeting ? (
                <>
                  <span className="hint pulse-text">點選上方玩家作為對象</span>
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
                  {prompt.canEnd && (
                    <button className="btn warn" onClick={() => room.act({ type: 'endPlays' })} title="結束出牌並抽牌（E）">
                      結束出牌
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {myDraw && <span className="hint pulse-text">點牌堆抽一張牌（空白鍵）</span>}
        </div>
        <Hand cards={hand} selected={selected} onToggle={toggle} playable={myPlay} />
      </section>

      {showLog && <EventLog room={room} onClose={() => setShowLog(false)} />}
      {showRules && <RulesDialog variant={v.variant} onClose={() => setShowRules(false)} />}

      {prompt?.kind === 'sonar' && prompt.player === me && prompt.cards && (
        <SonarDialog
          cards={prompt.cards}
          nextName={nameOf(nextAliveFrom(v, me))}
          onDone={(order) => room.act({ type: 'sonarArrange', order })}
        />
      )}
      {prompt?.kind === 'placePuffer' && prompt.player === me && (
        <PlacePufferDialog
          deckCount={prompt.deckCount}
          nextName={nameOf(nextAliveFrom(v, me))}
          onPlace={(position) => room.act({ type: 'placePuffer', position })}
        />
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
          view={v}
          winner={v.winner}
          reason={v.winReason}
          isHost={info.hostId === room.playerId}
          onRematch={() => room.send({ type: 'rematch' })}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}

/** 依目前方向的下一位存活玩家 */
function nextAliveFrom(v: PlayerView, from: number): number {
  const n = v.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + v.direction * i) % n) + n) % n;
    if (v.players[idx]!.alive) return idx;
  }
  return from;
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
        text =
          p.player === me
            ? v.players[me]?.deepDive
              ? '出牌結束：從牌堆底抽一張'
              : v.variant === 'deep'
                ? '出牌結束：抽一張牌'
                : '你的回合：抽一張牌'
            : `${nameOf(p.player)} 抽牌中`;
        break;
      case 'play':
        text =
          p.player === me
            ? p.canEnd
              ? '可以繼續出牌，或按「結束出牌」去抽牌'
              : v.variant === 'deep'
                ? '你的回合：先打出至少 1 次牌'
                : '你的回合：選擇要打出的牌'
            : `${nameOf(p.player)} 正在出牌`;
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
      case 'sonar':
        text = p.player === me ? '聲納：重新排列牌堆頂' : `${nameOf(p.player)} 正在用聲納排列牌堆頂`;
        break;
    }
  }
  const total = v.timer ? v.timer.ms / 1000 : null;
  const shown = remaining !== null && v.phase === 'playing' ? Math.min(Math.ceil(remaining), total ?? Infinity) : null;
  return (
    <div className="status" key={text}>
      <span className="status-text">{text}</span>
      {shown !== null && <span className={`status-time${shown <= 5 ? ' urgent' : ''}`}>{shown}</span>}
    </div>
  );
}

function ChainInfo({ view: v, nameOf }: { view: PlayerView; nameOf: (i: number) => string }) {
  const ch = v.chain!;
  return (
    <div className={`chain${ch.baseCancelled ? ' cancelled' : ''}`}>
      {ch.items.map((it, i) => (
        <span key={i} className={`chain-item${it.cancelled ? ' cancelled' : ''}`} style={{ ['--i' as string]: i }}>
          <CardView kind={chainCard(v, it.kind)} size="xs" />
          {it.kind === 'base' && (
            <span>
              {nameOf(it.player)} <strong>{v.variant === 'deep' && ch.play === 'net' ? '拖網' : PLAY_KIND_NAMES[ch.play]}</strong>
              {ch.items.length === 1 && ch.target !== undefined && ` → ${nameOf(ch.target)}`}
            </span>
          )}
          {it.kind === 'noway' && (
            <span>
              {nameOf(it.player)} <strong>No way!</strong>
            </span>
          )}
          {it.kind === 'pass' && (
            <span>
              {nameOf(it.player)} <strong>Pass</strong> → {nameOf(it.to!)}
            </span>
          )}
        </span>
      ))}
      <span className="chain-result">
        {ch.baseCancelled ? '會被取消' : `會生效${ch.target !== undefined ? `・對象 ${nameOf(ch.target)}` : ''}`}
      </span>
    </div>
  );
}

/** 動作鏈每一項對應的卡圖（組合技用棄牌堆中那組生物） */
function chainCard(v: PlayerView, kind: 'base' | 'noway' | 'pass'): CardKind | 'back' {
  if (kind !== 'base') return kind;
  const ch = v.chain!;
  const fn = PLAY_KIND_CARD[ch.play];
  if (fn) return fn;
  const size = ch.play === 'net' ? 2 : ch.play === 'fisher' || v.variant === 'deep' ? 3 : 4;
  const responses = ch.items.length - 1;
  return v.discard[v.discard.length - 1 - responses - (size - 1)]?.kind ?? 'back';
}

function ResponseBar({ room, view: v, targeted }: { room: RoomHandle; view: PlayerView; targeted: boolean }) {
  const p = v.prompt;
  const deadline = room.deadline;
  if (p?.kind !== 'response') return null;
  const noway = v.hand.find((c) => c.kind === 'noway');
  const pass = v.hand.find((c) => c.kind === 'pass');
  const canRespond = (noway && p.canNoway) || (pass && p.canPassTo !== null);
  const total = v.timer?.ms ?? 6000;
  const elapsed = deadline === null ? 0 : Math.max(0, total - (deadline - Date.now()));
  return (
    <div className={`response-bar${targeted ? ' targeted' : ''}`} role="group" aria-label="回應">
      <div className="response-drain" key={deadline ?? 0}>
        <i style={{ animationDuration: `${total}ms`, animationDelay: `-${elapsed}ms` }} />
      </div>
      {targeted && (
        <strong className="target-alert">
          <Icon name="hand" size={18} />
          你被指定了！{canRespond ? '要回應嗎？' : '（沒有可以回應的牌）'}
        </strong>
      )}
      <div className="response-btns">
        {noway && (
          <button
            className="btn danger"
            disabled={!p.canNoway}
            onClick={() => room.act({ type: 'respond', card: noway.id })}
          >
            {cardName('noway')}！<kbd>N</kbd>
          </button>
        )}
        {pass && p.canPassTo !== null && (
          <button className="btn warn" onClick={() => room.act({ type: 'respond', card: pass.id })}>
            Pass → {v.players[p.canPassTo]!.name}
            <kbd>P</kbd>
          </button>
        )}
        <button className="btn ghost" disabled={p.declinedByYou} onClick={() => room.act({ type: 'decline' })}>
          {p.declinedByYou ? '已表示不回應' : '不回應'}
        </button>
      </div>
    </div>
  );
}

function EventLog({ room, onClose }: { room: RoomHandle; onClose: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [room.log.length]);
  return (
    <aside className="log" aria-label="出牌紀錄">
      <header>
        <strong>出牌紀錄</strong>
        <button className="icon-btn small" onClick={onClose} aria-label="關閉紀錄">
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className="log-body">
        {room.log.map((entry) => {
          // 玩家名稱整局不變，用目前視角的名單（開局第一批事件可能比視角早到）
          const v = room.view;
          const names = v ? v.players.map((p) => p.name) : entry.names;
          const text = describeEvent(entry.event, names, v?.you ?? entry.you, v?.variant);
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
