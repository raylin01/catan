import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import * as Cards from './citiesKnightsCards.js';

export const COMMODITIES = ['paper', 'coin', 'cloth'];
export const CARD_TYPES = ['brick','lumber','wool','grain','ore', ...COMMODITIES];
export const TRACKS = { science: 'paper', trade: 'cloth', politics: 'coin' };
export const PROGRESS_CARDS = {
  science: { alchemy: 2, crane: 2, engineering: 1, invention: 2, irrigation: 2,
    medicine: 2, mining: 2, printing: 1, roadBuilding: 2, smithing: 2 },
  trade: { commercialHarbor: 2, guildDues: 2, merchant: 6, merchantFleet: 2,
    resourceMonopoly: 4, tradeMonopoly: 2 },
  politics: { diplomacy: 2, encouragement: 2, espionage: 3, intrigue: 2,
    sabotage: 2, taxation: 2, treason: 2, constitution: 1, wedding: 2 },
};
const VP_CARDS = new Set(['printing','constitution']);
const fail = error => ({ success: false, error });
const shuffle = values => {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
};

export function isCitiesKnights(game) { return Boolean(game.citiesKnights); }
export function playerIndex(game, playerId) { return game.players.findIndex(player => player.id === playerId); }
export function cardCount(player) {
  return CARD_TYPES.reduce((total, type) => total + (player.resources?.[type] || player.commodities?.[type] || 0), 0);
}
export function readHand(player) {
  return Object.fromEntries(CARD_TYPES.map(type => [type, cardBalance(player, type) || 0]));
}
export const getCardCount = cardCount;
export function cardBalance(player, type) { return COMMODITIES.includes(type) ? player.commodities?.[type] || 0 : player.resources?.[type] || 0; }
export function bankBalance(game, type) { return COMMODITIES.includes(type) ? game.citiesKnights?.commodityBank?.[type] || 0 : game.bank?.[type] || 0; }
export function moveCard(game, from, to, type, amount = 1) {
  if (!CARD_TYPES.includes(type) || !Number.isSafeInteger(amount) || amount < 0) return fail('Invalid card transfer');
  if (COMMODITIES.includes(type) && !game.citiesKnights) return fail('Commodities are unavailable');
  const source = from === 'bank' ? COMMODITIES.includes(type) ? game.citiesKnights.commodityBank : game.bank
    : COMMODITIES.includes(type) ? from.commodities : from.resources;
  const destination = to === 'bank' ? COMMODITIES.includes(type) ? game.citiesKnights.commodityBank : game.bank
    : COMMODITIES.includes(type) ? to.commodities : to.resources;
  if ((source[type] || 0) < amount) return fail(`${type} is unavailable`);
  source[type] -= amount;
  destination[type] += amount;
  return { success: true };
}
export function validateCardBundle(game, player, cards, count = null) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return fail('Choose card amounts');
  let total = 0;
  for (const [type, amount] of Object.entries(cards)) {
    if (!CARD_TYPES.includes(type) || !Number.isSafeInteger(amount) || amount < 0 || amount > cardBalance(player,type)) return fail('Invalid card amounts');
    total += amount;
  }
  if (count != null && total !== count) return fail(`Choose exactly ${count} cards`);
  return { success: true, total };
}
export function transferCards(game, from, to, cards) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return fail('Invalid card transfer');
  for (const [type, amount] of Object.entries(cards)) {
    if (!CARD_TYPES.includes(type) || COMMODITIES.includes(type) && !game.citiesKnights || !Number.isSafeInteger(amount) || amount < 0) return fail('Invalid card transfer');
    const balance = from === 'bank' ? bankBalance(game, type) : cardBalance(from, type);
    if (balance < amount) return fail(`${type} is unavailable`);
  }
  for (const [type, amount] of Object.entries(cards)) moveCard(game, from, to, type, amount);
  return { success: true };
}

