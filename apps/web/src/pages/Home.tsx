import { MAX_NAME_LENGTH, isValidRoomCode } from '@pufferfish/protocol';
import { useState } from 'react';
import { cardImg } from '../cards';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { loadName, navigate, saveName } from '../router';
import { sfx } from '../sfx';

const TITLE = [...'河豚愛生氣'];
const FAN = ['clownfish', 'puffer', 'chill'] as const;

export function Home({ invalidCode }: { invalidCode: boolean }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(invalidCode ? '房號格式不正確' : '');

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && [...trimmed].length <= MAX_NAME_LENGTH;

  async function create() {
    if (!nameOk) return setError('請先輸入暱稱');
    sfx('tap');
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? '建立房間失敗');
      saveName(trimmed);
      navigate(`/r/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '建立房間失敗');
      setBusy(false);
    }
  }

  function join() {
    const c = code.trim().toUpperCase();
    if (!nameOk) return setError('請先輸入暱稱');
    if (!isValidRoomCode(c)) return setError('請輸入 6 碼房號');
    sfx('tap');
    saveName(trimmed);
    navigate(`/r/${c}`);
  }

  return (
    <main className="home">
      <Bubbles />
      <div className="home-hero">
        <div className="home-fan" aria-hidden="true">
          {FAN.map((k, i) => (
            <img key={k} src={cardImg(k)} alt="" style={{ ['--i' as string]: i - 1 }} draggable={false} />
          ))}
        </div>
        <Mascot size={128} />
        <h1 className="title" aria-label="河豚愛生氣">
          {TITLE.map((ch, i) => (
            <span key={i} style={{ ['--i' as string]: i }} aria-hidden="true">
              {ch}
            </span>
          ))}
        </h1>
        <p className="subtitle">線上版・3～5 人・邀請朋友一起玩</p>
      </div>

      <section className="panel home-panel">
        <label className="field">
          <span>暱稱</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="輸入你的暱稱"
            onChange={(e) => setName(e.target.value)}
            autoFocus={!name}
            autoComplete="nickname"
          />
        </label>
        <button className="btn primary big" disabled={busy} onClick={create}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" />}
          {busy ? '建立中…' : '建立房間'}
        </button>
        <div className="divider">或加入朋友的房間</div>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            value={code}
            maxLength={6}
            placeholder="6 碼房號"
            className="code-input"
            aria-label="房號"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" type="submit">
            加入 <Icon name="arrowRight" size={18} />
          </button>
        </form>
        {error && (
          <p className="error-text" role="alert" key={error}>
            {error}
          </p>
        )}
      </section>
      <p className="home-foot">戳一下河豚試試看</p>
    </main>
  );
}

/** 背景上升的氣泡（純 CSS） */
export function Bubbles({ count = 16 }: { count?: number }) {
  return (
    <div className="bubbles" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 61) % 100}%`,
            ['--s' as string]: `${6 + ((i * 7) % 18)}px`,
            ['--d' as string]: `${9 + ((i * 5) % 11)}s`,
            ['--delay' as string]: `-${(i * 3.7) % 14}s`,
            ['--x' as string]: `${((i * 13) % 40) - 20}px`,
          }}
        />
      ))}
    </div>
  );
}
