import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {syncNegotiationTurn,prepareNegotiation} from './negotiation.js';
import * as G from './gameLogic.js';
import {createAppServer} from './http.js';

class MemoryStore {
  constructor(saved=[]){this.saved=structuredClone(saved);this.fail=false;}
  load(){return structuredClone(this.saved);}
  save(room){
    if(this.fail){const error=Error('disk full');error.code='SQLITE_FULL';throw error;}
    const index=this.saved.findIndex(candidate=>candidate.code===room.code);
    if(index<0)this.saved.push(structuredClone(room));else this.saved[index]=structuredClone(room);
  }
}

function fixture({roles=['ai','ai','ai']}={}) {
  const clock={value:10000},store=new MemoryStore(),service=new RoomService({store,now:()=>clock.value});
  const created=service.create({name:'Host',seatCount:3,seats:roles.map(kind=>kind==='ai'?{kind,provider:'codex',model:'game-model'}:{kind})});
  assert.equal(created.success,true);
  const slots=service.rooms.get(created.code).slots;
  const bots=slots.map((slot,index)=>service.join(created.code,{name:`${roles[index]==='ai'?'Bot':'Human'} ${index+1}`,role:roles[index],seatId:slot.id,
    ...(roles[index]==='ai'?{provider:'codex',model:'game-model'}:{})}));
  bots.forEach(bot=>assert.equal(bot.success,true));
  const room=service.rooms.get(created.code);
  const resources=[
    {brick:3,lumber:2,wool:0,grain:0,ore:0},
    {brick:0,lumber:0,wool:3,grain:2,ore:0},
    {brick:0,lumber:0,wool:0,grain:2,ore:3}
  ];
  room.game=G.createGame(created.code,{id:room.slots[0].id,name:room.slots[0].name});
  for(const slot of room.slots.slice(1))G.addPlayer(room.game,{id:slot.id,name:slot.name});
  G.startGame(room.game);
  room.game.players.sort((a,b)=>room.slots.findIndex(slot=>slot.id===a.id)-room.slots.findIndex(slot=>slot.id===b.id));
  room.game.phase='playing';room.game.turnPhase='main';room.game.currentPlayerIndex=0;room.game.freeRoads=0;room.game.yearOfPlentyPicks=0;
  room.game.players.forEach((player,index)=>{player.resources=resources[index];});
  room.paused=false;syncNegotiationTurn(room);store.save(room);
  bots.forEach((bot,index)=>{if(bot.role==='ai') {
    bot.runId=`runner-${index+1}`;
    assert.equal(service.aiLease(created.code,bot.token,{runId:bot.runId,controlEpoch:bot.controlEpoch}).success,true);
  }});
  return {clock,store,service,code:created.code,host:{token:created.token},bots,room:()=>service.rooms.get(created.code)};
}

function act(f,actor,type,payload={},requestId=`act-${Math.random()}`) {
  const view=f.service.observe(f.code,actor.token);
  return f.service.command(f.code,actor.token,{requestId,revision:view.revision,generation:view.generation,
    ...(actor.role==='ai'?{controlEpoch:view.controlEpoch,runId:actor.runId}:{}),type,payload});
}

function publish(f,bot,intent,overrides={}) {
  const view=f.service.observe(f.code,bot.token);
  return f.service.aiNegotiate(f.code,bot.token,{
    requestId:overrides.requestId||`neg-${Math.random()}`,
    controlEpoch:overrides.controlEpoch??view.controlEpoch,
    runId:overrides.runId??bot.runId,
    revision:overrides.revision??view.revision,
    generation:overrides.generation??view.generation,
    intent,
    ...(overrides.extra||{})
  });
}

function read(f,bot,afterNegotiationSequence=0,overrides={}) {
  const view=f.service.observe(f.code,bot.token);
  return f.service.aiChatRead(f.code,bot.token,{controlEpoch:view.controlEpoch,runId:bot.runId,afterSequence:0,afterNegotiationSequence,...overrides});
}

