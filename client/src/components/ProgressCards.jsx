import {CITIES_KNIGHTS_CARDS} from '../../../shared/citiesKnights.js';
import CardArtwork from './CardArtwork';
import GameIcon from './GameIcon';
import {useDialogFocus} from '../presentation/useDialogFocus';
import {friendly} from './citiesKnightsView';
export function ProgressCard({card,onClick,disabled=false,buttonLabel}) {const info=CITIES_KNIGHTS_CARDS[card.type];return <article className={`ck-progress-card track-${card.color||info?.color}`}>
  <div className="ck-progress-art"><CardArtwork name={card.type}/></div><h3>{info?.name||friendly(card.type)}</h3><p>{info?.help}</p>
  {onClick&&<button type="button" className="room-primary-button" disabled={disabled} onClick={onClick}>{buttonLabel||`Play ${info?.name||'card'}`}</button>}
</article>;}
export function ProgressBack({color,count=1}) {return <div className={`ck-progress-back track-${color}`} role="img" aria-label={`${count} ${friendly(color)} progress cards`}><GameIcon name={color} size={30}/><span>{friendly(color)}</span>{count>1&&<strong>{count}</strong>}</div>;}
export default function ProgressCards({player,legalActions=[],paused,onAction,onClose,replay=false}) {const ref=useDialogFocus(onClose);const cards=Array.isArray(player.progressCards)?player.progressCards:[];return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="ck-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="ck-progress-title" tabIndex={-1} ref={ref}>
  <header><h2 id="ck-progress-title">Progress cards {!replay&&<small>{cards.length} / 4</small>}</h2><button type="button" aria-label="Close progress cards" onClick={onClose}><GameIcon name="close"/></button></header>
  {!cards.length&&<p>No progress cards in hand. City improvements let you draw when the event die matches your track.</p>}
  <div className="ck-progress-grid">{cards.map(card=>{const action=legalActions.find(a=>a.type==='playProgressCard'&&a.payload.cardId===card.id);return <ProgressCard key={card.id} card={card} disabled={paused||!action} onClick={replay?null:()=>{onAction(action);onClose();}}/>;})}</div>
  {!!player.progressVictoryCards?.length&&<><h3>Face-up victory points</h3><div className="ck-progress-grid">{player.progressVictoryCards.map((card,i)=><ProgressCard key={i} card={card}/>)}</div></>}
</section></div>;}
