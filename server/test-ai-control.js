import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';

class MemoryStore {
  constructor(){this.saved=[];}
  load(){return structuredClone(this.saved);}
  save(room){const index=this.saved.findIndex(candidate=>candidate.code===room.code);if(index<0)this.saved.push(structuredClone(room));else this.saved[index]=structuredClone(room);}
}

function makeRoom(now,{chatEnabled=true}={}) {
  const store=new MemoryStore(),service=new RoomService({store,now:()=>now.value});
  const created=service.create({name:'Host',seatCount:3,seats:[
    {kind:'ai',provider:'codex',model:'game-model',chatEnabled,chatModel:'chat-model',chatReasoning:'high'},
    {kind:'human'},{kind:'human'}
  ]});
  assert.equal(created.success,true);
  const room=service.rooms.get(created.code),slot=room.slots[0];
  const ai=service.join(created.code,{name:'Cora',role:'ai',seatId:slot.id,provider:'codex',model:'game-model'});
  assert.equal(ai.success,true);
  return {service,store,roomCode:created.code,host:{token:created.token},ai};
}

function command(service,code,actor,type,payload={},extra={}) {
  const view=service.observe(code,actor.token);
  return service.command(code,actor.token,{requestId:`test-${Math.random()}`,revision:view.revision,generation:view.generation,
    controlEpoch:view.controlEpoch,...extra,type,payload});
}

test('one managed runner is leased, epoch fenced, paused, resumed, and cancelled',()=>{
  const now={value:10000},{service,roomCode,host,ai}=makeRoom(now),runId='runner-one',otherRun='runner-two';
  let result=service.aiLease(roomCode,ai.token,{runId,controlEpoch:ai.controlEpoch});assert.equal(result.success,true);
  assert.equal(service.aiLease(roomCode,ai.token,{runId:otherRun,controlEpoch:ai.controlEpoch}).statusCode,409);
  assert.equal(service.aiHeartbeat(roomCode,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'thinking'}).success,true);
  let hostView=service.observe(roomCode,host.token),ownView=service.observe(roomCode,ai.token);
  assert.equal(hostView.slots[0].ai.status,'thinking');assert.equal(hostView.slots[0].ai.runnerAttached,true);
  assert.equal(JSON.stringify(hostView.slots[0]).includes(runId),false);assert.equal(ownView.ai.runnerRunId,runId);

  const before=structuredClone(service.rooms.get(roomCode));
  assert.equal(service.command(roomCode,ai.token,{requestId:'missing-epoch',revision:ownView.revision,generation:ai.generation,type:'ready',payload:{}}).statusCode,409);
  assert.deepEqual(service.rooms.get(roomCode),before);
  assert.equal(command(service,roomCode,ai,'ready',{}, {runId:otherRun}).statusCode,409);
  assert.equal(command(service,roomCode,ai,'ready',{}, {runId}).success,true);

  hostView=service.observe(roomCode,host.token);
  const pauseEnvelope={requestId:'pause-once',revision:hostView.revision,generation:0,type:'aiPause',payload:{seatId:ai.seatId}};
  result=service.command(roomCode,host.token,pauseEnvelope);assert.equal(result.success,true);
  assert.deepEqual(service.command(roomCode,host.token,pauseEnvelope),result,'host control retries are idempotent');
  const pausedEpoch=service.observe(roomCode,ai.token).controlEpoch;
  assert.equal(service.aiHeartbeat(roomCode,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'waiting'}).statusCode,409);
  assert.equal(service.aiHeartbeat(roomCode,ai.token,{runId,controlEpoch:pausedEpoch,status:'thinking'}).success,true);
  ownView=service.observe(roomCode,ai.token);assert.equal(ownView.ai.paused,true);assert.equal(ownView.ai.status,'stopped');assert.equal(ownView.ai.runnerAttached,true);
  assert.equal(service.aiChatRead(roomCode,ai.token,{runId,controlEpoch:pausedEpoch,afterSequence:0}).statusCode,409);

  result=command(service,roomCode,ai,'aiResume',{seatId:ai.seatId});assert.equal(result.success,true);
  let currentEpoch=service.observe(roomCode,ai.token).controlEpoch;
  assert.equal(service.aiLease(roomCode,ai.token,{runId,controlEpoch:currentEpoch}).success,true);
  result=command(service,roomCode,host,'aiCancel',{seatId:ai.seatId});assert.equal(result.success,true);
  ownView=service.observe(roomCode,ai.token);assert.equal(ownView.ai.paused,true);assert.equal(ownView.ai.runnerAttached,false);assert.equal(ownView.ai.runnerRunId,undefined);
  currentEpoch=ownView.controlEpoch;
  assert.equal(service.aiHeartbeat(roomCode,ai.token,{runId,controlEpoch:currentEpoch,status:'thinking'}).statusCode,409);

  assert.equal(command(service,roomCode,host,'aiResume',{seatId:ai.seatId}).success,true);
  currentEpoch=service.observe(roomCode,ai.token).controlEpoch;
  assert.equal(service.aiLease(roomCode,ai.token,{runId:otherRun,controlEpoch:currentEpoch}).success,true);
  assert.equal(service.aiHeartbeat(roomCode,ai.token,{runId:otherRun,controlEpoch:currentEpoch,status:'error',error:'provider failed with private details'.repeat(20)}).success,true);
  ownView=service.observe(roomCode,ai.token);assert.equal(ownView.ai.status,'error');assert.equal(ownView.ai.runnerAttached,false);assert.ok(ownView.ai.error.length<=200);
  assert.equal(service.aiLease(roomCode,ai.token,{runId:'third-run',controlEpoch:currentEpoch}).success,true,'an errored runner releases its lease');
});

