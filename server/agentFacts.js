import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import * as CK from './citiesKnightsCore.js';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COMMODITY = { lumber: 'paper', wool: 'cloth', ore: 'coin' };
// The Seafarers engine's wonder costs are private constants, so keep this
// public rule table under an execution-comparison test.
const WONDER_COSTS = {
  great_wall: { brick: 3, lumber: 1, grain: 1 },
  great_bridge: { lumber: 3, wool: 1, grain: 1 },
  grand_theater: { brick: 1, lumber: 1, wool: 3 },
  grand_castle: { brick: 1, grain: 1, ore: 3 },
  grand_monument: { grain: 3, ore: 2 },
  lighthouse: { lumber: 3, wool: 1, grain: 1 },
  great_library: { brick: 1, lumber: 1, wool: 3 },
};
const pips = number => Number.isInteger(number) && number >= 2 && number <= 12 && number !== 7 ? 6 - Math.abs(7 - number) : 0;
const missing = (hand, cost) => Object.fromEntries(Object.entries(cost).filter(([card, amount]) => amount > (hand[card] || 0)).map(([card, amount]) => [card, amount - (hand[card] || 0)]));
const subtract = (hand, cost) => Object.fromEntries(Object.entries(hand).map(([card, amount]) => [card, amount - (cost[card] || 0)]));
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const pick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
const OPTION_FIELDS = ['id','label','resource','commodity','vertexKey','edgeKey','hexKey','cardId','cardType','color','track','die','number','targetPlayerId','count','strength','kind'];

function canonicalize(value, ids) {
  if (typeof value === 'string') {
    // Also replaces geometry inside rule-choice identities such as track:v_... .
    // The original identity still participates in deduplication; execution uses
    // actionIndex, never these display parameters.
    return value.replace(/(?:v|e)_-?\d+_-?\d+_[0-5]|(?:h_)?-?\d+,-?\d+/g, key => ids.vertices[key] || ids.edges[key] || ids.tiles[key] || key);
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalize(item, ids)]));
  return value;
}

function productionAt(board, vertexId, building, citiesKnights) {
  const vertex = board.vertices.find(vertex => vertex.id === vertexId);
  const amount = building === 'city' ? 2 : 1;
  const production = (vertex?.tiles || []).map(id => board.tiles.find(tile => tile.id === id)).filter(Boolean).map(tile => {
    if (tile.unknown || tile.terrain === 'unknown') return { tile: tile.id, unknown: true };
    if (!tile.resource && tile.terrain !== 'gold') return null;
    const entry = { tile: tile.id, roll: tile.number ?? null, pips: pips(tile.number) };
    if (tile.terrain === 'gold') entry.chooseResourceCards = amount;
    else {
      entry.resource = tile.resource;
      entry.yield = citiesKnights && building === 'city' && COMMODITY[tile.resource]
        ? { [tile.resource]: 1, [COMMODITY[tile.resource]]: 1 } : { [tile.resource]: amount };
    }
    if (board.robber === tile.id) entry.blockedByRobber = true;
    return entry;
  }).filter(Boolean);
  return { production, productionPips: production.reduce((sum, tile) => sum + (tile.pips || 0), 0),
    productionBasis: 'per matching roll, before unknown supply shortages',
    ports: board.ports.filter(port => port.vertices.includes(vertexId)) };
}

function costFor(game, player, type, payload, option) {
  switch (type) {
    case 'placeSettlement': return game.phase === 'setup' ? {} : G.BUILDING_COSTS.settlement;
    case 'placeRoad': return game.phase === 'setup' || game.freeRoads > 0 ? {} : G.BUILDING_COSTS.road;
    case 'placeShip': return game.phase === 'setup' || game.freeRoads > 0 ? {} : { lumber: 1, wool: 1 };
    case 'upgradeToCity': return G.BUILDING_COSTS.city;
    case 'buyDevCard': return G.BUILDING_COSTS.developmentCard;
    case 'bankTrade': return { [payload.giveResource]: payload.giveAmount };
    case 'buildCityWall': return { brick: 2 };
    case 'recruitKnight': case 'promoteKnight': return { wool: 1, ore: 1 };
    case 'activateKnight': return { grain: 1 };
    case 'improveCity': return CK.TRACKS[payload.track] && Number.isInteger(player.cityImprovements?.[payload.track]) ? { [CK.TRACKS[payload.track]]: player.cityImprovements[payload.track] + 1 } : null;
    case 'buildWonder': return WONDER_COSTS[game.seafarers?.wonders?.find(wonder => wonder.ownerId === player.id)?.id] || null;
    case 'moveShip': case 'moveKnight': case 'claimWonder': case 'placePort': return {};
    case 'resolveCitiesKnightsChoice': {
      const kind = game.pendingChoice?.kind;
      if (kind === 'card:medicine') return { grain: 1, ore: 2 };
      if (kind === 'card:crane' && CK.TRACKS[option?.track] && Number.isInteger(player.cityImprovements?.[option.track])) return { [CK.TRACKS[option.track]]: player.cityImprovements[option.track] };
      if (['card:engineering', 'card:smithingFirst', 'card:smithingSecond', 'card:diplomacyReplace', 'card:treasonPlace'].includes(kind)) return {};
      return null;
    }
    default: return null;
  }
}

