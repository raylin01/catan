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
