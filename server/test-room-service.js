import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {PROVIDERS} from './providers.js';

let requestNumber=0;
const nextRequest=()=>`room-test-${++requestNumber}`;

class MemoryStore {
  constructor(saved=[]) {this.saved=structuredClone(saved);}
  load(){return structuredClone(this.saved);}
  save(room){
    const index=this.saved.findIndex(saved=>saved.code===room.code);
    if(index===-1)this.saved.push(structuredClone(room));
    else this.saved[index]=structuredClone(room);
  }
}

function issue(service,code,actor,type,payload={},overrides={}) {
  const room=service.rooms.get(code);
  const slot=actor.role==='ai'?room.slots.find(candidate=>candidate.id===actor.seatId):null;
  return service.command(code,actor.token,{
    requestId:overrides.requestId||nextRequest(),
    revision:overrides.revision??room.revision,
    generation:overrides.generation??actor.generation,
    ...(slot?{controlEpoch:overrides.controlEpoch??slot.controlEpoch,...(actor.runId?{runId:actor.runId}:{})}:{}),
    type,payload
  });
}

function makeLobby(service,{name='Host',seats}={}) {
  const created=service.create({name,seatCount:3,seats});
  assert.equal(created.success,true);
  return {code:created.code,host:{token:created.token}};
}

function fillHumanLobby(service,lobby) {
  const slots=service.rooms.get(lobby.code).slots;
  const players=slots.map((slot,index)=>service.join(lobby.code,{name:`Human ${index+1}`,role:'human',seatId:slot.id}));
  players.forEach(player=>assert.equal(player.success,true));
  players.forEach(player=>assert.equal(issue(service,lobby.code,player,'ready').success,true));
  return players;
}

function startRoom(service,lobby) {
  const result=issue(service,lobby.code,lobby.host,'start');
  assert.equal(result.success,true);
  return result;
}

function setMainTurn(service,code) {
  const room=service.rooms.get(code);
  room.game.phase='playing';room.game.turnPhase='main';room.game.currentPlayerIndex=0;room.paused=false;
  for(const player of room.game.players)for(const resource of ['brick','lumber','wool','grain','ore'])player.resources[resource]=0;
  return room;
}

test('credentials stay private, own exactly one seat, and enforce generation',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service);
  const slot=service.rooms.get(lobby.code).slots[0];
  const joined=service.join(lobby.code,{name:'Alice',role:'human',seatId:slot.id});
  assert.equal(joined.success,true);
  const room=service.rooms.get(lobby.code);

  assert.equal(JSON.stringify(room).includes(joined.token),false);
  assert.equal(service.observe(lobby.code,slot.id).statusCode,401);
  const hostView=service.observe(lobby.code,lobby.host.token);
  assert.equal(hostView.success,true);
  assert.equal(Object.hasOwn(hostView.slots[0],'controller'),false);

  const before=structuredClone(room);
  assert.equal(issue(service,lobby.code,joined,'ready',{}, {generation:joined.generation+1}).success,false);
  assert.deepEqual(service.rooms.get(lobby.code),before);
});

test('ready commands are idempotent and stale revisions are atomic',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service);
  const slot=service.rooms.get(lobby.code).slots[0];
  const joined=service.join(lobby.code,{name:'Alice',role:'human',seatId:slot.id});
  const revision=service.rooms.get(lobby.code).revision,requestId=nextRequest();
  const envelope={requestId,revision,generation:joined.generation,type:'ready',payload:{}};
  const first=service.command(lobby.code,joined.token,envelope);
  const expectedFirst=structuredClone(first);
  const afterFirst=structuredClone(service.rooms.get(lobby.code));
  first.revision=999;
  const retry=service.command(lobby.code,joined.token,envelope);
  assert.deepEqual(retry,expectedFirst);
  assert.deepEqual(service.rooms.get(lobby.code),afterFirst);

  assert.equal(service.command(lobby.code,joined.token,{...envelope,type:'leave'}).statusCode,409);
  const stale=service.command(lobby.code,joined.token,{...envelope,requestId:nextRequest(),type:'chat',payload:{message:'late'}});
  assert.equal(stale.statusCode,409);
  assert.deepEqual(service.rooms.get(lobby.code),afterFirst);
});

