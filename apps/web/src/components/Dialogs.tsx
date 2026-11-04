import type { Card, WinReason } from '@pufferfish/engine';
import { useState, type ReactNode } from 'react';
import { CardView } from './CardView';

function Modal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
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
  return (
    <Modal title="🐡 把河豚放回牌堆">
      <p>用 Chill 擋下了！選擇河豚要放回的位置，其他人不會知道。</p>
      <div className="puffer-pick">
        <CardView kind="puffer" size="md" />
        <div className="puffer-slider">
          <input
            type="range"
            min={0}
            max={deckCount}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="放回位置"
          />
          <strong>{label}</strong>
          <div className="quick-row">
            <button className="btn small" onClick={() => setPos(0)}>
              最上面
            </button>
            <button className="btn small" onClick={() => setPos(Math.floor(deckCount / 2))}>
              中間
            </button>
            <button className="btn small" onClick={() => setPos(deckCount)}>
              最下面
            </button>
            <button className="btn small" onClick={() => setPos(Math.floor(Math.random() * (deckCount + 1)))}>
              隨機
            </button>
          </div>
        </div>
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
        <li key={c.id}>
          <CardView kind={c.kind} size="sm" />
          <span>{names ? `給 ${names[i] ?? '—'}` : i === 0 ? '牌堆最上面' : `第 ${i + 1} 張`}</span>
          <span className="order-btns">
            <button className="btn small ghost" disabled={i === 0} onClick={() => onMove(i, -1)}>
              ↑
            </button>
            <button className="btn small ghost" disabled={i === cards.length - 1} onClick={() => onMove(i, 1)}>
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
    if (keep.includes(c.id)) {
      setKeep(keep.filter((x) => x !== c.id));
      setRest([...rest, c]);
    } else if (keep.length < k) {
      setKeep([...keep, c.id]);
      setRest(rest.filter((x) => x.id !== c.id));
    }
  };
  return (
    <Modal title="🎣 漁販：留下 3 張">
      <p>點選要留下的牌（{keep.length}/{k}），其餘的會放回牌堆頂。</p>
      <div className="pick-row">
        {cards.map((c) => (
          <CardView key={c.id} kind={c.kind} selected={keep.includes(c.id)} onClick={() => toggle(c)} />
        ))}
      </div>
      {rest.length > 0 && keep.length === k && (
        <>
          <p>放回牌堆的順序：</p>
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
    setKeep(c.id);
    setRest(cards.filter((x) => x.id !== c.id));
  };
  return (
    <Modal title="👨‍🍳 Chef：挑一張，其餘分給大家">
      <p>先點選你要留下的牌，再排好其餘牌要分給誰。</p>
      <div className="pick-row">
        {cards.map((c) => (
          <CardView key={c.id} kind={c.kind} selected={keep === c.id} onClick={() => choose(c)} />
        ))}
      </div>
      {keep && rest.length > 0 && <OrderList cards={rest} names={recipients} onMove={(i, d) => setRest(move(rest, i, d))} />}
      <button className="btn primary big" disabled={!keep} onClick={() => keep && onDone(keep, rest.map((c) => c.id))}>
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
  return (
    <div className="modal-backdrop slap-backdrop">
      <div className="slap">
        <h2>⚠️ Watch Out！</h2>
        {mustSlap ? (
          <button
            className="slap-target"
            autoFocus
            onPointerDown={(e) => {
              // 按下就算，不等放開，對手機比較公平
              e.preventDefault();
              onSlap();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSlap();
            }}
          >
            <CardView kind="watchout" size="lg" />
            <span>快拍！（或按空白鍵）</span>
          </button>
        ) : (
          <>
            <CardView kind="watchout" size="lg" />
            <p>{isActor ? '等大家拍牌…' : slapped ? '拍到了！等其他人…' : `${actorName} 打出 Watch Out`}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function GameOverDialog({
  winner,
  youWon,
  reason,
  isHost,
  onRematch,
  onLeave,
}: {
  winner: string;
  youWon: boolean;
  reason: WinReason | null;
  isHost: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  return (
    <Modal title={youWon ? '🏆 你贏了！' : `🏆 ${winner} 獲勝`}>
      <p>{reason === 'collection' ? '收集到同一海洋層的 5 種生物！' : '撐到最後，其他人都被河豚淘汰了！'}</p>
      <div className="lobby-actions">
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
    </Modal>
  );
}
