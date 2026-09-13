import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardSnapshot, getBoardTransitions, motionDuration } from './boardMotion.js';

const vertex = (id, building = null, owner = null) => ({ id, vertex: { building, owner } });

test('first snapshot never reports confirmed board motion', () => {
  const current = createBoardSnapshot([{ id: 'road-a', owner: 0 }], [vertex('v-a', 'settlement', 0)], '0,0');
  const motion = getBoardTransitions(null, current);
  assert.equal(motion.roads.size, 0);
  assert.equal(motion.settlements.size, 0);
  assert.equal(motion.robber, false);
});

test('reports new physical pieces and settlement-to-city upgrades', () => {
  const previous = createBoardSnapshot([], [vertex('v-a', 'settlement', 0), vertex('v-b')], '0,0');
  const current = createBoardSnapshot(
    [{ id: 'road-a', owner: 1 }],
    [vertex('v-a', 'city', 0), vertex('v-b', 'settlement', 1)],
    '1,0'
  );
  const motion = getBoardTransitions(previous, current);
  assert.deepEqual([...motion.roads], ['road-a']);
  assert.deepEqual([...motion.settlements], ['v-b']);
  assert.deepEqual([...motion.cities], ['v-a']);
  assert.equal(motion.robber, true);
});

test('does not replay motion for unchanged snapshots', () => {
  const previous = createBoardSnapshot([{ id: 'road-a', owner: 0 }], [vertex('v-a', 'city', 0)], '1,0');
  const current = createBoardSnapshot([{ id: 'road-a', owner: 0 }], [vertex('v-a', 'city', 0)], '1,0');
  const motion = getBoardTransitions(previous, current);
  assert.equal(motion.roads.size + motion.settlements.size + motion.cities.size, 0);
  assert.equal(motion.robber, false);
});

test('scales and clamps motion duration', () => {
  assert.equal(motionDuration(2, 600), '300ms');
  assert.equal(motionDuration(0, 600), '600ms');
  assert.equal(motionDuration(99, 600), '75ms');
});

test('warship upgrade, fog reveal and pirate movement animate only after confirmation', () => {
  const before = createBoardSnapshot([{id:'ship-a',owner:0,ship:true}],[],null,{pirate:'frame:south',hexes:{'0,0':{terrain:'fog'}}});
  const after = createBoardSnapshot([{id:'ship-a',owner:0,ship:true,warship:true}],[],null,{pirate:'1,0',hexes:{'0,0':{terrain:'gold'}}});
  const motion=getBoardTransitions(before,after);
  assert.deepEqual([...motion.roads],['ship-a']);
  assert.deepEqual([...motion.revealed],['0,0']);
  assert.equal(motion.pirate,true);
  assert.equal(getBoardTransitions(null,after).pirate,false);
  assert.equal(getBoardTransitions(after,after).revealed.size,0);
});

test('scenario token transitions ignore repeated snapshots and detect changed cloth', () => {
  const state=cloth=>createBoardSnapshot([],[],null,{seafarers:{villages:[{id:0,cloth}]}});
  assert.equal(getBoardTransitions(state(5),state(5)).tokens,false);
  assert.equal(getBoardTransitions(state(5),state(4)).tokens,true);
  assert.equal(getBoardTransitions(null,state(4)).tokens,false);
});

test('a confirmed ship relocation retains its source-to-destination motion vector',()=>{
  const ship=(id,x)=>({id,owner:0,ship:true,warship:false,v1:{x,y:0},v2:{x:x+40,y:0}});
  const before=createBoardSnapshot([ship('old',0)],[],null);
  const after=createBoardSnapshot([ship('new',100)],[],null);
  assert.deepEqual(getBoardTransitions(before,after).shipMoves.get('new'),{x:-100,y:0});
  assert.equal(getBoardTransitions(null,after).shipMoves.size,0);
  assert.equal(getBoardTransitions(after,after).shipMoves.size,0);
});
