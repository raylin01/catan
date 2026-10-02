import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as CK from './citiesKnightsCore.js';
import * as SF from './seafarersCore.js';
import { RoomService } from './roomService.js';
import { executeAction, legalActions, playerView } from './actions.js';
import { createAgentBoard } from './agentBoard.js';
import { describeAgentActions } from './agentFacts.js';
import { createAgentObservation, agentEnvelope } from './agentObservation.js';
import { combinedHand } from '../shared/cardTypes.js';
import { SEAFARERS_SCENARIOS } from '../shared/scenarios.js';

let serial = 0;
function issue(service, host, actor, type, payload = {}) {
  const view = service.observe(host.code, actor.token);
  return service.command(host.code, actor.token, { requestId: `observation-test-${++serial}`, revision: view.revision, generation: view.generation, type, payload });
}
function roomFixture({ count = 3, scenario, ck = false } = {}) {
  const service = new RoomService();
  const gameOptions = { version: 1, extension56: count >= 5,
    expansions: [...(scenario ? ['seafarers'] : []), ...(ck ? ['cities_knights'] : [])], scenario: scenario || 'base',
    ...(scenario ? { setup: { layout: scenario === 'new_world' ? 'variable' : 'fixed', seed: 42 } } : {}) };
  const host = service.create({ name: 'CANARY_ROOM_NAME', seatCount: count, gameOptions });
  assert.equal(host.success, true, host.error);
  const actors = service.observe(host.code, host.token).slots.map((slot, index) => {
    const actor = service.join(host.code, { name: `CANARY_PLAYER_NAME_${index}`, role: 'human', seatId: slot.id });
    assert.equal(actor.success, true, actor.error);
    assert.equal(issue(service, host, actor, 'ready').success, true);
    return actor;
  });
  const started = issue(service, host, host, 'start'); assert.equal(started.success, true, started.error);
  const room = service.rooms.get(host.code), game = room.game;
  const actor = actors.find(actor => actor.seatId === game.players[game.currentPlayerIndex].id);
  const observe = (target = actor) => {
    // Synthetic fixtures sometimes edit the in-memory game; invalidate cached
    // enumeration through the same revision boundary as real room commands.
    room.revision++;
    return service.observe(host.code, target.token);
  };
  return { service, host, actors, actor, room, game, observe };
}
function mainTurn(fixture) {
  fixture.game.phase = 'playing'; fixture.game.turnPhase = 'main';
  fixture.game.hasRolledThisTurn = true;
  fixture.game.players[fixture.game.currentPlayerIndex].resources = { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 3 };
  return fixture.game.players[fixture.game.currentPlayerIndex];
}
function putProgress(game, player, type) {
  const deck = Object.values(game.citiesKnights.progressDecks).find(cards => cards.some(card => card.type === type));
  const [card] = deck.splice(deck.findIndex(card => card.type === type), 1);
  player.progressCards.push(card); return card;
}
function canonical(value, ids) {
  if (typeof value === 'string') return value.replace(/(?:v|e)_-?\d+_-?\d+_[0-5]|-?\d+,-?\d+/g, key => ids.vertices[key] || ids.edges[key] || ids.tiles[key] || key);
  if (Array.isArray(value)) return value.map(item => canonical(item, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonical(item, ids)]));
  return value;
}
function assertExactActions(view, observation) {
  const { ids } = createAgentBoard(view.gameState);
  const indices = new Set();
  for (const action of observation.actions) {
    assert.ok(Number.isInteger(action.actionIndex) && action.actionIndex >= 0 && action.actionIndex < view.legalActions.length);
    assert.equal(action.id, `a${action.actionIndex}`);
    assert.equal(indices.has(action.actionIndex), false); indices.add(action.actionIndex);
    const original = view.legalActions[action.actionIndex];
    assert.equal(action.type, original.type);
    assert.deepEqual(action.params, canonical(original.payload, ids));
  }
  for (const original of view.legalActions) assert.ok(observation.actions.some(action => action.type === original.type &&
    JSON.stringify(action.params) === JSON.stringify(canonical(original.payload, ids))), `Original ${original.type} remains represented`);
  assert.doesNotMatch(JSON.stringify(observation), /[ve]_-?\d+_-?\d+_[0-5]/, 'No rendering geometry aliases enter the DTO');
}

