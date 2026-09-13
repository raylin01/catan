import {CITIES_KNIGHTS_CARDS} from '../../../shared/citiesKnights.js';
export const CITY_TRACKS = [
  {id:'science',name:'Science',commodity:'paper',color:'#7eaa75',ability:'Aqueduct: choose a resource when a production roll gives you none.'},
  {id:'trade',name:'Trade',commodity:'cloth',color:'#d3ab59',ability:'Merchant Guild: trade every commodity with the bank at 2:1.'},
  {id:'politics',name:'Politics',commodity:'coin',color:'#799fc0',ability:'Fortress: promote strong knights to mighty knights.'},
];
export const CK_ACTION_NAMES={recruitKnight:'Recruit knight',promoteKnight:'Promote knight',activateKnight:'Activate knight',moveKnight:'Move knight',driveRobber:'Drive away robber or pirate',buildCityWall:'Build city wall',improveCity:'Improve city'};
export const CK_ACTION_COSTS={recruitKnight:{wool:1,ore:1},promoteKnight:{wool:1,ore:1},activateKnight:{grain:1},buildCityWall:{brick:2}};
export const friendly = value => CITIES_KNIGHTS_CARDS[value]?.name || String(value || '').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
export const vertexPoint=key=>{const m=key?.match(/^v_(-?\d+)_(-?\d+)_(\d+)$/);if(!m)return null;const q=+m[1],r=+m[2],a=(90-60*+m[3])*Math.PI/180;return {x:50*Math.sqrt(3)*(q+r/2)+50*Math.cos(a),y:75*r-50*Math.sin(a)};};
export const hexPoint=key=>{const [q,r]=String(key).split(',').map(Number);return Number.isFinite(q)&&Number.isFinite(r)?{x:50*Math.sqrt(3)*(q+r/2),y:75*r}:null;};
export const positionId=p=>p?`${Math.round(p.x*10)},${Math.round(p.y*10)}`:'';
export function ckBoardActions(actions,selected,source) {const [type,track]=String(selected||'').split(':');return actions.filter(a=>a.type===type&&(!track||a.payload.track===track)&&(!source||!['moveKnight','driveRobber'].includes(type)||(a.payload.fromVertexKey||a.payload.vertexKey)===source));}
export function ckCommand(type,p={}) {
  const fields={buildCityWall:['vertexKey'],improveCity:['track','vertexKey'],recruitKnight:['vertexKey'],promoteKnight:['vertexKey'],activateKnight:['vertexKey'],moveKnight:['fromVertexKey','toVertexKey'],driveRobber:['vertexKey','hexKey','stealFromPlayerId','stealType'],playProgressCard:['cardId'],offerCommercialHarbor:['targetPlayerId','resource'],resolveCitiesKnightsChoice:['choiceId','optionId','cards']}[type];
  return fields?{type,payload:Object.fromEntries(fields.filter(key=>p[key]!==undefined).map(key=>[key,p[key]]))}:null;
}

export function choiceVariants(choice) {
  const field=(choice?.options||[]).some(o=>o.track)?'track':(choice?.options||[]).some(o=>o.strength)?'strength':null;
  const values=field?[...new Set(choice.options.filter(o=>o[field]!=null).map(o=>String(o[field])))]:[];
  return {field,values};
}
export function choiceForVariant(choice,variant) {
  if(!choice)return choice;
  const {field,values}=choiceVariants(choice);
  const selected=values.includes(String(variant))?String(variant):values[0];
  const options=field?choice.options.filter(o=>o[field]==null||String(o[field])===selected):choice.options||[];
  if(choice.expansion!=='cities_knights')return field?{...choice,options}:choice;
  const seen=new Set();
  return {...choice,options:options.filter(option=>{
    const position=option.vertexKey?positionId(vertexPoint(option.vertexKey)):option.hexKey;
    if(!position)return true;
    const key=JSON.stringify([position,option.track,option.strength,option.resource,option.commodity,option.cardId,option.kind]);
    if(seen.has(key))return false;seen.add(key);return true;
  })};
}

export function ckPieceChanges(previous,next) {
  const result={knights:{},removed:[],tokens:false,merchant:null};if(!previous||!next)return result;
  const old=previous.knights||{},current=next.knights||{},consumed=new Set();
  for(const [key,knight] of Object.entries(current)) {
    if(JSON.stringify(old[key])===JSON.stringify(knight))continue;
    const from=Object.entries(old).find(([k,v])=>k!==key&&!current[k]&&!consumed.has(k)&&v.ownerId===knight.ownerId&&v.strength===knight.strength);
    if(from)consumed.add(from[0]);const a=from&&vertexPoint(from[0]),b=vertexPoint(key);
    result.knights[key]=a&&b?{x:a.x-b.x,y:a.y-b.y}:{x:0,y:0};
  }
  result.removed=Object.entries(old).filter(([key])=>!current[key]&&!consumed.has(key)).map(([key,knight])=>({key,knight}));
  result.tokens=['walls','metropolises'].some(field=>JSON.stringify(previous[field])!==JSON.stringify(next[field]));
  if(JSON.stringify(previous.merchant)!==JSON.stringify(next.merchant)) {const a=hexPoint(previous.merchant?.hexKey),b=hexPoint(next.merchant?.hexKey);result.merchant=a&&b?{x:a.x-b.x,y:a.y-b.y}:{x:0,y:0};}
  return result;
}

export function ckTargetActions(actions,type) {
 if(type!=='driveRobber')return actions.slice(0,1);
 const seen=new Set();return actions.filter(action=>{const key=JSON.stringify([action.payload.hexKey,action.payload.stealFromPlayerId||null,action.payload.stealType||'resource']);if(seen.has(key))return false;seen.add(key);return true;});
}
