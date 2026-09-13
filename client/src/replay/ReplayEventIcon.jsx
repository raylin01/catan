import GameIcon from '../components/GameIcon';

export const REPLAY_EVENT_ICONS = {
  'victory-point': 'trophy',
  'longest-road': 'road',
  'largest-army': 'knight',
  robber: 'robber',
  turn: 'dice',
  win: 'trophy',
  trade: 'trade',
  bank: 'bank',
  city: 'city',
  settlement: 'settlement',
  cards: 'cards',
  chat: 'chat',
  lobbyCreated: 'players',
  join: 'players',
  configureSeat: 'players',
  removeController: 'players',
  ready: 'turnOrder',
  start: 'turnOrder',
  startGame: 'turnOrder',
  advanceSetup: 'settlement',
  rollDice: 'dice',
  discardCards: 'cards',
  moveRobber: 'robber',
  chooseRobberCard: 'robber',
  placeRoad: 'road',
  placeShip:'ship',
  moveShip:'ship',
  movePirate:'pirate',
  placePort:'port',
  resolveSeafarersChoice:'compass',
  claimWonder:'wonder',
  buildWonder:'wonder',
  attackFortress:'fortress',
  pirate:'pirate',
  ship:'ship',
  wonder:'wonder',
  fortress:'fortress',
  exploration:'compass',
  cloth:'cloth',
  finishFreeRoads: 'road',
  placeSettlement: 'settlement',
  upgradeToCity: 'city',
  buyDevCard: 'cards',
  playDevCard: 'devCard',
  yearOfPlentyPick: 'yearOfPlenty',
  bankTrade: 'bank',
  tradeOffer: 'trade',
  tradeCounter: 'trade',
  tradeAccept: 'trade',
  tradeReject: 'trade',
  tradeConfirm: 'trade',
  tradeCancel: 'trade',
  aiChatReply: 'chat',
  leave: 'players',
  aiCancel: 'players',
  endTurn: 'endTurn',
  endGame: 'trophy',
  partialBaseline: 'compass',
  crashgap: 'compass'
};

const TRANSPORT_ICONS = new Set(['play', 'pause', 'restart', 'previous', 'next', 'cluster', 'ready']);
const TRANSPORT_ALIASES = {resume: 'play', aiPause: 'pause', aiResume: 'play', start: 'play', startGame: 'play'};

export function replayEventIconName(type) {
  return REPLAY_EVENT_ICONS[type] || 'unknown';
}

function TransportIcon({ type, size }) {
  const paths = {
    play: <path d="m9 6 9 6-9 6Z" fill="currentColor" />,
    pause: <><path d="M8 6v12M16 6v12" /><path d="M8 6h1v12H8zM15 6h1v12h-1z" fill="currentColor" /></>,
    restart: <><path d="M7 8H3V4" /><path d="M4 8a8 8 0 1 1 0 8" /></>,
    previous: <><path d="M7 5v14M18 6l-8 6 8 6Z" fill="currentColor" /></>,
    next: <><path d="M17 5v14M6 6l8 6-8 6Z" fill="currentColor" /></>,
    cluster: <><circle cx="7" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="7" r="2" fill="currentColor" /><circle cx="17" cy="12" r="2" fill="currentColor" /></>,
    ready: <><circle cx="12" cy="12" r="8" /><path d="m8 12 3 3 5-6" /></>
  };
  return <svg className={`replay-event-icon replay-event-icon--${type}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[type] || paths.cluster}</svg>;
}

export default function ReplayEventIcon({ type, size = 16 }) {
  const transportType = TRANSPORT_ALIASES[type] || type;
  if (TRANSPORT_ICONS.has(transportType)) return <TransportIcon type={transportType} size={size} />;
  return <GameIcon name={replayEventIconName(type)} size={size} className={`replay-event-icon replay-event-icon--${type}`} />;
}