test('status becomes stale and offline from server time without claiming model work',()=>{
  const now={value:10000},{service,roomCode,host,ai}=makeRoom(now);
  service.aiLease(roomCode,ai.token,{runId:'status-run',controlEpoch:ai.controlEpoch});
  service.aiHeartbeat(roomCode,ai.token,{runId:'status-run',controlEpoch:ai.controlEpoch,status:'reading-chat'});
  now.value+=21000;
  let status=service.observe(roomCode,host.token).slots[0].ai;
  assert.equal(status.connection,'stale');assert.equal(status.runnerAttached,false);assert.equal(status.status,'reading-chat');
  now.value+=25000;status=service.observe(roomCode,host.token).slots[0].ai;
  assert.equal(status.connection,'offline');assert.equal(status.status,'stopped');
});

test('AI chat reads only humans and replies idempotently under epoch and cooldown limits',()=>{
  const now={value:10000},{service,roomCode,host,ai}=makeRoom(now);
  assert.equal(command(service,roomCode,host,'chat',{message:'What should I build?'}).success,true);
  const aiView=service.observe(roomCode,ai.token);assert.deepEqual(aiView.chat,[]);
  assert.equal(service.aiChatRead(roomCode,ai.token,{afterSequence:0}).statusCode,409);
  const read=service.aiChatRead(roomCode,ai.token,{controlEpoch:aiView.controlEpoch,afterSequence:0});
  assert.equal(read.success,true);assert.equal(read.messages.length,1);assert.equal(read.messages[0].authorRole,'human');
  assert.equal(read.chatModel,'chat-model');assert.equal(read.chatReasoning,'high');
  const reply={requestId:'reply-1',controlEpoch:aiView.controlEpoch,replyToSequence:read.messages[0].sequence,message:'I am considering a road.',playerName:'Forged Host'};
  const sent=service.aiChatReply(roomCode,ai.token,reply);assert.equal(sent.success,true);
  assert.deepEqual(service.aiChatReply(roomCode,ai.token,reply),sent);
  let chat=service.observe(roomCode,host.token).chat;assert.equal(chat.length,2);assert.equal(chat[1].authorRole,'ai');assert.equal(chat[1].playerName,'Cora');
  assert.equal(service.aiChatRead(roomCode,ai.token,{controlEpoch:aiView.controlEpoch,afterSequence:0}).messages.length,1,'AI replies never feed another AI reply');
  assert.equal(command(service,roomCode,host,'chat',{message:'And after that?'}).success,true);
  chat=service.observe(roomCode,host.token).chat;
  assert.equal(service.aiChatReply(roomCode,ai.token,{...reply,requestId:'reply-2',replyToSequence:chat.at(-1).sequence}).statusCode,429);
  now.value+=5000;
  assert.equal(service.aiChatReply(roomCode,ai.token,{...reply,requestId:'reply-3',replyToSequence:chat.at(-1).sequence}).success,true);
});

