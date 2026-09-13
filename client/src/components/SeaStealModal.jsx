import GameIcon from './GameIcon';
import {useDialogFocus} from '../presentation/useDialogFocus';
export default function SeaStealModal({actions,players,paused,onAction,onClose}) {
  const ref=useDialogFocus(onClose);
  return <div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={ref} className="steal-modal" role="dialog" aria-modal="true" aria-labelledby="sea-steal-title" tabIndex={-1}>
    <h3 id="sea-steal-title">Choose what to steal</h3><div className="steal-options">{actions.map((action,index)=>{
      const victim=players.find(player=>player.id===action.payload.stealFromPlayerId);
      return <button key={index} className="steal-btn" disabled={paused} onClick={()=>onAction(action)}><GameIcon name={action.payload.stealType==='cloth'?'cloth':'cards'} size={21}/>{victim ? `${victim.name} · ${action.payload.stealType==='cloth'?'1 cloth':'a resource card'}` : 'Move without stealing'}</button>;
    })}</div><button type="button" className="room-secondary-button" onClick={onClose}>Choose a different tile</button>
  </div></div>;
}
