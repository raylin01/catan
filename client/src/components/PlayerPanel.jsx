import './PlayerPanel.css';
import GameIcon from './GameIcon';
import {AiStatus} from './AiControls';

function PlayerPanel({
  slot,
  seafarers,
  objective,
  player,
  isCurrentTurn,
  turnLabel = 'Turn',
  isMe,
  longestRoad,
  largestArmy,
  onRightClick,
  gameOver = false,
  onSelect,
  viewSelected = false,
  viewLabel,
  viewDisabled = false
}) {
  const totalCards = typeof player.resources === 'number' 
    ? player.resources 
    : Object.values(player.resources || {}).reduce((a, b) => a + b, 0);
  
  const developmentCards = typeof player.developmentCards === 'number'
    ? player.developmentCards
    : player.developmentCards?.length || 0;
  const newDevelopmentCards = typeof player.newDevCards === 'number'
    ? player.newDevCards
    : player.newDevCards?.length || 0;
  const devCardCount = developmentCards + newDevelopmentCards;

  const hiddenVP = player.hiddenVictoryPoints || 0;

  const handleRightClick = (e, infoKey) => {
    if (onRightClick) {
      onRightClick(e, infoKey);
    }
  };

  const Root = onSelect ? 'button' : 'div';
  const rootProps = onSelect ? {
    type: 'button',
    onClick: onSelect,
    disabled: viewDisabled,
    'aria-pressed': viewSelected,
    'aria-label': viewLabel || `View as ${player.name}`,
    title: viewLabel
  } : {};

  return (
    <Root
      className={`player-panel ${isCurrentTurn ? 'current-turn' : ''} ${isMe ? 'is-me' : ''} ${onSelect ? 'is-selectable' : ''} ${viewSelected ? 'is-viewing' : ''}`}
      {...rootProps}
      style={{'--seat-color': player.color}}
    >
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
          {viewSelected && <span className="you-badge viewing-badge">VIEWING</span>}
          {isCurrentTurn && !gameOver && <span className="turn-label">{turnLabel}</span>}
        </div>
        <div 
          className="victory-points has-info"
          onContextMenu={(e) => seafarers ? onRightClick?.(e, 'victoryPoints', {icon:'trophy',title:'Victory points',description:objective}) : handleRightClick(e, 'victoryPoints')}
          title="Right-click for info"
        >
          <span className="vp-number">
            {gameOver ? player.victoryPoints + hiddenVP : player.victoryPoints}
          </span>
          {!gameOver && (isMe || viewSelected) && hiddenVP > 0 && (
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
      <div className="player-inventory">
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
                description: `Total resource cards in this player's hand.`
              });
            }
          }}
          title="Resource cards in hand"
        >
          <GameIcon className="stat-icon" name="cards" size={15} />
          <span className="stat-value">{totalCards}</span>
        </div>
        <div 
          className="stat has-info"
          onContextMenu={(e) => handleRightClick(e, 'devCards')}
          title="Development cards"
        >
          <GameIcon className="stat-icon" name="devCard" size={15} />
          <span className="stat-value">{devCardCount}</span>
        </div>
        <div 
          className="stat has-info"
          onContextMenu={(e) => seafarers?.scenario==='the_pirate_islands' ? onRightClick?.(e,'warships',{icon:'warship',title:'Warships',description:'Knight cards upgrade ships to warships. Their number determines defense against the fleet and the strength of fortress attacks. This scenario has no Largest Army.'}) : handleRightClick(e, 'knights')}
          title={seafarers?.scenario==='the_pirate_islands' ? 'Warships' : 'Knights played'}
        >
          <GameIcon className="stat-icon" name={seafarers?.scenario==='the_pirate_islands' ? 'warship' : 'knight'} size={15} />
          <span className="stat-value">{seafarers?.scenario==='the_pirate_islands' ? player.warships : player.knightsPlayed}</span>
        </div>
      </div>
      
      <div className="player-pieces">
        {seafarers && <div className="piece-count has-info" title="Ships remaining" onContextMenu={event=>handleRightClick(event,'ships')}><GameIcon name="ship" size={15}/><span>{player.ships}</span></div>}
        {seafarers?.scenario==='cloth_for_catan' && <div className="piece-count has-info" title="Cloth collected" onContextMenu={event=>handleRightClick(event,'cloth')}><GameIcon name="cloth" size={15}/><span>{player.cloth}</span></div>}
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'settlements')}
          title="Settlements remaining"
        >
          <GameIcon className="piece-icon" name="settlement" size={15} />
          <span>{player.settlements}</span>
        </div>
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'cities')}
          title="Cities remaining"
        >
          <GameIcon className="piece-icon" name="city" size={15} />
          <span>{player.cities}</span>
        </div>
        <div 
          className="piece-count has-info"
          onContextMenu={(e) => handleRightClick(e, 'roads')}
          title="Roads remaining"
        >
          <GameIcon className="piece-icon" name="road" size={15} />
          <span>{player.roads}</span>
        </div>
      </div>
      
      </div>
      <div className="player-achievements">
        {longestRoad && (
          <div 
            className="achievement longest-road has-info"
            onContextMenu={(e) => seafarers ? onRightClick?.(e,'longestRoad',{icon:'ship',title:'Longest Route',description:'The longest continuous route of at least 5 roads or ships earns 2 victory points. A road and ship connect only at your own building.'}) : handleRightClick(e, 'longestRoad')}
            title="Right-click for info"
          >
            <><GameIcon name="road" size={15} /> {seafarers ? 'Longest Route' : 'Longest Road'}</>
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
    </Root>
  );
}

export default PlayerPanel;
