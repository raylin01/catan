import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createObservationBoundary, isOlderObservation} from './observationBoundary.js';

test('continuous observations animate normally; recovery establishes one new baseline', () => {
  const boundary = createObservationBoundary();
  const initial = boundary.accept(0);
  assert.equal(boundary.accept(1000), initial);
  boundary.interrupt();
  boundary.interrupt();
  assert.equal(boundary.accept(2000), initial + 1);
  assert.equal(boundary.accept(3000), initial + 1);
});

test('a suspended tab or slow request establishes a new baseline without a network error', () => {
  const boundary = createObservationBoundary();
  const initial = boundary.accept(1000);
  assert.equal(boundary.accept(61000), initial + 1);
  assert.equal(boundary.accept(62000), initial + 1);
});

test('late observations cannot rewind a match; equal revisions still update presence', () => {
  const current = {code:'ROOM', replayId:'match', revision:12, role:'player', seatId:'one', generation:1};
  assert.equal(isOlderObservation(current, {...current, revision:11}), true);
  assert.equal(isOlderObservation(current, {...current, revision:12}), false);
  assert.equal(isOlderObservation(current, {...current, revision:13}), false);
  assert.equal(isOlderObservation(current, {...current, replayId:'new-match', revision:0}), false);
  assert.equal(isOlderObservation(current, {...current, generation:2, revision:0}), false);
});