test('typed interest projection contains no prose, player names, counts, or private inventory',()=>{
  const f=fixture(),[a,b,c]=f.bots;
  const sent=publish(f,a,{kind:'interest',wants:['ore','grain'],offers:['lumber','brick'],to:null,replyToId:null});
  assert.equal(sent.success,true,JSON.stringify(sent));
  const hostChat=f.service.observe(f.code,f.host.token).chat;
  assert.equal(hostChat.length,1);
  assert.equal(hostChat[0].message,'Bot 1 is looking for grain or ore and can offer brick or lumber.');
  assert.equal(hostChat[0].authorRole,'ai');
  assert.equal(hostChat[0].negotiation.rootId,hostChat[0].id);
  assert.deepEqual(f.service.observe(f.code,a.token).chat,[]);

  const projected=read(f,b);
  assert.equal(projected.negotiations.length,1);
  assert.deepEqual(projected.negotiations[0].intent,{kind:'interest',wants:['grain','ore'],offers:['brick','lumber'],to:null,replyToId:null});
  for(const forbidden of ['message','playerName','resources','give','get'])assert.equal(JSON.stringify(projected.negotiations).includes(`\"${forbidden}\"`),false);
  assert.equal(read(f,a).negotiations.length,0,'an AI never reads its own negotiation');
  assert.equal(read(f,c).negotiations.length,1,'a broadcast root is available to every other seat');
});

test('root, depth, per-seat, total, cooldown, duplicate, and actor-target gates cannot be bypassed',()=>{
  const f=fixture(),[a,b,c]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool','ore'],offers:['brick','lumber'],to:null,replyToId:null});
  assert.equal(root.success,true,JSON.stringify(root));
  assert.equal(publish(f,a,{kind:'interest',wants:['grain'],offers:['lumber'],to:b.seatId,replyToId:null}).statusCode,429,'only one root may start per turn');

  const b1Intent={kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id};
  const b1=publish(f,b,b1Intent);assert.equal(b1.success,true);
  f.clock.value+=5000;
  assert.equal(publish(f,b,{...b1Intent,wants:['brick'],offers:['wool']}).statusCode,409,'a new request ID cannot repeat an intent');
  const b2=publish(f,b,{kind:'interest',wants:['lumber'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(b2.success,true);
  f.clock.value+=5000;
  assert.equal(publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId}).statusCode,429,'a seat has two messages at most');

  const a2=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:b1.negotiation.id});assert.equal(a2.success,true);
  assert.equal(publish(f,b,{kind:'interest',wants:['brick'],offers:['grain'],to:a.seatId,replyToId:a2.negotiation.id}).statusCode,429,'depth cannot exceed two');
  assert.equal(publish(f,c,{kind:'interest',wants:['brick'],offers:['ore'],to:b.seatId,replyToId:b1.negotiation.id}).statusCode,403,'a third seat cannot hijack a targeted branch');

  const c1=publish(f,c,{kind:'interest',wants:['brick'],offers:['ore'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(c1.success,true);
  assert.equal(publish(f,c,{kind:'interest',wants:['lumber'],offers:['ore'],to:a.seatId,replyToId:root.negotiation.id}).statusCode,429,'cooldown applies across request IDs');
  f.clock.value+=5000;
  const c2=publish(f,c,{kind:'interest',wants:['lumber'],offers:['ore'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(c2.success,true,JSON.stringify(c2));
  assert.equal(f.room().negotiationState.root.messages.length,6);
  assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false,'a full root exposes no further publication opportunity');
  const finalForB=read(f,b,b2.negotiation.sequence);
  assert.deepEqual(finalForB.negotiations.map(item=>item.id),[a2.negotiation.id],'seat and root limits do not hide a final depth-two fact');
  assert.equal(finalForB.negotiations[0].depth,2);assert.equal(finalForB.negotiationSequence,6);
  assert.deepEqual(read(f,b,finalForB.negotiationSequence).negotiations,[],'the final fact is delivered once through the cursor');
});

test('a depth-two fact is delivered once even though a depth-three reply is rejected',()=>{
  const f=fixture(),[a,b]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:null,replyToId:null});
  const bReply=publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(bReply.success,true);
  f.clock.value+=5000;
  const final=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:bReply.negotiation.id});assert.equal(final.success,true);assert.equal(final.negotiation.depth,2);
  const delivered=read(f,b,bReply.negotiation.sequence);
  assert.deepEqual(delivered.negotiations.map(item=>item.id),[final.negotiation.id]);assert.equal(delivered.negotiationSequence,final.negotiation.sequence);
  assert.deepEqual(read(f,b,delivered.negotiationSequence).negotiations,[]);
  assert.equal(publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:final.negotiation.id}).statusCode,429);
});

