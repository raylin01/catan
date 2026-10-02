import {cardTypesFor} from '../shared/cardTypes.js';

const names=(items,types)=>Array.isArray(items)&&items.length>0&&items.length<=2
  &&new Set(items).size===items.length&&items.every(item=>types.includes(item));
const bundle=(value,types)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if(Object.entries(value).some(([card,amount])=>!types.includes(card)||!Number.isSafeInteger(amount)||amount<0||amount>95))return null;
  const positive=Object.fromEntries(Object.entries(value).filter(([,amount])=>amount>0));
  return Object.keys(positive).length?positive:null;
};

/** Only deliberately public trade terms cross into the speaker context.
 * Never forward the private view, raw chat, command receipt or strategic memory. */
export function projectTradeSpeech(view,{intent=null,tradeId=null}={}) {
  const game=view?.gameState,seatId=view?.seatId;
  if(!game||game.phase!=='playing'||game.turnPhase!=='main'||game.playerTradingAllowed===false||view.paused||view.closed)return null;
  const players=(game.players||[]).map((player,index)=>({id:player.id,
    name:typeof player.name==='string'&&player.name.length<=40?player.name:`Player ${index+1}`}));
  if(!players.some(player=>player.id===seatId))return null;
  const types=cardTypesFor(game);
  if(intent&&tradeId)return null;
  if(intent) {
    if(intent.kind!=='interest'||!names(intent.wants,types)||!names(intent.offers,types)
      ||intent.wants.some(card=>intent.offers.includes(card))
      ||intent.to!=null&&(!players.some(player=>player.id===intent.to)||intent.to===seatId))return null;
    return {seatId,purpose:'interest',players,
      approvedInterest:{wants:[...intent.wants],offers:[...intent.offers],to:intent.to??null}};
  }
  const trade=(view.trades??(view.trade?[view.trade]:[])).find(trade=>trade.id===tradeId);
  if(!trade||trade.from!==seatId||trade.status!=='offered'||trade.to===seatId||!players.some(player=>player.id===trade.to))return null;
  const give=bundle(trade.give,types),get=bundle(trade.get,types);
  if(!give||!get||Object.keys(give).some(card=>card in get))return null;
  return {seatId,purpose:trade.counterOf?'counter':'offer',players,
    offer:{id:trade.id,from:trade.from,to:trade.to,give,get,counterOf:trade.counterOf??null}};
}
