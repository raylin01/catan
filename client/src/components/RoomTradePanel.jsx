import {useEffect, useRef, useState} from 'react';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import './RoomTradePanel.css';

const TYPES=['brick','lumber','wool','grain','ore'];
const name=r=>r[0].toUpperCase()+r.slice(1);
const empty=()=>Object.fromEntries(TYPES.map(r=>[r,0]));
const positive=b=>Object.fromEntries(Object.entries(b).filter(([,n])=>n>0));

function Bundle({value}) {
  const entries=Object.entries(value||{}).filter(([,n])=>n>0);
  return <div className="exchange-bundle">{entries.length?entries.map(([r,n])=><span key={r}><CardArtwork name={r} className="exchange-card-art"/><strong>{n}</strong> {name(r)}</span>):<span>Nothing selected</span>}</div>;
}

function Quantities({label,value,setValue,limits,showHave=false}) {
  const update=(r,v)=>setValue(prev=>({...prev,[r]:Math.max(0,Math.min(limits[r]??95,Math.floor(Number(v)||0)))}));
  return <fieldset className="exchange-side"><legend>{label}</legend>{TYPES.map(r=><div className="exchange-resource" key={r}>
    <CardArtwork name={r} className="exchange-card-art"/><label htmlFor={`${label}-${r}`}>{name(r)}{showHave&&<small>{limits[r]||0} available</small>}</label>
    <div className="quantity-control"><button type="button" aria-label={`Remove ${r} from ${label.toLowerCase()}`} disabled={!value[r]} onClick={()=>update(r,value[r]-1)}>−</button>
    <input id={`${label}-${r}`} aria-label={`${label} ${name(r)}`} type="number" min="0" max={limits[r]??95} value={value[r]} onChange={e=>update(r,e.target.value)}/>
    <button type="button" aria-label={`Add ${r} to ${label.toLowerCase()}`} disabled={value[r]>=(limits[r]??95)} onClick={()=>update(r,value[r]+1)}>+</button></div>
  </div>)}</fieldset>;
}

