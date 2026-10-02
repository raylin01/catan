import * as G from './gameLogic.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const uniqueSorted = values => [...new Set(values)].sort(compare);
const position = (key, prefix) => {
  const match = new RegExp(`^${prefix}_(-?\\d+)_(-?\\d+)_([0-5])$`).exec(key);
  if (!match) throw new TypeError(`Invalid ${prefix === 'v' ? 'vertex' : 'edge'} key`);
  return match.slice(1).map(Number);
};

function locations(prefix, equivalents, makeKey) {
  const groups = new Map();
  return {
    add(key) {
      const aliases = equivalents(...position(key, prefix)).map(({ q, r, dir }) => makeKey(q, r, dir)).sort(compare);
      const physicalKey = aliases[0];
      if (!groups.has(physicalKey)) groups.set(physicalKey, { key: physicalKey, aliases });
    },
    finish(idPrefix) {
      const ids = {};
      const entries = [...groups.values()].sort((a, b) => compare(a.key, b.key));
      entries.forEach((entry, index) => {
        entry.id = `${idPrefix}${index + 1}`;
        for (const alias of entry.aliases) ids[alias] = entry.id;
      });
      return { entries, ids };
    },
    keys() { return [...groups.keys()]; },
  };
}

function addList(target, field, value) {
  (target[field] ||= []).push(value);
}

function publicPort(type) {
  if (type === 'random') return { unknown: true };
  const normalized = String(type).toUpperCase();
  const port = G.PORT_TYPES[normalized === 'WOOD' ? 'LUMBER' : normalized];
  if (!port) throw new TypeError('Unknown public port type');
  return { ratio: port.ratio, resource: port.resource };
}

/**
 * Compact public geometry and pieces from an ALREADY seat-filtered playerView.
 * This is a positive projection, not an authorization/filtering substitute.
 * IDs depend only on visible physical coordinates; engine aliases stay in ids.
 * A missing flag means false; absent occupants mean an empty location.
 */