test('malformed service inputs fail without changing room state',()=>{
  const service=new RoomService();
  assert.equal(service.create(null).success,false);
  const lobby=makeLobby(service);
  assert.equal(service.join(lobby.code,null).success,false);
  const before=structuredClone(service.rooms.get(lobby.code));
  assert.equal(service.command(lobby.code,lobby.host.token,null).success,false);
  const circular={};circular.self=circular;
  assert.equal(service.command(lobby.code,lobby.host.token,{requestId:nextRequest(),revision:before.revision,type:'chat',payload:circular}).success,false);
  assert.deepEqual(service.rooms.get(lobby.code),before);
});

test('start uses the complete ready roster and supports an all-AI room with a spectator host',()=>{
  const service=new RoomService();
  const seats=Array.from({length:3},()=>({kind:'ai',provider:'codex',model:'gpt-test'}));
  const lobby=makeLobby(service,{seats});
  const slots=service.rooms.get(lobby.code).slots;
  const bots=slots.map((slot,index)=>service.join(lobby.code,{name:`Bot ${index+1}`,role:'ai',seatId:slot.id,provider:'codex',model:'gpt-test'}));
  bots.forEach(bot=>assert.equal(bot.success,true));
  assert.equal(issue(service,lobby.code,lobby.host,'chat',{message:'Humans only'}).success,true);
  assert.deepEqual(service.observe(lobby.code,bots[0].token).chat,[]);
  bots.forEach(bot=>assert.equal(issue(service,lobby.code,bot,'ready').success,true));
  startRoom(service,lobby);

  const hostView=service.observe(lobby.code,lobby.host.token);
  assert.equal(hostView.host,true);
  assert.equal(hostView.seatId,null);
  assert.deepEqual(new Set(hostView.gameState.players.map(player=>player.id)),new Set(slots.map(slot=>slot.id)));
  assert.ok(hostView.gameState.players.every(player=>typeof player.resources==='number'));
  const bankBrick=service.rooms.get(lobby.code).game.bank.brick;
  hostView.gameState.bank.brick=999;
  assert.equal(service.rooms.get(lobby.code).game.bank.brick,bankBrick);
});

test('unchanged seat observations reuse isolated legal-action results',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);
  startRoom(service,lobby);
  const room=service.rooms.get(lobby.code);
  const current=players.find(player=>player.seatId===room.game.players[room.game.currentPlayerIndex].id);
  const first=service.observe(lobby.code,current.token);
  assert.equal(first.success,true);
  assert.ok(first.gameState.players.filter(player=>player.id!==current.seatId).every(player=>typeof player.resources==='number'));
  assert.equal(service.legalCache.get(lobby.code).size,1);
  first.legalActions.push({type:'forged',payload:{}});
  const second=service.observe(lobby.code,current.token);
  assert.equal(second.legalActions.some(action=>action.type==='forged'),false);
  assert.equal(service.legalCache.get(lobby.code).size,1);
});

