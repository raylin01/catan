export function compactionThreshold(value=80) {
  const n=Number(value);
  if(!Number.isFinite(n)||n<1||n>95)throw Error('Compaction percentage must be between 1 and 95');
  return n;
}

export const tradeNeedsReply=view=>(view.trades??(view.trade?[view.trade]:[])).some(trade=>
  (trade.to===view.seatId&&trade.status==='offered')||(trade.from===view.seatId&&trade.status==='accepted'));

// currentPlayerIndex follows the active participant in paired turns as well
// as snake-order setup. Merely completing one model response is not a boundary.
export function safeToCompact(view) {
  const game=view.gameState;
  return Boolean(game&&['setup','playing'].includes(game.phase)&&!view.closed&&!view.paused
    &&!view.slots?.find(slot=>slot.id===view.seatId)?.ai?.paused
    &&game.players?.[game.currentPlayerIndex]?.id
    &&game.players[game.currentPlayerIndex].id!==view.seatId
    &&game.pendingChoice?.actorId!==view.seatId
    &&!game.discardingPlayers?.some(d=>game.players[d.playerIndex]?.id===view.seatId)
    &&!view.decision&&!tradeNeedsReply(view));
}

export function updateContext(context,event,threshold) {
  if(event.type==='context-id')context.id=event.contextId;
  if(event.type==='context') {
    context.usage=event.context;
    if(Number.isFinite(event.context?.percent)&&event.context.percent>=threshold)context.compactionPending=true;
  }
  if(event.type==='compaction-completed') {
    context.compactionPending=false;context.usage=null;
  }
}

export function runtimeMetadata(connector,contexts,status) {
  const percentages=Object.values(contexts).map(c=>c.usage?.percent).filter(Number.isFinite);
  return {capabilities:{contextUsage:connector.capabilities?.contextUsage===true,compaction:connector.capabilities?.compaction===true},
    contextPercent:connector.capabilities?.contextUsage&&percentages.length?Math.max(...percentages):null,
    compaction:!connector.capabilities?.compaction?'idle':status==='compacting'?'running':Object.values(contexts).some(c=>c.compactionPending)?'scheduled':'idle'};
}
