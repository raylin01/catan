const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const HEX_CATALOG = [
  [0, -2, 'forest', 'lumber', '#2d5a27', 5],
  [1, -2, 'pasture', 'wool', '#90c26a', 2],
  [2, -2, 'fields', 'grain', '#d4a942', 6],
  [-1, -1, 'hills', 'brick', '#c45a2c', 3],
  [0, -1, 'mountains', 'ore', '#6b6b6b', 8],
  [1, -1, 'forest', 'lumber', '#2d5a27', 10],
  [2, -1, 'pasture', 'wool', '#90c26a', 9],
  [-2, 0, 'fields', 'grain', '#d4a942', 12],
  [-1, 0, 'mountains', 'ore', '#6b6b6b', 4],
  [0, 0, 'desert', null, '#e8d5a3', null],
  [1, 0, 'hills', 'brick', '#c45a2c', 5],
  [2, 0, 'forest', 'lumber', '#2d5a27', 11],
  [-2, 1, 'pasture', 'wool', '#90c26a', 9],
  [-1, 1, 'fields', 'grain', '#d4a942', 10],
  [0, 1, 'hills', 'brick', '#c45a2c', 3],
  [1, 1, 'mountains', 'ore', '#6b6b6b', 8],
  [-2, 2, 'forest', 'lumber', '#2d5a27', 4],
  [-1, 2, 'pasture', 'wool', '#90c26a', 6],
  [0, 2, 'fields', 'grain', '#d4a942', 11]
];

const PORTS = [
  [['v_0_-2_0', 'v_0_-2_5'], null, 3],
  [['v_1_-2_0', 'v_1_-2_1'], 'grain', 2],
  [['v_2_-2_1', 'v_2_-2_2'], 'ore', 2],
  [['v_2_-1_2', 'v_2_0_1'], null, 3],
  [['v_2_0_2', 'v_2_0_3'], 'wool', 2],
  [['v_1_1_2', 'v_1_1_3'], null, 3],
  [['v_0_2_3', 'v_0_2_4'], null, 3],
  [['v_-2_2_3', 'v_-2_2_4'], 'brick', 2],
  [['v_-2_0_4', 'v_-2_0_5'], 'lumber', 2]
];

export const ROAD_TARGETS = ['e_0_-2_1', 'e_1_-2_2', 'e_2_-1_2', 'e_2_0_2', 'e_-1_1_3', 'e_-2_1_4'];
export const SETTLEMENT_TARGETS = ['v_0_0_3', 'v_1_0_2', 'v_-1_-1_1', 'v_0_-2_0', 'v_2_0_2', 'v_-2_2_4'];
export const CITY_TARGETS = ['v_0_-1_0', 'v_0_-1_2'];
export const ROBBER_TARGETS = ['0,0', '1,-1', '-1,0', '1,1', '-1,2'];

const makePool = values => Object.fromEntries(RESOURCES.map(resource => [resource, values[resource] || 0]));

function vertexAliases(vertexKey, vertices) {
  const match = vertexKey.match(/^v_(-?\d+)_(-?\d+)_(\d)$/);
  if (!match) return [];
  const q = Number(match[1]);
  const r = Number(match[2]);
  const direction = Number(match[3]);
  const aliases = [{q, r, direction}];
  if (direction === 0) aliases.push({q, r: r - 1, direction: 2}, {q: q + 1, r: r - 1, direction: 4});
  if (direction === 1) aliases.push({q: q + 1, r: r - 1, direction: 3}, {q: q + 1, r, direction: 5});
  if (direction === 2) aliases.push({q: q + 1, r, direction: 4}, {q, r: r + 1, direction: 0});
  if (direction === 3) aliases.push({q, r: r + 1, direction: 5}, {q: q - 1, r: r + 1, direction: 1});
  if (direction === 4) aliases.push({q: q - 1, r: r + 1, direction: 0}, {q: q - 1, r, direction: 2});
  if (direction === 5) aliases.push({q: q - 1, r, direction: 1}, {q, r: r - 1, direction: 3});
  return aliases.map(alias => `v_${alias.q}_${alias.r}_${alias.direction}`).filter(key => Object.hasOwn(vertices, key));
}

function edgeAliases(edgeKey, edges) {
  const match = edgeKey.match(/^e_(-?\d+)_(-?\d+)_(\d)$/);
  if (!match) return [];
  const q = Number(match[1]);
  const r = Number(match[2]);
  const direction = Number(match[3]);
  const aliases = [{q, r, direction}];
  if (direction === 0) aliases.push({q: q + 1, r: r - 1, direction: 3});
  if (direction === 1) aliases.push({q: q + 1, r, direction: 4});
  if (direction === 2) aliases.push({q, r: r + 1, direction: 5});
  if (direction === 3) aliases.push({q: q - 1, r: r + 1, direction: 0});
  if (direction === 4) aliases.push({q: q - 1, r, direction: 1});
  if (direction === 5) aliases.push({q, r: r - 1, direction: 2});
  return aliases.map(alias => `e_${alias.q}_${alias.r}_${alias.direction}`).filter(key => Object.hasOwn(edges, key));
}

