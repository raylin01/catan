import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoomService,ROOM_CAPACITY,ROOM_INACTIVITY_MS} from './roomService.js';
import {RoomStore} from './store.js';

let request=0;
function act(service,room,actor,type,payload={}) {
  const view=service.observe(room.code,actor.token);
  assert.equal(view.success,true);
  return service.command(room.code,actor.token,{requestId:`public-room-${++request}`,revision:view.revision,
    generation:actor.generation,type,payload});
}
function filled(service,name) {
  const room=service.create({name});assert.equal(room.success,true);
  const players=service.roomFor(room.code).slots.map((slot,index)=>service.join(room.code,{name:`Player ${index+1}`,role:'human',seatId:slot.id}));
  for(const player of players)assert.equal(act(service,room,player,'ready').success,true);
  return {room,players};
}

test('sixteen unfinished rooms count waiting and active rooms; a trusted operator may exceed the cap',()=>{
  const service=new RoomService();
  const created=Array.from({length:ROOM_CAPACITY},(_,index)=>service.create({name:`Room ${index}`}));
  assert.ok(created.every(room=>room.success));
  assert.deepEqual(service.capacity(),{success:true,maxRooms:16,activeRooms:16,available:0,inactivityMs:ROOM_INACTIVITY_MS});
  assert.equal(service.create({name:'Spoofed',operator:true,isOperator:true}).statusCode,429);
  assert.equal(service.create({name:'Still spoofed'},{operator:false}).statusCode,429);
  const operator=service.create({name:'Operator excess',operator:false},{operator:true});
  assert.equal(operator.success,true);assert.equal(service.capacity().activeRooms,17);
  const excessPlayers=service.roomFor(operator.code).slots.map((slot,index)=>service.join(operator.code,{name:`Excess ${index}`,role:'human',seatId:slot.id}));
  for(const player of excessPlayers)assert.equal(act(service,operator,player,'ready').success,true);
  assert.equal(act(service,operator,{token:operator.token},'start').success,true);
  const first=created[0];
  assert.equal(act(service,first,{token:first.token},'closeRoom').success,true);
  assert.equal(service.capacity().activeRooms,16);
  assert.equal(service.create({name:'Still full'}).statusCode,429);
  assert.equal(act(service,created[1],{token:created[1].token},'closeRoom').success,true);
  assert.equal(service.create({name:'Freed slot'}).success,true);
});

test('two games start concurrently and public invitations expose only the approved fields',()=>{
  const service=new RoomService();
  const one=filled(service,'First'),two=filled(service,'Second');
  assert.equal(act(service,one.room,{token:one.room.token},'start').success,true);
  assert.equal(act(service,two.room,{token:two.room.token},'start').success,true);
  assert.equal(service.capacity().activeRooms,2);
  const invite=service.invitation(one.room.code.toLowerCase());
  assert.deepEqual(Object.keys(invite).sort(),['code','name','seatCount','slots','status','success'].sort());
  assert.deepEqual(Object.keys(invite.slots[0]).sort(),['id','kind','name','occupied','ready','provider','model'].sort());
  assert.equal(JSON.stringify(invite).includes(one.room.token),false);
  assert.equal(invite.status,'ongoing');
  assert.equal(act(service,one.room,{token:one.room.token},'endGame').success,true);
  assert.equal(service.capacity().activeRooms,1);
  assert.equal(service.invitation(one.room.code).replayId,one.room.replayId);
});