export function configureCitiesKnights(game, options) {
  if (game.phase !== 'waiting' || game.citiesKnights) return fail('City rules are locked');
  if (SF.isSeafarers(game) && ['the_forgotten_tribe','the_pirate_islands'].includes(game.seafarers.scenario))
    return fail('This combination needs unpublished development-card conversion rules');
  const originalRobber = game.robber;
  const originalPirate = game.pirate;
  const perType = game.players.length >= 5 ? 18 : 12;
  const progressDecks = Object.fromEntries(Object.entries(PROGRESS_CARDS).map(([color, types]) =>
    [color, shuffle(Object.entries(types).flatMap(([type, copies]) => Array.from({ length: copies }, () =>
      ({ id: crypto.randomUUID(), color, type }))))]));
  game.citiesKnights = {
    commodityBank: Object.fromEntries(COMMODITIES.map(type => [type, perType])),
    progressDecks,
    barbarian: { position: 0, max: 7, attacked: false },
    eventDie: null,
    knights: {}, walls: {},
    metropolises: Object.fromEntries(Object.keys(TRACKS).map(track => [track, { ownerId: null, vertexKey: null, permanent: false }])),
    merchant: { ownerId: null, hexKey: null },
    merchantFleet: null,
    turnSerial: 0,
    choiceQueue: [], pendingRollTotal: null,
    activeCard: null,
    harborOffers: null,
    deferredProgressDraws: [],
  };
  for (const player of game.players) {
    player.commodities = { paper: 0, coin: 0, cloth: 0 };
    player.progressCards = [];
    player.progressVictoryCards = [];
    player.cityImprovements = { science: 0, trade: 0, politics: 0 };
    player.defenderPoints = 0;
    player.wallSupply = 3;
  }
  game.devCardDeck = [];
  game.largestArmyPlayer = null;
  game.largestArmySize = 2;
  game.robber = null;
  if (SF.isSeafarers(game)) {
    game.citiesKnights.robberStart = originalRobber;
    game.citiesKnights.pirateStart = originalPirate;
    game.pirate = null;
    game.seafarers.goal += 2;
  } else {
    game.citiesKnights.robberStart = originalRobber;
  }
  return { success: true };
}

export function onGameStart(game) {
  if (!isCitiesKnights(game)) return { success: true };
  game.robber = null;
  if (SF.isSeafarers(game)) game.pirate = null;
  return { success: true };
}

export function publicState(game) {
  if (!isCitiesKnights(game)) return null;
  const state = structuredClone(game.citiesKnights);
  state.progressDecks = Object.fromEntries(Object.entries(state.progressDecks).map(([color, deck]) => [color, deck.length]));
  state.commodityBank = Object.fromEntries(COMMODITIES.map(type => [type, state.commodityBank[type] > 0]));
  delete state.choiceQueue;
  delete state.deferredProgressDraws;
  delete state.activeCard;
  delete state.pendingRollTotal;
  return state;
}

export function publicChoice(game, playerId) {
  const choice = game.pendingChoice;
  if (!choice) return null;
  return { id: choice.id, expansion: choice.expansion, kind: choice.kind,
    actorId: choice.actorId, label: choice.label,
    options: choice.actorId === playerId ? structuredClone(choice.options || []) : [],
    ...(choice.actorId === playerId && choice.selection === 'cards' ? {
      selection:'cards',count:choice.count,allowedCards:[...choice.allowedCards],
      availableCards:structuredClone(choice.availableCards),
    } : {}),
    ...(choice.actorId === playerId && choice.kind === 'card:commercialHarbor' ? {
      sourcePlayerId:choice.context.sourceId,offeredResource:choice.context.resource,
    } : {}) };
}

export function isVpProgressCard(card) { return VP_CARDS.has(card.type); }

