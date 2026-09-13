import test from 'node:test';
import assert from 'node:assert/strict';
import {ckTargetActions,ckPieceChanges,ckBoardActions,ckCommand,choiceForVariant,choiceVariants,vertexPoint,positionId} from './citiesKnightsView.js';

test('knight movement filters destinations by authoritative source and preserves theft variants',()=>{
  const actions=[{type:'moveKnight',payload:{fromVertexKey:'v_0_0_0',toVertexKey:'v_1_0_0'}},{type:'moveKnight',payload:{fromVertexKey:'v_0_0_1',toVertexKey:'v_0_1_0'}},{type:'driveRobber',payload:{vertexKey:'v_0_0_0',hexKey:'0,0',stealType:'cloth'}},{type:'driveRobber',payload:{vertexKey:'v_0_0_0',hexKey:'0,0',stealType:'resource'}}];
  assert.deepEqual(ckBoardActions(actions,'moveKnight','v_0_0_0'),[actions[0]]);
  assert.deepEqual(ckBoardActions(actions,'driveRobber','v_0_0_0'),actions.slice(2));
  assert.deepEqual(ckBoardActions(actions,'moveKnight','missing'),[]);
});
test('multi-variant progress choices keep physical placement explicit, including optional finish',()=>{
  const choice={id:'treason',options:[{id:'finish'},{id:'a1',vertexKey:'v_0_0_0',strength:1},{id:'a2',vertexKey:'v_0_0_0',strength:2},{id:'b2',vertexKey:'v_1_0_0',strength:2}]};
  assert.deepEqual(choiceVariants(choice),{field:'strength',values:['1','2']});
  assert.deepEqual(choiceForVariant(choice,'2').options.map(o=>o.id),['finish','a2','b2']);
  assert.deepEqual(choiceForVariant(choice,'stale').options.map(o=>o.id),['finish','a1']);
  assert.equal(choice.options.length,4);
});
test('CK transport keeps exact card bundles and never adds undefined optional fields',()=>{
  assert.deepEqual(ckCommand('resolveCitiesKnightsChoice',{choiceId:'offturn',cards:{paper:1,ore:1},ignored:true}),{type:'resolveCitiesKnightsChoice',payload:{choiceId:'offturn',cards:{paper:1,ore:1}}});
  assert.deepEqual(ckCommand('driveRobber',{vertexKey:'v_0_0_0',hexKey:'0,0',stealType:'cloth'}).payload,{vertexKey:'v_0_0_0',hexKey:'0,0',stealType:'cloth'});
  assert.equal(ckCommand('placeShip',{}),null);
});
test('canonical vertex geometry shares the established pointy board coordinate system',()=>{
  assert.equal(positionId(vertexPoint('v_0_0_0')),'0,-500');
  assert.equal(positionId(vertexPoint('v_0_0_1')),positionId(vertexPoint('v_1_-1_3')));
  assert.equal(vertexPoint('not-a-vertex'),null);
});

 test('confirmed knight moves animate from the old position while removals leave and hydration stays still',()=>{
 const knight={ownerId:'p0',strength:2,active:true};
 const before={knights:{v_0_0_0:knight,v_0_0_1:{ownerId:'p1',strength:1,active:false}},walls:{},metropolises:{},merchant:{hexKey:'0,0',ownerId:'p0'}};
 const after={...before,knights:{v_1_0_0:{...knight,active:false}},merchant:{hexKey:'1,0',ownerId:'p0'}};
 const delta=ckPieceChanges(before,after);
 assert.ok(delta.knights.v_1_0_0.x<0);assert.equal(delta.removed.length,1);assert.equal(delta.removed[0].knight.ownerId,'p1');assert.ok(delta.merchant.x<0);
 assert.deepEqual(ckPieceChanges(null,after).knights,{});assert.deepEqual(ckPieceChanges(after,structuredClone(after)).knights,{});
});

test('equivalent vertex aliases do not open a theft chooser for knight construction actions',()=>{
 const aliases=[{type:'activateKnight',payload:{vertexKey:'v_0_0_1'}},{type:'activateKnight',payload:{vertexKey:'v_1_-1_3'}}];
 assert.deepEqual(ckTargetActions(aliases,'activateKnight'),[aliases[0]]);
 const thefts=[{type:'driveRobber',payload:{vertexKey:'a',hexKey:'0,0',stealFromPlayerId:'p1',stealType:'cloth'}},{type:'driveRobber',payload:{vertexKey:'b',hexKey:'0,0',stealFromPlayerId:'p1',stealType:'cloth'}},{type:'driveRobber',payload:{vertexKey:'a',hexKey:'0,0',stealFromPlayerId:'p1',stealType:'resource'}}];
 assert.deepEqual(ckTargetActions(thefts,'driveRobber'),[thefts[0],thefts[2]]);
});

test('Treason placement choices collapse equivalent physical vertices after choosing strength',()=>{
 const choice={expansion:'cities_knights',options:[{id:'a1',vertexKey:'v_0_0_1',strength:1},{id:'b1',vertexKey:'v_1_-1_3',strength:1},{id:'a2',vertexKey:'v_0_0_1',strength:2}]};
 assert.deepEqual(choiceForVariant(choice,'1').options.map(o=>o.id),['a1']);assert.deepEqual(choiceForVariant(choice,'2').options.map(o=>o.id),['a2']);
});
