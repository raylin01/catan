import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import { playerView } from './actions.js';
import { SEAFARERS_SCENARIOS } from '../shared/scenarios.js';
import { createAgentBoard } from './agentBoard.js';

function fixture({ count = 3, scenario, ck = false } = {}) {
  const game = G.createGame('projection-test', { id: 'p0', name: 'Player 0' }, count >= 5);
  for (let index = 1; index < count; index++) G.addPlayer(game, { id: `p${index}`, name: `Player ${index}` });
  if (scenario || ck) {
    const result = G.configureExpansions(game, { version: 1, extension56: count >= 5,
      expansions: [...(scenario ? ['seafarers'] : []), ...(ck ? ['cities_knights'] : [])],
      scenario: scenario || 'base', setup: { layout: scenario === 'new_world' ? 'variable' : 'fixed', seed: 42 } });
    assert.equal(result.success, true, result.error);
  }
  return game;
}

function equivalent(key, kind) {
  const parts = key.match(/-?\d+/g).map(Number);
  return (kind === 'vertices' ? G.getEquivalentVertices : G.getEquivalentEdges)(...parts)
    .map(({ q, r, dir }) => (kind === 'vertices' ? G.vertexKey : G.edgeKey)(q, r, dir));
}

function verifyTopology(game, projection) {
  const { board, ids } = projection;
  const tileIds = new Set(board.tiles.map(tile => tile.id));
  const vertexIds = new Set(board.vertices.map(vertex => vertex.id));
  const edgeIds = new Set(board.edges.map(edge => edge.id));
  assert.equal(vertexIds.size, board.vertices.length);
  assert.equal(edgeIds.size, board.edges.length);
  assert.equal(tileIds.size, Object.keys(game.hexes).length);
  for (const [kind, source] of [['vertices', game.vertices], ['edges', game.edges]]) {
    const physical = new Set();
    for (const key of Object.keys(source)) {
      const aliases = equivalent(key, kind);
      physical.add(aliases.sort()[0]);
      assert.ok(ids[kind][key], `${key} has a canonical ID`);
      for (const alias of aliases) assert.equal(ids[kind][alias], ids[kind][key], `Equivalent ${alias}`);
    }
    assert.equal(board[kind].length, physical.size, `${kind} contain each physical location once`);
  }
  const vertices = Object.fromEntries(board.vertices.map(vertex => [vertex.id, vertex]));
  const edges = Object.fromEntries(board.edges.map(edge => [edge.id, edge]));
  for (const vertex of board.vertices) {
    assert.equal(vertex.tiles.length, new Set(vertex.tiles).size);
    for (const tile of vertex.tiles) assert.ok(tileIds.has(tile));
  }
  for (const [key, hex] of Object.entries(game.hexes)) {
    const corners = new Set(G.getHexVertices(hex.q, hex.r).map(vertex => ids.vertices[vertex]));
    assert.equal(corners.size, 6);
    for (const corner of corners) assert.ok(vertices[corner].tiles.includes(ids.tiles[key]));
  }
  const pairs = new Set();
  for (const edge of board.edges) {
    assert.equal(edge.ends.length, 2);
    assert.notEqual(edge.ends[0], edge.ends[1]);
    for (const end of edge.ends) assert.ok(vertexIds.has(end));
    const pair = edge.ends.join('|');
    assert.equal(pairs.has(pair), false, 'No duplicate physical endpoints');
    pairs.add(pair);
  }
  for (const key of Object.keys(game.edges)) {
    assert.deepEqual(new Set(edges[ids.edges[key]].ends), new Set(G.getEdgeVertices(...key.match(/-?\d+/g).map(Number)).map(end => ids.vertices[end])));
  }
  for (const port of board.ports) {
    assert.equal(port.vertices.length, 2);
    for (const vertex of port.vertices) assert.ok(vertexIds.has(vertex));
  }
  for (const port of game.ports) {
    const expected = port.vertices.map(vertex => ids.vertices[vertex]).sort();
    assert.ok(board.ports.some(value => value.ratio === port.ratio && value.resource === port.resource &&
      JSON.stringify(value.vertices) === JSON.stringify(expected)));
  }
  if (game.robber) assert.equal(board.robber, ids.tiles[game.robber]);
  if (ids.tiles[game.pirate]) assert.equal(board.pirate, ids.tiles[game.pirate]);
  return { vertices, edges };
}

