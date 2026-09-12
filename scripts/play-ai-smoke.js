#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {GameClient} from '../bridge/client.js';
import {decisionTimeout} from '../bridge/options.js';

const {values}=parseArgs({options:{server:{type:'string',default:'http://127.0.0.1:3006'},
  'host-key-file':{type:'string'},resume:{type:'string'},model:{type:'string',default:'gpt-5.6-luna'},reasoning:{type:'string',default:'max'},
  'timeout-ms':{type:'string',default:'300000'},'max-minutes':{type:'string',default:'45'},
  turns:{type:'string'},output:{type:'string'}}});
const url=new URL(values.server);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('This smoke harness only runs against an isolated local server');
const resumePath=values.resume?resolve(values.resume):null;
if(resumePath&&values.output)throw Error('Use --resume by itself; it is the existing output directory');
if(!resumePath&&!values['host-key-file'])throw Error('Pass the isolated server host-key file');
const minutes=Number(values['max-minutes']),requestedTimeoutMs=decisionTimeout(values['timeout-ms']);
if(!Number.isInteger(minutes)||minutes<1||minutes>120)throw Error('Use max-minutes 1–120');
const output=resumePath||resolve(values.output||`data/luna-smoke-${Date.now()}`);

const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const validCounter=value=>Number.isSafeInteger(value)&&value>=0;
const priorAttempt=report=>({
  attempt:validCounter(report.attemptNumber)?report.attemptNumber:1,
  startedAt:report.attemptStartedAt||report.startedAt,
  finishedAt:report.finishedAt||null,
  reason:report.reason||'unknown',
  maxMinutes:report.maxMinutes,
  completedTurns:report.completedTurns||0,
  lastEvent:report.lastEvent||0,
  runners:Array.isArray(report.runners)?report.runners:[],
  ...(report.error?{error:report.error}:{}),
  ...(report.pauseError?{pauseError:report.pauseError}:{})
});

