import {setTimeout as sleep} from 'node:timers/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createChatReaderInput,validateChatProposals,projectSpeakerContext} from './chat-policy.js';

const fingerprint=view=>createHash('sha256').update(JSON.stringify({generation:view.generation,epoch:view.controlEpoch,game:view.gameState,trade:view.trade,decision:view.decision})).digest('hex');
const ownSlot=view=>view.slots?.find(slot=>slot.id===view.seatId);
const paused=view=>view.paused||ownSlot(view)?.ai?.paused===true;
const tradeNeedsReply=view=>view.trade&&((view.trade.to===view.seatId&&view.trade.status==='offered')||(view.trade.from===view.seatId&&view.trade.status==='accepted'));

/** One serialized scheduler per seat. Polling is transport work, never a model turn. */
export async function runPlayer(client,connector,{model,reasoning,memory='',contexts={},chatCursor=0,pendingProposals=[],pendingReplySequence=0,save=async()=>{},signal,pollMs=1500,heartbeatMs=2000,chatBatchMs=2500}={}) {
  await connector.ready();
  const runId=randomUUID();
  let view=await client.observe(),lastDecision=null,lastOutcome=null,status='waiting',proposals=pendingProposals.slice(-24),replySequence=pendingReplySequence,lastReadAt=0;
  let registered=false,stopped=false,rejectedDecisions=0;
  const persist=()=>save(memory,{contexts,chatCursor,pendingProposals:proposals,pendingReplySequence:replySequence});
  const report=async(next,source=view)=>{
    status=next;
    if(client.heartbeat)await client.heartbeat({runId,controlEpoch:source.controlEpoch,status:next});
  };
  // A channel's history is private to this seat and purpose; switching its
  // configured model starts a fresh channel rather than mixing histories.
  const contextFor=(channel,selectedModel,selectedReasoning)=>{
    const key=JSON.stringify([connector.id,selectedModel||null,selectedReasoning||null]);
    if(contexts[channel]?.key!==key)contexts={...contexts,[channel]:{key,id:null}};
    return contexts[channel].id;
  };
  const remember=(channel,id)=>{if(id)contexts={...contexts,[channel]:{...contexts[channel],id}};};
  const callModel=async(kind,source,invoke)=>{
    const controller=new AbortController();
    const decisionSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    await report(kind,source);
    let heartbeatBusy=false;
    const timer=setInterval(async()=>{
      if(heartbeatBusy)return;heartbeatBusy=true;
      try {
        const latest=await client.observe();
        if(latest.generation!==source.generation||latest.controlEpoch!==source.controlEpoch||paused(latest)||latest.gameState?.phase==='finished')controller.abort();
        else await report(kind,source);
      } catch {controller.abort();}
      finally {heartbeatBusy=false;}
    },heartbeatMs);
    try {return await invoke(decisionSignal);}
    finally {clearInterval(timer);}
  };
  try {
    if(client.lease){await client.lease({runId,controlEpoch:view.controlEpoch});registered=true;}
    while(!signal?.aborted) {
      try {
      view=await client.observe();
      if(view.gameState?.phase==='finished')break;
      if(registered&&view.ai?.runnerRunId!==runId){stopped=true;break;}
      if(client.lease)await client.lease({runId,controlEpoch:view.controlEpoch});
      if(paused(view)){lastDecision=null;await report('waiting');await sleep(pollMs,undefined,{signal});continue;}
      if(!view.gameState&&!ownSlot(view)?.ready) {
        try {await client.act({...view,runId},'ready');}
        catch(error){if(error.status!==409)throw error;}
        await sleep(pollMs,undefined,{signal});continue;
      }
      const slot=ownSlot(view);
      let batch=null;
      if(view.gameState&&slot?.chatEnabled!==false&&client.readChat&&connector.readChat&&Date.now()-lastReadAt>=chatBatchMs) {
        batch=await client.readChat({runId,controlEpoch:view.controlEpoch,afterSequence:chatCursor});
        lastReadAt=Date.now();
        if(batch.messages?.length) {
          const input=createChatReaderInput({messages:batch.messages,publicState:view});
          const chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
          try {
            const result=await callModel('reading-chat',view,s=>connector.readChat(input,{model:chatModel,reasoning:chatReasoning,contextId:contextFor('reader',chatModel,chatReasoning),signal:s}));
            remember('reader',result.contextId);
            proposals=[...proposals,...validateChatProposals(result.value,input)].slice(-24);
            replySequence=Math.max(replySequence,...batch.messages.map(m=>m.sequence||0));
            chatCursor=batch.hasMore?Math.max(...batch.messages.map(m=>m.sequence||0)):batch.chatSequence;await persist();
          } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;throw error;}
        } else if(batch.chatSequence>chatCursor){chatCursor=batch.hasMore?Math.max(...batch.messages.map(m=>m.sequence||0)):batch.chatSequence;await persist();}
      }
      view=await client.observe();
      if(paused(view))continue;
      const canConsiderProposals=proposals.length&&view.gameState?.phase==='playing'&&view.gameState?.turnPhase==='main';
      const needed=view.decision||tradeNeedsReply(view)||canConsiderProposals;
      const key=fingerprint(view)+JSON.stringify(proposals);
      if(needed&&key!==lastDecision) {
        let result;
        const offeredProposals=proposals;
        try {
          result=await callModel('thinking',view,s=>connector.decide({...view,proposals:offeredProposals},{model,reasoning,memory,contextId:contextFor('gameplay',model,reasoning),lastOutcome,signal:s}));
        } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;throw error;}
        memory=result.memory;remember('gameplay',result.contextId);await persist();
        // Re-observe even if a connector ignores AbortSignal. Commit only to the
        // exact private state and control epoch the decision actually used.
        const latest=await client.observe();
        if(signal?.aborted||paused(latest)||fingerprint(latest)!==fingerprint(view))continue;
        view=latest;lastDecision=key;
        let confirmed=null;
        if(result.action) {
          try {
            const receipt=await client.act({...view,runId},result.action.type,result.action.payload);
            lastOutcome={action:result.action,result:receipt};rejectedDecisions=0;
            // Never pass the private command response (e.g. stolen card) to chat.
            confirmed={id:randomUUID(),actorSeatId:view.seatId,type:result.action.type,...result.action.payload};
          } catch(error){if(error.status===409){lastOutcome={action:result.action,rejected:true,error:error.message};if(++rejectedDecisions>=3)throw Error('Repeated rejected AI decisions; the seat remains waiting');lastDecision=null;continue;}throw error;}
        }
        proposals=[];await persist();
        if(offeredProposals.length&&replySequence&&['acknowledge','decline'].includes(result.publicReply)&&connector.speak&&client.replyChat) {
          const chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
          view=await client.observe();
          if(paused(view))continue;
          const input={...projectSpeakerContext({publicState:view,confirmedOutcomes:confirmed?[confirmed]:[],approvedNegotiation:offeredProposals}),seatId:view.seatId,replyKind:result.publicReply};
          try {
            const spoken=await callModel('speaking',view,s=>connector.speak(input,{model:chatModel,reasoning:chatReasoning,contextId:contextFor('speaker',chatModel,chatReasoning),signal:s}));
            remember('speaker',spoken.contextId);await persist();
            if(spoken.value?.message)await client.replyChat({runId,controlEpoch:view.controlEpoch,requestId:randomUUID(),replyToSequence:replySequence,message:spoken.value.message});
          } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;if(![409,429].includes(error.status))throw error;}
        }
      }
      await report('waiting');
      await sleep(pollMs,undefined,{signal});
      } catch(error) {
        if(error.status===409&&registered) {
          const latest=await client.observe();
          if(latest.ai?.runnerRunId===runId) {lastDecision=null;continue;}
          stopped=true;break;
        }
        throw error;
      }
    }
  } catch(error) {
    if(error.name!=='AbortError') {
      try{await report('error');}catch{/* A revoked controller cannot report. */}
    }
    throw error;
  } finally {
    if(!stopped&&status!=='error')try{await report('stopped');}catch{/* Revocation already removes presence. */}
  }
}