test('provider definitions are injected and controller removal supports human/AI swaps',()=>{
  const providers={...PROVIDERS,mock:{id:'mock',name:'Mock',remote:true,modelSelection:true,models:['m1']}};
  const service=new RoomService({providers});
  const lobby=makeLobby(service);
  const players=fillHumanLobby(service,lobby);
  startRoom(service,lobby);
  const seatId=players[0].seatId,oldGeneration=players[0].generation;

  assert.equal(issue(service,lobby.code,lobby.host,'removeController',{seatId,kind:'ai',provider:'mock',model:'m1'}).success,true);
  assert.equal(service.observe(lobby.code,players[0].token).statusCode,401);
  const beforeWrongProvider=structuredClone(service.rooms.get(lobby.code));
  assert.equal(service.join(lobby.code,{name:'Wrong Bot',role:'ai',seatId,provider:'codex',model:'m1'}).success,false);
  assert.deepEqual(service.rooms.get(lobby.code),beforeWrongProvider);

  const bot=service.join(lobby.code,{name:'Replacement Bot',role:'ai',seatId,provider:'mock',model:'m1'});
  assert.equal(bot.success,true);
  assert.ok(bot.generation>oldGeneration);
  assert.equal(issue(service,lobby.code,bot,'endTurn',{}, {generation:oldGeneration}).statusCode,409);

  assert.equal(issue(service,lobby.code,lobby.host,'removeController',{seatId,kind:'human'}).success,true);
  assert.equal(service.observe(lobby.code,bot.token).statusCode,401);
  const human=service.join(lobby.code,{name:'Replacement Human',role:'human',seatId});
  assert.equal(human.success,true);
  const slot=service.rooms.get(lobby.code).slots.find(candidate=>candidate.id===seatId);
  assert.equal(slot.kind,'human');assert.equal(slot.provider,null);assert.equal(slot.model,null);

  assert.equal(issue(service,lobby.code,human,'leave').success,true);
  assert.equal(service.observe(lobby.code,human.token).statusCode,401);
});

test('one active-game limit permits multiple lobbies and releases after endGame',()=>{
  const service=new RoomService({maxActive:1});
  const first=makeLobby(service,{name:'First'}),second=makeLobby(service,{name:'Second'});
  fillHumanLobby(service,first);fillHumanLobby(service,second);
  startRoom(service,first);
  const before=structuredClone(service.rooms.get(second.code));
  const blocked=issue(service,second.code,second.host,'start');
  assert.equal(blocked.statusCode,409);
  assert.deepEqual(service.rooms.get(second.code),before);
  assert.equal(issue(service,first.code,first.host,'endGame').success,true);
  startRoom(service,second);
});

test('structured trades require target confirmation and settle atomically',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);
  startRoom(service,lobby);
  const room=setMainTurn(service,lobby.code);
  const activeId=room.game.players[0].id;
  const from=players.find(player=>player.seatId===activeId);
  const to=players.find(player=>player.seatId!==activeId);
  const fromPlayer=room.game.players.find(player=>player.id===from.seatId);
  const toPlayer=room.game.players.find(player=>player.id===to.seatId);
  fromPlayer.resources.brick=2;toPlayer.resources.wool=1;

  assert.equal(issue(service,lobby.code,from,'tradeOffer',{to:to.seatId,give:{brick:2},get:{wool:1}}).success,true);
  let trade=service.rooms.get(lobby.code).trade;
  assert.equal(trade.status,'offered');
  assert.equal(issue(service,lobby.code,to,'tradeAccept',{tradeId:trade.id}).success,true);
  trade=service.rooms.get(lobby.code).trade;
  assert.equal(trade.status,'accepted');
  assert.equal(service.rooms.get(lobby.code).game.players.find(player=>player.id===from.seatId).resources.brick,2);
  assert.equal(issue(service,lobby.code,from,'tradeConfirm',{tradeId:trade.id}).success,true);
  assert.equal(fromPlayer.resources.brick,2); // References point at the pre-transaction snapshot.
  const settled=service.rooms.get(lobby.code).game;
  assert.equal(settled.players.find(player=>player.id===from.seatId).resources.brick,0);
  assert.equal(settled.players.find(player=>player.id===from.seatId).resources.wool,1);
  assert.equal(settled.players.find(player=>player.id===to.seatId).resources.brick,2);
  assert.equal(settled.players.find(player=>player.id===to.seatId).resources.wool,0);
  assert.equal(service.rooms.get(lobby.code).trade,null);
});

