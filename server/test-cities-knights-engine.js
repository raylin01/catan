import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as A from './actions.js';
import * as CK from './citiesKnightsCore.js';
import * as SF from './seafarersCore.js';

function fixture(count=2) {
  const game=G.createGame(`ck-${Math.random()}`,{id:'host',name:'Host'},count>=5);
  for(let i=0;i<count;i++) assert.equal(G.addPlayer(game,{id:`p${i}`,name:`Player ${i}`}).success,true);
  assert.equal(G.configureExpansions(game,{version:1,expansions:['cities_knights'],scenario:'base'}).success,true);
  assert.equal(G.startGame(game).success,true);
  game.phase='playing';game.turnPhase='main';game.currentPlayerIndex=0;
  const player=game.players[0];
  return {game,player};
}
function give(game,player,cards) {
  for(const [type,count] of Object.entries(cards)) {
    const bank=CK.COMMODITIES.includes(type)?game.citiesKnights.commodityBank:game.bank;
    const hand=CK.COMMODITIES.includes(type)?player.commodities:player.resources;
    bank[type]-=count;hand[type]+=count;
  }
}
function city(game,owner=0) {
  const key=Object.keys(game.vertices).find(key=>!game.vertices[key]?.building);
  game.vertices[key]={building:'city',owner};game.players[owner].cities--;game.players[owner].victoryPoints+=2;
  return key;
}
function withRandom(values,work) {
  const old=Math.random;let index=0;Math.random=()=>values[index++]??0;
  try{return work();}finally{Math.random=old;}
}
function putProgressInHand(game,player,type) {
  const deck=Object.values(game.citiesKnights.progressDecks).find(cards=>cards.some(card=>card.type===type));
  const index=deck.findIndex(card=>card.type===type),[card]=deck.splice(index,1);
  player.progressCards.push(card);return card;
}
function play(game,player,type) {
  const card=putProgressInHand(game,player,type);
  const result=A.executeAction(game,player.id,'playProgressCard',{cardId:card.id});
  assert.equal(result.success,true,`${type}: ${result.error}`);return card;
}
function resolve(game,optionId=null,cards=null) {
  const choice=game.pendingChoice;assert.ok(choice,'Expected a pending choice');
  const payload={choiceId:choice.id,...(optionId!=null?{optionId}:{}),...(cards?{cards}:{})};
  const result=A.executeAction(game,choice.actorId,'resolveCitiesKnightsChoice',payload);
  assert.equal(result.success,true,`${choice.kind}: ${result.error}`);return result;
}

test('CK setup turns the reverse-round second placement into a city and preserves the finite commodity bank',()=>{
  const {game,player}=fixture();
  game.phase='setup';game.setupPhase=1;game.setupAction=null;
  const vertexKey=Object.keys(game.vertices).find(key=>G.getVertexAdjacentHexes(game,key).some(hex=>hex.resource));
  const result=A.executeAction(game,player.id,'placeSettlement',{vertexKey});
  assert.equal(result.success,true,result.error);
  assert.equal(game.vertices[vertexKey].building,'city');
  assert.equal(player.id,game.players[0].id);
  assert.equal(game.players[0].cities,3);
  assert.equal(game.players[0].victoryPoints,2);
  assert.equal(CK.cardCount(game.players[0])>0,true);
  assert.deepEqual(game.players[0].commodities,{paper:0,coin:0,cloth:0});
  assert.deepEqual(game.citiesKnights.commodityBank,{paper:12,coin:12,cloth:12});
  assert.equal(game.devCardDeck.length,0);
});

test('event die resolves before converted city production and exposes only deck counts',()=>{
  const {game,player}=fixture();
  const isolatedForest=Object.values(game.hexes).filter(hex=>hex.terrain==='forest')
    .flatMap(hex=>Array.from({length:6},(_,dir)=>[hex,G.vertexKey(hex.q,hex.r,dir)]))
    .find(([hex,vertexKey])=>G.getVertexAdjacentHexes(game,vertexKey)
      .every(adjacent=>adjacent===hex||adjacent.number!==hex.number||!adjacent.resource));
  assert.ok(isolatedForest,'Expected a forest corner without another producing hex on the same roll');
  const [hex,vertexKey]=isolatedForest;
  game.vertices[vertexKey]={building:'city',owner:0};player.cities--;player.victoryPoints=2;
  const pair=Array.from({length:6},(_,i)=>[i+1,hex.number-i-1]).find(([a,b])=>a>=1&&a<=6&&b>=1&&b<=6);
  game.turnPhase='roll';
  const result=withRandom([(pair[0]-1)/6,(pair[1]-1)/6,0.51],()=>A.executeAction(game,player.id,'rollDice',{}));
  assert.equal(result.success,true,result.error);
  assert.equal(game.citiesKnights.eventDie,'science');
  assert.equal(game.turnPhase,'main');
  assert.equal(player.id,game.players[0].id);
  assert.equal(game.players[0].resources.lumber,1);
  assert.equal(game.players[0].commodities.paper,1);
  const other=A.playerView(game,game.players[1].id);
  assert.equal(Object.hasOwn(other.players[0],'commodities'),false);
  assert.equal(other.players[0].resources,2);
  assert.equal(typeof other.citiesKnights.progressDecks.science,'number');
  assert.equal(Array.isArray(game.citiesKnights.progressDecks.science),true);
  assert.equal(other.citiesKnights.choiceQueue,undefined);
  assert.equal(other.citiesKnights.pendingRollTotal,undefined);
});

test('wall threshold and commodity discard use the same eight-card hand and skip inactive robber',()=>{
  const {game,player}=fixture();
  const vertexKey=city(game);give(game,player,{brick:2,grain:8,paper:2});
  assert.equal(A.executeAction(game,player.id,'buildCityWall',{vertexKey}).success,true);
  assert.equal(CK.discardLimit(game,player.id),9);
  game.turnPhase='roll';
  const result=withRandom([0,5/6,0.51],()=>A.executeAction(game,player.id,'rollDice',{}));
  assert.equal(result.success,true,result.error);
  assert.equal(game.turnPhase,'discard');
  assert.equal(game.discardingPlayers[0].cardsToDiscard,5);
  assert.equal(A.executeAction(game,player.id,'discardCards',{resources:{brick:0,lumber:0,wool:0,grain:3,ore:0,paper:2,coin:0,cloth:0}}).success,true);
  assert.equal(game.turnPhase,'main');
  assert.equal(game.robber,null);
});

