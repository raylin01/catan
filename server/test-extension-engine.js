import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import { executeAction, legalActions, playerView } from './actions.js';

const resourceTypes = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function gameWithPlayers(count = 5) {
  const game = G.createGame('extension-test', { id: 'p0', name: 'Player 0' }, true, false);
  for (let index = 1; index < count; index++) {
    assert.equal(G.addPlayer(game, { id: `p${index}`, name: `Player ${index}` }).success, true);
  }
  return game;
}

function actor(game) {
  return game.players[game.currentPlayerIndex].id;
}

function act(game, type, payload = {}) {
  const result = executeAction(game, actor(game), type, payload);
  assert.equal(result.success, true, `${type}: ${result.error || ''}`);
  return result;
}

function firstAction(game, type) {
  let action;
  if (game.phase === 'setup' && type === 'placeSettlement') {
    const vertexKey = Object.keys(game.vertices).find(key => G.canPlaceSettlement(game, actor(game), key, true).valid);
    if (vertexKey) action = { type, payload: { vertexKey } };
  } else if (game.phase === 'setup' && type === 'placeRoad') {
    const edgeKey = Object.keys(game.edges).find(key => G.canPlaceRoad(game, actor(game), key, true, game.setupAction?.settlement).valid);
    if (edgeKey) action = { type, payload: { edgeKey } };
  } else action = legalActions(game, actor(game)).find(candidate => candidate.type === type);
  assert.ok(action, `${type} available to ${actor(game)}`);
  return action;
}

function totalResource(game, resource) {
  return game.bank[resource] + game.players.reduce((sum, player) => sum + player.resources[resource], 0);
}

function grantFromBank(game, playerIndex, bundle) {
  for (const [resource, amount] of Object.entries(bundle)) {
    assert.ok(game.bank[resource] >= amount);
    game.bank[resource] -= amount;
    game.players[playerIndex].resources[resource] += amount;
  }
}

function completeSetup(game) {
  assert.equal(G.startGame(game).success, true);
  const sequence = [];
  for (let step = 0; step < game.players.length * 2; step++) {
    sequence.push(game.currentPlayerIndex);
    const settlement = firstAction(game, 'placeSettlement');
    act(game, settlement.type, settlement.payload);
    const road = firstAction(game, 'placeRoad');
    act(game, road.type, road.payload);
    act(game, 'advanceSetup');
  }
  assert.deepEqual(sequence, [
    ...game.players.map((_, index) => index),
    ...game.players.map((_, index) => index).reverse()
  ]);
  assert.equal(game.phase, 'playing');
  assert.equal(game.turnPhase, 'roll');
  assert.equal(game.currentPlayerIndex, 0);
  assert.equal(game.productionPlayerIndex, 0);
  assert.equal(game.turnRole, 'primary');
  for (const player of game.players) {
    assert.equal(player.settlements, 3);
    assert.equal(player.roads, 13);
  }
  for (const resource of resourceTypes) assert.equal(totalResource(game, resource), 24);
}

function withDice(value, callback) {
  const original = Math.random;
  Math.random = () => value;
  try { return callback(); } finally { Math.random = original; }
}

function rollNonSeven(game) {
  const result = withDice(0, () => act(game, 'rollDice'));
  assert.equal(result.roll.total, 2);
  assert.equal(game.turnPhase, 'main');
}

function runPair(game, primaryIndex) {
  assert.equal(game.productionPlayerIndex, primaryIndex);
  assert.equal(game.currentPlayerIndex, primaryIndex);
  assert.equal(game.turnRole, 'primary');
  assert.equal(playerView(game, actor(game)).playerTradingAllowed, false);
  rollNonSeven(game);
  assert.equal(game.playerTradingAllowed, true);
  assert.equal(playerView(game, actor(game)).playerTradingAllowed, true);
  act(game, 'endTurn');
  assert.equal(game.currentPlayerIndex, (primaryIndex + 3) % game.players.length);
  assert.equal(game.productionPlayerIndex, primaryIndex);
  assert.equal(game.turnRole, 'paired');
  assert.equal(game.turnPhase, 'main');
  assert.equal(game.playerTradingAllowed, false);
  assert.equal(playerView(game, actor(game)).playerTradingAllowed, false);
  const before = structuredClone(game);
  assert.equal(executeAction(game, actor(game), 'rollDice').success, false);
  assert.equal(executeAction(game, actor(game), 'proposeTrade', { offer: { brick: 1 }, request: { ore: 1 } }).success, false);
  assert.deepEqual(game, before);
  act(game, 'endTurn');
  assert.equal(game.productionPlayerIndex, (primaryIndex + 1) % game.players.length);
  assert.equal(game.currentPlayerIndex, game.productionPlayerIndex);
  assert.equal(game.turnRole, 'primary');
  assert.equal(game.turnPhase, 'roll');
}