test('reply opportunity tracks phase, pause, cooldown, per-seat budget, and decline terminality',()=>{
  const f=fixture(),[a,b]=f.bots;
  assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false,'a reply requires a fresh root');
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:null,replyToId:null});assert.equal(root.success,true);
  const room=f.room();
  assert.equal(f.service.observe(f.code,a.token).negotiation.canReply,false,'the publisher remains in cooldown');
  assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,true);
  room.game.freeRoads=1;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false);room.game.freeRoads=0;
  room.paused=true;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false);room.paused=false;
  room.slots[1].chatEnabled=false;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false);room.slots[1].chatEnabled=true;
  room.slots[1].aiPaused=true;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false);room.slots[1].aiPaused=false;
  const reply=publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(reply.success,true);
  assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false,'publication starts cooldown');
  f.clock.value+=5000;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,true);
  const decline=publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId});assert.equal(decline.success,true);
  f.clock.value+=5000;assert.equal(f.service.observe(f.code,b.token).negotiation.canReply,false,'declining remains terminal after cooldown');
});

test('decline is seat-terminal, never wakes another AI, and advances irrelevant read cursors',()=>{
  const f=fixture(),[a,b,c]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['ore'],offers:['brick'],to:b.seatId,replyToId:null});
  const decline=publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId});
  assert.equal(decline.success,true);
  const aRead=read(f,a);
  assert.deepEqual(aRead.negotiations,[]);
  assert.equal(aRead.negotiationSequence,2);
  assert.deepEqual(read(f,c).negotiations,[],'targeted messages for other seats are skipped');
  f.clock.value+=5000;
  assert.equal(publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id}).statusCode,409);
});

test('a decline symmetrically closes AI trade and typed negotiation with that counterpart for the turn',()=>{
  const f=fixture(),[a,b]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:null});assert.equal(root.success,true);
  const answer=publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id});assert.equal(answer.success,true);
  f.clock.value+=5000;
  const decline=publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId});assert.equal(decline.success,true);
  assert.deepEqual(f.service.observe(f.code,a.token).negotiation.blockedTradeSeatIds,[b.seatId]);
  assert.deepEqual(f.service.observe(f.code,b.token).negotiation.blockedTradeSeatIds,[a.seatId]);
  const unread=read(f,a);assert.deepEqual(unread.negotiations,[],'pre-decline counterpart messages are no longer redelivered');assert.equal(unread.negotiationSequence,3);

  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{brick:1},get:{wool:1}}).statusCode,409);
  assert.equal(act(f,b,'tradeOffer',{to:a.seatId,give:{wool:1},get:{brick:1}}).statusCode,409);
  assert.equal(f.room().trade,null,'rejected closed-counterpart trades do not leave a candidate offer');
  assert.equal(publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:answer.negotiation.id}).statusCode,409);
  f.room().trade={id:'closed-announcement',from:a.seatId,to:b.seatId,give:{brick:1},get:{wool:1},status:'offered',counterOf:null};
  assert.equal(publish(f,a,{kind:'offer',tradeId:'closed-announcement',replyToId:answer.negotiation.id}).statusCode,409);
});

