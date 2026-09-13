import {randomUUID} from 'node:crypto';

const RESOURCES=['brick','lumber','wool','grain','ore'];
const BANK='bank';

function cardsInHand(player) {
  return (player?.developmentCards?.length||0)+(player?.newDevCards?.length||0);
}

function balances(game) {
  if(!game)return null;
  const result=new Map([[BANK,game.bank||{}]]);
  for(const player of game.players||[])result.set(player.id,player.resources||{});
  return result;
}

/** Build presentation receipts from an accepted command's resource deltas and deck draw. */
export function appendCardEvent(room,beforeGame,type,rollId=null) {
  const before=balances(beforeGame),after=balances(room.game);
  if(!before||!after)return null;
  const nodes=[...new Set([...before.keys(),...after.keys()])];
  const transfers=[];
  for(const resource of RESOURCES) {
    const sources=[],sinks=[];
    for(const node of nodes) {
      const delta=(after.get(node)?.[resource]||0)-(before.get(node)?.[resource]||0);
      if(delta<0)sources.push({node,count:-delta});
      else if(delta>0)sinks.push({node,count:delta});
    }
    let sourceIndex=0,sinkIndex=0;
    while(sourceIndex<sources.length&&sinkIndex<sinks.length) {
      const source=sources[sourceIndex],sink=sinks[sinkIndex],count=Math.min(source.count,sink.count);
      transfers.push({from:source.node,to:sink.node,count,resource});
      source.count-=count;sink.count-=count;
      if(source.count===0)sourceIndex++;
      if(sink.count===0)sinkIndex++;
    }
  }
  // A deck draw is public; its identity remains in the actor's private hand.
  // Compare total cards so the end-of-turn new/ready promotion is never a draw.
  if(type==='buyDevCard') {
    for(const player of room.game.players||[]) {
      const previous=beforeGame.players?.find(candidate=>candidate.id===player.id);
      const count=cardsInHand(player)-cardsInHand(previous);
      if(count>0)transfers.push({from:BANK,to:player.id,count,resource:'development'});
    }
  }
  if(!transfers.length)return null;
  const audienceGenerations={};
  for(const transfer of transfers)for(const endpoint of [transfer.from,transfer.to]) {
    if(endpoint===BANK)continue;
    const slot=room.slots.find(candidate=>candidate.id===endpoint);
    if(slot)audienceGenerations[endpoint]=slot.generation;
  }
  const event={
    id:randomUUID(),sequence:(room.cardEventSequence||0)+1,revision:room.revision,type,
    transfers,audienceGenerations,...(rollId?{rollId}:{})
  };
  room.cardEventSequence=event.sequence;
  room.cardEvents=[...(room.cardEvents||[]),event].slice(-200);
  return event;
}

/** Reveal resource identities only to the current generation of an involved seat. */
export function projectCardEvents(room,member) {
  return (room.cardEvents||[]).map(event=>{
    const transfers=[];
    const hiddenByEndpoints=new Map();
    for(const transfer of event.transfers) {
      const involved=member.seatId&&(transfer.from===member.seatId||transfer.to===member.seatId);
      const ownsHistory=involved&&event.audienceGenerations?.[member.seatId]===member.generation;
      const projected={from:transfer.from,to:transfer.to,count:transfer.count};
      if(ownsHistory||transfer.resource==='development') {
        projected.resource=transfer.resource;
        transfers.push(projected);
      } else {
        const key=`${transfer.from}:${transfer.to}`;
        const existing=hiddenByEndpoints.get(key);
        if(existing)existing.count+=transfer.count;
        else {hiddenByEndpoints.set(key,projected);transfers.push(projected);}
      }
    }
    return {id:event.id,sequence:event.sequence,revision:event.revision,type:event.type,
      ...(event.rollId?{rollId:event.rollId}:{}),transfers};
  });
}