export function createAgentBoard(game) {
  if (!game || !game.hexes || !game.vertices || !game.edges) throw new TypeError('A filtered game board is required');
  const vertexLocations = locations('v', G.getEquivalentVertices, G.vertexKey);
  const edgeLocations = locations('e', G.getEquivalentEdges, G.edgeKey);
  const tiles = Object.entries(game.hexes).sort(([a], [b]) => compare(a, b));
  const ids = { tiles: {}, vertices: {}, edges: {} };
  tiles.forEach(([key, hex], index) => {
    ids.tiles[key] = `H${index + 1}`;
    ids.tiles[G.hexKey(hex.q, hex.r)] = ids.tiles[key];
    for (const key of G.getHexVertices(hex.q, hex.r)) vertexLocations.add(key);
    for (let dir = 0; dir < 6; dir++) edgeLocations.add(G.edgeKey(hex.q, hex.r, dir));
  });
  for (const key of Object.keys(game.vertices)) vertexLocations.add(key);
  for (const key of Object.keys(game.edges)) edgeLocations.add(key);
  for (const key of edgeLocations.keys()) {
    for (const end of G.getEdgeVertices(...position(key, 'e'))) vertexLocations.add(end);
  }
  const vertices = vertexLocations.finish('V');
  const edges = edgeLocations.finish('E');
  ids.vertices = vertices.ids;
  ids.edges = edges.ids;
  const playerIds = new Set((game.players || []).map(player => player.id));
  const ownerId = owner => Number.isInteger(owner) ? game.players?.[owner]?.id : playerIds.has(owner) ? owner : undefined;
  const owned = owner => {
    const id = ownerId(owner);
    return id == null ? {} : { owner: id };
  };
  const board = {
    tiles: tiles.map(([key, hex]) => {
      const tile = { id: ids.tiles[key], terrain: hex.hidden || hex.terrain === 'fog' || !hex.terrain ? 'unknown' : hex.terrain };
      if (tile.terrain === 'unknown') tile.unknown = true;
      else {
        if (hex.resource != null) tile.resource = hex.resource;
        if (hex.number != null) tile.number = hex.number;
        if (hex.region != null) tile.region = hex.region;
      }
      return tile;
    }),
    vertices: vertices.entries.map(({ key, aliases, id }) => {
      const vertex = { id, tiles: uniqueSorted(G.getVertexAdjacentHexes(game, key)
        .map(hex => ids.tiles[G.hexKey(hex.q, hex.r)]).filter(Boolean)) };
      const piece = aliases.map(alias => game.vertices[alias]).find(value => value?.building);
      if (piece) Object.assign(vertex, { building: piece.building }, owned(piece.owner));
      if (piece?.pillagedNoPiece) vertex.pillaged = true;
      return vertex;
    }),
    edges: edges.entries.map(({ key, aliases, id }) => {
      const edge = { id, ends: uniqueSorted(G.getEdgeVertices(...position(key, 'e')).map(end => ids.vertices[end])) };
      const piece = aliases.map(alias => game.edges[alias]).find(value => value?.road || value?.ship);
      if (piece) Object.assign(edge, { route: piece.ship ? 'ship' : 'road' }, owned(piece.owner));
      if (piece?.ship && piece.warship) edge.warship = true;
      return edge;
    }),
    ports: (game.ports || []).map(port => {
      const ends = port.vertices || (port.edge ? G.getEdgeVertices(...position(port.edge, 'e')) : []);
      const vertices = uniqueSorted(ends.map(key => ids.vertices[key]));
      if (vertices.length !== 2 || vertices.includes(undefined)) throw new TypeError('Port must reference two visible vertices');
      return { vertices, ratio: port.ratio, resource: port.resource ?? null };
    }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
  };
  if (ids.tiles[game.robber]) board.robber = ids.tiles[game.robber];
  if (ids.tiles[game.pirate]) board.pirate = ids.tiles[game.pirate];
  else if (typeof game.pirate === 'string' && game.pirate.startsWith('frame:')) board.pirate = { frame: game.pirate.slice(6) };
  const vertexById = Object.fromEntries(board.vertices.map(vertex => [vertex.id, vertex]));
  const edgeById = Object.fromEntries(board.edges.map(edge => [edge.id, edge]));
  const tileById = Object.fromEntries(board.tiles.map(tile => [tile.id, tile]));
  // Expansion markers only attach to geometry already present in the filtered view.
  const vertexAt = key => vertexById[ids.vertices[key]];
  const edgeAt = key => edgeById[ids.edges[key]];
  const ck = game.citiesKnights;
  if (ck) {
    for (const [key, knight] of Object.entries(ck.knights || {})) {
      const vertex = vertexAt(key);
      if (!vertex) continue;
      vertex.knight = { ...owned(knight.ownerId), strength: knight.strength };
      if (knight.active) vertex.knight.active = true;
      for (const activity of ['activated', 'promoted', 'acted']) {
        if (ck.turnSerial != null && knight[`${activity}Turn`] === ck.turnSerial) vertex.knight[`${activity}ThisTurn`] = true;
      }
    }
    for (const [key, owner] of Object.entries(ck.walls || {})) {
      if (vertexAt(key)) vertexAt(key).wall = owned(owner);
    }
    for (const [track, metropolis] of Object.entries(ck.metropolises || {}).sort(([a], [b]) => compare(a, b))) {
      const vertex = vertexAt(metropolis.vertexKey);
      if (!vertex) continue;
      addList(vertex, 'metropolises', { track, ...owned(metropolis.ownerId), ...(metropolis.permanent ? { permanent: true } : {}) });
    }
    const merchantTile = tileById[ids.tiles[ck.merchant?.hexKey]];
    if (merchantTile) merchantTile.merchant = owned(ck.merchant.ownerId);
  }
  const sf = game.seafarers;
  if (sf) {
    for (const fortress of sf.fortresses || []) {
      const vertex = vertexAt(fortress.vertexKey);
      if (vertex) vertex.fortress = { ...owned(fortress.ownerId), lairs: fortress.lairs,
        ...(ownerId(fortress.capturedBy) != null ? { capturedBy: ownerId(fortress.capturedBy) } : {}) };
    }
    for (const beachhead of sf.beachheads || []) {
      const vertex = vertexAt(beachhead.vertexKey);
      if (vertex) vertex.beachhead = ownerId(beachhead.ownerId) == null ? true : owned(beachhead.ownerId);
    }
    const markerNames = { greatWallVertices: 'great_wall', greatBridgeVertices: 'great_bridge',
      greatBridgeAdjacentXVertices: 'great_bridge_adjacent', lighthouseVertices: 'lighthouse',
      lighthouseAdjacentXVertices: 'lighthouse_adjacent' };
    for (const [field, name] of Object.entries(markerNames)) {
      for (const key of sf.wonderMarkers?.[field] || []) {
        if (vertexAt(key)) addList(vertexAt(key), 'wonderMarkers', name);
      }
    }
    for (const village of sf.villages || []) {
      const vertex = vertexAt(village.vertexKey);
      if (!vertex) continue;
      addList(vertex, 'villages', { id: village.id, numbers: [...(village.numbers || [])], cloth: village.cloth,
        ...(ids.tiles[village.hexKey] ? { tile: ids.tiles[village.hexKey] } : {}) });
    }
    for (const bonus of sf.bonusSettlements || []) {
      if (vertexAt(bonus.vertexKey)) addList(vertexAt(bonus.vertexKey), 'scenarioBonuses', {
        ...owned(bonus.playerId), region: bonus.region, points: bonus.points,
      });
    }
    for (const reward of sf.rewards || []) {
      if (edgeAt(reward.edge)) addList(edgeAt(reward.edge), 'rewards', { kind: reward.kind, ...(reward.collected ? { collected: true } : {}) });
    }
    for (const port of sf.collectiblePorts || []) {
      if (edgeAt(port.edge)) addList(edgeAt(port.edge), 'collectiblePorts', { ...publicPort(port.type), ...(port.collected ? { collected: true } : {}) });
    }
    for (const [owner, key] of Object.entries(sf.origins || {})) {
      if (vertexAt(key) && ownerId(owner) != null) addList(vertexAt(key), 'origins', ownerId(owner));
    }
    for (const [owner, key] of Object.entries(sf.originsShip || {})) {
      if (edgeAt(key) && ownerId(owner) != null) addList(edgeAt(key), 'origins', ownerId(owner));
    }
    for (const [owner, keys] of Object.entries(sf.voyageEdges || {})) {
      for (const key of keys) if (edgeAt(key) && ownerId(owner) != null) addList(edgeAt(key), 'voyages', ownerId(owner));
    }
  }
  return { board, ids };
}
