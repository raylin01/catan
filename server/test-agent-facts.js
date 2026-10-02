import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import * as CK from './citiesKnightsCore.js';
import { executeAction, legalActions, playerView } from './actions.js';
import { createAgentBoard } from './agentBoard.js';
import { describeAgentActions } from './agentFacts.js';

const resources = ['brick', 'lumber', 'wool', 'grain', 'ore'];
function fixture(expansions = [], scenario = 'base') {
  const game = G.createGame('synthetic-facts', { id: 'p0', name: 'A' });
  for (let i = 1; i < 3; i++) G.addPlayer(game, { id: `p${i}`, name: `P${i}` });
  if (expansions.length) assert.equal(G.configureExpansions(game, { version: 1, expansions, scenario, setup: { layout: 'fixed', seed: 42 } }).success, true);
  assert.equal(G.startGame(game).success, true);
  // startGame randomizes seating; fixtures explicitly use p0 at seat index 0.
  game.players.sort((a, b) => a.id.localeCompare(b.id));
  game.currentPlayerIndex = 0;
  return game;
}
function observe(game, actions = null, seatId = 'p0') {
  const view = { seatId, gameState: playerView(game, seatId), legalActions: actions || legalActions(game, seatId) };
  const graph = createAgentBoard(view.gameState);
  return { view, graph, result: describeAgentActions(view, graph) };
}
function fund(game) {
  game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  game.hasRolledThisTurn = true;
  game.players[0].resources = Object.fromEntries(resources.map(card => [card, 5]));
  if (game.citiesKnights) game.players[0].commodities = { paper: 5, cloth: 5, coin: 5 };
}
const hand = game => ({ ...game.players[0].resources, ...(game.citiesKnights ? game.players[0].commodities : {}) });
function compareExecution(game, action, facts) {
  const copy = structuredClone(game), before = hand(copy);
  assert.equal(executeAction(copy, 'p0', action.type, action.payload).success, true, action.type);
  const after = hand(copy);
  if (action.type === 'bankTrade') assert.deepEqual(facts.handAfterTrade, after);
  else assert.deepEqual(facts.handAfterCost, after);
  for (const [card, amount] of Object.entries(facts.cost)) assert.equal(before[card] - after[card], amount, `${action.type} ${card}`);
  return copy;
}
function ownRoadTip(game) {
  const graph = createAgentBoard(playerView(game, 'p0'));
  const rawVertex = id => Object.keys(game.vertices).find(key => graph.ids.vertices[key] === id);
  const rawEdge = id => Object.keys(game.edges).find(key => graph.ids.edges[key] === id);
  for (const first of graph.board.edges) {
    const origin = first.ends[0], near = first.ends[1];
    const second = graph.board.edges.find(edge => edge.id !== first.id && edge.ends.includes(near) && !edge.ends.includes(origin));
    if (!second) continue;
    const target = second.ends.find(id => id !== near);
    const copy = structuredClone(game);
    copy.vertices[rawVertex(origin)] = { building: 'settlement', owner: 0 };
    copy.edges[rawEdge(first.id)] = { road: true, owner: 0 };
    const key = rawEdge(second.id);
    if (!G.canPlaceRoad(copy, 'p0', key, false, null).valid) continue;
    copy.edges[key] = { road: true, owner: 0 };
    if (!G.canPlaceSettlement(copy, 'p0', rawVertex(target), false).valid) continue;
    game.vertices[rawVertex(origin)] = { building: 'settlement', owner: 0 };
    game.edges[rawEdge(first.id)] = { road: true, owner: 0 };
    return { origin, near, target, road: key, rawVertex, rawEdge, graph };
  }
  throw Error('No road-tip fixture');
}

