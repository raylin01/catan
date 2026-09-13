import test from 'node:test';
import assert from 'node:assert/strict';
import {framePoint,pendingChoiceStatus,scenarioObjective,shipTargets} from './seafarersView.js';
import {seafarersCommand} from './seafarersCommands.js';

test('off-turn choice instructions identify the authoritative actor',()=>{
  const game={currentPlayerIndex:0,players:[{id:'roller',name:'Rowan'},{id:'gold',name:'Sage'}],pendingChoice:{actorId:'gold',label:'Choose a gold resource'}};
  assert.equal(pendingChoiceStatus(game,'roller'),'Sage: Choose a gold resource');
  assert.equal(pendingChoiceStatus(game,'gold'),'Choose a gold resource');
});
test('ship relocation destinations stay tied to the chosen authoritative source',()=>{
  const actions=[{type:'moveShip',payload:{fromEdgeKey:'a',toEdgeKey:'c'}},{type:'moveShip',payload:{fromEdgeKey:'b',toEdgeKey:'d'}},{type:'placeShip',payload:{edgeKey:'e'}}];
  assert.deepEqual(shipTargets(actions,'a'),[actions[0]]);
  assert.deepEqual(shipTargets(actions,'unknown'),[]);
});
test('frame destinations follow asymmetric board bounds',()=>{
  const bounds={minX:-400,maxX:800,minY:-300,maxY:150};
  assert.deepEqual(framePoint('frame:north',bounds),{x:200,y:-325});
  assert.deepEqual(framePoint('frame:east',bounds),{x:825,y:-75});
});
test('scenario objectives preserve conjunctive and alternate victory conditions',()=>{
  const game=scenario=>({seafarers:{scenario,goal:10}});
  assert.match(scenarioObjective(game('the_pirate_islands')),/and recapture your fortress/);
  assert.match(scenarioObjective(game('the_wonders_of_catan')),/strictly ahead of every opponent/);
  assert.match(scenarioObjective(game('cloth_for_catan')),/5 villages empty.*cloth breaks ties/);
});
test('room adapter preserves ship moves, frame movement, and cloth theft without extra fields',()=>{
  assert.deepEqual(seafarersCommand('moveShip',{fromEdgeKey:'a',toEdgeKey:'b',ownerId:'forged'}),{type:'moveShip',payload:{fromEdgeKey:'a',toEdgeKey:'b'}});
  assert.deepEqual(seafarersCommand('movePirate',{hexKey:'frame:north'}),{type:'movePirate',payload:{hexKey:'frame:north'}});
  assert.deepEqual(seafarersCommand('movePirate',{hexKey:'1,1',stealFromPlayerId:'p1',stealType:'cloth'}).payload,{hexKey:'1,1',stealFromPlayerId:'p1',stealType:'cloth'});
  assert.deepEqual(seafarersCommand('attackFortress',{skipEndTurn:true}),{type:'attackFortress',payload:{}});
  assert.equal(seafarersCommand('inventAction',{}),null);
});
