/** 線條圖示（24×24，stroke 用 currentColor） */
const PATHS = {
  sparkle: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z M19 3v4 M21 5h-4',
  rotateCw: 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
  rotateCcw: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  torpedo: 'M3 12h3 M6 9h9a4 3 0 0 1 0 6H6z M6 9l-2-3 M6 15l-2 3 M15 12h.01',
  robot: 'M12 8V4H8 M5 8h14a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z M2 14h2 M20 14h2 M9 13v2 M15 13v2',
  crown: 'M2 7l4.5 5L12 4l5.5 8L22 7l-2 12H4z',
  volume: 'M11 5L6 9H2v6h4l5 4z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14',
  volumeOff: 'M11 5L6 9H2v6h4l5 4z M22 9l-6 6 M16 9l6 6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  exit: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14 M5 12h14',
  x: 'M18 6L6 18 M6 6l12 12',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5 M14 10V4a2 2 0 0 0-4 0v6 M10 10.5V6a2 2 0 0 0-4 0v8 M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  arrowLeft: 'M19 12H5 M12 19l-7-7 7-7',
  wifiOff: 'M2 2l20 20 M8.5 16.5a5 5 0 0 1 7 0 M5 13a10 10 0 0 1 5.2-2.8 M19 13a10 10 0 0 0-2.3-1.7 M2 8.8a15 15 0 0 1 4.2-2.7 M22 8.8A15 15 0 0 0 10.7 5 M12 20h.01',
  trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.7V17c0 .6-.5 1-1 1.2C7.8 18.8 7 20.2 7 22 M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8 M18 2H6v7a6 6 0 0 0 12 0z',
  skull: 'M9 12h.01 M15 12h.01 M10 16l.5 2h3l.5-2 M12 2a8 8 0 0 0-5 14.2V20h10v-3.8A8 8 0 0 0 12 2z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  play: 'M6 3l14 9-14 9z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].split(' M').map((d, i) => (
        <path key={i} d={i ? `M${d}` : d} />
      ))}
    </svg>
  );
}
