import {setTimeout as sleep} from 'node:timers/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createChatReaderInput,validateChatProposals,projectSpeakerContext} from './chat-policy.js';
import {projectNegotiations} from './negotiation-policy.js';

const fingerprint=view=>createHash('sha256').update(JSON.stringify({generation:view.generation,epoch:view.controlEpoch,game:view.gameState,trade:view.trade,decision:view.decision})).digest('hex');
const ownSlot=view=>view.slots?.find(slot=>slot.id===view.seatId);
const paused=view=>view.paused||ownSlot(view)?.ai?.paused===true;
const tradeNeedsReply=view=>view.trade&&((view.trade.to===view.seatId&&view.trade.status==='offered')||(view.trade.from===view.seatId&&view.trade.status==='accepted'));

/** One serialized scheduler per seat. Polling is transport work, never a model turn. */
export async function runPlayer(client,connector,{model,reasoning,memory='',contexts={},chatCursor=0,pendingProposals=[],pendingReplySequence=0,
  negotiationCursor=0,pendingNegotiations=[],negotiationWait=null,decisionTimeoutMs=60000,negotiationGraceMs=6000,
  save=async()=>{},signal,pollMs=1500,heartbeatMs=2000,chatBatchMs=2500}={}) {
  await connector.ready();
  const runId=randomUUID();
  let view=await client.observe(),lastDecision=null,lastOutcome=null,status='waiting',proposals=pendingProposals.slice(-24),replySequence=pendingReplySequence,lastReadAt=0;
  let registered=false,stopped=false,rejectedDecisions=0;
  let negotiations=pendingNegotiations.slice(-24);
  const persist=()=>save(memory,{contexts,chatCursor,pendingProposals:proposals,pendingReplySequence:replySequence,
    negotiationCursor,pendingNegotiations:negotiations,negotiationWait});
  const startResponseWait=source=>{negotiationWait={turnKey:source.negotiation?.turnKey,
    notBefore:Date.now()+negotiationGraceMs,until:Date.now()+decisionTimeoutMs+negotiationGraceMs};};
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
      if(paused(view)){lastDecision=null;negotiationWait=null;await report('waiting');await sleep(pollMs,undefined,{signal});continue;}
      if(!view.gameState&&!ownSlot(view)?.ready) {
        try {await client.act({...view,runId},'ready');}
        catch(error){if(error.status!==409)throw error;}
        await sleep(pollMs,undefined,{signal});continue;
      }
      const slot=ownSlot(view);
      let batch=null;
      if(view.gameState&&slot?.chatEnabled!==false&&client.readChat&&Date.now()-lastReadAt>=chatBatchMs) {
        batch=await client.readChat({runId,controlEpoch:view.controlEpoch,afterSequence:chatCursor,afterNegotiationSequence:negotiationCursor});
        lastReadAt=Date.now();
        negotiations=projectNegotiations(view,[...negotiations,...(batch.negotiations||[])]);
        if(Number.isSafeInteger(batch.negotiationSequence))negotiationCursor=Math.max(negotiationCursor,batch.negotiationSequence);
        await persist();
        if(batch.messages?.length&&connector.readChat) {
          const input=createChatReaderInput({messages:batch.messages,publicState:view});
          const chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
          try {
            const result=await callModel('reading-chat',view,s=>connector.readChat(input,{model:chatModel,reasoning:chatReasoning,contextId:contextFor('reader',chatModel,chatReasoning),signal:s,timeoutMs:decisionTimeoutMs}));
            remember('reader',result.contextId);
            proposals=[...proposals,...validateChatProposals(result.value,input)].slice(-24);
            replySequence=Math.max(replySequence,...batch.messages.map(m=>m.sequence||0));
            chatCursor=batch.hasMore?Math.max(...batch.messages.map(m=>m.sequence||0)):batch.chatSequence;await persist();
          } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;throw error;}
        } else if(batch.chatSequence>chatCursor){chatCursor=batch.hasMore?Math.max(...batch.messages.map(m=>m.sequence||0)):batch.chatSequence;await persist();}
      }
      view=await client.observe();
      if(paused(view))continue;
      negotiations=slot?.chatEnabled===false?[]:projectNegotiations(view,negotiations);
      if(negotiationWait) {
        const inWindow=view.gameState?.phase==='playing'&&view.gameState?.turnPhase==='main'
          &&view.negotiation?.turnKey===negotiationWait.turnKey&&Date.now()<negotiationWait.until;
        const responding=view.slots?.some(other=>other.id!==view.seatId
          &&['thinking','reading-chat','speaking'].includes(other.ai?.status)&&other.ai?.connection==='online');
        if(inWindow&&!tradeNeedsReply(view)&&!negotiations.length&&(Date.now()<negotiationWait.notBefore||responding)) {
          await report('waiting');await sleep(pollMs,undefined,{signal});continue;
        }
        // A rejected offer can restore the exact pre-offer board fingerprint.
        // Finishing a response window must still permit the next decision.
        negotiationWait=null;lastDecision=null;await persist();
      }
      const canConsiderProposals=proposals.length&&view.gameState?.phase==='playing'&&view.gameState?.turnPhase==='main';
      const needed=view.decision||tradeNeedsReply(view)||canConsiderProposals||negotiations.length;
      const key=fingerprint(view)+JSON.stringify([proposals,negotiations]);
      if(needed&&key!==lastDecision) {
        let result;
        const offeredProposals=proposals;
        try {
          result=await callModel('thinking',view,s=>connector.decide({...view,proposals:offeredProposals,negotiations},{model,reasoning,memory,contextId:contextFor('gameplay',model,reasoning),lastOutcome,signal:s,timeoutMs:decisionTimeoutMs}));
        } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;throw error;}
        if(result.action&&result.negotiation)throw Error('Connector must choose a game action or negotiation, not both');
        memory=result.memory;remember('gameplay',result.contextId);await persist();
        // Re-observe even if a connector ignores AbortSignal. Commit only to the
        // exact private state and control epoch the decision actually used.
        const latest=await client.observe();
        if(signal?.aborted||paused(latest)||fingerprint(latest)!==fingerprint(view))continue;
        view=latest;lastDecision=key;
        if(!result.action&&!result.negotiation&&(view.decision||tradeNeedsReply(view)))
          throw Error('AI returned no action for a required decision; the seat remains reserved');
        let confirmed=null;
        if(result.negotiation) {
          if(!client.negotiate)throw Error('Connector requested negotiation without a negotiation transport');
          try {
            const receipt=await client.negotiate({requestId:randomUUID(),runId,controlEpoch:view.controlEpoch,
              revision:view.revision,generation:view.generation,intent:result.negotiation});
            lastOutcome={negotiation:result.negotiation,result:receipt};rejectedDecisions=0;
            if(result.negotiation.kind!=='decline')startResponseWait(view);
          } catch(error) {
            if(![400,409,429].includes(error.status))throw error;
            lastOutcome={negotiation:result.negotiation,rejected:true,error:error.message};
            if(++rejectedDecisions>=3)throw Error('Repeated rejected AI negotiations; the seat remains waiting');
          }
          proposals=[];negotiations=[];lastDecision=null;await persist();
          await report('waiting');await sleep(pollMs,undefined,{signal});continue;
        }
        if(result.action) {
          try {
            const receipt=await client.act({...view,runId},result.action.type,result.action.payload);
            lastOutcome={action:result.action,result:receipt};rejectedDecisions=0;
            // Never pass the private command response (e.g. stolen card) to chat.
            confirmed={id:randomUUID(),actorSeatId:view.seatId,type:result.action.type,...result.action.payload};
            if(['tradeOffer','tradeCounter','tradeAccept'].includes(result.action.type))startResponseWait(view);
          } catch(error){if(error.status===409){lastOutcome={action:result.action,rejected:true,error:error.message};if(++rejectedDecisions>=3)throw Error('Repeated rejected AI decisions; the seat remains waiting');lastDecision=null;continue;}throw error;}
        }
        proposals=[];negotiations=[];await persist();
        if(offeredProposals.length&&replySequence&&['acknowledge','decline'].includes(result.publicReply)&&connector.speak&&client.replyChat) {
          const chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
          view=await client.observe();
          if(paused(view))continue;
          const input={...projectSpeakerContext({publicState:view,confirmedOutcomes:confirmed?[confirmed]:[],approvedNegotiation:offeredProposals}),seatId:view.seatId,replyKind:result.publicReply};
          try {
            const spoken=await callModel('speaking',view,s=>connector.speak(input,{model:chatModel,reasoning:chatReasoning,contextId:contextFor('speaker',chatModel,chatReasoning),signal:s,timeoutMs:decisionTimeoutMs}));
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
