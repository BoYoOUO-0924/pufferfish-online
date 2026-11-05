import { MAX_NAME_LENGTH } from '@pufferfish/protocol';
import { useEffect, useState } from 'react';
import { Lobby } from '../components/Lobby';
import { Mascot } from '../components/Mascot';
import { Bubbles } from './Home';
import { Table } from '../components/Table';
import { clearToken, useRoom } from '../net';
import { loadName, navigate, saveName } from '../router';

export function RoomPage({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(() => loadName().trim() || null);
  if (!name) return <NameGate code={code} onDone={setName} />;
  return <Connected code={code} name={name} />;
}

function NameGate({ code, onDone }: { code: string; onDone: (n: string) => void }) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  return (
    <main className="home">
      <Bubbles />
      <Mascot size={96} />
      <h1 className="page-title">加入房間 {code}</h1>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          saveName(trimmed);
          onDone(trimmed);
        }}
      >
        <label className="field">
          <span>暱稱</span>
          <input value={value} maxLength={MAX_NAME_LENGTH} autoFocus autoComplete="nickname" onChange={(e) => setValue(e.target.value)} />
        </label>
        <button className="btn primary big" disabled={!trimmed}>
          進入房間
        </button>
      </form>
    </main>
  );
}

function Connected({ code, name }: { code: string; name: string }) {
  const room = useRoom(code, name);

  // 錯誤訊息 4 秒後自動消失
  useEffect(() => {
    if (!room.error) return;
    const id = setTimeout(room.dismissError, 4000);
    return () => clearTimeout(id);
  }, [room.error, room.dismissError]);

  const leave = () => {
    room.send({ type: 'leave' });
    clearToken(code);
    navigate('/');
  };

  if (room.status === 'notFound') {
    return (
      <main className="home">
        <Bubbles />
        <Mascot size={96} />
        <h1 className="page-title">找不到房間 {code}</h1>
        <p className="subtitle">房號可能打錯了，或房間已經關閉。</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          回首頁
        </button>
      </main>
    );
  }

  const fatal = room.error && ['gameInProgress', 'roomFull'].includes(room.error.code) && !room.playerId;
  if (fatal) {
    return (
      <main className="home">
        <Bubbles />
        <Mascot size={96} />
        <h1 className="page-title">無法加入</h1>
        <p className="subtitle">{room.error!.message}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          回首頁
        </button>
      </main>
    );
  }

  let body;
  if (!room.room || !room.playerId) body = <Loading text="連線中…" />;
  else if (room.room.phase === 'lobby') body = <Lobby room={room} onLeave={leave} />;
  else if (room.view) body = <Table room={room} onLeave={leave} />;
  else body = <Loading text="載入中…" />;

  return (
    <>
      {room.status === 'reconnecting' && <div className="banner warn" role="status">
          <span className="spinner" aria-hidden="true" />
          連線中斷，正在重新連線…
        </div>}
      {room.error && (
        <div className="toast" role="alert" onClick={room.dismissError}>
          {room.error.message}
        </div>
      )}
      {body}
    </>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <main className="home loading">
      <Bubbles />
      <Mascot size={96} interactive={false} />
      <p className="subtitle">{text}</p>
    </main>
  );
}