test('closed counterpart IDs survive root TTL and restart, then reset on the next global turn',()=>{
  const f=fixture(),[a,b,c]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:null});
  assert.equal(publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId}).success,true);
  f.clock.value+=600001;
  let restarted=new RoomService({store:f.store,now:()=>f.clock.value});
  assert.deepEqual(restarted.observe(f.code,a.token).negotiation.blockedTradeSeatIds,[b.seatId]);
  assert.deepEqual(restarted.observe(f.code,b.token).negotiation.blockedTradeSeatIds,[a.seatId]);
  assert.deepEqual(restarted.observe(f.code,c.token).negotiation.blockedTradeSeatIds,[]);
  const room=restarted.rooms.get(f.code);room.paused=false;room.interrupted=false;room.game.currentPlayerIndex=1;syncNegotiationTurn(room);
  assert.deepEqual(restarted.observe(f.code,a.token).negotiation.blockedTradeSeatIds,[]);
  assert.deepEqual(restarted.observe(f.code,b.token).negotiation.blockedTradeSeatIds,[]);
});

test('counterpart closure leaves terminal trade actions and human-originated offers available',()=>{
  const f=fixture(),[a,b]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:b.seatId,replyToId:null});
  assert.equal(publish(f,b,{kind:'decline',replyToId:root.negotiation.id,to:a.seatId}).success,true);
  f.room().trade={id:'closed-accept',from:b.seatId,to:a.seatId,give:{wool:1},get:{brick:1},status:'offered',counterOf:null};
  assert.equal(act(f,a,'tradeAccept',{tradeId:'closed-accept'}).success,true);assert.equal(act(f,b,'tradeConfirm',{tradeId:'closed-accept'}).success,true);
  f.room().trade={id:'closed-cancel',from:a.seatId,to:b.seatId,give:{brick:1},get:{wool:1},status:'offered',counterOf:null};
  assert.equal(act(f,a,'tradeCancel',{tradeId:'closed-cancel'}).success,true);
  f.room().trade={id:'closed-reject',from:b.seatId,to:a.seatId,give:{wool:1},get:{brick:1},status:'offered',counterOf:null};
  assert.equal(act(f,a,'tradeReject',{tradeId:'closed-reject'}).success,true);

  const humanFixture=fixture({roles:['ai','human','human']}),[ai,human]=humanFixture.bots,room=humanFixture.room();
  const humanRoot=prepareNegotiation(room,ai.seatId,{kind:'interest',wants:['wool'],offers:['brick'],to:human.seatId,replyToId:null},{id:'human-root',now:humanFixture.clock.value});
  assert.equal(humanRoot.success,true);room.negotiationState=humanRoot.state;
  const humanDecline=prepareNegotiation(room,human.seatId,{kind:'decline',replyToId:'human-root',to:ai.seatId},{id:'human-decline',now:humanFixture.clock.value});
  assert.equal(humanDecline.success,true);room.negotiationState=humanDecline.state;
  assert.deepEqual(humanFixture.service.observe(humanFixture.code,human.token).negotiation,null);
  assert.equal(act(humanFixture,human,'tradeOffer',{to:ai.seatId,give:{wool:1},get:{brick:1}}).success,true,'human offers bypass the AI counterpart closure');
});

