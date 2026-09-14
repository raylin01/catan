import {createContext,useContext,useEffect,useRef,useState} from 'react';
import CardArtwork from '../components/CardArtwork';
import GameIcon from '../components/GameIcon';
import {createPortal} from 'react-dom';
import RoomTradePanel from '../components/RoomTradePanel';
import {cardTypesFor,combinedHand} from '../../../shared/cardTypes.js';
import './trade-prototype.css';
const Context=createContext(null);
const seed=()=>[{id:'incoming',from:'seat-b',to:'seat-a',give:{wool:2},get:{grain:1},status:'offered'},{id:'outgoing',from:'seat-a',to:'seat-c',give:{brick:1},get:{ore:1},status:'offered'}];
const seatNames={'seat-a':'Ada','seat-b':'Mara','seat-c':'Theo','seat-d':'Lin'};
function tradeEvent(type,trade,actor) {
  const verbs={tradeOffer:'offered a trade',tradeCounter:'made a counteroffer',tradeAccept:'accepted a trade',tradeReject:'declined a trade',tradeCancel:'cancelled a trade',tradeConfirm:'completed a trade'};
  const status={tradeAccept:'accepted',tradeReject:'rejected',tradeCancel:'cancelled',tradeConfirm:'confirmed'}[type]||trade.status;
  return {id:crypto.randomUUID(),at:new Date().toISOString(),type,actor,summary:`${seatNames[actor]||'Player'} ${verbs[type]}`,details:{trade:{id:trade.id,from:trade.from,to:trade.to,give:trade.give,get:trade.get,status,counterOf:trade.counterOf||null,fromName:seatNames[trade.from],toName:seatNames[trade.to]}}};
}
export function TradePrototypeProvider({children}) {
  const [trades,setTrades]=useState(seed),[events,setEvents]=useState(()=>seed().map(t=>tradeEvent('tradeOffer',t,t.from)));
  const record=(type,t,actor)=>setEvents(es=>[...es,tradeEvent(type,t,actor)].slice(-200));
  const reset=()=>{setTrades(seed());setEvents(seed().map(t=>tradeEvent('tradeOffer',t,t.from)));};
  return <Context.Provider value={{trades,setTrades,events,record,reset}}>{children}</Context.Provider>;
}
export const useTradePrototypeEvents=()=>useContext(Context).events;
export function TradePrototypeTools(){const {trades,setTrades,record,reset}=useContext(Context);return <aside className="trade-prototype-tools"><span><strong>Trading prototype</strong> · Sample offers, no live game</span><div><button onClick={()=>{trades.filter(t=>t.from==='seat-a'&&t.status==='offered').forEach(t=>record('tradeAccept',t,t.to));setTrades(ts=>ts.map(t=>t.from==='seat-a'?{...t,status:'accepted'}:t));}}>Simulate acceptance</button><button onClick={reset}>Reset offers</button></div></aside>;}
const clean=value=>Object.fromEntries(Object.entries(value).filter(([,n])=>n>0));
function Picker({label,types,value,other,hand,onChange}) {
  return <fieldset className="prototype-picker"><legend>{label}</legend><div className="prototype-palette">{types.map(card=>{
    const n=value[card]||0,limit=hand?.[card]??95;
    return <div className={`prototype-card ${n?'is-chosen':''}`} key={card}>
      <div className="prototype-card-face"><CardArtwork name={card}/><span className="prototype-card-name">{card}</span></div>
      <div className="prototype-stepper" role="group" aria-label={`${card} in ${label.toLowerCase()}`}>
        <button type="button" disabled={!n} aria-label={`Remove ${card} from ${label.toLowerCase()}`} onClick={()=>onChange(card,n-1)}>−</button>
        <output aria-label={`${card} quantity in ${label.toLowerCase()}`}>{n}</output>
        <button type="button" disabled={n>=limit||!!other[card]} aria-label={`Add ${card} to ${label.toLowerCase()}`} onClick={()=>onChange(card,n+1)}>+</button>
      </div>
      {hand&&<div className="prototype-card-available">{limit} in hand</div>}
    </div>;
  })}</div></fieldset>;
}
function Bundle({cards}){return <span className="prototype-bundle">{Object.entries(cards||{}).map(([card,n])=><span key={card}><CardArtwork name={card}/><b>{n}</b><span>{card}</span></span>)}</span>;}
export default function TradePrototype(props){return props.mode==='bank'?<RoomTradePanel {...props}/>:<PlayerTradePrototype {...props}/>;}
function PlayerTradePrototype({gameState,seatId,onClose}){
  const {trades,setTrades,record}=useContext(Context),players=gameState.players,me=players.find(p=>p.id===seatId),partners=players.filter(p=>p.id!==seatId);
  const types=cardTypesFor(gameState),hand=combinedHand(me),names=id=>id===seatId?'You':players.find(p=>p.id===id)?.name||'Player';
  const [partner,setPartner]=useState(partners[0]?.id||''),[give,setGive]=useState({}),[get,setGet]=useState({}),[counterId,setCounterId]=useState(null),[notice,setNotice]=useState('');
  const dialog=useRef(null),close=useRef(onClose);close.current=onClose;
  const g=clean(give),r=clean(get),valid=me&&partner&&Object.keys(g).length&&Object.keys(r).length&&(counterId||trades.length<12);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.focus();const key=e=>{if(e.key==='Escape'){e.preventDefault();close.current();}if(e.key==='Tab'){const a=[...dialog.current.querySelectorAll('button')].filter(e=>!e.disabled&&e.getClientRects().length),first=a[0],last=a.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};},[]);
  useEffect(()=>{if(counterId&&!trades.some(t=>t.id===counterId&&t.status==='offered')){setCounterId(null);setGive({});setGet({});setNotice('That offer is no longer open. Start a new offer.');}},[trades,counterId]);
  const reset=()=>{setCounterId(null);setGive({});setGet({});};
  const update=(setter,c,n)=>{setter(v=>({...v,[c]:Math.max(0,n)}));setNotice('');};
  const change=(id,status,type)=>{const t=trades.find(t=>t.id===id);if(t)record(type||(status?'tradeAccept':t.from===seatId?'tradeCancel':'tradeReject'),t,seatId);setTrades(ts=>status?ts.map(t=>t.id===id?{...t,status}:t):ts.filter(t=>t.id!==id));setNotice(status?'Offer accepted. The other player confirms the exchange.':'Offer removed.');dialog.current?.focus();};
  const send=()=>{
    if(!valid)return;
    const previous=trades.find(t=>t.id===counterId),history=previous?[...(previous.history||[]),{id:previous.id,from:previous.from,to:previous.to,give:previous.give,get:previous.get}]:[];
    const next={id:crypto.randomUUID(),from:seatId,to:partner,give:g,get:r,status:'offered',counterOf:counterId,history};
    setTrades(ts=>[...ts.filter(t=>t.id!==counterId),next]);record(counterId?'tradeCounter':'tradeOffer',next,seatId);
    setNotice(`Offer sent to ${names(partner)}. It’s in Open offers.`);reset();
  };
  return createPortal(<div className="prototype-trade-backdrop" onClick={onClose}><section ref={dialog} className="prototype-trade-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="prototype-trade-title" onClick={e=>e.stopPropagation()}>
    <header className="prototype-trade-heading"><h2 id="prototype-trade-title"><GameIcon name="trade" size={23}/>Trade with players</h2><button onClick={onClose} aria-label="Close trading prototype"><GameIcon name="close" size={20}/></button></header>
    {Number.isSafeInteger(gameState.bankTotal)&&<p className="prototype-bank-stock"><GameIcon name="bank" size={16}/>{gameState.bankTotal} resource cards in the bank</p>}
    <div className="prototype-trade-body"><div className="prototype-composer">{me?<><fieldset className="prototype-partners"><legend>Trade with</legend><div>{partners.map(p=><button type="button" key={p.id} aria-pressed={partner===p.id} disabled={!!counterId} onClick={()=>setPartner(p.id)} style={{'--partner-color':p.color}}><i/>{p.name}</button>)}</div></fieldset>
      {counterId&&<div className="prototype-counter-note">Countering {names(partner)}’s offer <button onClick={reset}>Start a new offer</button></div>}
      <Picker label="You give" types={types} value={give} other={get} hand={hand} onChange={(c,n)=>update(setGive,c,n)}/><Picker label="You receive" types={types} value={get} other={give} onChange={(c,n)=>update(setGet,c,n)}/>
      <footer className="prototype-send"><p>{Object.keys(g).length&&Object.keys(r).length?<><Bundle cards={g}/><span>→</span><Bundle cards={r}/></>:'Choose cards on both sides to make an offer.'}</p><button className="prototype-primary" disabled={!valid} onClick={send}>{counterId?'Send counteroffer':`Offer to ${names(partner)}`}</button></footer>
    </>:<p className="prototype-muted">You’re watching the public trade offers.</p>}<p className="prototype-feedback" role="status">{notice||'Cards move only after acceptance and confirmation.'}</p></div>
    <aside className="prototype-offers" aria-label="Open trade offers"><h3>Open offers <span>{trades.length}</span></h3>{!trades.length&&<p className="prototype-muted">No open offers. Your next offer will appear here.</p>}
      {trades.map(t=><article key={t.id} className={`prototype-offer ${counterId===t.id?'is-countering':''}`} aria-label={counterId===t.id?'Offer being countered':undefined}><h4>{names(t.from)} <span>→</span> {names(t.to)}</h4><p className="prototype-offer-status">{counterId===t.id?'Countering this offer':t.status==='accepted'?(t.from===seatId?'Ready for you to confirm':`Waiting for ${names(t.from)} to confirm`):t.to===seatId?'Your response':'Waiting for a response'}</p><div className="prototype-offer-cards"><Bundle cards={t.give}/><span>→</span><Bundle cards={t.get}/></div>
        {!!t.history?.length&&<details className="prototype-offer-history"><summary>Offer history · {t.history.length} previous</summary><ol>{t.history.map((entry,index)=><li key={entry.id}><p>{index===0?'Original offer':`Counteroffer ${index}`} · {names(entry.from)} → {names(entry.to)}</p><div className="prototype-offer-cards"><Bundle cards={entry.give}/><span>→</span><Bundle cards={entry.get}/></div></li>)}</ol></details>}
        {me&&<div className="prototype-offer-actions">{t.to===seatId&&t.status==='offered'&&<><button className="prototype-primary" onClick={()=>change(t.id,'accepted')}>Accept</button><button onClick={()=>{setCounterId(t.id);setPartner(t.from);setGive(t.get);setGet(t.give);setNotice('Adjust the cards, then send your counteroffer.');dialog.current?.scrollTo({top:0});}}>Counter</button><button onClick={()=>change(t.id,null)}>Decline</button></>}{t.from===seatId&&<>{t.status==='accepted'&&<button className="prototype-primary" onClick={()=>{change(t.id,null,'tradeConfirm');setNotice('Trade completed in this prototype. No real cards moved.');}}>Confirm</button>}<button onClick={()=>change(t.id,null)}>Cancel</button></>}</div>}
      </article>)}
    </aside></div>
  </section></div>,document.body);
}
