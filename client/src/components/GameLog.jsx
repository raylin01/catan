import {useEffect, useRef, useState} from 'react';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import './GameLog.css';

const EVENT_ICONS = {placeShip:'ship',moveShip:'ship',movePirate:'pirate',placePort:'port',resolveSeafarersChoice:'compass',claimWonder:'wonder',buildWonder:'wonder',attackFortress:'fortress',rollDice: 'dice', placeSettlement: 'settlement', placeRoad: 'road', upgradeToCity: 'city', moveRobber: 'robber', stealResource: 'robber', discardResources: 'cards', bankTrade: 'bank', proposeTrade: 'trade', acceptTrade: 'trade', executeTrade: 'trade', tradeConfirm: 'trade', tradeOffer: 'trade', tradeCounter: 'trade', tradeAccept: 'trade', tradeReject: 'trade', tradeCancel: 'trade', buyDevelopmentCard: 'devCard', playDevelopmentCard: 'devCard', endTurn: 'compass', start: 'players'};

const isTrade = event => event.type?.startsWith('trade') || event.type === 'bankTrade';

function LogBundle({value}) {
  return <div className="log-bundle">{Object.entries(value || {}).filter(([,count]) => count > 0).map(([card,count]) =>
    <span key={card}><CardArtwork name={card}/><strong>{count}</strong> {card}</span>)}</div>;
}

// Details come exclusively from the server's public event projection.
export function EventDetails({event,players=[]}) {
  const trade = event.details?.trade, bank = event.details?.bankTrade, dice = event.details?.dice;
  const playerName = id => players.find(player => player.id === id)?.name || 'Player';
  if (trade) return <div className="log-trade-details">
    <div><h4>{trade.fromName || playerName(trade.from)} offers</h4><LogBundle value={trade.give}/></div>
    <div><h4>For {trade.toName || playerName(trade.to)}’s</h4><LogBundle value={trade.get}/></div>
  </div>;
  if (bank) return <div className="log-trade-details"><div><h4>Gave to bank</h4><LogBundle value={bank.give}/></div><div><h4>Received</h4><LogBundle value={bank.get}/></div></div>;
  if (dice) return <div className="log-dice" aria-label={`Dice: ${dice.die1} plus ${dice.die2} equals ${dice.total}`}><span>{dice.die1}</span> + <span>{dice.die2}</span> = <strong>{dice.total}</strong></div>;
  return null;
}

export default function GameLog({events=[], players=[]}) {
  const [open, setOpen] = useState(false), [filter,setFilter] = useState('all');
  const root = useRef(null), toggle = useRef(null), panel = useRef(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector('button')?.focus();
    const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const close = () => { setOpen(false); toggle.current?.focus(); };
  const shown = events.filter(event => filter === 'all' || (filter === 'trades' ? isTrade(event) : event.type === 'rollDice'));
  return <div className="game-log" ref={root}>
    <button type="button" ref={toggle} className="game-log-toggle" aria-label="Game log" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} title="Game log"><GameIcon name="history" size={17}/><span>Log</span></button>
    {open && <section ref={panel} className="game-log-panel" role="dialog" aria-label="Game log">
      <header><h2>Game log</h2><button type="button" aria-label="Close game log" onClick={close}><GameIcon name="close" size={17}/></button></header>
      <nav className="game-log-filters" aria-label="Filter game log">{['all','trades','rolls'].map(value => <button key={value} type="button" aria-pressed={value === filter} onClick={() => setFilter(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
      <ol className="game-log-events" tabIndex={0} aria-label="Recent game events">
        {!shown.length && <li className="game-log-empty">{filter === 'all' ? 'Moves will appear here as the game progresses.' : `No ${filter} in the recent log.`}</li>}
        {shown.slice().reverse().map((event, index) => {
          const actor = players.find(player => player.id === event.actor)?.name || 'Game';
          const time = event.at && new Date(event.at);
          const validTime = time && Number.isFinite(time.getTime());
          const summary = event.summary || `${actor} ${event.type}`;
          const expandable = event.details?.trade || event.details?.bankTrade;
          return <li key={event.id || `${event.at}-${event.type}-${index}`}>
            <GameIcon name={EVENT_ICONS[event.type] || 'history'} size={19}/>
            <div className="game-log-copy">{expandable ? <details><summary>{summary}</summary><EventDetails event={event} players={players}/></details> : <><span>{summary}</span>{event.details?.dice&&<EventDetails event={event} players={players}/>}</>}</div>
            {validTime && <time dateTime={time.toISOString()}>{time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>}
          </li>;
        })}
      </ol>
    </section>}
  </div>;
}
