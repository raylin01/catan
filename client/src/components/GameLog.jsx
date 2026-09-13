import {useEffect, useRef, useState} from 'react';
import GameIcon from './GameIcon';
import './GameLog.css';

const EVENT_ICONS = {placeShip:'ship',moveShip:'ship',movePirate:'pirate',placePort:'port',resolveSeafarersChoice:'compass',claimWonder:'wonder',buildWonder:'wonder',attackFortress:'fortress',rollDice: 'dice', placeSettlement: 'settlement', placeRoad: 'road', upgradeToCity: 'city', moveRobber: 'robber', stealResource: 'robber', discardResources: 'cards', bankTrade: 'bank', proposeTrade: 'trade', acceptTrade: 'trade', executeTrade: 'trade', tradeConfirm: 'trade', tradeOffer: 'trade', tradeAccept: 'trade', tradeReject: 'trade', tradeCancel: 'trade', buyDevelopmentCard: 'devCard', playDevelopmentCard: 'devCard', endTurn: 'compass', start: 'players'};

export default function GameLog({events, players}) {
  const [open, setOpen] = useState(false);
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
  return <div className="game-log" ref={root}>
    <button type="button" ref={toggle} className="game-log-toggle" aria-label="Game log" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} title="Game log"><GameIcon name="history" size={17}/><span>Log</span></button>
    {open && <section ref={panel} className="game-log-panel" role="dialog" aria-label="Game log">
      <header><h2>Game log</h2><button type="button" aria-label="Close game log" onClick={close}><GameIcon name="close" size={17}/></button></header>
      <ol className="game-log-events" tabIndex={0} aria-label="Recent game events">
        {!events.length && <li className="game-log-empty">Moves will appear here as the game progresses.</li>}
        {events.slice().reverse().map((event, index) => {
          const actor = players.find(player => player.id === event.actor)?.name || event.actor || 'Game';
          const time = event.at && new Date(event.at);
          const validTime = time && Number.isFinite(time.getTime());
          return <li key={event.id || `${event.at}-${event.type}-${index}`}>
            <GameIcon name={EVENT_ICONS[event.type] || 'history'} size={19}/>
            <span>{event.summary || `${actor} ${event.type}`}</span>
            {validTime && <time dateTime={time.toISOString()}>{time.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>}
          </li>;
        })}
      </ol>
    </section>}
  </div>;
}