test('official extension board, ports, supply, and development deck', () => {
  const game = gameWithPlayers(6);
  const rows = Object.values(game.hexes).reduce((map, hex) => {
    map.set(hex.r, (map.get(hex.r) || 0) + 1);
    return map;
  }, new Map());
  assert.deepEqual([...rows.entries()].sort(([a], [b]) => a - b).map(([, count]) => count), [3, 4, 5, 6, 5, 4, 3]);
  assert.equal(Object.keys(game.hexes).length, 30);
  assert.deepEqual(Object.values(game.hexes).reduce((counts, hex) => {
    counts[hex.terrain] = (counts[hex.terrain] || 0) + 1;
    return counts;
  }, {}), { hills: 5, forest: 6, pasture: 6, fields: 6, mountains: 5, desert: 2 });
  const numbers = Object.values(game.hexes).map(hex => hex.number).filter(number => number !== null).sort((a, b) => a - b);
  assert.deepEqual(numbers, [2,2,3,3,3,4,4,4,5,5,5,6,6,6,8,8,8,9,9,9,10,10,10,11,11,11,12,12]);
  assert.deepEqual(game.bank, { brick: 24, lumber: 24, wool: 24, grain: 24, ore: 24 });
  assert.deepEqual(game.devCardDeck.reduce((counts, card) => {
    counts[card] = (counts[card] || 0) + 1;
    return counts;
  }, {}), { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 });
  assert.equal(game.ports.length, 11);
  assert.equal(game.ports.filter(port => port.type === 'GENERIC').length, 5);
  assert.deepEqual(game.ports.filter(port => port.type !== 'GENERIC').map(port => port.type).sort(), ['BRICK','GRAIN','LUMBER','ORE','WOOL','WOOL']);
  // Every port must occupy one physical boundary edge, never an interior edge.
  const portEdges = new Set();
  for (const port of game.ports) {
    const matches = [];
    for (const hex of Object.values(game.hexes)) for (let direction = 0; direction < 6; direction++) {
      const ends = [G.vertexKey(hex.q, hex.r, direction), G.vertexKey(hex.q, hex.r, (direction + 1) % 6)];
      if ((G.areVerticesEqual(ends[0], port.vertices[0]) && G.areVerticesEqual(ends[1], port.vertices[1])) ||
          (G.areVerticesEqual(ends[0], port.vertices[1]) && G.areVerticesEqual(ends[1], port.vertices[0]))) {
        matches.push(G.edgeKey(hex.q, hex.r, direction));
      }
    }
    assert.equal(matches.length, 1, `port ${port.id} lies on one boundary edge`);
    assert.equal(portEdges.has(matches[0]), false, `port ${port.id} is unique`);
    portEdges.add(matches[0]);
    const portGame = structuredClone(game);
    portGame.vertices[port.vertices[0]] = { building: 'settlement', owner: 0 };
    const resource = port.resource || 'brick';
    assert.equal(G.getTradeRatio(portGame, 0, resource), port.ratio, `port ${port.id} grants its ratio`);
  }
});

for (const count of [5, 6]) {
  test(`${count}-player snake setup and two complete paired cycles`, () => {
    const game = gameWithPlayers(count);
    completeSetup(game);
    runPair(game, 0);
    runPair(game, 1);
    for (const resource of resourceTypes) assert.equal(totalResource(game, resource), 24);
  });
}

