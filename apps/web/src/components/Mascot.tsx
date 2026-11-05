/** 吉祥物：會生氣膨脹的河豚（SVG） */
import { useState } from 'react';
import { sfx } from '../sfx';

export function Mascot({ size = 140, interactive = true }: { size?: number; interactive?: boolean }) {
  const [angry, setAngry] = useState(false);
  const poke = () => {
    if (!interactive || angry) return;
    setAngry(true);
    sfx('inflate');
    setTimeout(() => setAngry(false), 1400);
  };
  const spikes = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r1 = 46;
    const r2 = 60;
    const w = 0.16;
    const p = (r: number, ang: number) => `${60 + Math.cos(ang) * r},${60 + Math.sin(ang) * r}`;
    return <polygon key={i} points={`${p(r1, a - w)} ${p(r2, a)} ${p(r1, a + w)}`} />;
  });
  return (
    <button
      type="button"
      className={`mascot${angry ? ' angry' : ''}`}
      style={{ width: size, height: size }}
      onClick={poke}
      aria-label="戳一下河豚"
      tabIndex={interactive ? 0 : -1}
    >
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <g className="mascot-spikes" fill="#e9b949" stroke="#5a3b00" strokeWidth="1.5" strokeLinejoin="round">
          {spikes}
        </g>
        <path className="mascot-fin" d="M104 60 q14 -12 12 4 q2 14 -12 4z" fill="#f4c542" stroke="#5a3b00" strokeWidth="2" />
        <circle cx="60" cy="60" r="46" fill="url(#mascot-body)" stroke="#5a3b00" strokeWidth="2.5" />
        <ellipse cx="60" cy="84" rx="30" ry="15" fill="#fff8dc" opacity=".85" />
        <g fill="#7a9e3a" opacity=".55">
          <circle cx="40" cy="30" r="5" />
          <circle cx="58" cy="22" r="4" />
          <circle cx="76" cy="30" r="5" />
          <circle cx="86" cy="44" r="3.5" />
        </g>
        {/* 眉毛：生氣時豎起來 */}
        <g className="mascot-brows" stroke="#2b1a00" strokeWidth="4" strokeLinecap="round">
          <line x1="34" y1="44" x2="50" y2="50" />
          <line x1="86" y1="44" x2="70" y2="50" />
        </g>
        <g className="mascot-eyes">
          <circle cx="44" cy="58" r="8" fill="#fff" stroke="#2b1a00" strokeWidth="2" />
          <circle cx="76" cy="58" r="8" fill="#fff" stroke="#2b1a00" strokeWidth="2" />
          <circle cx="46" cy="59" r="4" fill="#2b1a00" />
          <circle cx="74" cy="59" r="4" fill="#2b1a00" />
          <circle cx="47.5" cy="57.5" r="1.3" fill="#fff" />
          <circle cx="75.5" cy="57.5" r="1.3" fill="#fff" />
        </g>
        <ellipse cx="33" cy="70" rx="6" ry="3.5" fill="#ff8a7a" opacity=".6" />
        <ellipse cx="87" cy="70" rx="6" ry="3.5" fill="#ff8a7a" opacity=".6" />
        <path className="mascot-mouth" d="M51 73 q9 8 18 0" fill="none" stroke="#2b1a00" strokeWidth="3" strokeLinecap="round" />
        <path className="mascot-mouth-angry" d="M50 78 q10 -10 20 0 q-10 6 -20 0z" fill="#d62828" stroke="#2b1a00" strokeWidth="2.5" />
        <g className="mascot-anger" fill="#ff3b3b">
          <path d="M88 18 l4 8 l-8 -2 l8 -2 l-4 8z" />
          <path d="M96 14 q3 4 0 8 M100 18 q-4 3 -8 0" stroke="#ff3b3b" strokeWidth="3" fill="none" />
        </g>
        <defs>
          <radialGradient id="mascot-body" cx="40%" cy="35%" r="70%">
            <stop offset="0" stopColor="#fff27a" />
            <stop offset=".6" stopColor="#ffd23f" />
            <stop offset="1" stopColor="#e9a820" />
          </radialGradient>
        </defs>
      </svg>
    </button>
  );
}

const AVATAR_COLORS = ['#ff8fab', '#4cc9f0', '#90e39a', '#ffb347', '#c59bff'];

/** 玩家頭像：電腦玩家用機器人圖示，其他用名字第一個字 */
export function Avatar({
  name,
  isBot,
  seat,
  size = 48,
}: {
  name: string;
  isBot: boolean;
  seat: number;
  size?: number;
}) {
  const color = AVATAR_COLORS[seat % AVATAR_COLORS.length]!;
  return (
    <span className="avatar" style={{ width: size, height: size, ['--av' as string]: color, fontSize: size * 0.44 }}>
      {isBot ? (
        <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 8V4H8" />
          <rect x="4" y="8" width="16" height="12" rx="2.5" />
          <path d="M2 14h2M20 14h2M9 13v2M15 13v2" />
        </svg>
      ) : (
        [...name][0] ?? '?'
      )}
    </span>
  );
}
