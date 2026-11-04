import { MAX_NAME_LENGTH, isValidRoomCode } from '@pufferfish/protocol';
import { useState } from 'react';
import { loadName, navigate, saveName } from '../router';

export function Home({ invalidCode }: { invalidCode: boolean }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(invalidCode ? '房號格式不正確' : '');

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 1 && [...trimmed].length <= MAX_NAME_LENGTH;

  async function create() {
    if (!nameOk) return setError('請先輸入暱稱');
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
    saveName(trimmed);
    navigate(`/r/${c}`);
  }

  return (
    <main className="home">
      <img className="home-logo" src="/logo.png" alt="" />
      <h1>河豚愛生氣</h1>
      <p className="subtitle">線上版 · 3～5 人 · 邀請朋友一起玩</p>

      <section className="panel">
        <label className="field">
          <span>暱稱</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="輸入你的暱稱"
            onChange={(e) => setName(e.target.value)}
            autoFocus={!name}
          />
        </label>
        <button className="btn primary big" disabled={busy} onClick={create}>
          {busy ? '建立中…' : '建立房間'}
        </button>
        <div className="divider">或</div>
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
            placeholder="輸入房號"
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" type="submit">
            加入
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
