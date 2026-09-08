import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';

/** Provider-independent scheduling. On failure leave the seat intact and stop. */
export async function runPlayer(client,connector,{model,reasoning,memory='',save=async()=>{},signal,pollMs=1500}={}) {
  await connector.ready();
  let view=await client.observe();
  while(!signal?.aborted&&!view.gameState&&!view.slots?.find(slot=>slot.id===view.seatId)?.ready) {
    try {await client.act(view,'ready');break;}
    catch(error) {
      if(error.status!==409)throw error;
      await sleep(pollMs,undefined,{signal});
      view=await client.observe();
    }
  }
  let lastDecision=null;
  while(!signal?.aborted) {
    view=await client.observe();
    if(view.gameState?.phase==='finished')return;
    const tradeNeedsReply=view.trade&&((view.trade.to===view.seatId&&view.trade.status==='offered')||(view.trade.from===view.seatId&&view.trade.status==='accepted'));
    const needed=!view.paused&&(view.decision||tradeNeedsReply);
    // Chat/presence-only updates must not wake a model. Revision still protects
    // the eventual commit; this fingerprint only schedules relevant decisions.
    const key=createHash('sha256').update(JSON.stringify({generation:view.generation,game:view.gameState,trade:view.trade,decision:view.decision,paused:view.paused})).digest('hex');
    if(needed&&key!==lastDecision) {
      // One private memory and one outstanding decision per runner/seat.
      const decisionController=new AbortController();
      const decisionSignal=signal?AbortSignal.any([signal,decisionController.signal]):decisionController.signal;
      let heartbeatBusy=false;
      const heartbeat=setInterval(async()=>{
        if(heartbeatBusy)return;heartbeatBusy=true;
        try{await client.observe();}catch(error){if(error.status===401)decisionController.abort();}
        finally{heartbeatBusy=false;}
      },5000);
      let result;
      try{result=await connector.decide(view,{model,reasoning,memory,signal:decisionSignal});}
      finally{clearInterval(heartbeat);}
      memory=result.memory;await save(memory);lastDecision=key;
      if(result.action){
        try {await client.act(view,result.action.type,result.action.payload);}
        catch(error){if(error.status!==409)throw error;lastDecision=null;}
      }
    }
    await sleep(pollMs,undefined,{signal});
  }
}
