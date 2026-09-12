const IDLE_GRACE_MS = 1200;
const eventOrderCache = new WeakMap();

const finiteMs = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const finiteSeq = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

function orderedEvents(events = []) {
  if (eventOrderCache.has(events)) return eventOrderCache.get(events);
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timeDifference = finiteMs(left.event?.elapsedMs) - finiteMs(right.event?.elapsedMs);
      if (timeDifference) return timeDifference;
      const sequenceDifference = finiteSeq(left.event?.seq) - finiteSeq(right.event?.seq);
      return sequenceDifference || left.index - right.index;
    })
    .map(({ event }) => event);
  eventOrderCache.set(events, ordered);
  return ordered;
}

function orderedMetrics(metrics = []) {
  return metrics
    .map((point, index) => ({ point, index }))
    .sort((left, right) => {
      const timeDifference = finiteMs(left.point?.elapsedMs) - finiteMs(right.point?.elapsedMs);
      if (timeDifference) return timeDifference;
      const sequenceDifference = finiteSeq(left.point?.seq) - finiteSeq(right.point?.seq);
      return sequenceDifference || left.index - right.index;
    })
    .map(({ point }) => point);
}

function playerLookup(players = []) {
  return new Map(players.map((player, index) => [player?.id, {
    ...player,
    name: player?.name || `Player ${index + 1}`,
    color: player?.color || ['#d96855', '#4f94b5', '#dc9b51', '#63a892'][index % 4]
  }]));
}

function playerName(playersById, playerId) {
  return playersById.get(playerId)?.name || 'Unknown player';
}

function markerColor(playersById, playerId) {
  return playersById.get(playerId)?.color;
}

export function eventAtTime(events, timeMs) {
  const target = finiteMs(timeMs);
  const ordered = orderedEvents(events || []);
  let low = 0;
  let high = ordered.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (finiteMs(ordered[middle]?.elapsedMs) <= target) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? ordered[low - 1] : null;
}

export function timeForSeq(events, seq) {
  const target = finiteSeq(seq);
  const match = (events || []).find(event => finiteSeq(event?.seq) === target);
  return match ? finiteMs(match.elapsedMs) : 0;
}

export function advanceReplayTime({
  timeMs = 0,
  deltaMs = 0,
  speed = 1,
  durationMs = 0,
  events = [],
  skipIdle = false
} = {}) {
  const duration = finiteMs(durationMs);
  let current = Math.min(duration, finiteMs(timeMs));
  let remaining = Math.max(0, finiteMs(deltaMs) * Math.max(0, Number(speed) || 0));
  if (!remaining || current >= duration) return current;
  if (!skipIdle) return Math.min(duration, current + remaining);

  const ordered = orderedEvents(events);
  let cursor = 0;
  while (cursor < ordered.length && finiteMs(ordered[cursor]?.elapsedMs) <= current) cursor += 1;

  while (remaining > 0 && current < duration) {
    while (cursor < ordered.length && finiteMs(ordered[cursor]?.elapsedMs) <= current) cursor += 1;
    if (cursor >= ordered.length) return Math.min(duration, current + remaining);
    const nextEventTime = finiteMs(ordered[cursor]?.elapsedMs);
    if (nextEventTime <= current) {
      cursor += 1;
      continue;
    }

    const previousEventTime = cursor > 0 ? finiteMs(ordered[cursor - 1]?.elapsedMs) : 0;
    const idleDeadline = Math.min(nextEventTime, previousEventTime + IDLE_GRACE_MS);
    const visibleWait = Math.max(0, idleDeadline - current);
    if (remaining < visibleWait) return Math.min(duration, current + remaining);

    remaining -= visibleWait;
    current = nextEventTime;
    while (cursor < ordered.length && finiteMs(ordered[cursor]?.elapsedMs) <= current) cursor += 1;
  }

  return Math.min(duration, current + remaining);
}