test('paired card purchase matures at role end and is playable on a later primary turn', () => {
  const game = gameWithPlayers(5);
  completeSetup(game);
  rollNonSeven(game);
  act(game, 'endTurn');
  assert.equal(game.currentPlayerIndex, 3);
  grantFromBank(game, 3, { ore: 1, grain: 1, wool: 1 });
  game.devCardDeck.push(G.DEV_CARDS.MONOPOLY);
  act(game, 'buyDevCard');
  assert.deepEqual(game.players[3].newDevCards, [G.DEV_CARDS.MONOPOLY]);
  assert.equal(executeAction(game, actor(game), 'playDevCard', { cardType: 'monopoly', params: { resource: 'brick' } }).success, false);
  act(game, 'endTurn');
  assert.deepEqual(game.players[3].developmentCards, [G.DEV_CARDS.MONOPOLY]);
  assert.deepEqual(game.players[3].newDevCards, []);
  for (const index of [1, 2]) runPair(game, index);
  assert.equal(game.currentPlayerIndex, 3);
  assert.equal(game.turnRole, 'primary');
  assert.equal(executeAction(game, actor(game), 'playDevCard', { cardType: 'monopoly', params: { resource: 'brick' } }).success, true);
  assert.equal(game.devCardPlayedThisTurn, true);
  assert.equal(executeAction(game, actor(game), 'playDevCard', { cardType: 'monopoly', params: { resource: 'brick' } }).success, false);
  rollNonSeven(game);
  act(game, 'endTurn');
  assert.equal(game.turnRole, 'paired');
  assert.equal(game.devCardPlayedThisTurn, false);
});

test('paired knight returns to Action phase and mandatory free roads block ending', () => {
  const game = gameWithPlayers(5);
  completeSetup(game);
  rollNonSeven(game);
  act(game, 'endTurn');
  const player = game.players[game.currentPlayerIndex];
  player.developmentCards.push(G.DEV_CARDS.KNIGHT);
  act(game, 'playDevCard', { cardType: 'knight' });
  assert.equal(game.turnPhase, 'robber');
  const emptyHex = Object.keys(game.hexes).find(key => key !== game.robber && G.getPlayersOnHex(game, key, game.currentPlayerIndex).length === 0);
  assert.ok(emptyHex);
  act(game, 'moveRobber', { hexKey: emptyHex });
  assert.equal(game.turnPhase, 'main');
  assert.equal(game.turnRole, 'paired');
  assert.equal(game.playerTradingAllowed, false);
  act(game, 'endTurn');

  // A fresh paired role may play one Road Building card. It must resolve the
  // free roads before it can pass play to the next rolling player.
  rollNonSeven(game);
  act(game, 'endTurn');
  const roadPlayer = game.players[game.currentPlayerIndex];
  roadPlayer.developmentCards.push(G.DEV_CARDS.ROAD_BUILDING);
  act(game, 'playDevCard', { cardType: 'roadBuilding' });
  assert.ok(game.freeRoads > 0);
  assert.equal(executeAction(game, actor(game), 'endTurn').success, false);
  while (game.freeRoads > 0) {
    const road = legalActions(game, actor(game)).find(action => action.type === 'placeRoad');
    if (road) act(game, 'placeRoad', road.payload);
    else act(game, 'finishFreeRoads');
  }
  assert.equal(game.turnPhase, 'main');
  act(game, 'endTurn');
  assert.equal(game.turnRole, 'primary');
});

test('paired bank trade and Year of Plenty obey supply and mandatory resolution', () => {
  const game = gameWithPlayers(5);
  completeSetup(game);
  rollNonSeven(game);
  act(game, 'endTurn');
  const pairedIndex = game.currentPlayerIndex;
  grantFromBank(game, pairedIndex, { brick: 4 });
  const ratio = G.getTradeRatio(game, pairedIndex, 'brick');
  assert.ok(ratio <= 4);
  act(game, 'bankTrade', { giveResource: 'brick', giveAmount: ratio, getResource: 'ore' });
  for (const resource of resourceTypes) assert.equal(totalResource(game, resource), 24);
  game.players[pairedIndex].developmentCards.push(G.DEV_CARDS.YEAR_OF_PLENTY);
  act(game, 'playDevCard', { cardType: 'yearOfPlenty' });
  assert.equal(game.yearOfPlentyPicks, 2);
  assert.equal(game.playerTradingAllowed, false);
  assert.equal(executeAction(game, actor(game), 'endTurn').success, false);
  assert.equal(executeAction(game, actor(game), 'bankTrade', { giveResource: 'brick', giveAmount: ratio, getResource: 'wool' }).success, false);
  act(game, 'yearOfPlentyPick', { resource: 'wool' });
  act(game, 'yearOfPlentyPick', { resource: 'grain' });
  assert.equal(game.yearOfPlentyPicks, 0);
  for (const resource of resourceTypes) assert.equal(totalResource(game, resource), 24);
  act(game, 'endTurn');
  assert.equal(game.turnRole, 'primary');
});

