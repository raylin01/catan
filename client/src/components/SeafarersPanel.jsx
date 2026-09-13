import {useState} from 'react';
import GameIcon from './GameIcon';
import SeafarersPiece from './SeafarersPiece';
import {WONDERS, scenarioName, scenarioObjective, scenarioRules, pendingChoiceStatus} from './seafarersView';
import './Seafarers.css';

export function SeafarersChoice({game, playerId, legalActions, onAction, paused}) {
  const choice = game.pendingChoice;
  if (!choice) return null;
  const mine = choice.actorId === playerId;
  const validOptions = new Set(legalActions.filter(action => action.type === 'resolveSeafarersChoice' && action.payload.choiceId === choice.id).map(action=>action.payload.optionId));
  const spatial = (choice.options || []).some(option => option.edgeKey || option.vertexKey || option.hexKey);
  return <section className={`seafarers-choice ${mine ? 'is-acting' : ''}`} aria-label="Scenario choice">
    <h3>{pendingChoiceStatus(game, playerId)}</h3>
    {mine && <>
      {spatial && <p>Choose a highlighted location on the board.</p>}
      {!spatial && <div className="seafarers-choice-options">
        {(choice.options || []).map(option => <button type="button" key={option.id}
          disabled={paused || !validOptions.has(option.id)} onClick={()=>onAction({type:'resolveSeafarersChoice',payload:{choiceId:choice.id,optionId:option.id}})}>
          {option.resource && <GameIcon name={option.resource} size={28}/>}{option.label}
        </button>)}
      </div>}
    </>}
  </section>;
}