let created,host,report,turns,timeoutMs,after=0,endedTurns=0;
let savedSeats=[];
const attemptStartedAt=Date.now();
if(resumePath) {
  const hostSession=await readJson(join(output,'host-session.json'));
  if(new URL(hostSession.server).origin!==url.origin)throw Error('Saved host session belongs to another server');
  if(typeof hostSession.code!=='string'||typeof hostSession.token!=='string'||typeof hostSession.replayId!=='string')throw Error('Saved host session is incomplete');
  created=hostSession;
  host=new GameClient({server:url.origin,code:created.code,token:created.token});
  const hostView=await host.observe();
  if(!['setup','playing'].includes(hostView.gameState?.phase))throw Error('Resume requires an existing unfinished game');
  if(hostView.replayId!==created.replayId)throw Error('Saved host session does not match the current game');
  if(hostView.slots.length!==4||hostView.slots.some(slot=>slot.kind!=='ai'||!slot.occupied))throw Error('Resume requires the same four occupied AI seats');

  report=await readJson(join(output,'report.json'));
  if(report.code!==created.code||report.replayId!==created.replayId)throw Error('Saved report belongs to another game');
  if(!validCounter(report.completedTurns||0)||!validCounter(report.lastEvent||0)||!report.eventCounts||typeof report.eventCounts!=='object'||Array.isArray(report.eventCounts)
    ||Object.values(report.eventCounts).some(value=>!validCounter(value)))
    throw Error('Saved report counters are invalid');
  turns=values.turns===undefined?Number(report.requestedTurns):Number(values.turns);
  if(!Number.isInteger(turns)||turns<1||turns>20)throw Error('Use turns 1–20');
  if(values.turns!==undefined&&turns!==Number(report.requestedTurns))throw Error('Resume must continue to the report\'s existing --turns target');
  timeoutMs=decisionTimeout(report.timeoutMs??requestedTimeoutMs);
  after=report.lastEvent||0;endedTurns=report.completedTurns||0;
  if(endedTurns>=turns)throw Error('Saved report already reached its requested turn target');

  const occupiedIds=new Set(hostView.slots.map(slot=>slot.id));
  const observedIds=new Set();
  for(let index=0;index<4;index++) {
    const path=join(output,`seat-${index+1}.json`),session=await readJson(path);
    if(new URL(session.server).origin!==url.origin||session.code?.toUpperCase()!==created.code.toUpperCase())throw Error(`Saved seat ${index+1} belongs to another server or game`);
    if(typeof session.token!=='string'||session.provider!=='codex')throw Error(`Saved seat ${index+1} session is incomplete`);
    const client=new GameClient(session),view=await client.observe();
    const ownSlot=view.slots.find(slot=>slot.id===view.seatId);
    if(view.role!=='ai'||!view.seatId||!occupiedIds.has(view.seatId)||!ownSlot?.occupied||ownSlot.kind!=='ai')
      throw Error(`Saved seat ${index+1} no longer controls its AI seat`);
    if(observedIds.has(view.seatId))throw Error('Saved seat sessions do not control four distinct seats');
    if(!['setup','playing'].includes(view.gameState?.phase)||view.replayId!==created.replayId)throw Error(`Saved seat ${index+1} does not observe the unfinished game`);
    observedIds.add(view.seatId);
    savedSeats.push({path,client,seatId:view.seatId,priorRunId:view.ai?.runnerRunId||null});
  }
  if(observedIds.size!==occupiedIds.size||[...occupiedIds].some(id=>!observedIds.has(id)))throw Error('Saved seat sessions do not match the four current controllers');

  const attempts=Array.isArray(report.attempts)?report.attempts:[];
  report={...report,attempts:[...attempts,priorAttempt(report)],attemptNumber:attempts.length+2,
    attemptStartedAt:new Date(attemptStartedAt).toISOString(),maxMinutes:minutes,reason:'running',runners:[]};
  delete report.error;delete report.pauseError;delete report.finishedAt;
} else {
  turns=Number(values.turns??'8');timeoutMs=requestedTimeoutMs;
  if(!Number.isInteger(turns)||turns<1||turns>20)throw Error('Use turns 1–20');
  await mkdir(output,{recursive:false,mode:0o700});
  const hostKey=(await readFile(resolve(values['host-key-file']),'utf8')).trim();
  const response=await fetch(new URL('/api/rooms',url),{method:'POST',headers:{'Content-Type':'application/json','X-Host-Key':hostKey},
    body:JSON.stringify({name:'Four Luna Max test',title:'Four Luna Max — bounded live test',seatCount:4,
      seats:Array.from({length:4},()=>({kind:'ai',provider:'codex',model:values.model,chatEnabled:true,chatModel:values.model,chatReasoning:values.reasoning}))})});
  created=await response.json();if(!created.success)throw Error(created.error);
  host=new GameClient({server:url.origin,code:created.code,token:created.token});
  await writeFile(join(output,'host-session.json'),JSON.stringify({server:url.origin,...created}),{mode:0o600,flag:'wx'});
  report={version:1,model:values.model,reasoning:values.reasoning,timeoutMs,code:created.code,replayId:created.replayId,
    startedAt:new Date(attemptStartedAt).toISOString(),attemptStartedAt:new Date(attemptStartedAt).toISOString(),attemptNumber:1,
    requestedTurns:turns,maxMinutes:minutes,eventCounts:{},completedTurns:0,lastEvent:0,attempts:[],reason:'running',runners:[]};
}