test('shared action defaults restore exactly every original factual candidate without changing index mapping', () => {
  const fixture = roomFixture(), view = fixture.observe(), observation = createAgentObservation(view);
  const original = describeAgentActions(view, createAgentBoard(view.gameState)).actions;
  const expanded = observation.actions.map(action => ({ ...action, facts: { ...observation.actionDefaults[action.type], ...action.facts } }));
  assert.deepEqual(expanded, original);
  assert.ok(Object.keys(observation.actionDefaults).length > 0, 'Repeated setup costs are factored');
  assert.ok(observation.actions.length > 20, 'No pruning during compaction');
  assertExactActions(view, observation);
});

test('actual authenticated base/5–6/Seafarers/C&K room views retain complete topology and exact executable actions', () => {
  const cases = [{}, { count: 5 }, { count: 6 }, { ck: true }, { ck: true, count: 6 },
    ...SEAFARERS_SCENARIOS.map(scenario => ({ scenario: scenario.id })), { scenario: 'heading_for_new_shores', count: 6, ck: true }];
  for (const configuration of cases) {
    const fixture = roomFixture(configuration), view = fixture.observe(), before = structuredClone(view);
    const observation = createAgentObservation(view), expected = createAgentBoard(view.gameState).board;
    assert.equal(observation.format, 'catan-agent-v1');
    assert.equal(observation.seatId, fixture.actor.seatId);
    assert.deepEqual(observation.board, expected);
    assert.equal(observation.players.length, configuration.count || 3);
    assert.deepEqual(observation.self.hand, combinedHand(view.gameState.players[view.gameState.myIndex]));
    assert.deepEqual(observation.rules.expansions, view.gameOptions.expansions);
    assert.equal(observation.rules.extension56, (configuration.count || 3) >= 5);
    assert.equal(observation.opportunities.horizon, 'immediate');
    assertExactActions(view, observation);
    assert.deepEqual(view, before, 'Projection leaves authorized view unchanged');
  }
});

test('own hands and cards remain exact; opponents and decks remain public counts, including finished views', () => {
  for (const ck of [false, true]) {
    const fixture = roomFixture({ ck }), player = mainTurn(fixture), opponent = fixture.game.players.find(candidate => candidate.id !== player.id);
    if (ck) {
      player.commodities = { paper: 2, coin: 1, cloth: 3 };
      opponent.commodities = { paper: 1, coin: 2, cloth: 0 };
      putProgress(fixture.game, player, 'medicine'); putProgress(fixture.game, opponent, 'crane');
    } else {
      player.developmentCards = ['monopoly']; player.newDevCards = ['knight'];
      opponent.developmentCards = ['victoryPoint', 'roadBuilding']; opponent.newDevCards = ['yearOfPlenty'];
    }
    player.hiddenVictoryPoints = 2; opponent.hiddenVictoryPoints = 1;
    opponent.resources = { brick: 1, lumber: 2, wool: 1, grain: 3, ore: 0 };
    for (const phase of ['playing', 'finished']) {
      fixture.game.phase = phase;
      const view = fixture.observe(), observation = createAgentObservation(view);
      const own = observation.players.find(candidate => candidate.id === player.id), other = observation.players.find(candidate => candidate.id === opponent.id);
      assert.deepEqual(observation.self.hand, combinedHand(player));
      assert.equal(observation.self.hiddenVictoryPoints, 2);
      assert.equal(own.cards, Object.values(combinedHand(player)).reduce((sum, n) => sum + n, 0));
      assert.equal(other.cards, ck ? 10 : 7);
      assert.equal(other.developmentCards, ck ? 0 : 3);
      assert.equal(Object.hasOwn(other, 'resources'), false);
      assert.equal(Object.hasOwn(other, 'commodities'), false);
      assert.equal(Object.hasOwn(other, 'hiddenVictoryPoints'), false);
      assert.equal(observation.bank.developmentCardsRemaining, fixture.game.devCardDeck.length);
      assert.equal(Object.hasOwn(observation.bank, 'brick'), false);
      if (ck) {
        assert.equal(other.progressCards, 1);
        assert.deepEqual(observation.citiesKnights.progressCardsRemaining, Object.fromEntries(Object.entries(fixture.game.citiesKnights.progressDecks).map(([track, deck]) => [track, deck.length])));
        assert.equal(observation.self.progressCards[0].type, 'medicine');
        assert.equal(observation.self.progressCards[0].track, 'science');
        assert.ok(Object.values(observation.citiesKnights.commodityAvailable).every(value => typeof value === 'boolean'));
        assert.equal(JSON.stringify(observation).includes(opponent.progressCards[0].id), false);
      } else {
        assert.deepEqual(observation.self.developmentCards, ['monopoly']);
        assert.deepEqual(observation.self.newDevelopmentCards, ['knight']);
      }
    }
  }
});

