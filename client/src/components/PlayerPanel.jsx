import './PlayerPanel.css';
import GameIcon from './GameIcon';
import {AiStatus} from './AiControls';

function PlayerPanel({ slot, player, isCurrentTurn, isMe, longestRoad, largestArmy, onRightClick, gameOver = false }) {
  const totalCards = typeof player.resources === 'number' 
    ? player.resources 
    : Object.values(player.resources).reduce((a, b) => a + b, 0);
  
  const devCardCount = typeof player.developmentCards === 'number'
    ? player.developmentCards
    : player.developmentCards?.length || 0;

  const hiddenVP = player.hiddenVictoryPoints || 0;

  const handleRightClick = (e, infoKey) => {
    if (onRightClick) {
      onRightClick(e, infoKey);
    }
  };

  return (
    <div className={`player-panel ${isCurrentTurn ? 'current-turn' : ''} ${isMe ? 'is-me' : ''}`}>
      <div className="player-header">
        {player.turnOrder && (
          <div 
            className="turn-order-badge has-info"
            onContextMenu={(e) => handleRightClick(e, 'turnOrder')}
            title="Right-click for info"
          >
            {player.turnOrder}
          </div>
        )}
        <div 
          className="player-color-badge"
          style={{ backgroundColor: player.color }}
        />
        <div className="player-name">
          {player.name}
          {isMe && <span className="you-badge">YOU</span>}
        </div>
        <div 
          className="victory-points has-info"
          onContextMenu={(e) => handleRightClick(e, 'victoryPoints')}
          title="Right-click for info"
        >
          <span className="vp-number">
            {gameOver ? player.victoryPoints + hiddenVP : player.victoryPoints}
          </span>
          {!gameOver && isMe && hiddenVP > 0 && (
            <span className="hidden-vp" title="Hidden VP from Development Cards (only you can see this)">
              +{hiddenVP}
            </span>
          )}
          {gameOver && hiddenVP > 0 && (
            <span className="revealed-vp" title="Hidden VP from Development Cards (now revealed)">
              ({hiddenVP} hidden)
            </span>
          )}
          <span className="vp-label">VP</span>
        </div>
      </div>
      
      <AiStatus slot={slot}/>
      <div className="player-stats">
        <div 
          className="stat has-info"
          data-player-hand={player.id}
          onContextMenu={(e) => {
            e.preventDefault();
            // Show total cards info
            if (onRightClick) {
              onRightClick(e, 'resourceCards', {
                title: 'Resource Cards',
                icon: 'cards',
                description: `Total resource cards in hand. ${isMe ? 'Your cards are shown in detail below.' : 'Other players\' cards are hidden.'}`
              });
            }
          }}
          title="Right-click for info"
        >
          <GameIcon className="stat-icon" name="cards" size={15} />
          <span className="stat-value">{totalCards}</span>
        </div>
        <div 
          className="stat has-info"
          onContextMenu={(e) => handleRightClick(e, 'devCards')}
          title="Right-click for info"
        >
          <GameIcon className="stat-icon" name="devCard" size={15} />
          <span className="stat-value">{devCardCount}</span>
        </div>
        <div 
          className="stat has-info"
          onContextMenu={(e) => handleRightClick(e, 'knights')}
          title="Right-click for info"
        >
          <GameIcon className="stat-icon" name="knight" size={15} />
          <span className="stat-value">{player.knightsPlayed}</span>
        </div>
      </div>
      
      <div className="player-pieces">
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'settlements')}
          title="Right-click for info"
        >
          <GameIcon className="piece-icon" name="settlement" size={15} />
          <span>{player.settlements}</span>
        </div>
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'cities')}
          title="Right-click for info"
        >
          <GameIcon className="piece-icon" name="city" size={15} />
          <span>{player.cities}</span>
        </div>
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'roads')}
          title="Right-click for info"
        >
          <GameIcon className="piece-icon" name="road" size={15} />
          <span>{player.roads}</span>
        </div>
      </div>
      
      <div className="player-achievements">
        {longestRoad && (
          <div 
            className="achievement longest-road has-info"
            onContextMenu={(e) => handleRightClick(e, 'longestRoad')}
            title="Right-click for info"
          >
            <><GameIcon name="road" size={15} /> Longest Road</>
          </div>
        )}
        {largestArmy && (
          <div 
            className="achievement largest-army has-info"
            onContextMenu={(e) => handleRightClick(e, 'largestArmy')}
            title="Right-click for info"
          >
            <><GameIcon name="knight" size={15} /> Largest Army</>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerPanel;
