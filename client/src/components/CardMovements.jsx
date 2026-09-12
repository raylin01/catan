import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import {useGamePresentation} from '../presentation/GamePresentation';
import './CardMovements.css';

const labels = {rollDice:'Production', discardCards:'Discarded', bankTrade:'Bank trade', tradeConfirm:'Player trade', chooseRobberCard:'Robber', placeSettlement:'Settlement', placeRoad:'Road', upgradeToCity:'City', buyDevCard:'Development card', playDevCard:'Development card', yearOfPlentyPick:'Year of Plenty'};
const names = {brick:'brick',lumber:'lumber',wool:'wool',grain:'grain',ore:'ore',development:'development card'};

function point(seat, resource, ownSeat) {
  const selector = seat === 'bank' ? '[data-card-bank]' : seat === ownSeat
    ? (resource && resource !== 'development' ? `[data-hand-resource="${CSS.escape(resource)}"]` : '[data-own-hand]')
    : `[data-player-hand="${CSS.escape(seat)}"]`;
  const replayHand = seat !== 'bank' && seat !== ownSeat ? document.querySelector(`[data-replay-hand="${CSS.escape(seat)}"]`) : null;
  const rect = (replayHand || document.querySelector(selector))?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : 100;
  // An offscreen player panel is represented at the viewport edge on phones.
  return {x:Math.max(28,Math.min(window.innerWidth-28,x)),y:Math.max(40,Math.min(window.innerHeight-55,y))};
}

function summary(event, ownSeat) {
  const relevant = event.transfers.filter(t=>t.from===ownSeat||t.to===ownSeat);
  const describe = t=>`${t.to===ownSeat?'Received':'Gave'} ${t.count} ${names[t.resource]||'card'+(t.count===1?'':'s')}`;
  if(relevant.length)return `${labels[event.type]||'Cards'} · ${relevant.map(describe).join(' · ')}`;
  if(ownSeat)return '';
  const count=event.transfers.reduce((n,t)=>n+t.count,0);
  return `${labels[event.type]||'Cards'} · ${count} card${count===1?'':'s'} moved`;
}

/** Receipts drive presentation only. This component never submits game actions. */
export default function CardMovements({events=[],seatId,playbackRate=1}) {
  const {playSound}=useGamePresentation();
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const seen = useRef(new Set(events.map(e=>e.id)));
  const [queue,setQueue] = useState([]);
  const [active,setActive] = useState(null);
  const [notice,setNotice] = useState(null);
  const sounded=useRef(new Set());
  const receiptKey = events.map(e=>e.id).join(',');
  useEffect(()=>{
    const fresh=events.filter(e=>!seen.current.has(e.id));
    for(const e of fresh)seen.current.add(e.id);
    if(seen.current.size>500)seen.current=new Set(events.map(e=>e.id));
    if(fresh.length)setQueue(q=>[...q,...fresh].slice(-40));
  },[receiptKey]);
  const next=queue[0];
  useEffect(()=>{
    if(!next)return;
    let end;
    const start=window.setTimeout(()=>{
      const flights=next.transfers.flatMap((t,transferIndex)=>{
        const from=point(t.from,t.resource,seatId),to=point(t.to,t.resource,seatId);
        // A small fan carries the exact count, avoiding dozens of overlapping cards.
        const exactCount=Number.isFinite(t.count)?Math.max(0,Math.floor(t.count)):0;
        const shown=Math.min(exactCount,3);
        return Array.from({length:shown},(_,i)=>{
          const spread=(i-(shown-1)/2)*6;
          const start={x:from.x-23+spread,y:from.y-32+Math.abs(spread)*.15};
          const finish={x:to.x-23+spread*.65,y:to.y-32+Math.abs(spread)*.1};
          const distance=Math.hypot(to.x-from.x,to.y-from.y);
          const arch=Math.min(150,56+distance*.16)+i*5;
          const midX=Math.max(5,Math.min(window.innerWidth-51,(start.x+finish.x)/2+(transferIndex%2?10:-10)));
          const midY=Math.max(8,Math.min(start.y,finish.y)-arch);
          return {...t,from:start,to:finish,mid:{x:midX,y:midY},key:`${transferIndex}-${i}`,turn:`${spread*.9-8}deg`,delay:(i*75+transferIndex*45)/rate,badge:i===shown-1};
        });
      });
      setActive({id:next.id,flights});
      setNotice({id:next.id,text:summary(next,seatId)});
      if(flights.length&&!sounded.current.has(next.id)){sounded.current.add(next.id);playSound(next.transfers.reduce((count, transfer) => count + transfer.count, 0) > 1 ? 'cardGroup' : 'card');}
      end=window.setTimeout(()=>{setActive(null);setQueue(q=>q.filter(e=>e.id!==next.id));},1150/rate+Math.max(0,...flights.map(f=>f.delay)));
    },(next.type==='rollDice'?900:120)/rate);
    return()=>{window.clearTimeout(start);window.clearTimeout(end);};
  },[next?.id,seatId,rate,playSound]);
  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(null),4200/rate);
    return()=>window.clearTimeout(timer);
  },[notice?.id,rate]);
  return createPortal(<div className="card-movement-layer" style={{'--flight-duration':`${1050/rate}ms`}}>
    {active?.flights.map(f=><div key={`${active.id}-${f.key}`} className={`moving-card ${f.resource && f.resource !== 'development' ? 'movement-face' : 'movement-back'}`} aria-hidden="true" style={{'--from-x':`${f.from.x}px`,'--from-y':`${f.from.y}px`,'--mid-x':`${f.mid.x}px`,'--mid-y':`${f.mid.y}px`,'--to-x':`${f.to.x}px`,'--to-y':`${f.to.y}px`,'--card-turn':f.turn,'--flight-delay':`${f.delay}ms`}}>
      {f.resource && f.resource !== 'development' ? <CardArtwork name={f.resource}/> : <><span className="movement-back-seal"><GameIcon name={f.resource === 'development' ? 'devCard' : 'cards'} size={25}/></span><span className="movement-back-label">{f.resource === 'development' ? 'Development' : 'Resource'}</span></>}{f.badge&&<strong>×{f.count}</strong>}
    </div>)}
    {active?.flights.filter(f=>f.badge).map(f=><span key={`${active.id}-${f.key}-arrival`} className={`card-arrival card-arrival--${f.resource||'hidden'}`} aria-hidden="true" style={{'--arrival-x':`${f.to.x+23}px`,'--arrival-y':`${f.to.y+32}px`,'--arrival-delay':`${f.delay+780/rate}ms`}}><GameIcon name={f.resource === 'development' ? 'devCard' : f.resource || 'cards'} size={18}/></span>)}
    {notice?.text&&<div key={notice.id} className="card-movement-notice" role="status">{notice.text}</div>}
  </div>,document.body);
}