test('off-turn discards and typed C&K card selections retain the exact authorized obligation', () => {
  const fixture = roomFixture({ ck: true }), active = mainTurn(fixture);
  const target = fixture.game.players.find(player => player.id !== active.id), actor = fixture.actors.find(actor => actor.seatId === target.id);
  target.resources = { brick: 2, lumber: 1, wool: 0, grain: 3, ore: 1 }; target.commodities = { paper: 2, coin: 1, cloth: 0 };
  fixture.game.turnPhase = 'discard'; fixture.game.discardingPlayers = [{ playerIndex: fixture.game.players.indexOf(target), cardsToDiscard: 5 }];
  let view = fixture.observe(actor), observation = createAgentObservation(view);
  assert.equal(observation.turn.player, active.id);
  assert.equal(observation.decision.type, 'discardCards'); assert.equal(observation.decision.count, 5);
  assert.deepEqual(observation.decision.availableCards, combinedHand(target));
  assert.equal(observation.actions.length, 0);
  fixture.game.discardingPlayers = []; fixture.game.turnPhase = 'main';
  CK.enqueueChoice(fixture.game, { actorId: target.id, kind: 'card:sabotageCards', label: 'Choose cards for Sabotage', selection: 'cards', count: 2,
    allowedCards: Object.keys(combinedHand(target)).filter(card => combinedHand(target)[card] > 0), availableCards: combinedHand(target), options: [] });
  CK.exposeNextChoice(fixture.game);
  view = fixture.observe(actor); observation = createAgentObservation(view);
  assert.equal(observation.decision.type, 'chooseCards'); assert.equal(observation.decision.count, 2);
  assert.equal(observation.decision.choiceId, view.gameState.pendingChoice.id);
  assert.equal(observation.decision.choiceKind, 'card:sabotageCards');
  assert.deepEqual(observation.decision.availableCards, combinedHand(target));
  assert.deepEqual(observation.decision.allowedCards, view.decision.allowedCards);
  assert.equal(observation.pendingChoice.actor, target.id);
  const activeView = fixture.observe(fixture.actor);
  assert.equal(activeView.decision, null);
  assert.equal(createAgentObservation(activeView).decision, null);
});

test('engine-generated geometry choices and progress-card choices retain identities and descriptions', () => {
  const fixture = roomFixture({ ck: true }), player = mainTurn(fixture);
  const key = Object.keys(fixture.game.vertices)[0];
  fixture.game.vertices[key] = { owner: fixture.game.currentPlayerIndex, building: 'settlement' };
  const medicine = putProgress(fixture.game, player, 'medicine');
  assert.equal(executeAction(fixture.game, player.id, 'playProgressCard', { cardId: medicine.id }).success, true);
  let view = fixture.observe(), observation = createAgentObservation(view);
  assert.equal(observation.actions[0].type, 'resolveCitiesKnightsChoice');
  assert.equal(observation.actions[0].facts.choice.kind, 'card:medicine');
  assert.match(observation.actions[0].facts.option.vertexKey, /^V\d+$/);
  assert.equal(observation.actions[0].facts.option.label, 'Upgrade settlement');
  assertExactActions(view, observation);
  fixture.game.pendingChoice = null;
  const card = putProgress(fixture.game, fixture.game.players.find(current => current.id === player.id), 'crane');
  CK.enqueueChoice(fixture.game, { actorId: player.id, kind: 'discardProgress', label: 'Discard a progress card', options: [{ id: card.id, cardId: card.id, cardType: card.type, color: card.color, label: 'science: crane' }] });
  CK.exposeNextChoice(fixture.game);
  view = fixture.observe(); observation = createAgentObservation(view);
  assert.equal(observation.actions[0].params.optionId, card.id);
  assert.equal(observation.actions[0].facts.option.cardType, 'crane');
  assert.equal(observation.actions[0].facts.option.color, 'science');
  assertExactActions(view, observation);
});

