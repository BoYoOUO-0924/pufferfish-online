import type { Card, PlayerView, WinReason } from '@pufferfish/engine';
import { useState, type ReactNode } from 'react';
import { sfx } from '../sfx';
import { CardView } from './CardView';
import { Icon } from './Icon';
import { Avatar, Mascot } from './Mascot';

function Modal({
  title,
  icon,
  children,
  className,
  delay,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 晚一點出現，先讓桌上的動畫播完（ms） */
  delay?: number;
}) {
  return (
    <div className={`modal-backdrop${delay ? ' delayed' : ''}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <div className={`modal${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="modal-title">
          {icon}
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function PlacePufferDialog({
  deckCount,
  nextName,
  onPlace,
}: {
  deckCount: number;
  nextName: string;
  onPlace: (pos: number) => void;
}) {
  const [pos, setPos] = useState(0);
  const label =
    pos === 0
      ? `最上面（${nextName} 下一張就會抽到）`
      : pos === deckCount
        ? '最下面'
        : `從上面數第 ${pos + 1} 張`;
  // 牌堆示意：最多畫 24 張，標出河豚位置
  const slots = Math.min(24, deckCount + 1);
  const mark = deckCount === 0 ? 0 : Math.round((pos / deckCount) * (slots - 1));
  return (
    <Modal title="把河豚放回牌堆" icon={<Mascot size={40} interactive={false} />} delay={1700}>
      <p className="modal-sub">用 Chill 擋下了！選擇河豚要放回的位置，其他人不會知道。</p>
      <div className="deck-meter" aria-hidden="true">
        {Array.from({ length: slots }, (_, k) => (
          <i key={k} className={k === mark ? 'puffer' : ''} />
        ))}
      </div>
      <input
        className="slider"
        type="range"
        min={0}
        max={deckCount}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="放回位置"
      />
      <strong className="puffer-pos">{label}</strong>
      <div className="quick-row">
        {[
          ['最上面', 0],
          ['中間', Math.floor(deckCount / 2)],
          ['最下面', deckCount],
          ['隨機', -1],
        ].map(([label, v]) => (
          <button
            key={label}
            className={`btn small${v === pos ? ' on' : ''}`}
            onClick={() => {
              sfx('tap');
              setPos(v === -1 ? Math.floor(Math.random() * (deckCount + 1)) : (v as number));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button className="btn primary big" onClick={() => onPlace(pos)}>
        確定
      </button>
    </Modal>
  );
}

/** 依點選順序排列；可用 ↑↓ 調整 */
function OrderList({ cards, onMove, names }: { cards: Card[]; onMove: (i: number, d: -1 | 1) => void; names?: string[] }) {
  return (
    <ol className="order-list">
      {cards.map((c, i) => (
        <li key={c.id} style={{ ['--i' as string]: i }}>
          <CardView kind={c.kind} size="sm" />
          <span>{names ? `給 ${names[i] ?? '—'}` : i === 0 ? '牌堆最上面' : `第 ${i + 1} 張`}</span>
          <span className="order-btns">
            <button className="icon-btn small" disabled={i === 0} onClick={() => onMove(i, -1)} aria-label="往上移">
              ↑
            </button>
            <button
              className="icon-btn small"
              disabled={i === cards.length - 1}
              onClick={() => onMove(i, 1)}
              aria-label="往下移"
            >
              ↓
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

function move<T>(arr: T[], i: number, d: -1 | 1): T[] {
  const out = [...arr];
  [out[i], out[i + d]] = [out[i + d]!, out[i]!];
  return out;
}

export function FisherDialog({ cards, onDone }: { cards: Card[]; onDone: (keep: string[], order: string[]) => void }) {
  const k = Math.min(3, cards.length);
  const [keep, setKeep] = useState<string[]>([]);
  const [rest, setRest] = useState<Card[]>(cards);
  const toggle = (c: Card) => {
    sfx('tap');
    if (keep.includes(c.id)) {
      setKeep(keep.filter((x) => x !== c.id));
      setRest([...rest, c]);
    } else if (keep.length < k) {
      setKeep([...keep, c.id]);
      setRest(rest.filter((x) => x.id !== c.id));
    }
  };
  return (
    <Modal title="漁販：留下 3 張" className="wide" delay={700}>
      <p className="modal-sub">
        點選要留下的牌（{keep.length}/{k}），其餘的會放回牌堆頂。
      </p>
      <div className="pick-row">
        {cards.map((c, i) => (
          <span key={c.id} className="deal-in" style={{ ['--i' as string]: i }}>
            <CardView kind={c.kind} selected={keep.includes(c.id)} onClick={() => toggle(c)} />
          </span>
        ))}
      </div>
      {rest.length > 0 && keep.length === k && (
        <>
          <p className="modal-sub">放回牌堆的順序：</p>
          <OrderList cards={rest} onMove={(i, d) => setRest(move(rest, i, d))} />
        </>
      )}
      <button className="btn primary big" disabled={keep.length !== k} onClick={() => onDone(keep, rest.map((c) => c.id))}>
        確定
      </button>
    </Modal>
  );
}

export function ChefDialog({
  cards,
  recipients,
  onDone,
}: {
  cards: Card[];
  recipients: string[];
  onDone: (keep: string, order: string[]) => void;
}) {
  const [keep, setKeep] = useState<string | null>(null);
  const [rest, setRest] = useState<Card[]>(cards);
  const choose = (c: Card) => {
    sfx('tap');
    setKeep(c.id);
    setRest(cards.filter((x) => x.id !== c.id));
  };
  return (
    <Modal title="Chef：挑一張，其餘分給大家" className="wide" delay={700}>
      <p className="modal-sub">先點選你要留下的牌，再排好其餘牌要分給誰。</p>
      <div className="pick-row">
        {cards.map((c, i) => (
          <span key={c.id} className="deal-in" style={{ ['--i' as string]: i }}>
            <CardView kind={c.kind} selected={keep === c.id} onClick={() => choose(c)} />
          </span>
        ))}
      </div>
      {keep && rest.length > 0 && (
        <OrderList cards={rest} names={recipients} onMove={(i, d) => setRest(move(rest, i, d))} />
      )}
      <button className="btn primary big" disabled={!keep} onClick={() => keep && onDone(keep, rest.map((c) => c.id))}>
        確定
      </button>
    </Modal>
  );
}

/** 聲納：重新排列牌堆頂幾張（第 1 張是下一位會抽到的） */
export function SonarDialog({
  cards,
  nextName,
  onDone,
}: {
  cards: Card[];
  nextName: string;
  onDone: (order: string[]) => void;
}) {
  const [order, setOrder] = useState<Card[]>(cards);
  return (
    <Modal title="聲納：重新排列牌堆頂" className="wide" delay={500}>
      <p className="modal-sub">由上往下排列，最上面那張 {nextName} 會先抽到。其他人只知道你排過，不知道內容。</p>
      <OrderList cards={order} onMove={(i, d) => setOrder(move(order, i, d))} />
      <button className="btn primary big" onClick={() => onDone(order.map((c) => c.id))}>
        確定
      </button>
    </Modal>
  );
}

export function SlapOverlay({
  isActor,
  mustSlap,
  slapped,
  actorName,
  onSlap,
}: {
  isActor: boolean;
  mustSlap: boolean;
  slapped: boolean;
  actorName: string;
  onSlap: () => void;
}) {
  const [hit, setHit] = useState(false);
  const slap = () => {
    setHit(true);
    sfx('slap');
    onSlap();
  };
  return (
    <div className="modal-backdrop slap-backdrop">
      <div className={`slap${hit ? ' hit' : ''}`}>
        <h2 className="slap-title">Watch Out!</h2>
        {mustSlap ? (
          <button
            className="slap-target"
            autoFocus
            onPointerDown={(e) => {
              // 按下就算，不等放開，對手機比較公平
              e.preventDefault();
              slap();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') slap();
            }}
          >
            <CardView kind="watchout" size="lg" />
            <span className="slap-cta">
              <Icon name="hand" size={22} /> 快拍！
            </span>
          </button>
        ) : (
          <>
            <div className="slap-card">
              <CardView kind="watchout" size="lg" />
            </div>
            <p>{isActor ? '等大家拍牌…' : slapped ? '拍到了！等其他人…' : `${actorName} 打出 Watch Out`}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function GameOverDialog({
  view: v,
  winner,
  reason,
  isHost,
  onRematch,
  onLeave,
}: {
  view: PlayerView;
  winner: number | null;
  reason: WinReason | null;
  isHost: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const youWon = winner === v.you;
  const winnerName = winner === null ? '?' : (v.players[winner]?.name ?? '?');
  return (
    <div className="modal-backdrop gameover-backdrop">
      <div className={`gameover${youWon ? ' won' : ''}`} role="dialog" aria-modal="true" aria-label="遊戲結束">
        <div className="gameover-burst" aria-hidden="true" />
        <div className="gameover-hero">
          <Icon name="trophy" size={56} className="trophy" />
        </div>
        <h2>{youWon ? '你贏了！' : `${winnerName} 獲勝`}</h2>
        <p className="modal-sub">
          {reason === 'collection' ? '收集到同一海洋層的 5 種生物！' : '撐到最後，其他人都被河豚淘汰了！'}
        </p>
        <ul className="result-list">
          {v.players.map((p, i) => (
            <li key={p.id} className={i === winner ? 'winner' : p.alive ? '' : 'out'} style={{ ['--i' as string]: i }}>
              <Avatar name={p.name} isBot={p.isBot} seat={i} size={34} />
              <span>
                {p.name}
                {i === v.you && '（你）'}
              </span>
              {i === winner ? (
                <Icon name="crown" size={18} className="crown" />
              ) : (
                <small>{p.alive ? '存活' : '淘汰'}</small>
              )}
            </li>
          ))}
        </ul>
        <div className="gameover-actions">
          <button className="btn ghost" onClick={onLeave}>
            離開
          </button>
          {isHost ? (
            <button className="btn primary big" onClick={onRematch}>
              再來一局
            </button>
          ) : (
            <span className="hint">等待房主開新的一局…</span>
          )}
        </div>
      </div>
    </div>
  );
}
