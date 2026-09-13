import {PresentationControls} from '../presentation/GamePresentation';
import { useState, useEffect, useCallback, useRef } from 'react';
import HexBoard from './HexBoard';
import GameIcon from './GameIcon';
import BuildingPiece from './BuildingPiece';
import PlayerPanel from './PlayerPanel';
import ResourceCards from './ResourceCards';
import ActionPanel from './ActionPanel';
import DiceDisplay from './DiceDisplay';
import Chat from './Chat';
import GameLog from './GameLog';
import {chatMessageKey, newChatMessages} from './chatMessages';
import DevCardModal from './DevCardModal';
import DiscardModal from './DiscardModal';
import CardMovements from './CardMovements';
import RobberPickModal from './RobberPickModal';
import CardReveal from './CardReveal';
import InfoPopup, { useInfoPopup, INFO_DATA } from './InfoPopup';
import Confetti from './Confetti';
import ReplayHand from '../replay/ReplayHand';
import './GameBoard.css';

function GameBoard({
  socket,
  gameState,
  playerId,
  gameCode,
  chatMessages,
  onLeaveGame,
  addNotification,
  legalActions = [],
  events = [],
  rollEvent = null,
  cardEvents = [],
  slots = [],
  robberPick = null,
  paused = false,
  tradePanel = null,
  replay = null,
  playbackRate = 1,
  presentationKey
}) {
  const isReplay = Boolean(replay);
  const motionRate = Math.max(.25, Math.min(8, Number(isReplay ? replay.speed : playbackRate) || 1));
  const [selectedAction, setSelectedAction] = useState(null); // 'settlement', 'road', 'city'
  const [lastPlacedSettlement, setLastPlacedSettlement] = useState(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeMode, setTradeMode] = useState('player');
  const [showDevCardModal, setShowDevCardModal] = useState(false);
  const [pendingRobberHex, setPendingRobberHex] = useState(null);
  const [playersOnHex, setPlayersOnHex] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [freshRoll, setFreshRoll] = useState(null);
  const rollIdentity = isReplay ? `replay:${replay.resetKey || replay.perspective || 'public'}` : `${gameCode}:${playerId}:${presentationKey || ''}`;
  const rollSeen = useRef({identity: rollIdentity, id: rollEvent?.id});
  const [revealedCard, setRevealedCard] = useState(null);
  const [lastTradeOfferId, setLastTradeOfferId] = useState(null);
  const [dismissedTradeId, setDismissedTradeId] = useState(null);

  const [lastNotifiedRoll, setLastNotifiedRoll] = useState(rollEvent?.id || (gameState.diceRoll ? `${gameState.diceRoll.die1}-${gameState.diceRoll.die2}-${gameState.productionPlayerIndex ?? gameState.currentPlayerIndex}` : null));
  const [unreadMessages, setUnreadMessages] = useState(0);
  const chatIdentity = `${gameCode}:${playerId}`;
  const chatCursor = useRef({identity: chatIdentity, key: null});
  
  // Info popup for right-click
  const { popup: infoPopup, showInfo, showHexInfo, closePopup: closeInfoPopup } = useInfoPopup();
  
  const myPlayer = gameState.myIndex >= 0 ? gameState.players[gameState.myIndex] : null;
  const currentPlayer = gameState.phase !== 'waiting' ? gameState.players[gameState.currentPlayerIndex] : null;
  const isMyTurn = gameState.phase !== 'waiting' && gameState.currentPlayerIndex === gameState.myIndex;
  const isSetup = gameState.phase === 'setup';
  const isWaiting = gameState.phase === 'waiting';
  const isHost = gameState.players[0]?.id === playerId;
  const needsToDiscard = gameState.phase === 'playing' && gameState.discardingPlayers?.some(
    d => d.playerIndex === gameState.myIndex
  );
  const isExtended = gameState.gameOptions?.extension56 === true || gameState.isExtended === true;
  const isPairedTurn = isExtended && gameState.turnRole === 'paired';
  const productionIndex = gameState.pairedTurnRules && Number.isInteger(gameState.productionPlayerIndex) ? gameState.productionPlayerIndex : gameState.currentPlayerIndex;
  const productionPlayer = gameState.players[productionIndex];
  const extraPlayer = isExtended ? gameState.players[(productionIndex + 3) % gameState.players.length] : null;
  const canBuildNow = isMyTurn;
  const setupSettlement = gameState.setupAction?.settlement || lastPlacedSettlement;

  // Setup state is authoritative on the server. Keep the local value only as
  // an optimistic fallback while the next room observation arrives.
  useEffect(() => {
    if (!isSetup) {
      setLastPlacedSettlement(null);
    } else if (gameState.setupAction?.settlement) {
      setLastPlacedSettlement(gameState.setupAction.settlement);
    }
  }, [gameState.setupAction?.settlement, isSetup]);

  // Polls can repeat the same snapshot. Only a new authoritative receipt
  // animates; initial hydration and seat changes establish a baseline.
  useEffect(() => {
    const identity = isReplay ? `replay:${replay.resetKey || replay.perspective || 'public'}` : `${gameCode}:${playerId}:${presentationKey || ''}`;
    if (rollSeen.current.identity !== identity) {
      rollSeen.current = {identity, id: rollEvent?.id};
      setFreshRoll(null);
      return;
    }
    if (isReplay && !replay.playing) {
      rollSeen.current.id = rollEvent?.id;
      setFreshRoll(null);
      return;
    }
    if (!rollEvent || rollSeen.current.id === rollEvent.id) return;
    rollSeen.current.id = rollEvent.id;
    setFreshRoll({...rollEvent, presentationIdentity: identity});
  }, [gameCode, isReplay, playerId, presentationKey, replay?.playing, replay?.perspective, replay?.resetKey, rollEvent?.id]);

  // Listen for steal notifications
  useEffect(() => {
    if (isReplay || !socket) return undefined;
    
    const handleStealResult = ({ type, resource, otherPlayer }) => {
      if (type === 'stole') {
        addNotification(` You stole ${resource} from ${otherPlayer}!`);
      } else {
        addNotification(` ${otherPlayer} stole ${resource} from you!`);
      }
    };
    
    socket.on('stealResult', handleStealResult);
    return () => socket.off('stealResult', handleStealResult);
  }, [isReplay, socket, addNotification]);

  // Track new chat messages for notification dot
  useEffect(() => {
    if (isReplay) return;
    if (chatCursor.current.identity !== chatIdentity) {
      chatCursor.current = {identity: chatIdentity, key: chatMessageKey(chatMessages.at(-1))};
      setUnreadMessages(0);
      return;
    }
    const incoming = newChatMessages(chatMessages, chatCursor.current.key);
    if (incoming.length) {
      // Only increment unread if chat is closed and message is from another player
      if (!showChat) {
        const otherPlayerMessages = incoming.filter(msg => msg.playerId !== playerId);
        if (otherPlayerMessages.length > 0) {
          setUnreadMessages(prev => prev + otherPlayerMessages.length);
        }
      }
    }
    chatCursor.current.key = chatMessageKey(chatMessages.at(-1));
  }, [chatMessages, isReplay, chatIdentity, showChat, playerId]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (showChat) {
      setUnreadMessages(0);
    }
  }, [showChat]);

  // Auto-open trade modal when there's a pending trade from another player
  useEffect(() => {
    if (isReplay) return;
    const tradeOffer = gameState.tradeOffer;
    const isTradeForMe = tradeOffer?.to === gameState.myIndex;
    
    // Create a unique ID for this trade to track if we've already shown it
    const tradeId = tradeOffer?.id || null;
    
    if (tradeOffer && gameState.turnRole !== 'paired' && gameState.playerTradingAllowed !== false && isTradeForMe && tradeId !== lastTradeOfferId) {
      // New trade from another player - auto open the modal
      setTradeMode('player');
      setShowTradeModal(true);
      setLastTradeOfferId(tradeId);
      setDismissedTradeId(null); // Reset dismissed state for new trade
      const traderName = gameState.players[tradeOffer.from]?.name || 'A player';
      addNotification(`${traderName} wants to trade with you!`);
    } else if (!tradeOffer) {
      // Trade was cancelled or completed - clear all trade state
      setLastTradeOfferId(null);
      setDismissedTradeId(null);
    }
  }, [gameState.tradeOffer, gameState.myIndex, gameState.players, gameState.turnRole, gameState.playerTradingAllowed, isReplay, lastTradeOfferId, addNotification]);

  // Auto-select action during setup
  useEffect(() => {
    if (isReplay) {
      setSelectedAction(null);
      return;
    }
    if (isSetup && isMyTurn) {
      const availableSetupActions = legalActions.filter(action => (
        action.type === 'placeSettlement' || action.type === 'placeRoad'
      ));
      if (availableSetupActions.some(action => action.type === 'placeSettlement')) {
        setSelectedAction('settlement');
      } else if (availableSetupActions.some(action => action.type === 'placeRoad')) {
        setSelectedAction('road');
      } else {
        setSelectedAction(null);
      }
    }
  }, [gameState, isReplay, isSetup, isMyTurn, legalActions]);

  useEffect(() => {
    if (!isSetup) setSelectedAction(null);
  }, [gameState.currentPlayerIndex, gameState.turnRole, isSetup]);

  useEffect(() => {
    if ((gameState.turnRole === 'paired' || gameState.playerTradingAllowed === false) && tradeMode === 'player') setShowTradeModal(false);
  }, [gameState.turnRole, gameState.playerTradingAllowed, tradeMode]);

  // Reset roll notification tracker when turn phase goes back to 'roll' (new turn)
  useEffect(() => {
    if (gameState.turnPhase === 'roll') {
      setLastNotifiedRoll(null);
    }
  }, [gameState.turnPhase]);

  // Handle dice roll notification (only for 7 - robber)
  useEffect(() => {
    if (isReplay) return;
    if (gameState.diceRoll && gameState.turnPhase !== 'roll') {
      // Create unique key for this roll to prevent duplicate notifications
      const rollKey = rollEvent?.id || `${gameState.diceRoll.die1}-${gameState.diceRoll.die2}-${productionIndex}`;
      
      // Only notify for 7 (robber) - regular rolls are shown in the dice display
      if (rollKey !== lastNotifiedRoll && gameState.diceRoll.total === 7) {
        const roller = productionPlayer;
        addNotification(`${roller.name} rolled a 7. ${gameState.turnPhase === "discard" ? "Players must discard before the robber moves." : "Move the robber."}`);
        setLastNotifiedRoll(rollKey);
      } else if (rollKey !== lastNotifiedRoll) {
        setLastNotifiedRoll(rollKey);
      }
    }
  }, [gameState.diceRoll, gameState.turnPhase, gameState.currentPlayerIndex, gameState.players, isReplay, lastNotifiedRoll, addNotification, rollEvent?.id, productionIndex, productionPlayer]);

  // Handle winner
  useEffect(() => {
    if (isReplay) return;
    if (gameState.winner) {
      const winner = gameState.players.find(p => p.id === gameState.winner);
      if (winner) addNotification(` ${winner.name} wins the game!`);
    }
  }, [gameState.winner, isReplay]);

  const handleRollDice = useCallback(() => {
    socket.emit('rollDice', (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handlePlaceSettlement = useCallback((vertexKey) => {
    socket.emit('placeSettlement', { vertexKey, isSetup }, (response) => {
      if (response.success) {
        setLastPlacedSettlement(vertexKey);
        if (isSetup) {
          setSelectedAction('road');
        } else {
          setSelectedAction(null);
        }
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, isSetup, addNotification]);

  const handlePlaceRoad = useCallback((edgeKey) => {
    socket.emit('placeRoad', { 
      edgeKey, 
      isSetup, 
      lastSettlement: setupSettlement
    }, (response) => {
      if (response.success) {
        if (isSetup) {
          // Advance setup
          socket.emit('advanceSetup', () => {});
          setLastPlacedSettlement(null);
        } else if (gameState.freeRoads > 1) {
          // Still have free roads from Road Building card
          setSelectedAction('road');
        } else {
          setSelectedAction(null);
        }
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, isSetup, setupSettlement, gameState.freeRoads, addNotification]);

  const handleUpgradeToCity = useCallback((vertexKey) => {
    socket.emit('upgradeToCity', { vertexKey }, (response) => {
      if (response.success) {
        setSelectedAction(null);
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleHexClick = useCallback((hexKey) => {
    if (gameState.turnPhase === 'robber' && isMyTurn) {
      if (hexKey === gameState.robber) {
        addNotification('Must move robber to a different hex');
        return;
      }
      
      // Get players on this hex
      socket.emit('getPlayersOnHex', { hexKey }, (response) => {
        if (response.success && response.players.length > 0) {
          setPendingRobberHex(hexKey);
          setPlayersOnHex(response.players);
        } else {
          // No players to steal from, just move
          socket.emit('moveRobber', { hexKey, stealFromPlayerId: null }, (res) => {
            if (!res.success) {
              addNotification(res.error);
            }
          });
        }
      });
    }
  }, [gameState.turnPhase, gameState.robber, isMyTurn, socket, addNotification]);

  const handleStealFromPlayer = useCallback((stealPlayerId) => {
    socket.emit('moveRobber', { 
      hexKey: pendingRobberHex, 
      stealFromPlayerId: stealPlayerId 
    }, (response) => {
      if (response.success) {
        setPendingRobberHex(null);
        setPlayersOnHex([]);
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, pendingRobberHex, addNotification]);

  const handleEndTurn = useCallback(() => {
    socket.emit('endTurn', (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleFinishFreeRoads = useCallback(() => {
    socket.emit('finishFreeRoads', (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleBuyDevCard = useCallback(() => {
    socket.emit('buyDevCard', (response) => {
      if (response.success) {
        setRevealedCard(response.card);
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleStartGame = useCallback(() => {
    socket.emit('startGame', (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleShuffleBoard = useCallback(() => {
    socket.emit('shuffleBoard', (response) => {
      if (response.success) {
        addNotification('Board shuffled!');
      } else {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  const handleSendChat = useCallback((message) => {
    socket.emit('chatMessage', { message });
  }, [socket]);

  const getStatusMessage = () => {
    const maxPlayers = gameState.maxPlayers || 4;
    if (isReplay) {
      if (gameState.phase === 'finished') {
        const winner = gameState.players.find(p => p.id === gameState.winner);
        return winner ? `${winner.name} wins · Final board` : 'Final recorded board';
      }
      if (gameState.phase === 'waiting') return 'Recorded lobby';
      if (isSetup) return `${currentPlayer?.name || 'A player'} is setting up`;
      const phase = String(gameState.turnPhase || gameState.phase || 'recorded turn').replaceAll('-', ' ');
      return isPairedTurn ? `${currentPlayer?.name || 'A player'}'s extra action phase · ${phase}` : `${currentPlayer?.name || 'A player'}'s turn · ${phase}`;
    }
    if (gameState.phase === 'waiting') {
      const modeText = isExtended ? '5–6 player extension · ' : '';
      return `${modeText}Waiting for players (${gameState.players.length}/${maxPlayers})`;
    }
    if (gameState.phase === 'finished') {
      const winner = gameState.players.find(p => p.id === gameState.winner);
      return winner ? `${winner.name} wins!` : 'The host ended this game.';
    }
    if (paused) return 'Game paused';
    if (needsToDiscard) {
      const discardInfo = gameState.discardingPlayers.find(
        d => d.playerIndex === gameState.myIndex
      );
      return `Discard ${discardInfo.cardsToDiscard} cards`;
    }
    if (isSetup) {
      return isMyTurn 
        ? `Place your ${gameState.setupPhase === 0 ? 'first' : 'second'} settlement and road`
        : `${currentPlayer?.name} is placing...`;
    }
    if (!isMyTurn) {
      return isPairedTurn ? `${currentPlayer?.name}'s extra action phase` : `${currentPlayer?.name}'s turn`;
    }
    if (gameState.turnPhase === 'main' && selectedAction) {
      return selectedAction === 'road' ? 'Choose a highlighted path for your road'
        : selectedAction === 'city' ? 'Choose a highlighted settlement to upgrade'
        : 'Choose a highlighted intersection for your settlement';
    }
    switch (gameState.turnPhase) {
      case 'roll': return 'Roll the dice';
      case 'robber': return 'Move the robber';
      case 'robberPick': return 'Choose a face-down card';
      case 'discard': return 'Waiting for players to discard';
      case 'main': return isPairedTurn ? 'Extra action phase · Build, use the bank, or end turn' : 'Build, trade, or end turn';
      default: return '';
    }
  };
  
  return (
    <div className={`game-board game-hud ${isReplay ? 'replay-game-board' : ''}`} onKeyDown={event => {
      if (event.key === 'Escape' && selectedAction && !isSetup && !isReplay && !event.defaultPrevented &&
        !event.target.closest('input,textarea,select,[role="dialog"],.game-chat-window')) {
        event.preventDefault(); setSelectedAction(null);
      }
    }}>
      {/* Header */}
      <div className="game-header">
        <div className="game-code-display">
          <span className="table-wordmark">CATAN</span>
          {isReplay && <span className="replay-game-label">Replay</span>}
        </div>
        
        <div className="turn-indicator">
          {currentPlayer ? (
            <div 
              className="current-player-badge"
              style={{ '--turn-color': currentPlayer.color }}
            >
              {currentPlayer.name}
            </div>
          ) : (
            <div className="current-player-badge waiting-badge">
              Lobby
            </div>
          )}
          <span className="status-message" role="status">{getStatusMessage()}</span>
          {isExtended && gameState.phase === 'playing' && productionPlayer && extraPlayer && (
            <span className="turn-pair-context" aria-label={`Production turn: ${productionPlayer.name}. Extra action phase: ${extraPlayer.name}.`}>
              Production: {productionPlayer.name} · Extra action: {extraPlayer.name}
            </span>
          )}
        </div>
        <div className="game-header-tools"><PresentationControls />
          {!isReplay && <GameLog key={`${gameCode}:${playerId}`} events={events} players={gameState.players}/>}
        </div>

      </div>

      <div className={`player-roster ${gameState.players.length >= 5 ? 'large-roster' : ''}`} role="group" aria-label="Players and scores" style={{'--seat-count': gameState.players.length}}>
          {gameState.players.map((player, idx) => (
            <PlayerPanel
              slot={slots.find(slot=>slot.id===player.id)}
              key={player.id}
              player={player}
              isCurrentTurn={idx === gameState.currentPlayerIndex}
              turnLabel={isPairedTurn && idx === gameState.currentPlayerIndex ? 'Extra action' : undefined}
              isMe={!isReplay && idx === gameState.myIndex}
              viewSelected={isReplay && player.id === replay.perspective}
              viewLabel={isReplay ? (
                player.id === replay.perspective
                  ? `Viewing ${player.name}`
                  : (replay.allowedSeatIds || []).includes(player.id)
                    ? `View as ${player.name}`
                    : `${player.name}'s private view is unavailable`
              ) : undefined}
              viewDisabled={isReplay && !(replay.allowedSeatIds || []).includes(player.id)}
              onSelect={isReplay && replay.onSelectPlayer ? () => replay.onSelectPlayer(player.id) : undefined}
              longestRoad={gameState.longestRoadPlayer === idx}
              largestArmy={gameState.largestArmyPlayer === idx}
              gameOver={gameState.phase === 'finished'}
              onRightClick={(e, key, extra) => {
                if (extra) {
                  // Custom info passed
                  e.preventDefault();
                  showInfo(e, key, extra);
                } else {
                  showInfo(e, key);
                }
              }}
            />
          ))}
          
          {!isReplay && isWaiting && (
            <div className="waiting-controls">
              {isHost && (
                <>
                  <button 
                    className="shuffle-btn"
                    onClick={handleShuffleBoard}
                  >
                     Shuffle Board
                  </button>
                  <button 
                    className="start-game-btn"
                    onClick={handleStartGame}
                    disabled={gameState.players.length < 2}
                  >
                    Start game ({gameState.players.length}/{gameState.maxPlayers || 4})
                  </button>
                </>
              )}
              {!isHost && (
                <p className="waiting-text">Waiting for host to start...</p>
              )}
            </div>
          )}
        </div>

      {/* The board and its contextual controls share the main playing field. */}
      <div className="game-main">
        <div className="board-container">
          <div className="bank-anchor" data-card-bank><GameIcon name="bank" size={22}/><span>Bank</span></div>
          <HexBoard
            cameraKey={gameCode}
            cameraState={replay?.boardCamera}
            animate={isReplay ? replay.playing : !paused}
            resetKey={isReplay ? replay.resetKey : presentationKey || `${gameCode}:${playerId}`}
            playbackRate={motionRate}
            legalActions={isReplay ? [] : legalActions}
            hexes={gameState.hexes}
            vertices={gameState.vertices}
            edges={gameState.edges}
            robber={gameState.robber}
            players={gameState.players}
            ports={gameState.ports || []}
            selectedAction={isReplay ? null : selectedAction}
            isMyTurn={isReplay ? false : isMyTurn}
            canBuildNow={isReplay ? false : canBuildNow}
            myIndex={gameState.myIndex}
            gamePhase={gameState.phase}
            turnPhase={gameState.turnPhase}
            paused={isReplay ? true : paused}
            onPlaceSettlement={isReplay ? undefined : handlePlaceSettlement}
            onPlaceRoad={isReplay ? undefined : handlePlaceRoad}
            onUpgradeToCity={isReplay ? undefined : handleUpgradeToCity}
            onHexClick={isReplay ? undefined : handleHexClick}
            onHexRightClick={showHexInfo}
            lastPlacedSettlement={lastPlacedSettlement}
            freeRoads={gameState.freeRoads}
          />
          
          {/* Dice display - auto-hides after 5 seconds */}
          {gameState.diceRoll && (
            <DiceDisplay 
              key={rollIdentity}
              roll={gameState.diceRoll} 
              rollId={rollEvent?.id}
              duration={900 / motionRate}
              animate={Boolean(freshRoll && freshRoll.presentationIdentity === rollIdentity && freshRoll.id === rollEvent?.id)}
              onRightClick={(e, key, extra) => showInfo(e, key, extra)}
            />
          )}
        </div>

        {/* Right sidebar - Actions */}
        <div className="sidebar right-sidebar">
          {isReplay ? replay.inspector : <>
          {legalActions.some(action => action.type === 'advanceSetup') && (
            <button type="button" className="room-secondary-button" onClick={() => socket.emit('advanceSetup', response => { if (!response.success) addNotification(response.error); })}>
              Continue setup
            </button>
          )}
          {gameState.phase === 'playing' && myPlayer && (
            <>
              <ActionPanel 
                isMyTurn={isMyTurn}
                turnPhase={gameState.turnPhase}
                selectedAction={selectedAction}
                setSelectedAction={setSelectedAction}
                onRollDice={handleRollDice}
                onEndTurn={handleEndTurn}
                onBuyDevCard={handleBuyDevCard}
                onOpenTrade={mode => {setTradeMode(mode); setShowTradeModal(true);}}
                onOpenDevCards={() => setShowDevCardModal(true)}
                player={myPlayer}
                freeRoads={gameState.freeRoads}
                yearOfPlentyPicks={gameState.yearOfPlentyPicks}
                devCardsLeft={gameState.devCardDeck}
                turnRole={gameState.turnRole}
                playerTradingAllowed={gameState.playerTradingAllowed !== false}
              />
              {gameState.freeRoads > 0 && legalActions.some(action => action.type === 'finishFreeRoads') && (
                <button
                  type="button"
                  className="room-secondary-button room-finish-roads-button"
                  onClick={handleFinishFreeRoads}
                >
                  Finish road building
                </button>
              )}
            </>
          )}

          <button 
            className="chat-toggle"
            onClick={() => setShowChat(!showChat)}
          >
             <GameIcon name="chat" size={18}/> Chat
            {unreadMessages > 0 && (
              <span className="chat-notification-dot">{unreadMessages}</span>
            )}
          </button>
          </>}
        </div>
      </div>

      {/* Bottom - My Resources */}
      {isReplay ? (
        <ReplayHand players={gameState.players} perspective={replay.perspective} onCardInfo={showInfo} />
      ) : myPlayer ? (
        <div className="my-resources-bar" data-own-hand>
          <div className="hand-heading"><span>Your hand</span><strong>{Object.values(myPlayer.resources || {}).reduce((sum, count) => sum + count, 0)} <small>cards</small></strong></div>
          <ResourceCards
            resources={myPlayer.resources}
            onRightClick={(e, resourceKey) => showInfo(e, resourceKey)}
          />

          <button type="button" className="dev-cards-summary" onClick={() => setShowDevCardModal(true)}>
            <BuildingPiece kind="development"/>
            <span className="label">Development</span>
            <span className="count">{myPlayer.developmentCards?.length || 0}</span>
            {myPlayer.newDevCards?.length > 0 && (
              <span className="new-badge">+{myPlayer.newDevCards.length} new</span>
            )}
          </button>
        </div>
      ) : (
        <div className="room-spectator-note">Spectator view: private cards and resources are hidden.</div>
      )}

      {/* Discard Phase Banner - shows when waiting for others to discard */}
      {!isReplay && gameState.turnPhase === 'discard' && isMyTurn && !needsToDiscard && (
        <div className="discard-notification-banner">
          <GameIcon name="cards" size={24}/>
          <span className="discard-text">
            Waiting for players to discard cards...
          </span>
        </div>
      )}

      {/* Trade Notification Banner - shows when there's a pending trade from another player */}
      {!isReplay && gameState.turnRole !== 'paired' && gameState.playerTradingAllowed !== false && gameState.tradeOffer &&
       gameState.tradeOffer.from !== gameState.myIndex && 
       !showTradeModal && 
       dismissedTradeId !== gameState.tradeOffer.id && (
        <div className="trade-notification-banner">
          <GameIcon name="trade" size={24}/>
          <span className="trade-text" onClick={() => {setTradeMode('player'); setShowTradeModal(true);}}>
            <strong>{gameState.players[gameState.tradeOffer.from]?.name}</strong> offered a trade to {gameState.players[gameState.tradeOffer.to]?.name}.
          </span>
          <button className="view-trade-btn" onClick={() => {setTradeMode('player'); setShowTradeModal(true);}}>View Trade</button>
          <button 
            className="dismiss-trade-btn" 
            onClick={(e) => {
              e.stopPropagation();
              setDismissedTradeId(gameState.tradeOffer.id);
            }}
            title="Dismiss notification"
            aria-label="Dismiss trade notification"
          >
            <GameIcon name="close" size={16}/>
          </button>
        </div>
      )}

      {(!isReplay || replay.playing) && <CardMovements key={isReplay ? replay.resetKey : rollIdentity} events={cardEvents}
        seatId={isReplay ? (['public', 'omniscient'].includes(replay.perspective) ? undefined : replay.perspective) : playerId}
        playbackRate={motionRate}/>}
      {!isReplay && gameState.phase === 'playing' && robberPick?.cardIds && <RobberPickModal
        key={robberPick.id}
        pick={robberPick}
        victimName={gameState.players.find(p => p.id === robberPick.victimId)?.name || 'this player'}
        paused={paused}
        onPick={cardId => new Promise(resolve => socket.emit('chooseRobberCard', {cardId}, resolve))}
      />}
      {/* Modals */}
      {!isReplay && showTradeModal && tradePanel && tradePanel(() => setShowTradeModal(false), tradeMode)}

      {!isReplay && showDevCardModal && myPlayer && (
        <DevCardModal 
          socket={socket}
          myPlayer={myPlayer}
          isMyTurn={isMyTurn}
          turnPhase={gameState.turnPhase}
          yearOfPlentyPicks={gameState.yearOfPlentyPicks}
          onClose={() => setShowDevCardModal(false)}
          addNotification={addNotification}
        />
      )}

      {!isReplay && revealedCard && (
        <CardReveal 
          cardType={revealedCard}
          onClose={() => setRevealedCard(null)}
        />
      )}

      {!isReplay && needsToDiscard && (
        <DiscardModal 
          socket={socket}
          player={myPlayer}
          paused={paused}
          cardsToDiscard={
            gameState.discardingPlayers.find(d => d.playerIndex === gameState.myIndex)?.cardsToDiscard
          }
          addNotification={addNotification}
        />
      )}

      {/* Steal selection modal */}
      {!isReplay && gameState.phase === 'playing' && gameState.turnPhase === 'robber' && pendingRobberHex && playersOnHex.length > 0 && (
        <div className="modal-overlay">
          <div className="steal-modal">
            <h3>Steal from whom?</h3>
            <div className="steal-options">
              {playersOnHex.map(p => (
                <button 
                  key={p.id}
                  className="steal-btn"
                  onClick={() => handleStealFromPlayer(p.id)}
                  disabled={paused || !p.hasResources}
                >
                  {p.name}
                  {!p.hasResources && <span className="no-cards">(no cards)</span>}
                </button>
              ))}
            </div>
            {/* Show OK button if no players have cards to steal */}
            {playersOnHex.every(p => !p.hasResources) && (
              <button 
                className="steal-ok-btn"
                disabled={paused}
                onClick={() => handleStealFromPlayer(null)}
              >
                OK
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat panel */}
      {!isReplay && (
        <Chat 
          key={chatIdentity}
          open={showChat}
          messages={chatMessages}
          onSend={handleSendChat}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* Info Popup for right-click help */}
      {infoPopup && (
        <InfoPopup 
          position={infoPopup.position}
          info={infoPopup.info}
          onClose={closeInfoPopup}
        />
      )}

      {/* Victory celebration with confetti */}
      {!isReplay && gameState.phase === 'finished' && gameState.winner && (
        <Confetti 
          winner={gameState.players.find(p => p.id === gameState.winner)}
          onBackToLobby={onLeaveGame}
        />
      )}
    </div>
  );
}

export default GameBoard;
