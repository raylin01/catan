import {useEffect, useRef, useState} from 'react';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import './RoomTradePanel.css';
import {cardTypesFor,combinedHand,ALL_HAND_CARDS} from '../../../shared/cardTypes.js';

const TYPES=['brick','lumber','wool','grain','ore'];
const name=r=>r[0].toUpperCase()+r.slice(1);
const empty=()=>Object.fromEntries(ALL_HAND_CARDS.map(r=>[r,0]));
const positive=b=>Object.fromEntries(Object.entries(b).filter(([,n])=>n>0));

function Bundle({value}) {
  const entries=Object.entries(value||{}).filter(([,n])=>n>0);
  return <div className="exchange-bundle">{entries.length?entries.map(([r,n])=><span key={r}><CardArtwork name={r} className="exchange-card-art"/><strong>{n}</strong> {name(r)}</span>):<span>Nothing selected</span>}</div>;
}

function Quantities({label,value,setValue,limits,showHave=false,types=TYPES}) {
  const update=(r,v)=>setValue(prev=>({...prev,[r]:Math.max(0,Math.min(limits[r]??95,Math.floor(Number(v)||0)))}));
  return <fieldset className="exchange-side"><legend>{label}</legend>{types.map(r=><div className="exchange-resource" key={r}>
    <CardArtwork name={r} className="exchange-card-art"/><label htmlFor={`${label}-${r}`}>{name(r)}{showHave&&<small>{limits[r]||0} available</small>}</label>
    <div className="quantity-control"><button type="button" aria-label={`Remove ${r} from ${label.toLowerCase()}`} disabled={!value[r]} onClick={()=>update(r,value[r]-1)}>−</button>
    <input id={`${label}-${r}`} aria-label={`${label} ${name(r)}`} type="number" min="0" max={limits[r]??95} value={value[r]} onChange={e=>update(r,e.target.value)}/>
    <button type="button" aria-label={`Add ${r} to ${label.toLowerCase()}`} disabled={value[r]>=(limits[r]??95)} onClick={()=>update(r,value[r]+1)}>+</button></div>
  </div>)}</fieldset>;
}

