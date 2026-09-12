export const FIT_CAMERA = Object.freeze({scale: 1, x: 0, y: 0});
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function constrainCamera(camera, size) {
  const scale = clamp(camera.scale, MIN_ZOOM, MAX_ZOOM);
  // Keep some of the island in reach even after a long drag.
  const limitX = size.width * ((scale - 1) / 2 + .2);
  const limitY = size.height * ((scale - 1) / 2 + .2);
  return {scale, x: clamp(camera.x, -limitX, limitX), y: clamp(camera.y, -limitY, limitY)};
}

// Points are relative to the viewport center. Preserve the board location
// under the pointer (or moving pinch midpoint) as the scale changes.
export function zoomCamera(camera, scale, point, size, destination = point) {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / camera.scale;
  return constrainCamera({scale: next, x: destination.x - (point.x - camera.x) * ratio,
    y: destination.y - (point.y - camera.y) * ratio}, size);
}

export function wheelZoomFactor(delta, mode, height) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.exp(-clamp(pixels, -160, 160) * .003);
}

export function pointerGesture(points) {
  const [a, b] = points;
  if (!b) return {point: a, distance: 0};
  return {point: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, distance: Math.hypot(a.x - b.x, a.y - b.y)};
}