export function canonicalVertex(game, vertexKey) { return SF.canonicalVertex(game, vertexKey); }
export function knightAt(game, vertexKey) {
  const key = canonicalVertex(game, vertexKey);
  return key ? game.citiesKnights?.knights[key] || null : null;
}
export function ownCityKeys(game, playerId) {
  const index = playerIndex(game, playerId);
  return Object.keys(game.vertices).filter(key => game.vertices[key]?.owner === index && game.vertices[key]?.building === 'city');
}
export function ownKnightCount(game, playerId, strength) {
  return Object.values(game.citiesKnights.knights).filter(knight => knight.ownerId === playerId && knight.strength === strength).length;
}
export function hasOwnRouteAt(game, playerId, vertexKey) {
  return SF.incidentRoutes(game, vertexKey, playerIndex(game, playerId)).length > 0;
}
export function vertexHasPiece(game, vertexKey) {
  return Boolean(SF.buildingAt(game, vertexKey)?.vertex?.building || knightAt(game, vertexKey));
}

function spend(game, player, cards) { return transferCards(game, player, 'bank', cards); }
function canSpend(player, cards) { return Object.entries(cards).every(([type, count]) => cardBalance(player, type) >= count); }
function checkMain(game, playerId) {
  if (!isCitiesKnights(game) || game.phase !== 'playing' || game.turnPhase !== 'main') return fail('Action is unavailable now');
  if (game.players[game.currentPlayerIndex]?.id !== playerId) return fail('Not your action phase');
  return { success: true };
}

export function buildCityWall(game, playerId, vertexKey, free = false) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  const player = game.players[playerIndex(game, playerId)];
  const city = SF.buildingAt(game, vertexKey);
  if (!city || city.vertex.owner !== playerIndex(game, playerId) || city.vertex.building !== 'city') return fail('Choose one of your cities');
  const key = canonicalVertex(game, vertexKey);
  if (game.citiesKnights.walls[key] || player.wallSupply <= 0) return fail('No city wall can be built here');
  if (!free && !canSpend(player, { brick: 2 })) return fail('Need two brick');
  if (!free) spend(game, player, { brick: 2 });
  game.citiesKnights.walls[key] = playerId;
  player.wallSupply--;
  return { success: true };
}

export function improveCity(game, playerId, track, vertexKey = null, discount = 0) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  if (!Object.hasOwn(TRACKS, track)) return fail('Choose an improvement');
  const player = game.players[playerIndex(game, playerId)];
  if (!ownCityKeys(game, playerId).length) return fail('A city is required');
  const current = player.cityImprovements[track];
  if (current >= 5) return fail('Improvement is complete');
  const next = current + 1;
  const cost = Math.max(0, next - discount);
  if (!canSpend(player, { [TRACKS[track]]: cost })) return fail(`Need ${cost} ${TRACKS[track]}`);
  const metro = game.citiesKnights.metropolises[track];
  if (next >= 4 && !metro.permanent && (metro.ownerId == null || current >= game.players.find(p => p.id === metro.ownerId)?.cityImprovements[track])) {
    const city = vertexKey ? SF.buildingAt(game, vertexKey) : null;
    if (!city || city.vertex.owner !== playerIndex(game, playerId) || city.vertex.building !== 'city') return fail('Choose a city for the metropolis');
    const selected = canonicalVertex(game, vertexKey);
    if (Object.values(game.citiesKnights.metropolises).some(other => other.vertexKey === selected && other !== metro)) return fail('City already holds a metropolis');
  }
  spend(game, player, { [TRACKS[track]]: cost });
  player.cityImprovements[track] = next;
  if (next >= 4 && !metro.permanent && (metro.ownerId == null || next > game.players.find(p => p.id === metro.ownerId)?.cityImprovements[track])) {
    if (metro.ownerId) game.players.find(p => p.id === metro.ownerId).victoryPoints -= 2;
    metro.ownerId = playerId; metro.vertexKey = canonicalVertex(game, vertexKey); metro.permanent = next === 5;
    player.victoryPoints += 2;
  } else if (next === 5 && metro.ownerId === playerId) metro.permanent = true;
  G.checkWinner(game);
  return { success: true };
}