export default function RoomTradePanel({snapshot,gameState,seatId,onCommand,onClose,addNotification,mode='player'}) {
  const TYPES=cardTypesFor(gameState);
  const [partner,setPartner]=useState('');
  const [give,setGive]=useState(empty),[get,setGet]=useState(empty);
  const [countering,setCountering]=useState(null),[composing,setComposing]=useState(false);
  const [bankGive,setBankGive]=useState('brick'),[bankGet,setBankGet]=useState('ore');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
  const player=gameState.players.find(p=>p.id===seatId);
  const hand=combinedHand(player);
  const bankAvailable={...gameState.bankAvailable,...gameState.citiesKnights?.commodityBank};
  const active=gameState.players[gameState.currentPlayerIndex];
  const occupied=new Set(snapshot.slots.filter(s=>s.occupied).map(s=>s.id));
  const partners=gameState.players.filter(p=>p.id!==seatId&&occupied.has(p.id)&&(active?.id===seatId||p.id===active?.id));
  const trades=snapshot.trades??(snapshot.trade?[snapshot.trade]:[]);
  const tradeListKey=trades.map(t=>`${t.id}:${t.status}`).join(',');
  const trade=trades.find(t=>t.id===countering);
  const playerName=id=>gameState.players.find(p=>p.id===id)?.name||'Player';
  const showComposer=composing||!!countering||!trades.length;
  const canTrade=gameState.phase==='playing'&&gameState.turnPhase==='main'&&!snapshot.paused&&!gameState.freeRoads&&!gameState.yearOfPlentyPicks&&!gameState.pendingChoice;
  const canPlayerTrade=canTrade&&gameState.turnRole!=='paired'&&gameState.playerTradingAllowed!==false;
  const ratio=gameState.tradeRatios?.[bankGive]||4;
  const bankAllowed=canTrade&&active?.id===seatId&&hand[bankGive]>=ratio&&bankGive!==bankGet&&bankAvailable[bankGet];
  useEffect(()=>{if(!partners.some(p=>p.id===partner))setPartner(partners[0]?.id||'');},[partner,partners.map(p=>p.id).join(',')]);
  useEffect(()=>{if(countering&&!trade){setCountering(null);setComposing(true);setError('That offer is no longer available. You can send a new offer.');}},[countering,trade]);
  useEffect(()=>{
    const previous=document.activeElement;dialog.current?.focus();
    const key=e=>{if(e.key==='Escape'){e.preventDefault();closeRef.current();}
      if(e.key==='Tab') {const list=[...dialog.current.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=list[0],last=list[list.length-1];
        if(!first){e.preventDefault();return;}if(!dialog.current.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();}else if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.isConnected&&previous.focus();};
  },[]);
  useEffect(()=>{if(dialog.current&&!dialog.current.contains(document.activeElement))dialog.current.focus();},[tradeListKey,countering,showComposer]);
  const send=async(type,payload,success,close=false)=>{
    if(busy)return;setBusy(true);setError('');
    try{const result=await onCommand(type,payload);if(!result?.success){setError(result?.error||'Trade could not be completed.');return false;}addNotification(success);if(close)onClose();return true;}
    catch(e){setError(e.message||'Connection failed. Try again.');return false;}finally{setBusy(false);}
  };
  const offer=async e=>{e.preventDefault();const g=positive(give),r=positive(get);
    if(!partner||!Object.keys(g).length||!Object.keys(r).length){setError('Choose at least one card on each side.');return;}
    if(TYPES.some(t=>g[t]&&r[t])){setError('Use different card types on the two sides.');return;}
    if(await send(countering?'tradeCounter':'tradeOffer',{...(countering?{tradeId:trade?.id}:{}),to:partner,give:g,get:r},countering?'Counteroffer sent.':'Trade offer sent.')){setCountering(null);setComposing(false);setGive(empty());setGet(empty());}
  };
  const bank=mode==='bank';
  return <div className="modal-overlay exchange-overlay" onClick={onClose}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="exchange-title" className="exchange-dialog" onClick={e=>e.stopPropagation()}>
    <header className="exchange-header"><h2 id="exchange-title"><GameIcon name={bank?'bank':'trade'} size={26}/>{bank?'Trade with bank':'Trade with player'}</h2><button type="button" className="exchange-close" onClick={onClose} aria-label="Close trade"><GameIcon name="close" size={22}/></button></header>
    {Number.isSafeInteger(gameState.bankTotal)&&<p className="exchange-note">{gameState.bankTotal} resource cards remain in the bank.</p>}
    {!gameState.citiesKnights&&Number.isSafeInteger(gameState.devCardDeck)&&<p className="exchange-note">{gameState.devCardDeck} development cards remain in the deck.</p>}
    {error&&<p role="alert" className="exchange-error">{error}</p>}
    {!canTrade&&<p className="exchange-note">{snapshot.paused?'The room is paused.':'Trading is available after the roll and any required actions.'}</p>}
    {!bank&&(gameState.turnRole==='paired'||gameState.playerTradingAllowed===false)&&<p className="exchange-note">Player trades are unavailable during the extra action phase. Bank and port trades are allowed.</p>}
    {bank? <form onSubmit={e=>{e.preventDefault();if(bankAllowed)send('bankTrade',{giveResource:bankGive,giveAmount:ratio,getResource:bankGet},`Traded ${ratio} ${bankGive} for 1 ${bankGet}.`,true);}}>
      <div className="bank-choice-section"><h3>You give <strong>{ratio}</strong></h3><div className="bank-choices">{TYPES.map(r=><button type="button" key={r} aria-pressed={bankGive===r} onClick={()=>{setBankGive(r);if(bankGet===r)setBankGet(TYPES.find(t=>t!==r));}}><CardArtwork name={r} className="bank-card-art"/><span>{name(r)}</span><small>{hand[r]||0} available · {gameState.tradeRatios?.[r]||4}:1</small></button>)}</div></div>
      <div className="bank-choice-section"><h3>You receive <strong>1</strong></h3><div className="bank-choices">{TYPES.map(r=><button type="button" key={r} aria-pressed={bankGet===r} disabled={r===bankGive||!bankAvailable[r]} onClick={()=>setBankGet(r)}><CardArtwork name={r} className="bank-card-art"/><span>{name(r)}</span><small>{bankAvailable[r]?'In stock':'Empty'}</small></button>)}</div></div>
      <footer className="exchange-footer"><p>{ratio} {name(bankGive)} <span aria-hidden="true">→</span> 1 {name(bankGet)}</p><button type="submit" className="room-primary-button" disabled={!bankAllowed||busy}>{busy?'Trading…':'Confirm bank trade'}</button></footer>
      {hand[bankGive]<ratio&&<p className="exchange-note">You need {ratio} {bankGive} for this exchange.</p>}
    </form>:<>
      {player&&trades.length>0&&<nav className="exchange-tabs" aria-label="Player trades">
        <button type="button" aria-pressed={!showComposer} onClick={()=>{setComposing(false);setCountering(null);setError('');}}>Open offers <span>{trades.length}</span></button>
        <button type="button" aria-pressed={showComposer} onClick={()=>{setComposing(true);setCountering(null);setError('');}}>New offer</button>
      </nav>}
      {!showComposer&&<div className="exchange-offer-list">{trades.map(t=>{
        const isOfferer=t.from===seatId,isRecipient=t.to===seatId;
        const offererName=playerName(t.from),recipientName=playerName(t.to);
        return <section className="pending-exchange" key={t.id} aria-label={`${offererName} to ${recipientName}`}>
          <p className="exchange-status">{offererName} <span aria-hidden="true">→</span> {recipientName}<small>{t.status==='accepted'?'Accepted · awaiting confirmation':'Awaiting response'}</small></p>
          <div className="exchange-summary"><div><h3>{offererName} gives</h3><Bundle value={t.give}/></div><div><h3>{recipientName} gives</h3><Bundle value={t.get}/></div></div>
          <div className="exchange-buttons">{isRecipient&&t.status==='offered'&&<>
            <button className="room-primary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeAccept',{tradeId:t.id},'Trade accepted.')}>Accept offer</button>
            <button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>{setPartner(t.from);setGive({...empty(),...t.get});setGet({...empty(),...t.give});setCountering(t.id);setComposing(true);}}>Counteroffer</button>
            <button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeReject',{tradeId:t.id},'Trade rejected.')}>Reject</button></>}
            {isOfferer&&<><button className="room-secondary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeCancel',{tradeId:t.id},'Offer cancelled.')}>Cancel offer</button>
              {t.status==='accepted'&&<button className="room-primary-button" disabled={!canPlayerTrade||busy} onClick={()=>send('tradeConfirm',{tradeId:t.id},'Trade completed.')}>Confirm trade</button>}</>}
          </div>
        </section>;
      })}</div>}
      {showComposer&&player&&<form onSubmit={offer}><label className="exchange-partner">Trade with<select value={partner} onChange={e=>setPartner(e.target.value)} disabled={countering||busy}>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="exchange-columns"><Quantities types={TYPES} label="You give" value={give} setValue={setGive} limits={hand} showHave/><Quantities types={TYPES} label="You receive" value={get} setValue={setGet} limits={{}}/></div>
        <footer className="exchange-footer"><p>{countering?'Your counteroffer replaces only this offer.':'You can keep several offers open. Cards move only after acceptance and confirmation.'}</p><button type="submit" className="room-primary-button" disabled={!canPlayerTrade||!partners.length||busy}>{busy?'Sending…':countering?'Send counteroffer':'Send offer'}</button></footer>
      </form>}
      {!player&&<p className="exchange-note">You can watch this trade as a spectator.</p>}
    </>}
  </section></div>;
}