test('base setup has 54 intersections and 72 edges, with complete canonical references', () => {
  const game = fixture();
  const filtered = playerView(game, 'p0');
  const before = structuredClone(filtered);
  const projection = createAgentBoard(filtered);
  assert.equal(Object.keys(game.vertices).length, 114);
  assert.equal(projection.board.vertices.length, 54);
  assert.equal(projection.board.edges.length, 72);
  verifyTopology(filtered, projection);
  assert.deepEqual(filtered, before, 'Projection does not mutate input');
});

test('occupants can use any equivalent alias without changing IDs or duplicating pieces', () => {
  const game = fixture();
  const first = createAgentBoard(playerView(game, 'p0'));
  const key = Object.keys(game.vertices)[0];
  const edgeKey = Object.keys(game.edges)[0];
  const alias = equivalent(key, 'vertices').find(alias => alias !== key);
  const edgeAlias = equivalent(edgeKey, 'edges').find(alias => alias !== edgeKey);
  game.vertices[alias] = { building: 'city', owner: 1, color: '#fff', icon: '🏰' };
  game.edges[edgeAlias] = { road: true, owner: 2, pixels: [3, 4] };
  const projected = createAgentBoard(playerView(game, 'p0'));
  assert.deepEqual(projected.ids, first.ids);
  const city = projected.board.vertices.filter(vertex => vertex.building);
  const road = projected.board.edges.filter(edge => edge.route);
  assert.deepEqual(city, [{ id: first.ids.vertices[key], tiles: city[0].tiles, building: 'city', owner: 'p1' }]);
  assert.deepEqual(road, [{ id: first.ids.edges[edgeKey], ends: road[0].ends, route: 'road', owner: 'p2' }]);
  game.vertices = Object.fromEntries(Object.entries(game.vertices).reverse());
  game.edges = Object.fromEntries(Object.entries(game.edges).reverse());
  game.hexes = Object.fromEntries(Object.entries(game.hexes).reverse());
  assert.deepEqual(createAgentBoard(playerView(game, 'p0')), projected, 'Input insertion order has no effect');
});

test('all published Seafarers geometries and the extension retain complete graphs', () => {
  for (const count of [5, 6]) {
    const game = fixture({ count });
    const projected = createAgentBoard(playerView(game, 'p0'));
    verifyTopology(game, projected);
    assert.ok(projected.board.tiles.length > Object.keys(fixture().hexes).length, 'Extended geometry is larger than base geometry');
  }
  for (const scenario of SEAFARERS_SCENARIOS) for (const count of [3, 4, 5, 6]) {
    const game = fixture({ scenario: scenario.id, count });
    assert.equal(G.startGame(game).success, true);
    const projected = createAgentBoard(playerView(game, 'p0'));
    verifyTopology(game, projected);
    assert.deepEqual(projected.board.tiles.filter(tile => tile.region).map(tile => tile.region).sort(),
      Object.values(game.hexes).filter(hex => !hex.hidden && hex.region).map(hex => hex.region).sort());
    assert.equal(projected.board.vertices.filter(vertex => vertex.fortress).length, game.seafarers.fortresses.length);
    assert.equal(projected.board.vertices.filter(vertex => vertex.beachhead).length, game.seafarers.beachheads.length);
    assert.equal(projected.board.vertices.flatMap(vertex => vertex.villages || []).length, game.seafarers.villages.length);
    assert.equal(projected.board.edges.flatMap(edge => edge.rewards || []).length, game.seafarers.rewards.length);
    assert.equal(projected.board.edges.flatMap(edge => edge.collectiblePorts || []).length, game.seafarers.collectiblePorts.length);
  }
});

