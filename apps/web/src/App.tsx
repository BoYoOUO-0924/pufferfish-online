import { isValidRoomCode } from '@pufferfish/protocol';
import { Home } from './pages/Home';
import { RoomPage } from './pages/RoomPage';
import { usePath } from './router';

export function App() {
  const path = usePath();
  const m = path.match(/^\/r\/([^/]+)\/?$/);
  const code = m ? decodeURIComponent(m[1]!).toUpperCase() : null;
  if (code && isValidRoomCode(code)) return <RoomPage key={code} code={code} />;
  return <Home invalidCode={code !== null} />;
}
