import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as CK from './citiesKnightsCore.js';
import {RoomService} from './roomService.js';
import {RoomStore} from './store.js';
import {decisionSchemaFor,decodeDecision,modelObservation} from '../bridge/connectors/codex.js';
import {cardTypesFor,combinedHand} from '../shared/cardTypes.js';
import {projectEvent} from './recording.js';

let serial=0;
function issue(service,host,actor,type,payload={}) {
  const view=service.observe(host.code,actor.token);
  return service.command(host.code,actor.token,{requestId:`city-integration-${++serial}`,revision:view.revision,
    generation:view.generation,type,payload});
}
function makeRoom(service,count=3,scenario=null) {
  const gameOptions={version:1,extension56:count>=5,expansions:scenario?['seafarers','cities_knights']:['cities_knights'],scenario:scenario||'base',
    ...(scenario?{setup:{layout:scenario==='new_world'?'variable':'fixed',seed:42}}:{})};
  const host=service.create({name:'Cities integration',seatCount:count,gameOptions});
  assert.equal(host.success,true,host.error);
  const actors=service.observe(host.code,host.token).slots.map((slot,index)=>{
    const actor=service.join(host.code,{name:`Citizen ${index+1}`,role:'human',seatId:slot.id});
    assert.equal(issue(service,host,actor,'ready').success,true);return actor;
  });
  const start=issue(service,host,host,'start');assert.equal(start.success,true,start.error);
  for(let guard=0;guard<150;guard++) {
    const game=service.rooms.get(host.code).game;if(game.phase!=='setup')break;
    const actor=actors.find(candidate=>candidate.seatId===(game.pendingChoice?.actorId||game.players[game.currentPlayerIndex].id));
    const actions=service.observe(host.code,actor.token).legalActions;
    const action=['resolveCitiesKnightsChoice','resolveSeafarersChoice','placePort','placeSettlement','placeShip','placeRoad','advanceSetup']
      .map(type=>actions.find(action=>action.type===type)).find(Boolean);
    assert.ok(action,`Setup stalled: ${scenario||'base'} ${count} ${game.turnPhase}`);
    const result=issue(service,host,actor,action.type,action.payload);assert.equal(result.success,true,result.error);
  }
  assert.equal(service.rooms.get(host.code).game.phase,'playing');
  return {host,actors};
}
function funds(game,player,amounts) {
  const existing=combinedHand(player);assert.equal(CK.transferCards(game,player,'bank',existing).success,true);
  assert.equal(CK.transferCards(game,'bank',player,amounts).success,true);
}
function giveCard(game,player,type) {
  const deck=Object.values(game.citiesKnights.progressDecks).find(deck=>deck.some(card=>card.type===type));
  const index=deck.findIndex(card=>card.type===type),[card]=deck.splice(index,1);player.progressCards.push(card);return card;
}

test('Cities & Knights toggles are host-owned, independent per lobby, and reset readiness',()=>{
  const service=new RoomService(),host=service.create({name:'Configurable',seatCount:4});
  const other=service.create({name:'Ordinary',seatCount:4});
  const slot=service.observe(host.code,host.token).slots[0];
  const player=service.join(host.code,{name:'Citizen',role:'human',seatId:slot.id});
  assert.equal(issue(service,host,player,'ready').success,true);
  const config={seatCount:4,gameOptions:{version:1,extension56:false,expansions:['cities_knights'],scenario:'base'}};
  assert.equal(issue(service,host,player,'configureGame',config).statusCode,403);
  assert.equal(issue(service,host,host,'configureGame',config).success,true);
  let view=service.observe(host.code,host.token);
  assert.deepEqual(view.gameOptions,config.gameOptions);
  assert.equal(view.slots.every(slot=>!slot.ready),true);
  assert.deepEqual(service.observe(other.code,other.token).gameOptions.expansions,[]);
  assert.equal(service.replay(host.replayId).recording.rulesVersion,'catan-cities-knights-2025-v1');
  config.gameOptions={...config.gameOptions,expansions:['cities_knights','seafarers'],scenario:'heading_for_new_shores',setup:{layout:'fixed',seed:42}};
  assert.equal(issue(service,host,host,'configureGame',config).success,true);
  assert.deepEqual(service.observe(host.code,host.token).gameOptions.expansions,['seafarers','cities_knights']);
  assert.equal(issue(service,host,host,'configureGame',{seatCount:4,gameOptions:{version:1,extension56:false,expansions:[],scenario:'base'}}).success,true);
  view=service.observe(host.code,host.token);
  assert.deepEqual(view.gameOptions.expansions,[]);
  assert.equal(view.gameOptions.scenario,'base');
  assert.equal(view.boardPreview,undefined);
});

