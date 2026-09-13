import GameIcon from './GameIcon';
import BuildingPiece from './BuildingPiece';
import SeafarersPiece from './SeafarersPiece';
import './ActionPanel.css';

const BUILDING_COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  developmentCard: { ore: 1, grain: 1, wool: 1 }
};

function hasResources(player, costs) {
  for (const [resource, amount] of Object.entries(costs)) {
    if ((player.resources[resource] || 0) < amount) {
      return false;
    }
  }
  return true;
}

function ActionPanel({ 
  isMyTurn, 
  turnPhase, 
  selectedAction, 
  setSelectedAction,
  onRollDice,
  onEndTurn,
  onBuyDevCard,
  onOpenTrade,
  onOpenDevCards,
  player,
  freeRoads,
  yearOfPlentyPicks,
  devCardsLeft,
  turnRole = 'primary',
  playerTradingAllowed = true,
  legalActions,
  seafarers,
  paused = false
}) {
  const legal = type => !paused && (!legalActions || legalActions.some(action=>action.type===type));
  const canRoll = isMyTurn && turnPhase === 'roll' && legal('rollDice');
  const canBuild = !paused && isMyTurn && turnPhase === 'main';
  const canTrade = canBuild;
  const canPlayerTrade = canTrade && turnRole !== 'paired' && playerTradingAllowed;
  const canEnd = canBuild && legal('endTurn');
  

  const canAffordRoad = hasResources(player, BUILDING_COSTS.road) || freeRoads > 0;
  const canAffordSettlement = hasResources(player, BUILDING_COSTS.settlement);
  const canAffordCity = hasResources(player, BUILDING_COSTS.city);
  const canAffordDevCard = hasResources(player, BUILDING_COSTS.developmentCard);


  if (isMyTurn && turnPhase === 'robber') return <div className="action-panel board-choice-prompt">
    <GameIcon name={selectedAction==='pirate' ? 'pirate' : 'robber'} size={34}/>
    <h3>Move the {selectedAction==='pirate' ? 'pirate' : 'robber'}</h3>
    <p>Choose a highlighted {selectedAction==='pirate' ? 'sea tile or frame position' : 'land tile'} on the board.</p>
  </div>;

  return (
    <div className="action-panel">
      <div className="action-heading"><h3>Build & trade</h3>
        {selectedAction && canBuild && <button type="button" className="cancel-placement" onClick={() => setSelectedAction(null)} title="Cancel placement (Escape)">Cancel</button>}
      </div>
      
      {isMyTurn && turnRole === 'paired' && <p className="paired-action-note">Your extra action phase. Bank and port trades are allowed; player trades are unavailable.</p>}
      
      {/* Roll Dice */}
      {turnPhase === 'roll' && <button
        className={`action-btn roll-btn ${canRoll ? 'primary' : ''}`}
        onClick={onRollDice}
        disabled={!canRoll}
      >
        <GameIcon name="dice" size={22}/> Roll dice
      </button>}

      {/* Year of Plenty indicator */}
      {yearOfPlentyPicks > 0 && (
        <div className="special-action">
          <p>Year of Plenty: Pick {yearOfPlentyPicks} resource(s)</p>
          <button onClick={onOpenDevCards} disabled={!legal('yearOfPlentyPick')}>Choose resources</button>
        </div>
      )}

      {/* Free Roads indicator */}
      {freeRoads > 0 && (
        <div className="special-action">
          <p>Road Building: {freeRoads} free {seafarers ? 'roads or ships' : 'roads'}</p>
          <button 
            className={selectedAction === 'road' ? 'active' : ''}
            disabled={!legal('placeRoad')}
            onClick={() => setSelectedAction('road')}
          >
            Place Road
          </button>
        </div>
      )}

      {/* Build Section */}
      <div className="action-section build-actions" role="group" aria-label="Build costs">
        <h4>Build</h4>
        
        <button
          className={`action-btn build-btn ${selectedAction === 'road' ? 'active' : ''}`}
          aria-label="Road — costs 1 brick and 1 lumber"
          aria-pressed={selectedAction === 'road'}
          onClick={() => setSelectedAction(selectedAction === 'road' ? null : 'road')}
          disabled={!canBuild || !legal('placeRoad') || (!canAffordRoad && freeRoads === 0)}
        >
          <BuildingPiece kind="road" color={player.color}/>
          <span className="btn-label">Road</span>
          <span className="cost"><span title="1 brick"><GameIcon name="brick" size={16}/>1</span><span title="1 lumber"><GameIcon name="lumber" size={16}/>1</span></span>
        </button>

        {seafarers && <button type="button" className={`action-btn build-btn ${selectedAction==='ship'?'active':''}`} aria-pressed={selectedAction==='ship'} aria-label="Ship — costs 1 lumber and 1 wool" disabled={!legal('placeShip')} onClick={()=>setSelectedAction(selectedAction==='ship'?null:'ship')}>
          <SeafarersPiece color={player.color}/><span className="btn-label">Ship</span><span className="cost"><span title="1 lumber"><GameIcon name="lumber" size={16}/>1</span><span title="1 wool"><GameIcon name="wool" size={16}/>1</span></span>
        </button>}

        <button
          className={`action-btn build-btn ${selectedAction === 'settlement' ? 'active' : ''}`}
          aria-label="Settlement — costs 1 brick, 1 lumber, 1 wool and 1 grain"
          aria-pressed={selectedAction === 'settlement'}
          onClick={() => setSelectedAction(selectedAction === 'settlement' ? null : 'settlement')}
          disabled={!canBuild || !legal('placeSettlement') || !canAffordSettlement || player.settlements <= 0}
        >
          <BuildingPiece kind="settlement" color={player.color}/>
          <span className="btn-label">Settlement</span>
          <span className="cost"><span title="1 brick"><GameIcon name="brick" size={16}/>1</span><span title="1 lumber"><GameIcon name="lumber" size={16}/>1</span><span title="1 wool"><GameIcon name="wool" size={16}/>1</span><span title="1 grain"><GameIcon name="grain" size={16}/>1</span></span>
        </button>

        <button
          className={`action-btn build-btn ${selectedAction === 'city' ? 'active' : ''}`}
          aria-label="City — costs 3 ore and 2 grain"
          aria-pressed={selectedAction === 'city'}
          onClick={() => setSelectedAction(selectedAction === 'city' ? null : 'city')}
          disabled={!canBuild || !legal('upgradeToCity') || !canAffordCity || player.cities <= 0}
        >
          <BuildingPiece kind="city" color={player.color}/>
          <span className="btn-label">City</span>
          <span className="cost"><span title="3 ore"><GameIcon name="ore" size={16}/>3</span><span title="2 grain"><GameIcon name="grain" size={16}/>2</span></span>
        </button>

        <button
          className="action-btn build-btn dev-card-btn"
          aria-label="Buy development card — costs 1 ore, 1 grain and 1 wool"
          onClick={onBuyDevCard}
          disabled={!canBuild || !legal('buyDevCard') || !canAffordDevCard || devCardsLeft === 0}
        >
          <BuildingPiece kind="development"/>
          <span className="btn-label">Development</span>
          <span className="cost"><span title="1 ore"><GameIcon name="ore" size={16}/>1</span><span title="1 grain"><GameIcon name="grain" size={16}/>1</span><span title="1 wool"><GameIcon name="wool" size={16}/>1</span></span>
          {devCardsLeft <= 5 && <span className="remaining">({devCardsLeft} left)</span>}
        </button>
      </div>

      {/* Trade Section */}
      <div className="action-section trade-actions">
        <h4>Trade</h4>
        
        <button
          className="action-btn trade-btn"
          aria-label="Trade with bank"
          onClick={() => onOpenTrade('bank')}
          disabled={!canTrade || freeRoads > 0 || yearOfPlentyPicks > 0}
        >
          <GameIcon name="bank" size={22}/> Bank
        </button>
      <button className="action-btn trade-btn" aria-label={turnRole !== 'paired' && playerTradingAllowed ? 'Trade with player' : 'Player trades unavailable during the extra action phase'} title={turnRole === 'paired' || !playerTradingAllowed ? 'Player trades are unavailable during the extra action phase' : undefined} onClick={() => onOpenTrade('player')} disabled={!canPlayerTrade || freeRoads > 0 || yearOfPlentyPicks > 0}>
        <GameIcon name="trade" size={22}/> Players
      </button>

      </div>

      {/* End Turn */}
      <button 
        className={`action-btn end-turn-btn ${canEnd ? 'highlight' : ''}`}
        onClick={onEndTurn}
        disabled={!canEnd}
      >
        <GameIcon name="endTurn" size={20}/> End turn
      </button>
    </div>
  );
}

export default ActionPanel;