test('setup physical aliases collapse with stable original indices and all action types survive', () => {
  const game = fixture();
  const { view, graph, result } = observe(game);
  assert.equal(result.horizon, 'immediate');
  const candidates = result.actions.filter(action => action.type === 'placeSettlement');
  assert.equal(candidates.length, new Set(view.legalActions.filter(action => action.type === 'placeSettlement').map(action => graph.ids.vertices[action.payload.vertexKey])).size);
  assert.ok(candidates.length > 20, 'all candidates, no top-N pruning');
  for (const candidate of candidates) {
    assert.equal(candidate.id, `a${candidate.actionIndex}`);
    assert.equal(candidate.params.vertexKey, graph.ids.vertices[view.legalActions[candidate.actionIndex].payload.vertexKey]);
    assert.deepEqual(candidate.facts.cost, {});
    assert.deepEqual(candidate.facts.handAfterCost, hand(game));
  }
  for (const original of view.legalActions) assert.ok(result.actions.some(action => action.type === original.type && action.params.vertexKey === graph.ids.vertices[original.payload.vertexKey]));
  const synthetic = [...view.legalActions, { type: 'unknownFutureAction', payload: { params: { fromVertexKey: view.legalActions[0].payload.vertexKey, value: 'kept' } } }, { type: 'endTurn', payload: {} }, { type: 'endTurn', payload: {} }];
  const all = describeAgentActions({ ...view, legalActions: synthetic }, graph).actions;
  assert.equal(all.at(-3).type, 'unknownFutureAction');
  assert.match(all.at(-3).params.params.fromVertexKey, /^V/);
  assert.equal(all.filter(action => action.type === 'endTurn').length, 2, 'only physical duplicates collapse');
  assert.doesNotMatch(JSON.stringify(all), /(?:v|e)_-?\d+_-?\d+_[0-5]/);
});

test('base road, settlement, city and bank sequence facts agree with authoritative execution', () => {
  const game = fixture(); fund(game);
  const tip = ownRoadTip(game);
  game.players[0].resources = { brick: 2, lumber: 2, wool: 1, grain: 3, ore: 3 };
  let observed = observe(game, [{ type: 'placeRoad', payload: { edgeKey: tip.road } }]);
  let facts = observed.result.actions[0].facts;
  assert.deepEqual(facts.cost, { brick: 1, lumber: 1 });
  assert.ok(facts.opens.some(site => site.vertex === tip.target));
  assert.deepEqual(facts.opens.find(site => site.vertex === tip.target).missingCards, {});
  let next = compareExecution(game, observed.view.legalActions[0], facts);
  observed = observe(next, [{ type: 'placeSettlement', payload: { vertexKey: tip.rawVertex(tip.target) } }]);
  next = compareExecution(next, observed.view.legalActions[0], observed.result.actions[0].facts);
  observed = observe(next, [{ type: 'upgradeToCity', payload: { vertexKey: tip.rawVertex(tip.target) } }]);
  next = compareExecution(next, observed.view.legalActions[0], observed.result.actions[0].facts);
  next.players[0].resources.wool = 8;
  const trade = legalActions(next, 'p0').find(action => action.type === 'bankTrade' && action.payload.giveResource === 'wool');
  assert.ok(trade);
  observed = observe(next, [trade]);
  compareExecution(next, trade, observed.result.actions[0].facts);
});

test('roads expose exact following-settlement deficit, free-route costs, and opponent distance blockers', () => {
  const game = fixture(); fund(game); const tip = ownRoadTip(game);
  game.players[0].resources = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 };
  let { result } = observe(game, [{ type: 'placeRoad', payload: { edgeKey: tip.road } }]);
  assert.deepEqual(result.actions[0].facts.opens.find(site => site.vertex === tip.target).missingCards, { brick: 1, lumber: 1 });
  game.freeRoads = 1;
  result = observe(game, [{ type: 'placeRoad', payload: { edgeKey: tip.road } }]).result;
  assert.deepEqual(result.actions[0].facts.cost, {});
  assert.deepEqual(result.actions[0].facts.opens.find(site => site.vertex === tip.target).missingCards, {});
  compareExecution(game, { type: 'placeRoad', payload: { edgeKey: tip.road } }, result.actions[0].facts);
  const blocker = tip.graph.board.edges.find(edge => edge.ends.includes(tip.target) && !edge.ends.includes(tip.near));
  const adjacent = blocker.ends.find(id => id !== tip.target);
  game.vertices[tip.rawVertex(adjacent)] = { building: 'settlement', owner: 1 };
  result = observe(game, [{ type: 'placeRoad', payload: { edgeKey: tip.road } }]).result;
  assert.ok(!result.actions[0].facts.opens.some(site => site.vertex === tip.target));
});

test('all immediate settlement and city opportunities include costs and missing cards', () => {
  const game = fixture(); fund(game); const tip = ownRoadTip(game);
  game.edges[tip.road] = { road: true, owner: 0 };
  game.players[0].resources = { brick: 0, lumber: 1, wool: 2, grain: 1, ore: 0 };
  const { result, graph } = observe(game, []);
  const settlement = result.opportunities.find(site => site.type === 'settlement' && site.vertex === tip.target);
  assert.deepEqual(settlement.missingCards, { brick: 1 });
  assert.equal(settlement.executable, false);
  const funded = structuredClone(game); funded.players[0].resources = Object.fromEntries(resources.map(resource => [resource, 9]));
  const expected = new Set(Object.keys(game.vertices).filter(key => G.canPlaceSettlement(funded, 'p0', key, false).valid).map(key => graph.ids.vertices[key]));
  assert.deepEqual(new Set(result.opportunities.filter(site => site.type === 'settlement').map(site => site.vertex)), expected);
  assert.deepEqual(result.opportunities.find(site => site.type === 'city').missingCards, { ore: 3, grain: 1 });
});

