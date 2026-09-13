import {useState} from 'react';
import {CITIES_KNIGHTS_CARDS} from '../../../shared/citiesKnights.js';
import CardArtwork from './CardArtwork';
import GameIcon from './GameIcon';
import {friendly,choiceVariants,choiceForVariant} from './citiesKnightsView';
export default function CitiesKnightsChoice({choice,playerId,players,onResolve,paused,variant,onVariantChange}) {
  const [cards,setCards]=useState({});
  if(!choice||choice.expansion!=='cities_knights')return null;
  const mine=choice.actorId===playerId,actor=players.find(p=>p.id===choice.actorId);
  const total=Object.values(cards).reduce((a,b)=>a+b,0);
  const variants=choiceVariants(choice);
  const options=choiceForVariant(choice,variant).options||[];
  const spatial=options.some(o=>o.vertexKey||o.hexKey||o.edgeKey);
  const ambiguous=options.some((o,i)=>options.some((other,j)=>i!==j&&((o.vertexKey&&o.vertexKey===other.vertexKey)||(o.hexKey&&o.hexKey===other.hexKey)||(o.edgeKey&&o.edgeKey===other.edgeKey))));
  return <section className="ck-choice" aria-label="Cities & Knights choice"><h3>{mine?choice.label:`${actor?.name||'A player'}: ${choice.label}`}</h3>
    {mine&&choice.offeredResource&&<p>{players.find(p=>p.id===choice.sourcePlayerId)?.name||'Your trading partner'} offers <strong>1 {friendly(choice.offeredResource)}</strong> for one of your commodities.</p>}
    {!mine?<p>Waiting for {actor?.name||'the named player'}.</p>:choice.selection==='cards'?<>
      <p>Choose exactly {choice.count} cards. <strong>{total} / {choice.count}</strong></p>
      <div className="ck-card-quantities">{choice.allowedCards.filter(type=>choice.availableCards?.[type]>0).map(type=><div key={type}><CardArtwork name={type}/><span>{friendly(type)}<small>{choice.availableCards[type]} available</small></span><button type="button" aria-label={`Remove one ${type}`} disabled={paused||!cards[type]} onClick={()=>setCards({...cards,[type]:(cards[type]||0)-1})}>−</button><output>{cards[type]||0}</output><button type="button" aria-label={`Choose one ${type}`} disabled={paused||total>=choice.count||(cards[type]||0)>=choice.availableCards[type]} onClick={()=>setCards({...cards,[type]:(cards[type]||0)+1})}>+</button></div>)}</div>
      <button type="button" className="room-primary-button" disabled={paused||total!==choice.count} onClick={()=>onResolve({choiceId:choice.id,cards:Object.fromEntries(Object.entries(cards).filter(([,n])=>n>0))})}>Confirm {total} cards</button>
    </>:<>
      {variants.values.length>1&&<label className="ck-choice-variant">{variants.field==='track'?'Improvement track':'Knight strength'}<select value={variants.values.includes(String(variant))?variant:variants.values[0]} onChange={e=>onVariantChange(e.target.value)} disabled={paused}>{variants.values.map(value=><option key={value} value={value}>{variants.field==='track'?friendly(value):`${value} · ${['Basic','Strong','Mighty'][Number(value)-1]}`}</option>)}</select></label>}
      {spatial&&!ambiguous&&<p>Choose a highlighted location on the board.</p>}
      <div className={`ck-choice-options ${options.some(o=>o.cardId)?'has-card-art':''}`}>{options.filter(o=>ambiguous||!(o.vertexKey||o.hexKey||o.edgeKey)).map((option,i)=>{
        const cardType=option.cardType&&CITIES_KNIGHTS_CARDS[option.cardType]?option.cardType:null;
        const type=option.resource||option.commodity||(!cardType&&option.cardType);
        const label=cardType?CITIES_KNIGHTS_CARDS[cardType].name:option.track?`${friendly(option.track)} · City ${options.filter(o=>o.track===option.track).indexOf(option)+1}`:friendly(option.label);
        return <button type="button" key={option.id} aria-label={option.die?`Choose die ${option.die}`:undefined} disabled={paused} onClick={()=>onResolve({choiceId:choice.id,optionId:option.id})}>{cardType?<CardArtwork name={cardType}/>:type?<GameIcon name={type}/>:option.die?<span className="ck-die-number" aria-hidden="true">{option.die}</span>:null}{!option.die&&<span>{label}</span>}{cardType&&<small>{CITIES_KNIGHTS_CARDS[cardType].help}</small>}</button>;
      })}</div>
    </>}
  </section>;
}
