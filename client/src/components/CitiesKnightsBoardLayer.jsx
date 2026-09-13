import {framePoint} from './seafarersView';
import {useEffect,useRef,useState} from 'react';
import {KnightShape,WallShape,MetropolisShape,MerchantShape} from './CitiesKnightsPiece';
import {CK_ACTION_NAMES,CITY_TRACKS,vertexPoint,hexPoint,positionId,ckBoardActions,ckPieceChanges,ckTargetActions} from './citiesKnightsView';
import {useGamePresentation} from '../presentation/GamePresentation';
const keyActivate=(e,fn)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}};
export default function CitiesKnightsBoardLayer({state,players,legalActions=[],selectedAction,source,onSelectSource,onAction,onMultiple,paused,animate=true,resetKey,pendingChoice,playbackRate=1,bounds,hexes={}}) {
  const prior=useRef(null),[motion,setMotion]=useState({});const {playSound}=useGamePresentation();
  const signature=JSON.stringify([state?.knights,state?.walls,state?.metropolises,state?.merchant]);
  useEffect(()=>{const previous=prior.current;prior.current={state,resetKey};if(!previous||previous.resetKey!==resetKey||!animate||!state){setMotion({});return;}
    const changes=ckPieceChanges(previous.state,state);
    if(Object.keys(changes.knights).length||changes.removed.length||changes.tokens||changes.merchant){setMotion(changes);playSound('piece');}
    const timer=setTimeout(()=>setMotion({}),600/playbackRate);return()=>clearTimeout(timer);
  },[signature,resetKey,animate,playSound]);
  if(!state)return null;
  const owner=id=>players.find(p=>p.id===id);
  const actions=!paused?ckBoardActions(legalActions,selectedAction,source):[];
  const moving=['moveKnight','driveRobber'].includes(selectedAction);
  const targets=new Map();
  for(const action of actions){const p=action.payload;const key=moving&&!source?(p.fromVertexKey||p.vertexKey):selectedAction==='moveKnight'?p.toVertexKey:selectedAction==='driveRobber'?p.hexKey:p.vertexKey;const point=selectedAction==='driveRobber'&&source?(key?.startsWith('frame:')?framePoint(key,bounds):hexPoint(key)):vertexPoint(key);if(!point)continue;const id=positionId(point);const target=targets.get(id)||{point,key,actions:[]};target.actions.push(action);targets.set(id,target);}
  return <g className={`ck-board-layer ${pendingChoice?'has-pending-choice':''}`} style={{'--ck-motion-duration':`${600/playbackRate}ms`}}>
    {Object.entries(state.walls).map(([key,id])=>{const p=vertexPoint(key);return p&&<g key={`wall-${key}`} transform={`translate(${p.x} ${p.y})`} role="img" aria-label={`${owner(id)?.name} city wall`}><g className={motion.tokens?'ck-piece-enter':''}><WallShape color={owner(id)?.color}/></g></g>;})}
    {Object.entries(state.metropolises).filter(([,m])=>m.ownerId&&m.vertexKey).map(([track,m])=>{const p=vertexPoint(m.vertexKey);return p&&<g key={track} transform={`translate(${p.x} ${p.y})`} role="img" aria-label={`${owner(m.ownerId)?.name} ${track} metropolis${m.permanent?', secured':''}`}><g className={motion.tokens?'ck-piece-enter':''}><MetropolisShape color={CITY_TRACKS.find(t=>t.id===track)?.color}/></g></g>;})}
    {Object.entries(state.knights).map(([key,k])=>{const p=vertexPoint(key);return p&&<g key={key} transform={`translate(${p.x} ${p.y})`} role="img" aria-label={`${owner(k.ownerId)?.name} ${k.active?'active':'inactive'} ${['basic','strong','mighty'][k.strength-1]} knight, strength ${k.strength}`}><title>{`${owner(k.ownerId)?.name}: ${k.active?'active':'inactive'} knight · strength ${k.strength}`}</title><g className={motion.knights?.[key]?'ck-piece-move':''} style={{'--ck-from-x':`${motion.knights?.[key]?.x||0}px`,'--ck-from-y':`${motion.knights?.[key]?.y||0}px`}}><KnightShape color={owner(k.ownerId)?.color} strength={k.strength} active={k.active}/></g></g>;})}
    {state.merchant.hexKey&&(()=>{const p=hexPoint(state.merchant.hexKey);return p&&<g transform={`translate(${p.x+24} ${p.y+15})`} role="img" aria-label={`${owner(state.merchant.ownerId)?.name} merchant`}><g className={motion.merchant?'ck-piece-move':''} style={{'--ck-from-x':`${motion.merchant?.x||0}px`,'--ck-from-y':`${motion.merchant?.y||0}px`}}><MerchantShape color={owner(state.merchant.ownerId)?.color}/></g></g>;})()}
    {(motion.removed||[]).map(({key,knight})=>{const p=vertexPoint(key);return p&&<g key={`depart-${key}`} transform={`translate(${p.x} ${p.y})`} aria-hidden="true" pointerEvents="none"><g className="ck-piece-leave"><KnightShape color={owner(knight.ownerId)?.color} strength={knight.strength} active={knight.active}/></g></g>;})}
    {[...targets].map(([id,target])=>{const selecting=moving&&!source;const label=selecting?'Select knight':selectedAction==='moveKnight'?'Move knight here':selectedAction==='driveRobber'?target.key.startsWith('frame:')?`Drive pirate to ${target.key.slice(6)} frame`:hexes[target.key]?.terrain==='sea'?`Drive pirate to sea tile at ${target.key}`:`Drive robber to ${hexes[target.key]?.terrain||'land'} at ${target.key}`:CK_ACTION_NAMES[String(selectedAction).split(':')[0]];const targetActions=ckTargetActions(target.actions,selectedAction);const act=()=>selecting?onSelectSource(target.key):targetActions.length===1?onAction(targetActions[0]):onMultiple(targetActions);return <g key={id} transform={`translate(${target.point.x} ${target.point.y})`} className="ck-board-target" role="button" tabIndex={0} aria-label={label} onClick={act} onKeyDown={e=>keyActivate(e,act)}><circle r="23" fill="transparent"/><circle className="choice-aura" r="22"/><circle className="vertex-placeholder-halo" r="17" fillOpacity=".16"/><title>{label}</title></g>;})}
  </g>;
}