test('fog revelation and hidden/private changes cannot renumber or expose inaccessible contents', () => {
  const game = fixture({ scenario: 'the_fog_islands' });
  const first = createAgentBoard(playerView(game, 'p0'));
  const hidden = Object.entries(game.hexes).find(([, hex]) => hex.hidden);
  assert.ok(hidden);
  const [key, hex] = hidden;
  assert.deepEqual(first.board.tiles.find(tile => tile.id === first.ids.tiles[key]), { id: first.ids.tiles[key], terrain: 'unknown', unknown: true });
  const other = structuredClone(game);
  other.seafarers.fogTerrainPile.reverse();
  other.seafarers.fogNumberPile.reverse();
  other.devCardDeck.reverse();
  other.players[1].resources = { brick: 1, lumber: 3, wool: 4, grain: 2, ore: 5 };
  other.players[1].developmentCards = ['victoryPoint'];
  other.players[1].hiddenVictoryPoints = 1;
  Object.assign(other.hexes[key], { resource: 'ore', number: 12, terrain: 'mountains', region: 'secret' });
  assert.deepEqual(createAgentBoard(playerView(other, 'p0')), first, 'Hidden tile contents and private inventories do not affect board or IDs');
  Object.assign(hex, { terrain: 'forest', resource: 'lumber', number: 6, hidden: false });
  const revealed = createAgentBoard(playerView(game, 'p0'));
  assert.deepEqual(revealed.ids, first.ids);
  assert.equal(revealed.board.tiles.find(tile => tile.id === revealed.ids.tiles[key]).terrain, 'forest');
  assert.equal(revealed.board.vertices.length, first.board.vertices.length);
  assert.equal(revealed.board.edges.length, first.board.edges.length);
});

test('CK and combined geometry preserve public knights, walls, metropolises, and merchant', () => {
  for (const count of [3, 6]) for (const scenario of [undefined, 'heading_for_new_shores']) {
    const game = fixture({ count, scenario, ck: true });
    const [cityKey, knightKey, pillagedKey] = [...new Set(Object.keys(game.vertices).map(key => SF.canonicalVertex(game, key)))];
    game.vertices[cityKey] = { building: 'city', owner: 1 };
    game.vertices[pillagedKey] = { building: 'settlement', owner: 1, pillagedNoPiece: true };
    game.citiesKnights.walls[cityKey] = 'p1';
    game.citiesKnights.knights[knightKey] = { ownerId: 'p0', strength: 2, active: true, activatedTurn: 3, promotedTurn: null, actedTurn: 4, color: '#abc' };
    game.citiesKnights.turnSerial = 4;
    game.citiesKnights.metropolises.science = { ownerId: 'p1', vertexKey: cityKey, permanent: true };
    game.citiesKnights.merchant = { ownerId: 'p0', hexKey: Object.keys(game.hexes)[0] };
    const projected = createAgentBoard(playerView(game, 'p0'));
    const { vertices } = verifyTopology(game, projected);
    assert.deepEqual(vertices[projected.ids.vertices[knightKey]].knight,
      { owner: 'p0', strength: 2, active: true, actedThisTurn: true });
    assert.equal(vertices[projected.ids.vertices[pillagedKey]].pillaged, true);
    assert.deepEqual(vertices[projected.ids.vertices[cityKey]].wall, { owner: 'p1' });
    assert.deepEqual(vertices[projected.ids.vertices[cityKey]].metropolises, [{ track: 'science', owner: 'p1', permanent: true }]);
    assert.deepEqual(projected.board.tiles.find(tile => tile.id === projected.ids.tiles[game.citiesKnights.merchant.hexKey]).merchant, { owner: 'p0' });
    const privateChanged = structuredClone(game);
    privateChanged.citiesKnights.progressDecks.science.reverse();
    privateChanged.players[1].commodities.cloth = 8;
    assert.deepEqual(createAgentBoard(playerView(privateChanged, 'p0')), projected);
    game.citiesKnights.knights[knightKey].activatedTurn = 4;
    game.citiesKnights.knights[knightKey].promotedTurn = 4;
    assert.deepEqual(createAgentBoard(playerView(game, 'p0')).board.vertices.find(vertex => vertex.id === projected.ids.vertices[knightKey]).knight,
      { owner: 'p0', strength: 2, active: true, activatedThisTurn: true, promotedThisTurn: true, actedThisTurn: true });
  }
});