test('knights recruit, promote once per turn, activate, and cannot move after activation',()=>{
  const {game,player}=fixture();
  const edgeKey=Object.keys(game.edges)[0];const [a,b]=CK.isCitiesKnights(game)?G.getEdgeVertices(...edgeKey.match(/-?\d+/g).map(Number)):[];
  game.edges[edgeKey]={road:true,owner:0};player.roads--;give(game,player,{wool:3,ore:3,grain:1});
  assert.equal(A.executeAction(game,player.id,'recruitKnight',{vertexKey:a}).success,true);
  assert.equal(A.executeAction(game,player.id,'promoteKnight',{vertexKey:a}).success,true);
  assert.equal(A.executeAction(game,player.id,'promoteKnight',{vertexKey:a}).success,false);
  assert.equal(A.executeAction(game,player.id,'activateKnight',{vertexKey:a}).success,true);
  assert.equal(A.executeAction(game,player.id,'moveKnight',{fromVertexKey:a,toVertexKey:b}).success,false);
  assert.equal(game.citiesKnights.knights[CK.canonicalVertex(game,a)].strength,2);
});

test('public VP progress cards apply immediately and never expose deck order',()=>{
  const {game,player}=fixture();
  const card=game.citiesKnights.progressDecks.science.find(value=>value.type==='printing');
  game.citiesKnights.progressDecks.science=game.citiesKnights.progressDecks.science.filter(value=>value!==card);
  game.citiesKnights.progressDecks.science.unshift(card);
  assert.equal(CK.drawProgress(game,player.id,'science').success,true);
  assert.equal(game.players[0].victoryPoints,1);
  assert.deepEqual(game.players[0].progressVictoryCards,[{type:'printing',color:'science'}]);
  assert.equal(game.players[0].progressCards.length,0);
  const view=A.playerView(game,game.players[1].id);
  assert.equal(view.players[0].progressCards,0);
  assert.equal(view.players[0].progressVictoryCards[0].type,'printing');
  assert.equal(view.citiesKnights.progressDecks.science,17);
});

test('invalid CK choice and noncurrent actor leave game unchanged; card bundles accept explicit zeroes',()=>{
  const {game,player}=fixture();
  const victim=game.players[1];victim.victoryPoints=3;give(game,victim,{brick:3,paper:2});
  player.progressCards.push({id:'guild',color:'trade',type:'guildDues'});
  assert.equal(A.executeAction(game,player.id,'playProgressCard',{cardId:'guild'}).success,true);
  const first=game.pendingChoice;
  assert.equal(A.executeAction(game,victim.id,'resolveCitiesKnightsChoice',{choiceId:first.id,optionId:victim.id}).success,false);
  assert.equal(A.executeAction(game,player.id,'resolveCitiesKnightsChoice',{choiceId:first.id,optionId:victim.id}).success,true);
  const countChoice=game.pendingChoice;
  assert.equal(countChoice.kind,'card:guildCount');
  assert.equal(A.executeAction(game,player.id,'resolveCitiesKnightsChoice',{choiceId:countChoice.id,optionId:'2'}).success,true);
  const second=game.pendingChoice;
  assert.equal(second.selection,'cards');
  const before=structuredClone(game);
  assert.equal(A.executeAction(game,player.id,'resolveCitiesKnightsChoice',{choiceId:second.id,cards:{brick:5}}).success,false);
  assert.deepEqual(game,before);
  const bundle={brick:1,lumber:0,wool:0,grain:0,ore:0,paper:1,coin:0,cloth:0};
  assert.equal(A.executeAction(game,player.id,'resolveCitiesKnightsChoice',{choiceId:second.id,cards:bundle}).success,true);
  assert.equal(game.players[0].resources.brick,1);
  assert.equal(game.players[0].commodities.paper,1);
});

test('opponents cannot distinguish equal-total resource and commodity hands, including after finish',()=>{
  const {game,player}=fixture();
  const opponent=game.players[1];
  give(game,player,{brick:2,paper:1});
  const first=A.playerView(game,opponent.id).players[0];
  CK.moveCard(game,player,'bank','brick',1);CK.moveCard(game,'bank',player,'coin',1);
  const second=A.playerView(game,opponent.id).players[0];
  assert.equal(first.resources,second.resources);
  assert.equal(Object.hasOwn(first,'commodities'),false);
  assert.equal(Object.hasOwn(second,'commodities'),false);
  game.phase='finished';
  const finished=A.playerView(game,opponent.id).players[0];
  assert.equal(finished.resources,3);
  assert.equal(Object.hasOwn(finished,'commodities'),false);
});

test('all ordinary progress cards can be consumed in no-benefit states without trapping a choice',()=>{
  for(const [color,types] of Object.entries(CK.PROGRESS_CARDS))for(const type of Object.keys(types)){
    if(['printing','constitution'].includes(type))continue;
    const {game,player}=fixture();
    if(type==='alchemy')game.turnPhase='roll';
    game.players[0].progressCards.push({id:'test-card',color,type});
    const played=A.executeAction(game,player.id,'playProgressCard',{cardId:'test-card'});
    assert.equal(played.success,true,`${type}: ${played.error}`);
    let count=0;
    while(game.pendingChoice&&count++<8){
      const pending=game.pendingChoice;
      assert.ok(pending.options?.length>0||pending.selection==='cards',`${type}: empty ${pending.kind}`);
      const payload={choiceId:pending.id,optionId:pending.options?.[0]?.id};
      if(pending.selection==='cards')payload.cards={};
      const choice=A.executeAction(game,pending.actorId,'resolveCitiesKnightsChoice',payload);
      assert.equal(choice.success,true,`${type} ${pending.kind}: ${choice.error}`);
    }
    assert.ok(count<8,`${type}: choice loop`);
    assert.equal(game.players[0].progressCards.some(card=>card.id==='test-card'),false,type);
  }
});