test('Cities & Knights setup uses cities, correct commodity supply and original lobby defaults',()=>{
  for(const [count,scenario]of [[3,null],[6,null],[3,'heading_for_new_shores'],[6,'cloth_for_catan']]) {
    const service=new RoomService(),{host}=makeRoom(service,count,scenario),game=service.rooms.get(host.code).game;
    assert.deepEqual(Object.values(game.citiesKnights.commodityBank),[count>=5?18:12,count>=5?18:12,count>=5?18:12]);
    for(const [index,player]of game.players.entries()) {
      const pieces=Object.values(game.vertices).filter(vertex=>vertex.owner===index&&vertex.building);
      assert.equal(pieces.filter(vertex=>vertex.building==='city').length,1);
      assert.equal(pieces.filter(vertex=>vertex.building==='settlement').length,scenario==='cloth_for_catan'?2:1);
      assert.equal(Object.values(player.commodities).reduce((sum,count)=>sum+count,0),0);
    }
    assert.equal(game.robber,null);assert.equal(game.pirate??null,null);
    const ordinary=service.create({name:'Ordinary',seatCount:4});
    assert.deepEqual(service.observe(ordinary.code,ordinary.token).gameOptions,{version:1,extension56:false,expansions:[],scenario:'base'});
  }
});

test('deck-dependent combinations are rejected when creating or configuring a lobby',()=>{
  for(const scenario of ['the_forgotten_tribe','the_pirate_islands'])for(const seatCount of [3,6]) {
    const service=new RoomService();
    const gameOptions={version:1,extension56:seatCount>=5,expansions:['seafarers','cities_knights'],scenario,setup:{layout:'fixed',seed:42}};
    const created=service.create({name:'Undefined combined rules',seatCount,gameOptions});
    assert.equal(created.success,false);assert.match(created.error,/development cards/);
    assert.equal(service.rooms.size,0);
    const host=service.create({name:'Seafarers scenario',seatCount,gameOptions:{...gameOptions,expansions:['seafarers']}});
    assert.equal(host.success,true,host.error);
    const before=structuredClone(service.rooms.get(host.code));
    const changed=issue(service,host,host,'configureGame',{seatCount,gameOptions});
    assert.equal(changed.success,false);assert.match(changed.error,/development cards/);
    assert.deepEqual(service.rooms.get(host.code),before);
  }
});

test('eight-card player trades are atomic, private, and recover exactly with replay',()=>{
  const store=new RoomStore(':memory:');
  try {
    const service=new RoomService({store}),{host,actors}=makeRoom(service);
    const game=service.rooms.get(host.code).game;game.turnPhase='main';G.refreshPlayerTradingAllowed(game);
    const [from,to]=game.players,first=actors.find(actor=>actor.seatId===from.id),second=actors.find(actor=>actor.seatId===to.id);
    funds(game,from,{paper:2,lumber:1});funds(game,to,{cloth:1,ore:1});
    const before=structuredClone(service.rooms.get(host.code));
    assert.equal(issue(service,host,first,'tradeOffer',{to:to.id,give:{paper:3},get:{cloth:1}}).success,false);
    assert.deepEqual(service.rooms.get(host.code),before);
    assert.equal(issue(service,host,first,'tradeOffer',{to:to.id,give:{paper:2},get:{cloth:1}}).success,true);
    let view=service.observe(host.code,first.token);
    assert.equal(issue(service,host,second,'tradeAccept',{tradeId:view.trade.id}).success,true);
    assert.equal(issue(service,host,first,'tradeConfirm',{tradeId:view.trade.id}).success,true);
    view=service.observe(host.code,first.token);
    assert.deepEqual(view.gameState.players.find(player=>player.id===from.id).commodities,{paper:0,coin:0,cloth:1});
    const otherSeat=view.gameState.players.find(player=>player.id===to.id);
    assert.equal(Object.hasOwn(otherSeat,'commodities'),false);
    assert.equal(otherSeat.resources,3);
    const recovered=new RoomService({store});
    assert.deepEqual(recovered.observe(host.code,first.token).gameState,view.gameState);
    assert.deepEqual(recovered.replay(host.replayId,{perspective:from.id,token:first.token}).state.gameState,view.gameState);
    assert.equal(recovered.replay(host.replayId).recording.rulesVersion,'catan-cities-knights-2025-v1');
  } finally {store.close();}
});

