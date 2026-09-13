import {GameIconSymbol} from './GameIcon';
import {ShipShape, FortressShape} from './SeafarersPiece';
import {framePoint} from './seafarersView';

const keyPress = (event, callback) => {if (event.key==='Enter'||event.key===' ') {event.preventDefault();callback();}};
const vertexPoint = key => {const match=key?.match(/v_(-?\d+)_(-?\d+)_(\d+)/);if(!match)return null;const q=+match[1],r=+match[2],angle=(90-60*+match[3])*Math.PI/180;return {x:50*Math.sqrt(3)*(q+r/2)+50*Math.cos(angle),y:75*r-50*Math.sin(angle)};};
const hexPoint = key => {const [q,r]=String(key).split(',').map(Number);return Number.isFinite(q)&&Number.isFinite(r)?{x:50*Math.sqrt(3)*(q+r/2),y:75*r}:null;};
const edgePoint = key => {const match=key?.match(/e_(-?\d+)_(-?\d+)_(\d+)/);if(!match)return null;const one=vertexPoint(`v_${match[1]}_${match[2]}_${match[3]}`),two=vertexPoint(`v_${match[1]}_${match[2]}_${(+match[3]+1)%6}`);return {x:(one.x+two.x)/2,y:(one.y+two.y)/2};};