export function recruitKnight(game, playerId, vertexKey, strength = 1, free = false, active = false) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  const key = canonicalVertex(game, vertexKey);
  if (!key || vertexHasPiece(game, key) || !hasOwnRouteAt(game, playerId, key)) return fail('Choose an empty intersection on your route');
  if (ownKnightCount(game, playerId, strength) >= 2) return fail('No knight piece remains at that strength');
  const player = game.players[playerIndex(game, playerId)];
  if (!free && !canSpend(player, { wool: 1, ore: 1 })) return fail('Need wool and ore');
  if (!free) spend(game, player, { wool: 1, ore: 1 });
  game.citiesKnights.knights[key] = { ownerId: playerId, strength, active, activatedTurn: active ? -1 : null,
    promotedTurn: null, actedTurn: null };
  G.updateLongestRoad(game);
  return { success: true };
}

export function promoteKnight(game, playerId, vertexKey, free = false) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  const knight = knightAt(game, vertexKey), player = game.players[playerIndex(game, playerId)];
  if (!knight || knight.ownerId !== playerId) return fail('Choose one of your knights');
  if (knight.strength >= 3 || knight.promotedTurn === game.citiesKnights.turnSerial) return fail('Knight cannot be promoted again now');
  if (knight.strength === 2 && player.cityImprovements.politics < 3) return fail('Politics level 3 is required');
  if (ownKnightCount(game, playerId, knight.strength + 1) >= 2) return fail('No stronger knight piece remains');
  if (!free && !canSpend(player, { wool: 1, ore: 1 })) return fail('Need wool and ore');
  if (!free) spend(game, player, { wool: 1, ore: 1 });
  knight.strength++; knight.promotedTurn = game.citiesKnights.turnSerial;
  return { success: true };
}

export function activateKnight(game, playerId, vertexKey, free = false) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  const knight = knightAt(game, vertexKey), player = game.players[playerIndex(game, playerId)];
  if (!knight || knight.ownerId !== playerId || knight.active) return fail('Choose one of your inactive knights');
  if (!free && !canSpend(player, { grain: 1 })) return fail('Need grain');
  if (!free) spend(game, player, { grain: 1 });
  knight.active = true; knight.activatedTurn = game.citiesKnights.turnSerial;
  return { success: true };
}

export function routeReachableVertices(game, playerId, fromVertexKey) {
  const origin = canonicalVertex(game, fromVertexKey), owner = playerIndex(game, playerId);
  if (!origin) return [];
  const visited = new Set([`${origin}:start`]), reached = new Set(), queue = [{vertex:origin,kind:null}];
  for (const {vertex,kind} of queue) {
    for (const route of SF.incidentRoutes(game, vertex, owner)) {
      const nextKind=route.edge.ship?'ship':'road';
      if (kind && kind!==nextKind && SF.buildingAt(game,vertex)?.vertex?.owner!==owner) continue;
      const other = SF.edgeEndpoints(route.key).map(key => canonicalVertex(game, key)).find(key => key !== vertex);
      if (!other || visited.has(`${other}:${nextKind}`)) continue;
      reached.add(other);
      const foreign = SF.buildingAt(game, other)?.vertex;
      const foreignKnight = knightAt(game, other);
      if (foreign?.building && foreign.owner !== owner || foreignKnight && foreignKnight.ownerId !== playerId) {
        visited.add(`${other}:${nextKind}`); continue;
      }
      visited.add(`${other}:${nextKind}`); queue.push({vertex:other,kind:nextKind});
    }
  }
  reached.delete(origin);
  return [...reached];
}
export function moveKnight(game, playerId, fromVertexKey, toVertexKey) {
  const phase = checkMain(game, playerId); if (!phase.success) return phase;
  const from = canonicalVertex(game, fromVertexKey), to = canonicalVertex(game, toVertexKey);
  const knight = from && game.citiesKnights.knights[from];
  if (!knight || knight.ownerId !== playerId || !knight.active || knight.activatedTurn === game.citiesKnights.turnSerial || knight.actedTurn === game.citiesKnights.turnSerial) return fail('Knight cannot move now');
  if (!routeReachableVertices(game, playerId, from).includes(to)) return fail('Destination is not on your connected route');
  if (SF.buildingAt(game, to)?.vertex?.building) return fail('Destination has a building');
  const target = game.citiesKnights.knights[to];
  if (target?.ownerId === playerId || target && target.strength >= knight.strength) return fail('Destination is occupied by a knight you cannot displace');
  if (target) {
    const options = routeReachableVertices(game, target.ownerId, to)
      .filter(key => key === from || !vertexHasPiece(game, key))
      .map(key => ({ id: key, label: 'Move knight', vertexKey: key }));
    if (!options.length) options.push({ id: 'remove', label: 'Return knight to supply' });
    enqueueChoice(game, { kind: 'displaceKnight', actorId: target.ownerId, label: 'Move your displaced knight', options,
      context: { from: to, knight: structuredClone(target) } });
  }
  delete game.citiesKnights.knights[from];
  game.citiesKnights.knights[to] = { ...knight, active: false, actedTurn: game.citiesKnights.turnSerial };
  if (!target) G.updateLongestRoad(game);
  return { success: true };
}

