import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoomStore} from './store.js';
import {RoomService} from './roomService.js';
import {captureState} from './recording.js';

let request=0;
const envelope=(service,code,actor,type,payload={})=>{
  const room=service.roomFor(code),slot=actor.seatId?room.slots.find(candidate=>candidate.id===actor.seatId):null;
  return service.command(code,actor.token,{requestId:`recording-${++request}`,revision:room.revision,generation:actor.generation,
    ...(slot?.kind==='ai'?{controlEpoch:slot.controlEpoch}:{}) ,type,payload});
};

function fixture({path=':memory:',now={value:1000}}={}) {
  const store=new RoomStore(path),service=new RoomService({store,now:()=>now.value});
  const created=service.create({name:'Replay Host',seatCount:3,title:'Recorded table'});
  const slots=service.rooms.get(created.code).slots;
  const players=slots.map((slot,index)=>service.join(created.code,{name:`Player ${index+1}`,role:'human',seatId:slot.id}));
  players.forEach(player=>assert.equal(envelope(service,created.code,{...player,token:player.token},'ready').success,true));
  assert.equal(envelope(service,created.code,{token:created.token},'start').success,true);
  return {store,service,created,players,now};
}

test('journal commits exact state with receipts and idempotent retries',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catan-recording-')),path=join(dir,'rooms.sqlite');
  try {
    const {store,service,created,players,now}=fixture({path});
    const before=service.replayEvents(created.replayId).lastSeq;
    const room=service.rooms.get(created.code),actor=players.find(player=>player.seatId===room.game.players[room.game.currentPlayerIndex].id);
    const command={requestId:'retry-once',revision:room.revision,generation:actor.generation,type:'placeSettlement',payload:{vertexKey:Object.keys(room.game.vertices).find(key=>room.game.vertices[key].building===null)}};
    // The first setup vertex may be illegal; use the legal action exposed to this seat.
    command.payload=service.observe(created.code,actor.token).legalActions.find(action=>action.type==='placeSettlement').payload;
    now.value+=125;const first=service.command(created.code,actor.token,command);
    assert.equal(first.success,true);
    assert.deepEqual(service.command(created.code,actor.token,command),first);
    const events=service.replayEvents(created.replayId);
    assert.equal(events.lastSeq,before+1);
    assert.equal(events.events.filter(event=>event.type==='placeSettlement').length,1);
    const replay=service.replay(created.replayId,{perspective:'omniscient'});
    assert.equal(replay.statusCode,403);
    const internal=store.getRecording(created.replayId);
    assert.deepEqual(service.replay(created.replayId,{perspective:actor.seatId,token:actor.token}).state.gameState,
      service.observe(created.code,actor.token).gameState);
    assert.equal(internal.lastElapsedMs,125);
    store.close();

    const restartedStore=new RoomStore(path),restarted=new RoomService({store:restartedStore,now:()=>5000});
    const recovered=restarted.replay(created.replayId,{perspective:'public'});
    assert.equal(recovered.success,true);assert.equal(recovered.recording.status,'interrupted');assert.equal(recovered.recording.partial,false);
    assert.equal(restarted.replayEvents(created.replayId).events.at(-1).type,'crashgap');
    restartedStore.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('room snapshot and journal event roll back together when event insertion fails',()=>{
  const store=new RoomStore(':memory:'),service=new RoomService({store});
  const created=service.create({name:'Atomic',seatCount:3}),slot=service.rooms.get(created.code).slots[0];
  const player=service.join(created.code,{name:'Alice',role:'human',seatId:slot.id});
  const revision=service.rooms.get(created.code).revision,lastSeq=store.getRecording(created.replayId).lastSeq;
  store.db.exec(`CREATE TRIGGER reject_recording_event BEFORE INSERT ON recording_events BEGIN SELECT RAISE(FAIL,'journal unavailable'); END`);
  const result=envelope(service,created.code,player,'ready');
  assert.equal(result.success,false);assert.equal(result.statusCode,500);assert.equal(service.rooms.get(created.code).revision,revision);
  assert.equal(store.loadRoom(created.code).revision,revision);assert.equal(store.getRecording(created.replayId).lastSeq,lastSeq);
  store.db.exec('DROP TRIGGER reject_recording_event');
  assert.equal(envelope(service,created.code,player,'ready').success,true);
  assert.equal(store.getRecording(created.replayId).lastSeq,lastSeq+1);
  store.close();
});

test('legacy saved rooms migrate to an explicit partial baseline',()=>{
  const store=new RoomStore(':memory:');
  store.save({code:'LEGACY01',revision:4,name:'Recovered legacy room',slots:[
    {id:'seat-1',name:'Alice',kind:'human',provider:null,model:null,generation:1,controller:null,ready:false},
    {id:'seat-2',name:'Seat 2',kind:'human',provider:null,model:null,generation:0,controller:null,ready:false},
    {id:'seat-3',name:'Seat 3',kind:'human',provider:null,model:null,generation:0,controller:null,ready:false}],
    members:{},game:null,trade:null,chat:[],receipts:{},cardEvents:[],paused:false});
  const service=new RoomService({store,now:()=>9000}),room=service.rooms.get('LEGACY01');
  assert.ok(room.recordingId);
  const recording=service.replay(room.recordingId);
  assert.equal(recording.success,true);assert.equal(recording.recording.partial,true);
  assert.equal(service.replayEvents(room.recordingId).events[0].type,'partialBaseline');
  store.close();
});

test('unfinished replay, events, metrics, and export share generation-aware privacy',()=>{
  const {store,service,created,players}=fixture();
  const original=players[0],room=service.rooms.get(created.code),player=room.game.players.find(candidate=>candidate.id===original.seatId);
  player.resources.brick=3;player.developmentCards=['victoryPoint'];player.hiddenVictoryPoints=1;
  service.persist(room,{type:'discardCards',actorSeatId:original.seatId,actorGeneration:original.generation,actorName:'Player 1',
    summary:'Player 1 discarded cards',payload:{resources:{brick:2}}});
  const privateReplay=service.replay(created.replayId,{perspective:original.seatId,token:original.token});
  assert.equal(privateReplay.state.gameState.players.find(candidate=>candidate.id===original.seatId).resources.brick,3);
  const publicReplay=service.replay(created.replayId);
  assert.equal(publicReplay.state.gameState.players.find(candidate=>candidate.id===original.seatId).resources,3);
  assert.equal(publicReplay.state.gameState.devCardDeck.constructor,Number);
  assert.equal(service.replayEvents(created.replayId).events.at(-1).payload.count,2);
  assert.equal(Object.hasOwn(service.replayMetrics(created.replayId).points.at(-1).players[0],'totalVP'),false);
  const publicExport=service.replayExport(created.replayId).lines.join('');
  assert.equal(publicExport.includes('"developmentCards":["victoryPoint"]'),false);assert.equal(publicExport.includes('"brick":3'),false);

  assert.equal(envelope(service,created.code,{token:created.token},'removeController',{seatId:original.seatId,kind:'human'}).success,true);
  const replacement=service.join(created.code,{name:'Replacement',role:'human',seatId:original.seatId});
  const beforeReplacementSeq=service.replayEvents(created.replayId).events.find(event=>event.type==='removeController').seq-1;
  const oldView=service.replay(created.replayId,{at:beforeReplacementSeq,perspective:original.seatId,token:replacement.token});
  assert.equal(typeof oldView.state.gameState.players.find(candidate=>candidate.id===original.seatId).resources,'number');
  assert.equal(service.replay(created.replayId,{perspective:original.seatId,token:original.token}).statusCode,403);
  while(store.getRecording(created.replayId).lastSeq<52)service.persist(service.rooms.get(created.code),{type:'pause',summary:'Checkpoint privacy fixture'});
  assert.equal(Object.hasOwn(service.replay(created.replayId).recording,'checkpoints'),false);
  const restarted=new RoomService({store,now:()=>5000}),afterCheckpoint=restarted.replayExport(created.replayId).lines.join('');
  assert.equal(afterCheckpoint.includes('"brick":3'),false);assert.equal(afterCheckpoint.includes('"developmentCards":["victoryPoint"]'),false);
  store.close();
});

test('finished recordings become lazy omniscient archives and can be deleted',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catan-archive-')),path=join(dir,'rooms.sqlite');
  try {
    let {store,service,created}=fixture({path});
    assert.equal(envelope(service,created.code,{token:created.token},'endGame').success,true);
    const replay=service.replay(created.replayId,{perspective:'omniscient'});
    assert.equal(replay.success,true);assert.equal(replay.recording.status,'ended');assert.ok(replay.perspectives.some(item=>item.id==='omniscient'));
    assert.deepEqual(replay.state,captureState(store.loadRoom(created.code)),'terminal replay reconstructs the exact resolved state');
    assert.equal(service.rooms.has(created.code),false,'finished rooms are evicted immediately');
    assert.equal(service.recordings.has(created.replayId),false,'finished journals are evicted immediately');
    assert.equal(service.observe(created.code,created.token).success,true);
    assert.equal(service.rooms.has(created.code),false,'reading an archive does not retain its runtime');
    store.close();store=new RoomStore(path);service=new RoomService({store});
    assert.equal(service.rooms.has(created.code),false,'finished rooms are not eagerly loaded');
    assert.equal(service.replay(created.replayId).success,true);
    assert.equal(service.deleteReplay(created.replayId).success,true);
    assert.equal(service.replay(created.replayId).statusCode,404);assert.equal(store.loadRoom(created.code),null);
    store.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('seek resumes from the nearest durable checkpoint',()=>{
  const store=new RoomStore(':memory:'),service=new RoomService({store,now:(()=>{let value=0;return()=>++value;})()});
  const created=service.create({name:'Checkpoint'}),room=service.rooms.get(created.code);
  for(let index=1;index<=55;index++) {
    room.chat.push({id:`message-${index}`,sequence:index,authorRole:'human',playerName:'Host',playerId:null,message:`Message ${index}`,timestamp:index});
    service.persist(room,{type:'chat',actorName:'Host',summary:'Host sent a message',payload:{message:`Message ${index}`}});
  }
  const checkpoint=store.getRecordingCheckpoint(created.replayId,53);assert.equal(checkpoint.seq,50);
  store.db.prepare('DELETE FROM recording_events WHERE recording_id=? AND seq<?').run(created.replayId,50);
  const restarted=new RoomService({store,now:()=>100});
  const sought=restarted.replay(created.replayId,{at:53});
  assert.equal(sought.success,true);assert.equal(sought.seq,53);assert.equal(sought.state.chat.at(-1).message,'Message 52');
  store.close();
});

test('AI heartbeat polling records only status transitions and no runner credentials',()=>{
  const now={value:1000},store=new RoomStore(':memory:'),service=new RoomService({store,now:()=>now.value});
  const created=service.create({name:'AI table',seatCount:3,seats:[{kind:'ai',provider:'codex',model:'game-model'}]});
  const slot=service.rooms.get(created.code).slots[0],ai=service.join(created.code,{name:'Bot',role:'ai',seatId:slot.id,provider:'codex',model:'game-model'});
  const privateSentinel='PRIVATE-PROMPT-TOKEN-should-never-record';
  assert.equal(envelope(service,created.code,ai,'ready',{unused:privateSentinel}).success,true);
  const runId='runner-secret-id',lease=service.aiLease(created.code,ai.token,{runId,controlEpoch:ai.controlEpoch});assert.equal(lease.success,true);
  const firstCount=service.replayEvents(created.replayId).lastSeq;
  assert.equal(service.aiHeartbeat(created.code,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'error',error:privateSentinel}).success,true);
  const transitioned=service.replayEvents(created.replayId).lastSeq;assert.equal(transitioned,firstCount+1);
  now.value+=1;assert.equal(service.aiHeartbeat(created.code,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'error',error:privateSentinel}).success,true);
  assert.equal(service.replayEvents(created.replayId).lastSeq,transitioned);
  const room=service.rooms.get(created.code);room.game={phase:'finished',winner:null,players:[]};service.persist(room,{type:'endGame',summary:'Replay ended'});
  const exported=service.replayExport(created.replayId,{perspective:'omniscient'}).lines.join('');
  assert.equal(exported.includes(runId),false);assert.equal(exported.includes(ai.token),false);assert.equal(exported.includes(privateSentinel),false);
  assert.equal(exported.includes('AI runner reported an error'),true);
  store.close();
});


test('durable journals page from SQLite without retaining growing event or checkpoint arrays',()=>{
  const {store,service,created}=fixture();
  for(let index=0;index<110;index++)assert.equal(envelope(service,created.code,{token:created.token},'chat',{message:`Durable message ${index}`}).success,true);
  const cached=service.recordings.get(created.replayId);
  assert.equal(Array.isArray(cached.events),false);assert.equal(Array.isArray(cached.checkpoints),false);
  assert.ok(store.getRecordingCheckpoint(created.replayId,100));
  const reads=[],readEvents=store.getRecordingEvents.bind(store);
  store.getRecordingEvents=(id,options)=>{reads.push(options);return readEvents(id,options);};
  const page=service.replayEvents(created.replayId,{after:100,limit:3});
  assert.deepEqual(page.events.map(event=>event.seq),[101,102,103]);
  assert.deepEqual(reads[0],{after:100,limit:3});
  const sought=service.replay(created.replayId,{at:103});
  assert.equal(sought.success,true);assert.equal(sought.seq,103);
  assert.deepEqual(reads[1],{after:99,limit:4});
  assert.equal(sought.state.chat.at(-1).message,'Durable message 94');
  store.close();
});

test('stores without durable journal support retain complete fallback events and checkpoints',()=>{
  const snapshots=new Map(),store={load:()=>[],save:room=>snapshots.set(room.code,structuredClone(room))};
  const service=new RoomService({store}),created=service.create({name:'Memory fallback'});
  for(let index=0;index<55;index++)assert.equal(envelope(service,created.code,{token:created.token},'chat',{message:`Memory message ${index}`}).success,true);
  const recording=service.recordings.get(created.replayId);
  assert.equal(recording.events.length,56);assert.equal(recording.checkpoints[0].seq,50);
  assert.equal(service.replayEvents(created.replayId,{after:50,limit:2}).events.length,2);
  assert.equal(service.replay(created.replayId,{at:53}).state.chat.at(-1).message,'Memory message 51');
  assert.equal(service.replayExport(created.replayId).success,true);
});

test('terminal checkpoint failure rolls back the archive and retry receipt before eviction',()=>{
  const {store,service,created}=fixture(),room=service.rooms.get(created.code),revision=room.revision;
  const before=store.getRecording(created.replayId).lastSeq;
  const command={requestId:'terminal-retry',revision,type:'endGame',payload:{}};
  service.observe(created.code,created.token);
  service.aiToolActivity.set(`${created.code}:retired:1`,{lastActivityAt:1});
  service.legalCache.set(created.code,new Map());
  store.db.exec("CREATE TRIGGER reject_terminal_checkpoint BEFORE INSERT ON recording_checkpoints BEGIN SELECT RAISE(FAIL,'checkpoint unavailable'); END");
  const failed=service.command(created.code,created.token,command);
  assert.equal(failed.statusCode,500);assert.equal(service.rooms.has(created.code),true);
  assert.equal(store.getRecording(created.replayId).lastSeq,before);
  assert.equal(store.loadRoom(created.code).game.phase,'setup');
  assert.equal(store.loadRoom(created.code).revision,revision);
  store.db.exec('DROP TRIGGER reject_terminal_checkpoint');
  const accepted=service.command(created.code,created.token,command);assert.equal(accepted.success,true);
  assert.equal(service.rooms.size,0);assert.equal(service.recordings.size,0);assert.equal(service.presence.size,0);
  assert.equal(service.aiToolActivity.size,0);assert.equal(service.legalCache.size,0);
  assert.deepEqual(service.command(created.code,created.token,command),accepted);
  assert.equal(store.getRecording(created.replayId).lastSeq,before+1);
  assert.equal(service.observe(created.code,created.token).gameState.phase,'finished');
  assert.equal(service.join(created.code,{name:'Archive visitor'}).success,true);
  assert.equal(service.rooms.size,0);assert.equal(service.recordings.size,0);assert.equal(service.presence.size,0);
  store.close();
});

test('many terminal archives consume no room or journal cache capacity',()=>{
  const store=new RoomStore(':memory:'),service=new RoomService({store});
  for(let index=0;index<55;index++) {
    const created=service.create({name:`Archived ${index}`});assert.equal(created.success,true);
    const room=service.rooms.get(created.code);room.game={phase:'finished',winner:null,players:[]};
    service.persist(room,{type:'endGame',summary:'Fixture ended'});
  }
  assert.equal(service.rooms.size,0);assert.equal(service.recordings.size,0);
  assert.equal(service.listReplays({limit:100}).total,55);
  assert.equal(service.create({name:'Active after archives'}).success,true);
  store.close();
});

test('replacement AI lease journals sanitized status transitions without recording renewal polls',()=>{
  const now={value:1000},store=new RoomStore(':memory:'),service=new RoomService({store,now:()=>now.value});
  const created=service.create({name:'Lease replacement',seats:[{kind:'ai',provider:'codex'}]});
  const ai=service.join(created.code,{name:'Bot',role:'ai',seatId:service.rooms.get(created.code).slots[0].id,provider:'codex'});
  const oldRun='old-private-run-id',newRun='new-private-run-id';
  assert.equal(service.aiLease(created.code,ai.token,{runId:oldRun,controlEpoch:ai.controlEpoch}).success,true);
  assert.equal(service.aiHeartbeat(created.code,ai.token,{runId:oldRun,controlEpoch:ai.controlEpoch,status:'error',error:'private failure one'}).success,true);
  const errored=service.replayEvents(created.replayId).lastSeq;
  assert.equal(service.aiHeartbeat(created.code,ai.token,{runId:oldRun,controlEpoch:ai.controlEpoch,status:'error',error:'private failure two'}).success,true);
  assert.equal(service.replayEvents(created.replayId).lastSeq,errored,'different raw errors have the same observable projection');
  now.value++;
  assert.equal(service.aiLease(created.code,ai.token,{runId:newRun,controlEpoch:ai.controlEpoch}).success,true);
  assert.equal(service.replayEvents(created.replayId).lastSeq,errored+1);
  const state=service.replay(created.replayId).state.slots.find(slot=>slot.id===ai.seatId).ai;
  assert.equal(state.status,'waiting');assert.equal(Object.hasOwn(state,'error'),false);
  assert.equal(service.aiLease(created.code,ai.token,{runId:newRun,controlEpoch:ai.controlEpoch}).success,true);
  assert.equal(service.replayEvents(created.replayId).lastSeq,errored+1);
  const exported=service.replayExport(created.replayId).lines.join('');
  for(const value of [oldRun,newRun,'private failure one','private failure two'])assert.equal(exported.includes(value),false);
  store.close();
});
