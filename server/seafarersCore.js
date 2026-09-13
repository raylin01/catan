import { readFileSync } from 'node:fs';
import * as G from './gameLogic.js';
import { scenarioFor, scenarioMapKey } from '../shared/scenarios.js';
import { newWorldComponents, validateNewWorldSetup } from '../shared/newWorld.js';

const MAPS = JSON.parse(readFileSync(new URL('./data/seafarers-maps.json', import.meta.url), 'utf8')).maps;
const RESOURCE_BY_TERRAIN = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore' };
const TERRAIN_COLOR = { hills: '#c45a2c', forest: '#2d5a27', pasture: '#90c26a', fields: '#d4a942',
  mountains: '#6b6b6b', desert: '#e8d5a3', sea: '#365d68', gold: '#d3ab54', fog: '#677c80' };
const RESOURCE_TYPES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const PORT_RESOURCE = { brick: 'brick', wood: 'lumber', lumber: 'lumber', wool: 'wool', grain: 'grain', ore: 'ore', generic: null };
const WONDER_COSTS = {
  great_wall: { brick: 3, lumber: 1, grain: 1 },
  great_bridge: { lumber: 3, wool: 1, grain: 1 },
  grand_theater: { brick: 1, lumber: 1, wool: 3 },
  grand_castle: { brick: 1, grain: 1, ore: 3 },
  grand_monument: { grain: 3, ore: 2 },
  lighthouse: { lumber: 3, wool: 1, grain: 1 },
  great_library: { brick: 1, lumber: 1, wool: 3 },
};

const fail = error => ({ success: false, error });
const matchesPlayerCount = (map, count) => Array.isArray(map.players) ? map.players.includes(count) : map.players === count;
const keyForHex = hex => G.hexKey(hex.q, hex.r);
const edgeFromPosition = position => G.edgeKey(position.hex.q, position.hex.r, position.side);