test('barbarian defense awards a visible defender point before production and deactivates knights',()=>{
  const {game,player}=fixture();
  city(game,0);city(game,1);
  const vertex=Object.keys(game.vertices).find(key=>!game.vertices[key]?.building);
  game.citiesKnights.knights[CK.canonicalVertex(game,vertex)]={ownerId:player.id,strength:3,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
  game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
  const result=withRandom([0,0,0],()=>A.executeAction(game,player.id,'rollDice',{}));
  assert.equal(result.success,true,result.error);
  assert.deepEqual(game.citiesKnights.lastBarbarianAttack.defenderIds,[player.id]);
  assert.equal(game.citiesKnights.lastBarbarianAttack.repelled,true);
  assert.equal(game.players[0].defenderPoints,1);
  assert.equal(game.players[0].victoryPoints,3);
  assert.equal(Object.values(game.citiesKnights.knights)[0].active,false);
  assert.equal(game.citiesKnights.barbarian.position,0);
  assert.equal(game.citiesKnights.barbarian.attacked,true);
});

test('tied defenders cannot be trapped when the last available progress deck empties',()=>{
  const {game,player}=fixture();
  city(game,0);city(game,1);
  const vertices=Object.keys(game.vertices).filter(key=>!game.vertices[key]?.building).slice(0,2);
  for(let index=0;index<2;index++) game.citiesKnights.knights[CK.canonicalVertex(game,vertices[index])]={
    ownerId:game.players[index].id,strength:1,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null
  };
  game.citiesKnights.progressDecks.science.length=1;
  game.citiesKnights.progressDecks.trade.length=0;
  game.citiesKnights.progressDecks.politics.length=0;
  game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
  const rolled=withRandom([0,0,0],()=>A.executeAction(game,player.id,'rollDice',{}));
  assert.equal(rolled.success,true,rolled.error);
  assert.deepEqual(game.pendingChoice.options.map(option=>option.id),['science']);
  resolve(game,'science');
  assert.equal(game.pendingChoice,null);
  assert.equal(game.citiesKnights.choiceQueue.length,0);
  assert.equal(game.turnPhase,'main');
});

test('tied defender rewards proceed clockwise and finish an off-turn return before the next draw',()=>{
  const {game}=fixture(5); // Six seats including the host.
  game.currentPlayerIndex=2;
  city(game,3);city(game,0);
  const vertices=Object.keys(game.vertices).filter(key=>!game.vertices[key]?.building).slice(0,2);
  for(const [index,seat] of [3,0].entries()) game.citiesKnights.knights[CK.canonicalVertex(game,vertices[index])]={
    ownerId:game.players[seat].id,strength:1,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null
  };
  const science=game.citiesKnights.progressDecks.science;
  const printingIndex=science.findIndex(card=>card.type==='printing');
  const [printing]=science.splice(printingIndex,1);
  game.players[1].progressVictoryCards.push({type:printing.type,color:printing.color});
  game.players[1].victoryPoints++;
  for(const [index,count] of [1,4,4,4,3,0].entries()) game.players[index].progressCards.push(...science.splice(0,count));
  assert.equal(science.length,1);
  game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
  withRandom([0],()=>CK.rollEvent(game,1,2));
  assert.deepEqual(game.citiesKnights.lastBarbarianAttack.defenderIds,[game.players[3].id,game.players[0].id]);
  assert.equal(game.pendingChoice.kind,'defenderDraw');
  assert.equal(game.pendingChoice.actorId,game.players[3].id);
  resolve(game,'science');
  assert.equal(game.pendingChoice.kind,'discardProgress');
  assert.equal(game.pendingChoice.actorId,game.players[3].id);
  assert.equal(game.players[0].progressCards.length,1);
  assert.equal(game.citiesKnights.progressDecks.science.length,0);
  const returnedId=game.pendingChoice.options[0].cardId;
  resolve(game,returnedId);
  assert.equal(game.pendingChoice.kind,'defenderDraw');
  assert.equal(game.pendingChoice.actorId,game.players[0].id);
  assert.ok(game.pendingChoice.options.some(option=>option.id==='science'));
  resolve(game,'science');
  assert.equal(game.players[0].progressCards.some(card=>card.id===returnedId),true);
  assert.equal(game.pendingChoice,null);
  assert.equal(game.turnPhase,'main');
});

test('zero cities and zero active knights still award clockwise tied defender draws',()=>{
  const {game}=fixture(2); // Host plus two other players.
  game.currentPlayerIndex=1;
  game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
  withRandom([0],()=>CK.rollEvent(game,1,2));
  assert.equal(game.citiesKnights.lastBarbarianAttack.cities,0);
  assert.equal(game.citiesKnights.lastBarbarianAttack.defense,0);
  assert.equal(game.citiesKnights.lastBarbarianAttack.repelled,true);
  assert.deepEqual(game.citiesKnights.lastBarbarianAttack.defenderIds,[game.players[1].id,game.players[2].id,game.players[0].id]);
  for(const seat of [1,2,0]) {
    assert.equal(game.pendingChoice.kind,'defenderDraw');
    assert.equal(game.pendingChoice.actorId,game.players[seat].id);
    resolve(game,'science');
  }
  assert.equal(game.pendingChoice,null);
  assert.equal(game.turnPhase,'main');
  for(const player of game.players) {
    assert.equal(player.defenderPoints,0);
    assert.equal(player.progressCards.length+player.progressVictoryCards.length,1);
  }
});

test('clockwise progress draws resume after an off-turn return replenishes the last deck card',()=>{
  const {game}=fixture(5); // The fixture includes the host as the sixth seat.
  const science=game.citiesKnights.progressDecks.science;
  const printingIndex=science.findIndex(card=>card.type==='printing');
  const [printing]=science.splice(printingIndex,1);
  game.players[0].progressVictoryCards.push({type:printing.type,color:printing.color});
  game.players[0].victoryPoints++;
  for(const [index,count] of [4,4,1,4,3,0].entries()) game.players[index].progressCards.push(...science.splice(0,count));
  assert.equal(science.length,1);
  game.players[1].cityImprovements.science=1;
  game.players[2].cityImprovements.science=1;
  game.turnPhase='roll';
  withRandom([0.51],()=>CK.rollEvent(game,1,2));
  assert.equal(game.citiesKnights.eventDie,'science');
  assert.equal(game.pendingChoice.kind,'discardProgress');
  assert.equal(game.pendingChoice.actorId,game.players[1].id);
  assert.equal(game.players[1].progressCards.length,5);
  assert.equal(game.players[2].progressCards.length,1);
  assert.equal(science.length,0);
  assert.equal(game.turnPhase,'roll');
  const observer=A.playerView(game,game.players[3].id);
  assert.deepEqual(observer.pendingChoice.options,[]);
  const returnedId=game.pendingChoice.options[0].cardId;
  resolve(game,returnedId);
  assert.equal(game.players[1].progressCards.length,4);
  assert.equal(game.players[2].progressCards.length,2);
  assert.equal(game.players[2].progressCards.some(card=>card.id===returnedId),true);
  assert.equal(game.citiesKnights.progressDecks.science.length,0);
  assert.equal(game.citiesKnights.deferredProgressDraws.length,0);
  assert.equal(game.pendingChoice,null);
  assert.equal(game.turnPhase,'main');
});

test('an event progress-card victory cancels later clockwise draws and production',()=>{
  const {game,player}=fixture();
  const science=game.citiesKnights.progressDecks.science;
  const index=science.findIndex(card=>card.type==='printing');
  science.unshift(...science.splice(index,1));
  player.victoryPoints=12;
  player.cityImprovements.science=1;
  game.players[1].cityImprovements.science=1;
  game.turnPhase='roll';
  withRandom([0.51],()=>CK.rollEvent(game,1,2));
  assert.equal(game.phase,'finished');
  assert.equal(player.victoryPoints,13);
  assert.equal(game.players[1].progressCards.length,0);
  assert.equal(game.citiesKnights.deferredProgressDraws.length,0);
  assert.equal(game.citiesKnights.pendingRollTotal,null);
  assert.equal(game.pendingChoice??null,null);
});

test('barbarian pillage is an authenticated off-turn city choice and removes its wall',()=>{
  const {game,player}=fixture();
  city(game,0);const victim=game.players[1];const victimCity=city(game,1);
  game.citiesKnights.walls[CK.canonicalVertex(game,victimCity)]=victim.id;victim.wallSupply--;
  game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
  const result=withRandom([0,0,0],()=>A.executeAction(game,player.id,'rollDice',{}));
  assert.equal(result.success,true,result.error);
  assert.equal(game.pendingChoice.kind,'pillageCity');
  assert.equal(game.pendingChoice.actorId,player.id); // Both have zero defense; first seat chooses first.
  assert.equal(A.executeAction(game,victim.id,'resolveCitiesKnightsChoice',{choiceId:game.pendingChoice.id,optionId:game.pendingChoice.options[0].id}).success,false);
  const first=game.pendingChoice;
  assert.equal(A.executeAction(game,player.id,'resolveCitiesKnightsChoice',{choiceId:first.id,optionId:first.options[0].id}).success,true);
  const second=game.pendingChoice;
  assert.equal(second.actorId,victim.id);
  assert.equal(A.executeAction(game,victim.id,'resolveCitiesKnightsChoice',{choiceId:second.id,optionId:victimCity}).success,true);
  assert.equal(game.vertices[victimCity].building,'settlement');
  assert.equal(game.citiesKnights.walls[CK.canonicalVertex(game,victimCity)],undefined);
  assert.equal(game.players[1].wallSupply,3);
});

test('a pillaged city retained on its side preserves city supply and must be restored first',()=>{
  for(const usedCities of [1,4]) {
    const {game}=fixture();
    const keys=[...new Set(Object.keys(game.vertices).map(key=>CK.canonicalVertex(game,key)))];
    const settlementKeys=keys.slice(0,5),cityKeys=keys.slice(5,5+usedCities);
    for(const key of settlementKeys) game.vertices[key]={building:'settlement',owner:0};
    for(const key of cityKeys) game.vertices[key]={building:'city',owner:0};
    game.players[0].settlements=0;
    game.players[0].cities=4-usedCities;
    game.players[0].victoryPoints=5;
    game.citiesKnights.barbarian.position=6;game.turnPhase='roll';
    withRandom([0],()=>CK.rollEvent(game,1,2));
    assert.equal(game.pendingChoice.kind,'pillageCity');
    resolve(game,cityKeys[0]);
    assert.equal(game.vertices[cityKeys[0]].building,'settlement');
    assert.equal(game.vertices[cityKeys[0]].pillagedNoPiece,true);
    assert.equal(game.players[0].cities,4-usedCities);
    assert.equal(game.players[0].settlements,0);
    assert.equal(game.players[0].victoryPoints,4);
    give(game,game.players[0],{grain:2,ore:3});
    const other=A.executeAction(game,game.players[0].id,'upgradeToCity',{vertexKey:settlementKeys[0]});
    assert.equal(other.success,false);
    assert.match(other.error,/Restore your pillaged city/);
    if(usedCities===1) {
      play(game,game.players[0],'medicine');
      assert.equal(game.pendingChoice.kind,'card:medicine');
      assert.deepEqual(game.pendingChoice.options.map(option=>option.vertexKey),[cityKeys[0]]);
      resolve(game,cityKeys[0]);
    } else {
      const restored=A.executeAction(game,game.players[0].id,'upgradeToCity',{vertexKey:cityKeys[0]});
      assert.equal(restored.success,true,restored.error);
    }
    assert.equal(game.vertices[cityKeys[0]].building,'city');
    assert.equal(game.vertices[cityKeys[0]].pillagedNoPiece,undefined);
    assert.equal(game.players[0].cities,4-usedCities);
    assert.equal(game.players[0].settlements,0);
    assert.equal(game.players[0].victoryPoints,5);
  }
});

test('all seven defined Seafarers combinations add two goal points; undefined deck conversions are rejected atomically',()=>{
  const supported=['heading_for_new_shores','the_four_islands','the_fog_islands','through_the_desert','cloth_for_catan','the_wonders_of_catan','new_world'];
  for(const scenario of supported){
    const game=G.createGame(`combo-${scenario}`,{id:'host',name:'Host'});
    for(let i=0;i<3;i++)G.addPlayer(game,{id:`p${i}`,name:`P${i}`});
    const options={version:1,expansions:['seafarers','cities_knights'],scenario,setup:{layout:scenario==='new_world'?'variable':'fixed',seed:42}};
    const sea=structuredClone(game);assert.equal(G.configureExpansions(sea,{...options,expansions:['seafarers']}).success,true,scenario);
    assert.equal(G.configureExpansions(game,options).success,true,scenario);
    assert.equal(game.seafarers.goal,sea.seafarers.goal+2,scenario);
    assert.equal(game.robber,null,scenario);
    assert.equal(game.pirate,null,scenario);
  }
  for(const scenario of ['the_forgotten_tribe','the_pirate_islands']){
    const game=G.createGame(`blocked-${scenario}`,{id:'host',name:'Host'});
    for(let i=0;i<3;i++)G.addPlayer(game,{id:`p${i}`,name:`P${i}`});
    const before=structuredClone(game);
    const result=G.configureExpansions(game,{version:1,expansions:['seafarers','cities_knights'],scenario,setup:{layout:'fixed',seed:42}});
    assert.equal(result.success,false,scenario);
    assert.deepEqual(game,before,scenario);
  }
});

test('five-player paired action phases allow each actor to improve and play progress cards independently',()=>{
  const {game,player}=fixture(5);
  game.pairedTurnRules=true;game.turnRole='primary';game.productionPlayerIndex=0;
  city(game,0);city(game,3);
  const paired=game.players[3];
  give(game,player,{paper:1});give(game,paired,{paper:1});
  assert.equal(A.executeAction(game,player.id,'improveCity',{track:'science',vertexKey:CK.ownCityKeys(game,player.id)[0]}).success,true);
  assert.equal(A.executeAction(game,player.id,'endTurn',{}).success,true);
  assert.equal(game.turnRole,'paired');assert.equal(game.currentPlayerIndex,3);
  assert.equal(A.executeAction(game,paired.id,'improveCity',{track:'science',vertexKey:CK.ownCityKeys(game,paired.id)[0]}).success,true);
  assert.equal(A.executeAction(game,paired.id,'endTurn',{}).success,true);
  assert.equal(game.turnRole,'primary');assert.equal(game.productionPlayerIndex,1);
});

test('science cards apply targeted effects, discounts, swaps, production awards and sequential free routes',()=>{
  {
    const {game,player}=fixture();game.turnPhase='roll';play(game,player,'alchemy');
    resolve(game,'6');resolve(game,'6');
    assert.equal(game.diceRoll.total,12);assert.equal(game.turnPhase,'main');
  }
  {
    const {game,player}=fixture();const vertexKey=city(game);play(game,player,'crane');
    assert.equal(game.pendingChoice.kind,'card:crane');resolve(game,`science:${vertexKey}`);
    assert.equal(game.players[0].cityImprovements.science,1);assert.equal(game.players[0].commodities.paper,0);
    play(game,game.players[0],'engineering');resolve(game,vertexKey);
    assert.equal(game.citiesKnights.walls[CK.canonicalVertex(game,vertexKey)],player.id);
  }
  {
    const {game,player}=fixture();const options=Object.entries(game.hexes).filter(([,hex])=>hex.number!=null&&![2,6,8,12].includes(hex.number));
    assert.ok(options.length>=2);const [first,second]=options;
    play(game,player,'invention');resolve(game,first[0]);resolve(game,second[0]);
    assert.equal(game.hexes[first[0]].number,second[1].number);
    assert.equal(game.hexes[second[0]].number,first[1].number);
  }
  {
    const {game,player}=fixture();const field=Object.values(game.hexes).find(hex=>hex.terrain==='fields');
    game.vertices[G.vertexKey(field.q,field.r,0)]={building:'settlement',owner:0};
    play(game,player,'irrigation');assert.ok(game.players[0].resources.grain>=2);
    const mountain=Object.values(game.hexes).find(hex=>hex.terrain==='mountains');
    game.vertices[G.vertexKey(mountain.q,mountain.r,3)]={building:'settlement',owner:0};
    play(game,game.players[0],'mining');assert.ok(game.players[0].resources.ore>=2);
  }
  {
    const {game,player}=fixture();const vertexKey=Object.keys(game.vertices)[0];game.vertices[vertexKey]={building:'settlement',owner:0};player.settlements--;player.victoryPoints++;
    give(game,player,{grain:1,ore:2});play(game,player,'medicine');resolve(game,vertexKey);
    assert.equal(game.vertices[vertexKey].building,'city');assert.equal(game.players[0].resources.grain,0);
  }
  {
    const {game,player}=fixture();const vertexKey=Object.keys(game.vertices)[0];game.vertices[vertexKey]={building:'settlement',owner:0};
    play(game,player,'roadBuilding');assert.equal(game.freeRoads,2);
    const first=A.legalActions(game,player.id).find(action=>action.type==='placeRoad');assert.ok(first);
    assert.equal(A.executeAction(game,player.id,first.type,first.payload).success,true);
    assert.equal(game.freeRoads,1);
    const second=A.legalActions(game,player.id).find(action=>action.type==='placeRoad');assert.ok(second);
    assert.equal(A.executeAction(game,player.id,second.type,second.payload).success,true);
    assert.equal(game.freeRoads,0);
  }
  {
    const {game,player}=fixture();const edgeKey=Object.keys(game.edges)[0],vertexKey=G.getEdgeVertices(...edgeKey.match(/-?\d+/g).map(Number))[0];
    game.edges[edgeKey]={road:true,owner:0};game.citiesKnights.knights[CK.canonicalVertex(game,vertexKey)]={ownerId:player.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
    play(game,player,'smithing');resolve(game,vertexKey);resolve(game,'finish');
    assert.equal(CK.knightAt(game,vertexKey).strength,2);
  }
});

test('trade cards transfer commodities, grant merchant privileges, and enforce monopoly limits',()=>{
  {
    const {game,player}=fixture();const target=game.players[1];give(game,player,{brick:1});give(game,target,{coin:1});
    play(game,player,'commercialHarbor');
    assert.equal(A.executeAction(game,player.id,'offerCommercialHarbor',{targetPlayerId:target.id,resource:'brick'}).success,true);
    assert.equal(game.pendingChoice.actorId,target.id);
    const recipientChoice=A.playerView(game,target.id).pendingChoice;
    assert.equal(recipientChoice.sourcePlayerId,player.id);
    assert.equal(recipientChoice.offeredResource,'brick');
    const observerChoice=A.playerView(game,player.id).pendingChoice;
    assert.equal(observerChoice.sourcePlayerId,undefined);
    assert.equal(observerChoice.offeredResource,undefined);
    resolve(game,'coin');
    assert.equal(game.players[0].commodities.coin,1);assert.equal(game.players[1].resources.brick,1);
  }
  {
    const {game,player}=fixture();const victim=game.players[1];victim.victoryPoints=3;give(game,victim,{paper:1,brick:2});
    play(game,player,'guildDues');resolve(game,victim.id);resolve(game,'1');resolve(game,null,{paper:1});
    assert.equal(game.players[0].commodities.paper,1);assert.equal(game.players[1].commodities.paper,0);
  }
  {
    const {game,player}=fixture();const hills=Object.values(game.hexes).find(hex=>hex.terrain==='hills');
    const hexKey=G.hexKey(hills.q,hills.r);game.vertices[G.vertexKey(hills.q,hills.r,0)]={building:'settlement',owner:0};
    play(game,player,'merchant');resolve(game,hexKey);assert.equal(game.citiesKnights.merchant.ownerId,player.id);assert.equal(game.players[0].victoryPoints,1);
    give(game,game.players[0],{brick:2});assert.equal(A.executeAction(game,player.id,'bankTrade',{giveResource:'brick',giveAmount:2,getResource:'ore'}).success,true);
  }
  {
    const {game,player}=fixture();give(game,player,{paper:2});play(game,player,'merchantFleet');resolve(game,'paper');
    assert.equal(A.executeAction(game,player.id,'bankTrade',{giveResource:'paper',giveAmount:2,getResource:'ore'}).success,true);
    assert.equal(game.players[0].resources.ore,1);
  }
  {
    const {game,player}=fixture();give(game,game.players[1],{brick:3,cloth:2});play(game,player,'resourceMonopoly');resolve(game,'brick');
    assert.equal(game.players[0].resources.brick,2);assert.equal(game.players[1].resources.brick,1);
    play(game,game.players[0],'tradeMonopoly');resolve(game,'cloth');
    assert.equal(game.players[0].commodities.cloth,1);assert.equal(game.players[1].commodities.cloth,1);
  }
});

test('politics cards remove routes, displace knights, and transfer progress cards through authenticated choices',()=>{
  {
    const {game,player}=fixture();const edgeKey=Object.keys(game.edges)[0];
    game.edges[edgeKey]={road:true,owner:0};player.roads--;
    play(game,player,'diplomacy');assert.ok(game.pendingChoice.options.some(option=>option.id===edgeKey));
    resolve(game,edgeKey);assert.equal(game.edges[edgeKey].road,undefined);
    resolve(game,'finish');assert.equal(game.players[0].roads,15);
  }
  {
    const {game,player}=fixture();const edgeKey=Object.keys(game.edges)[0];
    const [origin]=SF.edgeEndpoints(edgeKey);
    game.vertices[origin]={building:'settlement',owner:0};player.settlements--;player.victoryPoints++;
    game.edges[edgeKey]={road:true,owner:0};player.roads--;
    play(game,player,'diplomacy');resolve(game,edgeKey);
    const replacement=game.pendingChoice.options.find(option=>option.edgeKey&&option.edgeKey!==edgeKey);
    assert.ok(replacement,'A free replacement edge should be listed');
    resolve(game,replacement.id);
    assert.equal(game.edges[replacement.edgeKey].road,true);
    assert.equal(game.players[0].roads,14);
  }
  {
    const {game,player}=fixture();const vertexKey=Object.keys(game.vertices)[0];
    game.citiesKnights.knights[CK.canonicalVertex(game,vertexKey)]={ownerId:player.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
    play(game,player,'encouragement');assert.equal(CK.knightAt(game,vertexKey).active,true);
  }
  {
    const {game,player}=fixture();const target=game.players[1],stolen=putProgressInHand(game,target,'mining');
    play(game,player,'espionage');resolve(game,target.id);
    assert.equal(game.pendingChoice.options.find(option=>option.cardId===stolen.id).cardType,'mining');
    resolve(game,stolen.id);assert.equal(game.players[0].progressCards.some(card=>card.id===stolen.id),true);
    assert.equal(game.players[1].progressCards.length,0);
  }
  {
    const {game,player}=fixture();const enemy=game.players[1];
    const edgeKey=Object.keys(game.edges)[0],vertexKey=G.getEdgeVertices(...edgeKey.match(/-?\d+/g).map(Number))[0];
    game.edges[edgeKey]={road:true,owner:0};game.citiesKnights.knights[CK.canonicalVertex(game,vertexKey)]={ownerId:enemy.id,strength:1,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
    play(game,player,'intrigue');resolve(game,CK.canonicalVertex(game,vertexKey));
    assert.equal(game.pendingChoice.actorId,enemy.id);resolve(game,'remove');
    assert.equal(CK.knightAt(game,vertexKey),null);
  }
});

test('Diplomacy openness counts only the selected road owner’s adjoining pieces',()=>{
  for(const [blocker,open] of [['foreignRoad',true],['foreignBuilding',true],['foreignKnight',true],
    ['ownRoad',false],['ownBuilding',false],['ownKnight',false]]) {
    const {game,player}=fixture(),enemy=game.players[1];
    const selected=G.edgeKey(0,0,0),[a,b]=SF.edgeEndpoints(selected);
    const anchor=G.getVertexEdges(a).find(key=>game.edges[key]&&SF.canonicalEdge(game,key)!==SF.canonicalEdge(game,selected));
    const branch=G.getVertexEdges(b).find(key=>game.edges[key]&&SF.canonicalEdge(game,key)!==SF.canonicalEdge(game,selected));
    assert.ok(anchor&&branch);
    game.edges[selected]={road:true,owner:0};
    game.edges[anchor]={road:true,owner:0};
    if(blocker.endsWith('Road')) game.edges[branch]={road:true,owner:blocker.startsWith('own')?0:1};
    if(blocker.endsWith('Building')) game.vertices[CK.canonicalVertex(game,b)]={building:'settlement',owner:blocker.startsWith('own')?0:1};
    if(blocker.endsWith('Knight')) game.citiesKnights.knights[CK.canonicalVertex(game,b)]={
      ownerId:blocker.startsWith('own')?player.id:enemy.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null
    };
    play(game,player,'diplomacy');
    assert.equal(Boolean(game.pendingChoice?.options.some(option=>option.edgeKey===selected)),open,blocker);
  }
});

test('Diplomacy treats a Seafarers ship as open beside a foreign ship branch',()=>{
  const game=G.createGame('ck-diplomacy-ship',{id:'host',name:'Host'});
  for(let i=0;i<2;i++) G.addPlayer(game,{id:`p${i}`,name:`Player ${i}`});
  assert.equal(G.configureExpansions(game,{version:1,expansions:['seafarers','cities_knights'],scenario:'heading_for_new_shores',setup:{layout:'fixed',seed:17}}).success,true);
  assert.equal(G.startGame(game).success,true);
  game.phase='playing';game.turnPhase='main';game.currentPlayerIndex=0;
  const sea=Object.values(game.hexes).find(hex=>hex.terrain==='sea');
  assert.ok(sea);
  const selected=G.edgeKey(sea.q,sea.r,0),[a,b]=SF.edgeEndpoints(selected);
  const seaEdge=key=>game.edges[key]&&SF.edgeHexes(game,key).some(hex=>hex.terrain==='sea');
  const anchor=G.getVertexEdges(a).find(key=>seaEdge(key)&&SF.canonicalEdge(game,key)!==SF.canonicalEdge(game,selected));
  const branch=G.getVertexEdges(b).find(key=>seaEdge(key)&&SF.canonicalEdge(game,key)!==SF.canonicalEdge(game,selected));
  assert.ok(anchor&&branch);
  game.edges[selected]={ship:true,owner:0};
  game.edges[anchor]={ship:true,owner:0};
  game.edges[branch]={ship:true,owner:1};
  play(game,game.players[0],'diplomacy');
  assert.equal(game.pendingChoice.options.find(option=>option.edgeKey===selected)?.kind,'ship');
});

test('politics cards apply every-player discard/gift, robber tax, treason, and public Constitution point',()=>{
  {
    const {game,player}=fixture();const other=game.players[1];give(game,other,{brick:2,paper:2});
    play(game,player,'sabotage');assert.equal(game.pendingChoice.actorId,other.id);
    resolve(game,null,{brick:1,paper:1});assert.equal(CK.cardCount(game.players[1]),2);
  }
  {
    const {game,player}=fixture();const other=game.players[1];other.victoryPoints=1;give(game,other,{grain:1,coin:2});
    play(game,player,'wedding');assert.equal(game.pendingChoice.actorId,other.id);
    resolve(game,null,{grain:1,coin:1});assert.equal(game.players[0].resources.grain,1);assert.equal(game.players[0].commodities.coin,1);
  }
  {
    const {game,player}=fixture();const victim=game.players[1],hex=Object.values(game.hexes).find(value=>value.terrain==='hills');
    const target=G.hexKey(hex.q,hex.r);game.vertices[G.vertexKey(hex.q,hex.r,0)]={building:'settlement',owner:1};
    give(game,victim,{paper:1});game.citiesKnights.barbarian.attacked=true;game.robber=Object.keys(game.hexes).find(key=>key!==target);
    play(game,player,'taxation');resolve(game,target);
    assert.equal(game.robber,target);assert.equal(game.players[0].commodities.paper,1);assert.equal(game.players[1].commodities.paper,0);
  }
  {
    const {game,player}=fixture();const victim=game.players[1],edgeKey=Object.keys(game.edges)[0];
    const [ownVertex,enemyVertex]=G.getEdgeVertices(...edgeKey.match(/-?\d+/g).map(Number));
    game.edges[edgeKey]={road:true,owner:0};
    game.citiesKnights.knights[CK.canonicalVertex(game,enemyVertex)]={ownerId:victim.id,strength:2,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
    play(game,player,'treason');resolve(game,victim.id);assert.equal(game.pendingChoice.actorId,victim.id);
    resolve(game,CK.canonicalVertex(game,enemyVertex));
    const placement=game.pendingChoice.options.find(option=>option.vertexKey===CK.canonicalVertex(game,ownVertex)&&option.strength===2);
    assert.ok(placement);resolve(game,placement.id);
    assert.equal(CK.knightAt(game,ownVertex).ownerId,player.id);assert.equal(CK.knightAt(game,ownVertex).active,true);
  }
  {
    const {game,player}=fixture();const card=game.citiesKnights.progressDecks.politics.find(value=>value.type==='constitution');
    game.citiesKnights.progressDecks.politics=game.citiesKnights.progressDecks.politics.filter(value=>value!==card);
    game.citiesKnights.progressDecks.politics.unshift(card);
    assert.equal(CK.drawProgress(game,player.id,'politics').success,true);
    assert.deepEqual(game.players[0].progressVictoryCards,[{type:'constitution',color:'politics'}]);
  }
});

test('knight movement displaces only weaker knights and foreign knights block route extension',()=>{
  const {game,player}=fixture();const enemy=game.players[1];
  const edgeKey=Object.keys(game.edges)[0], [a,b]=SF.edgeEndpoints(edgeKey);
  game.edges[edgeKey]={road:true,owner:0};player.roads--;
  const aKey=CK.canonicalVertex(game,a),bKey=CK.canonicalVertex(game,b);
  game.citiesKnights.knights[aKey]={ownerId:player.id,strength:2,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
  game.citiesKnights.knights[bKey]={ownerId:enemy.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
  give(game,player,{brick:1,lumber:1});
  const extension=G.getVertexEdges(b).find(key=>game.edges[key]&&SF.canonicalEdge(game,key)!==SF.canonicalEdge(game,edgeKey));
  assert.ok(extension);
  assert.equal(G.canPlaceRoad(game,player.id,extension).valid,false);
  const moved=A.executeAction(game,player.id,'moveKnight',{fromVertexKey:a,toVertexKey:b});
  assert.equal(moved.success,true,moved.error);
  assert.equal(game.pendingChoice.actorId,enemy.id);
  assert.equal(CK.knightAt(game,b).ownerId,player.id);
  resolve(game,'remove');
  assert.equal(CK.knightAt(game,a),null);
  assert.equal(CK.knightAt(game,b).active,false);
});

test('a displaced knight must retreat and may occupy the attacker’s vacated origin',()=>{
  const {game,player}=fixture(),enemy=game.players[1];
  const from=CK.canonicalVertex(game,G.vertexKey(0,0,0));
  const to=CK.canonicalVertex(game,G.vertexKey(0,0,3));
  for(let dir=0;dir<6;dir++) {
    const key=G.edgeKey(0,0,dir);
    assert.ok(game.edges[key]);
    game.edges[key]={road:true,owner:dir<3?0:1};
  }
  player.roads-=3;enemy.roads-=3;
  game.citiesKnights.knights[from]={ownerId:player.id,strength:2,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
  game.citiesKnights.knights[to]={ownerId:enemy.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
  const moved=A.executeAction(game,player.id,'moveKnight',{fromVertexKey:from,toVertexKey:to});
  assert.equal(moved.success,true,moved.error);
  assert.equal(game.pendingChoice.actorId,enemy.id);
  assert.ok(game.pendingChoice.options.some(option=>option.vertexKey===from));
  assert.equal(game.pendingChoice.options.some(option=>option.id==='remove'),false);
  resolve(game,from);
  assert.equal(CK.knightAt(game,from).ownerId,enemy.id);
  assert.equal(CK.knightAt(game,to).ownerId,player.id);
});

test('Intrigue requires a connected retreat and offers supply removal only when none exists',()=>{
  const {game,player}=fixture(),enemy=game.players[1];
  const vertexKey=CK.canonicalVertex(game,G.vertexKey(0,0,0));
  const incident=G.getVertexEdges(vertexKey).filter(key=>game.edges[key]);
  assert.ok(incident.length>=2);
  game.edges[incident[0]]={road:true,owner:0};player.roads--;
  game.edges[incident[1]]={road:true,owner:1};enemy.roads--;
  game.citiesKnights.knights[vertexKey]={ownerId:enemy.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
  play(game,player,'intrigue');resolve(game,vertexKey);
  assert.equal(game.pendingChoice.actorId,enemy.id);
  assert.equal(game.pendingChoice.options.some(option=>option.id==='remove'),false);
  const retreat=game.pendingChoice.options[0].vertexKey;
  assert.ok(retreat);
  resolve(game,retreat);
  assert.equal(CK.knightAt(game,retreat).ownerId,enemy.id);
});

test('metropolis race transfers at level five and then becomes permanent',()=>{
  const {game,player}=fixture();const rival=game.players[1],own=city(game,0),theirs=city(game,1);
  for(let level=1;level<=4;level++){
    give(game,game.players[0],{paper:level});
    assert.equal(A.executeAction(game,player.id,'improveCity',{track:'science',vertexKey:own}).success,true);
  }
  assert.equal(game.citiesKnights.metropolises.science.ownerId,player.id);
  game.currentPlayerIndex=1;
  for(let level=1;level<=5;level++){
    give(game,game.players[1],{paper:level});
    assert.equal(A.executeAction(game,rival.id,'improveCity',{track:'science',vertexKey:theirs}).success,true);
  }
  assert.equal(game.citiesKnights.metropolises.science.ownerId,rival.id);
  assert.equal(game.citiesKnights.metropolises.science.permanent,true);
  assert.equal(game.players[0].victoryPoints,2);
  assert.equal(game.players[1].victoryPoints,4);
  game.currentPlayerIndex=0;give(game,game.players[0],{paper:5});
  assert.equal(A.executeAction(game,player.id,'improveCity',{track:'science',vertexKey:own}).success,true);
  assert.equal(game.citiesKnights.metropolises.science.ownerId,rival.id);
});

test('off-turn progress hand-limit decision resolves before production, then Aqueduct chooses resource',()=>{
  {
    const {game,player}=fixture();const other=game.players[1];
    other.cityImprovements.science=1;
    for(const type of ['crane','engineering','irrigation','smithing'])putProgressInHand(game,other,type);
    const deck=game.citiesKnights.progressDecks.science,index=deck.findIndex(card=>card.type==='mining');
    deck.unshift(deck.splice(index,1)[0]);
    game.turnPhase='roll';
    const result=withRandom([0,0,0.51],()=>A.executeAction(game,player.id,'rollDice',{}));
    assert.equal(result.success,true,result.error);
    assert.equal(game.pendingChoice.kind,'discardProgress');assert.equal(game.pendingChoice.actorId,other.id);
    assert.equal(game.turnPhase,'roll');
    resolve(game,game.pendingChoice.options[0].id);
    assert.equal(game.turnPhase,'main');assert.equal(game.players[1].progressCards.length,4);
  }
  {
    const {game,player}=fixture();player.cityImprovements.science=3;game.turnPhase='roll';
    const result=withRandom([0,0,0.75],()=>A.executeAction(game,player.id,'rollDice',{}));
    assert.equal(result.success,true,result.error);
    assert.equal(game.pendingChoice.kind,'aqueduct');
    resolve(game,'ore');
    assert.equal(game.players[0].resources.ore,1);
    assert.equal(game.turnPhase,'main');
  }
});

test('a progress VP or Defender win during the event stops production and all later choices',()=>{
  for(const win of ['printing','defender']){
    const {game,player}=fixture();const producing=Object.values(game.hexes).find(hex=>hex.number===2&&hex.resource);
    assert.ok(producing);
    game.vertices[G.vertexKey(producing.q,producing.r,0)]={building:'city',owner:0};
    player.victoryPoints=12;game.turnPhase='roll';
    if(win==='printing'){
      player.cityImprovements.science=1;
      const deck=game.citiesKnights.progressDecks.science,index=deck.findIndex(card=>card.type==='printing');
      deck.unshift(deck.splice(index,1)[0]);
    }else{
      game.citiesKnights.barbarian.position=6;
      const key=Object.keys(game.vertices).find(vertex=>!game.vertices[vertex]?.building);
      game.citiesKnights.knights[CK.canonicalVertex(game,key)]={ownerId:player.id,strength:3,active:true,activatedTurn:-1,promotedTurn:null,actedTurn:null};
    }
    const before=game.players[0].resources[producing.resource];
    const result=withRandom([0,0,win==='printing'?0.51:0],()=>A.executeAction(game,player.id,'rollDice',{}));
    assert.equal(result.success,true,result.error);
    assert.equal(game.phase,'finished',win);
    assert.equal(game.players[0].resources[producing.resource],before,`${win}: production followed victory`);
    assert.equal(game.pendingChoice??null,null);
    assert.equal(game.citiesKnights.pendingRollTotal,null);
  }
});

test('CK legal action enumeration never samples randomness or changes a private deck',()=>{
  const {game,player}=fixture();city(game);give(game,player,{brick:3,lumber:3,wool:3,grain:3,ore:3,paper:2,coin:2,cloth:2});
  const before=structuredClone(game);
  const old=Math.random;Math.random=()=>{throw new Error('Legal actions sampled dice or decks');};
  try{assert.ok(A.legalActions(game,player.id).length>0);}finally{Math.random=old;}
  assert.deepEqual(game,before);
});

test('private trade ratios include unaffordable commodities and follow Trading House and Merchant Fleet',()=>{
  const {game,player}=fixture();
  const baseRatios=A.playerView(game,player.id).tradeRatios;
  assert.deepEqual(Object.keys(baseRatios),['brick','lumber','wool','grain','ore','paper','coin','cloth']);
  assert.deepEqual([baseRatios.paper,baseRatios.coin,baseRatios.cloth],[4,4,4]);
  assert.equal(player.commodities.paper,0);
  player.cityImprovements.trade=3;
  const tradingHouse=A.playerView(game,player.id).tradeRatios;
  assert.deepEqual([tradingHouse.paper,tradingHouse.coin,tradingHouse.cloth],[2,2,2]);
  assert.equal(A.legalActions(game,player.id).some(action=>action.type==='bankTrade'&&CK.COMMODITIES.includes(action.payload.giveResource)),false);
  player.cityImprovements.trade=0;
  play(game,player,'merchantFleet');resolve(game,'coin');
  const fleet=A.playerView(game,player.id).tradeRatios;
  assert.deepEqual([fleet.paper,fleet.coin,fleet.cloth],[4,2,4]);

  const base=G.createGame('base-ratios',{id:'host',name:'Host'});
  G.addPlayer(base,{id:'base-player',name:'Base'});
  assert.deepEqual(Object.keys(A.playerView(base,'base-player').tradeRatios),['brick','lumber','wool','grain','ore']);
});

test('a Seafarers gold choice queued during a CK choice resumes without leaking or stalling either queue',()=>{
  const game=G.createGame('ck-sea-queue',{id:'host',name:'Host'});
  for(let i=0;i<3;i++)G.addPlayer(game,{id:`p${i}`,name:`P${i}`});
  assert.equal(G.configureExpansions(game,{version:1,expansions:['seafarers','cities_knights'],scenario:'heading_for_new_shores',setup:{layout:'fixed',seed:42}}).success,true);
  G.startGame(game);game.phase='playing';game.turnPhase='main';game.currentPlayerIndex=0;
  const player=game.players[0];play(game,player,'merchantFleet');
  assert.equal(game.pendingChoice.kind,'card:merchantFleet');
  SF.queueGoldClaims(game,[{playerId:player.id,amount:1,hexKey:Object.keys(game.hexes).find(key=>game.hexes[key].terrain==='gold')}]);
  assert.equal(game.pendingChoice.kind,'card:merchantFleet');
  resolve(game,'paper');
  assert.equal(game.pendingChoice.kind,'goldResource');
  const gold=game.pendingChoice;
  assert.equal(A.executeAction(game,player.id,'resolveSeafarersChoice',{choiceId:gold.id,optionId:'brick'}).success,true);
  assert.equal(game.pendingChoice??null,null);
  assert.equal(game.players[0].resources.brick,1);
});

test('a ship cannot relocate away from a sea knight and leave it without an own route',()=>{
  const game=G.createGame('ck-sea-knight',{id:'host',name:'Host'});
  for(let i=0;i<3;i++)G.addPlayer(game,{id:`p${i}`,name:`P${i}`});
  assert.equal(G.configureExpansions(game,{expansions:['seafarers','cities_knights'],scenario:'heading_for_new_shores',setup:{layout:'fixed',seed:42}}).success,true);
  G.startGame(game);game.phase='playing';game.turnPhase='main';game.currentPlayerIndex=0;
  const player=game.players[0],home='v_0_-3_2',fromEdgeKey='e_0_-3_2',toEdgeKey='e_0_-2_0';
  game.vertices[home]={building:'settlement',owner:0};give(game,player,{lumber:1,wool:1});
  assert.equal(A.executeAction(game,player.id,'placeShip',{edgeKey:fromEdgeKey}).success,true);
  game.seafarers.builtShips=[];
  const seaVertex=SF.edgeEndpoints(fromEdgeKey).find(vertex=>!G.areVerticesEqual(vertex,home));
  game.citiesKnights.knights[CK.canonicalVertex(game,seaVertex)]={ownerId:player.id,strength:1,active:false,activatedTurn:null,promotedTurn:null,actedTurn:null};
  const before=structuredClone(game);
  const result=A.executeAction(game,player.id,'moveShip',{fromEdgeKey,toEdgeKey});
  assert.equal(result.success,false);
  assert.match(result.error,/disconnect your knight/);
  assert.deepEqual(game,before);
});