const children=[],stopRequested={value:false},deadline=attemptStartedAt+minutes*60000;
let started=Boolean(resumePath),resumed=!resumePath,reason='deadline';
process.once('SIGINT',()=>{stopRequested.value=true;reason='interrupted';});
process.once('SIGTERM',()=>{stopRequested.value=true;reason='interrupted';});
const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
try {
  for(let index=0;index<4;index++) {
    let session,client;
    if(resumePath) {
      ({path:session,client}=savedSeats[index]);
    } else {
      client=new GameClient({server:url.origin,code:created.code});
      const joined=await client.join({name:`Luna ${index+1}`,role:'ai',provider:'codex',model:values.model});
      session=join(output,`seat-${index+1}.json`);
      await writeFile(session,JSON.stringify({server:url.origin,code:created.code,token:joined.token,provider:'codex',model:values.model,
        reasoning:values.reasoning,decisionTimeoutMs:timeoutMs,memory:'',contexts:{},chatCursor:0}),{mode:0o600,flag:'wx'});
      savedSeats.push({path:session,client,seatId:joined.seatId,priorRunId:null});
    }
    const child=spawn(process.execPath,['bridge/cli.js','run','--session',session],{stdio:['ignore','ignore','pipe']});
    const entry={seat:index+1,pid:child.pid,exitCode:null,error:null};report.runners.push(entry);
    child.stderr.on('data',chunk=>{const message=chunk.toString().trim();if(!message.startsWith('Running '))entry.error=message.slice(-500);});
    child.on('error',error=>{entry.error=error.message;entry.exitCode=-1;});
    child.on('exit',code=>{entry.exitCode=code??-1;});children.push(child);
  }
  console.log(JSON.stringify({code:created.code,replay:`${url.origin}/replay/${created.replayId}`,output,resume:Boolean(resumePath),
    attempt:report.attemptNumber,runners:report.runners.map(r=>({seat:r.seat,pid:r.pid}))}));
  await save();
  while(!stopRequested.value&&Date.now()<deadline) {
    if(report.runners.some(r=>r.exitCode!==null)){reason='runner-stopped';break;}
    let view=await host.observe();
    if(resumePath&&!resumed) {
      const ownViews=await Promise.all(savedSeats.map(seat=>seat.client.observe()));
      const attached=ownViews.every((own,index)=>own.ai?.runnerAttached===true&&own.ai?.runnerRunId&&own.ai.runnerRunId!==savedSeats[index].priorRunId);
      if(!attached){await sleep(1000);continue;}
      view=await host.observe();
      if(view.gameState?.phase==='finished'){reason='finished';break;}
      if(view.paused)await host.act(view,'resume');
      resumed=true;report.resumedAt=new Date().toISOString();await save();
      view=await host.observe();
    }
    if(!started&&view.slots.every(slot=>slot.occupied&&slot.ready)) {await host.act(view,'start');started=true;view=await host.observe();}
    if(view.gameState?.phase==='finished'){reason='finished';break;}
    const eventsResponse=await fetch(new URL(`/api/replays/${created.replayId}/events?after=${after}&limit=1000`,url));
    const events=await eventsResponse.json();if(!events.success)throw Error(events.error);
    for(const event of events.events||[]) {
      after=Math.max(after,event.seq);report.eventCounts[event.type]=(report.eventCounts[event.type]||0)+1;
      if(event.type==='endTurn')endedTurns++;
      if(['aiNegotiation','tradeOffer','tradeCounter','tradeAccept','tradeConfirm','rollDice','endTurn','placeSettlement','placeRoad','discardCards','moveRobber','chooseRobberCard'].includes(event.type))
        console.log(JSON.stringify({seq:event.seq,type:event.type,actor:event.actorName,turn:event.turn,elapsedMs:event.elapsedMs}));
    }
    report.completedTurns=endedTurns;report.lastEvent=after;await save();
    if(endedTurns>=turns){reason='checkpoint';break;}
    await sleep(2000);
  }
}catch(error){reason='error';report.error=error.message;}
finally {
  try {
    let view=await host.observe();
    if(view.gameState&&view.gameState.phase!=='finished'&&!view.paused) {
      for(let attempt=0;attempt<3;attempt++)try{await host.act(view,'pause');break;}catch(error){if(error.status!==409)throw error;view=await host.observe();}
    }
  }catch(error){report.pauseError=error.message;}
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},4000);child.once('exit',()=>{clearTimeout(timer);resolve();});})));
  report.reason=reason;report.finishedAt=new Date().toISOString();report.completedTurns=endedTurns;report.lastEvent=after;await save();
  console.log(JSON.stringify({reason,completedTurns:endedTurns,report:join(output,'report.json'),replay:`${url.origin}/replay/${created.replayId}`}));
}
if(!['checkpoint','finished'].includes(reason))process.exitCode=1;