test('a seven resolves discards and robber before the paired Action phase', () => {
  const game = gameWithPlayers(5);
  completeSetup(game);
  for (const playerIndex of [0, 1]) {
    const held = resourceTypes.reduce((sum, resource) => sum + game.players[playerIndex].resources[resource], 0);
    grantFromBank(game, playerIndex, { brick: 9 - held });
  }
  const original = Math.random;
  const dice = [0.34, 0.5];
  let result;
  Math.random = () => dice.shift() ?? 0;
  try { result = act(game, 'rollDice'); } finally { Math.random = original; }
  assert.equal(result.roll.total, 7);
  assert.equal(game.turnPhase, 'discard');
  assert.ok(game.discardingPlayers.length >= 2);
  for (const pending of [...game.discardingPlayers]) {
    let remaining = pending.cardsToDiscard;
    const bundle = {};
    const player = game.players[pending.playerIndex];
    for (const resource of resourceTypes) {
      const amount = Math.min(remaining, player.resources[resource]);
      if (amount) bundle[resource] = amount;
      remaining -= amount;
    }
    assert.equal(remaining, 0);
    assert.equal(executeAction(game, player.id, 'discardCards', { resources: bundle }).success, true);
  }
  assert.equal(game.turnPhase, 'robber');
  const emptyHex = Object.keys(game.hexes).find(key => key !== game.robber && G.getPlayersOnHex(game, key, game.currentPlayerIndex).length === 0);
  assert.ok(emptyHex);
  act(game, 'moveRobber', { hexKey: emptyHex });
  assert.equal(game.turnPhase, 'main');
  assert.equal(game.playerTradingAllowed, true);
  act(game, 'endTurn');
  assert.equal(game.turnRole, 'paired');
  assert.equal(game.turnPhase, 'main');
  assert.equal(game.playerTradingAllowed, false);
  for (const resource of resourceTypes) assert.equal(totalResource(game, resource), 24);
});

test('a paired player wins at Action-phase entry with hidden points', () => {
  const game = gameWithPlayers(5);
  completeSetup(game);
  const paired = game.players[3];
  paired.victoryPoints = 9;
  paired.hiddenVictoryPoints = 1;
  rollNonSeven(game);
  act(game, 'endTurn');
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, paired.id);
  assert.equal(game.currentPlayerIndex, 3);
  assert.equal(game.playerTradingAllowed, false);
});


test('official A–Zc spiral skips every possible desert pair without adjacent red numbers', () => {
  const template = gameWithPlayers();
  const keys = Object.keys(template.hexes);
  const expected = {2:2,3:3,4:3,5:3,6:3,8:3,9:3,10:3,11:3,12:2};
  for (let first=0;first<keys.length;first++) for (let second=first+1;second<keys.length;second++) {
    const hexes = structuredClone(template.hexes);
    for (const [index,key] of keys.entries()) hexes[key].terrain = index===first || index===second ? 'desert' : 'fields';
    G.assignExtendedNumbers(hexes);
    const counts = {};
    for (const hex of Object.values(hexes)) {
      if (hex.terrain === 'desert') { assert.equal(hex.number,null); continue; }
      counts[hex.number] = (counts[hex.number] || 0) + 1;
      if ([6,8].includes(hex.number)) for (const [dq,dr] of [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]]) {
        assert.ok(![6,8].includes(hexes[`${hex.q+dq},${hex.r+dr}`]?.number), 'Red number discs must not be adjacent');
      }
    }
    assert.deepEqual(counts,expected);
  }
  const game = gameWithPlayers();
  for (const hex of Object.values(game.hexes)) if ([6,8].includes(hex.number)) {
    for (const [dq,dr] of [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]]) assert.ok(![6,8].includes(game.hexes[`${hex.q+dq},${hex.r+dr}`]?.number));
  }
});