export function setPhysicalVertex(vertices, vertexKey, value) {
  for (const key of vertexAliases(vertexKey, vertices)) vertices[key] = {...value};
}

export function setPhysicalEdge(edges, edgeKey, value) {
  for (const key of edgeAliases(edgeKey, edges)) edges[key] = {...value};
}

export function isPhysicalVertexEmpty(vertices, vertexKey) {
  const aliases = vertexAliases(vertexKey, vertices);
  return aliases.length > 0 && aliases.every(key => !vertices[key]?.building);
}

export function isPhysicalEdgeEmpty(edges, edgeKey) {
  const aliases = edgeAliases(edgeKey, edges);
  return aliases.length > 0 && aliases.every(key => !edges[key]?.road);
}

export function isPhysicalSettlement(vertices, vertexKey, owner) {
  return vertexAliases(vertexKey, vertices).some(key => vertices[key]?.building === 'settlement' && vertices[key]?.owner === owner);
}

function boardTopology() {
  const hexes = {};
  const vertices = {};
  const edges = {};
  for (const [q, r, terrain, resource, color, number] of HEX_CATALOG) {
    hexes[`${q},${r}`] = {q, r, terrain, resource, color, number};
    for (let direction = 0; direction < 6; direction += 1) {
      vertices[`v_${q}_${r}_${direction}`] ||= {building: null, owner: null};
      edges[`e_${q}_${r}_${direction}`] ||= {road: false, owner: null};
    }
  }

  for (const [key, building, owner] of [
    ['v_0_-1_0', 'settlement', 0],
    ['v_0_-1_2', 'settlement', 0],
    ['v_-1_0_3', 'settlement', 1],
    ['v_-1_1_3', 'city', 1],
    ['v_1_-1_2', 'settlement', 2],
    ['v_1_0_3', 'city', 2],
    ['v_0_1_2', 'settlement', 3],
    ['v_-1_2_0', 'settlement', 3]
  ]) setPhysicalVertex(vertices, key, {building, owner});
  for (const [key, owner] of [
    ['e_0_-1_0', 0],
    ['e_0_-1_1', 0],
    ['e_-1_0_2', 1],
    ['e_-1_1_4', 1],
    ['e_1_-1_2', 2],
    ['e_1_0_3', 2],
    ['e_0_1_2', 3],
    ['e_-1_2_5', 3]
  ]) setPhysicalEdge(edges, key, {road: true, owner});
  return {
    hexes,
    vertices,
    edges,
    ports: PORTS.map(([verticesAtPort, resource, ratio], id) => ({
      id,
      vertices: verticesAtPort,
      resource,
      ratio,
      type: resource ? resource.toUpperCase() : 'GENERIC',
      name: resource ? `${resource} port` : '3:1 port'
    }))
  };
}

const players = () => [
  {
    id: 'seat-a', name: 'Ada', color: '#d9584f', turnOrder: 1,
    resources: makePool({brick: 5, lumber: 5, wool: 4, grain: 6, ore: 5}),
    developmentCards: ['knight', 'roadBuilding', 'monopoly'], newDevCards: ['yearOfPlenty'],
    knightsPlayed: 2, victoryPoints: 4, hiddenVictoryPoints: 1,
    settlements: 3, cities: 4, roads: 13
  },
  {
    id: 'seat-b', name: 'Mara', color: '#3f82b5', turnOrder: 2,
    resources: 8, developmentCards: 2, newDevCards: 0,
    knightsPlayed: 1, victoryPoints: 5, hiddenVictoryPoints: 0,
    settlements: 4, cities: 3, roads: 13
  },
  {
    id: 'seat-c', name: 'Theo', color: '#e19a3b', turnOrder: 3,
    resources: 6, developmentCards: 1, newDevCards: 0,
    knightsPlayed: 3, victoryPoints: 6, hiddenVictoryPoints: 0,
    settlements: 4, cities: 3, roads: 13
  },
  {
    id: 'seat-d', name: 'Lin', color: '#3aa184', turnOrder: 4,
    resources: 10, developmentCards: 3, newDevCards: 0,
    knightsPlayed: 0, victoryPoints: 3, hiddenVictoryPoints: 0,
    settlements: 3, cities: 4, roads: 13
  }
];