function vpValue(metricPlayer) {
  if (Number.isFinite(metricPlayer?.totalVP)) return { value: Number(metricPlayer.totalVP), privateTotal: true };
  if (Number.isFinite(metricPlayer?.publicVP)) return { value: Number(metricPlayer.publicVP), privateTotal: false };
  return null;
}

function makeMarker({ type, point, event, label, playerId, playersById, suffix = '' }) {
  const seq = finiteSeq(point?.seq ?? event?.seq);
  const timeMs = finiteMs(point?.elapsedMs ?? event?.elapsedMs);
  return {
    id: `${type}:${seq}:${playerId || 'table'}${suffix}`,
    seq,
    timeMs,
    type,
    label,
    playerId: playerId || null,
    color: markerColor(playersById, playerId) || null
  };
}

function awardMarkers(points, key, type, title, playersById) {
  const markers = [];
  let hasPrior = false;
  let holder = null;
  for (const point of points) {
    if (!Object.prototype.hasOwnProperty.call(point || {}, key)) continue;
    const nextHolder = point[key] || null;
    if (!hasPrior) {
      hasPrior = true;
      holder = nextHolder;
      if (!nextHolder || finiteSeq(point?.seq) === 0) continue;
    } else if (nextHolder === holder) {
      continue;
    } else {
      holder = nextHolder;
    }

    const label = nextHolder
      ? `${playerName(playersById, nextHolder)} claimed ${title}`
      : `${title} returned to the table`;
    markers.push(makeMarker({ type, point, label, playerId: nextHolder, playersById }));
  }
  return markers;
}