export function driveRobber(game, playerId, vertexKey, hexKey, stealFromPlayerId = null, stealType = 'resource') {
  const phase = checkMain(game,playerId); if (!phase.success) return phase;
  const knight = knightAt(game,vertexKey), origin = canonicalVertex(game,vertexKey);
  if (!knight || knight.ownerId !== playerId || !knight.active || knight.activatedTurn === game.citiesKnights.turnSerial || knight.actedTurn === game.citiesKnights.turnSerial) return fail('Knight cannot act now');
  const adjacent = G.getVertexAdjacentHexes(game,origin).map(hex => G.hexKey(hex.q,hex.r));
  if (!game.citiesKnights.barbarian.attacked) return fail('Robber and pirate are not active yet');
  const pirate = SF.isSeafarers(game) && game.pirate && adjacent.includes(game.pirate) && SF.canMovePirate(game,hexKey).valid;
  if (!pirate && (!game.robber || !adjacent.includes(game.robber))) return fail('Knight is not beside the robber or pirate');
  const previousPhase = game.turnPhase;
  game.turnPhase = 'robber';
  const result = pirate ? SF.movePirate(game,playerId,hexKey,stealFromPlayerId,stealType) : G.moveRobber(game,playerId,hexKey,stealFromPlayerId);
  if (!result.success) { game.turnPhase = previousPhase; return result; }
  knight.active = false; knight.actedTurn = game.citiesKnights.turnSerial;
  if (game.pendingRobberPick) game.pendingRobberPick.resumePhase='main';
  if (game.turnPhase === 'roll') game.turnPhase = 'main';
  return result;
}