test('C&K city production, pillaged upgrade constraints and mandatory discounted choices are exact', () => {
  const game = fixture(['cities_knights']); fund(game);
  const key = Object.keys(game.vertices).find(key => G.getVertexAdjacentHexes(game, key).some(hex => ['lumber', 'wool', 'ore'].includes(hex.resource)));
  game.vertices[key] = { owner: 0, building: 'settlement', pillagedNoPiece: true };
  game.players[0].cities = 0;
  const other = Object.keys(game.vertices).find(vertex => vertex !== key && !G.areVerticesEqual(vertex, key));
  game.vertices[other] = { owner: 0, building: 'settlement' };
  let observed = observe(game, [{ type: 'upgradeToCity', payload: { vertexKey: key } }]);
  assert.equal(observed.result.opportunities.filter(site => site.type === 'city').length, 1);
  const production = observed.result.actions[0].facts.production;
  for (const tile of production) assert.deepEqual(tile.yield, { brick: { brick: 2 }, grain: { grain: 2 }, lumber: { lumber: 1, paper: 1 }, wool: { wool: 1, cloth: 1 }, ore: { ore: 1, coin: 1 } }[tile.resource]);
  const optionId = `medicine:${key}`;
  game.pendingChoice = { id: 'choice-medicine', expansion: 'cities_knights', actorId: 'p0', kind: 'card:medicine', label: 'Choose a settlement', options: [{ id: optionId, label: 'Upgrade settlement', vertexKey: key }] };
  observed = observe(game);
  const choice = observed.result.actions[0];
  assert.equal(choice.facts.choice.kind, 'card:medicine');
  assert.deepEqual(choice.facts.cost, { grain: 1, ore: 2 });
  assert.match(choice.facts.option.vertexKey, /^V/);
  assert.doesNotMatch(JSON.stringify(choice), /v_-?\d+_-?\d+_[0-5]/);
  compareExecution(game, observed.view.legalActions[choice.actionIndex], choice.facts);
  delete game.pendingChoice; game.vertices[key].building = 'city'; delete game.vertices[key].pillagedNoPiece;
  game.players[0].cityImprovements.science = 2;
  game.pendingChoice = { id: 'choice-crane', expansion: 'cities_knights', actorId: 'p0', kind: 'card:crane', label: 'Improve', options: [{ id: `science:${key}`, track: 'science', vertexKey: key }] };
  observed = observe(game);
  assert.deepEqual(observed.result.actions[0].facts.cost, { paper: 2 });
  compareExecution(game, observed.view.legalActions[0], observed.result.actions[0].facts);
});

test('distinct choice identities and progress-card identities survive geometry equivalence', () => {
  const game = fixture(['cities_knights']); fund(game);
  const key = Object.keys(game.vertices)[0];
  const graph = createAgentBoard(playerView(game, 'p0'));
  const alias = Object.keys(graph.ids.vertices).find(alias => alias !== key && graph.ids.vertices[alias] === graph.ids.vertices[key]);
  game.pendingChoice = { id: 'choice', actorId: 'p0', expansion: 'cities_knights', kind: 'card:treasonPlace', label: 'Choose strength', options: [{ id: `${key}:1`, vertexKey: key, strength: 1 }, { id: `${alias}:2`, vertexKey: alias, strength: 2 }] };
  const { result } = observe(game);
  assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions.map(action => action.actionIndex), [0, 1]);
  assert.deepEqual(result.actions.map(action => action.facts.option.strength), [1, 2]);
  assert.equal(result.actions[0].facts.option.vertexKey, result.actions[1].facts.option.vertexKey);
  delete game.pendingChoice;
  game.players[0].progressCards = [{ id: 'progress-1', color: 'science', type: 'medicine' }, { id: 'progress-2', color: 'science', type: 'medicine' }];
  const cards = observe(game, [{ type: 'playProgressCard', payload: { cardId: 'progress-1' } }, { type: 'playProgressCard', payload: { cardId: 'progress-2' } }]).result.actions;
  assert.equal(cards.length, 2); assert.equal(cards[0].facts.card.type, 'medicine');
});

