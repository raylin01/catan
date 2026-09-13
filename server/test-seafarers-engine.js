import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import { executeAction, legalActions, playerView } from './actions.js';
import { SEAFARERS_SCENARIOS } from '../shared/scenarios.js';
import { newWorldComponents } from '../shared/newWorld.js';

function scenarioGame(scenario, count = 3, layout = scenario === 'new_world' ? 'variable' : 'fixed', seed = 42) {
  const game = G.createGame('seafarers-test', { id: 'p0', name: 'Player 0' }, count >= 5, false);
  for (let index = 1; index < count; index++) assert.equal(G.addPlayer(game, { id: `p${index}`, name: `Player ${index}` }).success, true);
  const result = G.configureExpansions(game, { version: 1, extension56: count >= 5, expansions: ['seafarers'], scenario,
    setup: { layout, seed } });
  assert.equal(result.success, true, `${scenario} ${count}: ${result.error || ''}`);
  return game;
}

function shortestShipPath(game, from, to, allowedOwner = null) {
  const links = new Map();
  const edges = [...new Set(Object.keys(game.edges).map(edge => SF.canonicalEdge(game, edge)))].filter(Boolean);
  for (const edge of edges) {
    const hexes = SF.edgeHexes(game, edge);
    if (!hexes.some(hex => ['sea','fog'].includes(hex.terrain)) && hexes.length !== 1) continue;
    const occupied = SF.occupiedEdge(game, edge);
    if (occupied && occupied.edge.owner !== allowedOwner) continue;
    const [a,b] = SF.edgeEndpoints(edge).map(vertex => SF.canonicalVertex(game, vertex));
    for (const [start,end] of [[a,b],[b,a]]) links.set(start, [...(links.get(start) || []), { end, edge }]);
  }
  const queue = [[from, []]];
  const seen = new Set([from]);
  for (const [vertex, path] of queue) {
    if (vertex === to) return path;
    for (const { end, edge } of links.get(vertex) || []) if (!seen.has(end)) {
      seen.add(end); queue.push([end, [...path, edge]]);
    }
  }
  return null;
}

function buildPirateVoyage(game, playerId) {
  const actor = game.players.findIndex(player => player.id === playerId);
  game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = actor;
  game.productionPlayerIndex = actor; game.turnRole = 'primary';
  game.pirate = 'frame:east'; // The fleet has sailed away from the first shipping lane.
  game.players[actor].resources.lumber = 14;
  game.players[actor].resources.wool = 14;
  const state = game.seafarers;
  const origin = SF.canonicalVertex(game, state.origins[playerId]);
  const beachhead = SF.canonicalVertex(game, state.beachheads.find(marker => marker.ownerId === playerId).vertexKey);
  const fortress = SF.canonicalVertex(game, state.fortresses.find(marker => marker.ownerId === playerId).vertexKey);
  const path = [...shortestShipPath(game, origin, beachhead, actor), ...shortestShipPath(game, beachhead, fortress, actor)];
  for (const edgeKey of path) {
    if (SF.occupiedEdge(game,edgeKey)?.edge.owner === actor) continue;
    const result = executeAction(game, playerId, 'placeShip', { edgeKey });
    assert.equal(result.success, true, `${edgeKey} (${state.playerColors[playerId]}, ${state.originsShip[playerId]}): ${result.error || ''}`);
  }
  assert.equal(SF.canAttackFortress(game, playerId).valid, true);
  assert.equal(game.seafarers.voyageEdges[playerId].length, path.length);
}

test('every published Seafarers map configures and starts at each supported player count', () => {
  for (const scenario of SEAFARERS_SCENARIOS) for (const count of [3,4,5,6]) {
    const game = scenarioGame(scenario.id, count);
    assert.ok(Object.keys(game.hexes).length >= 35);
    assert.equal(G.startGame(game).success, true, `${scenario.id} ${count} starts`);
    if (scenario.id === 'new_world') assert.equal(game.turnPhase, 'portPlacement');
    if (scenario.id === 'the_pirate_islands') {
      assert.equal(game.players.every(player => player.victoryPoints === 1), true);
      assert.ok(game.pirate);
    }
  }
});