export default function SeafarersPanel({game,playerId,legalActions=[],onAction,selectedAction,setSelectedAction,shipSource,paused=false,replay=false}) {
  const [detailsOpen,setDetailsOpen] = useState(false);
  const [wonderChoice,setWonderChoice] = useState('');
  const state = game.seafarers;
  if (!state) return null;
  const allowed = type => legalActions.some(action=>action.type===type);
  const choose = action => setSelectedAction(selectedAction === action ? null : action);
  const ownFortress = state.fortresses?.find(item=>item.ownerId===playerId);
  const ownPlayer = game.players.find(player=>player.id===playerId);
  const lastAttack = state.lastFortressAttack;
  const claimActions=legalActions.filter(action=>action.type==='claimWonder');
  const claimAction=claimActions.find(action=>action.payload.wonderId===wonderChoice) || claimActions[0];
  const ownWonder=state.wonders?.find(wonder=>wonder.ownerId===playerId);
  const selectedWonder=WONDERS.find(wonder=>wonder.id===(ownWonder?.id || claimAction?.payload.wonderId));
  const buildAction=legalActions.find(action=>action.type==='buildWonder');
  return <section className="seafarers-panel" aria-label="Seafarers scenario">
    <div className="scenario-heading"><GameIcon name="ship" size={20}/><h3>{scenarioName(game)}</h3></div>
    <p className="scenario-goal"><GameIcon name="trophy" size={15}/>{scenarioObjective(game)}</p>
    {!replay && <SeafarersChoice game={game} playerId={playerId} legalActions={legalActions} onAction={onAction} paused={paused}/>}
    {!replay && !game.pendingChoice && <>
      {game.phase === 'setup' && (allowed('placeRoad') || allowed('placeShip')) && <div className="setup-route-choice" role="group" aria-label="Starting route">
        <button type="button" disabled={paused || !allowed('placeRoad')} aria-pressed={selectedAction==='road'} onClick={()=>setSelectedAction('road')}><GameIcon name="road"/>Road</button>
        <button type="button" disabled={paused || !allowed('placeShip')} aria-pressed={selectedAction==='ship'} onClick={()=>setSelectedAction('ship')}><GameIcon name="ship"/>Ship</button>
      </div>}
      {allowed('placePort') && <p className="seafarers-target-instruction"><GameIcon name="port" size={20}/>Place the {state.currentPortType === 'generic' ? '3:1' : `${state.currentPortType === 'wood' ? 'lumber' : state.currentPortType} 2:1`} harbor on a highlighted coast.</p>}
      {allowed('moveShip') && <button className={`action-btn seafarers-move ${selectedAction==='moveShip'?'active':''}`} type="button" disabled={paused} aria-pressed={selectedAction==='moveShip'} onClick={()=>choose('moveShip')}><SeafarersPiece color={ownPlayer?.color}/><span>Move a ship</span><GameIcon name="trade" size={17}/></button>}
      {selectedAction === 'moveShip' && <p className="seafarers-target-instruction">{shipSource ? 'Choose a highlighted destination. Select another ship to change the source.' : 'Choose a highlighted ship to move.'}</p>}
      {allowed('movePirate') && <div className="setup-route-choice" role="group" aria-label="Move robber or pirate">
        {allowed('moveRobber') && <button type="button" disabled={paused} aria-pressed={selectedAction!=='pirate'} onClick={()=>setSelectedAction('robber')}><GameIcon name="robber"/>Robber</button>}
        <button type="button" disabled={paused} aria-pressed={selectedAction==='pirate' || !allowed('moveRobber')} onClick={()=>setSelectedAction('pirate')}><GameIcon name="pirate"/>Pirate</button>
      </div>}
      {allowed('attackFortress') && <div className="fortress-action"><button type="button" className="action-btn" disabled={paused} onClick={()=>onAction({type:'attackFortress',payload:{}})}><SeafarersPiece kind="fortress" color={ownPlayer?.color}/>Attack fortress & end turn</button><p>{ownPlayer?.warships || 0} warships · {ownFortress?.lairs ?? 3} lairs remain. Roll below your warships to remove one lair; a tie loses one ship, a loss two.</p></div>}
    </>}
    {!replay && selectedWonder && <div className="wonder-current">
      {ownWonder ? <p className="scenario-progress"><GameIcon name={selectedWonder.icon} size={20}/>{selectedWonder.name} · Level {ownWonder.level} / 4</p> : <label>Claim a wonder<select value={claimAction.payload.wonderId} disabled={paused} onChange={event=>setWonderChoice(event.target.value)}>{claimActions.map(action=><option key={action.payload.wonderId} value={action.payload.wonderId}>{WONDERS.find(wonder=>wonder.id===action.payload.wonderId)?.name}</option>)}</select></label>}
      {(claimAction || buildAction) && <><div className="wonder-cost">{Object.entries(selectedWonder.cost).map(([resource,count])=><span key={resource} title={`${count} ${resource}`}><GameIcon name={resource} size={16}/>{count}</span>)}<small>per level</small></div><button type="button" className="room-secondary-button" disabled={paused} onClick={()=>onAction(ownWonder ? buildAction : claimAction)}>{ownWonder ? `Build level ${ownWonder.level+1}` : 'Claim wonder'}</button></>}
    </div>}
    {state.scenario === 'cloth_for_catan'  && <p className="scenario-progress"><GameIcon name="cloth" size={18}/>{state.villages?.filter(village=>village.cloth===0).length || 0} / 5 villages empty · {state.clothSupply} cloth in supply</p>}
    {state.scenario === 'the_pirate_islands' && <>
      {ownFortress && <p className="scenario-progress"><GameIcon name="fortress" size={18}/>{ownFortress.capturedBy ? 'Your fortress is recaptured' : `Your fortress: ${ownFortress.lairs} lairs`}</p>}
      {lastAttack && <p className="scenario-progress" role="status">{game.players.find(player=>player.id===lastAttack.playerId)?.name} rolled {lastAttack.die}: {lastAttack.lostShips ? `${lastAttack.lostShips} ships lost` : 'one lair removed'} · action phase ended</p>}
    </>}
    <details className="scenario-details" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>Scenario rules{state.scenario==='the_wonders_of_catan' ? ' & wonders' : ''}</summary>
      <p>{scenarioRules(game)}</p>
      {state.scenario === 'the_wonders_of_catan' && <div className="wonder-list">
        {WONDERS.filter((_,index)=>game.players.length>=5 || index<5).map(definition=>{
          const wonder=state.wonders?.find(item=>item.id===definition.id);
          const owner=game.players.find(player=>player.id===wonder?.ownerId);
          const claim=legalActions.find(action=>action.type==='claimWonder' && action.payload.wonderId===definition.id);
          const build=wonder?.ownerId===playerId && legalActions.find(action=>action.type==='buildWonder');
          return <article className="wonder-entry" key={definition.id}>
            <div className="wonder-title"><GameIcon name={definition.icon} size={23}/><strong>{definition.name}</strong>{owner && <span style={{color:owner.color}}>{owner.name}</span>}</div>
            <div className="wonder-track" aria-label={`${wonder?.level||0} of 4 levels completed`}>{[1,2,3,4].map(level=><span key={level} className={level<=(wonder?.level||0)?'complete':''}>{level}</span>)}</div>
            <p>{definition.requirement}</p>
            <div className="wonder-cost" aria-label="Cost per level">{Object.entries(definition.cost).map(([resource,count])=><span key={resource} title={`${count} ${resource}`}><GameIcon name={resource} size={16}/>{count}</span>)}<small>per level</small></div>
            {!replay && (claim || build) && <button type="button" disabled={paused} className="room-secondary-button" onClick={()=>onAction(claim || build)}>{claim ? `Claim ${definition.name}` : `Build level ${(wonder?.level||0)+1}`}</button>}
          </article>;
        })}
      </div>}
      <p className="scenario-setup">{state.layout === 'variable' ? 'Variable layout' : 'Official fixed layout'} · Seed {state.seed}</p>
    </details>
  </section>;
}
