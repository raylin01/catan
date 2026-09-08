import assert from 'node:assert/strict';
import * as GameLogic from './gameLogic.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createPlayingGame(playerCount = 2) {
  const game = GameLogic.createGame('contract', { id: 'p1', name: 'One' }, false, false);
  for (let index = 2; index <= playerCount; index++) {
    GameLogic.addPlayer(game, { id: `p${index}`, name: `Player ${index}` });
  }
  game.phase = 'playing';
  game.turnPhase = 'main';
  game.currentPlayerIndex = 0;
  return game;
}

function snapshot(game) {
  return JSON.stringify(game);
}

function withRandom(value, fn) {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

test('standard games start with a finite 19-card bank', () => {
  const game = createPlayingGame();
  assert.deepEqual(game.bank, { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
});

test('malformed and negative player trades are rejected without mutation', () => {
  const game = createPlayingGame();
  game.players[0].resources.brick = 2;

  for (const [offer, request] of [
    [{ brick: -1 }, { wool: 1 }],
    [{ brick: 1.5 }, { wool: 1 }],
    [{ gold: 1 }, { wool: 1 }],
    [null, { wool: 1 }],
    [{ brick: 0 }, { wool: 1 }]
  ]) {
    const before = snapshot(game);
    assert.equal(GameLogic.proposeTrade(game, 'p1', offer, request).success, false);
    assert.equal(snapshot(game), before);
  }
});

test('trade offers are copied and stale offers settle atomically', () => {
  const game = createPlayingGame();
  game.players[0].resources.brick = 2;
  game.players[1].resources.wool = 1;
  const offer = { brick: 2, lumber: 0 };
  const request = { wool: 1, ore: 0 };

  assert.equal(GameLogic.proposeTrade(game, 'p1', offer, request).success, true);
  offer.brick = 99;
  request.wool = 99;
  assert.equal(game.tradeOffer.offer.brick, 2);
  assert.equal(game.tradeOffer.request.wool, 1);

  game.players[0].resources.brick = 1;
  const before = snapshot(game);
  const result = GameLogic.respondToTrade(game, 'p2', true);
  assert.equal(result.success, false);
  assert.equal(snapshot(game), before);
});

test('invalid development-card actions leave state unchanged', () => {
  const game = createPlayingGame();
  game.players[0].developmentCards = [GameLogic.DEV_CARDS.MONOPOLY, GameLogic.DEV_CARDS.VICTORY_POINT];

  let before = snapshot(game);
  assert.equal(GameLogic.playDevCard(game, 'p1', GameLogic.DEV_CARDS.MONOPOLY, {}).success, false);
  assert.equal(snapshot(game), before);

  before = snapshot(game);
  assert.equal(GameLogic.playDevCard(game, 'p1', GameLogic.DEV_CARDS.VICTORY_POINT).success, false);
  assert.equal(snapshot(game), before);

  game.turnPhase = 'discard';
  before = snapshot(game);
  assert.equal(GameLogic.playDevCard(game, 'p1', GameLogic.DEV_CARDS.MONOPOLY, { resource: 'brick' }).success, false);
  assert.equal(snapshot(game), before);
});

test('development-card purchases and discards return cards to the bank', () => {
  const game = createPlayingGame();
  Object.assign(game.players[0].resources, { ore: 2, grain: 2, wool: 2, brick: 2 });
  const bankBeforeBuy = { ...game.bank };
  assert.equal(GameLogic.buyDevCard(game, 'p1').success, true);
  assert.equal(game.bank.ore, bankBeforeBuy.ore + 1);
  assert.equal(game.bank.grain, bankBeforeBuy.grain + 1);
  assert.equal(game.bank.wool, bankBeforeBuy.wool + 1);

  game.turnPhase = 'discard';
  game.discardingPlayers = [{ playerIndex: 0, cardsToDiscard: 2 }];
  const brickBeforeDiscard = game.bank.brick;
  assert.equal(GameLogic.discardCards(game, 'p1', { brick: 2, ore: 0 }).success, true);
  assert.equal(game.bank.brick, brickBeforeDiscard + 2);
});

test('building costs return to the bank', () => {
  const game = createPlayingGame();
  game.vertices.v_0_0_0 = { building: 'settlement', owner: 0 };
  Object.assign(game.players[0].resources, { ore: 3, grain: 2 });
  const before = { ...game.bank };

  assert.equal(GameLogic.upgradeToCity(game, 'p1', 'v_0_0_0').success, true);
  assert.equal(game.bank.ore, before.ore + 3);
  assert.equal(game.bank.grain, before.grain + 2);
});

test('bank trades exchange cards and reject an empty destination atomically', () => {
  const game = createPlayingGame();
  game.players[0].resources.brick = 8;
  const before = { ...game.bank };
  assert.equal(GameLogic.bankTrade(game, 'p1', 'brick', 4, 'ore').success, true);
  assert.equal(game.bank.brick, before.brick + 4);
  assert.equal(game.bank.ore, before.ore - 1);

  game.bank.ore = 0;
  const stateBeforeRejectedTrade = snapshot(game);
  assert.equal(GameLogic.bankTrade(game, 'p1', 'brick', 4, 'ore').success, false);
  assert.equal(snapshot(game), stateBeforeRejectedTrade);
});

test('Year of Plenty uses finite stock and does not consume failed picks', () => {
  const game = createPlayingGame();
  game.yearOfPlentyPicks = 1;
  game.bank.ore = 0;
  const before = snapshot(game);
  assert.equal(GameLogic.yearOfPlentyPick(game, 'p1', 'ore').success, false);
  assert.equal(snapshot(game), before);

  assert.equal(GameLogic.yearOfPlentyPick(game, 'p1', 'brick').success, true);
  assert.equal(game.bank.brick, 18);
  assert.equal(game.players[0].resources.brick, 1);
  assert.equal(game.yearOfPlentyPicks, 0);
});

test('a sole production recipient gets the remaining supply', () => {
  const game = createPlayingGame();
  Object.values(game.hexes).forEach(hex => { hex.number = null; });
  const availableKeys = Object.keys(game.hexes).filter(key => key !== game.robber);
  const brickHex = game.hexes[availableKeys[0]];
  const lumberHex = game.hexes[availableKeys.at(-1)];
  brickHex.number = 6;
  brickHex.resource = 'brick';
  lumberHex.number = 6;
  lumberHex.resource = 'lumber';
  game.vertices[GameLogic.vertexKey(brickHex.q, brickHex.r, 0)] = { building: 'city', owner: 0 };
  game.vertices[GameLogic.vertexKey(lumberHex.q, lumberHex.r, 3)] = { building: 'settlement', owner: 1 };
  game.bank.brick = 1;
  game.turnPhase = 'roll';

  const result = withRandom(0.4, () => GameLogic.rollDice(game, 'p1'));
  assert.equal(result.roll.total, 6);
  assert.equal(result.resourceGains[0].brick, 1);
  assert.equal(result.resourceGains[1].lumber, 1);
  assert.equal(game.players[0].resources.brick, 1);
  assert.equal(game.players[1].resources.lumber, 1);
  assert.equal(game.bank.brick, 0);
  assert.equal(game.bank.lumber, 18);
});

test('placing an opponent settlement recomputes a split longest road', () => {
  const game = createPlayingGame();
  for (const edge of ['e_0_0_0', 'e_0_0_1', 'e_0_0_2', 'e_0_0_3', 'e_0_1_5', 'e_0_1_0']) {
    game.edges[edge] = { road: true, owner: 0 };
  }
  GameLogic.updateLongestRoad(game);
  const before = game.players[0].roadLength;

  game.phase = 'setup';
  game.currentPlayerIndex = 1;
  assert.equal(GameLogic.placeSettlement(game, 'p2', 'v_0_0_2').success, true);
  assert.ok(game.players[0].roadLength < before);
});

test('robber rejects non-adjacent victims and draws uniformly across cards', () => {
  const game = createPlayingGame(3);
  game.turnPhase = 'robber';
  const targetKey = Object.keys(game.hexes).find(key => key !== game.robber);
  const target = game.hexes[targetKey];
  game.vertices[GameLogic.vertexKey(target.q, target.r, 0)] = { building: 'settlement', owner: 1 };
  Object.assign(game.players[1].resources, { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 3 });

  let before = snapshot(game);
  assert.equal(GameLogic.moveRobber(game, 'p1', targetKey, 'p3').success, false);
  assert.equal(snapshot(game), before);

  const result = withRandom(0.9, () => GameLogic.moveRobber(game, 'p1', targetKey, 'p2'));
  assert.equal(result.success, true);
  assert.equal(result.stolenInfo.resource, 'ore');
  assert.equal(game.players[1].resources.ore, 2);
  assert.equal(game.players[0].resources.ore, 1);
});

test('finished games reject gameplay actions without mutation', () => {
  const game = createPlayingGame();
  game.phase = 'finished';
  game.players[0].resources.brick = 4;
  const before = snapshot(game);
  assert.equal(GameLogic.bankTrade(game, 'p1', 'brick', 4, 'ore').success, false);
  assert.equal(snapshot(game), before);
});

test('multiple recipients get none of a resource when its supply is short',()=>{
  const game=createPlayingGame();
  Object.values(game.hexes).forEach(hex=>{hex.number=null;});
  const hex=Object.values(game.hexes).find(h=>GameLogic.hexKey(h.q,h.r)!==game.robber);
  hex.number=6;hex.resource='brick';
  game.vertices[GameLogic.vertexKey(hex.q,hex.r,0)]={building:'city',owner:0};
  game.vertices[GameLogic.vertexKey(hex.q,hex.r,3)]={building:'settlement',owner:1};
  game.bank.brick=2;game.turnPhase='roll';
  const result=withRandom(0.4,()=>GameLogic.rollDice(game,'p1'));
  assert.equal(result.resourceGains[0].brick,0);assert.equal(result.resourceGains[1].brick,0);assert.equal(game.bank.brick,2);
});

test('a player can win only on their own turn, including when it begins',()=>{
  const game=createPlayingGame();game.players[1].victoryPoints=10;
  Object.assign(game.players[0].resources,{ore:1,grain:1,wool:1});game.devCardDeck=['knight'];
  assert.equal(GameLogic.buyDevCard(game,'p1').success,true);assert.equal(game.phase,'playing');
  assert.equal(GameLogic.endTurn(game,'p1').success,true);assert.equal(game.winner,'p2');
});

test('roads cannot extend through an opponent settlement',()=>{
  const game=createPlayingGame();game.edges.e_0_0_0={road:true,owner:0};game.vertices.v_0_0_1={building:'settlement',owner:1};
  Object.assign(game.players[0].resources,{brick:1,lumber:1});
  assert.equal(GameLogic.canPlaceRoad(game,'p1','e_0_0_1').valid,false);
  game.freeRoads=2;assert.equal(GameLogic.canPlaceRoad(game,'p1','e_0_0_1').valid,false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

console.log(`\n${passed}/${tests.length} engine contract tests passed`);
process.exitCode = passed === tests.length ? 0 : 1;
