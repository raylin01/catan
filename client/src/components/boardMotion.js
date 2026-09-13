export function createBoardSnapshot(roads, vertices, robber, {pirate,hexes={},seafarers,ports=[]}={}) {
  return {
    roads: new Map(roads.map(road => [road.id, `${road.owner}:${road.ship ? road.warship ? 'warship' : 'ship' : 'road'}`])),
    routes: new Map(roads.map(road=>[road.id,road])),
    buildings: new Map(
      vertices
        .filter(({ vertex }) => vertex.building)
        .map(({ id, vertex }) => [id, `${vertex.building}:${vertex.owner}`])
    ),
    robber: robber || null,
    pirate: pirate || null,
    terrain: new Map(Object.entries(hexes).map(([key,hex])=>[key,hex.terrain])),
    tokens: JSON.stringify([seafarers?.villages,seafarers?.fortresses,seafarers?.wonders,seafarers?.rewards,seafarers?.collectiblePorts,seafarers?.bonusSettlements,ports])
  };
}

export function getBoardTransitions(previous, current) {
  const roads = new Set();
  const settlements = new Set();
  const cities = new Set();
  const revealed = new Set();
  const shipMoves = new Map();

  if (!previous) return { roads, settlements, cities, revealed, shipMoves, robber: false, pirate:false, tokens:false };

  current.roads.forEach((owner, id) => {
    if (!previous.roads.has(id) || previous.roads.get(id) !== owner) roads.add(id);
  });

  current.buildings.forEach((building, id) => {
    const before = previous.buildings.get(id);
    if (building.startsWith('settlement:') && before !== building) settlements.add(id);
    if (building.startsWith('city:') && before !== building) cities.add(id);
  });

  const departed=[...(previous.routes?.values()||[])].filter(route=>route.ship && !current.routes?.has(route.id));
  for (const [id,route] of current.routes || []) {
    if(!route.ship || previous.routes?.has(id) || !route.v1 || !route.v2)continue;
    const source=departed.find(old=>old.owner===route.owner && old.warship===route.warship && old.v1 && old.v2);
    if(source){shipMoves.set(id,{x:(source.v1.x+source.v2.x-route.v1.x-route.v2.x)/2,y:(source.v1.y+source.v2.y-route.v1.y-route.v2.y)/2});departed.splice(departed.indexOf(source),1);}
  }
  current.terrain?.forEach((terrain,key)=>{if(previous.terrain?.get(key)==='fog' && terrain!=='fog')revealed.add(key);});

  return {
    revealed,
    shipMoves,
    pirate: previous.pirate !== current.pirate,
    tokens: previous.tokens !== current.tokens,
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