test('trade counters stay between the original parties and stale settlement is rejected',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);
  startRoom(service,lobby);
  let room=setMainTurn(service,lobby.code);
  const from=players.find(player=>player.seatId===room.game.players[0].id);
  const others=players.filter(player=>player.seatId!==from.seatId),to=others[0],third=others[1];
  room.game.players.find(player=>player.id===from.seatId).resources.brick=3;
  room.game.players.find(player=>player.id===to.seatId).resources.wool=2;

  assert.equal(issue(service,lobby.code,from,'tradeOffer',{to:to.seatId,give:{brick:2},get:{wool:1}}).success,true);
  let trade=service.rooms.get(lobby.code).trade;
  let before=structuredClone(service.rooms.get(lobby.code));
  assert.equal(issue(service,lobby.code,to,'tradeCounter',{tradeId:trade.id,to:third.seatId,give:{wool:2},get:{brick:1}}).success,false);
  assert.deepEqual(service.rooms.get(lobby.code),before);
  assert.equal(issue(service,lobby.code,to,'tradeCounter',{tradeId:trade.id,to:from.seatId,give:{wool:2},get:{brick:1}}).success,true);
  trade=service.rooms.get(lobby.code).trade;
  assert.equal(trade.from,to.seatId);assert.equal(trade.to,from.seatId);assert.ok(trade.counterOf);

  assert.equal(issue(service,lobby.code,from,'tradeAccept',{tradeId:trade.id}).success,true);
  room=service.rooms.get(lobby.code);
  room.game.players.find(player=>player.id===to.seatId).resources.wool=0;
  before=structuredClone(room);
  assert.equal(issue(service,lobby.code,to,'tradeConfirm',{tradeId:trade.id}).success,false);
  assert.deepEqual(service.rooms.get(lobby.code),before);
});

test('legacy engine trade actions and malformed room trades cannot bypass confirmation',()=>{
  const service=new RoomService();
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);
  startRoom(service,lobby);
  const room=setMainTurn(service,lobby.code);
  const active=players.find(player=>player.seatId===room.game.players[0].id);
  const target=players.find(player=>player.seatId!==active.seatId);
  room.game.players[0].resources.brick=2;

  for(const [type,payload] of [
    ['proposeTrade',{offer:{brick:1},request:{wool:1}}],
    ['respondToTrade',{accept:true}],
    ['cancelTrade',{}],
    ['tradeOffer',{to:target.seatId,give:{brick:-1},get:{wool:1}}],
    ['tradeOffer',{to:target.seatId,give:{gold:1},get:{wool:1}}],
    ['tradeOffer',{to:target.seatId,give:{brick:1},get:{brick:1}}]
  ]) {
    const before=structuredClone(service.rooms.get(lobby.code));
    assert.equal(issue(service,lobby.code,active,type,payload).success,false);
    assert.deepEqual(service.rooms.get(lobby.code),before);
  }
  assert.equal(service.rooms.get(lobby.code).game.tradeOffer,null);
});

test('restart pauses active rooms and preserves credentials and receipts',()=>{
  const store=new MemoryStore(),service=new RoomService({store});
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);
  const revision=service.rooms.get(lobby.code).revision,requestId=nextRequest();
  const startCommand={requestId,revision,type:'start',payload:{}};
  const started=service.command(lobby.code,lobby.host.token,startCommand);
  assert.equal(started.success,true);

  const restarted=new RoomService({store});
  const view=restarted.observe(lobby.code,lobby.host.token);
  assert.equal(view.success,true);assert.equal(view.paused,true);
  assert.deepEqual(restarted.command(lobby.code,lobby.host.token,startCommand),started);
  const before=structuredClone(restarted.rooms.get(lobby.code));
  assert.equal(issue(restarted,lobby.code,players[0],'endTurn').statusCode,409);
  assert.deepEqual(restarted.rooms.get(lobby.code),before);
  assert.equal(issue(restarted,lobby.code,lobby.host,'resume').success,true);
});