/** Facts depend only on an already-authorized view and its original actions. */
export function describeAgentActions(view, { board, ids }) {
  const game = view.gameState;
  if (!game || !Array.isArray(view.legalActions)) throw new TypeError('An authorized game view and original legal actions are required');
  const seatId = view.seatId ?? game.players[game.myIndex]?.id;
  const ownIndex = game.players.findIndex(player => player.id === seatId);
  const player = game.players[ownIndex];
  if (!player || typeof player.resources !== 'object') throw new TypeError('The authorized own hand is required');
  const ck = CK.isCitiesKnights(game);
  const hand = Object.fromEntries([...RESOURCES, ...(ck ? CK.COMMODITIES : [])].map(card => [card, ck ? CK.cardBalance(player, card) : player.resources[card] || 0]));
  const vertices = new Map(board.vertices.map(vertex => [vertex.id, vertex]));
  const edges = new Map(board.edges.map(edge => [edge.id, edge]));
  const representative = new Map();
  for (const key of Object.keys(game.vertices)) if (!representative.has(ids.vertices[key])) representative.set(ids.vertices[key], key);
  // Only the own hand is funded, for the engine's geometric settlement test.
  // Never execute full actions here: fog rewards, decks, steals and bank piles
  // cannot be reproduced from an authorized observation.
  const funded = structuredClone(game);
  for (const [key, hex] of Object.entries(funded.hexes)) if (hex.hidden || hex.terrain === 'fog') {
    funded.hexes[key] = { q: hex.q, r: hex.r, terrain: 'fog', hidden: true };
  }
  funded.players[ownIndex].resources = Object.fromEntries(RESOURCES.map(card => [card, 99]));
  const reachable = candidate => [...representative].filter(([, key]) => G.canPlaceSettlement(candidate, seatId, key, false).valid).map(([id]) => id);
  const beforeSites = new Set(game.phase === 'playing' ? reachable(funded) : []);
  const site = (id, afterHand = hand) => ({ vertex: id, cost: { ...G.BUILDING_COSTS.settlement }, missingCards: missing(afterHand, G.BUILDING_COSTS.settlement), ...productionAt(board, id, 'settlement', ck) });
  function routeFacts(type, payload, afterHand) {
    const edgeId = ids.edges[payload.toEdgeKey || payload.edgeKey];
    const edge = edges.get(edgeId);
    const facts = { endpoints: edge?.ends || [], opens: [] };
    if (game.phase !== 'playing') return facts;
    const copy = structuredClone(funded);
    if (type === 'moveShip') {
      const from = ids.edges[payload.fromEdgeKey];
      for (const key of Object.keys(copy.edges)) if (ids.edges[key] === from) copy.edges[key] = {};
      facts.fromEndpoints = edges.get(from)?.ends || [];
    }
    copy.edges[payload.toEdgeKey || payload.edgeKey] = { owner: ownIndex, road: type === 'placeRoad', ship: type !== 'placeRoad' };
    const afterSites = reachable(copy);
    facts.opens = afterSites.filter(id => !beforeSites.has(id)).map(id => site(id, afterHand));
    if (type === 'moveShip') facts.loses = [...beforeSites].filter(id => !afterSites.includes(id));
    facts.scope = 'visible board after this route; further routes and unrevealed tiles excluded';
    return facts;
  }
  function robberFacts(type, payload) {
    const tile = ids.tiles[payload.hexKey];
    const pirate = type === 'movePirate' || type === 'driveRobber' && (payload.hexKey?.startsWith('frame:') || game.hexes[payload.hexKey]?.terrain === 'sea');
    const affected = pirate ? board.edges.filter(edge => edge.route === 'ship' && SF.edgeHexes(game, Object.keys(ids.edges).find(key => ids.edges[key] === edge.id)).some(hex => ids.tiles[G.hexKey(hex.q, hex.r)] === tile))
      .map(edge => ({ edge: edge.id, owner: edge.owner })) : board.vertices.filter(vertex => vertex.building && vertex.tiles.includes(tile))
      .map(vertex => ({ vertex: vertex.id, owner: vertex.owner, building: vertex.building,
        productionBlocked: productionAt(board, vertex.id, vertex.building, ck).production.filter(entry => entry.tile === tile) }));
    const eligible = new Set(view.legalActions.filter(action => action.type === type && action.payload?.hexKey === payload.hexKey).map(action => action.payload?.stealFromPlayerId).filter(Boolean));
    const victims = [...eligible].map(id => {
      const victim = game.players.find(player => player.id === id);
      return { player: id, publicCardCount: typeof victim?.resources === 'number' ? victim.resources : Object.values(victim?.resources || {}).reduce((sum, count) => sum + count, 0), ...(victim?.cloth != null ? { cloth: victim.cloth } : {}) };
    });
    return { affected, eligibleVictims: victims, ...(payload.stealType === 'cloth' ? { stolenCloth: 1 } : payload.stealFromPlayerId ? { stolenCard: 'unknown' } : {}) };
  }
  const actions = [];
  const physical = new Set();
  view.legalActions.forEach((action, actionIndex) => {
    const payload = action.payload || {};
    const params = canonicalize(payload, ids);
    // Only geometry-equivalent actions collapse. Different rule-choice/card
    // identities always remain distinct, even if their displayed targets match.
    const hasGeometry = stable(payload) !== stable(params);
    const identity = /Choice$/.test(action.type) || payload.cardId != null ? { choiceId: payload.choiceId, optionId: payload.optionId, cardId: payload.cardId } : null;
    const key = stable({ type: action.type, params, identity });
    if (hasGeometry && physical.has(key)) return;
    if (hasGeometry) physical.add(key);
    const facts = {};
    const option = game.pendingChoice?.options?.find(option => option.id === payload.optionId);
    if (option) {
      const clean = pick(option, OPTION_FIELDS);
      const namedPlayer = game.players.findIndex(player => player.id === option.id || player.id === option.targetPlayerId);
      if (namedPlayer >= 0) clean.label = `Player ${namedPlayer + 1}`;
      facts.option = canonicalize(clean, ids);
    }
    if (game.pendingChoice && /Choice$/.test(action.type)) facts.choice = { kind: game.pendingChoice.kind, label: canonicalize(game.pendingChoice.label, ids) };
    if (payload.cardId) {
      const card = player.progressCards?.find?.(card => card.id === payload.cardId) || view.decision?.cards?.find?.(card => card.id === payload.cardId);
      if (card) facts.card = pick(card, ['id','type','color']);
    }
    const cost = costFor(game, player, action.type, payload, option);
    if (cost) {
      facts.cost = { ...cost };
      facts.handAfterCost = subtract(hand, cost);
      if (action.type === 'bankTrade') {
        facts.receives = { [payload.getResource]: 1 };
        facts.handAfterTrade = { ...facts.handAfterCost, [payload.getResource]: facts.handAfterCost[payload.getResource] + 1 };
      }
    }
    const target = ids.vertices[payload.vertexKey || option?.vertexKey];
    if (action.type === 'placeSettlement' || action.type === 'upgradeToCity' || game.pendingChoice?.kind === 'card:medicine' && option) {
      const building = action.type !== 'placeSettlement' || ck && game.phase === 'setup' && game.setupPhase === 1 ? 'city' : 'settlement';
      facts.building = building;
      Object.assign(facts, productionAt(board, target, building, ck));
      if (building === 'city' && game.phase !== 'setup') facts.previousProduction = productionAt(board, target, 'settlement', ck).production;
    }
    if (['placeRoad', 'placeShip', 'moveShip'].includes(action.type)) Object.assign(facts, routeFacts(action.type, payload, facts.handAfterCost || hand));
    if (['moveRobber', 'movePirate', 'driveRobber'].includes(action.type)) Object.assign(facts, robberFacts(action.type, payload));
    if (action.type === 'rollDice' || action.type === 'buyDevCard') facts.outcome = 'unknown';
    actions.push({ id: `a${actionIndex}`, actionIndex, type: action.type, params, facts });
  });
  const opportunities = [];
  if (game.phase === 'playing') {
    for (const id of beforeSites) opportunities.push({ type: 'settlement', executable: false, ...site(id) });
    const pillaged = Object.values(game.vertices).some(vertex => vertex.owner === ownIndex && vertex.pillagedNoPiece);
    for (const [id, key] of representative) {
      const vertex = vertices.get(id), raw = SF.buildingAt(game, key)?.vertex;
      if (vertex?.building !== 'settlement' || vertex.owner !== seatId || !(raw?.pillagedNoPiece || player.cities > 0) || ck && pillaged && !raw?.pillagedNoPiece) continue;
      opportunities.push({ type: 'city', executable: false, vertex: id, cost: { ...G.BUILDING_COSTS.city }, missingCards: missing(hand, G.BUILDING_COSTS.city), ...productionAt(board, id, 'city', ck) });
    }
  }
  return { actions, opportunities, horizon: 'immediate' };
}