test('Commercial Harbor receiver retains authorized offer source and received-resource identity', () => {
  const fixture = roomFixture({ ck: true }), player = mainTurn(fixture), target = fixture.game.players.find(candidate => candidate.id !== player.id);
  target.commodities.paper = 1;
  const card = putProgress(fixture.game, player, 'commercialHarbor');
  assert.equal(executeAction(fixture.game, player.id, 'playProgressCard', { cardId: card.id }).success, true);
  assert.equal(executeAction(fixture.game, player.id, 'offerCommercialHarbor', { targetPlayerId: target.id, resource: 'grain' }).success, true);
  const actor = fixture.actors.find(actor => actor.seatId === target.id), view = fixture.observe(actor), observation = createAgentObservation(view);
  assert.equal(view.gameState.pendingChoice.sourcePlayerId, player.id);
  assert.equal(view.gameState.pendingChoice.offeredResource, 'grain');
  assert.equal(observation.pendingChoice.sourcePlayerId, player.id);
  assert.equal(observation.pendingChoice.offeredResource, 'grain');
  assert.equal(observation.actions[0].facts.option.cardType, 'paper');
  const sourceView = fixture.observe(fixture.actor), sourceObservation = createAgentObservation(sourceView);
  assert.equal(Object.hasOwn(sourceView.gameState.pendingChoice, 'offeredResource'), false);
  assert.equal(Object.hasOwn(sourceObservation.pendingChoice, 'offeredResource'), false);
});

test('public expansion spawn locations, barbarian outcomes and pirate safe stops survive without renderer extras', () => {
  const combined = roomFixture({ scenario: 'heading_for_new_shores', ck: true });
  combined.game.citiesKnights.eventDie = 'barbarian';
  combined.game.citiesKnights.lastBarbarianAttack = { turnSerial: 4, defense: 5, cities: 3, repelled: true,
    defenderIds: [combined.actor.seatId], pillagedPlayerIds: [], renderer: 'CANARY_BARBARIAN_RENDERER' };
  let view = combined.observe(), observation = createAgentObservation(view), graph = createAgentBoard(view.gameState);
  assert.equal(observation.citiesKnights.eventDie, 'barbarian');
  assert.equal(observation.citiesKnights.robberStart, graph.ids.tiles[view.gameState.citiesKnights.robberStart]);
  const pirateStart = view.gameState.citiesKnights.pirateStart;
  assert.deepEqual(observation.citiesKnights.pirateStart, graph.ids.tiles[pirateStart] || { frame: pirateStart.slice(6) });
  assert.deepEqual(observation.citiesKnights.lastBarbarianAttack, { turnSerial: 4, defense: 5, cities: 3, repelled: true,
    defenderIds: [combined.actor.seatId], pillagedPlayerIds: [] });
  const pirates = roomFixture({ scenario: 'the_pirate_islands' });
  // The engine supports a public noAttack stop flag; exercise it explicitly
  // because the selected three-player catalog route has no flagged stop.
  pirates.game.seafarers.fleetRoute[0].noAttack = true;
  pirates.game.seafarers.lastFortressAttack = { playerId: pirates.actor.seatId, die: 3, lostShips: 1, fortressLairs: 2, renderer: 'CANARY_FORTRESS_RENDERER' };
  view = pirates.observe(); observation = createAgentObservation(view); graph = createAgentBoard(view.gameState);
  assert.deepEqual(observation.seafarers.fleetRoute, view.gameState.seafarers.fleetRoute.map(stop => ({ tile: graph.ids.tiles[G.hexKey(stop.q, stop.r)] || null, ...(stop.noAttack ? { noAttack: true } : {}) })));
  assert.ok(observation.seafarers.fleetRoute.some(stop => stop.noAttack), 'Safe fleet stops have public significance');
  assert.deepEqual(observation.seafarers.lastFortressAttack, { playerId: pirates.actor.seatId, die: 3, lostShips: 1, fortressLairs: 2 });
  assert.equal(JSON.stringify(observation).includes('CANARY_'), false);
});