test('anonymous watch matches spectator game privacy without adding members or activity',()=>{
  const clock={now:1000},service=new RoomService({now:()=>clock.now});
  const {room}=filled(service,'Watchable');
  const spectator=service.join(room.code,{name:'Spectator'});
  assert.equal(act(service,room,{token:room.token},'start').success,true);
  const saved=service.roomFor(room.code),player=saved.game.players[0];
  player.resources.brick=3;player.developmentCards=['victoryPoint'];player.hiddenVictoryPoints=1;
  const members=Object.keys(saved.members).length,lastActivityAt=saved.lastActivityAt;
  const spectatorView=service.observe(room.code,spectator.token);
  const presence=service.presence.size;
  clock.now+=1000;
  const watched=service.watch(room.code);
  assert.equal(watched.success,true);assert.equal(watched.role,'spectator');
  assert.deepEqual(watched.gameState,spectatorView.gameState);
  assert.deepEqual(watched.cardEvents,spectatorView.cardEvents);
  assert.deepEqual(watched.rollEvent,spectatorView.rollEvent);
  assert.equal(watched.gameState.myIndex,-1);
  assert.equal(watched.gameState.players[0].resources,3);
  assert.equal(watched.gameState.players[0].developmentCards,1);
  assert.equal(watched.gameState.players[0].hiddenVictoryPoints,0);
  assert.equal(Object.hasOwn(watched,'replayId'),false);
  assert.equal(Object.keys(service.roomFor(room.code).members).length,members);
  assert.equal(service.roomFor(room.code).lastActivityAt,lastActivityAt);
  assert.equal(service.presence.size,presence,'watch creates no additional presence');
  assert.equal(JSON.stringify(watched).includes(room.token),false);
  assert.equal(JSON.stringify(watched).includes(spectator.token),false);
  assert.equal(Object.hasOwn(watched.slots[0],'controller'),false);
  assert.equal(Object.hasOwn(watched.slots[0],'generation'),false);
  clock.now=lastActivityAt+ROOM_INACTIVITY_MS;
  const closed=service.watch(room.code);
  assert.equal(closed.status,'closed');assert.equal(closed.replayId,room.replayId);
});

test('only a host closes a waiting or active room; closure has no winner and preserves replay',()=>{
  const service=new RoomService();
  const waiting=service.create({name:'Waiting'}),visitor=service.join(waiting.code,{name:'Visitor'});
  assert.equal(act(service,waiting,visitor,'closeRoom').statusCode,403);
  assert.equal(act(service,waiting,{token:waiting.token},'closeRoom').success,true);
  const view=service.observe(waiting.code,waiting.token);
  assert.equal(view.status,'closed');assert.equal(view.closed,true);assert.deepEqual(view.legalActions,[]);
  assert.equal(service.join(waiting.code,{name:'Late'}).statusCode,410);
  assert.equal(act(service,waiting,{token:waiting.token},'chat',{message:'Too late'}).statusCode,410);
  assert.equal(service.replay(waiting.replayId,{perspective:'omniscient'}).recording.status,'closed');
  assert.equal(service.invitation(waiting.code).replayId,waiting.replayId);

  const active=filled(service,'Active');
  assert.equal(act(service,active.room,{token:active.room.token},'start').success,true);
  assert.equal(act(service,active.room,{token:active.room.token},'closeRoom').success,true);
  const ended=service.observe(active.room.code,active.room.token);
  assert.equal(ended.gameState.phase,'finished');assert.equal(ended.gameState.winner,null);
  assert.equal(service.replay(active.room.replayId,{perspective:'omniscient'}).state.gameState.winner,null);
  assert.equal(service.replayEvents(active.room.replayId).events.at(-1).type,'closeRoom');
});

