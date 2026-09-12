export function createBoardSnapshot(roads, vertices, robber) {
  return {
    roads: new Map(roads.map(road => [road.id, road.owner])),
    buildings: new Map(
      vertices
        .filter(({ vertex }) => vertex.building)
        .map(({ id, vertex }) => [id, `${vertex.building}:${vertex.owner}`])
    ),
    robber: robber || null
  };
}

export function getBoardTransitions(previous, current) {
  const roads = new Set();
  const settlements = new Set();
  const cities = new Set();

  if (!previous) return { roads, settlements, cities, robber: false };

  current.roads.forEach((owner, id) => {
    if (!previous.roads.has(id) || previous.roads.get(id) !== owner) roads.add(id);
  });

  current.buildings.forEach((building, id) => {
    const before = previous.buildings.get(id);
    if (building.startsWith('settlement:') && before !== building) settlements.add(id);
    if (building.startsWith('city:') && before !== building) cities.add(id);
  });

  return {
    roads,
    settlements,
    cities,
    robber: Boolean(previous.robber && current.robber && previous.robber !== current.robber)
  };
}

export function motionDuration(playbackRate, baseMilliseconds) {
  const rate = Number(playbackRate);
  const safeRate = Number.isFinite(rate) && rate > 0 ? Math.min(Math.max(rate, 0.25), 8) : 1;
  return `${Math.round(baseMilliseconds / safeRate)}ms`;
}
