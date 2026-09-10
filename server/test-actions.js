import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import {executeAction,legalActions,playerView} from './actions.js';

function setup() {
  const game=G.createGame('TEST',{id:'a',name:'Alice'});
  G.addPlayer(game,{id:'b',name:'Bob'}); G.addPlayer(game,{id:'c',name:'Carol'});
  G.startGame(game); return game;
}
test('setup requires one settlement and its road, and rejects out-of-turn and premature advance',()=>{
  const game=setup(), current=game.players[game.currentPlayerIndex].id;
  const other=game.players.find(p=>p.id!==current).id;
  const before=structuredClone(game);
  assert.equal(executeAction(game,current,'advanceSetup').success,false);
  const settlement=legalActions(game,current).find(a=>a.type==='placeSettlement');
  assert.ok(settlement);
  assert.equal(executeAction(game,other,settlement.type,settlement.payload).success,false);
  assert.deepEqual(game,before);
  assert.equal(executeAction(game,current,settlement.type,settlement.payload).success,true);
  assert.equal(executeAction(game,current,'advanceSetup').success,false);
  const road=legalActions(game,current).find(a=>a.type==='placeRoad');
  assert.ok(road);
  assert.equal(executeAction(game,current,'placeRoad',{...road.payload,isSetup:false,lastSettlement:'forged'}).success,true);
  assert.equal(executeAction(game,current,'advanceSetup').success,true);
});
test('complete snake setup produces exactly two settlements and two roads per seat',()=>{
  const game=setup();
  for(let round=0;round<6;round++) {
    const id=game.players[game.currentPlayerIndex].id;
    for(const type of ['placeSettlement','placeRoad','advanceSetup']) {
      const a=legalActions(game,id).find(a=>a.type===type);
      assert.ok(a,type); assert.equal(executeAction(game,id,type,a.payload).success,true);
    }
  }
  assert.equal(game.phase,'playing');
  for(const p of game.players) {assert.equal(p.settlements,3);assert.equal(p.roads,13);}
});
test('wrong-phase actions and malformed coordinates leave state unchanged',()=>{
  const game=setup(), id=game.players[game.currentPlayerIndex].id;
  const before=structuredClone(game);
  for(const [type,payload] of [['rollDice',{}],['placeSettlement',{vertexKey:'v_999_999_0'}],['placeRoad',{edgeKey:null}],['discardCards',{resources:{brick:-1}}]]) {
    assert.equal(executeAction(game,id,type,payload).success,false); assert.deepEqual(game,before);
  }
});
test('spectators cannot see private cards even after a game ends',()=>{
  const game=setup();game.phase='finished';game.players[0].resources.ore=7;game.players[0].developmentCards=['monopoly'];
  const view=playerView(game,null);
  assert.equal(typeof view.players[0].resources,'number');
  assert.equal(view.players[0].developmentCards,1);assert.equal(view.myIndex,-1);
});
test('robber card choice is the only legal pending action and its mapping is not projected',()=>{
  const game=setup();game.phase='playing';game.turnPhase='robber';game.currentPlayerIndex=0;game.hasRolledThisTurn=true;
  const thiefId=game.players[0].id,victimId=game.players[1].id;
  const hexKey=Object.keys(game.hexes).find(key=>key!==game.robber),hex=game.hexes[hexKey];
  game.vertices[G.vertexKey(hex.q,hex.r,0)]={building:'settlement',owner:1};
  game.players[1].resources.brick=2;game.players[1].resources.ore=1;
  assert.equal(executeAction(game,thiefId,'moveRobber',{hexKey,stealFromPlayerId:victimId}).success,true);
  assert.equal(game.turnPhase,'robberPick');
  const choices=legalActions(game,thiefId);
  assert.equal(choices.length,3);assert.ok(choices.every(action=>action.type==='chooseRobberCard'));
  assert.equal(Object.hasOwn(playerView(game,thiefId),'pendingRobberPick'),false);
  assert.equal(Object.hasOwn(playerView(game,victimId),'pendingRobberPick'),false);
  const before=structuredClone(game);
  assert.equal(executeAction(game,thiefId,'endTurn').success,false);assert.deepEqual(game,before);
  assert.equal(executeAction(game,thiefId,'chooseRobberCard',choices[0].payload).success,true);
  assert.equal(game.turnPhase,'main');assert.equal(game.pendingRobberPick,null);
});