test('interest replies must complement the parent resources instead of changing or reversing the topic',()=>{
  const f=fixture(),[a,b]=f.bots;
  f.room().game.players.find(player=>player.id===a.seatId).resources.wool=1;
  const root=publish(f,a,{kind:'interest',wants:['grain'],offers:['wool'],to:null,replyToId:null});assert.equal(root.success,true);
  assert.equal(publish(f,b,{kind:'interest',wants:['brick'],offers:['grain'],to:a.seatId,replyToId:root.negotiation.id}).statusCode,409,'an unrelated wanted resource is rejected');
  assert.equal(publish(f,b,{kind:'interest',wants:['grain'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id}).statusCode,409,'the parent perspective cannot be echoed as a reply');
  const relevant=publish(f,b,{kind:'interest',wants:['wool'],offers:['grain'],to:a.seatId,replyToId:root.negotiation.id});
  assert.equal(relevant.success,true);assert.deepEqual(relevant.negotiation.intent.wants,['wool']);assert.deepEqual(relevant.negotiation.intent.offers,['grain']);
});

test('interest replies to offer announcements derive compatibility from the exact current trade',()=>{
  const f=fixture(),[a,b]=f.bots;
  f.room().trade={id:'trade-interest-parent',from:a.seatId,to:b.seatId,give:{brick:1},get:{wool:1},status:'offered',counterOf:null};
  const root=publish(f,a,{kind:'offer',tradeId:'trade-interest-parent',replyToId:null});assert.equal(root.success,true);
  const reply={kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id};
  f.room().trade.status='accepted';assert.equal(publish(f,b,reply).statusCode,409,'a stale offer parent cannot support an interest reply');
  f.room().trade.status='offered';assert.equal(publish(f,b,reply).success,true);
});

test('offer announcements use only a current real trade owned by the sender',()=>{
  const f=fixture(),[a,b]=f.bots,room=f.room();
  room.trade={id:'trade-one',from:a.seatId,to:b.seatId,give:{brick:2},get:{ore:1},status:'offered',counterOf:null};
  const sent=publish(f,a,{kind:'offer',tradeId:'trade-one',replyToId:null});
  assert.equal(sent.success,true,JSON.stringify(sent));
  assert.equal(f.service.observe(f.code,f.host.token).chat[0].message,'Bot 1 offers 2 brick to Bot 2 for 1 ore.');
  const incoming=read(f,b).negotiations[0];
  assert.deepEqual(incoming.intent,{kind:'offer',tradeId:'trade-one',replyToId:null});
  assert.equal(JSON.stringify(incoming).includes('brick'),false);
  f.room().trade.status='accepted';const stale=read(f,b);assert.deepEqual(stale.negotiations,[]);assert.equal(stale.negotiationSequence,1);
  assert.equal(publish(f,b,{kind:'offer',tradeId:'trade-one',replyToId:sent.negotiation.id}).statusCode,409,'another seat cannot announce the offer');
});

test('an unresolved trade blocks interest roots and counteroffer replies retain exact context',()=>{
  const f=fixture(),[a,b]=f.bots,room=f.room();
  room.trade={id:'trade-one',from:a.seatId,to:b.seatId,give:{brick:1},get:{wool:1},status:'offered',counterOf:null};
  assert.equal(publish(f,a,{kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null}).statusCode,409);
  const root=publish(f,a,{kind:'offer',tradeId:'trade-one',replyToId:null});assert.equal(root.success,true);
  f.room().trade={id:'trade-two',from:b.seatId,to:a.seatId,give:{wool:1},get:{brick:1},status:'offered',counterOf:'trade-one'};
  const counter=publish(f,b,{kind:'offer',tradeId:'trade-two',replyToId:root.negotiation.id});assert.equal(counter.success,true,JSON.stringify(counter));
  assert.deepEqual(read(f,a).negotiations.map(item=>item.intent),[{kind:'offer',tradeId:'trade-two',replyToId:root.negotiation.id}]);
});

test('turn and time expiry survive restart while the consumed root allowance stays closed',()=>{
  const f=fixture(),[a,b]=f.bots;
  publish(f,a,{kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null});
  f.clock.value+=600001;
  f.store.save(f.room());
  let restarted=new RoomService({store:f.store,now:()=>f.clock.value});
  restarted.rooms.get(f.code).paused=false;restarted.rooms.get(f.code).interrupted=false;
  assert.equal(restarted.observe(f.code,a.token).negotiation.canInitiate,false,'expiry does not reopen the same turn');
  const expired=restarted.aiChatRead(f.code,b.token,{controlEpoch:b.controlEpoch,runId:b.runId,afterSequence:0,afterNegotiationSequence:0});
  assert.deepEqual(expired.negotiations,[]);assert.equal(expired.negotiationSequence,1);

  const room=restarted.rooms.get(f.code);room.game.currentPlayerIndex=1;syncNegotiationTurn(room);f.store.save(room);
  restarted=new RoomService({store:f.store,now:()=>f.clock.value});
  restarted.rooms.get(f.code).paused=false;restarted.rooms.get(f.code).interrupted=false;
  const view=restarted.observe(f.code,b.token);
  assert.equal(view.negotiation.canInitiate,true);assert.notEqual(view.negotiation.turnKey,f.service.observe(f.code,a.token).negotiation.turnKey);
});

test('seat cooldown persists across a turn boundary',()=>{
  const f=fixture(),[a,b]=f.bots;
  const root=publish(f,a,{kind:'interest',wants:['wool'],offers:['brick'],to:null,replyToId:null});
  assert.equal(publish(f,b,{kind:'interest',wants:['brick'],offers:['wool'],to:a.seatId,replyToId:root.negotiation.id}).success,true);
  f.room().game.currentPlayerIndex=1;syncNegotiationTurn(f.room());
  const nextRoot={kind:'interest',wants:['brick'],offers:['grain'],to:null,replyToId:null};
  assert.equal(f.service.observe(f.code,b.token).negotiation.canInitiate,false);
  assert.equal(publish(f,b,nextRoot).statusCode,429);
  f.clock.value+=5000;assert.equal(f.service.observe(f.code,b.token).negotiation.canInitiate,true);assert.equal(publish(f,b,nextRoot).success,true);
});

test('cycling back to an active seat cannot revive its prior root',()=>{
  const f=fixture(),[a]=f.bots;
  const first=publish(f,a,{kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null});assert.equal(first.success,true);
  for(const index of [1,2,0]){f.room().game.currentPlayerIndex=index;syncNegotiationTurn(f.room());}
  assert.equal(f.room().negotiationState.turnNumber,3);assert.equal(f.room().negotiationState.root,null);assert.equal(f.room().negotiationState.rootStarted,false);
  f.clock.value+=5000;
  const second=publish(f,a,{kind:'interest',wants:['grain'],offers:['lumber'],to:null,replyToId:null});
  assert.equal(second.success,true);assert.notEqual(second.negotiation.turnKey,first.negotiation.turnKey);assert.notEqual(second.negotiation.rootId,first.negotiation.rootId);
});

test('AI real-offer and counter loops stop after two publications per seat while terminal actions remain available',()=>{
  const f=fixture(),[a,b,c]=f.bots;
  let result=act(f,a,'tradeOffer',{to:b.seatId,give:{brick:1},get:{wool:1}});assert.equal(result.success,true);
  result=act(f,b,'tradeCounter',{tradeId:f.room().trade.id,to:a.seatId,give:{wool:1},get:{lumber:1}});assert.equal(result.success,true);
  result=act(f,a,'tradeCounter',{tradeId:f.room().trade.id,to:b.seatId,give:{lumber:1},get:{grain:1}});assert.equal(result.success,true);
  result=act(f,b,'tradeCounter',{tradeId:f.room().trade.id,to:a.seatId,give:{grain:1},get:{brick:1}});assert.equal(result.success,true);
  assert.equal(f.service.observe(f.code,a.token).negotiation.tradeOffersRemaining,0);
  assert.equal(f.service.observe(f.code,b.token).negotiation.tradeOffersRemaining,0);
  assert.equal(act(f,b,'tradeCancel',{tradeId:f.room().trade.id}).success,true,'a budget-exhausted offerer may cancel');

  assert.equal(act(f,c,'tradeOffer',{to:a.seatId,give:{ore:1},get:{brick:1}}).success,true);
  assert.equal(act(f,a,'tradeAccept',{tradeId:f.room().trade.id}).success,true,'a budget-exhausted recipient may accept');
  assert.equal(act(f,c,'tradeConfirm',{tradeId:f.room().trade.id}).success,true,'confirmation stays available');
  assert.equal(act(f,c,'tradeOffer',{to:a.seatId,give:{grain:1},get:{lumber:1}}).success,true);
  assert.equal(act(f,a,'tradeReject',{tradeId:f.room().trade.id}).success,true,'rejection stays available');
  const before=structuredClone(f.room());
  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{brick:2},get:{grain:1}}).statusCode,429);
  assert.deepEqual(f.room(),before,'the rejected third publication is atomic');
});