test('polls and AI heartbeats do not extend idle lifetime; chat, joins, and commands do',()=>{
  const clock={now:1000},store=new RoomStore(':memory:');
  const service=new RoomService({store,now:()=>clock.now});
  const room=service.create({name:'Activity',seats:[{kind:'ai',provider:'codex'}]});
  const ai=service.join(room.code,{name:'Bot',role:'ai',seatId:service.roomFor(room.code).slots[0].id,provider:'codex'});
  const runId='activity-runner';
  assert.equal(service.aiLease(room.code,ai.token,{runId,controlEpoch:ai.controlEpoch}).success,true);
  const baseline=service.roomFor(room.code).lastActivityAt;
  clock.now=baseline+1;
  assert.equal(service.aiHeartbeat(room.code,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'thinking'}).success,true);
  clock.now=baseline+ROOM_INACTIVITY_MS-2;
  assert.equal(service.observe(room.code,room.token).success,true);
  assert.equal(service.roomFor(room.code).lastActivityAt,baseline);
  assert.equal(act(service,room,{token:room.token},'chat',{message:'Still here'}).success,true);
  const afterChat=service.roomFor(room.code).lastActivityAt;
  clock.now=afterChat+ROOM_INACTIVITY_MS-2;
  const guest=service.join(room.code,{name:'New guest'});assert.equal(guest.success,true);
  assert.equal(service.roomFor(room.code).lastActivityAt,clock.now);
  clock.now+=ROOM_INACTIVITY_MS;
  assert.deepEqual(service.expireInactiveRooms(),[room.code]);
  assert.equal(service.observe(room.code,room.token).status,'closed');
  assert.equal(service.roomFor(room.code).closeReason,'idle');
  assert.equal(service.aiHeartbeat(room.code,ai.token,{runId,controlEpoch:ai.controlEpoch,status:'thinking'}).statusCode,410);
  store.close();
});

test('paused games expire after restart and terminal replay remains available',()=>{
  const dir=mkdtempSync(join(tmpdir(),'catan-public-rooms-')),path=join(dir,'rooms.sqlite');
  const clock={now:1000};let store;
  try {
    store=new RoomStore(path);let service=new RoomService({store,now:()=>clock.now});
    const {room}=filled(service,'Restarted');
    assert.equal(act(service,room,{token:room.token},'start').success,true);
    const last=service.roomFor(room.code).lastActivityAt;
    store.close();store=new RoomStore(path);
    clock.now=last+ROOM_INACTIVITY_MS;
    service=new RoomService({store,now:()=>clock.now});
    const view=service.observe(room.code,room.token);
    assert.equal(view.status,'closed');assert.equal(view.gameState.phase,'finished');assert.equal(view.gameState.winner,null);
    assert.equal(service.capacity().activeRooms,0);
    assert.deepEqual(store.load(),[],'closed rooms are excluded from active startup loading');
    assert.equal(service.replay(room.replayId,{perspective:'omniscient'}).success,true);
    store.close();store=new RoomStore(path);service=new RoomService({store,now:()=>clock.now+1000});
    assert.equal(service.replay(room.replayId).recording.status,'closed');
    assert.equal(service.invitation(room.code).replayId,room.replayId);
    assert.equal(service.command(room.code,room.token,{requestId:'after-restart',revision:view.revision,type:'resume',payload:{}}).statusCode,410);
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('legacy rooms derive last real activity from recording events, ignoring runner status writes',()=>{
  const clock={now:1000},store=new RoomStore(':memory:');
  let service=new RoomService({store,now:()=>clock.now});
  const room=service.create({name:'Legacy heartbeat',seats:[{kind:'ai',provider:'codex'}]});
  const ai=service.join(room.code,{name:'Bot',role:'ai',seatId:service.roomFor(room.code).slots[0].id,provider:'codex'});
  const lastReal=service.roomFor(room.code).lastActivityAt;
  clock.now+=ROOM_INACTIVITY_MS-1;
  assert.equal(service.aiLease(room.code,ai.token,{runId:'legacy-runner',controlEpoch:ai.controlEpoch}).success,true);
  const old=store.loadRoom(room.code);delete old.lastActivityAt;store.save(old);
  clock.now=lastReal+ROOM_INACTIVITY_MS;
  service=new RoomService({store,now:()=>clock.now});
  assert.equal(service.invitation(room.code).status,'closed');
  assert.equal(service.replay(room.replayId).recording.status,'closed');
  store.close();
});