test('visible seeded layouts reproduce, while hidden piles and pending context stay private', () => {
  const first = scenarioGame('the_fog_islands', 3);
  const second = scenarioGame('the_fog_islands', 3);
  assert.deepEqual(first.hexes, second.hexes);
  assert.deepEqual(first.ports, second.ports);
  assert.equal(JSON.stringify(playerView(first, 'p0')).includes('fogTerrainPile'), false);
  assert.equal(JSON.stringify(playerView(first, 'p0')).includes('fogNumberPile'), false);
  assert.equal(JSON.stringify(playerView(first, 'p0')).includes('rewardDeck'), false);
  const gold = scenarioGame('heading_for_new_shores', 3);
  gold.phase = 'playing'; gold.turnPhase = 'main'; gold.currentPlayerIndex = 0;
  SF.queueGoldClaims(gold, [{ playerId: 'p1', amount: 1, hexKey: 'h_0_0' }]);
  const choice = gold.pendingChoice;
  assert.equal(choice.actorId, 'p1');
  assert.equal(legalActions(gold, 'p0').length, 0);
  assert.equal(legalActions(gold, 'p1').length, 5);
  const projected = playerView(gold, 'p0').pendingChoice;
  assert.deepEqual(projected.options, []);
  assert.equal('context' in projected, false);
  const snapshot = JSON.stringify(gold);
  assert.equal(executeAction(gold, 'p1', 'resolveSeafarersChoice', { choiceId: choice.id, optionId: 'not-a-resource' }).success, false);
  assert.equal(JSON.stringify(gold), snapshot);
  assert.equal(executeAction(gold, 'p1', 'resolveSeafarersChoice', { choiceId: choice.id, optionId: 'brick' }).success, true);
  assert.equal(gold.players[1].resources.brick, 1);
});

test('variable 3–4 map restrictions keep forbidden discs off constrained hexes', () => {
  for (const seed of [0,1,42,0xffffffff]) {
    const forgotten = scenarioGame('the_forgotten_tribe', 3, 'variable', seed);
    for (const [q,r] of [[3,-1],[3,0],[2,1]]) assert.equal([5,6,8,9].includes(forgotten.hexes[G.hexKey(q,r)].number), false);
    const wonders = scenarioGame('the_wonders_of_catan', 3, 'variable', seed);
    for (const [q,r] of [[3,-1],[3,0]]) assert.equal([6,8].includes(wonders.hexes[G.hexKey(q,r)].number), false);
  }
  const unsupported = G.createGame('variable-test', { id:'p0', name:'P0' }, true, false);
  for (let index=1; index<5; index++) G.addPlayer(unsupported,{id:`p${index}`,name:`P${index}`});
  assert.equal(G.configureExpansions(unsupported,{version:1,extension56:true,expansions:['seafarers'],scenario:'the_fog_islands',setup:{layout:'variable',seed:1}}).success,false);
});

test('wonder claims are exclusive and four paid levels win', () => {
  const game = scenarioGame('the_wonders_of_catan');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = game.players.findIndex(player => player.id === 'p0');
  const actor = game.currentPlayerIndex;
  const marker = game.seafarers.wonderMarkers.greatWallVertices[0];
  game.vertices[marker] = { building: 'settlement', owner: actor };
  game.players[actor].victoryPoints = 1;
  assert.equal(SF.isScenarioWinner(game,game.players[actor],10),false);
  assert.equal(executeAction(game, 'p0', 'claimWonder', { wonderId:'great_wall' }).success,true);
  assert.equal(SF.canClaimWonder(game,'p1','great_wall').valid,false);
  for (const [resource, amount] of Object.entries({brick:12,lumber:4,grain:4})) { game.bank[resource]-=amount; game.players[actor].resources[resource]+=amount; }
  for (let level=1; level<=4; level++) {
    assert.equal(executeAction(game,'p0','buildWonder',{}).success,true);
    assert.equal(game.seafarers.wonders[0].level,level);
  }
  assert.equal(game.winner,'p0');
  assert.equal(game.phase,'finished');
});

test('Grand Monument requires a port city and five-link route; ten points require a leading wonder', () => {
  const game = scenarioGame('the_wonders_of_catan');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const player = game.players[0];
  const portVertex = game.ports[0].vertices[0];
  game.vertices[portVertex] = { building:'city', owner:0 };
  assert.equal(executeAction(game,player.id,'claimWonder',{wonderId:'grand_monument'}).success,false);
  const walk = (vertex, used, path) => {
    if (path.length === 5) return path;
    for (const raw of G.getVertexEdges(vertex)) {
      const edge = SF.canonicalEdge(game, raw);
      if (!edge || used.has(edge)) continue;
      const next = SF.edgeEndpoints(edge).map(value => SF.canonicalVertex(game,value)).find(value => value !== SF.canonicalVertex(game,vertex));
      const found = walk(next,new Set([...used,edge]),[...path,edge]);
      if (found) return found;
    }
    return null;
  };
  const route = walk(SF.canonicalVertex(game,portVertex),new Set(),[]);
  assert.equal(route.length,5);
  for (const edge of route) game.edges[edge] = { road:true, ship:false, owner:0 };
  assert.ok(SF.calculateSeaRouteLength(game,0) >= 5);
  assert.equal(executeAction(game,player.id,'claimWonder',{wonderId:'grand_monument'}).success,true);
  const claimant = game.players.find(p => p.id === player.id);
  claimant.victoryPoints = 10;
  assert.equal(SF.isScenarioWinner(game,claimant,10),false,'a claim without a level does not win');
  game.seafarers.wonders.find(wonder => wonder.ownerId === player.id).level = 1;
  assert.equal(SF.isScenarioWinner(game,claimant,10),true,'one level leads an unclaimed field');
  game.seafarers.wonders.push({id:'great_wall',ownerId:game.players.find(p=>p.id!==player.id).id,level:1});
  assert.equal(SF.isScenarioWinner(game,claimant,10),false,'tied wonders do not satisfy strict lead');
  game.seafarers.wonders.find(wonder => wonder.ownerId === player.id).level = 2;
  assert.equal(SF.isScenarioWinner(game,claimant,10),true);
});