test('off-turn progress card bundles reach AI decisions and replay without exposing private selections',()=>{
  const service=new RoomService(),{host,actors}=makeRoom(service);
  const game=service.rooms.get(host.code).game;game.turnPhase='main';G.refreshPlayerTradingAllowed(game);
  const [player,target]=game.players,source=actors.find(actor=>actor.seatId===player.id),other=actors.find(actor=>actor.seatId===target.id);
  for(const candidate of game.players)funds(game,candidate,{paper:2,brick:2});
  const card=giveCard(game,player,'sabotage');
  assert.equal(issue(service,host,source,'playProgressCard',{cardId:card.id}).success,true);
  let view=service.observe(host.code,other.token);
  assert.equal(view.decision.type,'chooseCards');assert.equal(view.decision.count,2);
  assert.equal(service.observe(host.code,source.token).decision,null);
  const schema=decisionSchemaFor(view);assert.equal(schema.properties.wait.enum[0],false);
  const cards=Object.fromEntries(cardTypesFor(view.gameState).map(type=>[type,type==='paper'?2:0]));
  const decoded=decodeDecision({contextId:'synthetic',value:{actionIndex:null,discard:null,choiceCards:cards,trade:null,negotiation:null,wait:false,memory:'',publicReply:'silent'}},view);
  assert.equal(decoded.action.type,'resolveCitiesKnightsChoice');
  const rejected=issue(service,host,source,decoded.action.type,decoded.action.payload);assert.equal(rejected.success,false);
  const accepted=issue(service,host,other,decoded.action.type,decoded.action.payload);assert.equal(accepted.success,true,accepted.error);
  const events=service.replayEvents(host.replayId,{perspective:target.id,token:other.token}).events;
  const resolved=events.findLast(event=>event.type==='resolveCitiesKnightsChoice');assert.ok(resolved);
  assert.equal(projectEvent(resolved,{}).payload,undefined);
  const publicView=service.observe(host.code,host.token),model=modelObservation(publicView);
  assert.equal(JSON.stringify(model).includes(card.id),false);
});

test('Commercial Harbor keeps its face-down offer out of public watch and replay payloads',()=>{
  const service=new RoomService(),{host,actors}=makeRoom(service);
  const game=service.rooms.get(host.code).game;game.turnPhase='main';G.refreshPlayerTradingAllowed(game);
  const [player,target]=game.players,source=actors.find(actor=>actor.seatId===player.id),other=actors.find(actor=>actor.seatId===target.id);
  funds(game,player,{grain:2});funds(game,target,{paper:1});
  const card=giveCard(game,player,'commercialHarbor');
  assert.equal(issue(service,host,source,'playProgressCard',{cardId:card.id}).success,true);
  assert.equal(issue(service,host,source,'offerCommercialHarbor',{targetPlayerId:target.id,resource:'grain'}).success,true);
  const watched=service.watch(host.code);
  assert.equal(Object.hasOwn(watched,'replayId'),false);
  assert.deepEqual(watched.gameState,service.observe(host.code,host.token).gameState);
  assert.equal(Object.hasOwn(watched.gameState.pendingChoice,'offeredResource'),false);
  assert.ok(watched.gameState.players.every(candidate=>typeof candidate.resources==='number'&&!Object.hasOwn(candidate,'commodities')));
  const publicEvent=service.replayEvents(host.replayId).events.findLast(event=>event.type==='offerCommercialHarbor');
  assert.deepEqual(publicEvent.payload,{targetPlayerId:target.id});
  const privateEvent=service.replayEvents(host.replayId,{perspective:player.id,token:source.token}).events.findLast(event=>event.type==='offerCommercialHarbor');
  assert.equal(privateEvent.payload.resource,'grain');
  const view=service.observe(host.code,other.token),action=view.legalActions.find(action=>action.type==='resolveCitiesKnightsChoice');
  assert.ok(action);assert.equal(issue(service,host,other,action.type,action.payload).success,true);
  assert.equal(service.observe(host.code,source.token).gameState.players.find(candidate=>candidate.id===player.id).commodities.paper,1);
  assert.equal(service.observe(host.code,other.token).gameState.players.find(candidate=>candidate.id===target.id).resources.grain,1);
});

