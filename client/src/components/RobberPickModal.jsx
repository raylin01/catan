import {useEffect,useRef,useState} from 'react';
import GameIcon from './GameIcon';
import './RobberPickModal.css';

export default function RobberPickModal({pick,victimName,onPick,paused}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const panel=useRef(null);
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
    <div className="robber-card-fan">{pick.cardIds.map((id,index)=><button key={id} type="button" className="robber-hidden-card" aria-label={`Choose face-down card ${index+1} of ${pick.cardIds.length}`} disabled={busy||paused} onClick={()=>choose(id)}><GameIcon name="cards" size={30}/><span>{index+1}</span></button>)}</div>
    <p className="robber-pick-footnote">{busy?'Taking your card…':`${pick.cardIds.length} resource cards`}</p>
  </section></div>;
}