test('Pirate Islands fleet, warship conversion, and fortress attrition use recorded state', () => {
  const game = scenarioGame('the_pirate_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'roll'; game.currentPlayerIndex = 0;
  const player = game.players[0];
  assert.equal(game.devCardDeck.includes('victoryPoint'),false);
  const deck = game.devCardDeck;
  SF.isScenarioWinner(game,player,player.victoryPoints);
  assert.equal(game.devCardDeck,deck,'victory check must not replace or mutate the deck');
  const ordinaryShip = Object.entries(game.edges).find(([,edge]) => edge.ship && edge.owner === 0)?.[0];
  assert.ok(ordinaryShip);
  assert.equal(SF.convertWarship(game,player.id).success,true);
  assert.equal(player.warships,1);
  assert.equal(SF.convertWarship(game,player.id).success,false);
  const next = game.seafarers.fleetRoute[(game.seafarers.fleetIndex + 1) % game.seafarers.fleetRoute.length];
  game.vertices[G.vertexKey(next.q,next.r,0)] = { building:'settlement', owner:0 };
  assert.equal(SF.onDiceRolled(game,1,1).success,true);
  assert.equal(game.pirate,G.hexKey(next.q,next.r));
  const fortress = game.seafarers.fortresses.find(item => item.ownerId === player.id);
  assert.ok(fortress);
  const routes = G.getVertexEdges(fortress.vertexKey).filter(key => game.edges[key]).slice(0,2);
  assert.equal(routes.length,2);
  for (const route of routes) game.edges[route] = { road:false, ship:true, owner:0, warship:true };
  player.warships = 6;
  game.pendingChoice = null;
  game.turnPhase = 'main';
  const random = Math.random;
  Math.random = () => 0;
  try {
    for (let remaining=2; remaining>=0; remaining--) {
      assert.equal(SF.onActorEnd(game,{attackFortress:true}).success,true);
      assert.equal(fortress.lairs,remaining);
    }
  } finally { Math.random = random; }
  assert.equal(fortress.capturedBy,player.id);
});

test('Pirate voyages reach printed frame fortresses and optional attacks end either actor role', () => {
  for (const count of [3,5]) {
    const game = scenarioGame('the_pirate_islands', count);
    assert.equal(G.startGame(game).success, true);
    buildPirateVoyage(game, 'p0');
    const fortress = game.seafarers.fortresses.find(marker => marker.ownerId === 'p0');
    const actor = game.players.findIndex(player => player.id === 'p0');
    const before = fortress.lairs;
    const declined = structuredClone(game);
    assert.equal(executeAction(declined, 'p0', 'endTurn', {}).success, true);
    assert.equal(declined.seafarers.fortresses.find(marker => marker.ownerId === 'p0').lairs, before);
    assert.equal(declined.seafarers.lastFortressAttack, undefined);
    assert.ok(legalActions(game, 'p0').some(action => action.type === 'attackFortress'));
    game.players[actor].warships = 6;
    for (const edge of game.seafarers.voyageEdges.p0) SF.occupiedEdge(game, edge).edge.warship = true;
    const random = Math.random;
    Math.random = () => 0;
    try {
      assert.equal(executeAction(game, 'p0', 'attackFortress', {}).success, true);
    } finally { Math.random = random; }
    assert.equal(game.seafarers.fortresses.find(marker => marker.ownerId === 'p0').lairs, before - 1);
    assert.equal(game.seafarers.lastFortressAttack.playerId, 'p0');
    assert.equal(game.currentPlayerIndex === actor, false);
    if (count === 5) assert.equal(game.turnRole, 'paired');
    else assert.equal(game.turnPhase, 'roll');
    if (count === 5) {
      const paired = scenarioGame('the_pirate_islands', count);
      assert.equal(G.startGame(paired).success, true);
      buildPirateVoyage(paired, 'p0');
      const pairedActor = paired.players.findIndex(player => player.id === 'p0');
      paired.turnRole = 'paired';
      paired.productionPlayerIndex = (pairedActor - 3 + count) % count;
      paired.players[pairedActor].warships = 6;
      for (const edge of paired.seafarers.voyageEdges.p0) SF.occupiedEdge(paired, edge).edge.warship = true;
      const randomPaired = Math.random;
      Math.random = () => 0;
      try { assert.equal(executeAction(paired, 'p0', 'attackFortress', {}).success, true); }
      finally { Math.random = randomPaired; }
      assert.equal(paired.turnRole, 'primary');
      assert.equal(paired.turnPhase, 'roll');
      assert.equal(paired.seafarers.lastFortressAttack.playerId, 'p0');
    }
  }
});

test('an open Pirate starting ship can move before a western voyage is chosen', () => {
  const game = scenarioGame('the_pirate_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main';
  game.currentPlayerIndex = game.players.findIndex(player => player.id === 'p0');
  game.pirate = 'frame:east';
  const fromEdgeKey = game.seafarers.originsShip.p0;
  const origin = game.seafarers.origins.p0;
  const toEdgeKey = G.getVertexEdges(origin).find(edge => SF.canMoveShip(game,'p0',fromEdgeKey,edge).valid);
  assert.ok(toEdgeKey);
  assert.equal(executeAction(game,'p0','moveShip',{fromEdgeKey,toEdgeKey}).success,true);
  assert.equal(game.seafarers.originsShip.p0,SF.canonicalEdge(game,toEdgeKey));
  assert.deepEqual(game.seafarers.voyageEdges.p0,[]);
  assert.equal(Boolean(SF.occupiedEdge(game,fromEdgeKey)),false);
  assert.equal(executeAction(game,'p0','moveShip',{fromEdgeKey:toEdgeKey,toEdgeKey:fromEdgeKey}).success,false);
});

test('a western Pirate voyage may start at a later eastern coastal settlement', () => {
  const game = scenarioGame('the_pirate_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main';
  const actor = game.players.findIndex(player => player.id === 'p0');
  game.currentPlayerIndex = actor; game.pirate = 'frame:east';
  game.players[actor].resources.lumber = 14; game.players[actor].resources.wool = 14;
  const preplacedShip = game.seafarers.originsShip.p0;
  const preplacedOrigin = SF.canonicalVertex(game,game.seafarers.origins.p0);
  let selected = null;
  for (const edgeKey of Object.keys(game.edges)) {
    if (SF.occupiedEdge(game,edgeKey) || SF.edgeHexes(game,edgeKey).some(hex => hex.region === 'east')) continue;
    for (const vertex of SF.edgeEndpoints(edgeKey)) {
      const canonical = SF.canonicalVertex(game,vertex);
      if (canonical === preplacedOrigin || SF.buildingAt(game,vertex) ||
          !G.getVertexAdjacentHexes(game,vertex).some(hex => hex.region === 'east')) continue;
      const previous = game.vertices[vertex];
      game.vertices[vertex] = {building:'settlement',owner:actor};
      const canBuild = SF.canPlaceShip(game,'p0',edgeKey);
      if (canBuild.valid && canBuild.newVoyage?.origin === canonical && canBuild.newVoyage.route.length === 1) {
        const priorEdge = game.edges[edgeKey];
        game.edges[edgeKey] = {road:false,ship:true,owner:actor,warship:false};
        const tip = SF.edgeEndpoints(edgeKey).map(value => SF.canonicalVertex(game,value)).find(value => value !== canonical);
        const beachhead = SF.canonicalVertex(game,game.seafarers.beachheads.find(marker => marker.ownerId === 'p0').vertexKey);
        const fortress = SF.canonicalVertex(game,game.seafarers.fortresses.find(marker => marker.ownerId === 'p0').vertexKey);
        const first = shortestShipPath(game,tip,beachhead), second = shortestShipPath(game,beachhead,fortress);
        game.edges[edgeKey] = priorEdge;
        if (first && second && 1 + first.length + second.length <= game.players[actor].ships) {
          selected = {edgeKey,vertex,origin:canonical}; break;
        }
      }
      game.vertices[vertex] = previous;
    }
    if (selected) break;
  }
  assert.ok(selected,'an alternative printed-coast origin is available');
  assert.equal(executeAction(game,'p0','placeShip',{edgeKey:selected.edgeKey}).success,true);
  assert.equal(game.seafarers.origins.p0,selected.origin);
  assert.deepEqual(game.seafarers.voyageEdges.p0,[SF.canonicalEdge(game,selected.edgeKey)]);
  assert.equal(Boolean(SF.occupiedEdge(game,preplacedShip)?.edge.ship),true,'the preplaced ship remains a separate home-island route');
  const tip = SF.edgeEndpoints(selected.edgeKey).map(vertex => SF.canonicalVertex(game,vertex)).find(vertex => vertex !== selected.origin);
  const beachhead = SF.canonicalVertex(game,game.seafarers.beachheads.find(marker => marker.ownerId === 'p0').vertexKey);
  const fortress = SF.canonicalVertex(game,game.seafarers.fortresses.find(marker => marker.ownerId === 'p0').vertexKey);
  const rest = [...shortestShipPath(game,tip,beachhead),...shortestShipPath(game,beachhead,fortress)];
  for (const edgeKey of rest) {
    const result = executeAction(game,'p0','placeShip',{edgeKey});
    assert.equal(result.success,true,`${edgeKey}: ${result.error || ''}`);
  }
  assert.equal(SF.canAttackFortress(game,'p0').valid,true);
});

test('ambiguous shortest Pirate voyage origins become an authenticated board-target choice', () => {
  const game = scenarioGame('the_pirate_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main';
  const playerId = Object.entries(game.seafarers.playerColors).find(([,color]) => color === 'red')[0];
  const otherId = game.players.find(player => player.id !== playerId).id;
  const actor = game.players.findIndex(player => player.id === playerId);
  game.currentPlayerIndex = actor; game.pirate = 'frame:east';
  game.players[actor].resources.lumber = 2; game.players[actor].resources.wool = 2;
  let edgeKey = null;
  for (const candidate of Object.keys(game.edges)) {
    if (SF.occupiedEdge(game,candidate) || SF.edgeHexes(game,candidate).some(hex => hex.region === 'east')) continue;
    for (const vertex of SF.edgeEndpoints(candidate)) {
      if (SF.buildingAt(game,vertex) || !G.getVertexAdjacentHexes(game,vertex).some(hex => hex.region === 'east')) continue;
      const previous = game.vertices[vertex];
      game.vertices[vertex] = {building:'settlement',owner:actor};
      if (SF.canPlaceShip(game,playerId,candidate).newVoyageChoices?.length > 1) {
        edgeKey = candidate; break;
      }
      game.vertices[vertex] = previous;
    }
    if (edgeKey) break;
  }
  assert.ok(edgeKey,'a printed coast admits two shortest starting buildings');
  assert.equal(executeAction(game,playerId,'placeShip',{edgeKey}).success,true);
  assert.equal(game.pendingChoice?.kind,'pirateVoyageOrigin');
  assert.ok(game.pendingChoice.options.length > 1);
  assert.equal(game.pendingChoice.options.every(option => option.vertexKey && option.edgeKey),true);
  const publicOther = playerView(game,otherId).pendingChoice;
  assert.deepEqual(publicOther.options,[]);
  assert.equal('context' in publicOther,false);
  const choice = game.pendingChoice;
  const before = JSON.stringify(game);
  assert.equal(executeAction(game,otherId,'resolveSeafarersChoice',{choiceId:choice.id,optionId:choice.options[0].id}).success,false);
  assert.equal(JSON.stringify(game),before);
  const option = choice.options.at(-1);
  assert.equal(executeAction(game,playerId,'resolveSeafarersChoice',{choiceId:choice.id,optionId:option.id}).success,true);
  assert.equal(game.pendingChoice,null);
  assert.equal(game.seafarers.origins[playerId],option.vertexKey);
  assert.ok(game.seafarers.voyageEdges[playerId].includes(SF.canonicalEdge(game,edgeKey)));
});

test('Cloth village routes award one token, produce cloth, and cannot be moved open', () => {
  const game = scenarioGame('cloth_for_catan');
  assert.equal(game.seafarers.villages.length, 8);
  assert.equal(game.seafarers.villages.every(village => village.numbers.length === 1 && village.cloth === 5), true);
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const village = game.seafarers.villages[0];
  const villageVertex = SF.canonicalVertex(game,village.vertexKey);
  const route = G.getVertexEdges(villageVertex).find(edge => game.edges[edge] &&
    SF.edgeHexes(game,edge).some(hex => hex.terrain === 'sea'));
  assert.ok(route);
  const endpoints = SF.edgeEndpoints(route);
  const home = endpoints.find(vertex => SF.canonicalVertex(game,vertex) !== villageVertex);
  game.vertices[home] = { building:'settlement', owner:0 };
  game.edges[route] = { road:false, ship:true, owner:0, warship:false };
  SF.refreshVillageRelations(game);
  assert.equal(game.seafarers.villageRelations[`${game.players[0].id}:${village.id}`],true);
  assert.equal(game.players[0].cloth,1);
  assert.equal(village.cloth,4);
  SF.onProduction(game,village.numbers[0]);
  assert.equal(game.players[0].cloth,2);
  assert.equal(game.players[0].victoryPoints,1);
  assert.equal(SF.canMoveShip(game,game.players[0].id,route,route).valid,false);
});

test('Cloth villages sharing an island require contact at their own numbered vertex', () => {
  const game = scenarioGame('cloth_for_catan',5);
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const [top,bottom] = game.seafarers.villages;
  assert.equal(top.hexKey,bottom.hexKey);
  assert.notEqual(SF.canonicalVertex(game,top.vertexKey),SF.canonicalVertex(game,bottom.vertexKey));
  const target = SF.canonicalVertex(game,bottom.vertexKey);
  const edge = G.getVertexEdges(target).find(value => game.edges[value] && SF.edgeHexes(game,value).some(hex => hex.terrain === 'sea'));
  assert.ok(edge);
  const home = SF.edgeEndpoints(edge).find(vertex => SF.canonicalVertex(game,vertex) !== target);
  game.vertices[home] = {building:'settlement',owner:0};
  game.edges[edge] = {road:false,ship:true,owner:0,warship:false};
  SF.refreshVillageRelations(game);
  const player = game.players[0];
  assert.equal(game.seafarers.villageRelations[`${player.id}:${bottom.id}`],true);
  assert.equal(game.seafarers.villageRelations[`${player.id}:${top.id}`],undefined);
  assert.equal(player.cloth,1);
});

test('Forgotten Tribe keeps a discovered port pending until an owned coast is available', () => {
  const game = scenarioGame('the_forgotten_tribe');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const actor = game.players[0];
  const token = game.seafarers.collectiblePorts[0];
  SF.onRoutePlaced(game,actor.id,token.edge,'ship');
  assert.equal(token.collected,true);
  assert.equal(game.pendingChoice,null);
  assert.equal(game.seafarers.pendingPortClaims.length,1);
  const coast = Object.keys(game.edges).find(edge => {
    const hexes = SF.edgeHexes(game,edge);
    return hexes.some(hex => hex.terrain === 'sea') && hexes.some(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog');
  });
  const vertex = SF.edgeEndpoints(coast)[0];
  game.vertices[vertex] = { building:'settlement', owner:0 };
  SF.onSettlementPlaced(game,0,vertex,false);
  assert.equal(game.pendingChoice?.kind,'tribePort');
  const option = game.pendingChoice.options[0];
  assert.ok(option.edgeKey);
  const result = executeAction(game,actor.id,'resolveSeafarersChoice',{choiceId:game.pendingChoice.id,optionId:option.id});
  assert.equal(result.success,true,result.error);
  assert.equal(game.ports.length,1);
});

test('Longest Route switches between roads and ships only through an owned building', () => {
  const game = scenarioGame('heading_for_new_shores');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main';
  let pair;
  for (const vertex of Object.keys(game.vertices)) {
    const edges = G.getVertexEdges(vertex).filter(edge => game.edges[edge]);
    const road = edges.find(edge => SF.edgeHexes(game,edge).some(hex => hex.terrain !== 'sea' && hex.terrain !== 'fog'));
    const ship = edges.find(edge => edge !== road && SF.edgeHexes(game,edge).some(hex => hex.terrain === 'sea'));
    if (road && ship) { pair = { vertex, road, ship }; break; }
  }
  assert.ok(pair);
  game.edges[pair.road] = { road:true, ship:false, owner:0 };
  game.edges[pair.ship] = { road:false, ship:true, owner:0 };
  assert.equal(SF.calculateSeaRouteLength(game,0),1);
  game.vertices[pair.vertex] = { building:'settlement', owner:0 };
  assert.equal(SF.calculateSeaRouteLength(game,0),2);
  game.vertices[pair.vertex] = { building:'settlement', owner:1 };
  assert.equal(SF.calculateSeaRouteLength(game,0),1);
});

test('Pirate fleet reward choice resolves before the dice production phase', () => {
  const game = scenarioGame('the_pirate_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'roll'; game.currentPlayerIndex = 0;
  const actor = game.players[0];
  actor.warships = 2;
  const stop = game.seafarers.fleetRoute[(game.seafarers.fleetIndex + 1) % game.seafarers.fleetRoute.length];
  game.vertices[G.vertexKey(stop.q,stop.r,0)] = { building:'settlement', owner:0 };
  const random = Math.random;
  Math.random = () => 0;
  try { assert.equal(executeAction(game,actor.id,'rollDice',{}).success,true); }
  finally { Math.random = random; }
  assert.equal(game.pendingChoice?.kind,'fleetReward');
  assert.equal(game.turnPhase,'roll');
  assert.equal(game.seafarers.pendingRollTotal,2);
  const choice = game.pendingChoice;
  assert.equal(executeAction(game,actor.id,'resolveSeafarersChoice',{choiceId:choice.id,optionId:'ore'}).success,true);
  assert.equal(game.pendingChoice,null);
  assert.equal(game.seafarers.pendingRollTotal,undefined);
  assert.equal(game.turnPhase,'main');
  assert.equal(game.players.find(player => player.id === actor.id).resources.ore,1);
});

test('New World custom mix and ordered hex swaps preview exactly match live seeded board', () => {
  for (const count of [3,5]) {
    const components = newWorldComponents(count);
    const terrainMix = { ...components.defaultTerrain, sea: components.defaultTerrain.sea - 1 };
    if (count === 3) terrainMix.gold++;
    else terrainMix.desert++;
    const options = { version:1, extension56:count>=5, expansions:['seafarers'], scenario:'new_world',
      setup:{layout:'variable',seed:null,terrainMix,hexSwaps:[[components.hexKeys[0],components.hexKeys.at(-1)]]} };
    const preview = G.previewNewWorldSetup(options,count);
    assert.equal(preview.success,true,preview.error);
    assert.equal(Number.isSafeInteger(preview.boardPreview.seed),true);
    const live = G.createGame('custom-world',{id:'p0',name:'P0'},count>=5,false);
    for (let index=1; index<count; index++) G.addPlayer(live,{id:`p${index}`,name:`P${index}`});
    assert.equal(G.configureExpansions(live,preview.gameOptions).success,true);
    assert.deepEqual(live.hexes,preview.boardPreview.hexes);
    assert.equal(Object.values(live.hexes).filter(hex=>hex.terrain==='sea').length,terrainMix.sea);
  }
});

test('legal action enumeration preserves hidden piles and never samples randomness', () => {
  const game = scenarioGame('the_fog_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  for (const resource of ['brick','lumber','wool','grain','ore']) game.players[0].resources[resource] = 3;
  const before = JSON.stringify(game);
  const random = Math.random;
  Math.random = () => { throw new Error('Enumeration sampled randomness'); };
  try { assert.ok(Array.isArray(legalActions(game,game.players[0].id))); }
  finally { Math.random = random; }
  assert.equal(JSON.stringify(game),before);
});

test('New World preview rejects out-of-supply mixes and out-of-frame swaps atomically', () => {
  const components = newWorldComponents(3);
  const options = { version:1, extension56:false, expansions:['seafarers'], scenario:'new_world',
    setup:{ layout:'variable', seed:9, terrainMix:{...components.defaultTerrain,sea:components.terrainMaxima.sea+1} } };
  assert.equal(G.previewNewWorldSetup(options,3).success,false);
  const live = G.createGame('invalid-world',{id:'p0',name:'P0'},false,false);
  G.addPlayer(live,{id:'p1',name:'P1'}); G.addPlayer(live,{id:'p2',name:'P2'});
  const before = JSON.stringify(live);
  assert.equal(G.configureExpansions(live,options).success,false);
  assert.equal(JSON.stringify(live),before);
  options.setup = {layout:'variable',seed:9,hexSwaps:[[components.hexKeys[0],'outside-frame']]};
  assert.equal(G.previewNewWorldSetup(options,3).success,false);
});

test('five exhausted Cloth villages end a 5-player game by score then cloth', () => {
  const game = scenarioGame('cloth_for_catan',5);
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  game.seafarers.villages.slice(0,5).forEach(village => { village.cloth = 0; });
  game.players[0].victoryPoints = 8; game.players[0].cloth = 2;
  game.players[1].victoryPoints = 8; game.players[1].cloth = 4;
  game.players[2].victoryPoints = 7; game.players[2].cloth = 8;
  const winner = game.players[1].id;
  const result = executeAction(game,game.players[0].id,'endTurn',{});
  assert.equal(result.success,true,result.error);
  assert.equal(game.phase,'finished');
  assert.equal(game.winner,winner);
});

test('ship actions enforce newly built, closed line, pirate, and one move per phase', () => {
  const game = scenarioGame('heading_for_new_shores');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const actor = game.players[0].id;
  game.players[0].resources.lumber = 10; game.players[0].resources.wool = 10;
  const source = 'e_0_-3_2', home = 'v_0_-3_2', destination = 'e_0_-2_0';
  game.vertices[home] = { building:'settlement', owner:0 };
  assert.equal(executeAction(game,actor,'placeShip',{edgeKey:source}).success,true);
  const built = JSON.stringify(game);
  assert.equal(executeAction(game,actor,'moveShip',{fromEdgeKey:source,toEdgeKey:destination}).success,false);
  assert.equal(JSON.stringify(game),built);
  game.seafarers.builtShips = [];
  const blocked = structuredClone(game);
  blocked.pirate = G.hexKey(SF.edgeHexes(blocked,source).find(hex => hex.terrain === 'sea').q,
    SF.edgeHexes(blocked,source).find(hex => hex.terrain === 'sea').r);
  assert.equal(executeAction(blocked,actor,'moveShip',{fromEdgeKey:source,toEdgeKey:destination}).success,false);
  const closed = structuredClone(game);
  const otherEnd = SF.edgeEndpoints(source).find(vertex => !G.areVerticesEqual(vertex,home));
  closed.vertices[otherEnd] = { building:'settlement', owner:0 };
  assert.equal(executeAction(closed,actor,'moveShip',{fromEdgeKey:source,toEdgeKey:destination}).success,false);
  assert.equal(executeAction(game,actor,'moveShip',{fromEdgeKey:source,toEdgeKey:destination}).success,true);
  assert.equal(game.seafarers.shipMovedThisPhase,true);
  assert.equal(executeAction(game,actor,'moveShip',{fromEdgeKey:destination,toEdgeKey:source}).success,false);
});

test('building a fog-edge ship reveals the next hidden tile and pays its discovery resource', () => {
  for (const [terrain, expected] of [['forest','lumber'],['gold','brick']]) {
    const game = scenarioGame('the_fog_islands');
    G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
    const actor = game.players[0].id;
    const edgeKey = 'e_2_-3_2', vertexKey = 'v_2_-3_2', fogKey = G.hexKey(1,-2);
    game.vertices[vertexKey] = { building:'settlement', owner:0 };
    game.players[0].resources.lumber = 3; game.players[0].resources.wool = 3;
    game.seafarers.fogTerrainPile[0] = terrain;
    game.seafarers.fogNumberPile[0] = 5;
    const bankBefore = game.bank[expected];
    assert.equal(executeAction(game,actor,'placeShip',{edgeKey}).success,true);
    assert.equal(game.hexes[fogKey].terrain,terrain);
    assert.equal(game.hexes[fogKey].number,5);
    assert.equal(game.hexes[fogKey].hidden,false);
    if (terrain === 'gold') {
      assert.equal(game.pendingChoice?.kind,'goldResource');
      assert.equal(executeAction(game,actor,'resolveSeafarersChoice',{choiceId:game.pendingChoice.id,optionId:'brick'}).success,true);
    }
    assert.equal(game.bank[expected],bankBefore-(terrain === 'gold' ? 1 : 0));
  }
});

test('one ship reveals adjacent fog tiles in stable order and honors bank shortage', () => {
  const game = scenarioGame('the_fog_islands');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'main'; game.currentPlayerIndex = 0;
  const player = game.players[0];
  player.resources.lumber = 1; player.resources.wool = 1;
  let target = null;
  for (const edgeKey of Object.keys(game.edges)) {
    const fog = [...new Set(SF.edgeEndpoints(edgeKey).flatMap(vertex => G.getVertexAdjacentHexes(game,vertex))
      .filter(hex => hex.terrain === 'fog').map(hex => G.hexKey(hex.q,hex.r)))].sort();
    if (fog.length !== 2 || SF.occupiedEdge(game,edgeKey)) continue;
    for (const vertex of SF.edgeEndpoints(edgeKey)) {
      if (SF.buildingAt(game,vertex)) continue;
      const previous = game.vertices[vertex];
      game.vertices[vertex] = { building:'settlement',owner:0 };
      if (SF.canPlaceShip(game,player.id,edgeKey).valid) { target = { edgeKey, fog }; break; }
      game.vertices[vertex] = previous;
    }
    if (target) break;
  }
  assert.ok(target,'a two-fog ship approach exists');
  game.seafarers.fogTerrainPile.splice(0,2,'forest','hills');
  game.seafarers.fogNumberPile.splice(0,2,4,5);
  const terrainRemaining = game.seafarers.fogTerrainPile.length;
  const numberRemaining = game.seafarers.fogNumberPile.length;
  game.bank.lumber = 0;
  game.bank.brick = 1;
  game.freeRoads = 1; // A free Road Building ship leaves the exhausted wood bank empty.
  const result = executeAction(game,player.id,'placeShip',{edgeKey:target.edgeKey});
  assert.equal(result.success,true,result.error);
  assert.equal(game.hexes[target.fog[0]].terrain,'forest');
  assert.equal(game.hexes[target.fog[0]].number,4);
  assert.equal(game.hexes[target.fog[1]].terrain,'hills');
  assert.equal(game.hexes[target.fog[1]].number,5);
  assert.equal(game.players.find(value=>value.id===player.id).resources.brick,1);
  assert.equal(game.players.find(value=>value.id===player.id).resources.lumber,1);
  assert.equal(game.seafarers.fogTerrainPile.length,terrainRemaining - 2);
  assert.equal(game.seafarers.fogNumberPile.length,numberRemaining - 2);
});

test('a producing gold city makes two independent supply-backed choices', () => {
  const game = scenarioGame('heading_for_new_shores');
  G.startGame(game); game.phase = 'playing'; game.turnPhase = 'roll'; game.currentPlayerIndex = 0;
  const actor = game.players[0].id;
  const gold = Object.values(game.hexes).find(hex => hex.terrain === 'gold');
  gold.number = 2;
  game.vertices[G.vertexKey(gold.q,gold.r,0)] = { building:'city', owner:0 };
  const random = Math.random;
  Math.random = () => 0;
  try { assert.equal(executeAction(game,actor,'rollDice',{}).success,true); }
  finally { Math.random = random; }
  assert.equal(game.pendingChoice?.kind,'goldResource');
  for (const resource of ['brick','ore']) {
    const choiceId = game.pendingChoice.id;
    assert.equal(executeAction(game,actor,'resolveSeafarersChoice',{choiceId,optionId:resource}).success,true);
  }
  assert.equal(game.pendingChoice,null);
  assert.equal(game.players[0].resources.brick,1);
  assert.equal(game.players[0].resources.ore,1);
});