test('player-named Seafarers/C&K options and arbitrary option/card extensions stay outside the factual boundary', () => {
  const pirates = roomFixture({ scenario: 'the_pirate_islands' });
  mainTurn(pirates);
  for (const player of pirates.game.players) player.resources.grain = 1;
  SF.queuePirateSeven(pirates.game);
  const pirateView = pirates.observe(), pirateObservation = createAgentObservation(pirateView);
  assert.ok(pirateView.gameState.pendingChoice.options.some(option => option.label.includes('CANARY_PLAYER_NAME_')));
  assert.equal(JSON.stringify(pirateObservation).includes('CANARY_'), false, 'Player display labels are not game rule identities');
  assertExactActions(pirateView, pirateObservation);
  const fixture = roomFixture({ ck: true }), player = mainTurn(fixture), target = fixture.game.players.find(candidate => candidate.id !== player.id);
  target.resources.brick = 1; target.victoryPoints = player.victoryPoints + 1;
  const card = putProgress(fixture.game, player, 'guildDues');
  assert.equal(executeAction(fixture.game, player.id, 'playProgressCard', { cardId: card.id }).success, true);
  const view = fixture.observe();
  assert.ok(view.gameState.pendingChoice.options.some(option => option.label.includes('CANARY_PLAYER_NAME_')));
  for (const option of view.gameState.pendingChoice.options) Object.assign(option, { icon: 'CANARY_OPTION_ICON', control: 'CANARY_OPTION_CONTROL', renderer: { color: 'CANARY_OPTION_RENDERER' } });
  let observation = createAgentObservation(view);
  assert.equal(JSON.stringify(observation).includes('CANARY_'), false);
  assert.equal(observation.actions[0].facts.option.targetPlayerId, target.id);
  assertExactActions(view, observation);
  delete fixture.game.pendingChoice;
  const medicine = putProgress(fixture.game, fixture.game.players.find(current => current.id === player.id), 'medicine');
  const cardView = fixture.observe();
  Object.assign(cardView.gameState.players[cardView.gameState.myIndex].progressCards.find(card => card.id === medicine.id), { icon: 'CANARY_CARD_ICON', control: 'CANARY_CARD_CONTROL', renderer: 'CANARY_CARD_RENDERER' });
  observation = createAgentObservation(cardView);
  const selected = observation.actions.find(action => action.type === 'playProgressCard' && action.params.cardId === medicine.id);
  assert.equal(selected.facts.card.type, 'medicine');
  assert.equal(JSON.stringify(observation).includes('CANARY_'), false);
});

test('display names, renderer fields, raw chat/history and control canaries are excluded from complete observations', () => {
  const fixture = roomFixture({ scenario: 'the_fog_islands', ck: true }), view = fixture.observe();
  Object.assign(view, { revision: 9831, generation: 9284, controlEpoch: 9343, token: 'CANARY_CONTROLLER_TOKEN', replayId: 'CANARY_REPLAY_ID', ai: { model: 'CANARY_MODEL', runtime: 'CANARY_RUNTIME' },
    chat: [{ author: 'CANARY_CHAT_NAME', message: 'CANARY_CHAT_TEXT' }], events: [{ id: 'public-event', type: 'rollDice', actorSeatId: view.seatId, label: 'CANARY_EVENT_LABEL', details: { dice: { die1: 2, die2: 3, total: 5, renderer: 'CANARY_EVENT_RENDERER' }, transcript: 'CANARY_TRANSCRIPT' } }] });
  view.decision.prompt = 'CANARY_DECISION_PROMPT';
  for (const player of view.gameState.players) Object.assign(player, { color: 'CANARY_PLAYER_COLOR', icon: 'CANARY_PLAYER_ICON' });
  for (const tile of Object.values(view.gameState.hexes)) Object.assign(tile, { icon: 'CANARY_TILE_ICON', pixels: [999, 999], cssClass: 'CANARY_TILE_CSS' });
  for (const vertex of Object.values(view.gameState.vertices)) Object.assign(vertex, { screenX: 999, color: 'CANARY_VERTEX_COLOR' });
  view.gameState.rendering = 'CANARY_GAME_RENDERING'; view.gameState.controller = 'CANARY_GAME_CONTROLLER';
  const observation = createAgentObservation(view), output = JSON.stringify(observation);
  assert.equal(output.includes('CANARY_'), false);
  for (const field of ['revision', 'generation', 'controlEpoch', 'token', 'replayId', 'chat', 'ai', 'gameState', 'pixels', 'screenX', 'cssClass', 'rendering', 'controller']) assert.equal(Object.hasOwn(observation, field), false, field);
  assert.deepEqual(observation.recentEvents[0], { id: 'public-event', type: 'rollDice', actorSeatId: view.seatId, dice: { die1: 2, die2: 3, total: 5 } });
  const envelope = agentEnvelope(view);
  assert.equal(envelope.control.revision, 9831); assert.equal(envelope.control.generation, 9284); assert.equal(envelope.control.controlEpoch, 9343);
  assert.match(envelope.control.decisionId, /^d_[a-f0-9]{24}$/);
  assert.deepEqual(envelope.observation, observation);
});

