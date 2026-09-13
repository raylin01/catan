import {useEffect,useRef,useState} from 'react';
import GameIcon from './GameIcon';
import './RobberPickModal.css';

export default function RobberPickModal({pick,victimName,onPick,paused}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const panel=useRef(null);
  const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:600px)').matches);
  useEffect(()=>{
    const media=window.matchMedia('(max-width:600px)'), update=()=>setNarrow(media.matches);
    media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  const rowSize=narrow?6:12;
  const rows=Array.from({length:Math.ceil(pick.cardIds.length/rowSize)},(_,row)=>pick.cardIds.slice(row*rowSize,(row+1)*rowSize));
  useEffect(()=>{
    const previous=document.activeElement;
    panel.current?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[pick.id]);
  const choose=async cardId=>{
    if(busy||paused)return;
    setBusy(true);setError('');
    try{const result=await onPick(cardId);if(!result?.success)setError(result?.error||'Could not take that card.');}
    catch{setError('Connection interrupted. Try the same card again.');}
    finally{setBusy(false);}
  };
  return <div className="modal-overlay"><section className="robber-pick-modal" role="dialog" aria-modal="true" aria-labelledby="robber-pick-title" ref={panel} tabIndex={-1} onKeyDown={e=>{
    if(e.key!=='Tab')return;
    const buttons=[...panel.current.querySelectorAll('button:not(:disabled)')];
    if(!buttons.length){e.preventDefault();return;}
    if(e.shiftKey&&(document.activeElement===buttons[0]||document.activeElement===panel.current)){e.preventDefault();buttons.at(-1).focus();}
    else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0].focus();}
  }}>
    <GameIcon name="robber" size={32}/>
    <h2 id="robber-pick-title">Choose a card from {victimName}</h2>
    <p>The cards are shuffled and face down. Pick one to steal.</p>
    {paused&&<p className="robber-pick-message">The room is paused.</p>}
    {error&&<p className="robber-pick-message" role="alert">{error}</p>}
    <div className="robber-card-fan">{rows.map((cards,row)=><div className="robber-fan-row" key={row} style={{'--fan-count':cards.length}}>{cards.map((id,index)=>{
      const distance=cards.length>1?Math.abs(index-(cards.length-1)/2)/((cards.length-1)/2):0;
      return <button key={id} type="button" className="robber-hidden-card" style={{'--fan-drop':`${distance*distance*19}px`}} aria-label={`Choose face-down card ${row*rowSize+index+1} of ${pick.cardIds.length}`} disabled={busy||paused} onClick={()=>choose(id)}><svg viewBox="0 0 32 44" aria-hidden="true"><path d="M16 35V9m0 8c-7 0-9-5-9-8 6 0 9 4 9 8Zm0 7c7 0 9-5 9-8-6 0-9 4-9 8Zm0 6c-7 0-9-5-9-8 6 0 9 4 9 8Zm0-20c0-4 3-6 3-6 1 5 0 8-3 10"/></svg><span>{row*rowSize+index+1}</span></button>;
    })}</div>)}</div>
    <p className="robber-pick-footnote">{busy?'Taking your card…':`${pick.cardIds.length} resource cards`}</p>
  </section></div>;
}
