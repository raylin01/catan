import GameIcon from './GameIcon';
import BuildingPiece from './BuildingPiece';
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
  isSpecialBuildPhase = false,
  isMySpecialBuild = false
}) {
  const canRoll = isMyTurn && turnPhase === 'roll';
  
  // During special build phase, the player can build but not trade or roll
  const canBuild = (isMyTurn && turnPhase === 'main') || isMySpecialBuild;
  const canTrade = isMyTurn && turnPhase === 'main' && !isSpecialBuildPhase;
  const canEnd = isMyTurn && turnPhase === 'main' && !isSpecialBuildPhase;
  

  const canAffordRoad = hasResources(player, BUILDING_COSTS.road) || freeRoads > 0;
  const canAffordSettlement = hasResources(player, BUILDING_COSTS.settlement);
  const canAffordCity = hasResources(player, BUILDING_COSTS.city);
  const canAffordDevCard = hasResources(player, BUILDING_COSTS.developmentCard);


  if (isMyTurn && turnPhase === 'robber') return <div className="action-panel board-choice-prompt">
    <GameIcon name="robber" size={34}/>
    <h3>Move the robber</h3>
    <p>Choose a glowing tile on the board. You can then steal from a player beside it.</p>
  </div>;

  return (
    <div className="action-panel">
      <div className="action-heading"><h3>Build & trade</h3>
        {selectedAction && canBuild && <button type="button" className="cancel-placement" onClick={() => setSelectedAction(null)} title="Cancel placement (Escape)">Cancel</button>}
      </div>
      
      {/* Special Build Phase indicator */}
      {isMySpecialBuild && (
        <div className="special-build-indicator">
          Special Building Phase
          <span className="no-trade-hint">(No trading allowed)</span>
        </div>
      )}
      
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
          <button onClick={onOpenDevCards}>Choose Resources</button>
        </div>
      )}

      {/* Free Roads indicator */}
      {freeRoads > 0 && (
        <div className="special-action">
          <p>Road Building: {freeRoads} free road(s)</p>
          <button 
            className={selectedAction === 'road' ? 'active' : ''}
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
          disabled={!canBuild || (!canAffordRoad && freeRoads === 0)}
        >
          <BuildingPiece kind="road" color={player.color}/>
          <span className="btn-label">Road</span>
          <span className="cost"><span title="1 brick"><GameIcon name="brick" size={16}/>1</span><span title="1 lumber"><GameIcon name="lumber" size={16}/>1</span></span>
        </button>

        <button
          className={`action-btn build-btn ${selectedAction === 'settlement' ? 'active' : ''}`}
          aria-label="Settlement — costs 1 brick, 1 lumber, 1 wool and 1 grain"
          aria-pressed={selectedAction === 'settlement'}
          onClick={() => setSelectedAction(selectedAction === 'settlement' ? null : 'settlement')}
          disabled={!canBuild || !canAffordSettlement || player.settlements <= 0}
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
          disabled={!canBuild || !canAffordCity || player.cities <= 0}
        >
          <BuildingPiece kind="city" color={player.color}/>
          <span className="btn-label">City</span>
          <span className="cost"><span title="3 ore"><GameIcon name="ore" size={16}/>3</span><span title="2 grain"><GameIcon name="grain" size={16}/>2</span></span>
        </button>

        <button
          className="action-btn build-btn dev-card-btn"
          aria-label="Buy development card — costs 1 ore, 1 grain and 1 wool"
          onClick={onBuyDevCard}
          disabled={!canBuild || !canAffordDevCard || devCardsLeft === 0}
        >
          <BuildingPiece kind="development"/>
          <span className="btn-label">Development</span>
          <span className="cost"><span title="1 ore"><GameIcon name="ore" size={16}/>1</span><span title="1 grain"><GameIcon name="grain" size={16}/>1</span><span title="1 wool"><GameIcon name="wool" size={16}/>1</span></span>
          {devCardsLeft <= 5 && <span className="remaining">({devCardsLeft} left)</span>}
        </button>
      </div>

      {/* Trade Section */}
      <div className="action-section trade-actions">
        <h4>Trade {isMySpecialBuild && <span className="disabled-hint">(disabled)</span>}</h4>
        
        <button
          className="action-btn trade-btn"
          aria-label="Trade with bank"
          onClick={() => onOpenTrade('bank')}
          disabled={!canTrade || freeRoads > 0 || yearOfPlentyPicks > 0}
        >
          <GameIcon name="bank" size={22}/> Bank
        </button>
      <button className="action-btn trade-btn" aria-label="Trade with player" onClick={() => onOpenTrade('player')} disabled={turnPhase !== 'main' || isSpecialBuildPhase || freeRoads > 0 || yearOfPlentyPicks > 0}>
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