test('ships, warships, fortresses, origins, voyage edges, and wonder markers use canonical locations', () => {
  const game = fixture({ scenario: 'the_pirate_islands' });
  assert.equal(G.startGame(game).success, true);
  const ship = Object.keys(game.edges).find(key => game.edges[key].ship);
  game.edges[ship].warship = true;
  const owner = game.players[game.edges[ship].owner].id;
  game.seafarers.voyageEdges[owner] = [ship];
  const fortress = game.seafarers.fortresses[0];
  fortress.lairs = 0;
  fortress.capturedBy = fortress.ownerId;
  const projected = createAgentBoard(playerView(game, 'p0'));
  const { vertices, edges } = verifyTopology(game, projected);
  assert.equal(edges[projected.ids.edges[ship]].warship, true);
  assert.equal(edges[projected.ids.edges[ship]].route, 'ship');
  assert.deepEqual(edges[projected.ids.edges[ship]].voyages, [owner]);
  assert.deepEqual(vertices[projected.ids.vertices[fortress.vertexKey]].fortress,
    { owner: fortress.ownerId, lairs: 0, capturedBy: fortress.ownerId });
  for (const [owner, key] of Object.entries(game.seafarers.origins)) assert.ok(vertices[projected.ids.vertices[key]].origins.includes(owner));
  for (const [owner, key] of Object.entries(game.seafarers.originsShip)) assert.ok(edges[projected.ids.edges[key]].origins.includes(owner));
  game.pirate = 'frame:east';
  assert.deepEqual(createAgentBoard(playerView(game, 'p0')).board.pirate, { frame: 'east' });
  const wonders = fixture({ scenario: 'the_wonders_of_catan' });
  const wonderBoard = createAgentBoard(playerView(wonders, 'p0'));
  for (const key of wonders.seafarers.wonderMarkers.greatWallVertices) {
    assert.ok(wonderBoard.board.vertices.find(vertex => vertex.id === wonderBoard.ids.vertices[key]).wonderMarkers.includes('great_wall'));
  }
});

test('positive allowlist strips renderer junk, aliases and unrelated control/private fields', () => {
  const game = fixture({ scenario: 'the_forgotten_tribe' });
  const view = playerView(game, 'p0');
  for (const hex of Object.values(view.hexes)) Object.assign(hex, { icon: '🧱', emoji: '🪵', pixels: [1, 2], privateTerrain: 'ore' });
  for (const vertex of Object.values(view.vertices)) Object.assign(vertex, { color: '#fff', label: '🏠' });
  view.devCardDeck = ['hidden'];
  view.seafarers.fogTerrainPile = ['mountains'];
  view.seafarers.rewardDeck = ['victoryPoint'];
  view.control = { secret: 'credential' };
  const output = JSON.stringify(createAgentBoard(view).board);
  for (const forbidden of ['color', 'icon', 'emoji', 'pixels', 'privateTerrain', 'fogTerrainPile', 'rewardDeck', 'devCardDeck', 'credential', '🧱', '🪵', '🏠']) {
    assert.equal(output.includes(forbidden), false, `${forbidden} absent`);
  }
  assert.equal(/"[ve]_-?\d+_-?\d+_[0-5]"/.test(output), false, 'Engine aliases are internal only');
  assert.equal(output.includes(':false'), false, 'False/empty flags omitted');
  assert.equal(output.includes(':{}'), false, 'No empty objects');
});

test('projection adds topology only for visible geometry and does not create inaccessible markers', () => {
  const game = { players: [{ id: 'p0' }], hexes: { '0,0': { q: 0, r: 0, terrain: 'fog', hidden: true } },
    vertices: {}, edges: {}, ports: [], seafarers: {
      fortresses: [{ vertexKey: 'v_90_90_0', ownerId: 'p0', lairs: 3 }],
      rewards: [{ edge: 'e_90_90_0', kind: 'development_card' }],
    }, citiesKnights: { knights: { v_90_90_0: { ownerId: 'p0', strength: 3, active: true } } } };
  const { board, ids } = createAgentBoard(game);
  assert.equal(board.tiles.length, 1);
  assert.equal(board.vertices.length, G.getHexVertices(0, 0).length);
  assert.equal(board.edges.length, G.getHexVertices(0, 0).length);
  assert.equal(ids.vertices.v_90_90_0, undefined);
  assert.equal(ids.edges.e_90_90_0, undefined);
  assert.ok(board.vertices.every(vertex => !vertex.knight && !vertex.fortress));
  assert.ok(board.edges.every(edge => !edge.rewards));
  assert.ok(board.vertices.every(vertex => vertex.tiles.length === 1 && vertex.tiles[0] === 'H1'));
});