test('C&K ordinary wall, improvement and knight costs agree with execution, including free card choices', () => {
  const game = fixture(['cities_knights']); fund(game);
  const tip = ownRoadTip(game), city = tip.rawVertex(tip.origin), knight = tip.rawVertex(tip.near);
  game.vertices[city].building = 'city';
  game.players[0].cityImprovements.science = 2;
  for (const action of [
    { type: 'buildCityWall', payload: { vertexKey: city } },
    { type: 'improveCity', payload: { track: 'science', vertexKey: city } },
    { type: 'recruitKnight', payload: { vertexKey: knight } },
  ]) {
    const observed = observe(game, [action]);
    compareExecution(game, action, observed.result.actions[0].facts);
  }
  game.citiesKnights.knights[CK.canonicalVertex(game, knight)] = { ownerId: 'p0', strength: 1, active: false };
  for (const type of ['promoteKnight', 'activateKnight']) {
    const action = { type, payload: { vertexKey: knight } };
    compareExecution(game, action, observe(game, [action]).result.actions[0].facts);
  }
  for (const [kind, key] of [['card:engineering', city], ['card:smithingFirst', knight]]) {
    game.pendingChoice = { id: `choice-${kind}`, expansion: 'cities_knights', actorId: 'p0', kind, label: 'Free build', options: [{ id: key, vertexKey: key }] };
    const observed = observe(game);
    assert.deepEqual(observed.result.actions[0].facts.cost, {});
    compareExecution(game, observed.view.legalActions[0], observed.result.actions[0].facts);
  }
});

test('robber facts give visible owners, exact production and public totals without a stolen-card guess', () => {
  const game = fixture(['cities_knights']); fund(game);
  const [hexKey, hex] = Object.entries(game.hexes).find(([, hex]) => ['lumber', 'wool', 'ore'].includes(hex.resource));
  const key = G.getHexVertices(hex.q, hex.r).find(key => game.vertices[key]);
  game.vertices[key] = { owner: 1, building: 'city' };
  game.players[1].resources = { brick: 1, lumber: 2, wool: 3, grain: 4, ore: 5 };
  game.players[1].commodities = { paper: 1, cloth: 1, coin: 1 };
  const action = { type: 'moveRobber', payload: { hexKey, stealFromPlayerId: 'p1' } };
  const { result } = observe(game, [action]);
  const facts = result.actions[0].facts;
  assert.equal(facts.stolenCard, 'unknown');
  assert.deepEqual(facts.eligibleVictims, [{ player: 'p1', publicCardCount: 18 }]);
  assert.equal(facts.affected[0].owner, 'p1');
  assert.equal(Object.values(facts.affected[0].productionBlocked[0].yield).reduce((a, b) => a + b, 0), 2);
});

