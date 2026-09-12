import { useState, useEffect, useCallback, useRef } from 'react';
import HexBoard from './HexBoard';
import GameIcon from './GameIcon';
import PlayerPanel from './PlayerPanel';
import ResourceCards from './ResourceCards';
import ActionPanel from './ActionPanel';
import DiceDisplay from './DiceDisplay';
import Chat from './Chat';
import DevCardModal from './DevCardModal';
import DiscardModal from './DiscardModal';
import CardMovements from './CardMovements';
import RobberPickModal from './RobberPickModal';
import CardReveal from './CardReveal';
import InfoPopup, { useInfoPopup, INFO_DATA } from './InfoPopup';
import Confetti from './Confetti';
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
  tradePanel = null
}) {
  const [selectedAction, setSelectedAction] = useState(null); // 'settlement', 'road', 'city'
  const [lastPlacedSettlement, setLastPlacedSettlement] = useState(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeMode, setTradeMode] = useState('player');
  const [showDevCardModal, setShowDevCardModal] = useState(false);
  const [pendingRobberHex, setPendingRobberHex] = useState(null);
  const [playersOnHex, setPlayersOnHex] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [freshRoll, setFreshRoll] = useState(null);
  const rollSeen = useRef({identity:`${gameCode}:${playerId}`,id:rollEvent?.id});
  const [revealedCard, setRevealedCard] = useState(null);
  const [lastTradeOfferId, setLastTradeOfferId] = useState(null);
  const [dismissedTradeId, setDismissedTradeId] = useState(null);

  const [lastNotifiedRoll, setLastNotifiedRoll] = useState(rollEvent?.id || (gameState.diceRoll ? `${gameState.diceRoll.die1}-${gameState.diceRoll.die2}-${gameState.currentPlayerIndex}` : null));
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  
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
  
  // 5-6 player extension: Special Building Phase
  const isSpecialBuildPhase = gameState.specialBuildingPhase && gameState.turnPhase === 'specialBuild';
  const isMySpecialBuild = isSpecialBuildPhase && gameState.specialBuildIndex === gameState.myIndex;
  const canBuildNow = isMyTurn || isMySpecialBuild;
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
    const identity = `${gameCode}:${playerId}`;
    if (rollSeen.current.identity !== identity) {
      rollSeen.current = {identity, id: rollEvent?.id};
      setFreshRoll(null);
      return;
    }
    if (!rollEvent || rollSeen.current.id === rollEvent.id) return;
    rollSeen.current.id = rollEvent.id;
    setFreshRoll(rollEvent);
  }, [gameCode, playerId, rollEvent?.id]);

  // Listen for steal notifications
  useEffect(() => {
    
    const handleStealResult = ({ type, resource, otherPlayer }) => {
      if (type === 'stole') {
        addNotification(` You stole ${resource} from ${otherPlayer}!`);
      } else {
        addNotification(` ${otherPlayer} stole ${resource} from you!`);
      }
    };
    
    socket.on('stealResult', handleStealResult);
    return () => socket.off('stealResult', handleStealResult);
  }, [socket, addNotification]);

  // Listen for special building phase events (5-6 player extension)
  useEffect(() => {
    const handleSpecialBuildStarted = ({ currentBuilder }) => {
      if (currentBuilder === playerId) {
        addNotification(' Special Building Phase - Your turn to build!');
      }
    };
    
    const handleSpecialBuildNext = ({ currentBuilder }) => {
      if (currentBuilder === playerId) {
        addNotification(' Your turn in Special Building Phase!');
      }
    };
    
    const handleSpecialBuildEnded = () => {
      addNotification('Special Building Phase ended');
    };
    
    socket.on('specialBuildingPhaseStarted', handleSpecialBuildStarted);
    socket.on('specialBuildNext', handleSpecialBuildNext);
    socket.on('specialBuildingPhaseEnded', handleSpecialBuildEnded);
    
    return () => {
      socket.off('specialBuildingPhaseStarted', handleSpecialBuildStarted);
      socket.off('specialBuildNext', handleSpecialBuildNext);
      socket.off('specialBuildingPhaseEnded', handleSpecialBuildEnded);
    };
  }, [socket, playerId, addNotification]);

  // Track new chat messages for notification dot
  useEffect(() => {
    if (chatMessages.length > lastMessageCount) {
      // Only increment unread if chat is closed and message is from another player
      if (!showChat) {
        const newMessages = chatMessages.slice(lastMessageCount);
        const otherPlayerMessages = newMessages.filter(msg => msg.playerId !== playerId);
        if (otherPlayerMessages.length > 0) {
          setUnreadMessages(prev => prev + otherPlayerMessages.length);
        }
      }
      setLastMessageCount(chatMessages.length);
    }
  }, [chatMessages, lastMessageCount, showChat, playerId]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (showChat) {
      setUnreadMessages(0);
    }
  }, [showChat]);

  // Auto-open trade modal when there's a pending trade from another player
  useEffect(() => {
    const tradeOffer = gameState.tradeOffer;
    const isTradeForMe = tradeOffer?.to === gameState.myIndex;
    
    // Create a unique ID for this trade to track if we've already shown it
    const tradeId = tradeOffer?.id || null;
    
    if (tradeOffer && isTradeForMe && tradeId !== lastTradeOfferId) {
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
  }, [gameState.tradeOffer, gameState.myIndex, gameState.players, lastTradeOfferId, addNotification]);

  // Auto-select action during setup
  useEffect(() => {
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
  }, [gameState, isSetup, isMyTurn, legalActions]);

  // Reset roll notification tracker when turn phase goes back to 'roll' (new turn)
  useEffect(() => {
    if (gameState.turnPhase === 'roll') {
      setLastNotifiedRoll(null);
    }
  }, [gameState.turnPhase]);

  // Handle dice roll notification (only for 7 - robber)
  useEffect(() => {
    if (gameState.diceRoll && gameState.turnPhase !== 'roll') {
      // Create unique key for this roll to prevent duplicate notifications
      const rollKey = rollEvent?.id || `${gameState.diceRoll.die1}-${gameState.diceRoll.die2}-${gameState.currentPlayerIndex}`;
      
      // Only notify for 7 (robber) - regular rolls are shown in the dice display
      if (rollKey !== lastNotifiedRoll && gameState.diceRoll.total === 7) {
        const roller = gameState.players[gameState.currentPlayerIndex];
        addNotification(`${roller.name} rolled a 7. ${gameState.turnPhase === "discard" ? "Players must discard before the robber moves." : "Move the robber."}`);
        setLastNotifiedRoll(rollKey);
      } else if (rollKey !== lastNotifiedRoll) {
        setLastNotifiedRoll(rollKey);
      }
    }
  }, [gameState.diceRoll, gameState.turnPhase, gameState.currentPlayerIndex, gameState.players, lastNotifiedRoll, addNotification, rollEvent?.id]);

  // Handle winner
  useEffect(() => {
    if (gameState.winner) {
      const winner = gameState.players.find(p => p.id === gameState.winner);
      if (winner) addNotification(` ${winner.name} wins the game!`);
    }
  }, [gameState.winner]);

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
    if (gameState.phase === 'waiting') {
      const modeText = gameState.isExtended ? '(5-6 Player Mode)' : '';
      return `Board Preview ${modeText} - Waiting for players... (${gameState.players.length}/${maxPlayers})`;
    }
    if (gameState.phase === 'finished') {
      const winner = gameState.players.find(p => p.id === gameState.winner);
      return winner ? `${winner.name} wins!` : 'The host ended this game.';
    }
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
    // Special Building Phase (5-6 player extension)
    if (isSpecialBuildPhase) {
      if (isMySpecialBuild) {
        return ' Special Building Phase - Build or buy cards, then pass';
      }
      const specialBuilder = gameState.players[gameState.specialBuildIndex];
      return ` Special Building Phase - ${specialBuilder?.name}'s turn to build`;
    }
    if (!isMyTurn) {
      return `${currentPlayer?.name}'s turn`;
    }
    switch (gameState.turnPhase) {
      case 'roll': return 'Roll the dice';
      case 'robber': return 'Move the robber';
      case 'robberPick': return 'Choose a face-down card';
      case 'discard': return 'Waiting for players to discard';
      case 'main': return 'Build, trade, or end turn';
      default: return '';
    }
  };
  
  // Handler to end special building phase turn
  const handleEndSpecialBuild = useCallback(() => {
    socket.emit('endSpecialBuild', (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  }, [socket, addNotification]);

  return (
    <div className="game-board">
      {/* Header */}
      <div className="game-header">
        <div className="game-code-display">
          <span className="table-wordmark">CATAN</span>
        </div>
        
        <div className="turn-indicator">
          {currentPlayer ? (
            <div 
              className="current-player-badge"
              style={{ backgroundColor: currentPlayer.color }}
            >
              {currentPlayer.name}
            </div>
          ) : (
            <div className="current-player-badge waiting-badge">
              Lobby
            </div>
          )}
          <span className="status-message">{getStatusMessage()}</span>
        </div>

      </div>

      {/* Main game area */}
      <div className="game-main">
        {/* Left sidebar - Players */}
        <div className="sidebar left-sidebar">
          <h3>Players</h3>
          {gameState.players.map((player, idx) => (
            <PlayerPanel
              slot={slots.find(slot=>slot.id===player.id)}
              key={player.id}
              player={player}
              isCurrentTurn={idx === gameState.currentPlayerIndex}
              isMe={idx === gameState.myIndex}
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
          
          {isWaiting && (
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
                    ▶ Start Game ({gameState.players.length}/4)
                  </button>
                </>
              )}
              {!isHost && (
                <p className="waiting-text">Waiting for host to start...</p>
              )}
            </div>
          )}
        </div>

        {/* Center - Board */}
        <div className="board-container">
          <div className="bank-anchor" data-card-bank><GameIcon name="bank" size={22}/><span>Bank</span></div>
          <HexBoard 
            legalActions={legalActions}
            hexes={gameState.hexes}
            vertices={gameState.vertices}
            edges={gameState.edges}
            robber={gameState.robber}
            players={gameState.players}
            ports={gameState.ports || []}
            selectedAction={selectedAction}
            isMyTurn={isMyTurn}
            canBuildNow={canBuildNow}
            myIndex={gameState.myIndex}
            gamePhase={gameState.phase}
            turnPhase={gameState.turnPhase}
            paused={paused}
            onPlaceSettlement={handlePlaceSettlement}
            onPlaceRoad={handlePlaceRoad}
            onUpgradeToCity={handleUpgradeToCity}
            onHexClick={handleHexClick}
            onHexRightClick={showHexInfo}
            lastPlacedSettlement={lastPlacedSettlement}
            freeRoads={gameState.freeRoads}
          />
          
          {/* Dice display - auto-hides after 5 seconds */}
          {gameState.diceRoll && (
            <DiceDisplay 
              roll={gameState.diceRoll} 
              rollId={rollEvent?.id}
              animate={Boolean(freshRoll && freshRoll.id === rollEvent?.id)}
              onRightClick={(e, key, extra) => showInfo(e, key, extra)}
            />
          )}
        </div>

        {/* Right sidebar - Actions */}
        <div className="sidebar right-sidebar">
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
                isSpecialBuildPhase={isSpecialBuildPhase}
                isMySpecialBuild={isMySpecialBuild}
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

          {events.length > 0 && (
            <details className="room-event-log">
              <summary>Game log ({events.length})</summary>
              <div className="room-event-list">
                {events.slice().reverse().map(event => {
                  const actor = gameState.players.find(player => player.id === event.actor)?.name || event.actor || 'Game';
                  const timestamp = event.at ? new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div className="room-event" key={event.id || `${event.at}-${event.type}`}>
                      <span>{event.summary || `${actor} ${event.type}`}</span>
                      {timestamp && <time dateTime={new Date(event.at).toISOString()}>{timestamp}</time>}
                    </div>
                  );
                })}
              </div>
            </details>
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
        </div>
      </div>

      {/* Bottom - My Resources */}
      {myPlayer ? (
        <div className="my-resources-bar" data-own-hand>
          <ResourceCards
            resources={myPlayer.resources}
            onRightClick={(e, resourceKey) => showInfo(e, resourceKey)}
          />

          <div className="dev-cards-summary" onClick={() => setShowDevCardModal(true)}>
            <span className="label">Dev Cards:</span>
            <span className="count">{myPlayer.developmentCards?.length || 0}</span>
            {myPlayer.newDevCards?.length > 0 && (
              <span className="new-badge">+{myPlayer.newDevCards.length} new</span>
            )}
          </div>
        </div>
      ) : (
        <div className="room-spectator-note">Spectator view: private cards and resources are hidden.</div>
      )}

      {/* Robber Phase Banner - shows when player needs to move the robber */}
      {gameState.turnPhase === 'robber' && isMyTurn && (
        <div className="robber-notification-banner">
          <GameIcon name="robber" size={24}/>
          <span className="robber-text">
            <strong>Move the Robber!</strong> Click on a hex to place the robber there.
          </span>
        </div>
      )}

      {/* Discard Phase Banner - shows when waiting for others to discard */}
      {gameState.turnPhase === 'discard' && isMyTurn && !needsToDiscard && (
        <div className="discard-notification-banner">
          <GameIcon name="cards" size={24}/>
          <span className="discard-text">
            Waiting for players to discard cards...
          </span>
        </div>
      )}

      {/* Special Building Phase Banner (5-6 player extension) */}
      {isMySpecialBuild && (
        <div className="special-build-banner">
          <GameIcon name="settlement" size={24}/>
          <span className="special-build-text">
            <strong>Special Building Phase!</strong> You may build roads, settlements, cities, or buy development cards. No trading allowed.
          </span>
          <button className="special-build-done-btn" onClick={handleEndSpecialBuild}>
            Done Building
          </button>
        </div>
      )}

      {/* Trade Notification Banner - shows when there's a pending trade from another player */}
      {gameState.tradeOffer && 
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

      <CardMovements events={cardEvents} seatId={playerId}/>
      {gameState.phase === 'playing' && robberPick?.cardIds && <RobberPickModal
        key={robberPick.id}
        pick={robberPick}
        victimName={gameState.players.find(p => p.id === robberPick.victimId)?.name || 'this player'}
        paused={paused}
        onPick={cardId => new Promise(resolve => socket.emit('chooseRobberCard', {cardId}, resolve))}
      />}
      {/* Modals */}
      {showTradeModal && tradePanel && tradePanel(() => setShowTradeModal(false), tradeMode)}

      {showDevCardModal && myPlayer && (
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

      {revealedCard && (
        <CardReveal 
          cardType={revealedCard}
          onClose={() => setRevealedCard(null)}
        />
      )}

      {needsToDiscard && (
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
      {gameState.phase === 'playing' && gameState.turnPhase === 'robber' && pendingRobberHex && playersOnHex.length > 0 && (
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
      {showChat && (
        <Chat 
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
      {gameState.phase === 'finished' && gameState.winner && (
        <Confetti 
          winner={gameState.players.find(p => p.id === gameState.winner)}
          onBackToLobby={onLeaveGame}
        />
      )}
    </div>
  );
}

export default GameBoard;
