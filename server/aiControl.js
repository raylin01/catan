export const AI_STATUSES=new Set(['thinking','reading-chat','speaking','waiting','error','stopped']);
export const REASONING_VALUES=new Set(['minimal','low','medium','high','xhigh','max']);
export const LEASE_TTL_MS=20000;
export const OFFLINE_TTL_MS=45000;

const fail=(error,statusCode=400)=>({success:false,error,statusCode});
const validRunId=value=>typeof value==='string'&&value.length>=8&&value.length<=100;

export function initializeAiSlot(slot,configuration={}) {
  slot.controlEpoch=Number.isSafeInteger(slot.controlEpoch)&&slot.controlEpoch>=0?slot.controlEpoch:0;
  slot.aiPaused=typeof slot.aiPaused==='boolean'?slot.aiPaused:false;
  slot.chatEnabled=Object.hasOwn(configuration,'chatEnabled')?configuration.chatEnabled:(slot.chatEnabled??true);
  slot.chatModel=Object.hasOwn(configuration,'chatModel')?configuration.chatModel:(slot.chatModel??null);
  slot.chatReasoning=Object.hasOwn(configuration,'chatReasoning')?configuration.chatReasoning:(slot.chatReasoning??null);
  return slot;
}

export function leaseIsLive(slot,now) {
  return Boolean(slot.runnerLease&&slot.runnerLease.expiresAt>now&&(slot.runnerLease.status!=='stopped'||slot.aiPaused));
}

export function fenceAiCommand(slot,{controlEpoch,runId},now,{allowPaused=false,allowLeaseRefresh=false}={}) {
  if(!slot||slot.kind!=='ai')return fail('An AI playing seat is required',403);
  initializeAiSlot(slot);
  if(!Number.isSafeInteger(controlEpoch)||controlEpoch!==slot.controlEpoch)return fail('AI control changed; observe before acting',409);
  if(slot.aiPaused&&!allowPaused)return fail('AI seat is paused',409);
  if(leaseIsLive(slot,now)) {
    if(!validRunId(runId)||runId!==slot.runnerLease.runId)return fail('Another AI runner controls this seat',409);
  } else if(allowLeaseRefresh&&slot.runnerLease?.runId&&runId!==slot.runnerLease.runId) {
    return fail('AI runner no longer owns this lease',409);
  }
  return {success:true};
}

export function claimRunnerLease(slot,{runId,controlEpoch},now) {
  if(!validRunId(runId))return fail('Invalid AI runner ID');
  const fenced=fenceAiCommand(slot,{runId,controlEpoch},now,{allowPaused:true});
  if(!fenced.success)return fenced;
  const previous=slot.runnerLease?.runId===runId?slot.runnerLease:null;
  slot.runnerLease={runId,controlEpoch,status:previous?.status||'waiting',lastActivityAt:now,expiresAt:now+LEASE_TTL_MS,error:previous?.error||null};
  return {success:true,leaseExpiresAt:slot.runnerLease.expiresAt};
}

export function heartbeatRunner(slot,{runId,controlEpoch,status,error},now) {
  if(!validRunId(runId)||!AI_STATUSES.has(status))return fail('Invalid AI heartbeat');
  const fenced=fenceAiCommand(slot,{runId,controlEpoch},now,{allowPaused:true,allowLeaseRefresh:true});
  if(!fenced.success)return fenced;
  if(!slot.runnerLease||slot.runnerLease.runId!==runId)return fail('AI runner lease is not active',409);
  const nextStatus=slot.aiPaused?'stopped':status;
  const cleanError=nextStatus==='error'&&typeof error==='string'&&error.trim()?error.trim().slice(0,200):null;
  slot.runnerLease={runId,controlEpoch,status:nextStatus,lastActivityAt:now,
    expiresAt:['stopped','error'].includes(nextStatus)&&!slot.aiPaused?now:now+LEASE_TTL_MS,error:cleanError};
  return {success:true,leaseExpiresAt:slot.runnerLease.expiresAt};
}

export function applyAiControl(slot,action,now) {
  initializeAiSlot(slot);
  if(!['pause','resume','cancel'].includes(action))return fail('Invalid AI control action');
  if(action==='resume') {
    if(!slot.aiPaused)return fail('AI seat is already running');
    slot.aiPaused=false;slot.controlEpoch++;
    if(slot.runnerLease){slot.runnerLease.controlEpoch=slot.controlEpoch;slot.runnerLease.status='waiting';slot.runnerLease.error=null;}
  } else if(action==='pause') {
    if(slot.aiPaused)return fail('AI seat is already paused');
    slot.aiPaused=true;slot.controlEpoch++;
    if(slot.runnerLease){slot.runnerLease.controlEpoch=slot.controlEpoch;slot.runnerLease.status='stopped';slot.runnerLease.error=null;slot.runnerLease.expiresAt=now+LEASE_TTL_MS;}
  } else {
    slot.aiPaused=true;slot.controlEpoch++;slot.runnerLease=null;
  }
  return {success:true,controlEpoch:slot.controlEpoch,paused:slot.aiPaused};
}

export function projectAiStatus(slot,now,toolActivity=null) {
  initializeAiSlot(slot);
  const leaseActivity=slot.runnerLease?.lastActivityAt||0;
  const toolAt=toolActivity?.lastActivityAt||0;
  const lastActivityAt=Math.max(leaseActivity,toolAt)||null;
  const age=lastActivityAt==null?Infinity:Math.max(0,now-lastActivityAt);
  const connection=age<=LEASE_TTL_MS?'online':age<=OFFLINE_TTL_MS?'stale':'offline';
  let status='stopped',error;
  if(!slot.aiPaused&&connection!=='offline') {
    if(leaseActivity>=toolAt&&slot.runnerLease) {
      status=slot.runnerLease.status||'waiting';error=slot.runnerLease.error?'AI runner reported an error':undefined;
    } else status='waiting';
  }
  return {controlEpoch:slot.controlEpoch,paused:slot.aiPaused,status,connection,lastActivityAt,
    runnerAttached:Boolean(slot.runnerLease?.runId&&slot.runnerLease.expiresAt>now),...(error?{error}:{})};
}