test('privacy-equivalent authorized views produce identical facts despite different private opponents and decks', () => {
  const first = fixture(['cities_knights']); fund(first); ownRoadTip(first);
  first.players[1].resources = { brick: 5, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const second = structuredClone(first);
  second.players[1].resources = { brick: 0, lumber: 0, wool: 0, grain: 5, ore: 0 };
  for (const deck of Object.values(second.citiesKnights.progressDecks)) deck.reverse();
  second.bank.brick = 1; second.bank.grain += first.bank.brick - 1;
  const actions = [{ type: 'placeRoad', payload: { edgeKey: Object.keys(first.edges).find(key => !first.edges[key].road) } }, { type: 'buyDevCard', payload: {} }];
  const a = observe(first, actions), b = observe(second, actions);
  assert.deepEqual(a.result, b.result);
  const before = structuredClone(a.view);
  describeAgentActions(a.view, a.graph);
  assert.deepEqual(a.view, before, 'does not mutate the authorized observation');
});

test('Seafarers ship cost, free setup ship, frame pirate and wonder facts use public rules', () => {
  const game = fixture(['seafarers'], 'heading_for_new_shores'); fund(game);
  const edgeKey = Object.keys(game.edges).find(key => {
    const vertexKey = SF.edgeEndpoints(key).find(vertex => game.vertices[vertex]);
    if (!vertexKey) return false;
    const copy = structuredClone(game);
    copy.vertices[vertexKey] = { owner: 0, building: 'settlement' };
    return SF.canPlaceShip(copy, 'p0', key).valid;
  });
  assert.ok(edgeKey);
  const vertexKey = SF.edgeEndpoints(edgeKey).find(key => game.vertices[key]);
  game.vertices[vertexKey] = { owner: 0, building: 'settlement' };
  let observed = observe(game, [{ type: 'placeShip', payload: { edgeKey } }]);
  assert.deepEqual(observed.result.actions[0].facts.cost, { lumber: 1, wool: 1 });
  compareExecution(game, observed.view.legalActions[0], observed.result.actions[0].facts);
  game.phase = 'setup'; game.setupAction = { settlement: vertexKey, road: false };
  observed = observe(game, [{ type: 'placeShip', payload: { edgeKey } }]);
  assert.deepEqual(observed.result.actions[0].facts.cost, {});
  observed = observe(game, [{ type: 'movePirate', payload: { hexKey: 'frame:north' } }]);
  assert.deepEqual(observed.result.actions[0].facts.affected, []);
  const wonders = fixture(['seafarers'], 'the_wonders_of_catan'); fund(wonders);
  wonders.seafarers.wonders = [{ id: 'great_wall', ownerId: 'p0', level: 0 }];
  observed = observe(wonders, [{ type: 'buildWonder', payload: {} }]);
  assert.deepEqual(observed.result.actions[0].facts.cost, { brick: 3, lumber: 1, grain: 1 });
  compareExecution(wonders, observed.view.legalActions[0], observed.result.actions[0].facts);
});

test('Seafarers route transitions require an own building and every legal ship has equal opening facts', () => {
  const game = fixture(['seafarers'], 'heading_for_new_shores'); fund(game);
  const graph = createAgentBoard(playerView(game, 'p0'));
  const rawEdge = id => Object.keys(game.edges).find(key => graph.ids.edges[key] === id);
  const rawVertex = id => Object.keys(game.vertices).find(key => graph.ids.vertices[key] === id);
  let transition;
  for (const vertex of graph.board.vertices) {
    const links = graph.board.edges.filter(edge => edge.ends.includes(vertex.id));
    for (const road of links) {
      if (!SF.canPlaceRoadOnSeafarers(game, rawEdge(road.id)).valid) continue;
      for (const ship of links.filter(edge => edge.id !== road.id)) {
        const copy = structuredClone(game);
        copy.edges[rawEdge(road.id)] = { road: true, owner: 0 };
        if (SF.canPlaceShip(copy, 'p0', rawEdge(ship.id)).valid) continue;
        copy.vertices[rawVertex(vertex.id)] = { building: 'settlement', owner: 0 };
        if (!SF.canPlaceShip(copy, 'p0', rawEdge(ship.id)).valid) continue;
        transition = { vertex, road, ship }; break;
      }
      if (transition) break;
    }
    if (transition) break;
  }
  assert.ok(transition);
  const { vertex, road, ship } = transition;
  game.edges[rawEdge(road.id)] = { road: true, owner: 0 };
  let observed = observe(game);
  assert.ok(!observed.result.actions.some(action => action.type === 'placeShip' && action.params.edgeKey === ship.id));
  game.vertices[rawVertex(vertex.id)] = { building: 'settlement', owner: 0 };
  observed = observe(game);
  assert.ok(observed.result.actions.some(action => action.type === 'placeShip' && action.params.edgeKey === ship.id));
  const buildable = candidate => new Set(Object.keys(candidate.vertices).filter(key => G.canPlaceSettlement(candidate, 'p0', key, false).valid).map(key => graph.ids.vertices[key]));
  const before = buildable(game);
  for (const candidate of observed.result.actions.filter(action => action.type === 'placeShip')) {
    const copy = structuredClone(game), original = observed.view.legalActions[candidate.actionIndex];
    // Test fixtures can execute full actions; annotation code only edits geometry.
    assert.equal(executeAction(copy, 'p0', original.type, original.payload).success, true);
    copy.players[0].resources = Object.fromEntries(resources.map(card => [card, 9]));
    const expected = [...buildable(copy)].filter(id => !before.has(id));
    assert.deepEqual(new Set(candidate.facts.opens.map(site => site.vertex)), new Set(expected));
    assert.deepEqual(candidate.facts.endpoints, graph.board.edges.find(edge => edge.id === candidate.params.edgeKey).ends);
  }
  const targetHex = SF.edgeHexes(game, rawEdge(ship.id)).find(hex => hex.terrain === 'sea');
  assert.ok(targetHex);
  game.edges[rawEdge(ship.id)] = { ship: true, owner: 1 };
  game.players[1].resources.grain = 3;
  observed = observe(game, [{ type: 'movePirate', payload: { hexKey: G.hexKey(targetHex.q, targetHex.r), stealFromPlayerId: 'p1' } }]);
  assert.ok(observed.result.actions[0].facts.affected.some(route => route.edge === ship.id && route.owner === 'p1'));
  assert.equal(observed.result.actions[0].facts.stolenCard, 'unknown');
});