export function buildTimelineMarkers(events = [], metrics = [], players = []) {
  const playersById = playerLookup(players);
  const points = orderedMetrics(metrics);
  const markers = [];
  const previousVp = new Map();
  let lastTurnIdentity = null;
  let knownWinnerId = null;

  for (const point of points) {
    for (const metricPlayer of point?.players || []) {
      if (!metricPlayer?.id) continue;
      const current = vpValue(metricPlayer);
      const previous = previousVp.get(metricPlayer.id);
      if (current && previous && current.privateTotal === previous.privateTotal && current.value > previous.value) {
        const delta = current.value - previous.value;
        markers.push(makeMarker({
          type: 'victory-point',
          point,
          label: `${playerName(playersById, metricPlayer.id)} gained ${delta} victory ${delta === 1 ? 'point' : 'points'}`,
          playerId: metricPlayer.id,
          playersById
        }));
      }
      if (current) previousVp.set(metricPlayer.id, current);
    }

    const setup = point?.phase === 'setup' || String(point?.turnPhase || '').toLowerCase().includes('setup');
    const turnIdentity = point?.currentPlayerId
      ? `player:${point.currentPlayerId}:${setup ? 'setup' : `turn:${point.turn ?? 'unknown'}`}`
      : point?.turn != null ? `turn:${point.turn}` : null;
    if (turnIdentity && turnIdentity !== lastTurnIdentity) {
      lastTurnIdentity = turnIdentity;
      const name = point.currentPlayerId ? playerName(playersById, point.currentPlayerId) : null;
      const displayTurn = Number.isFinite(Number(point?.turn)) ? Number(point.turn) + 1 : null;
      markers.push(makeMarker({
        type: 'turn',
        point,
        label: setup
          ? `${name || 'Table'} began setup`
          : name ? `${name} began turn ${displayTurn ?? ''}`.trim() : `Turn ${displayTurn} began`,
        playerId: point.currentPlayerId,
        playersById
      }));
    }

    if (Object.prototype.hasOwnProperty.call(point || {}, 'winnerId')) {
      const winnerId = point.winnerId || null;
      if (winnerId && winnerId !== knownWinnerId) {
        markers.push(makeMarker({
          type: 'win',
          point,
          label: `${playerName(playersById, winnerId)} won the match`,
          playerId: winnerId,
          playersById
        }));
      }
      knownWinnerId = winnerId;
    }
  }

  markers.push(
    ...awardMarkers(points, 'longestRoadPlayerId', 'longest-road', 'Longest Road', playersById),
    ...awardMarkers(points, 'largestArmyPlayerId', 'largest-army', 'Largest Army', playersById)
  );

  for (const event of orderedEvents(events)) {
    const type = String(event?.type || '');
    const normalized = type.toLowerCase();
    if (normalized.includes('robber')) {
      markers.push(makeMarker({
        type: 'robber',
        event,
        label: event.summary || `${event.actorName || 'A player'} resolved the robber`,
        playerId: event.actorSeatId,
        playersById
      }));
    }
    const isWin = ['win', 'gamewon', 'victory'].includes(normalized);
    if (isWin && !markers.some(marker => marker.type === 'win' && marker.seq === finiteSeq(event?.seq))) {
      const winnerId = event?.payload?.winnerId || event?.winnerId || event?.actorSeatId || null;
      markers.push(makeMarker({
        type: 'win',
        event,
        label: event.summary || `${playerName(playersById, winnerId)} won the match`,
        playerId: winnerId,
        playersById
      }));
    }
  }

  const seen = new Set();
  return markers
    .sort((left, right) => left.timeMs - right.timeMs || left.seq - right.seq || left.id.localeCompare(right.id))
    .filter(marker => {
      const key = `${marker.type}:${marker.seq}:${marker.playerId || ''}:${marker.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function groupTimelineMarkers(markers = [], durationMs = 0, { bucketCount = 56 } = {}) {
  const duration = Math.max(1, finiteMs(durationMs));
  const count = Math.max(1, Math.floor(Number(bucketCount) || 1));
  const buckets = new Map();
  for (const marker of [...markers].sort((left, right) => left.timeMs - right.timeMs || left.seq - right.seq || left.id.localeCompare(right.id))) {
    const position = Math.min(1, finiteMs(marker.timeMs) / duration);
    const bucket = Math.min(count - 1, Math.floor(position * count));
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(marker);
  }
  return [...buckets.entries()].map(([bucket, bucketMarkers]) => ({
    id: `marker-group-${bucket}-${bucketMarkers[0].id}`,
    timeMs: bucketMarkers[0].timeMs,
    position: ((bucket + 0.5) / count) * 100,
    label: bucketMarkers.length === 1 ? bucketMarkers[0].label : `${bucketMarkers.length} moments`,
    markers: bucketMarkers
  }));
}

export function buildTurnBands(metrics = [], players = [], durationMs = 0) {
  const duration = finiteMs(durationMs);
  const playersById = playerLookup(players);
  const points = orderedMetrics(metrics);
  const starts = [];
  for (const point of points) {
    if (!point?.currentPlayerId) continue;
    const setup = point?.phase === 'setup' || String(point?.turnPhase || '').toLowerCase().includes('setup');
    const identity = `${point.currentPlayerId}:${setup ? 'setup' : `turn:${point.turn ?? 'unknown'}`}`;
    const previous = starts[starts.length - 1];
    if (previous?.identity === identity) continue;
    starts.push({
      seq: finiteSeq(point.seq),
      startMs: Math.min(duration, finiteMs(point.elapsedMs)),
      playerId: point.currentPlayerId,
      turn: point.turn,
      identity
    });
  }
  return starts.map((start, index) => {
    const endMs = Math.max(start.startMs, starts[index + 1]?.startMs ?? duration);
    const name = playerName(playersById, start.playerId);
    const point = points.find(candidate => finiteSeq(candidate?.seq) === start.seq);
    const setup = point?.phase === 'setup' || String(point?.turnPhase || '').toLowerCase().includes('setup');
    const displayTurn = Number.isFinite(Number(start.turn)) ? Number(start.turn) + 1 : null;
    return {
      id: `turn-band-${start.seq}-${start.playerId}`,
      seq: start.seq,
      startMs: start.startMs,
      playerId: start.playerId,
      turn: start.turn,
      endMs,
      color: markerColor(playersById, start.playerId) || null,
      label: `${name} · ${setup ? 'Setup' : displayTurn == null ? 'Turn' : `Turn ${displayTurn}`}`
    };
  });
}