export const DESIGN_SLOTS = [
  {id: 'seat-a', name: 'Ada', kind: 'human', occupied: true, connected: true, ready: true},
  {id: 'seat-b', name: 'Mara', kind: 'ai', provider: 'synthetic', model: 'fixture-model', occupied: true, connected: true, ready: true, ai: {connection: 'online', status: 'thinking'}},
  {id: 'seat-c', name: 'Theo', kind: 'human', occupied: true, connected: true, ready: true},
  {id: 'seat-d', name: 'Lin', kind: 'ai', provider: 'synthetic', model: 'fixture-model', occupied: true, connected: false, ready: true, ai: {connection: 'stale', status: 'waiting'}}
];

export const INITIAL_EVENTS = [
  {id: 'fixture-1', type: 'rollDice', actor: 'seat-b', at: '2026-09-12T19:00:00.000Z', summary: 'Mara rolled an 8'},
  {id: 'fixture-2', type: 'placeSettlement', actor: 'seat-a', at: '2026-09-12T19:00:06.000Z', summary: 'Ada built a settlement'},
  {id: 'fixture-3', type: 'tradeConfirm', actor: 'seat-c', at: '2026-09-12T19:00:14.000Z', summary: 'Theo and Lin completed a trade'}
];

export function createFixture(view = 'play') {
  const topology = boardTopology();
  const fixturePlayers = players();
  const spectator = view === 'spectator';
  const allHands = view === 'hands';
  if (spectator) {
    fixturePlayers[0].resources = 25;
    fixturePlayers[0].developmentCards = 3;
    fixturePlayers[0].newDevCards = 1;
    fixturePlayers[0].hiddenVictoryPoints = 0;
  }
  if (allHands) {
    Object.assign(fixturePlayers[1], {
      resources: makePool({brick: 1, lumber: 3, wool: 2, grain: 1, ore: 1}),
      developmentCards: ['knight', 'victoryPoint'],
      newDevCards: []
    });
    Object.assign(fixturePlayers[2], {
      resources: makePool({brick: 2, lumber: 1, wool: 1, grain: 1, ore: 1}),
      developmentCards: ['monopoly'],
      newDevCards: []
    });
    Object.assign(fixturePlayers[3], {
      resources: makePool({brick: 1, lumber: 2, wool: 3, grain: 3, ore: 1}),
      developmentCards: ['knight', 'roadBuilding'],
      newDevCards: ['yearOfPlenty']
    });
  }
  return {
    id: 'DESIGN-SAMPLE',
    phase: view === 'setup' ? 'setup' : 'playing',
    setupPhase: 0,
    setupAction: null,
    currentPlayerIndex: 0,
    turnPhase: view === 'setup' ? 'roll' : 'main',
    myIndex: spectator || allHands ? -1 : 0,
    maxPlayers: 4,
    isExtended: false,
    players: fixturePlayers,
    ...topology,
    robber: '0,0',
    diceRoll: view === 'setup' ? null : {die1: 3, die2: 5, total: 8},
    tradeOffer: null,
    discardingPlayers: [],
    freeRoads: 0,
    yearOfPlentyPicks: 0,
    devCardDeck: 17,
    longestRoadPlayer: 1,
    largestArmyPlayer: 2,
    specialBuildingPhase: false,
    specialBuildIndex: 0,
    winner: null,
    tradeRatios: makePool({brick: 3, lumber: 2, wool: 4, grain: 3, ore: 4}),
    bankAvailable: Object.fromEntries(RESOURCES.map(resource => [resource, true]))
  };
}

export function legalActionsFor(view = 'play', game = null) {
  if (view === 'spectator' || view === 'hands') return [];
  return [
    ...ROAD_TARGETS.filter(edgeKey => !game || isPhysicalEdgeEmpty(game.edges, edgeKey)).map(edgeKey => ({type: 'placeRoad', payload: {edgeKey}})),
    ...SETTLEMENT_TARGETS.filter(vertexKey => !game || isPhysicalVertexEmpty(game.vertices, vertexKey)).map(vertexKey => ({type: 'placeSettlement', payload: {vertexKey}})),
    ...CITY_TARGETS.filter(vertexKey => !game || isPhysicalSettlement(game.vertices, vertexKey, 0)).map(vertexKey => ({type: 'upgradeToCity', payload: {vertexKey}})),
    ...ROBBER_TARGETS.filter(hexKey => !game || hexKey !== game.robber).map(hexKey => ({type: 'moveRobber', payload: {hexKey, stealFromPlayerId: null}})),
    ...(view === 'setup' ? [{type: 'advanceSetup', payload: {}}] : [])
  ];
}

export function cloneFixture(value) {
  return structuredClone(value);
}