export function enqueueChoice(game, choice, immediate = false) {
  const queued = { ...choice, id: crypto.randomUUID(), expansion: 'cities_knights' };
  if (immediate) game.citiesKnights.choiceQueue.unshift(queued);
  else game.citiesKnights.choiceQueue.push(queued);
  exposeNextChoice(game);
}
export function exposeNextChoice(game) {
  if (game.pendingChoice || !game.citiesKnights) return;
  const state = game.citiesKnights;
  while (!game.pendingChoice) {
    if (game.phase === 'finished') {
      state.pendingRollTotal = null;
      state.choiceQueue = [];
      state.deferredProgressDraws = [];
      return;
    }
    if (state.choiceQueue.length) {
      const choice = state.choiceQueue.shift();
      if (choice.kind === 'defenderDraw') {
        choice.options = Object.keys(TRACKS).filter(color => state.progressDecks[color].length > 0)
          .map(id => ({ id, label: id }));
        if (!choice.options.length) continue;
      }
      game.pendingChoice = choice;
      return;
    }
    if (state.deferredProgressDraws.length) {
      const { playerId, color } = state.deferredProgressDraws.shift();
      drawProgress(game, playerId, color);
      continue;
    }
    if (state.pendingRollTotal != null) {
      const total = state.pendingRollTotal;
      state.pendingRollTotal = null;
      G.completeRoll(game, total);
    }
    return;
  }
}
export function drawProgress(game, playerId, color) {
  const deck = game.citiesKnights.progressDecks[color];
  if (!deck?.length) return fail('Progress deck is empty');
  const card = deck.shift();
  const player = game.players.find(p => p.id === playerId);
  if (isVpProgressCard(card)) {
    player.victoryPoints++;
    player.progressVictoryCards.push({type:card.type,color:card.color});
    G.checkWinner(game);
  } else {
    player.progressCards.push(card);
    if (player.progressCards.length > 4 && playerId !== game.players[game.currentPlayerIndex]?.id) {
      enqueueChoice(game, { kind: 'discardProgress', actorId: playerId, label: 'Return one progress card to its deck',
        options: player.progressCards.map(value => ({ id: value.id, label: `${value.color}: ${value.type}`, cardId: value.id,cardType:value.type,color:value.color })) }, true);
    }
  }
  return { success: true, card: card.type };
}
export function returnProgress(game, player, cardId) {
  const index = player.progressCards.findIndex(card => card.id === cardId);
  if (index < 0) return fail('Progress card is unavailable');
  const [card] = player.progressCards.splice(index, 1);
  game.citiesKnights.progressDecks[card.color].push(card);
  return { success: true, card };
}
export function discardLimit(game, playerId) {
  const walls = Object.values(game.citiesKnights.walls).filter(owner => owner === playerId).length;
  return 7 + 2 * walls;
}

function battle(game) {
  const state = game.citiesKnights;
  const cities = Object.values(game.vertices).filter(vertex => vertex.building === 'city').length;
  const strengths = Object.fromEntries(game.players.map(player => [player.id, 0]));
  for (const knight of Object.values(state.knights)) if (knight.active) strengths[knight.ownerId] += knight.strength;
  const defending = Object.values(strengths).reduce((a,b) => a+b, 0);
  state.lastBarbarianAttack={turnSerial:state.turnSerial,defense:defending,cities,repelled:defending>=cities,
    defenderIds:[],pillagedPlayerIds:[]};
  if (defending >= cities) {
    const max = Math.max(...Object.values(strengths));
    const clockwisePlayers = [...game.players.slice(game.currentPlayerIndex), ...game.players.slice(0, game.currentPlayerIndex)];
    const leaders = clockwisePlayers.filter(player => strengths[player.id] === max);
    state.lastBarbarianAttack.defenderIds=leaders.map(player=>player.id);
    if (leaders.length === 1) { leaders[0].defenderPoints++; leaders[0].victoryPoints++; G.checkWinner(game); }
    else if (leaders.length > 1) {
      const availableDecks = Object.keys(TRACKS).filter(color => state.progressDecks[color].length > 0);
      if (availableDecks.length) for (const player of leaders) enqueueChoice(game, {
        kind: 'defenderDraw', actorId: player.id, label: 'Choose a progress deck for your defense reward',
        options: availableDecks.map(id => ({ id, label: id })) });
    }
  } else {
    const tiers = [...new Set(Object.values(strengths))].sort((a,b) => a-b);
    const lowest = tiers.find(tier => game.players.some(player => strengths[player.id] === tier &&
      ownCityKeys(game,player.id).some(key => !Object.values(state.metropolises).some(metro => metro.vertexKey === canonicalVertex(game,key)))));
    if (lowest != null) for (const player of game.players) if (strengths[player.id] === lowest) {
      const options = ownCityKeys(game,player.id).filter(key => !Object.values(state.metropolises).some(metro => metro.vertexKey === canonicalVertex(game,key)))
        .map(key => ({ id: key, label: 'Downgrade this city', vertexKey: key }));
      if (options.length) enqueueChoice(game, { kind: 'pillageCity', actorId: player.id, label: 'Barbarians pillage one of your cities', options });
      if (options.length) state.lastBarbarianAttack.pillagedPlayerIds.push(player.id);
    }
  }
  state.barbarian.position = 0;
  state.barbarian.attacked = true;
  for (const knight of Object.values(state.knights)) knight.active = false;
  if (!game.robber) game.robber = state.robberStart;
  if (SF.isSeafarers(game) && !game.pirate) game.pirate = state.pirateStart;
  return { success: true, defense: defending, cities };
}