export default function RoomTradePanel({snapshot,gameState,seatId,onCommand,onClose,addNotification,mode='player'}) {
  const [partner,setPartner]=useState('');
  const [give,setGive]=useState(empty),[get,setGet]=useState(empty);
  const [countering,setCountering]=useState(false);
  const [bankGive,setBankGive]=useState('brick'),[bankGet,setBankGet]=useState('ore');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
  const player=gameState.players.find(p=>p.id===seatId);
  const active=gameState.players[gameState.currentPlayerIndex];
  const occupied=new Set(snapshot.slots.filter(s=>s.occupied).map(s=>s.id));
  const partners=gameState.players.filter(p=>p.id!==seatId&&occupied.has(p.id)&&(active?.id===seatId||p.id===active?.id));
  const trade=snapshot.trade,isOfferer=trade?.from===seatId,isRecipient=trade?.to===seatId;
  const offererName=gameState.players.find(p=>p.id===trade?.from)?.name||'Offerer';
  const recipientName=gameState.players.find(p=>p.id===trade?.to)?.name||'Recipient';
  const canTrade=gameState.phase==='playing'&&gameState.turnPhase==='main'&&!snapshot.paused&&!gameState.freeRoads&&!gameState.yearOfPlentyPicks;
  const canPlayerTrade=canTrade&&gameState.turnRole!=='paired'&&gameState.playerTradingAllowed!==false;
  const ratio=gameState.tradeRatios?.[bankGive]||4;
  const bankAllowed=canTrade&&active?.id===seatId&&player?.resources?.[bankGive]>=ratio&&bankGive!==bankGet&&gameState.bankAvailable?.[bankGet];
  useEffect(()=>{if(!partners.some(p=>p.id===partner))setPartner(partners[0]?.id||'');},[partner,partners.map(p=>p.id).join(',')]);
  useEffect(()=>{setCountering(false);setError('');},[trade?.id]);
  useEffect(()=>{
    const previous=document.activeElement;dialog.current?.focus();
    const key=e=>{if(e.key==='Escape'){e.preventDefault();closeRef.current();}
      if(e.key==='Tab') {const list=[...dialog.current.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=list[0],last=list[list.length-1];
        if(!first){e.preventDefault();return;}if(!dialog.current.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();}else if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.isConnected&&previous.focus();};
  },[]);
  useEffect(()=>{if(dialog.current&&!dialog.current.contains(document.activeElement))dialog.current.focus();},[trade?.id,trade?.status,countering]);
  const send=async(type,payload,success,close=false)=>{
    if(busy)return;setBusy(true);setError('');
    try{const result=await onCommand(type,payload);if(!result?.success){setError(result?.error||'Trade could not be completed.');return false;}addNotification(success);if(close)onClose();return true;}
    catch(e){setError(e.message||'Connection failed. Try again.');return false;}finally{setBusy(false);}
  };
  const offer=async e=>{e.preventDefault();const g=positive(give),r=positive(get);
    if(!partner||!Object.keys(g).length||!Object.keys(r).length){setError('Choose at least one resource on each side.');return;}
    if(TYPES.some(t=>g[t]&&r[t])){setError('Use different resources on the two sides.');return;}
    if(await send(countering?'tradeCounter':'tradeOffer',{...(countering?{tradeId:trade?.id}:{}),to:partner,give:g,get:r},countering?'Counteroffer sent.':'Trade offer sent.'))setCountering(false);
  };
  const bank=mode==='bank';
  return <div className="modal-overlay exchange-overlay" onClick={onClose}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="exchange-title" className="exchange-dialog" onClick={e=>e.stopPropagation()}>
    <header className="exchange-header"><h2 id="exchange-title"><GameIcon name={bank?'bank':'trade'} size={26}/>{bank?'Trade with bank':'Trade with player'}</h2><button type="button" className="exchange-close" onClick={onClose} aria-label="Close trade"><GameIcon name="close" size={22}/></button></header>
    {error&&<p role="alert" className="exchange-error">{error}</p>}
    {!canTrade&&<p className="exchange-note">{snapshot.paused?'The room is paused.':'Trading is available after the roll and any required actions.'}</p>}
    {!bank&&(gameState.turnRole==='paired'||gameState.playerTradingAllowed===false)&&<p className="exchange-note">Player trades are unavailable during the extra action phase. Bank and port trades are allowed.</p>}
    {bank? <form onSubmit={e=>{e.preventDefault();if(bankAllowed)send('bankTrade',{giveResource:bankGive,giveAmount:ratio,getResource:bankGet},`Traded ${ratio} ${bankGive} for 1 ${bankGet}.`,true);}}>
      <div className="bank-choice-section"><h3>You give <strong>{ratio}</strong></h3><div className="bank-choices">{TYPES.map(r=><button type="button" key={r} aria-pressed={bankGive===r} onClick={()=>{setBankGive(r);if(bankGet===r)setBankGet(TYPES.find(t=>t!==r));}}><CardArtwork name={r} className="bank-card-art"/><span>{name(r)}</span><small>{player?.resources?.[r]||0} available · {gameState.tradeRatios?.[r]||4}:1</small></button>)}</div></div>
      <div className="bank-choice-section"><h3>You receive <strong>1</strong></h3><div className="bank-choices">{TYPES.map(r=><button type="button" key={r} aria-pressed={bankGet===r} disabled={r===bankGive||!gameState.bankAvailable?.[r]} onClick={()=>setBankGet(r)}><CardArtwork name={r} className="bank-card-art"/><span>{name(r)}</span><small>{gameState.bankAvailable?.[r]?'In stock':'Empty'}</small></button>)}</div></div>
      <footer className="exchange-footer"><p>{ratio} {name(bankGive)} <span aria-hidden="true">→</span> 1 {name(bankGet)}</p><button type="submit" className="room-primary-button" disabled={!bankAllowed||busy}>{busy?'Trading…':'Confirm bank trade'}</button></footer>
      {player?.resources?.[bankGive]<ratio&&<p className="exchange-note">You need {ratio} {bankGive} for this exchange.</p>}
    </form>:<>
      {trade&&<section className="pending-exchange"><p className="exchange-status">{trade.status==='accepted'?`${recipientName} accepted. ${offererName} must confirm.`:`${offererName} offers a trade to ${recipientName}.`}</p>
        <div className="exchange-summary"><div><h3>{offererName} gives</h3><Bundle value={trade.give}/></div><div><h3>{recipientName} gives</h3><Bundle value={trade.get}/></div></div>
        <div className="exchange-buttons">{isRecipient&&trade.status==='offered'&&<><button className="room-primary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeAccept',{tradeId:trade.id},'Trade accepted.')}>Accept offer</button><button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>{setPartner(trade.from);setGive({...empty(),...trade.get});setGet({...empty(),...trade.give});setCountering(true);}}>Counteroffer</button><button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeReject',{tradeId:trade.id},'Trade rejected.',true)}>Reject</button></>}
        {isOfferer&&<><button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeCancel',{tradeId:trade.id},'Offer cancelled.',true)}>Cancel offer</button>{trade.status==='accepted'&&<button className="room-primary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeConfirm',{tradeId:trade.id},'Trade completed.',true)}>Confirm trade</button>}</>}</div>
      </section>}
      {(!trade||countering)&&player&&<form onSubmit={offer}><label className="exchange-partner">Trade with<select value={partner} onChange={e=>setPartner(e.target.value)} disabled={countering||busy}>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="exchange-columns"><Quantities label="You give" value={give} setValue={setGive} limits={player.resources} showHave/><Quantities label="You receive" value={get} setValue={setGet} limits={{}}/></div>
        <footer className="exchange-footer"><p>{countering?'Your counteroffer replaces the current offer.':'Resources move only after acceptance and confirmation.'}</p><button type="submit" className="room-primary-button" disabled={!canPlayerTrade||!partners.length||busy}>{busy?'Sending…':countering?'Send counteroffer':'Send offer'}</button></footer>
      </form>}
      {!player&&<p className="exchange-note">You can watch this trade as a spectator.</p>}
    </>}
  </section></div>;
}