test('AI trade-term dedupe ignores request and generated trade IDs and preserves receipts',()=>{
  const f=fixture(),[a,b]=f.bots,view=f.service.observe(f.code,a.token);
  const payload={requestId:'first-real-offer',revision:view.revision,generation:view.generation,controlEpoch:view.controlEpoch,runId:a.runId,
    type:'tradeOffer',payload:{to:b.seatId,give:{brick:1},get:{wool:1}}};
  const first=f.service.command(f.code,a.token,payload);assert.equal(first.success,true);
  assert.deepEqual(f.service.command(f.code,a.token,payload),first,'accepted action receipt remains idempotent');
  assert.equal(act(f,b,'tradeReject',{tradeId:f.room().trade.id}).success,true);
  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{brick:1},get:{wool:1}},'same-terms-new-request').statusCode,409);
  assert.equal(f.room().trade,null);assert.equal(f.service.observe(f.code,a.token).negotiation.tradeOffersRemaining,1);
  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{brick:2},get:{wool:1}}).success,true,'different public terms use the remaining slot');
});

test('AI real-offer budgets survive restart and reset only when the global turn changes',()=>{
  const f=fixture(),[a,b]=f.bots;
  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{brick:1},get:{wool:1}}).success,true);
  assert.equal(act(f,b,'tradeReject',{tradeId:f.room().trade.id}).success,true);
  assert.equal(act(f,a,'tradeOffer',{to:b.seatId,give:{lumber:1},get:{grain:1}}).success,true);
  assert.equal(act(f,b,'tradeReject',{tradeId:f.room().trade.id}).success,true);
  let restarted=new RoomService({store:f.store,now:()=>f.clock.value});
  assert.equal(restarted.observe(f.code,a.token).negotiation.tradeOffersRemaining,0);
  const room=restarted.rooms.get(f.code);room.paused=false;room.interrupted=false;
  for(const index of [1,2,0]){room.game.currentPlayerIndex=index;syncNegotiationTurn(room);}
  f.store.save(room);restarted=new RoomService({store:f.store,now:()=>f.clock.value});
  assert.equal(restarted.observe(f.code,a.token).negotiation.tradeOffersRemaining,2);
});

