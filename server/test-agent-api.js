import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from './roomService.js';
import { createAppServer } from './http.js';
import { createAgentBoard } from './agentBoard.js';
import * as SF from './seafarersCore.js';

let sequence = 0;
const requestId = () => `agent-api-${++sequence}`;

function raw(service, code, actor, type, payload = {}) {
  const view = service.observe(code, actor.token);
  return service.command(code, actor.token, { requestId: requestId(), revision: view.revision,
    generation: view.generation, ...(actor.role === 'ai' ? { controlEpoch: view.controlEpoch } : {}), type, payload });
}

function fixture({ scenario, ck = false, ai = false } = {}) {
  const service = new RoomService({ now: () => 1000 });
  const host = service.create({ name: 'Agent API fixture', seatCount: 3,
    ...(ai ? { seats: Array.from({ length: 3 }, () => ({ kind: 'ai', provider: 'codex', model: 'test-model' })) } : {}),
    ...(scenario || ck ? { gameOptions: { version: 1, extension56: false,
      expansions: [...(scenario ? ['seafarers'] : []), ...(ck ? ['cities_knights'] : [])],
      scenario: scenario || 'base', ...(scenario ? { setup: { layout: 'fixed', seed: 42 } } : {}) } } : {}),
  });
  assert.equal(host.success, true, host.error);
  const actors = service.roomFor(host.code).slots.map((slot, index) => {
    const actor = service.join(host.code, { name: `Player ${index}`, role: ai ? 'ai' : 'human', seatId: slot.id,
      ...(ai ? { provider: 'codex', model: 'test-model' } : {}) });
    assert.equal(actor.success, true, actor.error);
    assert.equal(raw(service, host.code, actor, 'ready').success, true);
    return actor;
  });
  assert.equal(raw(service, host.code, host, 'start').success, true);
  const active = actors.find(actor => actor.seatId === service.roomFor(host.code).game.players[0].id);
  return { service, host, actors, active, code: host.code };
}

function selector(envelope, action, extra = {}) {
  return { requestId: requestId(), ...envelope.control, actionId: action.id, ...extra };
}

function setupChoice(service, code, actor, type = 'placeSettlement') {
  const envelope = service.agentObserve(code, actor.token);
  assert.equal(envelope.success, true, envelope.error);
  const action = envelope.observation.actions.find(action => action.type === type);
  assert.ok(action, `${type} is offered`);
  return { envelope, action, command: selector(envelope, action) };
}

