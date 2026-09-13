import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {RoomStore} from './store.js';
import {baseGameOptions,validateGameOptions} from './gameOptions.js';
import {decisionSchemaFor,modelObservation} from '../bridge/connectors/codex.js';
import {projectPublicState} from '../bridge/chat-policy.js';

const extended={version:1,extension56:true,expansions:[],scenario:'base'};
let sequence=0;
function issue(service,host,actor,type,payload={},extra={}) {
  const view=service.observe(host.code,actor.token);
  return service.command(host.code,actor.token,{requestId:`extension-${++sequence}`,revision:view.revision,
    generation:view.generation,...(actor.role==='ai'?{controlEpoch:view.controlEpoch}:{}),type,payload,...extra});
}
function room(seats=5,store) {
  const service=new RoomService({store});
  const host=service.create({name:'Extension test',seatCount:seats,gameOptions:extended});
  assert.equal(host.success,true);
  return {service,host};
}
function occupy(service,host) {
  return service.observe(host.code,host.token).slots.map((slot,index)=>{
    const actor=service.join(host.code,{name:`Player ${index+1}`,role:slot.kind,seatId:slot.id,...(slot.kind==='ai'?{provider:'codex'}:{})});
    assert.equal(actor.success,true);assert.equal(issue(service,host,actor,'ready').success,true);return actor;
  });
}

test('base is the default and invalid or unsupported options reject before creating rooms',()=>{
  const service=new RoomService();
  const host=service.create({name:'Base',seatCount:4});
  assert.deepEqual(service.observe(host.code,host.token).gameOptions,baseGameOptions());
  for(const config of [null,[],{extension56:'true'},{extension56:1},{version:2},{expansions:['seafarers']},{scenario:'unknown'},{arbitrary:true}]) {
    assert.equal(service.create({name:'Invalid',seatCount:5,gameOptions:config}).success,false);
  }
  for(const seats of [0,2,5,6,7,'4'])assert.equal(service.create({name:'Invalid',seatCount:seats}).success,false);
  assert.equal(validateGameOptions(extended,4).success,false);
  assert.equal(service.rooms.size,1);
});

test('host changes are atomic, reset readiness, preserve retained seats, and isolate lobbies',()=>{
  const service=new RoomService(),host=service.create({name:'Base',seatCount:4});
  const other=service.create({name:'Other',seatCount:4});
  const first=service.observe(host.code,host.token).slots[0];
  const player=service.join(host.code,{name:'Human',role:'human',seatId:first.id});
  issue(service,host,player,'ready');
  const before=structuredClone(service.rooms.get(host.code));
  assert.equal(issue(service,host,player,'configureGame',{seatCount:6,gameOptions:extended}).statusCode,403);
  assert.deepEqual(service.rooms.get(host.code),before);
  assert.equal(issue(service,host,host,'configureGame',{seatCount:6,gameOptions:extended}).success,true);
  const view=service.observe(host.code,player.token);
  assert.equal(view.slots.length,6);assert.equal(view.slots[0].id,first.id);assert.equal(view.slots[0].ready,false);
  assert.equal(view.generation,player.generation);
  assert.deepEqual(service.observe(other.code,other.token).gameOptions,baseGameOptions());
  const tail=service.join(host.code,{name:'Last',role:'human',seatId:view.slots[5].id});
  const occupied=structuredClone(service.rooms.get(host.code));
  assert.equal(issue(service,host,host,'configureGame',{seatCount:4,gameOptions:baseGameOptions()}).statusCode,409);
  assert.deepEqual(service.rooms.get(host.code),occupied);
  assert.equal(issue(service,host,tail,'leave').success,true);
  assert.equal(issue(service,host,host,'configureGame',{seatCount:4,gameOptions:baseGameOptions()}).success,true);
  assert.equal(service.observe(host.code,player.token).slots.length,4);
});