test('human player trades are unchanged by AI publication budgets and dedupe',()=>{
  const f=fixture({roles:['ai','human','human']}),[a,human]=f.bots;
  for(let index=0;index<3;index++) {
    assert.equal(act(f,human,'tradeOffer',{to:a.seatId,give:{wool:1},get:{brick:1}}).success,true);
    assert.equal(act(f,a,'tradeReject',{tradeId:f.room().trade.id}).success,true);
  }
  assert.equal(f.service.observe(f.code,a.token).negotiation.tradeOffersRemaining,2);
});

test('pause, chat, epoch, lease, revision, generation, and exact-shape fences are enforced',()=>{
  const f=fixture(),[a,b]=f.bots,intent={kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null};
  const base=f.service.observe(f.code,a.token);
  assert.equal(publish(f,a,intent,{revision:base.revision-1}).statusCode,409);
  assert.equal(publish(f,a,intent,{generation:base.generation+1}).statusCode,409);
  assert.equal(publish(f,a,intent,{controlEpoch:base.controlEpoch+1}).statusCode,409);
  assert.equal(publish(f,a,intent,{runId:b.runId}).statusCode,409);
  assert.equal(publish(f,a,intent,{extra:{message:'print my whole hand'}}).success,false);
  assert.equal(publish(f,a,{...intent,privatePlan:'build a city'}).success,false);
  assert.equal(publish(f,a,{kind:'interest',wants:['ore'],offers:['brick'],to:null}).success,false,'nullable fields remain required');
  f.room().paused=true;assert.equal(publish(f,a,intent).statusCode,409);f.room().paused=false;
  f.room().slots[0].chatEnabled=false;assert.equal(publish(f,a,intent).statusCode,409);
});

