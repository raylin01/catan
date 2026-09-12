import './GameIcon.css';

const ALIASES = {
  forest: 'lumber',
  hills: 'brick',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  victoryPoint: 'trophy',
  resourceCards: 'cards',
  diceRoll: 'dice',
  largestArmy: 'knight',
  longestRoad: 'road',
  overview: 'compass',
  setup: 'settlement',
  turn: 'dice',
  building: 'settlement',
  devCards: 'devCard',
  ports: 'port',
  special: 'trophy',
  extension: 'players',
  seven: 'dice'
};

function resolveName(name) {
  return ALIASES[name] || name || 'unknown';
}

function iconShape(name) {
  switch (resolveName(name)) {
    case 'brick':
      return (
        <>
          <path d="M3.5 5.5h17v5h-17zM3.5 13.5h17v5h-17z" fill="currentColor" opacity=".8" />
          <path d="M3.5 5.5h17M3.5 13.5h17M9 5.5v5M16 5.5v5M6 13.5v5M13 13.5v5" />
        </>
      );
    case 'lumber':
      return (
        <>
          <path d="M12 21V10" />
          <path d="M12 12 5 8.5 7.5 5l4.5 4 4.5-4L19 8.5z" fill="currentColor" opacity=".8" />
          <path d="M12 8 8 4M12 8l4-4M9 21h6" />
        </>
      );
    case 'wool':
      return (
        <>
          <path d="M5.5 14.5a4 4 0 0 1 1.7-6.9 5.1 5.1 0 0 1 9.6 1.2 3.8 3.8 0 0 1 1.7 7.2H7.8a3.2 3.2 0 0 1-2.3-1.5Z" fill="currentColor" opacity=".82" />
          <circle cx="18.2" cy="11.6" r=".85" fill="var(--bg-primary)" stroke="none" />
          <path d="M9 16.3v3M14 16.3v3M17.5 14.6h2" />
        </>
      );
    case 'grain':
      return (
        <>
          <path d="M12 21V4" />
          <path d="M12 8c-3.5 0-5-2.3-5.2-4.2C10.2 3.6 12 5.2 12 8ZM12 12c3.5 0 5-2.3 5.2-4.2C13.8 7.6 12 9.2 12 12ZM12 16c-3.5 0-5-2.3-5.2-4.2C10.2 11.6 12 13.2 12 16ZM12 18c3.5 0 5-2.3 5.2-4.2C13.8 13.6 12 15.2 12 18Z" fill="currentColor" opacity=".8" />
        </>
      );
    case 'ore':
      return (
        <>
          <path d="m3 19 5.6-9 3 4.1 3.2-6.3L21 19Z" fill="currentColor" opacity=".78" />
          <path d="m3 19 5.6-9 3 4.1 3.2-6.3L21 19M8.6 10 10 19M14.8 7.8 16 19" />
          <path d="M5 21h14" />
        </>
      );
    case 'desert':
      return (
        <>
          <circle cx="16.5" cy="7" r="2.5" fill="currentColor" opacity=".72" stroke="none" />
          <path d="M3 17c3-2.4 5.8-2.4 8.8 0 3-2.4 5.8-2.4 9.2 0M3 20c3-2.3 5.8-2.3 8.8 0 3-2.3 5.8-2.3 9.2 0" />
          <path d="M6.5 17V8.5M6.5 11 4.5 9M6.5 13l2-1.8" />
        </>
      );
    case 'robber':
      return (
        <>
          <path d="M7 20c.2-4.1 1.8-6.4 5-6.4s4.8 2.3 5 6.4" fill="currentColor" opacity=".8" />
          <circle cx="12" cy="8.5" r="3.2" fill="currentColor" opacity=".9" />
          <path d="M7.5 7.2c1.2-3.2 7.8-3.2 9 0M9.2 9h.1M14.7 9h.1" />
          <path d="M10.2 11.1c1.1.7 2.5.7 3.6 0" />
        </>
      );
    case 'road':
      return (
        <>
          <path d="M3 17 8 12l4 3 5-8 4 2" fill="none" strokeWidth="3.5" opacity=".38" />
          <path d="M3 17 8 12l4 3 5-8 4 2" fill="none" strokeWidth="2.2" />
          <circle cx="3" cy="17" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="21" cy="9" r="1.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'settlement':
      return (
        <>
          <path d="M4 11.2 12 4l8 7.2V20H4Z" fill="currentColor" opacity=".8" />
          <path d="m3 11.5 9-8 9 8M5 20h14M8.5 20v-5h7v5" />
        </>
      );
    case 'city':
      return (
        <>
          <path d="M4 20V8h6v12M10 20V4h5v16M15 20v-9h5v9Z" fill="currentColor" opacity=".78" />
          <path d="M4 20V8h6v12M10 20V4h5v16M15 20v-9h5v9M3 20h18M6.5 11h1M6.5 14h1M12 7h1M12 10h1M17 14h1M17 17h1" />
        </>
      );
    case 'knight':
      return (
        <>
          <path d="M7 20c.4-3.8 2-5.7 5.8-5.7 2.2 0 3.4 1.8 4.2 5.7Z" fill="currentColor" opacity=".8" />
          <path d="M8.2 13.5c-.6-2.7.3-4.8 2.4-6.2l-1-2.2c3-.5 5.4 1 6.6 3.3l-1.4 1.2c.5 1.3.2 2.7-.8 3.9Z" fill="currentColor" opacity=".7" />
          <path d="M8.2 13.5c-.6-2.7.3-4.8 2.4-6.2l-1-2.2c3-.5 5.4 1 6.6 3.3l-1.4 1.2c.5 1.3.2 2.7-.8 3.9M7 20h12M10.5 10.2h.1" />
        </>
      );
    case 'devCard':
      return (
        <>
          <path d="m7 4 12 2v14l-12-2Z" fill="currentColor" opacity=".38" />
          <path d="m5 6 12 2v13L5 19Z" fill="currentColor" opacity=".8" />
          <path d="M8.5 11.5h5M8.5 14.5h3.5" />
        </>
      );
    case 'cards':
      return (
        <>
          <path d="m6 5 12 2v13L6 18Z" fill="currentColor" opacity=".38" />
          <rect x="4" y="5" width="12" height="14" rx="1.5" fill="currentColor" opacity=".8" />
          <path d="M7.5 9h5M7.5 12h5M7.5 15h3" />
        </>
      );
    case 'dice':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" opacity=".78" />
          <circle cx="8.5" cy="8.5" r="1.2" fill="var(--bg-primary)" stroke="none" />
          <circle cx="15.5" cy="15.5" r="1.2" fill="var(--bg-primary)" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="var(--bg-primary)" stroke="none" />
        </>
      );
    case 'bank':
      return (
        <>
          <path d="m3 9 9-5 9 5v2H3Z" fill="currentColor" opacity=".78" />
          <path d="M5 12v6M9 12v6M15 12v6M19 12v6M3 20h18M3 9h18" />
        </>
      );
    case 'trade':
      return (
        <>
          <path d="M4 8h13l-2.5-2.5M20 16H7l2.5 2.5" fill="none" strokeWidth="2" />
          <path d="M17 8h3v3M7 16H4v-3" fill="none" strokeWidth="2" />
        </>
      );
    case 'history':
      return <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6M12 7v5l3 2" fill="none"/></>;
    case 'chat':
      return (
        <>
          <path d="M4 5.5h16v10H9l-5 3Z" fill="currentColor" opacity=".72" />
          <path d="M4 5.5h16v10H9l-5 3Z" />
          <path d="M8 9.5h8M8 12h5" />
        </>
      );
    case 'port':
      return (
        <>
          <path d="M12 3v13M8.5 6.5h7M8.5 16c-2.6 0-4.5-1.2-5.5-3.1M15.5 16c2.6 0 4.5-1.2 5.5-3.1" />
          <path d="M7.5 13.5h9l-1.5 5h-6Z" fill="currentColor" opacity=".78" />
          <path d="M5 20h14" />
        </>
      );
    case 'trophy':
      return (
        <>
          <path d="M8 4h8v4.5c0 3-1.6 5-4 5s-4-2-4-5Z" fill="currentColor" opacity=".78" />
          <path d="M8 6H4.5v1.5c0 2.5 1.4 4 4 4M16 6h3.5v1.5c0 2.5-1.4 4-4 4M12 14v4M8.5 20h7M10 18h4" />
        </>
      );
    case 'endTurn':
      return (
        <>
          <path d="M19 8a7 7 0 1 0 1 6" fill="none" strokeWidth="2" />
          <path d="m19 4 1 4-4 1" fill="none" strokeWidth="2" />
        </>
      );
    case 'compass':
      return (
        <>
          <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".3" />
          <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4Z" fill="currentColor" opacity=".85" />
          <circle cx="12" cy="12" r="8" />
        </>
      );
    case 'players':
      return (
        <>
          <circle cx="9" cy="8" r="3" fill="currentColor" opacity=".75" />
          <circle cx="16.5" cy="9.5" r="2.4" fill="currentColor" opacity=".5" />
          <path d="M3.5 19c.3-3.4 2.1-5.2 5.5-5.2s5.2 1.8 5.5 5.2M14 14.8c3.5-.9 5.8.7 6.4 4.2" />
        </>
      );
    case 'yearOfPlenty':
      return (
        <>
          <path d="M12 20c0-6.2 2.8-10.2 7.5-12.5C19.2 13.5 16 17.5 12 20Z" fill="currentColor" opacity=".75" />
          <path d="M12 20C11.4 14.2 8.2 10 3.5 8.3 4.3 14.7 7.8 18.5 12 20Z" fill="currentColor" opacity=".45" />
          <path d="M12 20V7" />
        </>
      );
    case 'monopoly':
      return (
        <>
          <circle cx="12" cy="12" r="7.5" fill="currentColor" opacity=".78" />
          <path d="M9.5 9.5h5M10 14.5h4M12 8v8" stroke="var(--bg-primary)" />
        </>
      );
    case 'turnOrder':
      return (
        <>
          <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".78" />
          <path d="M10 9.2c.8-.8 2.5-.8 3.2.1.8 1-.1 1.8-1 2.5l-2.3 2h3.6" stroke="var(--bg-primary)" />
        </>
      );
    case 'close':
      return <path d="m6 6 12 12M18 6 6 18" strokeWidth="2.2" />;
    case 'unknown':
    default:
      return (
        <>
          <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".25" />
          <path d="M9.7 9.2a2.5 2.5 0 1 1 4.1 1.9c-1.2 1-1.8 1.3-1.8 2.7M12 17h.1" strokeWidth="2" />
        </>
      );
  }
}

export function GameIconSymbol({ name = 'unknown', size = 24, x = 0, y = 0, className = '', ...props }) {
  const scale = Number.parseFloat(size) / 24 || 1;
  const resolved = resolveName(name);
  const classes = ['game-icon-symbol', `game-icon-symbol--${resolved}`, className].filter(Boolean).join(' ');
  return (
    <g
      className={classes}
      transform={`translate(${Number(x) - 12 * scale} ${Number(y) - 12 * scale}) scale(${scale})`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {iconShape(resolved)}
    </g>
  );
}

export default function GameIcon({ name = 'unknown', size = 20, className = '', title, ariaLabel, ariaHidden, ...props }) {
  const resolved = resolveName(name);
  const hidden = ariaHidden === undefined ? !title && !ariaLabel : ariaHidden;
  const label = ariaLabel || title;
  return (
    <svg
      className={['game-icon', `game-icon--${resolved}`, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label && !hidden ? 'img' : undefined}
      aria-label={label && !hidden ? label : undefined}
      aria-hidden={hidden ? 'true' : undefined}
      focusable="false"
      {...props}
    >
      {title && !hidden && <title>{title}</title>}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconShape(resolved)}
      </g>
    </svg>
  );
}