export function mapForScenario(scenario, count) {
  const mapKey = scenarioMapKey(scenario, count);
  const map = MAPS[mapKey];
  const matchingScenario = map?.scenario === scenario ||
    (scenario === 'the_four_islands' && map?.scenario === 'the_six_islands' && count >= 5);
  return matchingScenario && matchesPlayerCount(map, count) ? [mapKey, map] : null;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffleWith(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const flattenPool = pool => Object.entries(pool || {}).flatMap(([value, count]) => Array(Number(count)).fill(value));

function validateMap(map, layout) {
  if (!map || !Array.isArray(map.hexes)) return fail('Scenario map is unavailable');
  if (map.scenario === 'new_world' && layout !== 'variable') return fail('New World requires variable setup');
  if (map.scenario === 'the_pirate_islands' && layout !== 'fixed') return fail('The Pirate Islands uses its printed fixed setup');
  if (/pending|incomplete|unverified/i.test(map.transcriptionStatus || '')) {
    return fail('This scenario map is awaiting verification against the official board diagram');
  }
  if (!['the_pirate_islands', 'the_wonders_of_catan'].includes(map.scenario) && !map.pirateStart) {
    return fail('Scenario pirate start is awaiting map verification');
  }
  if (map.scenario !== 'the_pirate_islands' && !map.robberStart) return fail('Scenario robber start is awaiting map verification');
  if (layout === 'variable' && map.scenario !== 'new_world' && !map.variableSetup && !map.randomMainIsland) {
    return fail('Variable setup is unavailable for this scenario');
  }
  if (layout === 'variable' && map.players?.some?.(count => count >= 5) && map.scenario !== 'new_world' && !map.randomMainIsland) {
    return fail('The 5–6 player book does not define a variable setup for this map');
  }
  if (layout === 'variable' && ['the_forgotten_tribe','the_wonders_of_catan'].includes(map.scenario) && !map.variableExcludedNumberHexes) {
    return fail('Variable number-disc restrictions are awaiting map verification');
  }
  if (!map.ports && !['new_world','the_forgotten_tribe'].includes(map.scenario)) return fail('Scenario ports are unavailable');
  return { success: true };
}

function makeHex(source) {
  const terrain = source.terrain === 'random' ? 'fog' : source.terrain;
  return { q: source.q, r: source.r, terrain, resource: RESOURCE_BY_TERRAIN[terrain] || null,
    color: TERRAIN_COLOR[terrain] || TERRAIN_COLOR.fog, number: source.number ?? null,
    region: source.region ?? null, hidden: source.terrain === 'fog' };
}

function generateNewWorld(map, random, setup, count) {
  const terrain = shuffleWith(flattenPool(setup.terrainMix || map.randomHexPool), random);
  const discPool = setup.terrainMix ? newWorldComponents(count).numberDiscs : map.numberPool;
  const numbers = shuffleWith(flattenPool(discPool).map(Number), random);
  if (terrain.length !== map.hexes.length) throw new Error('New World terrain pool does not fit map');
  const placed = map.hexes.map((hex, index) => ({ ...hex, terrain: terrain[index] }));
  const byKey = new Map(placed.map(hex => [G.hexKey(hex.q, hex.r), hex]));
  for (const pair of setup.hexSwaps || []) {
    const first = byKey.get(pair[0]), second = byKey.get(pair[1]);
    if (!first || !second) throw new Error('New World hex swap is outside the printed frame');
    [first.terrain, second.terrain] = [second.terrain, first.terrain];
  }
  const numbered = placed.filter(hex => hex.terrain !== 'sea' && hex.terrain !== 'desert');
  if (numbered.length > numbers.length || (!setup.terrainMix && numbered.length !== numbers.length)) throw new Error('New World number pool does not fit map');
  const drawnNumbers = numbers.slice(0, numbered.length);
  const redNumbers = drawnNumbers.filter(number => number === 6 || number === 8);
  const blackNumbers = drawnNumbers.filter(number => number !== 6 && number !== 8);
  const neighbors = hex => placed.filter(other => other !== hex && Math.max(Math.abs(other.q - hex.q), Math.abs(other.r - hex.r), Math.abs((other.q + other.r) - (hex.q + hex.r))) === 1);
  let redLocations = null;
  for (let pass = 0; pass < 128; pass++) {
    const candidates = shuffleWith(numbered.filter(hex => hex.terrain !== 'gold'), random);
    const selected = [];
    for (const hex of candidates) if (selected.every(other => !neighbors(hex).includes(other))) selected.push(hex);
    if (selected.length >= redNumbers.length) { redLocations = selected.slice(0, redNumbers.length); break; }
  }
  if (!redLocations) throw new Error('Could not separate New World red number discs');
  redLocations.forEach((hex, index) => { hex.number = redNumbers[index]; });
  const redSet = new Set(redLocations);
  shuffleWith(numbered.filter(hex => !redSet.has(hex)), random).forEach((hex, index) => { hex.number = blackNumbers[index]; });
  return placed;
}

function applyVariableSetup(layout, map, random) {
  if (!map.variableSetup) return layout;
  const scenario = map.scenario;
  const regions = scenario === 'heading_for_new_shores' ? [['main'], ['nw','ne','sw','se','e']]
    : scenario === 'the_four_islands' ? [['nw','ne','sw','se']]
    : scenario === 'the_fog_islands' ? [['w','e']]
    : scenario === 'through_the_desert' ? [['main'], ['strip','barrier','ne','e','se']]
    : scenario === 'the_forgotten_tribe' ? [['main']]
    : scenario === 'cloth_for_catan' ? [['north','south']]
    : scenario === 'the_wonders_of_catan' ? [['main']] : [];
  if (!regions.length) throw new Error('Variable setup has no verified island groups');
  const allowed = new Map((map.variableExcludedNumberHexes || []).map(item => [keyForHex(item.hex), item.exclude]));
  const adjacent = (a,b) => Math.max(Math.abs(a.q-b.q),Math.abs(a.r-b.r),Math.abs(a.q+a.r-b.q-b.r)) === 1;
  for (let pass = 0; pass < 5000; pass++) {
    const candidate = layout.map(hex => ({ ...hex }));
    for (const group of regions) {
      const original = layout.filter(hex => group.includes(hex.region) && hex.terrain !== 'sea' && hex.terrain !== 'fog' && hex.region !== 'barrier');
      const targets = candidate.filter(hex => original.some(source => source.q === hex.q && source.r === hex.r));
      const terrainPool = shuffleWith(original.map(hex => hex.terrain), random);
      targets.forEach((hex,index) => { hex.terrain = terrainPool[index]; hex.number = null; });
      const discs = shuffleWith(original.map(hex => hex.number).filter(number => number != null), random);
      const numbered = targets.filter(hex => hex.terrain !== 'desert');
      if (discs.length !== numbered.length) throw new Error('Variable terrain and disc pools do not match');
      numbered.forEach((hex,index) => { hex.number = discs[index]; });
    }
    if (candidate.some(hex => allowed.get(keyForHex(hex))?.includes(hex.number))) continue;
    if (scenario === 'the_four_islands' && candidate.some(hex => ['forest','pasture'].includes(hex.terrain) && [2,3,11,12].includes(hex.number))) continue;
    if (['heading_for_new_shores','through_the_desert'].includes(scenario) && candidate.some(hex =>
      [6,8].includes(hex.number) && (hex.terrain === 'gold' && scenario === 'through_the_desert' ||
      candidate.some(other => other !== hex && [6,8].includes(other.number) && adjacent(hex,other))))) continue;
    return candidate;
  }
  throw new Error('Could not satisfy official variable number-disc restrictions');
}

function assignIslandRegions(layout) {
  const byKey = new Map(layout.map(hex => [keyForHex(hex), hex]));
  let island = 0;
  for (const hex of layout) {
    if (hex.terrain === 'sea' || hex.region) continue;
    const region = `island-${++island}`;
    const queue = [hex];
    hex.region = region;
    for (const current of queue) for (const [dq,dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]) {
      const next = byKey.get(G.hexKey(current.q + dq, current.r + dr));
      if (next && next.terrain !== 'sea' && !next.region) { next.region = region; queue.push(next); }
    }
  }
}

function buildBoard(game, map, options) {
  const random = seededRandom(options.setup.seed ?? 0);
  let layout = map.hexes.map(hex => ({ ...hex }));
  if (options.setup.layout === 'variable' && map.scenario !== 'new_world') layout = applyVariableSetup(layout, map, random);
  if (map.scenario === 'new_world') {
    layout = generateNewWorld(map, random, options.setup, game.players.length);
    assignIslandRegions(layout);
  }
  if (map.randomMainIsland) {
    const slots = layout.filter(hex => hex.terrain === 'random');
    const pool = shuffleWith(flattenPool(map.randomMainIsland.terrainPool), random);
    if (slots.length !== pool.length) throw new Error('Main-island pool does not fit map');
    slots.forEach((hex, index) => { hex.terrain = pool[index]; });
    const sequence = map.mainNumberDiscSequence;
    if (!Array.isArray(sequence)) throw new Error('Main-island number sequence is unavailable');
    const main = layout.filter(hex => hex.region === 'main');
    const qOffset = Math.min(...main.filter(hex => hex.r === Math.min(...main.map(x => x.r))).map(hex => hex.q));
    const spiral = [[0,-3],[-1,-2],[-2,-1],[-3,0],[-3,1],[-3,2],[-3,3],[-2,3],[-1,3],
      [0,2],[1,1],[2,0],[2,-1],[2,-2],[2,-3],[1,-3],[0,-2],[-1,-1],[-2,0],[-2,1],[-2,2],[-1,2],[0,1],[1,0],[1,-1],[1,-2],[0,-1],[-1,0],[-1,1],[0,0]];
    let numberIndex = 0;
    for (const [q,r] of spiral) {
      const hex = main.find(candidate => candidate.q === q + qOffset && candidate.r === r);
      if (!hex) throw new Error('Main-island spiral does not fit map');
      hex.number = hex.terrain === 'desert' ? null : sequence[numberIndex++];
    }
    if (numberIndex !== sequence.length) throw new Error('Main-island number sequence is incomplete');
  }
  const fogSlots = layout.filter(hex => hex.terrain === 'fog');
  // Fog contents are private; the public layout seed must not predict either pile.
  const fogTerrain = fogSlots.length ? shuffleWith(flattenPool(map.fogPool?.terrain), Math.random) : [];
  const fogNumbers = fogSlots.length ? shuffleWith(flattenPool(map.fogPool?.numbers).map(Number), Math.random) : [];
  if (fogSlots.length && fogTerrain.length !== fogSlots.length) throw new Error('Fog pool does not fit map');
  game.hexes = Object.fromEntries(layout.map(hex => [keyForHex(hex), makeHex(hex)]));
  game.vertices = {};
  game.edges = {};
  for (const hex of layout) for (let direction = 0; direction < 6; direction++) {
    game.vertices[G.vertexKey(hex.q, hex.r, direction)] = { building: null, owner: null };
    game.edges[G.edgeKey(hex.q, hex.r, direction)] = { road: false, ship: false, owner: null };
  }
  const variablePorts = options.setup.layout === 'variable' && !map.portPool && map.variableSetup?.ports;
  const shuffledPortTypes = variablePorts ? shuffleWith(map.ports.map(port => port.type), random) : null;
  const sourcePorts = variablePorts ? map.ports.map((port,index) => ({ ...port, type: shuffledPortTypes[index] })) : (map.ports || []);
  const randomPortTypes = shuffleWith(flattenPool(map.portPool), random);
  const randomPortSlots = sourcePorts.filter(port => port.type === 'random').length;
  if (randomPortSlots !== randomPortTypes.length) throw new Error('Random port pool does not fit map');
  let randomPortIndex = 0;
  game.ports = sourcePorts.map((port, index) => {
    const edge = edgeFromPosition(port);
    const [a,b] = edgeEndpoints(edge);
    const type = port.type === 'random' ? randomPortTypes[randomPortIndex++] : port.type;
    const resource = PORT_RESOURCE[type];
    if (resource === undefined) throw new Error('Unknown port type');
    return { id: index, edge, vertices: [a,b], type, ratio: resource ? 2 : 3, resource,
      name: resource ? `${resource} port` : '3:1 Port' };
  });
  const robberOnTwelve = options.setup.layout === 'variable' && ['the_four_islands','the_fog_islands','cloth_for_catan'].includes(map.scenario) ||
    options.setup.layout === 'variable' && map.scenario === 'heading_for_new_shores' && map.players === 3;
  const robberStart = map.robberStart;
  const robberHex = robberOnTwelve ? layout.find(hex => hex.number === 12)
    : robberStart?.kind === 'hex' ? layout.find(hex => hex.q === robberStart.hex.q && hex.r === robberStart.hex.r)
    : robberStart?.kind === 'random_desert' ? shuffleWith(layout.filter(hex => hex.terrain === 'desert'), random)[0]
    : robberStart?.kind === 'frame' ? null : layout.find(hex => hex.terrain === 'desert');
  game.robber = robberHex ? keyForHex(robberHex) : null;
  game.pirate = map.pirateStart?.kind === 'sea' ? keyForHex(map.pirateStart.hex)
    : map.pirateStart?.kind === 'frame' ? `frame:${map.pirateStart.edge}` : null;
  return { random, fogTerrain, fogNumbers };
}

export function configureSeafarers(game, options) {
  if (game.phase !== 'waiting') return fail('Game rules are locked');
  const found = mapForScenario(options?.scenario, game.players.length);
  if (!found) return fail('This scenario does not support the selected player count');
  const [mapKey, map] = found;
  const layout = options?.setup?.layout || 'fixed';
  if (!['fixed', 'variable'].includes(layout) || (options?.setup?.seed !== null &&
    (!Number.isInteger(options?.setup?.seed) || options.setup.seed < 0 || options.setup.seed > 0xffffffff))) {
    return fail('Choose a valid scenario layout and random seed');
  }
  const valid = validateMap(map, layout);
  if (!valid.success) return valid;
  if (options.scenario === 'new_world') {
    const custom = validateNewWorldSetup(options.setup, game.players.length);
    if (!custom.success) return custom;
  } else if (options.setup?.terrainMix !== undefined || options.setup?.hexSwaps !== undefined) {
    return fail('Custom terrain and island shapes are available in New World');
  }
  try {
    const copy = structuredClone(game);
    const normalizedOptions = structuredClone(options);
    normalizedOptions.setup.seed ??= Math.floor(Math.random() * 0x100000000);
    const privateSetup = buildBoard(copy, map, normalizedOptions);
    copy.gameOptions = normalizedOptions;
    copy.pendingChoice = null;
    copy.seafarers = {
      scenario: options.scenario, mapKey, layout, seed: normalizedOptions.setup.seed, goal: scenarioFor(options.scenario).goal,
      pirateFrameStart: map.pirateStart?.kind === 'frame' ? structuredClone(map.pirateStart) : null,
      robberFrameStart: map.robberStart?.kind === 'frame' ? structuredClone(map.robberStart) : null,
      shipMovedThisPhase: false, builtShips: [],
      currentPortType: null, portDrawPile: [],
      fogTerrainPile: privateSetup.fogTerrain, fogNumberPile: privateSetup.fogNumbers,
      choiceQueue: [],
      rewards: (map.edgeRewards || []).map((reward, index) => ({ id: index, kind: reward.kind, edge: edgeFromPosition(reward), collected: false })),
      rewardDeck: [],
      villages: (map.villages || []).flatMap(village => village.numbers.map((number, position) => ({
        hexKey: keyForHex(village.hex),
        vertexKey: G.vertexKey(village.vertex?.hex.q ?? village.hex.q, village.vertex?.hex.r ?? village.hex.r,
          village.vertex?.dir ?? position * 3),
        numbers: [number], cloth: village.cloth
      }))).map((village, index) => ({ ...village, id: index })),
      portInventory: map.collectiblePorts || [],
      collectiblePorts: (map.collectiblePorts || []).map((port, index) => ({ id: index,
        edge: edgeFromPosition(port), type: port.type, collected: false })),
      collectiblePortTypes: shuffleWith(flattenPool(map.collectiblePortPool), Math.random),
      pendingPortClaims: [],
      homeRegions: {}, bonusRegions: {},
      bonusSettlements: [],
      fleetRoute: map.fleetRouteClockwise || [], fleetIndex: map.fleetStartRouteIndex ?? 0,
      fortresses: (map.fortressVertices || []).filter(item => !item.onlyPlayers || item.onlyPlayers === game.players.length)
        .map(item => ({ color: item.color, vertexKey: G.vertexKey(item.hex.q, item.hex.r, item.dir), lairs: 3, capturedBy: null })),
      beachheads: (map.beachheadVertices || []).filter(item => !item.onlyPlayers || item.onlyPlayers === game.players.length)
        .map(item => ({ color: item.color, vertexKey: G.vertexKey(item.hex.q, item.hex.r, item.dir) })),
      wonders: [],
      wonderMarkers: Object.fromEntries(['greatWallVertices','greatBridgeVertices','greatBridgeAdjacentXVertices','lighthouseVertices','lighthouseAdjacentXVertices']
        .map(field => [field, (map[field] || []).map(position => G.vertexKey(position.hex.q, position.hex.r, position.dir))])),
      clothSupply: map.setup?.clothGeneralSupply || 0,
      villageRelations: {},
      fleetActive: options.scenario === 'the_pirate_islands',
      origins: {},
      originsShip: {},
      voyageEdges: {},
    };
    for (const player of copy.players) { player.ships = 15; player.cloth = 0; player.warships = 0; player.bonusVictoryPoints = 0; }
    const rewardCards = copy.seafarers.rewards.filter(reward => reward.kind === 'development_card').length;
    copy.seafarers.rewardDeck = copy.devCardDeck.splice(0, rewardCards);
    Object.keys(game).forEach(key => delete game[key]);
    Object.assign(game, copy);
    return { success: true };
  } catch (error) {
    return fail(error.message || 'Scenario map could not be initialized');
  }
}

/** Public preview and live setup share buildBoard, seed and swap order. */
export function previewNewWorldSetup(options, count) {
  const found = mapForScenario('new_world', count);
  if (!found || options?.scenario !== 'new_world') return fail('Choose New World to preview its board');
  const [, map] = found;
  const setup = options.setup || {};
  if ((setup.layout || 'variable') !== 'variable' || (setup.seed != null &&
      (!Number.isSafeInteger(setup.seed) || setup.seed < 0 || setup.seed > 0xffffffff))) return fail('Choose a valid New World seed');
  const custom = validateNewWorldSetup(setup, count);
  if (!custom.success) return custom;
  const valid = validateMap(map, 'variable');
  if (!valid.success) return valid;
  const normalized = structuredClone(options);
  normalized.setup = { layout: 'variable', seed: setup.seed ?? Math.floor(Math.random() * 0x100000000), ...custom.setup };
  try {
    const draft = { players: Array(count), hexes: {}, vertices: {}, edges: {}, ports: [] };
    buildBoard(draft, map, normalized);
    return { success: true, gameOptions: normalized,
      boardPreview: { hexes: structuredClone(draft.hexes), seed: normalized.setup.seed } };
  } catch (error) { return fail(error.message || 'Could not preview New World'); }
}

export function isSeafarers(game) { return Boolean(game.seafarers); }
export function needsThirdSetup(game) { return game.seafarers?.scenario === 'cloth_for_catan'; }
export function isPirateIslands(game) { return game.seafarers?.scenario === 'the_pirate_islands'; }

function randomResourceLoss(game, playerIndex, count) {
  const player = game.players[playerIndex];
  for (let take = 0; take < count; take++) {
    const cards = RESOURCE_TYPES.flatMap(resource => Array(player.resources[resource]).fill(resource));
    if (!cards.length) break;
    const resource = cards[Math.floor(Math.random() * cards.length)];
    player.resources[resource]--;
    game.bank[resource]++;
  }
}

export function onDiceRolled(game, die1, die2) {
  if (!isPirateIslands(game) || !game.seafarers.fleetActive) return { success: true };
  const state = game.seafarers;
  if (!state.fleetRoute.length) return fail('Pirate fleet route is unavailable');
  const strength = Math.min(die1, die2);
  state.fleetIndex = (state.fleetIndex + strength) % state.fleetRoute.length;
  const stop = state.fleetRoute[state.fleetIndex];
  game.pirate = keyForHex(stop);
  if (stop.noAttack) return { success: true };
  const attacked = G.getPlayersOnHex(game, game.pirate, -1);
  for (const index of attacked) {
    const player = game.players[index];
    if (player.warships < strength) {
      const cities = new Set(Object.entries(game.vertices).filter(([,vertex]) => vertex.owner === index && vertex.building === 'city')
        .map(([key]) => canonicalVertex(game, key)));
      randomResourceLoss(game, index, 1 + cities.size);
    } else if (player.warships > strength) {
      const options = RESOURCE_TYPES.filter(resource => game.bank[resource] > 0)
        .map(resource => ({ id: resource, label: resource[0].toUpperCase() + resource.slice(1), resource }));
      if (options.length) state.choiceQueue.push({ kind: 'fleetReward', playerId: player.id });
    }
  }
  advanceChoiceQueue(game);
  return { success: true };
}

export function queuePirateSeven(game) {
  if (!isPirateIslands(game)) return;
  const actorId = game.players[game.currentPlayerIndex].id;
  const options = game.players.filter(player => player.id !== actorId && RESOURCE_TYPES.some(resource => player.resources[resource] > 0))
    .map(player => ({ id: player.id, label: player.name || player.id }));
  if (!options.length) { game.turnPhase = 'main'; return; }
  game.pendingChoice = { id: crypto.randomUUID(), kind: 'pirateSeven', actorId,
    label: 'Choose a player to take one random resource from', options, resumePhase: 'main' };
}

export function convertWarship(game, playerId) {
  if (!isPirateIslands(game)) return fail('Warships are unavailable');
  const index = game.players.findIndex(player => player.id === playerId);
  const origin = game.seafarers.origins?.[playerId];
  if (!origin) return fail('Pirate origin is unavailable');
  const queue = [{ vertex: canonicalVertex(game, origin), distance: 0 }];
  const visited = new Set();
  const candidates = [];
  for (const { vertex, distance } of queue) {
    if (visited.has(vertex)) continue;
    visited.add(vertex);
    for (const route of incidentRoutes(game, vertex, index)) if (route.edge.ship) {
      if (!route.edge.warship) candidates.push({ route, distance });
      const next = edgeEndpoints(route.key).map(key => canonicalVertex(game, key)).find(key => key !== vertex);
      if (next && !visited.has(next)) queue.push({ vertex: next, distance: distance + 1 });
    }
  }
  candidates.sort((a,b) => a.distance - b.distance || a.route.key.localeCompare(b.route.key));
  if (!candidates.length) return fail('No ordinary ship is available to become a warship');
  candidates[0].route.edge.warship = true;
  game.players[index].warships++;
  return { success: true, edgeKey: candidates[0].route.key };
}

function awardCloth(game, playerIndex, amount) {
  if (amount <= 0) return;
  const player = game.players[playerIndex];
  const before = Math.floor(player.cloth / 2);
  player.cloth += amount;
  player.victoryPoints += Math.floor(player.cloth / 2) - before;
  G.checkWinner(game);
}

function connectedToVillage(game, playerIndex, village) {
  const target = canonicalVertex(game, village.vertexKey);
  const visited = new Set();
  const queue = [];
  for (const [key, vertex] of Object.entries(game.vertices)) {
    if (vertex.owner !== playerIndex || !vertex.building) continue;
    const canonical = canonicalVertex(game, key);
    if (!visited.has(`${canonical}:false`)) { visited.add(`${canonical}:false`); queue.push({ vertex: canonical, sailed: false }); }
  }
  for (const { vertex, sailed } of queue) {
    if (sailed && vertex === target) return true;
    for (const route of incidentRoutes(game, vertex, playerIndex)) {
      if (!route.edge.ship) continue;
      const next = edgeEndpoints(route.key).map(key => canonicalVertex(game, key)).find(key => key !== vertex);
      const blocker = buildingAt(game, next)?.vertex;
      if (blocker?.owner != null && blocker.owner !== playerIndex) continue;
      if (next && !visited.has(`${next}:true`)) { visited.add(`${next}:true`); queue.push({ vertex: next, sailed: true }); }
    }
  }
  return false;
}

export function refreshVillageRelations(game) {
  if (game.seafarers?.scenario !== 'cloth_for_catan') return;
  const state = game.seafarers;
  for (const [index, player] of game.players.entries()) for (const village of state.villages) {
    const key = `${player.id}:${village.id}`;
    if (!state.villageRelations[key] && connectedToVillage(game, index, village)) {
      state.villageRelations[key] = true;
      if (village.cloth > 0) { village.cloth--; awardCloth(game, index, 1); }
    }
  }
}

export function onProduction(game, total) {
  if (game.seafarers?.scenario !== 'cloth_for_catan') return;
  const state = game.seafarers;
  for (const village of state.villages) {
    if (!village.numbers?.includes(total) || village.cloth <= 0) continue;
    const recipients = game.players.map((player, index) => state.villageRelations[`${player.id}:${village.id}`] ? index : -1).filter(index => index >= 0);
    for (const index of recipients) {
      if (village.cloth > 0) village.cloth--;
      else if (state.clothSupply > 0) state.clothSupply--;
      else continue;
      awardCloth(game, index, 1);
    }
  }
}

export function edgeEndpoints(edgeKey) {
  const match = /^e_(-?\d+)_(-?\d+)_([0-5])$/.exec(edgeKey || '');
  if (!match) return [];
  return G.getEdgeVertices(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function equivalentEdges(edgeKey) {
  const match = /^e_(-?\d+)_(-?\d+)_([0-5])$/.exec(edgeKey || '');
  if (!match) return [];
  return G.getEquivalentEdges(Number(match[1]), Number(match[2]), Number(match[3])).map(value => G.edgeKey(value.q, value.r, value.dir));
}

export function canonicalEdge(game, edgeKey) {
  return equivalentEdges(edgeKey).filter(key => game.edges[key]).sort()[0] || null;
}

export function canonicalVertex(game, vertexKey) {
  const match = /^v_(-?\d+)_(-?\d+)_([0-5])$/.exec(vertexKey || '');
  if (!match) return null;
  return G.getEquivalentVertices(Number(match[1]), Number(match[2]), Number(match[3]))
    .map(value => G.vertexKey(value.q, value.r, value.dir)).filter(key => game.vertices[key]).sort()[0] || null;
}

export function edgeHexes(game, edgeKey) {
  return equivalentEdges(edgeKey).map(key => {
    const match = /^e_(-?\d+)_(-?\d+)_([0-5])$/.exec(key);
    return game.hexes[G.hexKey(Number(match[1]), Number(match[2]))];
  }).filter(Boolean);
}

function isShipEdge(game, edgeKey) {
  const hexes = edgeHexes(game, edgeKey);
  return hexes.some(hex => hex.terrain === 'sea' || hex.terrain === 'fog') || hexes.length === 1;
}

function pirateWaterDistance(game, playerIndex) {
  const waterEdges = [...new Set(Object.keys(game.edges).map(edge => canonicalEdge(game, edge)).filter(Boolean))]
    .filter(edge => isShipEdge(game, edge) &&
      (!occupiedEdge(game, edge) || occupiedEdge(game, edge)?.edge.owner === playerIndex));
  const links = new Map();
  for (const edge of waterEdges) {
    const [a,b] = edgeEndpoints(edge).map(vertex => canonicalVertex(game, vertex));
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b); links.get(b).push(a);
  }
  return (from,to) => {
    const seen = new Map([[from,0]]);
    const pending = [from];
    for (const vertex of pending) {
      if (vertex === to) return seen.get(vertex);
      for (const next of links.get(vertex) || []) if (!seen.has(next)) { seen.set(next, seen.get(vertex) + 1); pending.push(next); }
    }
    return Infinity;
  };
}

export function occupiedEdge(game, edgeKey) {
  return equivalentEdges(edgeKey).map(key => ({ key, edge: game.edges[key] })).find(({ edge }) => edge?.road || edge?.ship) || null;
}

export function buildingAt(game, vertexKey) {
  const match = /^v_(-?\d+)_(-?\d+)_([0-5])$/.exec(vertexKey || '');
  if (!match) return null;
  return G.getEquivalentVertices(Number(match[1]), Number(match[2]), Number(match[3]))
    .map(value => ({ key: G.vertexKey(value.q, value.r, value.dir), vertex: game.vertices[G.vertexKey(value.q, value.r, value.dir)] }))
    .find(({ vertex }) => vertex?.building) || null;
}

export function incidentRoutes(game, vertexKey, owner = null) {
  const found = new Map();
  for (const edgeKey of G.getVertexEdges(vertexKey)) {
    const occupied = occupiedEdge(game, edgeKey);
    if (occupied && (owner == null || occupied.edge.owner === owner)) {
      found.set(canonicalEdge(game, occupied.key), occupied);
    }
  }
  return [...found.values()];
}

function selectPirateVoyage(game, playerIndex, candidateKey, beachhead, distance, preplacedEdge) {
  const endpoints = edgeEndpoints(candidateKey).map(vertex => canonicalVertex(game, vertex));
  const found = [];
  for (const near of endpoints) {
    const tip = endpoints.find(vertex => vertex !== near);
    const visit = (vertex, backwards, seen) => {
      const building = buildingAt(game, vertex)?.vertex;
      if (building?.owner === playerIndex && G.getVertexAdjacentHexes(game, vertex).some(hex => hex.region === 'east')) {
        const route = [...backwards].reverse().concat(candidateKey);
        if (route.length + distance(tip, beachhead) === distance(vertex, beachhead)) {
          found.push({ origin: vertex, firstEdge: route[0], route });
        }
      }
      if (backwards.length >= 14) return;
      for (const occupied of incidentRoutes(game, vertex, playerIndex)) {
        if (!occupied.edge.ship) continue;
        const edge = canonicalEdge(game, occupied.key);
        if (edge === candidateKey || edge !== preplacedEdge && !edgeHexes(game, edge).some(hex => hex.region === 'east')) continue;
        const next = edgeEndpoints(edge).map(value => canonicalVertex(game, value)).find(value => value !== vertex);
        if (!next || seen.has(next)) continue;
        visit(next, [...backwards, edge], new Set([...seen, next]));
      }
    };
    visit(near, [], new Set([near]));
  }
  found.sort((a,b) => a.route.length - b.route.length || a.origin.localeCompare(b.origin) || a.route.join().localeCompare(b.route.join()));
  return found;
}

export function canPlaceShip(game, playerId, edgeKey, { setup = false, lastSettlement = null, movingFrom = null } = {}) {
  if (!isSeafarers(game)) return { valid: false, error: 'Ships are unavailable' };
  const playerIndex = game.players.findIndex(player => player.id === playerId);
  if (playerIndex < 0) return { valid: false, error: 'Player not found' };
  const edge = game.edges[edgeKey];
  if (!edge || !canonicalEdge(game, edgeKey)) return { valid: false, error: 'Invalid edge' };
  if (occupiedEdge(game, edgeKey)) return { valid: false, error: 'Edge is occupied' };
  if (!isShipEdge(game, edgeKey)) return { valid: false, error: 'A ship needs a sea or inner-frame edge' };
  if (edgeHexes(game, edgeKey).some(hex => G.hexKey(hex.q, hex.r) === game.pirate)) return { valid: false, error: 'Pirate blocks this ship' };
  if (!setup && (game.phase !== 'playing' || !['main', ...(game.freeRoads > 0 ? ['roll'] : [])].includes(game.turnPhase) || game.currentPlayerIndex !== playerIndex)) return { valid: false, error: 'Cannot build now' };
  if (setup && (game.phase !== 'setup' || game.currentPlayerIndex !== playerIndex)) return { valid: false, error: 'Cannot place a setup ship now' };
  if (!movingFrom && game.players[playerIndex].ships < 1) return { valid: false, error: 'No ships left' };
  const [a,b] = edgeEndpoints(edgeKey);
  const connected = [a,b].some(vertexKey => {
    const building = buildingAt(game, vertexKey)?.vertex;
    if (building?.owner !== undefined && building?.owner !== null && building.owner !== playerIndex) return false;
    if (setup) return G.areVerticesEqual(vertexKey, lastSettlement);
    if (building?.owner === playerIndex) return true;
    return incidentRoutes(game, vertexKey, playerIndex).some(route => route.edge.ship && canonicalEdge(game, route.key) !== canonicalEdge(game, edgeKey));
  });
  if (!connected) return { valid: false, error: 'Ship must connect to your ship or building' };
  let path = null;
  if (!setup && isPirateIslands(game)) {
    path = validatePirateShipLine(game, playerId, edgeKey);
    if (!path.valid) return path;
  }
  if (!setup && !movingFrom && game.freeRoads < 1 && (game.players[playerIndex].resources.lumber < 1 || game.players[playerIndex].resources.wool < 1)) return { valid: false, error: 'Need one lumber and one wool' };
  return { valid: true, voyage: path?.voyage || false,
    newVoyage: path?.newVoyage || null, newVoyageChoices: path?.newVoyageChoices || null };
}

function validatePirateShipLine(game, playerId, candidateEdge) {
  const state = game.seafarers;
  const index = game.players.findIndex(player => player.id === playerId);
  const beachhead = canonicalVertex(game, state.beachheads.find(marker => marker.ownerId === playerId)?.vertexKey);
  const fortress = canonicalVertex(game, state.fortresses.find(marker => marker.ownerId === playerId)?.vertexKey);
  if (!beachhead || !fortress) return { valid: false, error: 'Pirate route markers are unavailable' };
  const candidate = structuredClone(game);
  candidate.edges[candidateEdge] = { road: false, ship: true, owner: index, warship: false };
  const candidateKey = canonicalEdge(candidate, candidateEdge);
  const distance = pirateWaterDistance(candidate, index);
  if (!state.voyageEdges?.[playerId]?.length) {
    if (edgeHexes(candidate, candidateKey).some(hex => hex.region === 'east')) return { valid: true, voyage: false };
    const candidates = selectPirateVoyage(candidate, index, candidateKey, beachhead, distance, state.originsShip[playerId]);
    if (candidates.length === 1) return { valid: true, voyage: true, newVoyage: candidates[0] };
    if (candidates.length > 1) return { valid: true, voyage: true, newVoyageChoices: candidates };
    return { valid: false, error: 'Begin a shortest western voyage at one of your eastern coastal buildings' };
  }
  const origin = canonicalVertex(candidate, state.origins[playerId]);
  if (!origin) return { valid: false, error: 'Pirate route origin is unavailable' };
  const routeEdges = new Map();
  for (const key of state.voyageEdges[playerId]) {
    const owned = occupiedEdge(candidate, key);
    if (owned?.edge.ship && owned.edge.owner === index) routeEdges.set(canonicalEdge(candidate, key), owned);
  }
  if (!routeEdges.has(state.originsShip[playerId])) return { valid: false, error: 'The island shipping line has lost its starting ship' };
  const existingDegrees = new Map();
  for (const key of routeEdges.keys()) for (const vertex of edgeEndpoints(key).map(value => canonicalVertex(candidate, value))) {
    existingDegrees.set(vertex, (existingDegrees.get(vertex) || 0) + 1);
  }
  const existingTip = [...existingDegrees].find(([vertex, degree]) => vertex !== origin && degree === 1)?.[0];
  const candidateVertices = edgeEndpoints(candidateKey).map(value => canonicalVertex(candidate, value));
  if (!candidateVertices.includes(existingTip)) {
    const onHomeIsland = edgeHexes(candidate, candidateKey).some(hex => hex.region === 'east');
    const touchesMiddle = candidateVertices.some(vertex => vertex !== origin && existingDegrees.has(vertex));
    if (onHomeIsland && !touchesMiddle) return { valid: true, voyage: false };
    return { valid: false, error: 'The island shipping line must extend from its open end' };
  }
  if (existingDegrees.has(fortress)) return { valid: false, error: 'The island shipping line ends at the fortress' };
  routeEdges.set(candidateKey, { key: candidateEdge, edge: candidate.edges[candidateEdge] });
  const reachable = new Set([...routeEdges.keys()].flatMap(key => edgeEndpoints(key).map(vertex => canonicalVertex(candidate, vertex))));
  const degrees = new Map();
  for (const key of routeEdges.keys()) for (const vertex of edgeEndpoints(key).map(value => canonicalVertex(candidate, value))) {
    degrees.set(vertex, (degrees.get(vertex) || 0) + 1);
  }
  if ([...degrees.values()].some(degree => degree > 2) || degrees.get(origin) > 1) {
    return { valid: false, error: 'The pirate-island shipping line cannot branch' };
  }
  const tips = [...degrees].filter(([,degree]) => degree === 1).map(([vertex]) => vertex);
  if (tips.length !== 2 || !tips.includes(origin)) return { valid: false, error: 'The pirate-island shipping line cannot loop' };
  const tip = tips.find(vertex => vertex !== origin);
  if (reachable.has(fortress) && !reachable.has(beachhead)) return { valid: false, error: 'Reach your beachhead before the fortress' };
  const shortestToBeachhead = distance(origin, beachhead);
  const shortestFromBeachhead = distance(beachhead, fortress);
  const remaining = reachable.has(beachhead) ? distance(tip, fortress) : distance(tip, beachhead);
  const allowedLength = reachable.has(beachhead) ? shortestToBeachhead + shortestFromBeachhead : shortestToBeachhead;
  if (!Number.isFinite(allowedLength) || routeEdges.size + remaining > allowedLength) {
    return { valid: false, error: 'The pirate-island shipping line must take a shortest route' };
  }
  return { valid: true, voyage: true };
}

function commitPirateVoyage(game, playerId, route) {
  game.seafarers.origins[playerId] = route.origin;
  game.seafarers.originsShip[playerId] = route.firstEdge;
  game.seafarers.voyageEdges[playerId] = [...route.route];
}

function choosePirateVoyage(game, playerId, routes) {
  game.pendingChoice = { id: crypto.randomUUID(), kind: 'pirateVoyageOrigin', actorId: playerId,
    label: 'Choose the coastal building where your western voyage starts',
    options: routes.map((route, index) => ({ id: String(index), label: `Coastal building ${index + 1}`,
      vertexKey: route.origin, edgeKey: route.firstEdge })),
    context: { routes }, resumePhase: game.turnPhase };
  G.refreshPlayerTradingAllowed(game);
}

export function placeShip(game, playerId, edgeKey, options = {}) {
  const valid = canPlaceShip(game, playerId, edgeKey, options);
  if (!valid.valid) return fail(valid.error);
  const playerIndex = game.players.findIndex(player => player.id === playerId);
  const player = game.players[playerIndex];
  if (!options.movingFrom) {
    if (!options.setup && game.freeRoads > 0) game.freeRoads--;
    else if (!options.setup) { player.resources.lumber--; player.resources.wool--; game.bank.lumber++; game.bank.wool++; }
    player.ships--;
  }
  game.edges[edgeKey] = { road: false, ship: true, owner: playerIndex, warship: false };
  if (isPirateIslands(game) && valid.newVoyage) commitPirateVoyage(game, playerId, valid.newVoyage);
  else if (isPirateIslands(game) && valid.newVoyageChoices) choosePirateVoyage(game, playerId, valid.newVoyageChoices);
  else if (isPirateIslands(game) && valid.voyage) game.seafarers.voyageEdges[playerId].push(canonicalEdge(game, edgeKey));
  if (!options.setup && !options.movingFrom) game.seafarers.builtShips.push(canonicalEdge(game, edgeKey));
  onRoutePlaced(game, playerId, edgeKey, 'ship');
  G.updateLongestRoad(game);
  G.checkWinner(game);
  return { success: true };
}

export function canPlaceRoadOnSeafarers(game, edgeKey) {
  if (!isSeafarers(game)) return { valid: true };
  if (occupiedEdge(game, edgeKey)) return { valid: false, error: 'Edge is occupied' };
  if (!edgeHexes(game, edgeKey).some(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog')) return { valid: false, error: 'Road needs a land edge' };
  return { valid: true };
}

export function canReachSettlementByShip(game, playerIndex, vertexKey) {
  return incidentRoutes(game, vertexKey, playerIndex).some(route => route.edge.ship);
}

function adjacentLandRegions(game, vertexKey) {
  return [...new Set(G.getVertexAdjacentHexes(game, vertexKey)
    .filter(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog')
    .map(hex => hex.region).filter(Boolean))];
}

export function canPlaceScenarioSettlement(game, vertexKey, setup) {
  if (!isSeafarers(game)) return { valid: true };
  const scenario = game.seafarers.scenario;
  const adjacent = G.getVertexAdjacentHexes(game, vertexKey);
  if (!adjacent.some(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog')) return { valid: false, error: 'Settlement needs land' };
  if (scenario === 'the_forgotten_tribe' && !adjacent.some(hex => hex.number)) return { valid: false, error: 'The tribe permits settlements only beside numbered land' };
  if (scenario === 'cloth_for_catan' && adjacentLandRegions(game, vertexKey).every(region => !['north', 'south'].includes(region))) {
    return { valid: false, error: 'Settlements stay on the two main islands' };
  }
  if (scenario === 'the_wonders_of_catan' && setup) {
    const forbidden = ['greatWallVertices','greatBridgeVertices','greatBridgeAdjacentXVertices','lighthouseVertices','lighthouseAdjacentXVertices']
      .flatMap(field => game.seafarers.wonderMarkers[field] || []);
    if (forbidden.some(marker => G.areVerticesEqual(vertexKey, marker))) return { valid: false, error: 'That wonder marker is unavailable for a starting settlement' };
  }
  if (scenario === 'the_pirate_islands' && !setup && !adjacentLandRegions(game, vertexKey).includes('east')) {
    const own = game.players[game.currentPlayerIndex]?.id;
    if (!game.seafarers.beachheads.some(marker => marker.ownerId === own && G.areVerticesEqual(marker.vertexKey, vertexKey))) {
      return { valid: false, error: 'You may settle only your own beachhead beyond the home island' };
    }
  }
  if (setup && ['heading_for_new_shores','through_the_desert','the_forgotten_tribe','the_pirate_islands','the_wonders_of_catan'].includes(scenario) &&
      !adjacentLandRegions(game, vertexKey).includes(scenario === 'the_pirate_islands' ? 'east' : 'main')) {
    return { valid: false, error: 'Place your starting settlement on the home island' };
  }
  return { valid: true };
}

export function onSettlementPlaced(game, playerIndex, vertexKey, setup) {
  if (!isSeafarers(game)) return;
  const state = game.seafarers;
  const player = game.players[playerIndex];
  const regions = adjacentLandRegions(game, vertexKey);
  if (!setup && state.scenario === 'the_forgotten_tribe') advanceChoiceQueue(game);
  const home = state.homeRegions[player.id] || [];
  if (setup) {
    state.homeRegions[player.id] = [...new Set([...home, ...regions])];
    return;
  }
  const bonus = ['heading_for_new_shores','the_four_islands','through_the_desert'].includes(state.scenario) ? 2
    : ['new_world','the_wonders_of_catan'].includes(state.scenario) ? 1 : 0;
  if (!bonus) return;
  const claimed = state.bonusRegions[player.id] || [];
  for (const region of regions) {
    if (home.includes(region) || claimed.includes(region) || region === 'main') continue;
    claimed.push(region);
    player.victoryPoints += bonus;
    player.bonusVictoryPoints += bonus;
    state.bonusSettlements.push({ playerId: player.id, vertexKey, region, points: bonus });
    break;
  }
  state.bonusRegions[player.id] = claimed;
}

export function calculateSeaRouteLength(game, playerIndex) {
  if (!isSeafarers(game)) return 0;
  const routes = new Map();
  for (const [key, edge] of Object.entries(game.edges)) if ((edge.road || edge.ship) && edge.owner === playerIndex) {
    const canonical = canonicalEdge(game, key);
    routes.set(canonical, { key: canonical, kind: edge.ship ? 'ship' : 'road', endpoints: edgeEndpoints(canonical).map(v => canonicalVertex(game, v)) });
  }
  if (!routes.size) return 0;
  const byVertex = new Map();
  for (const route of routes.values()) for (const vertex of route.endpoints) {
    if (!byVertex.has(vertex)) byVertex.set(vertex, []);
    byVertex.get(vertex).push(route);
  }
  let longest = 0;
  const used = new Set();
  const walk = (route, atVertex, length) => {
    longest = Math.max(longest, length);
    const building = buildingAt(game, atVertex)?.vertex;
    if (building?.owner != null && building.owner !== playerIndex) return;
    for (const next of byVertex.get(atVertex) || []) {
      if (used.has(next.key)) continue;
      if (route.kind !== next.kind && building?.owner !== playerIndex) continue;
      used.add(next.key);
      walk(next, next.endpoints.find(vertex => vertex !== atVertex), length + 1);
      used.delete(next.key);
    }
  };
  for (const route of routes.values()) for (const endpoint of route.endpoints) {
    used.add(route.key);
    walk(route, endpoint, 1);
    used.delete(route.key);
  }
  return longest;
}

export function isScenarioWinner(game, player, totalVP) {
  if (!isSeafarers(game)) return totalVP >= 10;
  const state = game.seafarers;
  if (state.scenario === 'the_pirate_islands') {
    return totalVP >= state.goal && state.fortresses.some(fortress => fortress.capturedBy === player.id);
  }
  if (state.scenario === 'the_wonders_of_catan') {
    const ownLevel = state.wonders.find(wonder => wonder.ownerId === player.id)?.level || 0;
    return ownLevel >= 4 || (totalVP >= state.goal && ownLevel > 0 && state.wonders.every(wonder => wonder.ownerId === player.id || wonder.level < ownLevel));
  }
  return totalVP >= state.goal;
}

function wonderQualifies(game, playerIndex, wonderId) {
  const state = game.seafarers;
  const player = game.players[playerIndex];
  const hasMarker = field => state.wonderMarkers[field]?.some(vertex => buildingAt(game, vertex)?.vertex?.owner === playerIndex);
  const cities = new Set(Object.entries(game.vertices).filter(([,vertex]) => vertex.owner === playerIndex && vertex.building === 'city')
    .map(([key]) => canonicalVertex(game, key)));
  switch (wonderId) {
    case 'great_wall': return hasMarker('greatWallVertices');
    case 'great_bridge': return hasMarker('greatBridgeVertices');
    case 'lighthouse': return hasMarker('lighthouseVertices');
    case 'grand_theater': case 'great_library': return cities.size >= 2;
    case 'grand_castle': return cities.size >= 1 && player.victoryPoints + player.hiddenVictoryPoints >= 6;
    case 'grand_monument': return calculateSeaRouteLength(game, playerIndex) >= 5 && game.ports.some(port =>
      port.vertices.some(vertex => buildingAt(game, vertex)?.vertex?.owner === playerIndex &&
        buildingAt(game, vertex)?.vertex?.building === 'city'));
    default: return false;
  }
}

export function canClaimWonder(game, playerId, wonderId) {
  if (game.seafarers?.scenario !== 'the_wonders_of_catan' || game.phase !== 'playing' || game.turnPhase !== 'main') return { valid: false, error: 'Wonder claims are unavailable' };
  const index = game.players.findIndex(player => player.id === playerId);
  if (index !== game.currentPlayerIndex) return { valid: false, error: 'Not your action phase' };
  const available = availableWonders(game);
  if (!available.includes(wonderId)) return { valid: false, error: 'Unknown wonder' };
  if (game.seafarers.wonders.some(wonder => wonder.ownerId === playerId)) return { valid: false, error: 'You already claimed a wonder' };
  if (game.seafarers.wonders.some(wonder => wonder.id === wonderId)) return { valid: false, error: 'That wonder is claimed' };
  if (!wonderQualifies(game, index, wonderId)) return { valid: false, error: 'Meet this wonder’s requirement first' };
  return { valid: true };
}

export function availableWonders(game) {
  if (game.seafarers?.scenario !== 'the_wonders_of_catan') return [];
  return game.players.length >= 5 ? Object.keys(WONDER_COSTS) : Object.keys(WONDER_COSTS).filter(id => !['lighthouse','great_library'].includes(id));
}

export function claimWonder(game, playerId, wonderId) {
  const valid = canClaimWonder(game, playerId, wonderId);
  if (!valid.valid) return fail(valid.error);
  game.seafarers.wonders.push({ id: wonderId, ownerId: playerId, level: 0 });
  return { success: true };
}

export function canBuildWonder(game, playerId) {
  if (game.seafarers?.scenario !== 'the_wonders_of_catan' || game.phase !== 'playing' || game.turnPhase !== 'main' ||
      game.players[game.currentPlayerIndex]?.id !== playerId) return { valid: false, error: 'Cannot build a wonder now' };
  const wonder = game.seafarers.wonders.find(value => value.ownerId === playerId);
  if (!wonder || wonder.level >= 4) return { valid: false, error: 'Claim an incomplete wonder first' };
  const player = game.players[game.currentPlayerIndex];
  if (Object.entries(WONDER_COSTS[wonder.id]).some(([resource, amount]) => player.resources[resource] < amount)) return { valid: false, error: 'You need five resources for this level' };
  return { valid: true };
}

export function buildWonder(game, playerId) {
  const valid = canBuildWonder(game, playerId);
  if (!valid.valid) return fail(valid.error);
  const wonder = game.seafarers.wonders.find(value => value.ownerId === playerId);
  const player = game.players[game.currentPlayerIndex];
  for (const [resource, amount] of Object.entries(WONDER_COSTS[wonder.id])) {
    player.resources[resource] -= amount;
    game.bank[resource] += amount;
  }
  wonder.level++;
  G.checkWinner(game);
  return { success: true, level: wonder.level, winner: game.winner };
}

export function canAttackFortress(game, playerId) {
  if (!isPirateIslands(game) || game.phase !== 'playing' || game.turnPhase !== 'main' ||
      game.players[game.currentPlayerIndex]?.id !== playerId) return { valid: false, error: 'Fortress attack is unavailable' };
  const fortress = game.seafarers.fortresses.find(item => item.ownerId === playerId && !item.capturedBy);
  if (!fortress || !incidentRoutes(game, fortress.vertexKey, game.currentPlayerIndex).some(route => route.edge.ship)) {
    return { valid: false, error: 'Your shipping line has not reached your fortress' };
  }
  return { valid: true };
}

export function onActorEnd(game, { attackFortress = false } = {}) {
  if (!isSeafarers(game)) return { success: true };
  if (game.pendingChoice) return fail('Finish the current choice first');
  if (attackFortress) {
    const player = game.players[game.currentPlayerIndex];
    const valid = canAttackFortress(game, player.id);
    if (!valid.valid) return fail(valid.error);
    const fortress = game.seafarers.fortresses.find(item => item.ownerId === player.id && !item.capturedBy);
    if (fortress && incidentRoutes(game, fortress.vertexKey, game.currentPlayerIndex).some(route => route.edge.ship)) {
      const die = Math.floor(Math.random() * 6) + 1;
      const distance = new Map([[canonicalVertex(game, fortress.vertexKey),0]]);
      const queue = [canonicalVertex(game, fortress.vertexKey)];
      for (const vertex of queue) for (const route of incidentRoutes(game, vertex, game.currentPlayerIndex)) if (route.edge.ship) {
        const next = edgeEndpoints(route.key).map(key => canonicalVertex(game, key)).find(key => key !== vertex);
        if (next && !distance.has(next)) { distance.set(next, distance.get(vertex) + 1); queue.push(next); }
      }
      const routeShips = playerShips(game, game.currentPlayerIndex).filter(ship => ship.endpoints.some(vertex => distance.has(vertex)));
      const routeWarships = routeShips.filter(ship => ship.edge.warship).length;
      const lostShips = routeWarships > die ? 0 : routeWarships === die ? 1 : 2;
      if (!lostShips) {
        fortress.lairs--;
        if (fortress.lairs <= 0) {
          fortress.capturedBy = player.id;
          const marker = canonicalVertex(game, fortress.vertexKey);
          if (!buildingAt(game, marker) && player.settlements > 0) {
            game.vertices[marker] = { building: 'settlement', owner: game.currentPlayerIndex };
            player.settlements--;
            player.victoryPoints++;
          }
          if (game.seafarers.fortresses.every(item => !item.ownerId || item.capturedBy)) {
            game.seafarers.fleetActive = false;
            game.pirate = null;
          }
          G.checkWinner(game);
        }
      } else {
        routeShips.sort((a,b) => Math.min(...a.endpoints.map(v => distance.get(v) ?? Infinity)) - Math.min(...b.endpoints.map(v => distance.get(v) ?? Infinity)) || a.key.localeCompare(b.key));
        for (const ship of routeShips.slice(0,lostShips)) {
          if (ship.edge.warship) player.warships--;
          game.edges[ship.key] = { road: false, ship: false, owner: null };
          game.seafarers.voyageEdges[player.id] = game.seafarers.voyageEdges[player.id].filter(edge => edge !== canonicalEdge(game, ship.key));
          player.ships++;
        }
        G.updateLongestRoad(game);
      }
      game.seafarers.lastFortressAttack = { playerId: player.id, die, lostShips, fortressLairs: fortress.lairs };
    }
  }
  if (game.seafarers.scenario === 'cloth_for_catan' && game.seafarers.villages.filter(village => village.cloth === 0).length >= 5) {
    const scores = game.players.map(player => ({ player, score: player.victoryPoints + player.hiddenVictoryPoints }));
    scores.sort((a,b) => b.score - a.score || b.player.cloth - a.player.cloth);
    const leaders = scores.filter(entry => entry.score === scores[0].score && entry.player.cloth === scores[0].player.cloth);
    game.phase = 'finished';
    game.winners = leaders.map(entry => entry.player.id);
    game.winner = leaders.length === 1 ? leaders[0].player.id : null;
    for (const player of game.players) { player.victoryPoints += player.hiddenVictoryPoints; player.hiddenVictoryPoints = 0; }
  }
  game.seafarers.shipMovedThisPhase = false;
  game.seafarers.builtShips = [];
  return { success: true };
}

export function publicSeafarersState(game, playerId) {
  if (!isSeafarers(game)) return null;
  const state = structuredClone(game.seafarers);
  delete state.fogTerrainPile;
  delete state.fogNumberPile;
  delete state.rewardDeck;
  delete state.choiceQueue;
  delete state.portInventory;
  delete state.collectiblePortTypes;
  delete state.pendingPortClaims;
  delete state.portDrawPile;
  delete state.builtShips;
  return state;
}

export function onGameStart(game) {
  if (!isSeafarers(game)) return { success: true };
  const state = game.seafarers;
  const map = MAPS[state.mapKey];
  if (state.scenario === 'new_world') {
    const portPool = { brick: 1, wood: 1, wool: game.players.length >= 5 ? 2 : 1, grain: 1, ore: 1,
      generic: map.setup.ports.types3to1 };
    if (Object.values(portPool).reduce((a,b) => a+b, 0) !== map.setup.ports.types2to1 + map.setup.ports.types3to1) return fail('New World port count is incomplete');
    state.portDrawPile = shuffleWith(flattenPool(portPool), Math.random);
    state.currentPortType = state.portDrawPile.shift();
    game.turnPhase = 'portPlacement';
    game.currentPlayerIndex = 0;
  }
  if (state.scenario === 'the_pirate_islands') {
    if (game.players.length === 3) game.devCardDeck = game.devCardDeck.filter(card => card !== 'victoryPoint');
    else game.devCardDeck = game.devCardDeck.map(card => card === 'victoryPoint' ? 'knight' : card);
    const colors = map.setup[`fortressColors${game.players.length}`];
    if (!Array.isArray(colors) || colors.length !== game.players.length) return fail('Pirate origin colors are incomplete');
    state.playerColors = Object.fromEntries(game.players.map((player,index) => [player.id, colors[index]]));
    for (const [index, player] of game.players.entries()) {
      const color = colors[index];
      const origin = map.preplacedMainCoastalPieces?.find(piece => piece.color === color && (!piece.onlyPlayers || piece.onlyPlayers === game.players.length));
      if (!origin) return fail('Pirate origin is missing');
      const vertex = G.vertexKey(origin.settlement.hex.q, origin.settlement.hex.r, origin.settlement.dir);
      const edge = G.edgeKey(origin.ship.hex.q, origin.ship.hex.r, origin.ship.side);
      if (buildingAt(game, vertex) || occupiedEdge(game, edge)) return fail('Pirate origins overlap');
      game.vertices[vertex] = { building: 'settlement', owner: index };
      game.edges[edge] = { road: false, ship: true, owner: index, warship: false };
      player.settlements--;
      player.ships--;
      player.victoryPoints++;
      state.origins[player.id] = vertex;
      state.originsShip[player.id] = canonicalEdge(game, edge);
      state.voyageEdges[player.id] = [];
      const fortress = state.fortresses.find(value => value.color === color);
      if (fortress) fortress.ownerId = player.id;
      const beachhead = state.beachheads.find(value => value.color === color);
      if (beachhead) beachhead.ownerId = player.id;
    }
    game.pirate = keyForHex(state.fleetRoute[state.fleetIndex]);
  }
  return { success: true };
}

export function canPlacePort(game, edgeKey) {
  if (!isSeafarers(game) || game.seafarers.scenario !== 'new_world' || game.phase !== 'setup' || game.turnPhase !== 'portPlacement') {
    return { valid: false, error: 'Port placement is unavailable' };
  }
  const canonical = canonicalEdge(game, edgeKey);
  if (!canonical) return { valid: false, error: 'Invalid edge' };
  const adjacent = edgeHexes(game, canonical);
  if (!adjacent.some(hex => hex.terrain !== 'sea') || adjacent.filter(hex => hex.terrain === 'sea').length + (adjacent.length === 1 ? 1 : 0) !== 1) {
    return { valid: false, error: 'Port needs a coast or frame edge' };
  }
  const vertices = edgeEndpoints(canonical).map(vertex => canonicalVertex(game, vertex));
  if (game.ports.some(port => port.vertices.map(vertex => canonicalVertex(game, vertex)).some(vertex => vertices.includes(vertex)))) {
    return { valid: false, error: 'Leave one edge between ports' };
  }
  return { valid: true };
}

export function placePort(game, playerId, edgeKey) {
  if (game.players[game.currentPlayerIndex]?.id !== playerId) return fail('Not your port placement turn');
  const valid = canPlacePort(game, edgeKey);
  if (!valid.valid) return fail(valid.error);
  const type = game.seafarers.currentPortType;
  const resource = PORT_RESOURCE[type];
  if (resource === undefined) return fail('Port draw is unavailable');
  const canonical = canonicalEdge(game, edgeKey);
  game.ports.push({ id: game.ports.length, edge: canonical, vertices: edgeEndpoints(canonical), type, ratio: resource ? 2 : 3, resource,
    name: resource ? `${resource} port` : '3:1 Port' });
  game.seafarers.currentPortType = game.seafarers.portDrawPile.shift() || null;
  if (game.seafarers.currentPortType) game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  else { game.turnPhase = 'roll'; game.currentPlayerIndex = 0; }
  return { success: true, portType: type };
}

export function legalPortPlacements(game, playerId) {
  if (game.players[game.currentPlayerIndex]?.id !== playerId) return [];
  return [...new Set(Object.keys(game.edges).map(edge => canonicalEdge(game, edge)).filter(Boolean))]
    .filter(edgeKey => canPlacePort(game, edgeKey).valid)
    .map(edgeKey => ({ type: 'placePort', payload: { edgeKey } }));
}

export function publicPendingChoice(game, playerId) {
  if (!game.pendingChoice) return null;
  const choice = game.pendingChoice;
  return { id: choice.id, kind: choice.kind, actorId: choice.actorId, label: choice.label,
    options: choice.actorId === playerId ? structuredClone(choice.options.map(({ id, label, resource, edgeKey, vertexKey, hexKey }) =>
      ({ id, label, ...(resource ? { resource } : {}), ...(edgeKey ? { edgeKey } : {}),
        ...(vertexKey ? { vertexKey } : {}), ...(hexKey ? { hexKey } : {}) }))) : [] };
}

function createGoldChoice(game, claim) {
  const options = RESOURCE_TYPES.filter(resource => game.bank[resource] > 0)
    .map(resource => ({ id: resource, label: resource[0].toUpperCase() + resource.slice(1), resource }));
  if (!options.length) return null;
  return { id: crypto.randomUUID(), kind: 'goldResource', actorId: claim.playerId,
    label: claim.label || 'Choose one resource from a gold field', options,
    context: { hexKey: claim.hexKey }, resumePhase: game.turnPhase };
}

function portCandidates(game, playerId) {
  const playerIndex = game.players.findIndex(player => player.id === playerId);
  const edges = [...new Set(Object.keys(game.edges).map(edge => canonicalEdge(game, edge)).filter(Boolean))];
  return edges.filter(edge => {
    const hexes = edgeHexes(game, edge);
    if (!hexes.some(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog') ||
        !hexes.some(hex => hex.terrain === 'sea') && hexes.length !== 1) return false;
    const endpoints = edgeEndpoints(edge).map(vertex => canonicalVertex(game, vertex));
    if (!endpoints.some(vertex => buildingAt(game, vertex)?.vertex?.owner === playerIndex)) return false;
    return !game.ports.some(port => port.vertices.some(vertex => endpoints.includes(canonicalVertex(game, vertex))));
  });
}

function createPortChoice(game, claim) {
  const candidates = portCandidates(game, claim.playerId);
  if (!candidates.length) return null;
  return { id: crypto.randomUUID(), kind: 'tribePort', actorId: claim.playerId,
    label: 'Place your discovered harbor beside one of your coastal buildings',
    options: candidates.map(edgeKey => ({ id: edgeKey, label: 'Coastal edge', edgeKey })),
    context: { type: claim.type }, resumePhase: game.turnPhase };
}

function createFleetRewardChoice(game, claim) {
  const options = RESOURCE_TYPES.filter(resource => game.bank[resource] > 0)
    .map(resource => ({ id: resource, label: resource[0].toUpperCase() + resource.slice(1), resource }));
  if (!options.length) return null;
  return { id: crypto.randomUUID(), kind: 'fleetReward', actorId: claim.playerId,
    label: 'Choose one resource for repelling the pirate fleet', options,
    resumePhase: game.turnPhase };
}

export function queueGoldClaims(game, claims) {
  if (!isSeafarers(game) || !claims?.length) return;
  for (const claim of claims) for (let count = 0; count < claim.amount; count++) game.seafarers.choiceQueue.push({ ...claim });
  advanceChoiceQueue(game);
}

function advanceChoiceQueue(game) {
  if (game.pendingChoice) return;
  if (game.seafarers.scenario === 'the_forgotten_tribe') {
    const available = game.seafarers.pendingPortClaims.findIndex(claim => portCandidates(game, claim.playerId).length);
    if (available >= 0) {
      game.pendingChoice = createPortChoice(game, game.seafarers.pendingPortClaims.splice(available, 1)[0]);
      G.refreshPlayerTradingAllowed(game);
      return;
    }
  }
  while (game.seafarers.choiceQueue.length) {
    const next = game.seafarers.choiceQueue.shift();
    const choice = next.kind === 'tribePort' ? createPortChoice(game, next)
      : next.kind === 'fleetReward' ? createFleetRewardChoice(game, next) : createGoldChoice(game, next);
    if (next.kind === 'tribePort' && !choice) { game.seafarers.pendingPortClaims.push(next); continue; }
    if (choice) { game.pendingChoice = choice; break; }
  }
  if (!game.pendingChoice && game.seafarers.pendingRollTotal != null) {
    const total = game.seafarers.pendingRollTotal;
    delete game.seafarers.pendingRollTotal;
    G.completeRoll(game, total);
  }
  G.refreshPlayerTradingAllowed(game);
}

export function resolveSeafarersChoice(game, playerId, choiceId, optionId) {
  const choice = game.pendingChoice;
  if (!isSeafarers(game) || !choice || choice.id !== choiceId || choice.actorId !== playerId) return fail('This choice is not available to you');
  const option = choice.options.find(value => value.id === optionId);
  if (!option) return fail('Invalid choice');
  if (choice.kind === 'goldResource' || choice.kind === 'fleetReward') {
    if (!RESOURCE_TYPES.includes(option.resource) || game.bank[option.resource] < 1) return fail('That resource is unavailable');
    game.bank[option.resource]--;
    game.players.find(player => player.id === playerId).resources[option.resource]++;
  } else if (choice.kind === 'pirateSeven') {
    const victim = game.players.find(player => player.id === option.id && player.id !== playerId);
    if (!victim || !RESOURCE_TYPES.some(resource => victim.resources[resource] > 0)) return fail('That player has no resource to take');
    const cards = RESOURCE_TYPES.flatMap(resource => Array(victim.resources[resource]).fill(resource));
    const resource = cards[Math.floor(Math.random() * cards.length)];
    victim.resources[resource]--;
    game.players.find(player => player.id === playerId).resources[resource]++;
    game.turnPhase = 'main';
  } else if (choice.kind === 'tribePort') {
    if (!portCandidates(game, playerId).includes(option.edgeKey)) return fail('That coast is no longer available');
    const type = choice.context.type;
    const resource = PORT_RESOURCE[type];
    if (resource === undefined) return fail('Unknown harbor type');
    const edge = option.edgeKey;
    game.ports.push({ id: game.ports.length, edge, vertices: edgeEndpoints(edge), type,
      ratio: resource ? 2 : 3, resource, name: resource ? `${resource} port` : '3:1 Port' });
  } else if (choice.kind === 'pirateVoyageOrigin') {
    const route = choice.context?.routes?.[Number(option.id)];
    const owner = game.players.findIndex(player => player.id === playerId);
    if (!route || route.origin !== option.vertexKey || !route.route.every(edge => {
      const occupied = occupiedEdge(game, edge);
      return occupied?.edge.ship && occupied.edge.owner === owner;
    })) return fail('That western voyage is no longer available');
    commitPirateVoyage(game, playerId, route);
  } else return fail('Unknown choice');
  game.pendingChoice = null;
  advanceChoiceQueue(game);
  return { success: true, resource: option.resource };
}

export function onRoutePlaced(game, playerId, edgeKey, kind) {
  if (!isSeafarers(game)) return;
  const state = game.seafarers;
  if (kind === 'ship' && state.scenario === 'cloth_for_catan') refreshVillageRelations(game);
  if (state.scenario === 'the_fog_islands') {
    const fog = [...new Set(edgeEndpoints(edgeKey).flatMap(vertex => G.getVertexAdjacentHexes(game, vertex))
      .filter(hex => hex.terrain === 'fog').map(hex => G.hexKey(hex.q, hex.r)))].sort();
    for (const hexKey of fog) {
      const terrain = state.fogTerrainPile.shift();
      if (!terrain) throw new Error('Fog terrain pile is exhausted');
      const hex = game.hexes[hexKey];
      hex.terrain = terrain;
      hex.resource = RESOURCE_BY_TERRAIN[terrain] || null;
      hex.color = TERRAIN_COLOR[terrain];
      hex.number = terrain === 'sea' || terrain === 'desert' ? null : state.fogNumberPile.shift();
      hex.hidden = false;
      if (hex.resource && game.bank[hex.resource] > 0) {
        game.bank[hex.resource]--;
        game.players.find(player => player.id === playerId).resources[hex.resource]++;
      } else if (terrain === 'gold') {
        queueGoldClaims(game, [{ playerId, amount: 1, hexKey, label: 'Choose a resource from discovered gold' }]);
      }
    }
  }
  if (kind === 'ship' && state.scenario === 'the_forgotten_tribe') {
    const canonical = canonicalEdge(game, edgeKey);
    for (const reward of state.rewards) {
      if (reward.collected || canonicalEdge(game, reward.edge) !== canonical) continue;
      reward.collected = true;
      const player = game.players.find(value => value.id === playerId);
      if (reward.kind === 'victory_point') {
        player.victoryPoints++;
        player.bonusVictoryPoints++;
      } else if (reward.kind === 'development_card') {
        const card = state.rewardDeck.shift();
        if (!card) throw new Error('Tribe development reward is unavailable');
        player.newDevCards.push(card);
        if (card === 'victoryPoint') player.hiddenVictoryPoints++;
      }
    }
    for (const token of state.collectiblePorts) {
      if (token.collected || canonicalEdge(game, token.edge) !== canonical) continue;
      token.collected = true;
      const type = token.type === 'random' ? state.collectiblePortTypes.shift() : token.type;
      if (PORT_RESOURCE[type] === undefined) throw new Error('Tribe harbor pool is exhausted');
      state.choiceQueue.push({ kind: 'tribePort', playerId, type });
    }
    advanceChoiceQueue(game);
  }
}

function playerShips(game, playerIndex) {
  const ships = new Map();
  for (const [key, edge] of Object.entries(game.edges)) if (edge.ship && edge.owner === playerIndex) {
    ships.set(canonicalEdge(game, key), { key, edge, endpoints: edgeEndpoints(key).map(vertex => canonicalVertex(game, vertex)) });
  }
  return [...ships.values()];
}

function openShip(game, playerIndex, fromKey) {
  const ships = playerShips(game, playerIndex);
  const source = ships.find(ship => canonicalEdge(game, ship.key) === canonicalEdge(game, fromKey));
  if (!source) return false;
  const degrees = new Map();
  for (const ship of ships) for (const vertex of ship.endpoints) degrees.set(vertex, (degrees.get(vertex) || 0) + 1);
  if (source.endpoints.some(vertex => (degrees.get(vertex) || 0) === 1 && buildingAt(game, vertex)?.vertex?.owner !== playerIndex)) return true;
  // An unanchored cycle becomes an open line when one ship is removed. A
  // settlement-to-settlement line remains closed even when the graph loops.
  if (source.endpoints.some(vertex => buildingAt(game, vertex)?.vertex?.owner === playerIndex)) return false;
  const component = new Set([source.key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ship of ships) if (!component.has(ship.key) && ships.some(other => component.has(other.key) && ship.endpoints.some(vertex => other.endpoints.includes(vertex)))) {
      component.add(ship.key);
      changed = true;
    }
  }
  if (ships.filter(ship => component.has(ship.key)).some(ship => ship.endpoints.some(vertex => buildingAt(game, vertex)?.vertex?.owner === playerIndex))) return false;
  return source.endpoints.every(vertex => (degrees.get(vertex) || 0) === 2);
}

export function canMoveShip(game, playerId, fromEdgeKey, toEdgeKey) {
  if (!isSeafarers(game)) return { valid: false, error: 'Ships are unavailable' };
  const index = game.players.findIndex(player => player.id === playerId);
  if (index < 0 || game.phase !== 'playing' || game.turnPhase !== 'main' || game.currentPlayerIndex !== index) return { valid: false, error: 'Cannot move a ship now' };
  if (game.freeRoads || game.yearOfPlentyPicks || game.pendingChoice) return { valid: false, error: 'Finish the current action first' };
  if (game.seafarers.shipMovedThisPhase) return { valid: false, error: 'You already moved a ship in this action phase' };
  const source = occupiedEdge(game, fromEdgeKey);
  if (!source?.edge.ship || source.edge.owner !== index) return { valid: false, error: 'Choose one of your ships' };
  if (edgeHexes(game, fromEdgeKey).some(hex => keyForHex(hex) === game.pirate)) return { valid: false, error: 'Pirate blocks moving this ship' };
  if (game.seafarers.builtShips.includes(canonicalEdge(game, fromEdgeKey))) return { valid: false, error: 'A newly built ship cannot move yet' };
  if (!openShip(game, index, fromEdgeKey)) return { valid: false, error: 'This shipping line is closed' };
  if (game.seafarers.scenario === 'cloth_for_catan') {
    const reduced = structuredClone(game);
    reduced.edges[source.key] = { road: false, ship: false, owner: null };
    if (game.seafarers.villages.some(village => connectedToVillage(game, index, village) && !connectedToVillage(reduced, index, village))) {
      return { valid: false, error: 'A village trade route is closed and cannot be moved' };
    }
  }
  if (canonicalEdge(game, fromEdgeKey) === canonicalEdge(game, toEdgeKey)) return { valid: false, error: 'Choose another sea edge' };
  const candidate = structuredClone(game);
  candidate.edges[source.key] = { road: false, ship: false, owner: null };
  if (isPirateIslands(candidate)) {
    const sourceKey = canonicalEdge(game, fromEdgeKey);
    const destinationKey = canonicalEdge(candidate, toEdgeKey);
    if (candidate.seafarers.voyageEdges[playerId].length && sourceKey === candidate.seafarers.originsShip[playerId]) {
      candidate.seafarers.originsShip[playerId] = destinationKey;
      candidate.seafarers.voyageEdges[playerId] = [destinationKey];
    } else candidate.seafarers.voyageEdges[playerId] = candidate.seafarers.voyageEdges[playerId].filter(edge => edge !== sourceKey);
  }
  return canPlaceShip(candidate, playerId, toEdgeKey, { movingFrom: fromEdgeKey });
}

export function moveShip(game, playerId, fromEdgeKey, toEdgeKey) {
  const valid = canMoveShip(game, playerId, fromEdgeKey, toEdgeKey);
  if (!valid.valid) return fail(valid.error);
  const source = occupiedEdge(game, fromEdgeKey);
  const warship = Boolean(source.edge.warship);
  const owner = source.edge.owner;
  game.edges[source.key] = { road: false, ship: false, owner: null };
  game.edges[toEdgeKey] = { road: false, ship: true, owner, warship };
  if (isPirateIslands(game)) {
    if (valid.newVoyage) {
      commitPirateVoyage(game, playerId, valid.newVoyage);
    } else if (valid.newVoyageChoices) {
      choosePirateVoyage(game, playerId, valid.newVoyageChoices);
    } else if (game.seafarers.originsShip[playerId] === canonicalEdge(game, fromEdgeKey)) {
      game.seafarers.originsShip[playerId] = canonicalEdge(game, toEdgeKey);
    }
    if (!valid.newVoyage) {
      game.seafarers.voyageEdges[playerId] = game.seafarers.voyageEdges[playerId].filter(edge => edge !== canonicalEdge(game, fromEdgeKey));
      if (valid.voyage) game.seafarers.voyageEdges[playerId].push(canonicalEdge(game, toEdgeKey));
    }
  }
  game.seafarers.shipMovedThisPhase = true;
  onRoutePlaced(game, playerId, toEdgeKey, 'ship');
  G.updateLongestRoad(game);
  G.checkWinner(game);
  return { success: true };
}

export function legalShipMoves(game, playerId) {
  const index = game.players.findIndex(player => player.id === playerId);
  if (index < 0 || game.seafarers?.shipMovedThisPhase) return [];
  const result = [];
  const destinations = [...new Set(Object.keys(game.edges).map(edge => canonicalEdge(game, edge)).filter(Boolean))];
  for (const source of playerShips(game, index)) {
    if (!openShip(game, index, source.key) || game.seafarers.builtShips.includes(canonicalEdge(game, source.key))) continue;
    const sourceKey = canonicalEdge(game, source.key);
    for (const toEdgeKey of destinations) {
      if (occupiedEdge(game, toEdgeKey) || !isShipEdge(game, toEdgeKey)) continue;
      const connects = edgeEndpoints(toEdgeKey).some(vertex => {
        const building = buildingAt(game, vertex)?.vertex;
        if (building?.owner != null && building.owner !== index) return false;
        return building?.owner === index || incidentRoutes(game, vertex, index).some(route =>
          route.edge.ship && canonicalEdge(game, route.key) !== sourceKey);
      });
      if (!connects || !canMoveShip(game, playerId, source.key, toEdgeKey).valid) continue;
      result.push({ type: 'moveShip', payload: { fromEdgeKey: source.key, toEdgeKey } });
    }
  }
  return result;
}

function shipsOnHex(game, hexKey, excludeIndex) {
  const hex = game.hexes[hexKey];
  if (!hex) return [];
  const owners = new Set();
  for (let side = 0; side < 6; side++) {
    const occupied = occupiedEdge(game, G.edgeKey(hex.q, hex.r, side));
    if (occupied?.edge.ship && occupied.edge.owner !== excludeIndex) owners.add(occupied.edge.owner);
  }
  return [...owners];
}

export function canMoveRobber(game, hexKey) {
  if (!isSeafarers(game)) return { valid: true };
  const hex = game.hexes[hexKey];
  if (!hex || ['sea', 'fog'].includes(hex.terrain)) return { valid: false, error: 'Robber needs a revealed land hex' };
  if (game.seafarers.scenario === 'the_pirate_islands') return { valid: false, error: 'The Pirate Islands has no robber' };
  if (game.seafarers.scenario === 'the_forgotten_tribe' && !hex.number) return { valid: false, error: 'Robber must move to numbered land' };
  if (game.seafarers.scenario === 'cloth_for_catan' && !['north', 'south'].includes(hex.region)) return { valid: false, error: 'Robber stays on a main island' };
  return { valid: true };
}

export function canMovePirate(game, hexKey) {
  if (!isSeafarers(game) || ['the_pirate_islands', 'the_wonders_of_catan'].includes(game.seafarers.scenario)) return { valid: false, error: 'Pirate is unavailable' };
  if (game.seafarers.scenario === 'cloth_for_catan' &&
      !Object.entries(game.seafarers.villageRelations).some(([key,value]) => value && key.startsWith(`${game.players[game.currentPlayerIndex].id}:`))) {
    return { valid: false, error: 'Connect to a village before moving the pirate' };
  }
  if (hexKey === game.pirate) return { valid: false, error: 'Choose a different pirate location' };
  if (/^frame:(north|south|east|west)$/.test(hexKey)) return { valid: true };
  if (game.hexes[hexKey]?.terrain !== 'sea') return { valid: false, error: 'Choose a sea hex or frame' };
  return { valid: true };
}

export function legalPirateMoves(game, playerId) {
  if (!isSeafarers(game) || game.turnPhase !== 'robber' || game.players[game.currentPlayerIndex]?.id !== playerId) return [];
  const result = [];
  for (const edge of ['north','south','east','west']) {
    const hexKey = `frame:${edge}`;
    if (canMovePirate(game, hexKey).valid) result.push({ type: 'movePirate', payload: { hexKey } });
  }
  for (const [hexKey, hex] of Object.entries(game.hexes)) {
    if (hex.terrain !== 'sea' || !canMovePirate(game, hexKey).valid) continue;
    const victims = shipsOnHex(game, hexKey, game.currentPlayerIndex)
      .filter(index => RESOURCE_TYPES.some(resource => game.players[index].resources[resource] > 0) ||
        game.seafarers.scenario === 'cloth_for_catan' && game.players[index].cloth > 0);
    if (!victims.length) result.push({ type: 'movePirate', payload: { hexKey } });
    else for (const index of victims) {
      const victim = game.players[index];
      if (RESOURCE_TYPES.some(resource => victim.resources[resource] > 0)) result.push({ type: 'movePirate', payload: { hexKey, stealFromPlayerId: victim.id, stealType: 'resource' } });
      if (game.seafarers.scenario === 'cloth_for_catan' && victim.cloth > 0) result.push({ type: 'movePirate', payload: { hexKey, stealFromPlayerId: victim.id, stealType: 'cloth' } });
    }
  }
  return result;
}

export function movePirate(game, playerId, hexKey, stealFromPlayerId, stealType = 'resource') {
  if (game.phase !== 'playing' || game.turnPhase !== 'robber' || game.players[game.currentPlayerIndex]?.id !== playerId) return fail('Cannot move pirate now');
  const valid = canMovePirate(game, hexKey);
  if (!valid.valid) return fail(valid.error);
  const victims = hexKey.startsWith('frame:') ? [] : shipsOnHex(game, hexKey, game.currentPlayerIndex)
    .filter(index => RESOURCE_TYPES.some(resource => game.players[index].resources[resource] > 0) ||
      game.seafarers.scenario === 'cloth_for_catan' && game.players[index].cloth > 0);
  const victimIndex = game.players.findIndex(player => player.id === stealFromPlayerId);
  if (victims.length && !victims.includes(victimIndex)) return fail('Choose an eligible ship owner to steal from');
  if (!victims.length && stealFromPlayerId != null) return fail('No ship owner has a resource to steal');
  game.pirate = hexKey;
  if (victimIndex >= 0 && stealType === 'cloth') {
    if (game.seafarers.scenario !== 'cloth_for_catan' || game.players[victimIndex].cloth < 1) return fail('That player has no cloth to take');
    const victim = game.players[victimIndex];
    victim.victoryPoints -= Math.floor(victim.cloth / 2) - Math.floor((victim.cloth - 1) / 2);
    victim.cloth--;
    awardCloth(game, game.currentPlayerIndex, 1);
    game.turnPhase = game.hasRolledThisTurn || game.turnRole === 'paired' ? 'main' : 'roll';
  } else if (victimIndex >= 0) {
    if (stealType !== 'resource' || !RESOURCE_TYPES.some(resource => game.players[victimIndex].resources[resource] > 0)) return fail('That player has no resource to take');
    const victim = game.players[victimIndex];
    const cards = RESOURCE_TYPES.flatMap(resource => Array(victim.resources[resource]).fill(resource))
      .map(resource => ({ id: crypto.randomUUID(), resource }));
    const randomCards = shuffleWith(cards, Math.random);
    game.pendingRobberPick = { id: crypto.randomUUID(), thiefId: playerId, victimId: victim.id, cards: randomCards,
      resumePhase: game.hasRolledThisTurn || game.turnRole === 'paired' ? 'main' : 'roll' };
    game.turnPhase = 'robberPick';
  } else game.turnPhase = game.hasRolledThisTurn || game.turnRole === 'paired' ? 'main' : 'roll';
  G.refreshPlayerTradingAllowed(game);
  return { success: true, pirate: hexKey };
}

export function scenarioGoal(game) { return game.seafarers?.goal || 10; }
