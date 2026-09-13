export const CHARTS = {
  vp: { label: 'Victory points', publicKey: 'publicVP', privateKey: 'totalVP', suffix: 'VP' },
  roads: { label: 'Roads', publicKey: 'roads', suffix: 'roads' }
};
export const CHART_SIZE = { width: 760, height: 280, left: 36, right: 24, top: 22, bottom: 36 };

export function chartValue(player, definition) {
  if (definition.privateKey && Number.isFinite(player?.[definition.privateKey])) return player[definition.privateKey];
  return Number(player?.[definition.publicKey]) || 0;
}

// Last fact at or before the cursor. Sequence lookup preserves individual
// events that share a timestamp; time lookup selects the last of those events.
export function chartPointAt(points, value, key = 'elapsedMs') {
  let low = 0, high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (Number(points[mid][key]) <= value) low = mid + 1;
    else high = mid;
  }
  return points[low - 1] || null;
}

export function buildChart(points, players, definition, size = CHART_SIZE) {
  const {width, height, left, right, top, bottom} = size;
  let maxTime = 1, maxValue = 1;
  for (const point of points) {
    maxTime = Math.max(maxTime, Number(point.elapsedMs) || 0);
    for (const player of point.players || []) maxValue = Math.max(maxValue, chartValue(player, definition));
  }
  const step = Math.max(1, Math.ceil(maxValue / 5));
  const ceiling = Math.ceil(maxValue / step) * step;
  const ticks = Array.from({length: ceiling / step + 1}, (_, i) => i * step);
  const x = time => left + Math.max(0, Math.min(maxTime, time)) / maxTime * (width - left - right);
  const y = value => height - bottom - value / ceiling * (height - top - bottom);
  const lines = players.map(player => {
    let previous;
    const changes = [];
    for (const point of points) {
      const value = chartValue(point.players?.find(p => p.id === player.id), definition);
      if (value !== previous) changes.push({time: Number(point.elapsedMs) || 0, value});
      previous = value;
    }
    // Steps change only at recorded events, never between them.
    let path = `M${x(0)},${y(0)}`;
    for (const change of changes) path += `H${x(change.time)}V${y(change.value)}`;
    path += `H${x(maxTime)}`;
    return {player, path};
  });
  return {maxTime, ceiling, ticks, x, y, lines};
}
