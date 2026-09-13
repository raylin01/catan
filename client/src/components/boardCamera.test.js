import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainCamera, FIT_CAMERA, pointerGesture, wheelZoomFactor, zoomCamera} from './boardCamera.js';
const size = {width: 800, height: 600};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('zoom keeps the board location under an off-center pointer fixed', () => {
  const before = {scale: 1.3, x: 30, y: -20}, point = {x: 150, y: -90};
  const after = zoomCamera(before, 2.2, point, size);
  near((point.x - before.x) / before.scale, (point.x - after.x) / after.scale);
  near((point.y - before.y) / before.scale, (point.y - after.y) / after.scale);
});
test('pinch follows both the distance and the moving midpoint without jumping', () => {
  const start = pointerGesture([{x: -100, y: 0}, {x: 100, y: 0}]);
  const end = pointerGesture([{x: -150, y: 40}, {x: 250, y: 40}]);
  const next = zoomCamera(FIT_CAMERA, end.distance / start.distance, start.point, size, end.point);
  assert.deepEqual(next, {scale: 2, x: 50, y: 40});
  assert.deepEqual(pointerGesture([{x: 40, y: 20}]), {point: {x: 40, y: 20}, distance: 0});
});
test('zoom and pan stay bounded, including after the viewport shrinks', () => {
  assert.deepEqual(constrainCamera({scale: 12, x: 100000, y: -100000}, size), {scale: 3, x: 960, y: -720});
  assert.deepEqual(constrainCamera({scale: .01, x: 0, y: 0}, size), FIT_CAMERA);
  const resized = constrainCamera({scale: 2, x: 500, y: -400}, {width: 300, height: 200});
  assert.deepEqual(resized, {scale: 2, x: 210, y: -140});
  const atLimit = zoomCamera({scale: 3, x: 20, y: 10}, 6, {x: 100, y: 100}, size);
  assert.deepEqual(atLimit, {scale: 3, x: 20, y: 10});
});
test('wheel units normalize and extreme deltas cannot jump from fit to maximum', () => {
  near(wheelZoomFactor(1, 1, 600), wheelZoomFactor(16, 0, 600));
  near(wheelZoomFactor(.1, 2, 600), wheelZoomFactor(60, 0, 600));
  assert.ok(wheelZoomFactor(-100000, 0, 600) < 2);
  near(wheelZoomFactor(30, 0, 600) * wheelZoomFactor(-30, 0, 600), 1);
});