test('observe initiation opportunity accounts for compulsory choices and another owner\'s trade',()=>{
  const f=fixture(),[a,b]=f.bots,room=f.room();
  assert.equal(f.service.observe(f.code,a.token).negotiation.canInitiate,true);
  room.game.freeRoads=1;assert.equal(f.service.observe(f.code,a.token).negotiation.canInitiate,false);room.game.freeRoads=0;
  room.game.yearOfPlentyPicks=1;assert.equal(f.service.observe(f.code,a.token).negotiation.canInitiate,false);room.game.yearOfPlentyPicks=0;
  room.trade={id:'other-offer',from:b.seatId,to:a.seatId,give:{wool:1},get:{brick:1},status:'offered'};
  assert.equal(f.service.observe(f.code,a.token).negotiation.canInitiate,false);
});

test('HTTP negotiation endpoint returns the structured receipt',async()=>{
  const f=fixture(),[a]=f.bots,server=createAppServer({service:f.service,hostKey:'test-host-key-1234'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const view=f.service.observe(f.code,a.token);
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/rooms/${f.code}/ai/negotiation`,{
      method:'POST',headers:{authorization:`Bearer ${a.token}`,'content-type':'application/json'},
      body:JSON.stringify({requestId:'http-negotiation',controlEpoch:view.controlEpoch,runId:a.runId,revision:view.revision,generation:view.generation,
        intent:{kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null}})
    });
    assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.success,true);assert.equal(body.negotiation.intent.kind,'interest');assert.equal(Object.hasOwn(body.negotiation,'message'),false);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('receipts are idempotent and recording persistence is atomic on failure',()=>{
  const f=fixture(),[a]=f.bots,intent={kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null};
  const view=f.service.observe(f.code,a.token),payload={requestId:'stable-request',controlEpoch:view.controlEpoch,runId:a.runId,revision:view.revision,generation:view.generation,intent};
  const first=f.service.aiNegotiate(f.code,a.token,payload);assert.equal(first.success,true);
  const event=f.service.eventsFor(f.room().recordingId).at(-1);
  assert.equal(event.type,'aiNegotiation');assert.equal(event.summary,'Bot 1 is looking for ore and can offer brick.');assert.equal(event.payload,undefined);
  assert.deepEqual(f.service.aiNegotiate(f.code,a.token,payload),first);
  assert.equal(f.service.aiNegotiate(f.code,a.token,{...payload,intent:{...intent,wants:['grain']}}).statusCode,409);

  const other=fixture(),before=structuredClone(other.room()),beforeRecording=structuredClone(other.service.recordingFor(other.room().recordingId));other.store.fail=true;
  const failed=publish(other,other.bots[0],intent);
  assert.equal(failed.statusCode,500);assert.deepEqual(other.room(),before);assert.deepEqual(other.service.recordingFor(other.room().recordingId),beforeRecording);
});


test('accepted negotiation receipts remain retryable after terminal host actions',()=>{
  for(const action of ['endGame','closeRoom']) {
    const f=fixture(),[a]=f.bots,view=f.service.observe(f.code,a.token);
    const payload={requestId:'lost-negotiation-response',controlEpoch:view.controlEpoch,runId:a.runId,revision:view.revision,generation:view.generation,
      intent:{kind:'interest',wants:['ore'],offers:['brick'],to:null,replyToId:null}};
    const accepted=f.service.aiNegotiate(f.code,a.token,payload);assert.equal(accepted.success,true);
    assert.equal(act(f,f.host,action).success,true);
    const before=structuredClone(f.room());
    assert.deepEqual(f.service.aiNegotiate(f.code,a.token,payload),accepted);
    assert.equal(f.service.aiNegotiate(f.code,a.token,{...payload,requestId:'new-after-end'}).statusCode,410);
    assert.equal(f.service.aiNegotiate(f.code,a.token,{...payload,intent:{...payload.intent,wants:['grain']}}).statusCode,409);
    assert.deepEqual(f.room(),before);
  }
});
