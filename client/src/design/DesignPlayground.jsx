import {useCallback, useMemo, useRef, useState} from 'react';
import GameBoard from '../components/GameBoard';
import CardReveal from '../components/CardReveal';
import DevCardModal from '../components/DevCardModal';
import RoomTradePanel from '../components/RoomTradePanel';
import {PresentationControls, useGamePresentation} from '../presentation/GamePresentation';
import {
  CITY_TARGETS,
  DESIGN_SLOTS,
  INITIAL_EVENTS,
  ROAD_TARGETS,
  ROBBER_TARGETS,
  SETTLEMENT_TARGETS,
  cloneFixture,
  createFixture,
  isPhysicalEdgeEmpty,
  isPhysicalSettlement,
  isPhysicalVertexEmpty,
  legalActionsFor,
  setPhysicalEdge,
  setPhysicalVertex
} from './fixture';

const DEVELOPMENT_CARDS = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];
const RESOURCE_KEYS = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function createSyntheticSocket(commandRef) {
  const listeners = new Map();
  return {
    on(event, listener) {
      const bucket = listeners.get(event) || new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    off(event, listener) {
      if (!listener) listeners.get(event)?.clear();
      else listeners.get(event)?.delete(listener);
    },
    emit(event, payload, callback) {
      let body = payload;
      let done = callback;
      if (typeof payload === 'function') {
        done = payload;
        body = {};
      }
      if (event === 'getPlayersOnHex') {
        done?.({success: true, players: []});
        return;
      }
      Promise.resolve(commandRef.current?.(event, body || {}) || {success: false, error: `Synthetic adapter does not implement ${event}.`})
        .then(result => done?.(result));
    }
  };
}

export default function DesignPlayground() {
  const [sceneryPreview,setSceneryPreview]=useState(false);
  const {playSound, soundEnabled, toggleSound}=useGamePresentation();
  const [view, setView] = useState('play');
  const [game, setGame] = useState(() => createFixture('play'));
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [cardEvents, setCardEvents] = useState([]);
  const [rollEvent, setRollEvent] = useState(null);
  const [robberPick, setRobberPick] = useState(null);
  const [trade, setTrade] = useState(null);
  const [messages, setMessages] = useState([
    {id: 'sample-chat-1', playerId: 'seat-b', playerName: 'Mara', playerColor: '#3f82b5', message: 'I can offer wool for grain.', timestamp: '2026-09-12T19:00:11.000Z'},
    {id: 'sample-chat-2', playerId: 'seat-a', playerName: 'Ada', playerColor: '#d9584f', message: 'Let me build this road first.', timestamp: '2026-09-12T19:00:17.000Z'}
  ]);
  const [notifications, setNotifications] = useState([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [presentationKey, setPresentationKey] = useState(0);
  const [revealedCard, setRevealedCard] = useState(null);
  const [showHand, setShowHand] = useState(false);
  const sequence = useRef(10);
  const roadIndex = useRef(0);
  const settlementIndex = useRef(0);
  const cityIndex = useRef(0);
  const robberIndex = useRef(0);
  const devIndex = useRef(0);
  const commandRef = useRef(null);
  const socket = useMemo(() => createSyntheticSocket(commandRef), []);

  const nextId = useCallback(prefix => `${prefix}-${++sequence.current}`, []);
  const addNotification = useCallback(message => {
    const id = nextId('notice');
    setNotifications(current => [...current.slice(-3), {id, message}]);
    window.setTimeout(() => setNotifications(current => current.filter(item => item.id !== id)), 4200);
  }, [nextId]);
  const addEvent = useCallback((type, summary, actor = 'seat-a') => {
    setEvents(current => [...current.slice(-14), {
      id: nextId('event'),
      type,
      actor,
      at: new Date().toISOString(),
      summary
    }]);
  }, [nextId]);

  const ensurePlay = useCallback((mutator, keepSpectator = false) => {
    if (view !== 'play' && !(keepSpectator && view === 'spectator')) {
      setView('play');
      setPresentationKey(value => value + 1);
    }
    setGame(current => {
      const next = current.myIndex < 0 || current.phase !== 'playing' ? createFixture('play') : cloneFixture(current);
      next.phase = 'playing';
      next.myIndex = 0;
      next.currentPlayerIndex = 0;
      next.turnPhase = 'main';
      next.discardingPlayers = [];
      mutator?.(next);
      return next;
    });
  }, [view]);

  const switchView = useCallback(nextView => {
    setView(nextView);
    setGame(createFixture(nextView === 'spectator' ? 'play' : nextView));
    setEvents(INITIAL_EVENTS);
    setCardEvents([]);
    setRollEvent(null);
    setRobberPick(null);
    setTrade(null);
    setRevealedCard(null);
    setShowHand(false);
    setPresentationKey(value => value + 1);
  }, []);

  const rollAndDraw = useCallback(() => {
    const id = nextId('roll');
    const roll = sequence.current % 2 ? {die1: 2, die2: 6, total: 8} : {die1: 4, die2: 5, total: 9};
    ensurePlay(next => {
      next.diceRoll = roll;
      next.players[0].resources.grain += 2;
      next.players[0].resources.wool += 1;
      if (typeof next.players[2].resources === 'number') next.players[2].resources += 2;
    }, true);
    setRollEvent({id, roll, gains: {grain: 2, wool: 1}});
    setCardEvents(current => [...current, {
      id: nextId('cards'), type: 'rollDice', rollId: id,
      transfers: [
        {from: 'bank', to: 'seat-a', resource: 'grain', count: 2},
        {from: 'bank', to: 'seat-a', resource: 'wool', count: 1},
        {from: 'bank', to: 'seat-c', count: 2}
      ]
    }]);
    addEvent('rollDice', `Ada rolled ${roll.total} and drew three resources`);
  }, [addEvent, ensurePlay, nextId]);

  const placeRoad = useCallback((requestedKey) => {
    const target = requestedKey || ROAD_TARGETS.find((key, index) => index >= roadIndex.current && isPhysicalEdgeEmpty(game.edges, key)) || ROAD_TARGETS.find(key => isPhysicalEdgeEmpty(game.edges, key));
    if (!target || !isPhysicalEdgeEmpty(game.edges, target)) {
      addNotification('All synthetic road locations are occupied. Reset to run them again.');
      return {success: false, error: 'No empty synthetic road location remains.'};
    }
    roadIndex.current = ROAD_TARGETS.indexOf(target) + 1;
    const mutate = next => {
      setPhysicalEdge(next.edges, target, {road: true, owner: 0});
      next.players[0].roads = Math.max(0, next.players[0].roads - 1);
    };
    if (requestedKey && view === 'setup') setGame(current => { const next = cloneFixture(current); mutate(next); return next; });
    else ensurePlay(mutate, true);
    addEvent('placeRoad', 'Ada placed a road on the synthetic board');
    return {success: true};
  }, [addEvent, addNotification, ensurePlay, game.edges, view]);

  const buildSettlement = useCallback((requestedKey) => {
    const target = requestedKey || SETTLEMENT_TARGETS.find((key, index) => index >= settlementIndex.current && isPhysicalVertexEmpty(game.vertices, key)) || SETTLEMENT_TARGETS.find(key => isPhysicalVertexEmpty(game.vertices, key));
    if (!target || !isPhysicalVertexEmpty(game.vertices, target)) {
      addNotification('All synthetic settlement locations are occupied. Reset to run them again.');
      return {success: false, error: 'No empty synthetic settlement location remains.'};
    }
    settlementIndex.current = SETTLEMENT_TARGETS.indexOf(target) + 1;
    const mutate = next => {
      setPhysicalVertex(next.vertices, target, {building: 'settlement', owner: 0});
      next.players[0].settlements = Math.max(0, next.players[0].settlements - 1);
      next.players[0].victoryPoints += 1;
      if (view === 'setup') next.setupAction = {settlement: target};
    };
    if (requestedKey && view === 'setup') setGame(current => { const next = cloneFixture(current); mutate(next); return next; });
    else ensurePlay(mutate, true);
    addEvent('placeSettlement', 'Ada built a settlement');
    return {success: true};
  }, [addEvent, addNotification, ensurePlay, game.vertices, view]);

  const upgradeCity = useCallback((requestedKey) => {
    const target = requestedKey || CITY_TARGETS.find((key, index) => index >= cityIndex.current && isPhysicalSettlement(game.vertices, key, 0)) || CITY_TARGETS.find(key => isPhysicalSettlement(game.vertices, key, 0));
    if (!target || !isPhysicalSettlement(game.vertices, target, 0)) {
      addNotification('All synthetic settlements have been upgraded. Reset to run them again.');
      return {success: false, error: 'No synthetic settlement remains to upgrade.'};
    }
    cityIndex.current = CITY_TARGETS.indexOf(target) + 1;
    ensurePlay(next => {
      setPhysicalVertex(next.vertices, target, {building: 'city', owner: 0});
      next.players[0].cities = Math.max(0, next.players[0].cities - 1);
      next.players[0].settlements += 1;
      next.players[0].victoryPoints += 1;
    }, true);
    addEvent('upgradeToCity', 'Ada upgraded a settlement to a city');
    return {success: true};
  }, [addEvent, addNotification, ensurePlay, game.vertices]);

  const moveRobber = useCallback((requestedKey) => {
    let target = requestedKey || ROBBER_TARGETS[robberIndex.current++ % ROBBER_TARGETS.length];
    ensurePlay(next => {
      if (target === next.robber) target = ROBBER_TARGETS[(robberIndex.current++) % ROBBER_TARGETS.length];
      next.robber = target;
    }, true);
    addEvent('moveRobber', 'Ada moved the robber');
    return {success: true};
  }, [addEvent, ensurePlay]);

  const showDiscard = useCallback(() => {
    ensurePlay(next => {
      next.turnPhase = 'discard';
      next.discardingPlayers = [{playerIndex: 0, cardsToDiscard: 3}];
    });
    addEvent('rollDice', 'A seven requires Ada to discard three cards');
  }, [addEvent, ensurePlay]);

  const showPlayerTrade = useCallback(() => {
    const id = nextId('trade');
    const offer = {id, status: 'offered', from: 1, to: 0, offer: {wool: 2}, request: {grain: 1}};
    const roomTrade = {id, status: 'offered', from: 'seat-b', to: 'seat-a', give: {wool: 2}, get: {grain: 1}};
    ensurePlay(next => { next.tradeOffer = offer; });
    setTrade(roomTrade);
    addEvent('tradeOffer', 'Mara offered Ada two wool for one grain', 'seat-b');
  }, [addEvent, ensurePlay, nextId]);

  const showDevelopmentCard = useCallback(() => {
    const cardType = DEVELOPMENT_CARDS[devIndex.current++ % DEVELOPMENT_CARDS.length];
    const id = nextId('development');
    ensurePlay(next => { next.players[0].newDevCards = [...(next.players[0].newDevCards || []), cardType]; }, true);
    setCardEvents(current => [...current, {id, type: 'buyDevCard', transfers: [{from: 'bank', to: 'seat-a', resource: 'development', count: 1}]}]);
    if (view !== 'spectator') setRevealedCard({id, cardType});
    addEvent('buyDevCard', 'Ada drew a development card');
  }, [addEvent, ensurePlay, nextId, view]);

  const showRobberPick = useCallback(() => {
    const id = nextId('robber-pick');
    ensurePlay(next => { next.turnPhase = 'robberPick'; });
    setRobberPick({
      id,
      victimId: 'seat-b',
      cardIds: Array.from({length: 8}, () => nextId('opaque-card'))
    });
    addEvent('robberPick', 'Ada is choosing one face-down card from Mara');
  }, [addEvent, ensurePlay, nextId]);

  const reset = useCallback(() => {
    roadIndex.current = 0;
    settlementIndex.current = 0;
    cityIndex.current = 0;
    robberIndex.current = 0;
    devIndex.current = 0;
    switchView('play');
    addNotification('Synthetic table reset.');
  }, [addNotification, switchView]);

  const issueCommand = useCallback(async (type, payload = {}) => {
    switch (type) {
      case 'rollDice':
        rollAndDraw();
        return {success: true, roll: {die1: 2, die2: 6, total: 8}};
      case 'placeRoad': return placeRoad(payload.edgeKey);
      case 'placeSettlement': return buildSettlement(payload.vertexKey);
      case 'upgradeToCity': return upgradeCity(payload.vertexKey);
      case 'moveRobber': return moveRobber(payload.hexKey);
      case 'chooseRobberCard':
        setCardEvents(current => [...current, {
          id: nextId('robber-card'),
          type: 'chooseRobberCard',
          transfers: [{from: 'seat-b', to: 'seat-a', count: 1}]
        }]);
        setRobberPick(null);
        ensurePlay(next => { next.turnPhase = 'main'; });
        addEvent('chooseRobberCard', 'Ada took one face-down card from Mara');
        return {success: true};
      case 'discardCards': {
        const transfers = Object.entries(payload.resources || {}).filter(([, count]) => count > 0).map(([resource, count]) => ({from: 'seat-a', to: 'bank', resource, count}));
        ensurePlay(next => {
          for (const {resource, count} of transfers) next.players[0].resources[resource] = Math.max(0, next.players[0].resources[resource] - count);
        });
        setCardEvents(current => [...current, {id: nextId('discard'), type: 'discardCards', transfers}]);
        addEvent('discardCards', 'Ada discarded three cards');
        return {success: true};
      }
      case 'buyDevCard': {
        const cardType = DEVELOPMENT_CARDS[devIndex.current++ % DEVELOPMENT_CARDS.length];
        ensurePlay(next => { next.players[0].newDevCards.push(cardType); });
        setCardEvents(current => [...current, {id: nextId('development'), type: 'buyDevCard', transfers: [{from: 'bank', to: 'seat-a', resource: 'development', count: 1}]}]);
        return {success: true, card: cardType};
      }
      case 'playDevCard':
        ensurePlay(next => {
          const index = next.players[0].developmentCards.indexOf(payload.cardType);
          if (index >= 0) next.players[0].developmentCards.splice(index, 1);
          if (payload.cardType === 'knight') next.turnPhase = 'robber';
          if (payload.cardType === 'roadBuilding') next.freeRoads = 2;
          if (payload.cardType === 'yearOfPlenty') next.yearOfPlentyPicks = 2;
        });
        addEvent('playDevCard', `Ada played ${payload.cardType}`);
        return {success: true};
      case 'yearOfPlentyPick':
        ensurePlay(next => {
          next.players[0].resources[payload.resource] += 1;
          next.yearOfPlentyPicks = Math.max(0, next.yearOfPlentyPicks - 1);
        });
        return {success: true};
      case 'bankTrade':
        ensurePlay(next => {
          next.players[0].resources[payload.giveResource] -= payload.giveAmount;
          next.players[0].resources[payload.getResource] += 1;
        });
        setCardEvents(current => [...current, {id: nextId('bank-trade'), type: 'bankTrade', transfers: [
          {from: 'seat-a', to: 'bank', resource: payload.giveResource, count: payload.giveAmount},
          {from: 'bank', to: 'seat-a', resource: payload.getResource, count: 1}
        ]}]);
        return {success: true};
      case 'tradeAccept':
        setTrade(current => current ? {...current, status: 'accepted'} : current);
        setGame(current => ({...current, tradeOffer: current.tradeOffer ? {...current.tradeOffer, status: 'accepted'} : null}));
        return {success: true};
      case 'tradeConfirm':
        setCardEvents(current => [...current, {id: nextId('player-trade'), type: 'tradeConfirm', transfers: [
          {from: 'seat-b', to: 'seat-a', resource: 'wool', count: 2},
          {from: 'seat-a', to: 'seat-b', resource: 'grain', count: 1}
        ]}]);
        setTrade(null);
        setGame(current => ({...current, tradeOffer: null}));
        addEvent('tradeConfirm', 'Ada and Mara completed their trade');
        return {success: true};
      case 'tradeReject':
      case 'tradeCancel':
        setTrade(null);
        setGame(current => ({...current, tradeOffer: null}));
        return {success: true};
      case 'tradeCounter': {
        const id = nextId('counter');
        setTrade({id, status: 'offered', from: 'seat-a', to: payload.to || 'seat-b', give: payload.give, get: payload.get});
        setGame(current => ({...current, tradeOffer: {id, status: 'offered', from: 0, to: 1, offer: payload.give, request: payload.get}}));
        return {success: true};
      }
      case 'tradeOffer': {
        const id = nextId('trade');
        setTrade({id, status: 'offered', from: 'seat-a', to: payload.to, give: payload.give, get: payload.get});
        return {success: true};
      }
      case 'chatMessage': {
        const message = {id: nextId('chat'), playerId: 'seat-a', playerName: 'Ada', playerColor: '#d9584f', message: payload.message, timestamp: new Date().toISOString()};
        setMessages(current => [...current, message]);
        return {success: true};
      }
      case 'finishFreeRoads':
        ensurePlay(next => { next.freeRoads = 0; });
        return {success: true};
      case 'advanceSetup':
        switchView('play');
        return {success: true};
      case 'endTurn':
        setGame(current => ({...current, currentPlayerIndex: (current.currentPlayerIndex + 1) % 4, turnPhase: 'roll'}));
        return {success: true};
      case 'shuffleBoard':
      case 'startGame':
      case 'endSpecialBuild':
        addNotification(`${type} is represented visually only in this playground.`);
        return {success: true};
      default:
        return {success: false, error: `${type} is outside this synthetic fixture.`};
    }
  }, [addEvent, addNotification, buildSettlement, ensurePlay, moveRobber, nextId, placeRoad, rollAndDraw, switchView, upgradeCity]);
  commandRef.current = issueCommand;

  const snapshot = useMemo(() => ({
    code: 'SAMPLE',
    paused: false,
    slots: DESIGN_SLOTS,
    trade
  }), [trade]);
  const tradePanel = useCallback((onClose, mode) => <RoomTradePanel
    mode={mode}
    snapshot={snapshot}
    gameState={game}
    seatId={game.myIndex >= 0 ? game.players[game.myIndex]?.id : null}
    onCommand={issueCommand}
    onClose={onClose}
    addNotification={addNotification}
  />, [addNotification, game, issueCommand, snapshot]);

  const legalActions = useMemo(() => legalActionsFor(view, game), [game, view]);
  // The fixture keeps a canonical state so observer scenarios can accumulate.
  // Give GameBoard the same concealed shape that a live spectator receives.
  const spectator = view === 'spectator';
  const displayedGame = useMemo(() => {
    if (!spectator) return game;
    const projected = cloneFixture(game);
    projected.myIndex = -1;
    projected.players.forEach(player => {
      if (typeof player.resources === 'object') player.resources = Object.values(player.resources).reduce((sum, count) => sum + count, 0);
      if (Array.isArray(player.developmentCards)) player.developmentCards = player.developmentCards.length;
      if (Array.isArray(player.newDevCards)) player.newDevCards = player.newDevCards.length;
      player.hiddenVictoryPoints = 0;
    });
    return projected;
  }, [game, spectator]);
  const displayedCardEvents = useMemo(() => spectator ? cardEvents.map(event => {
    const grouped = new Map();
    event.transfers.forEach(({from, to, count, resource}) => {
      const development = resource === 'development';
      const key = `${from}:${to}:${development ? 'development' : 'resource'}`;
      grouped.set(key, {from, to, count: count + (grouped.get(key)?.count || 0), ...(development ? {resource} : {})});
    });
    return {...event, transfers: [...grouped.values()]};
  }) : cardEvents, [cardEvents, spectator]);
  const activePlayer = displayedGame.myIndex >= 0 ? displayedGame.players[displayedGame.myIndex] : null;

  return <main className="design-playground">
    <details className="design-toolbar">
      <summary><span>Design preview <small>· synthetic game</small></span><span>Test controls</span></summary>
      <div className="design-controls">
      <div className="design-toolbar-heading">
        <div>
          <p>Development only</p>
          <h1>Design playground <span>· synthetic sample</span></h1>
        </div>
        <p className="design-safety-note">Local fixture only · no server, room, database, player, or AI access</p>
      </div>

      <div className="design-toolbar-row" role="group" aria-label="Table view">
        <span className="design-group-label">View</span>
        <button type="button" aria-pressed={view === 'play'} onClick={() => switchView('play')}>Main play</button>
        <button type="button" aria-pressed={view === 'setup'} onClick={() => switchView('setup')}>Setup</button>
        <button type="button" aria-pressed={view === 'spectator'} onClick={() => switchView('spectator')}>Spectator</button>
        <button type="button" aria-pressed={view === 'hands'} onClick={() => switchView('hands')}>All hands</button>
        <button type="button" disabled={!activePlayer} onClick={() => setShowHand(true)}>Open dev hand</button>
        <button type="button" onClick={()=>setSceneryPreview(true)}>Scenery preview</button>
        <label className="design-speed">Motion speed
          <select value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
        </label>
      </div>

      <div className="design-toolbar-row design-scenarios" role="group" aria-label="Synthetic presentation scenarios">
        <span className="design-group-label">Motion</span>
        <button type="button" onClick={rollAndDraw}>Roll &amp; draw</button>
        <button type="button" onClick={() => placeRoad()}>Place road</button>
        <button type="button" onClick={() => buildSettlement()}>Build settlement</button>
        <button type="button" onClick={() => upgradeCity()}>Upgrade city</button>
        <button type="button" onClick={() => moveRobber()}>Move robber</button>
        <button type="button" onClick={showRobberPick}>Choose robber card</button>
        <button type="button" onClick={showDiscard}>Discard</button>
        <button type="button" onClick={showPlayerTrade}>Player trade</button>
        <button type="button" onClick={showDevelopmentCard}>Development card</button>
        <button type="button" onClick={()=>setMessages(current=>[...current,...Array.from({length:8},(_,i)=>({id:nextId('sample-chat'),playerId:'seat-b',playerName:'Mara',playerColor:'#3f82b5',message:['I can offer wool for grain.','Does anyone have a brick to trade?','I am saving for a settlement.','Two wool for one grain?'][i%4],timestamp:new Date().toISOString()}))])}>Chat activity</button>
        <button type="button" className="design-reset" onClick={reset}>Reset</button>
      </div>
      <div className="design-toolbar-row" role="group" aria-label="Sound previews">
        <span className="design-group-label">Sound</span>
        <button type="button" onClick={toggleSound} aria-pressed={soundEnabled}>{soundEnabled ? 'Mute sound' : 'Enable sound'}</button>
        <button type="button" disabled={!soundEnabled} onClick={()=>playSound('dice')}>Dice sound</button>
        <button type="button" disabled={!soundEnabled} onClick={()=>playSound('card')}>Card draw sound</button>
        <button type="button" disabled={!soundEnabled} onClick={()=>playSound('cardGroup')}>Card handling sound</button>
        <button type="button" disabled={!soundEnabled} onClick={()=>playSound('shuffle')}>Card shuffle sound</button>
        <button type="button" disabled={!soundEnabled} onClick={()=>playSound('piece')}>Piece sound</button>
      </div>
    <aside className="design-limitations" aria-label="Simulation limits">
      <strong>Synthetic behavior:</strong> visual states and receipts are deterministic, but placement legality, bank totals, victory checks, multi-seat trade handoff, remote controllers, persistence, replay authorization, and network recovery are not simulated here.
    </aside>

      </div>
    </details>

    {sceneryPreview&&<div className="design-scenery-controls"><button type="button" onClick={()=>setSceneryPreview(false)}>Back to game</button><PresentationControls/></div>}
    <section className={`design-stage room-app ${sceneryPreview?'is-scenery-preview':''}`} aria-label={`Synthetic ${view} table`}>
      <GameBoard
        key={`design-${presentationKey}`}
        socket={socket}
        gameState={displayedGame}
        playerId={activePlayer?.id || null}
        gameCode="SAMPLE"
        chatMessages={messages}
        onLeaveGame={() => addNotification('Leave is disabled in the synthetic playground.')}
        addNotification={addNotification}
        legalActions={legalActions}
        events={events}
        rollEvent={spectator && rollEvent ? {id: rollEvent.id, roll: rollEvent.roll} : rollEvent}
        cardEvents={displayedCardEvents}
        slots={DESIGN_SLOTS}
        robberPick={robberPick}
        paused={false}
        tradePanel={tradePanel}
        playbackRate={playbackRate}
        presentationKey={`design-${presentationKey}`}
        replay={view === 'hands' ? {
          speed: playbackRate,
          playing: true,
          resetKey: `design-hands-${presentationKey}`,
          perspective: 'omniscient',
          allowedSeatIds: DESIGN_SLOTS.map(slot => slot.id),
          inspector: <div className="design-replay-inspector"><strong>All four private hands</strong><span>Synthetic omniscient replay frame</span></div>
        } : null}
      />
    </section>

    <div className="design-notifications" aria-live="polite">
      {notifications.map(item => <div key={item.id}>{item.message}</div>)}
    </div>

    {revealedCard && <CardReveal key={revealedCard.id} cardType={revealedCard.cardType} onClose={() => setRevealedCard(null)} />}
    {showHand && activePlayer && <DevCardModal
      socket={socket}
      myPlayer={activePlayer}
      isMyTurn={game.currentPlayerIndex === game.myIndex}
      turnPhase={game.turnPhase}
      yearOfPlentyPicks={game.yearOfPlentyPicks}
      onClose={() => setShowHand(false)}
      addNotification={addNotification}
    />}
  </main>;
}