test('roll receipts preserve exact production, isolate seats, and survive replay and restart',()=>{
  const store=new MemoryStore(),service=new RoomService({store});
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);startRoom(service,lobby);
  const room=setMainTurn(service,lobby.code),game=room.game;
  game.turnPhase='roll';
  const target=Object.values(game.hexes).find(h=>h.resource);
  for(const hex of Object.values(game.hexes))hex.number=5;
  target.number=6;target.resource='grain';game.bank.grain=1;
  game.vertices[`v_${target.q}_${target.r}_0`]={building:'city',owner:0};
  const actor=players.find(p=>p.seatId===game.players[0].id);
  const spectator=service.join(lobby.code,{name:'Watcher',role:'spectator'});
  const revision=service.rooms.get(lobby.code).revision;
  const originalRandom=Math.random;Math.random=()=>0.4;
  try {
    const result=issue(service,lobby.code,actor,'rollDice',{}, {requestId:'receipt-roll',revision});assert.equal(result.success,true);
    const receipt=service.observe(lobby.code,actor.token).rollEvent;
    assert.equal(receipt.roll.total,6);assert.equal(receipt.gains.grain,1,'finite bank gives only one card');
    const resourceEvent=service.observe(lobby.code,actor.token).cardEvents.at(-1);
    assert.equal(resourceEvent.type,'rollDice');assert.equal(resourceEvent.revision,result.revision);assert.equal(resourceEvent.rollId,receipt.id);
    assert.deepEqual(resourceEvent.transfers,[{from:'bank',to:actor.seatId,count:1,resource:'grain'}]);
    const publicTransfer=service.observe(lobby.code,spectator.token).cardEvents.at(-1).transfers[0];
    assert.deepEqual(publicTransfer,{from:'bank',to:actor.seatId,count:1});
    assert.deepEqual(service.observe(lobby.code,spectator.token).rollEvent.gains,{});
    const other=players.find(p=>p.seatId!==actor.seatId);assert.equal(service.observe(lobby.code,other.token).rollEvent.gains.grain,0);
    assert.equal(JSON.stringify(service.observe(lobby.code,other.token)).includes('gainsBySeat'),false);
    assert.deepEqual(issue(service,lobby.code,actor,'rollDice',{}, {requestId:'receipt-roll',revision}),result);
    assert.equal(service.observe(lobby.code,actor.token).cardEvents.length,1,'idempotent replay does not append an event');
    assert.equal(service.observe(lobby.code,actor.token).rollEvent.id,receipt.id);
    const restarted=new RoomService({store});assert.deepEqual(restarted.observe(lobby.code,actor.token).rollEvent,receipt);
    assert.equal(issue(service,lobby.code,actor,'endTurn').success,true);
    const nextGame=service.rooms.get(lobby.code).game,next=players.find(p=>p.seatId===nextGame.players[nextGame.currentPlayerIndex].id);
    assert.equal(issue(service,lobby.code,next,'rollDice').success,true);
    const second=service.observe(lobby.code,actor.token).rollEvent;assert.equal(second.roll.total,6);assert.notEqual(second.id,receipt.id);
    assert.equal(second.gains.grain,0,'the empty bank does not invent a resource animation');
    assert.equal(issue(service,lobby.code,lobby.host,'removeController',{seatId:actor.seatId}).success,true);
    const replacement=service.join(lobby.code,{name:'Replacement',role:'human',seatId:actor.seatId});
    assert.equal(replacement.success,true);
    assert.deepEqual(service.observe(lobby.code,replacement.token).rollEvent.gains,{},'replacement cannot see previous roll history');
  } finally {Math.random=originalRandom;}
});

