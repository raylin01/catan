import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import GameIcon from './GameIcon';
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
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const seen = useRef(new Set(events.map(e=>e.id)));
  const [queue,setQueue] = useState([]);
  const [active,setActive] = useState(null);
  const [notice,setNotice] = useState(null);
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
        return Array.from({length:Math.min(t.count,3)},(_,i)=>({...t,from,to,key:`${transferIndex}-${i}`,offset:i*7,delay:(i*75+transferIndex*45)/rate,badge:i===Math.min(t.count,3)-1}));
      });
      setActive({id:next.id,flights});
      setNotice({id:next.id,text:summary(next,seatId)});
      end=window.setTimeout(()=>{setActive(null);setQueue(q=>q.filter(e=>e.id!==next.id));},1150/rate+Math.max(0,...flights.map(f=>f.delay)));
    },(next.type==='rollDice'?900:120)/rate);
    return()=>{window.clearTimeout(start);window.clearTimeout(end);};
  },[next?.id,seatId,rate]);
  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(null),4200/rate);
    return()=>window.clearTimeout(timer);
  },[notice?.id,rate]);
  return createPortal(<div className="card-movement-layer" style={{'--flight-duration':`${1050/rate}ms`}}>
    {active?.flights.map(f=><div key={`${active.id}-${f.key}`} className={`moving-card ${f.resource?'movement-face':'movement-back'}`} aria-hidden="true" style={{'--from-x':`${f.from.x-22+f.offset}px`,'--from-y':`${f.from.y-30}px`,'--to-x':`${f.to.x-22+f.offset}px`,'--to-y':`${f.to.y-30}px`,'--flight-delay':`${f.delay}ms`}}>
      <GameIcon name={f.resource||'cards'} size={27}/>{f.badge&&<strong>×{f.count}</strong>}
    </div>)}
    {notice?.text&&<div key={notice.id} className="card-movement-notice" role="status">{notice.text}</div>}
  </div>,document.body);
}