export function rollEvent(game, redDie, total) {
  const state = game.citiesKnights;
  const face = ['barbarian','barbarian','barbarian','science','trade','politics'][Math.floor(Math.random()*6)];
  state.eventDie = face;
  state.pendingRollTotal = total;
  if (face === 'barbarian') {
    state.barbarian.position++;
    if (state.barbarian.position >= state.barbarian.max) battle(game);
  } else {
    const roller = game.currentPlayerIndex;
    for (let offset = 0; offset < game.players.length; offset++) {
      const player = game.players[(roller + offset) % game.players.length];
      const level = player.cityImprovements[face];
      if (level > 0 && redDie <= level + 1) state.deferredProgressDraws.push({ playerId: player.id, color: face });
    }
  }
  exposeNextChoice(game);
  return { success: true, eventDie: face };
}

function pillageCity(game, playerId, vertexKey) {
  const found = SF.buildingAt(game, vertexKey);
  if (!found || found.vertex.owner !== playerIndex(game,playerId) || found.vertex.building !== 'city') return fail('City is unavailable');
  const key = canonicalVertex(game,vertexKey);
  if (Object.values(game.citiesKnights.metropolises).some(metro => metro.vertexKey === key)) return fail('Metropolis cannot be pillaged');
  found.vertex.building = 'settlement';
  const player = game.players[playerIndex(game,playerId)];
  player.victoryPoints--;
  if (player.settlements > 0) { player.settlements--; player.cities++; }
  else found.vertex.pillagedNoPiece = true;
  if (game.citiesKnights.walls[key]) { delete game.citiesKnights.walls[key]; player.wallSupply++; }
  return { success: true };
}

export function resolveCitiesKnightsChoice(game, playerId, choiceId, optionId, cards = null) {
  const choice = game.pendingChoice;
  if (!choice || choice.expansion !== 'cities_knights' || choice.id !== choiceId || choice.actorId !== playerId) return fail('This choice is unavailable');
  const option = choice.options?.find(item => item.id === optionId);
  if (choice.options?.length && !option) return fail('Choose a listed option');
  let result = { success: true };
  const player = game.players.find(p => p.id === playerId);
  switch (choice.kind) {
    case 'discardProgress': result = returnProgress(game, player, option.cardId); break;
    case 'defenderDraw': result = drawProgress(game, playerId, option.id); break;
    case 'pillageCity': result = pillageCity(game, playerId, option.vertexKey); break;
    case 'displaceKnight': {
      const target = choice.context.knight;
      if (!target || target.ownerId !== playerId) return fail('Displaced knight is unavailable');
      if (option.id !== 'remove') game.citiesKnights.knights[option.vertexKey] = target;
      G.updateLongestRoad(game);
      break;
    }
    case 'aqueduct': result = moveCard(game,'bank',player,option.id,1); break;
    case 'progressHandLimit': result = returnProgress(game,player,option.cardId); break;
    default:
      if (!choice.kind.startsWith('card:')) return fail('Unknown city choice');
      result = Cards.resolveCardChoice(game, playerId, choice, option, cards);
  }
  if (!result.success) return result;
  game.pendingChoice = null;
  if (result.afterRoll) Cards.finishAlchemyRoll(game,result.afterRoll.red,result.afterRoll.other);
  if (SF.isSeafarers(game) && !game.pendingChoice) SF.advanceChoiceQueue(game);
  exposeNextChoice(game);
  return { success: true };
}

export function playProgressCard(game,playerId,cardId,params={}) { return Cards.playProgressCard(game,playerId,cardId,params); }
export function offerCommercialHarbor(game,playerId,targetPlayerId,resource) { return Cards.offerCommercialHarbor(game,playerId,targetPlayerId,resource); }