function assertPrivateBoundary(envelope, actor, rawPlayer, allTokens) {
  assert.equal(envelope.success, true);
  assert.equal(envelope.observation.seatId, actor.seatId);
  assert.equal(envelope.observation.format, 'catan-agent-v1');
  assert.deepEqual(envelope.observation.self.hand, { ...rawPlayer.resources, ...(rawPlayer.commodities || {}) });
  assert.deepEqual(envelope.observation.self.developmentCards, rawPlayer.developmentCards);
  assert.equal(envelope.observation.self.hiddenVictoryPoints, rawPlayer.hiddenVictoryPoints);
  for (const player of envelope.observation.players) {
    assert.equal(typeof player.cards, 'number');
    assert.equal(typeof player.developmentCards, 'number');
    for (const key of ['resources', 'hand', 'commodities', 'hiddenVictoryPoints', 'newDevCards']) assert.equal(Object.hasOwn(player, key), false);
    if (player.progressCards !== undefined) assert.equal(typeof player.progressCards, 'number');
  }
  const serialized = JSON.stringify(envelope);
  for (const token of allTokens) assert.equal(serialized.includes(token), false, 'No controller credential in observation');
  for (const forbidden of ['fogTerrainPile', 'fogNumberPile', 'rewardDeck', 'devCardDeck', 'progressDecks', 'runnerRunId']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} is excluded`);
  }
  assert.equal(/"[ve]_-?\d+_-?\d+_[0-5]"/.test(serialized), false, 'No engine coordinate aliases');
}

test('agent observations require an authenticated playing seat and selectors cannot grant spectator authority', () => {
  const { service, host, actors, active, code } = fixture();
  const spectator = service.join(code, { role: 'spectator', name: 'Guest' });
  assert.equal(spectator.success, true);
  for (const token of [undefined, 'forged-credential', active.seatId]) {
    assert.equal(service.agentObserve(code, token).statusCode, 401);
  }
  for (const actor of [host, spectator]) {
    assert.doesNotThrow(() => service.agentObserve(code, actor.token));
    assert.equal(service.agentObserve(code, actor.token).statusCode, 403);
    const view = service.observe(code, actor.token);
    const result = service.command(code, actor.token, { requestId: requestId(), revision: view.revision,
      generation: view.generation, actionId: 'a0', decisionId: 'forged-decision' });
    assert.equal(result.statusCode, 403);
  }
  for (const actor of actors) {
    const observed = service.agentObserve(code, actor.token);
    assert.equal(observed.success, true);
    assert.equal(observed.observation.seatId, actor.seatId);
  }
});

test('base, fog and CK observations preserve own facts and public-equivalence privacy', () => {
  for (const options of [{}, { scenario: 'the_fog_islands' }, { ck: true }, { scenario: 'heading_for_new_shores', ck: true }]) {
    const { service, host, actors, code } = fixture(options);
    const room = service.roomFor(code);
    for (const [index, player] of room.game.players.entries()) {
      player.resources = { brick: index + 1, lumber: index + 2, wool: 1, grain: 0, ore: 0 };
      player.developmentCards = [index === 0 ? 'knight' : 'victoryPoint'];
      player.newDevCards = [];
      player.hiddenVictoryPoints = index === 0 ? 0 : 1;
    }
    if (room.game.citiesKnights) for (const [index, player] of room.game.players.entries()) {
      player.commodities = { paper: 1, cloth: index, coin: 0 };
      player.progressCards = [{ id: `private-progress-${player.id}`, type: 'inventor', color: 'science' }];
    }
    service.legalCache.delete(code);
    for (const actor of actors) {
      const player = room.game.players.find(player => player.id === actor.seatId);
      const observed = service.agentObserve(code, actor.token);
      assertPrivateBoundary(observed, actor, player, [host.token, ...actors.map(actor => actor.token)]);
      if (player.progressCards) {
        assert.equal(observed.observation.self.progressCards[0].id, player.progressCards[0].id);
        for (const opponent of room.game.players.filter(player => player.id !== actor.seatId)) {
          assert.equal(JSON.stringify(observed).includes(opponent.progressCards[0].id), false);
        }
      }
      assert.equal(observed.observation.players.find(player => player.id === actor.seatId).cards,
        Object.values(player.resources).reduce((sum, value) => sum + value, 0) + Object.values(player.commodities || {}).reduce((sum, value) => sum + value, 0));
    }
    const viewer = actors.find(actor => actor.seatId === room.game.players[0].id);
    const before = service.agentObserve(code, viewer.token);
    for (const player of room.game.players.slice(1)) {
      [player.resources.brick, player.resources.lumber] = [player.resources.lumber, player.resources.brick];
      player.developmentCards = ['monopoly'];
      player.hiddenVictoryPoints = 5;
      if (player.progressCards) player.progressCards[0] = { id: 'different-private-card', type: 'mining', color: 'science' };
    }
    room.game.devCardDeck.reverse();
    if (room.game.seafarers) {
      room.game.seafarers.fogTerrainPile.reverse();
      room.game.seafarers.fogNumberPile.reverse();
      room.game.seafarers.rewardDeck.reverse();
    }
    if (room.game.citiesKnights) room.game.citiesKnights.progressDecks.science.reverse();
    service.legalCache.delete(code);
    assert.deepEqual(service.agentObserve(code, viewer.token), before, 'Only hidden information changed');
    if (options.scenario === 'the_fog_islands') {
      const unknown = before.observation.board.tiles.filter(tile => tile.unknown);
      assert.ok(unknown.length > 0);
      assert.ok(unknown.every(tile => tile.terrain === 'unknown' && !Object.hasOwn(tile, 'number') && !Object.hasOwn(tile, 'resource')));
    }
  }
});

test('action IDs execute the exact legal geometry and preserve all equivalent aliases as one choice', () => {
  const { service, active, code } = fixture();
  const { envelope, action, command } = setupChoice(service, code, active);
  const rawView = service.observe(code, active.token);
  const original = rawView.legalActions[action.actionIndex];
  const canonical = createAgentBoard(rawView.gameState);
  assert.equal(action.params.vertexKey, canonical.ids.vertices[original.payload.vertexKey]);
  const physicalChoices = envelope.observation.actions.filter(action => action.type === 'placeSettlement');
  assert.equal(physicalChoices.length, envelope.observation.board.vertices.length);
  assert.equal(new Set(physicalChoices.map(action => action.params.vertexKey)).size, physicalChoices.length);
  const result = service.command(code, active.token, command);
  assert.equal(result.success, true, result.error);
  const building = SF.buildingAt(service.roomFor(code).game, original.payload.vertexKey);
  assert.equal(building.vertex.building, 'settlement');
  assert.equal(service.roomFor(code).game.players[building.vertex.owner].id, active.seatId);
  const road = setupChoice(service, code, active, 'placeRoad');
  const rawRoad = service.observe(code, active.token).legalActions[road.action.actionIndex];
  assert.equal(service.command(code, active.token, road.command).success, true);
  assert.equal(SF.occupiedEdge(service.roomFor(code).game, rawRoad.payload.edgeKey).edge.road, true);
});

test('stale revisions, wrong seat/decision, tampered IDs, mixed envelopes and wrong generation reject atomically', () => {
  const { service, host, actors, active, code } = fixture();
  const { envelope, action } = setupChoice(service, code, active);
  const other = actors.find(actor => actor.seatId !== active.seatId);
  const foreign = service.agentObserve(code, other.token);
  const before = structuredClone(service.roomFor(code));
  const cases = [
    [selector(envelope, action, { decisionId: foreign.control.decisionId }), 409],
    [selector(envelope, action, { decisionId: `${envelope.control.decisionId}-tampered` }), 409],
    [selector(envelope, action, { actionId: 'a999999' }), 409],
    [selector(envelope, action, { actionId: 'a0;placeRoad' }), 400],
    [selector(envelope, action, { actionId: 0 }), 400],
    [selector(envelope, action, { type: 'placeSettlement' }), 400],
    [selector(envelope, action, { payload: {} }), 400],
    [selector(envelope, action, { generation: envelope.control.generation + 1 }), 409],
    [selector(envelope, action, { revision: envelope.control.revision - 1 }), 409],
  ];
  for (const [command, expected] of cases) {
    assert.equal(service.command(code, active.token, command).statusCode, expected);
    assert.deepEqual(service.roomFor(code), before);
  }
  assert.equal(service.command(code, other.token, selector(envelope, action)).statusCode, 409);
  assert.deepEqual(service.roomFor(code), before);
  assert.equal(raw(service, code, host, 'chat', { message: 'A public event changes the decision revision.' }).success, true);
  const afterEvent = structuredClone(service.roomFor(code));
  assert.equal(service.command(code, active.token, selector(envelope, action)).statusCode, 409);
  assert.equal(service.command(code, active.token, selector(envelope, action, { revision: afterEvent.revision })).statusCode, 409);
  assert.deepEqual(service.roomFor(code), afterEvent);
});

test('selector retries retain the original receipt after revision advances and reject reused IDs with other commands', () => {
  const { service, host, active, code } = fixture();
  const { command } = setupChoice(service, code, active);
  const first = service.command(code, active.token, command);
  assert.equal(first.success, true);
  assert.equal(raw(service, code, host, 'chat', { message: 'Intervening public update.' }).success, true);
  const roomAfter = structuredClone(service.roomFor(code));
  const retry = service.command(code, active.token, command);
  assert.deepEqual(retry, first);
  assert.deepEqual(service.command(code, active.token, { ...command, revision: roomAfter.revision }), first, 'Revision is excluded from idempotency fingerprint');
  assert.deepEqual(service.roomFor(code), roomAfter);
  assert.equal(service.command(code, active.token, { ...command, actionId: 'a999999' }).statusCode, 409);
  assert.equal(service.command(code, active.token, { ...command, decisionId: `${command.decisionId}-different` }).statusCode, 409);
  assert.deepEqual(service.roomFor(code), roomAfter);
});

test('AI selectors retain runner lease and control epoch fencing', () => {
  const { service, active, code } = fixture({ ai: true });
  const runId = 'agent-api-runner';
  assert.equal(service.aiLease(code, active.token, { runId, controlEpoch: active.controlEpoch }).success, true);
  const { command } = setupChoice(service, code, active);
  const before = structuredClone(service.roomFor(code));
  assert.equal(service.command(code, active.token, { ...command, runId: 'different-runner' }).statusCode, 409);
  assert.equal(service.command(code, active.token, { ...command, controlEpoch: command.controlEpoch + 1, runId }).statusCode, 409);
  assert.deepEqual(service.roomFor(code), before);
  assert.equal(service.command(code, active.token, { ...command, runId }).success, true);
});

async function withServer(service, run) {
  const server = createAppServer({ service, hostKey: 'agent-api-test-host-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function http(url, token, body) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
}

test('HTTP agent observation authenticates per seat and command receipts include a fresh private next envelope', async () => {
  const { service, host, actors, active, code } = fixture();
  const spectator = service.join(code, { role: 'spectator', name: 'HTTP Guest' });
  await withServer(service, async url => {
    const documentation=await fetch(`${url}/agent-api.md`);
    assert.equal(documentation.status,200);
    assert.match(documentation.headers.get('content-type'),/text\/markdown/);
    assert.match(await documentation.text(),/catan-agent-v1/);
    const guide=await (await fetch(`${url}/agent-guide.md`)).text();
    assert.ok(guide.indexOf('HTTP API (no checkout required)')<guide.indexOf('git clone'));
    assert.match(guide,/\/agent\/commands/);
    const agentUrl = `${url}/api/rooms/${code}/agent`;
    for (const token of [undefined, 'forged', active.seatId]) assert.equal((await http(agentUrl, token)).status, 401);
    for (const token of [host.token, spectator.token]) assert.equal((await http(agentUrl, token)).status, 403);
    for (const actor of actors) {
      const observed = await http(agentUrl, actor.token);
      assert.equal(observed.status, 200);
      assert.equal(observed.cacheControl, 'no-store');
      assert.equal(observed.body.observation.seatId, actor.seatId);
      assert.deepEqual(observed.body, service.agentObserve(code, actor.token));
    }
    const observed = (await http(agentUrl, active.token)).body;
    const action = observed.observation.actions.find(action => action.type === 'placeSettlement');
    const command = selector(observed, action);
    assert.equal((await http(`${agentUrl}/commands`, undefined, command)).status, 401);
    assert.equal((await http(`${agentUrl}/commands`, active.seatId, command)).status, 401);
    const first = await http(`${agentUrl}/commands`, active.token, command);
    assert.equal(first.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.next.control.revision, first.body.revision);
    assert.notEqual(first.body.next.control.decisionId, command.decisionId);
    assert.deepEqual(first.body.next, service.agentObserve(code, active.token));
    assert.equal(first.body.next.observation.seatId, active.seatId);
    // Existing coordinate commands still work through the legacy endpoint.
    const rawView = service.observe(code, active.token);
    const road = rawView.legalActions.find(action => action.type === 'placeRoad');
    const legacy = await http(`${url}/api/rooms/${code}/commands`, active.token, { requestId: requestId(),
      revision: rawView.revision, generation: rawView.generation, type: road.type, payload: road.payload });
    assert.equal(legacy.status, 200);
    assert.equal(Object.hasOwn(legacy.body, 'next'), false);
    const afterRoad = service.roomFor(code).revision;
    const retry = await http(`${agentUrl}/commands`, active.token, command);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.revision, first.body.revision, 'Receipt is the original result');
    assert.equal(retry.body.next.control.revision, afterRoad, 'Next observation reflects current state');
    assert.equal(service.roomFor(code).revision, afterRoad, 'Retry does not execute twice');
    assert.equal((await http(`${agentUrl}/commands`, active.token, { ...command, requestId: requestId() })).status, 409);
    assert.equal((await http(`${agentUrl}/commands`, active.token, { ...command, requestId: requestId(), type: 'advanceSetup' })).status, 400);
    const nextRaw = service.observe(code, active.token);
    const advance = nextRaw.legalActions.find(action => action.type === 'advanceSetup');
    const rawOnAgentEndpoint = await http(`${agentUrl}/commands`, active.token, { requestId: requestId(),
      revision: nextRaw.revision, generation: nextRaw.generation, type: advance.type, payload: advance.payload });
    assert.equal(rawOnAgentEndpoint.status, 200);
    assert.equal(rawOnAgentEndpoint.body.next.success, true);
    assert.deepEqual(rawOnAgentEndpoint.body.next, service.agentObserve(code, active.token));
  });
});