test('configuration retries do not clear newly readied seats twice or create duplicate slots',()=>{
  const service=new RoomService(),host=service.create({name:'Retry',seatCount:4});
  const command={requestId:'same-config',revision:0,type:'configureGame',payload:{seatCount:6,gameOptions:extended}};
  const first=service.command(host.code,host.token,command);assert.equal(first.success,true);
  const ids=service.observe(host.code,host.token).slots.map(slot=>slot.id);
  const player=service.join(host.code,{name:'Human',role:'human',seatId:ids[0]});
  issue(service,host,player,'ready');
  assert.deepEqual(service.command(host.code,host.token,command),first);
  const view=service.observe(host.code,host.token);assert.deepEqual(view.slots.map(slot=>slot.id),ids);assert.equal(view.slots[0].ready,true);
});

for(const count of [5,6])test(`${count}-seat start persists selected rules in observations and replay, then locks settings`,()=>{
  const store=new RoomStore(':memory:');
  try {
    const {service,host}=room(count,store),actors=occupy(service,host);
    assert.equal(issue(service,host,host,'start').success,true);
    const view=service.observe(host.code,actors[0].token);
    assert.equal(view.gameState.players.length,count);assert.equal(Object.keys(view.gameState.hexes).length,30);
    assert.deepEqual(view.gameState.gameOptions,extended);
    const before=structuredClone(service.rooms.get(host.code));
    assert.equal(issue(service,host,host,'configureGame',{seatCount:4,gameOptions:baseGameOptions()}).success,false);
    assert.deepEqual(service.rooms.get(host.code),before);
    const replay=service.replay(host.replayId);assert.equal(replay.success,true);
    assert.deepEqual(replay.state.gameOptions,extended);
    assert.equal(store.getRecording(host.replayId).rulesVersion,'catan-base-56-2025-v1');
    const recovered=new RoomService({store});
    const after=recovered.observe(host.code,actors[0].token);
    assert.deepEqual(after.gameOptions,extended);assert.equal(after.paused,true);
    assert.deepEqual(after.gameState,view.gameState);
  } finally {store.close();}
});

test('paired phase blocks player trades and AI negotiations but offers the required action',()=>{
  const {service,host}=room();
  const first=service.observe(host.code,host.token).slots[0];
  assert.equal(issue(service,host,host,'configureSeat',{seatId:first.id,kind:'ai',provider:'codex'}).success,true);
  const actors=occupy(service,host);issue(service,host,host,'start');
  const raw=service.rooms.get(host.code),ai=actors.find(actor=>actor.role==='ai');
  raw.game.phase='playing';raw.game.turnPhase='main';raw.game.turnRole='paired';
  raw.game.currentPlayerIndex=raw.game.players.findIndex(player=>player.id===ai.seatId);
  raw.game.productionPlayerIndex=(raw.game.currentPlayerIndex+2)%5;
  const own=raw.game.players[raw.game.currentPlayerIndex];own.resources.brick=4;raw.game.bank.brick-=4;
  const view=service.observe(host.code,ai.token);
  assert.equal(view.gameState.playerTradingAllowed,false);
  assert.equal(view.decision.type,'chooseAction');assert.equal(view.negotiation.canInitiate,false);
  assert.equal(view.negotiation.canReply,false);
  assert.deepEqual(decisionSchemaFor(view).properties.trade,{type:'null'});
  assert.deepEqual(decisionSchemaFor(view).properties.negotiation,{type:'null'});
  assert.equal(projectPublicState(view).playerTradingAllowed,false);
  assert.deepEqual(modelObservation(view).gameOptions,extended);
  assert.equal(issue(service,host,ai,'tradeOffer',{to:actors.find(a=>a.seatId!==ai.seatId).seatId,give:{brick:1},get:{ore:1}}).success,false);
  assert.equal(issue(service,host,ai,'bankTrade',{giveResource:'brick',giveAmount:4,getResource:'ore'}).success,true);
});
