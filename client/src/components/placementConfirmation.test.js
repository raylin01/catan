import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLACEMENT_CONFIRMATION_KEY, ROBBER_CONFIRMATION_KEY, readPlacementConfirmation, readRobberConfirmation, shouldConfirmAction, stagePlacement, canConfirmPlacement, consumePlacement} from './placementConfirmation.js';

const road = {type:'placeRoad', payload:{edgeKey:'e_0_0_1'}};

test('placement and robber preferences default on independently; legacy placement off stays scoped to placements', () => {
  const data = new Map();
  const storage = {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};
  assert.equal(readPlacementConfirmation(storage), true);
  assert.equal(readRobberConfirmation(storage), true);
  storage.setItem(PLACEMENT_CONFIRMATION_KEY, 'off');
  assert.equal(readPlacementConfirmation(storage), false);
  assert.equal(readRobberConfirmation(storage), true);
  storage.setItem(ROBBER_CONFIRMATION_KEY, 'off');
  assert.equal(readRobberConfirmation(storage), false);
  storage.setItem(PLACEMENT_CONFIRMATION_KEY, 'on');
  assert.equal(readPlacementConfirmation(storage), true);
  assert.equal(readPlacementConfirmation({getItem() { throw Error('denied'); }}), true);
  assert.equal(readRobberConfirmation({getItem() { throw Error('denied'); }}), true);
});

test('action routing separates robber and pirate from buildings and routes', () => {
  const preferences = {confirmPlacements:false, confirmRobber:true};
  for (const type of ['placeSettlement','placeRoad','upgradeToCity','placeShip','moveShip','placePort']) {
    assert.equal(shouldConfirmAction(type, preferences), false, type);
    assert.equal(shouldConfirmAction(type, {...preferences, confirmPlacements:true}), true, type);
  }
  for (const type of ['moveRobber','movePirate','driveRobber']) {
    assert.equal(shouldConfirmAction(type, preferences), true, type);
    assert.equal(shouldConfirmAction(type, {...preferences, confirmRobber:false}), false, type);
  }
  assert.equal(shouldConfirmAction('bankTrade', {confirmPlacements:true, confirmRobber:true}), false);
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