test('hidden-state-equivalent authenticated views produce identical DTOs despite concealed cards and deck order', () => {
  const fixture = roomFixture({ scenario: 'the_fog_islands', ck: true }), own = fixture.game.players[fixture.game.currentPlayerIndex], opponent = fixture.game.players.find(player => player.id !== own.id);
  opponent.resources = { brick: 2, lumber: 1, wool: 0, grain: 2, ore: 0 };
  opponent.commodities = { paper: 1, coin: 0, cloth: 1 };
  putProgress(fixture.game, opponent, 'crane');
  const first = fixture.observe(), firstObservation = createAgentObservation(first);
  opponent.resources = { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 4 };
  opponent.commodities = { paper: 0, coin: 2, cloth: 0 };
  opponent.hiddenVictoryPoints = 9;
  opponent.progressCards[0].type = 'merchantFleet';
  for (const deck of Object.values(fixture.game.citiesKnights.progressDecks)) deck.reverse();
  fixture.game.devCardDeck.reverse();
  fixture.game.seafarers.fogTerrainPile.reverse(); fixture.game.seafarers.fogNumberPile.reverse();
  const hidden = Object.values(fixture.game.hexes).find(hex => hex.hidden);
  assert.ok(hidden);
  hidden.privateUnexploredContent = { terrain: 'mountains', resource: 'ore', number: 12 };
  const second = fixture.observe(), secondObservation = createAgentObservation(second);
  assert.equal(typeof second.gameState.players.find(player => player.id === opponent.id).resources, 'number');
  assert.equal(first.gameState.players.find(player => player.id === opponent.id).resources, second.gameState.players.find(player => player.id === opponent.id).resources);
  assert.deepEqual(secondObservation, firstObservation);
  // A DTO must also ignore inaccessible contents attached to a hidden tile in
  // the filtered input. Keep original legal candidates identical deliberately.
  const changed = structuredClone(first);
  const fog = Object.values(changed.gameState.hexes).find(hex => hex.hidden);
  Object.assign(fog, { terrain: 'mountains', resource: 'ore', number: 12, region: 'CANARY_HIDDEN_REGION' });
  assert.deepEqual(createAgentObservation(changed), firstObservation);
});

test('fog contents cannot change geometric opportunity facts on a visible ship tip', () => {
  const fixture = roomFixture({ scenario: 'the_fog_islands' }), player = mainTurn(fixture);
  const graph = createAgentBoard(playerView(fixture.game, player.id));
  const location = graph.board.vertices.find(vertex => {
    const tiles = vertex.tiles.map(id => graph.board.tiles.find(tile => tile.id === id));
    return tiles.some(tile => tile.unknown) && tiles.every(tile => tile.unknown || tile.terrain === 'sea');
  });
  assert.ok(location, 'An unrevealed coastal tip exists in this public map');
  const edge = graph.board.edges.find(edge => edge.ends.includes(location.id));
  const edgeKey = Object.keys(fixture.game.edges).find(key => graph.ids.edges[key] === edge.id);
  fixture.game.edges[edgeKey] = { ship: true, owner: fixture.game.currentPlayerIndex };
  const view = fixture.observe(), observation = createAgentObservation(view), changed = structuredClone(view);
  for (const tile of Object.values(changed.gameState.hexes)) if (tile.hidden) Object.assign(tile, { terrain: 'mountains', resource: 'ore', number: 12 });
  const changedObservation = createAgentObservation(changed);
  assert.deepEqual(changedObservation.opportunities.items.map(site => site.vertex), observation.opportunities.items.map(site => site.vertex), 'Hidden terrain cannot open immediate settlement targets');
  assert.deepEqual(changedObservation.actions.map(action => action.facts.opens?.map(site => site.vertex)), observation.actions.map(action => action.facts.opens?.map(site => site.vertex)), 'Hidden terrain cannot open route settlement targets');
  assert.equal(JSON.stringify(changedObservation) === JSON.stringify(observation), true, 'Engine geometry checks cannot interpret hidden terrain as revealed land');
});

test('lobby observation retains seat identity/readiness without human names or private controls', () => {
  const service = new RoomService(), host = service.create({ name: 'CANARY_LOBBY_NAME', seatCount: 3 });
  const view = service.observe(host.code, host.token), observation = createAgentObservation(view);
  assert.equal(observation.phase, 'waiting'); assert.equal(observation.self, undefined);
  assert.equal(observation.players.length, 3); assert.deepEqual(observation.actions, []);
  assert.equal(observation.decision, null);
  assert.equal(JSON.stringify(observation).includes('CANARY_'), false);
});