test('disabled chat and malformed AI chat configuration are enforced',()=>{
  const now={value:10000},{service,roomCode,ai}=makeRoom(now,{chatEnabled:false});
  const read=service.aiChatRead(roomCode,ai.token,{controlEpoch:ai.controlEpoch,afterSequence:0});assert.equal(read.chatEnabled,false);
  assert.equal(service.aiChatReply(roomCode,ai.token,{requestId:'disabled',controlEpoch:ai.controlEpoch,replyToSequence:1,message:'No'}).success,false);
  assert.equal(service.create({name:'Bad',seatCount:3,seats:[{kind:'ai',provider:'codex',chatReasoning:'impossible'}]}).success,false);
});

test('control epochs and AI chat configuration survive persistence and host reconfiguration',()=>{
  const now={value:10000},{service,store,roomCode,host,ai}=makeRoom(now);
  assert.equal(command(service,roomCode,host,'aiPause',{seatId:ai.seatId}).success,true);
  const before=service.observe(roomCode,host.token),epoch=before.slots[0].ai.controlEpoch;
  const restarted=new RoomService({store,now:()=>now.value});
  const restored=restarted.observe(roomCode,host.token);
  assert.equal(restored.slots[0].ai.controlEpoch,epoch);assert.equal(restored.slots[0].ai.paused,true);
  assert.equal(restored.slots[0].chatEnabled,true);assert.equal(restored.slots[0].chatModel,'chat-model');assert.equal(restored.slots[0].chatReasoning,'high');

  const vacant=restored.slots[1];
  assert.equal(command(restarted,roomCode,host,'configureSeat',{seatId:vacant.id,kind:'ai',provider:'codex',model:'other-game',chatEnabled:false,chatModel:'other-chat',chatReasoning:'max'}).success,true);
  const configured=restarted.observe(roomCode,host.token).slots[1];
  assert.equal(configured.kind,'ai');assert.equal(configured.chatEnabled,false);assert.equal(configured.chatModel,'other-chat');assert.equal(configured.chatReasoning,'max');
});

test('in-flight AI replies are rejected while the room is paused or ended',()=>{
  const now={value:10000},{service,roomCode,host,ai}=makeRoom(now);
  command(service,roomCode,host,'chat',{message:'Any offers?'});
  const room=service.rooms.get(roomCode);room.paused=true;
  const reply={requestId:'late-reply',controlEpoch:ai.controlEpoch,replyToSequence:1,message:'An offer'};
  assert.equal(service.aiChatReply(roomCode,ai.token,reply).statusCode,409);
  room.paused=false;room.game={phase:'finished'};
  assert.equal(service.aiChatReply(roomCode,ai.token,reply).statusCode,409);
  assert.equal(room.chat.length,1);
});

test('a room pause and resume invalidate pre-pause AI work while preserving its runner',()=>{
  const now={value:10000},{service,roomCode,host,ai}=makeRoom(now);
  const human1=service.join(roomCode,{name:'One',role:'human'}),human2=service.join(roomCode,{name:'Two',role:'human'});
  for(const actor of [ai,human1,human2])assert.equal(command(service,roomCode,actor,'ready').success,true);
  assert.equal(command(service,roomCode,host,'start').success,true);
  const initial=service.observe(roomCode,ai.token),runId='room-pause-runner';
  assert.equal(service.aiLease(roomCode,ai.token,{runId,controlEpoch:initial.controlEpoch}).success,true);
  assert.equal(command(service,roomCode,host,'pause').success,true);
  assert.equal(command(service,roomCode,host,'resume').success,true);
  const resumed=service.observe(roomCode,ai.token);
  assert.equal(resumed.paused,false);assert.equal(resumed.controlEpoch,initial.controlEpoch+2);
  assert.equal(resumed.ai.runnerRunId,runId);assert.equal(resumed.ai.paused,false);
  assert.equal(command(service,roomCode,ai,'ready',{}, {runId,controlEpoch:initial.controlEpoch}).statusCode,409);
  assert.equal(service.aiLease(roomCode,ai.token,{runId,controlEpoch:resumed.controlEpoch}).success,true);
});
