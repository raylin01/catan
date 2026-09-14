import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLACEMENT_CONFIRMATION_KEY, readPlacementConfirmation, stagePlacement, canConfirmPlacement, consumePlacement} from './placementConfirmation.js';

const road = {type:'placeRoad', payload:{edgeKey:'e_0_0_1'}};

test('confirmation is on for new browsers and unavailable storage; an explicit off choice persists', () => {
  const data = new Map();
  const storage = {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};
  assert.equal(readPlacementConfirmation(storage), true);
  storage.setItem(PLACEMENT_CONFIRMATION_KEY, 'off');
  assert.equal(readPlacementConfirmation(storage), false);
  storage.setItem(PLACEMENT_CONFIRMATION_KEY, 'on');
  assert.equal(readPlacementConfirmation(storage), true);
  assert.equal(readPlacementConfirmation({getItem() { throw Error('denied'); }}), true);
});

test('same-target rapid clicks stage once; confirmation consumes once', () => {
  const commit = () => {};
  const first = stagePlacement(null, road, 'seat-a:turn-1:road', commit);
  assert.equal(stagePlacement(first, {...road, payload:{...road.payload}}, first.context, commit), first);
  const sending = consumePlacement(first, first.context, [road], false);
  assert.equal(sending.status, 'sending');
  assert.equal(consumePlacement(sending, first.context, [road], false), null);
  assert.equal(stagePlacement(sending, road, first.context, commit), sending);
});

test('stale seat, turn, action or legal target and paused state cannot commit', () => {
  const pending = stagePlacement(null, road, 'seat-a:turn-1:road', () => {});
  assert.equal(canConfirmPlacement(pending, 'seat-b:turn-1:road', [road], false), false);
  assert.equal(canConfirmPlacement(pending, 'seat-a:turn-2:road', [road], false), false);
  assert.equal(canConfirmPlacement(pending, 'seat-a:turn-1:settlement', [road], false), false);
  assert.equal(canConfirmPlacement(pending, pending.context, [], false), false);
  assert.equal(canConfirmPlacement(pending, pending.context, [road], true), false);
  assert.equal(consumePlacement(null, pending.context, [road], false), null); // Cancel / Escape.
});