test('a suspended clockwise progress draw survives SQLite recovery and resolves exactly once',()=>{
  const store=new RoomStore(':memory:');
  try {
    const service=new RoomService({store}),{host,actors}=makeRoom(service,6);
    const game=service.rooms.get(host.code).game,science=game.citiesKnights.progressDecks.science;
    const [printing]=science.splice(science.findIndex(card=>card.type==='printing'),1);
    game.players[0].progressVictoryCards.push({type:printing.type,color:printing.color});
    game.players[0].victoryPoints++;
    for(const [index,count]of [4,4,1,4,3,0].entries())game.players[index].progressCards.push(...science.splice(0,count));
    assert.equal(science.length,1);
    game.players[1].cityImprovements.science=1;
    game.players[2].cityImprovements.science=1;
    const roller=actors.find(actor=>actor.seatId===game.players[0].id);
    const returning=actors.find(actor=>actor.seatId===game.players[1].id);
    const originalRandom=Math.random,rolls=[0,0,0.51];
    Math.random=()=>rolls.shift()??0;
    try {assert.equal(issue(service,host,roller,'rollDice').success,true);}
    finally {Math.random=originalRandom;}
    const waiting=service.observe(host.code,returning.token);
    assert.equal(waiting.gameState.pendingChoice.kind,'discardProgress');
    assert.equal(waiting.gameState.players[1].progressCards.length,5);
    assert.equal(waiting.gameState.citiesKnights.progressDecks.science,0);
    assert.equal(Object.hasOwn(waiting.gameState.citiesKnights,'deferredProgressDraws'),false);
    assert.deepEqual(service.observe(host.code,host.token).gameState.pendingChoice.options,[]);

    const recovered=new RoomService({store});
    assert.deepEqual(recovered.observe(host.code,returning.token).gameState,waiting.gameState);
    assert.equal(issue(recovered,host,host,'resume').success,true);
    const before=recovered.observe(host.code,returning.token),choice=before.gameState.pendingChoice;
    const returnedId=choice.options[0].cardId;
    const envelope={requestId:'return-last-progress-card',revision:before.revision,generation:before.generation,
      type:'resolveCitiesKnightsChoice',payload:{choiceId:choice.id,optionId:choice.options[0].id}};
    const result=recovered.command(host.code,returning.token,envelope);
    assert.equal(result.success,true,result.error);
    const finished=recovered.rooms.get(host.code).game;
    assert.equal(finished.pendingChoice,null);
    assert.equal(finished.turnPhase,'main');
    assert.equal(finished.players[1].progressCards.length,4);
    assert.equal(finished.players[2].progressCards.length,2);
    assert.equal(finished.players[2].progressCards.some(card=>card.id===returnedId),true);
    assert.deepEqual(finished.citiesKnights.deferredProgressDraws,[]);
    assert.equal(finished.citiesKnights.pendingRollTotal,null);
    const state=structuredClone(finished);
    assert.deepEqual(recovered.command(host.code,returning.token,envelope),result);
    assert.deepEqual(recovered.rooms.get(host.code).game,state);
    const view=recovered.observe(host.code,returning.token);
    assert.deepEqual(recovered.replay(host.replayId,{perspective:returning.seatId,token:returning.token}).state.gameState,view.gameState);
  } finally {store.close();}
});

test('replay building counts follow a retained city through pillage and restoration',()=>{
  const service=new RoomService(),{host,actors}=makeRoom(service);
  const game=service.rooms.get(host.code).game,player=game.players[0];
  for(let count=0;count<4;count++) {
    const key=Object.keys(game.vertices).find(key=>G.canPlaceSettlement(game,player.id,key,true).valid);
    assert.ok(key);game.vertices[key]={owner:0,building:'settlement'};
    player.settlements--;player.victoryPoints++;
  }
  assert.equal(player.settlements,0);
  const cityKey=CK.ownCityKeys(game,player.id)[0],actor=actors.find(actor=>actor.seatId===player.id);
  funds(game,player,{ore:3,grain:2});game.citiesKnights.barbarian.position=6;
  const originalRandom=Math.random;Math.random=()=>0;
  try {assert.equal(issue(service,host,actor,'rollDice').success,true);}
  finally {Math.random=originalRandom;}
  while(service.rooms.get(host.code).game.pendingChoice) {
    const choice=service.rooms.get(host.code).game.pendingChoice;
    assert.equal(choice.kind,'pillageCity');
    const target=actors.find(candidate=>candidate.seatId===choice.actorId);
    assert.equal(issue(service,host,target,'resolveCitiesKnightsChoice',{choiceId:choice.id,optionId:choice.options[0].id}).success,true);
  }
  const before=service.observe(host.code,actor.token).gameState;
  assert.equal(before.vertices[cityKey].pillagedNoPiece,true);
  assert.equal(before.players[0].cities,3);
  let metrics=service.replayMetrics(host.replayId).points.at(-1).players.find(candidate=>candidate.id===player.id);
  assert.equal(metrics.cities,0);assert.equal(metrics.settlements,6);
  assert.equal(issue(service,host,actor,'upgradeToCity',{vertexKey:cityKey}).success,true);
  metrics=service.replayMetrics(host.replayId).points.at(-1).players.find(candidate=>candidate.id===player.id);
  assert.equal(metrics.cities,1);assert.equal(metrics.settlements,5);
  assert.equal(service.observe(host.code,actor.token).gameState.players[0].cities,3);
});
