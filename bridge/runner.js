import {setTimeout as sleep} from 'node:timers/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createChatReaderInput,validateChatProposals,projectSpeakerContext} from './chat-policy.js';
import {projectNegotiations} from './negotiation-policy.js';
import {projectTradeSpeech} from './trade-speech.js';
import {compactionThreshold,safeToCompact,tradeNeedsReply,updateContext,runtimeMetadata} from './compaction.js';

const fingerprint=view=>createHash('sha256').update(JSON.stringify({generation:view.generation,epoch:view.controlEpoch,game:view.gameState,trades:view.trades??view.trade,decision:view.decision})).digest('hex');
const ownSlot=view=>view.slots?.find(slot=>slot.id===view.seatId);
const paused=view=>view.paused||ownSlot(view)?.ai?.paused===true;
const tradeOperation=type=>type?.startsWith('trade')||['bankTrade','proposeTrade','respondToTrade','cancelTrade'].includes(type);

/** One serialized scheduler per seat. Polling is transport work, never a model turn. */
export async function runPlayer(client,connector,{model,reasoning,memory='',contexts={},chatCursor=0,pendingProposals=[],pendingReplySequence=0,
  negotiationCursor=0,pendingNegotiations=[],negotiationWait=null,decisionTimeoutMs=60000,negotiationGraceMs=6000,
  compactAtPercent=80,compactionTimeoutMs=300000,save=async()=>{},signal,pollMs=1500,heartbeatMs=2000,chatBatchMs=2500}={}) {
  const threshold=compactionThreshold(compactAtPercent);
  await connector.ready();
  const runId=randomUUID();
  let view=await client.observe(),lastDecision=null,lastOutcome=null,status='waiting',proposals=pendingProposals.slice(-24),replySequence=pendingReplySequence,lastReadAt=0;
  let registered=false,stopped=false,rejectedDecisions=0,sequence=0;
  let reports=Promise.resolve();
  let negotiations=pendingNegotiations.slice(-24);
  const persist=()=>save(memory,{contexts,chatCursor,pendingProposals:proposals,pendingReplySequence:replySequence,
    negotiationCursor,pendingNegotiations:negotiations,negotiationWait});
  const startResponseWait=source=>{negotiationWait={turnKey:source.negotiation?.turnKey,
    notBefore:Date.now()+negotiationGraceMs,until:Date.now()+decisionTimeoutMs+negotiationGraceMs};};
  const report=async(next,source=view)=>{
    status=next;
    if(client.heartbeat) {
      const payload={runId,controlEpoch:source.controlEpoch,status:next,sequence:++sequence,runtime:runtimeMetadata(connector,contexts,next)};
      reports=reports.catch(()=>{}).then(()=>client.heartbeat(payload));await reports;
    }
  };
  // A channel's history is private to this seat and purpose; switching its
  // configured model starts a fresh channel rather than mixing histories.
  const contextFor=(channel,selectedModel,selectedReasoning)=>{
    const key=JSON.stringify([connector.id,selectedModel||null,selectedReasoning||null]);
    if(contexts[channel]?.key!==key)contexts={...contexts,[channel]:{key,id:null}};
    return contexts[channel].id;
  };
  const remember=(channel,id)=>{if(id)contexts={...contexts,[channel]:{...contexts[channel],id}};};
  const callModel=async(kind,source,invoke,channel)=>{
    const controller=new AbortController();
    const decisionSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    await report(kind,source);
    let heartbeatBusy=false,closed=false;
    const timer=setInterval(async()=>{
      if(heartbeatBusy)return;heartbeatBusy=true;
      try {
        const latest=await client.observe();
        if(closed)return;
        if(latest.generation!==source.generation||latest.controlEpoch!==source.controlEpoch||paused(latest)||latest.gameState?.phase==='finished')controller.abort();
        else await report(status,source);
      } catch {controller.abort();}
      finally {heartbeatBusy=false;}
    },heartbeatMs);
    const onRuntime=event=>{
      if(controller.signal.aborted||signal?.aborted)return;
      if(channel&&contexts[channel])updateContext(contexts[channel],event,threshold);
      if(event.type==='compaction-started')status='compacting';
      if(event.type==='compaction-completed')status=kind==='compaction-scheduled'?'waiting':kind;
      if(event.type==='attention')status='needs-attention';
      if(['compaction-started','compaction-completed','attention'].includes(event.type))
        void report(status,source).catch(()=>controller.abort());
    };
    try {return await invoke(decisionSignal,onRuntime);}
    finally {closed=true;clearInterval(timer);await reports.catch(()=>{});await persist();}
  };
  const speechAvailable=source=>!paused(source)&&ownSlot(source)?.chatEnabled!==false&&source.gameState?.phase==='playing';
  const sameControl=(source,latest)=>source.seatId===latest.seatId&&source.generation===latest.generation
    &&source.controlEpoch===latest.controlEpoch&&(!registered||latest.ai?.runnerRunId===runId);
  const sameSpeechSettings=(source,latest)=>ownSlot(source)?.chatModel===ownSlot(latest)?.chatModel
    &&ownSlot(source)?.chatReasoning===ownSlot(latest)?.chatReasoning;
  const speakTrade=async(source,input)=>{
    if(!input||!speechAvailable(source)||!connector.speak)return null;
    const slot=ownSlot(source),chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
    try {
      const spoken=await callModel('speaking',source,(s,onRuntime)=>connector.speak(input,{onRuntime,model:chatModel,reasoning:chatReasoning,
        contextId:contextFor('tradeSpeaker',chatModel,chatReasoning),signal:s,timeoutMs:decisionTimeoutMs}),'tradeSpeaker');
      signal?.throwIfAborted();
      remember('tradeSpeaker',spoken.contextId);await persist();
      const message=spoken.value?.message;
      return typeof message==='string'&&message.trim()&&message.length<=300?message:null;
    } catch(error) {
      signal?.throwIfAborted();
      // Speech is optional. Keep the approved intent or committed offer; never
      // retry an ambiguous model result or turn a speech failure into a move.
      return null;
    }
  };
  const announceTrade=async(source,tradeId)=>{
    if(!tradeId||!connector.speak||!client.replyChat)return;
    try {
      const current=await client.observe();
      if(!sameControl(source,current)||!speechAvailable(current))return;
      const input=projectTradeSpeech(current,{tradeId});
      if(!input)return;
      const message=await speakTrade(current,input);
      signal?.throwIfAborted();
      if(!message)return;
      const latest=await client.observe();
      signal?.throwIfAborted();
      if(!sameControl(current,latest)||!speechAvailable(latest)||!sameSpeechSettings(current,latest)
        ||JSON.stringify(projectTradeSpeech(latest,{tradeId}))!==JSON.stringify(input))return;
      await client.replyChat({runId,controlEpoch:latest.controlEpoch,generation:latest.generation,requestId:randomUUID(),tradeId,message});
    } catch(error) {
      signal?.throwIfAborted();
      // The offer already exists. Failed or uncertain publication is not retried.
    }
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
      const priorContexts=contexts;
      for(const channel of ['gameplay','reader','speaker','tradeSpeaker'])if(contexts[channel])
        contextFor(channel,channel==='gameplay'?model:(slot?.chatModel||model),channel==='gameplay'?reasoning:(slot?.chatReasoning||reasoning));
      if(contexts!==priorContexts)await persist();
      if(connector.capabilities?.compaction&&connector.compact&&safeToCompact(view)) {
        const pending=Object.entries(contexts).find(([,ctx])=>ctx.id&&ctx.compactionPending);
        if(pending) {
          const [channel,context]=pending;
          // Model changes invalidate the old channel before maintenance too.
          const selectedModel=channel==='gameplay'?model:(slot?.chatModel||model);
          const selectedReasoning=channel==='gameplay'?reasoning:(slot?.chatReasoning||reasoning);
          if(contextFor(channel,selectedModel,selectedReasoning)!==context.id)continue;
          const latest=await client.observe();
          if(latest.generation!==view.generation||latest.controlEpoch!==view.controlEpoch||!safeToCompact(latest))continue;
          try {
            await callModel('compaction-scheduled',latest,(s,onRuntime)=>connector.compact({model:selectedModel,reasoning:selectedReasoning,
              contextId:context.id,signal:s,onRuntime,timeoutMs:compactionTimeoutMs}),channel);
          } catch(error){if(error.name==='AbortError'&&!signal?.aborted)continue;throw error;}
          // Require a confirmed native completion; no blind retries on ambiguity.
          if(contexts[channel].compactionPending)throw Error('Runtime did not confirm compaction; restart the controller to retry');
          lastDecision=null;await persist();await report('waiting');
          continue; // Refresh all state before considering chat or choosing a move.
        }
      }
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
            const result=await callModel('reading-chat',view,(s,onRuntime)=>connector.readChat(input,{onRuntime,model:chatModel,reasoning:chatReasoning,contextId:contextFor('reader',chatModel,chatReasoning),signal:s,timeoutMs:decisionTimeoutMs}),'reader');
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
          result=await callModel('thinking',view,(s,onRuntime)=>connector.decide({...view,proposals:offeredProposals,negotiations},{onRuntime,model,reasoning,memory,contextId:contextFor('gameplay',model,reasoning),lastOutcome,signal:s,timeoutMs:decisionTimeoutMs}),'gameplay');
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
        let announcementTradeId=null;
        if(result.negotiation) {
          if(!client.negotiate)throw Error('Connector requested negotiation without a negotiation transport');
          let message=null;
          if(result.negotiation.kind==='interest') {
            const source=view,input=projectTradeSpeech(source,{intent:result.negotiation});
            message=await speakTrade(source,input);
            const latest=await client.observe();
            signal?.throwIfAborted();
            if(!sameControl(source,latest)||paused(latest)||fingerprint(source)!==fingerprint(latest)
              ||JSON.stringify(source.negotiation)!==JSON.stringify(latest.negotiation)
              ||input&&(!speechAvailable(latest)||!sameSpeechSettings(source,latest)
                ||JSON.stringify(projectTradeSpeech(latest,{intent:result.negotiation}))!==JSON.stringify(input))) {
              lastDecision=null;continue;
            }
            view=latest;
          }
          try {
            const receipt=await client.negotiate({requestId:randomUUID(),runId,controlEpoch:view.controlEpoch,
              revision:view.revision,generation:view.generation,intent:result.negotiation,...(message?{message}:{})});
            lastOutcome={negotiation:result.negotiation,result:receipt};rejectedDecisions=0;
            if(result.negotiation.kind!=='decline')startResponseWait(view);
          } catch(error) {
            if(![400,409,429].includes(error.status))throw error;
            lastOutcome={negotiation:result.negotiation,rejected:true,error:error.message};
            if(++rejectedDecisions>=3)throw Error('Repeated rejected AI negotiations; the seat remains waiting');
          }
          proposals=[];negotiations=[];replySequence=0;lastDecision=null;await persist();
          await report('waiting');await sleep(pollMs,undefined,{signal});continue;
        }
        if(result.action) {
          try {
            const receipt=await client.act({...view,runId},result.action.type,result.action.payload);
            lastOutcome={action:result.action,result:receipt};rejectedDecisions=0;
            // Never pass the private command response (e.g. stolen card) to chat.
            confirmed={id:randomUUID(),actorSeatId:view.seatId,type:result.action.type,...result.action.payload};
            if(['tradeOffer','tradeCounter'].includes(result.action.type))announcementTradeId=receipt.tradeId;
            if(['tradeOffer','tradeCounter','tradeAccept'].includes(result.action.type))startResponseWait(view);
          } catch(error){if(error.status===409){lastOutcome={action:result.action,rejected:true,error:error.message};if(++rejectedDecisions>=3)throw Error('Repeated rejected AI decisions; the seat remains waiting');lastDecision=null;continue;}throw error;}
        }
        proposals=[];negotiations=[];
        if(tradeOperation(result.action?.type))replySequence=0;
        await persist();
        if(announcementTradeId)await announceTrade(view,announcementTradeId);
        if(!tradeOperation(result.action?.type)&&offeredProposals.length&&replySequence&&['acknowledge','decline'].includes(result.publicReply)&&connector.speak&&client.replyChat) {
          const chatModel=slot?.chatModel||model,chatReasoning=slot?.chatReasoning||reasoning;
          view=await client.observe();
          if(paused(view))continue;
          const input={...projectSpeakerContext({publicState:view,confirmedOutcomes:confirmed?[confirmed]:[],approvedNegotiation:offeredProposals}),seatId:view.seatId,replyKind:result.publicReply};
          try {
            const spoken=await callModel('speaking',view,(s,onRuntime)=>connector.speak(input,{onRuntime,model:chatModel,reasoning:chatReasoning,contextId:contextFor('speaker',chatModel,chatReasoning),signal:s,timeoutMs:decisionTimeoutMs}),'speaker');
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