test('robber choices are opaque, private, persistent, and settle once',()=>{
  const store=new MemoryStore(),service=new RoomService({store});
  const lobby=makeLobby(service),players=fillHumanLobby(service,lobby);startRoom(service,lobby);
  const room=setMainTurn(service,lobby.code),game=room.game;
  game.turnPhase='robber';game.hasRolledThisTurn=true;
  const targetKey=Object.keys(game.hexes).find(key=>key!==game.robber),target=game.hexes[targetKey];
  game.vertices[`v_${target.q}_${target.r}_0`]={building:'settlement',owner:1};
  const thief=players.find(player=>player.seatId===game.players[0].id);
  const victim=players.find(player=>player.seatId===game.players[1].id);
  game.players[1].resources.brick=2;game.players[1].resources.ore=1;
  const spectator=service.join(lobby.code,{name:'Watcher',role:'spectator'});

  assert.equal(issue(service,lobby.code,thief,'moveRobber',{hexKey:targetKey,stealFromPlayerId:victim.seatId}).success,true);
  const thiefView=service.observe(lobby.code,thief.token),victimView=service.observe(lobby.code,victim.token),publicView=service.observe(lobby.code,spectator.token);
  assert.equal(thiefView.robberPick.count,3);assert.equal(thiefView.robberPick.cardIds.length,3);
  assert.equal(new Set(thiefView.robberPick.cardIds).size,3);
  assert.equal(Object.hasOwn(victimView.robberPick,'cardIds'),false);assert.equal(Object.hasOwn(publicView.robberPick,'cardIds'),false);
  assert.equal(JSON.stringify(thiefView.gameState).includes('pendingRobberPick'),false);

  const restarted=new RoomService({store});
  assert.deepEqual(restarted.observe(lobby.code,thief.token).robberPick,thiefView.robberPick,'restart preserves card order and ids');
  assert.equal(issue(restarted,lobby.code,lobby.host,'resume').success,true);
  const ready=restarted.observe(lobby.code,thief.token),cardId=ready.robberPick.cardIds[0];
  const envelope={requestId:'choose-once',revision:ready.revision,generation:thief.generation,type:'chooseRobberCard',payload:{cardId}};
  const chosen=restarted.command(lobby.code,thief.token,envelope);assert.equal(chosen.success,true);
  const after=restarted.observe(lobby.code,thief.token),event=after.cardEvents.at(-1);
  assert.equal(after.robberPick,null);assert.equal(after.gameState.turnPhase,'main');assert.equal(event.type,'chooseRobberCard');
  assert.equal(event.transfers.length,1);assert.equal(event.transfers[0].from,victim.seatId);assert.equal(event.transfers[0].to,thief.seatId);
  assert.ok(['brick','ore'].includes(event.transfers[0].resource));
  assert.equal(Object.hasOwn(restarted.observe(lobby.code,spectator.token).cardEvents.at(-1).transfers[0],'resource'),false);
  const eventCount=after.cardEvents.length;
  assert.deepEqual(restarted.command(lobby.code,thief.token,envelope),chosen);
  assert.equal(restarted.observe(lobby.code,thief.token).cardEvents.length,eventCount,'replay neither redraws nor transfers again');
});

test('ending a game clears mandatory discard and robber choices',()=>{
  for(const phase of ['discard','robberPick']) {
    const service=new RoomService(),lobby=makeLobby(service);
    fillHumanLobby(service,lobby);startRoom(service,lobby);
    const room=setMainTurn(service,lobby.code);
    room.game.turnPhase=phase;
    room.game.discardingPlayers=[{playerIndex:0,cardsToDiscard:4}];
    room.game.pendingRobberPick={id:'pick',thiefId:room.game.players[0].id,victimId:room.game.players[1].id,cards:[{id:'card',resource:'brick'}]};
    assert.equal(issue(service,lobby.code,lobby.host,'endGame').success,true);
    const view=service.observe(lobby.code,lobby.host.token);
    assert.equal(view.gameState.phase,'finished');assert.equal(view.robberPick,null);assert.deepEqual(view.gameState.discardingPlayers,[]);
  }
});
