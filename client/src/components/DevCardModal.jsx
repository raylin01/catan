import { useState } from 'react';
import './DevCardModal.css';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import {useDialogFocus} from '../presentation/useDialogFocus';

const DEV_CARD_INFO = {
  knight: {
    name: 'Knight',
    icon: 'knight',
    description: 'Move the robber and steal from an opponent. Counts toward Largest Army.',
    playable: true
  },
  victoryPoint: {
    name: 'Victory Point',
    icon: 'trophy',
    description: 'Worth 1 VP. Revealed at end of game or when you win.',
    playable: false
  },
  roadBuilding: {
    name: 'Road Building',
    icon: 'road',
    description: 'Build 2 roads for free.',
    playable: true
  },
  yearOfPlenty: {
    name: 'Year of Plenty',
    icon: 'yearOfPlenty',
    description: 'Take any 2 resources from the bank.',
    playable: true
  },
  monopoly: {
    name: 'Monopoly',
    icon: 'monopoly',
    description: 'Name a resource. All players give you all their cards of that type.',
    playable: true
  }
};

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function DevCardModal({ legalActions, paused=false, seafarers, socket, myPlayer, isMyTurn, turnPhase, yearOfPlentyPicks, onClose, addNotification }) {
  const dialog = useDialogFocus(onClose);
  const [selectedCard, setSelectedCard] = useState(null);
  const [monopolyResource, setMonopolyResource] = useState(null);

  // Can play dev cards before rolling (roll phase) or after rolling (main phase)
  const infoFor=cardType=>{const info={...DEV_CARD_INFO[cardType]};if(seafarers && cardType==='roadBuilding')info.description='Build two roads or ships for free, in any combination.';if(seafarers && cardType==='knight')info.description=seafarers.scenario==='the_pirate_islands'?'Convert your nearest ordinary ship to a warship. Warships defend against the fleet and attack your fortress.':'Move the robber or pirate and steal from an eligible opponent. Counts toward Largest Army.';return info;};
  const canPlay = !paused && isMyTurn && (turnPhase === 'roll' || turnPhase === 'main');

  const handlePlayCard = (cardType) => {
    if (cardType === 'monopoly') {
      setSelectedCard('monopoly');
      return;
    }

    socket.emit('playDevCard', { cardType, params: {} }, (response) => {
      if (response.success) {
        addNotification(`Played ${DEV_CARD_INFO[cardType].name}!`);
        if (cardType === 'knight' || cardType === 'roadBuilding') {
          onClose();
        }
      } else {
        addNotification(response.error);
      }
    });
  };

  const handleMonopoly = () => {
    if (!monopolyResource) {
      addNotification('Select a resource');
      return;
    }

    socket.emit('playDevCard', { 
      cardType: 'monopoly', 
      params: { resource: monopolyResource } 
    }, (response) => {
      if (response.success) {
        addNotification(`Monopoly on ${monopolyResource}!`);
        onClose();
      } else {
        addNotification(response.error);
      }
    });
  };

  const handleYearOfPlentyPick = (resource) => {
    socket.emit('yearOfPlentyPick', { resource }, (response) => {
      if (!response.success) {
        addNotification(response.error);
      }
    });
  };

  // Group cards by type
  const cardCounts = {};
  myPlayer.developmentCards?.forEach(card => {
    cardCounts[card] = (cardCounts[card] || 0) + 1;
  });

  const newCards = myPlayer.newDevCards || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="dev-card-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Development cards" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close development cards">
          <GameIcon name="close" size={18} />
        </button>
        
        <h2>Development Cards</h2>

        {/* Year of Plenty resource picking */}
        {yearOfPlentyPicks > 0 && (
          <div className="year-of-plenty-picker">
            <h3>Year of Plenty - Pick {yearOfPlentyPicks} resource(s)</h3>
            <div className="resource-buttons">
              {RESOURCES.map(r => (
                <button
                  key={r}
                  className="resource-pick-btn"
                  disabled={paused || (legalActions && !legalActions.some(action=>action.type==='yearOfPlentyPick' && action.payload.resource===r))}
                  onClick={() => handleYearOfPlentyPick(r)}
                >
                  <CardArtwork className="resource-choice-art" name={r} />
                  <span className="name">{r}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Monopoly resource selection */}
        {selectedCard === 'monopoly' && (
          <div className="monopoly-picker">
            <h3>Choose resource to monopolize</h3>
            <div className="resource-buttons">
              {RESOURCES.map(r => (
                <button
                  key={r}
                  className={`resource-pick-btn ${monopolyResource === r ? 'selected' : ''}`}
                  aria-pressed={monopolyResource === r}
                  onClick={() => setMonopolyResource(r)}
                >
                  <CardArtwork className="resource-choice-art" name={r} />
                  <span className="name">{r}</span>
                </button>
              ))}
            </div>
            <div className="monopoly-actions">
              <button onClick={() => setSelectedCard(null)}>Cancel</button>
              <button className="confirm" onClick={handleMonopoly}>Confirm</button>
            </div>
          </div>
        )}

        {/* Cards list */}
        {!selectedCard && (
          <>
            {Object.keys(cardCounts).length === 0 && newCards.length === 0 ? (
              <p className="no-cards">You have no development cards.</p>
            ) : (
              <>
                {/* Playable cards */}
                <div className="card-list">
                  {Object.entries(cardCounts).map(([cardType, count]) => {
                    const info = infoFor(cardType);
                    const isPlayable = info.playable && canPlay && (!legalActions || legalActions.some(action=>action.type==='playDevCard' && action.payload.cardType===cardType));
                    
                    return (
                      <div key={cardType} className={`dev-card ${isPlayable ? 'playable' : ''}`}>
                        <CardArtwork name={cardType} className="dev-card-illustration" />
                        <div className="card-header">
                          <GameIcon className="card-icon" name={info.icon} size={26} />
                          <span className="card-name">{info.name}</span>
                          <span className="card-count">×{count}</span>
                        </div>
                        <p className="card-description">{info.description}</p>
                        {info.playable && (
                          <button
                            className="play-card-btn"
                            onClick={() => handlePlayCard(cardType)}
                            disabled={!isPlayable}
                          >
                            Play
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* New cards (bought this turn) */}
                {newCards.length > 0 && (
                  <div className="new-cards">
                    <h4>Bought This Turn (can't play yet)</h4>
                    <div className="card-list small">
                      {newCards.map((cardType, idx) => {
                        const info = infoFor(cardType);
                        return (
                          <div key={idx} className="dev-card new">
                            <CardArtwork name={cardType} className="dev-card-illustration" />
                            <span className="card-name">{info.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DevCardModal;