export default function SeafarersBoardLayer({state,pirate,players,bounds,legalActions,onAction,paused,selectedAction,pirateMoving=false,tokensMoving=false}) {
  if (!state) return null;
  const pirateActions = !paused && (selectedAction==='pirate' || !legalActions.some(action=>action.type==='moveRobber')) ? legalActions.filter(action=>action.type==='movePirate' && action.payload.hexKey.startsWith('frame:')) : [];
  const piratePosition = pirate?.startsWith('frame:') ? framePoint(pirate,bounds) : hexPoint(pirate);
  const markerDefinitions = [['greatWallVertices','Wall','wall'],['greatBridgeVertices','Bridge','bridge'],['lighthouseVertices','Lighthouse','lighthouse']];
  return <g className="seafarers-board-layer">
    {state.fleetActive && <g className="fleet-route" aria-hidden="true">
      {(state.fleetRoute||[]).map((hex,index)=>{const point=hexPoint(`${hex.q},${hex.r}`);return point && <g key={index} transform={`translate(${point.x} ${point.y})`}><circle r={hex.noAttack?10:5}/><text y={hex.noAttack?4:2} style={hex.noAttack?{fontSize:13}:undefined}>{hex.noAttack?'!':index+1}</text>{hex.noAttack&&<title>No fleet attack at this position</title>}</g>;})}
    </g>}
    {(state.villages||[]).map((village,villageIndex)=>{
      const atVertex=vertexPoint(village.vertexKey);
      const point=atVertex || hexPoint(village.hexKey);if(!point)return null;
      const siblings=state.villages.filter(item=>item.hexKey===village.hexKey);
      const slot=siblings.findIndex(item=>item.id===village.id);
      const villageOffset=!atVertex && siblings.length>1 ? (slot-(siblings.length-1)/2)*38 : 0;
      const label=`Village ${villageIndex+1}: rolls ${village.numbers.join(' or ')}, ${village.cloth} cloth remaining`;
      return <g key={`village-${village.id}`} transform={`translate(${point.x+villageOffset} ${point.y}) scale(${atVertex?.8:siblings.length>1?.75:1})`} className={`village-token ${tokensMoving?'is-new':''}`} role="img" aria-label={label}><title>{label}</title>
        <circle r="22" fill="url(#token-face)" stroke="#795935" strokeWidth="1.5"/>
        <path d="M-15 0v-5l6-5 6 5v5M1 0v-8l6-5 7 5v8" fill="#805c3c" stroke="#5d432f" strokeWidth="1"/>
        <text y="10" textAnchor="middle" fontSize="10" fontWeight="800" fill="#493121">{village.numbers.join(' · ')}</text>
        <g transform="translate(17 17)"><circle r="10" fill="#b57d48" stroke="#4a3929"/><GameIconSymbol name="cloth" size={12} y={-1} x={-2} style={{color:'#fff0ce'}}/><text x="4" y="5" fontSize="8" fontWeight="800" fill="#fff4d9">{village.cloth}</text></g>
      </g>;
    })}
    {(state.rewards||[]).filter(reward=>!reward.collected).map(reward=>{
      const point=edgePoint(reward.edge);if(!point)return null;const card=reward.kind==='development_card';
      return <g key={`reward-${reward.id}`} transform={`translate(${point.x} ${point.y})`} className="scenario-map-token" role="img" aria-label={card?'Development card reward':'1 victory point reward'}><title>{card?'Collect a development card':'Collect 1 victory point'}</title>
        {card?<rect x="-9" y="-12" width="18" height="24" rx="2" fill="#28424b" stroke="#e3c584" strokeWidth="1.3"/>:<circle r="11" fill="url(#token-face)" stroke="#9e7335" strokeWidth="1.4"/>}
        <GameIconSymbol name={card?'devCard':'trophy'} size={15} style={{color:card?'#e5ce96':'#8b622d'}}/>
      </g>;
    })}
    {(state.collectiblePorts||[]).filter(port=>!port.collected).map(port=>{const point=edgePoint(port.edge);return point&&<g key={`harbor-${port.id}`} transform={`translate(${point.x} ${point.y})`} className="scenario-map-token" role="img" aria-label="Portable harbor reward"><title>Portable harbor: collect it with a ship, then choose its coast</title><rect x="-11" y="-11" width="22" height="22" rx="3" fill="#e4d8b4" stroke="#7b633c"/><GameIconSymbol name="port" size={17} style={{color:'#365b62'}}/></g>;})}
    {(state.bonusSettlements||[]).map((bonus,index)=>{const point=vertexPoint(bonus.vertexKey);const owner=players.find(player=>player.id===bonus.playerId);return point&&<g key={`bonus-${index}`} transform={`translate(${point.x+17} ${point.y+17})`} className={`scenario-map-token bonus-token ${tokensMoving?'is-new':''}`} role="img" aria-label={`${owner?.name}: ${bonus.points} bonus victory points`}><title>{`${owner?.name}: ${bonus.points} bonus victory points for this island`}</title><circle r="8" fill="url(#token-face)" stroke={owner?.color||'#92652d'} strokeWidth="1.8"/><text textAnchor="middle" y="3" fontSize="8" fontWeight="800" fill="#685030">{bonus.points}</text></g>;})}
    {(state.beachheads||[]).map(beachhead=>{const point=vertexPoint(beachhead.vertexKey);const owner=players.find(player=>player.id===beachhead.ownerId) || players.find(player=>state.fortresses?.some(f=>f.color===beachhead.color&&f.ownerId===player.id));return point&&<g key={`beachhead-${beachhead.vertexKey}`} transform={`translate(${point.x} ${point.y})`} className="beachhead-marker"><title>{`${owner?.name||beachhead.color} beachhead`}</title><circle r="12" fill="none" stroke={owner?.color||'#e9d5a4'} strokeWidth="2" strokeDasharray="3 2"/><path d="M-5 5V-3L0-8 5-3V5Z" fill="none" stroke={owner?.color||'#e9d5a4'} strokeWidth="1.5"/></g>;})}
    {(state.fortresses||[]).filter(fortress=>!fortress.capturedBy).map(fortress=>{
      const point=vertexPoint(fortress.vertexKey);if(!point)return null;const owner=players.find(player=>player.id===fortress.ownerId);
      return <g key={`fortress-${fortress.vertexKey}`} transform={`translate(${point.x} ${point.y})`} className={`fortress-token ${tokensMoving?'is-new':''}`} role="img" aria-label={`${owner?.name||fortress.color}'s pirate fortress: ${fortress.lairs} lairs`}><title>{`${owner?.name||fortress.color}'s pirate fortress · ${fortress.lairs} lairs`}</title><FortressShape color={owner?.color||'#a47c60'}/><g transform="translate(0 21)">{Array.from({length:fortress.lairs},(_,index)=><circle key={index} cx={(index-(fortress.lairs-1)/2)*7} r="3" fill="#ebd4a2" stroke="#665038"/>)}</g></g>;
    })}
    {markerDefinitions.flatMap(([field,label,icon])=>(state.wonderMarkers?.[field]||[]).map(key=>{const point=vertexPoint(key);return point&&<g key={`${field}-${key}`} transform={`translate(${point.x} ${point.y})`} className="wonder-map-marker" role="img" aria-label={`${label} wonder marker`}><title>{`${label} wonder marker`}</title><circle r="12" fill="#e7d9b5" fillOpacity=".92" stroke="#947141"/><GameIconSymbol name={icon} size={17} style={{color:'#644f34'}}/></g>;}))}
    {pirateActions.map(action=>{const point=framePoint(action.payload.hexKey,bounds);return <g key={action.payload.hexKey} transform={`translate(${point.x} ${point.y})`} className="pirate-frame-target" role="button" tabIndex={0} aria-label={`Move pirate to ${action.payload.hexKey.slice(6)} frame`} onClick={()=>onAction(action)} onKeyDown={event=>keyPress(event,()=>onAction(action))}><circle className="choice-aura" r="22"/><circle className="vertex-placeholder-halo" r="19"/><GameIconSymbol name="pirate" size={27} style={{color:'#f6e6b6'}}/></g>;})}
    {piratePosition && <g transform={`translate(${piratePosition.x} ${piratePosition.y})`} className="pirate-position"><g className={`pirate-piece ${pirateMoving?'is-new':''}`} role="img" aria-label={state.fleetActive?'Pirate fleet':'Pirate'}><title>{state.fleetActive?'Pirate fleet':'Pirate: adjacent ships cannot be built or moved'}</title><ShipShape color="#293b42" pirate/></g></g>}
  </g>;
}
