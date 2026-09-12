// A recovered snapshot is a baseline, not a queue of missed animations.
export function createObservationBoundary(maxGapMs = 10000) {
  let lastSuccess = null;
  let interrupted = true;
  let epoch = 0;
  return {
    interrupt() { interrupted = true; },
    accept(now = Date.now()) {
      if (interrupted || (lastSuccess !== null && now - lastSuccess > maxGapMs)) epoch++;
      interrupted = false;
      lastSuccess = now;
      return epoch;
    }
  };
}

// Presence can change at the same revision, but game state must not go backwards.
export function isOlderObservation(current, next) {
  return current?.code === next?.code && current?.replayId === next?.replayId &&
    current?.role === next?.role && current?.seatId === next?.seatId &&
    current?.generation === next?.generation &&
    Number.isFinite(current?.revision) && Number.isFinite(next?.revision) &&
    next.revision < current.revision;
}
