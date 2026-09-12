import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {RoomService} from '../server/roomService.js';
import {createAppServer} from '../server/http.js';
import {syncNegotiationTurn} from '../server/negotiation.js';
import {getVertexEdges} from '../server/gameLogic.js';
import {legalActions} from '../server/actions.js';
import {GameClient} from './client.js';
import {runPlayer} from './runner.js';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function emptyResources(overrides = {}) {
  return Object.fromEntries(RESOURCES.map(resource => [resource, overrides[resource] || 0]));
}

async function createRoom(url, hostKey) {
  const response = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Host-Key': hostKey},
    body: JSON.stringify({
      name: 'Negotiation integration',
      seatCount: 4,
      seats: Array.from({length: 4}, () => ({
        kind: 'ai', provider: 'codex', model: 'deterministic-test-model'
      }))
    })
  });
  return response.json();
}

function installExpansionRoute(room, actorSeatId) {
  const actorIndex = room.game.players.findIndex(player => player.id === actorSeatId);
  const actor = room.game.players[actorIndex];
  const portVertices = new Set(room.game.ports.flatMap(port => port.vertices));
  const settlementKey = Object.keys(room.game.vertices).find(key => !portVertices.has(key));
  room.game.vertices[settlementKey] = {building: 'settlement', owner: actorIndex};
  const firstRoad = getVertexEdges(settlementKey).find(key => room.game.edges[key]);
  assert.ok(firstRoad);
  room.game.edges[firstRoad] = {road: true, owner: actorIndex};

  const intendedHand = {...actor.resources};
  actor.resources = {...intendedHand, brick: 1, lumber: 1};
  const candidates = legalActions(room.game, actorSeatId).filter(action => action.type === 'placeRoad');
  actor.resources = {...intendedHand};
  let expansionVertex = null;
  for (const candidate of candidates) {
    const edgeKey = candidate.payload.edgeKey;
    room.game.edges[edgeKey] = {road: true, owner: actorIndex};
    actor.resources = {...intendedHand, brick: 1, lumber: 1, wool: 1, grain: 1};
    expansionVertex = legalActions(room.game, actorSeatId)
      .find(action => action.type === 'placeSettlement')?.payload.vertexKey || null;
    actor.resources = {...intendedHand};
    if (expansionVertex) break;
    room.game.edges[edgeKey] = {road: false, owner: null};
  }
  assert.ok(expansionVertex, 'one brick must unlock a real settlement location');
  actor.settlements = 4;
  actor.roads = 13;
  return expansionVertex;
}

function fakeConnector({seatId, actorSeatId, partnerSeatId, counters, timeline}) {
  const forbiddenChannel = channel => async () => {
    counters[channel]++;
    throw new Error(`${channel} must not run for structured AI negotiation`);
  };
  return {
    id: `deterministic-${seatId}`,
    ready: async () => {},
    readChat: forbiddenChannel('reader'),
    speak: forbiddenChannel('speaker'),
    async decide(view, {signal}) {
      signal?.throwIfAborted();
      counters.gameplay[seatId]++;
      if (seatId === actorSeatId) {
        if (view.trade?.to === actorSeatId && view.trade.status === 'offered') {
          timeline.push('amber-accepts');
          return {memory: 'amber', action: {type: 'tradeAccept', payload: {tradeId: view.trade.id}}};
        }
        if (view.negotiation?.canInitiate) {
          timeline.push('amber-proposes');
          return {memory: 'amber', negotiation: {
            kind: 'interest', wants: ['brick'], offers: ['wool'], to: partnerSeatId, replyToId: null
          }};
        }
        timeline.push('amber-unexpected-end-turn');
        return {memory: 'amber', action: {type: 'endTurn', payload: {}}};
      }

      if (seatId === partnerSeatId) {
        if (view.trade?.from === partnerSeatId && view.trade.status === 'accepted') {
          timeline.push('basil-thinking-before-confirm');
          await delay(100, undefined, {signal});
          timeline.push('basil-confirms');
          return {memory: 'basil', action: {type: 'tradeConfirm', payload: {tradeId: view.trade.id}}};
        }
        const request = view.negotiations?.find(item => item.intent?.kind === 'interest');
        assert.ok(request, 'Basil should wake only for Amber\'s typed interest');
        assert.equal(request.actorSeatId, actorSeatId);
        assert.deepEqual(request.intent, {
          kind: 'interest', wants: ['brick'], offers: ['wool'], to: partnerSeatId, replyToId: null
        });
        assert.equal(Object.hasOwn(request, 'message'), false);
        assert.equal(Object.hasOwn(request, 'playerName'), false);
        timeline.push('basil-thinking-before-offer');
        await delay(100, undefined, {signal});
        timeline.push('basil-offers');
        return {memory: 'basil', action: {
          type: 'tradeOffer', payload: {to: actorSeatId, give: {brick: 1}, get: {wool: 1}}
        }};
      }

      throw new Error('Idle AI gameplay model must not run');
    }
  };
}

test('four HTTP runners negotiate a useful trade, settle it, and then stay bounded', {timeout: 15_000}, async () => {
  const service = new RoomService();
  const hostKey = 'negotiation-integration-host-key';
  const server = createAppServer({service, hostKey});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = new AbortController();

  try {
    const created = await createRoom(url, hostKey);
    assert.equal(created.success, true);
    const host = new GameClient({server: url, code: created.code, token: created.token});
    const lobby = await host.observe();
    const clients = [];
    const sessions = [];
    for (let index = 0; index < lobby.slots.length; index++) {
      const client = new GameClient({server: url, code: created.code});
      const session = await client.join({
        name: ['Amber', 'Basil', 'Cedar', 'Dahlia'][index],
        role: 'ai',
        seatId: lobby.slots[index].id,
        provider: 'codex',
        model: 'deterministic-test-model'
      });
      const view = await client.observe();
      await client.act(view, 'ready');
      clients.push(client);
      sessions.push(session);
    }
    await host.act(await host.observe(), 'start');

    const room = service.rooms.get(created.code);
    const actorSeatId = sessions[0].seatId;
    const partnerSeatId = sessions[1].seatId;
    const actorIndex = room.game.players.findIndex(player => player.id === actorSeatId);
    const partnerIndex = room.game.players.findIndex(player => player.id === partnerSeatId);
    room.game.phase = 'playing';
    room.game.turnPhase = 'main';
    room.game.currentPlayerIndex = actorIndex;
    room.game.hasRolledThisTurn = true;
    room.game.freeRoads = 0;
    room.game.yearOfPlentyPicks = 0;
    room.trade = null;
    room.paused = false;
    for (const player of room.game.players) player.resources = emptyResources();
    room.game.players[actorIndex].resources = emptyResources({lumber: 1, wool: 3, grain: 1});
    room.game.players[partnerIndex].resources = emptyResources({brick: 2});
    const expansionVertex = installExpansionRoute(room, actorSeatId);
    syncNegotiationTurn(room);
    room.revision++;
    service.legalCache.delete(created.code);

    const counters = {
      gameplay: Object.fromEntries(sessions.map(session => [session.seatId, 0])),
      reader: 0,
      speaker: 0
    };
    const timeline = [];
    let realTradeId = null;
    let confirmed = false;
    for (const client of clients) {
      const act = client.act.bind(client);
      client.act = async (view, type, payload, requestId) => {
        const response = await act(view, type, payload, requestId);
        if (type === 'tradeOffer') {
          realTradeId = service.rooms.get(created.code).trade?.id || null;
          timeline.push('server-recorded-offer');
        } else if (type === 'tradeAccept') {
          timeline.push('server-recorded-accept');
        } else if (type === 'tradeConfirm') {
          confirmed = true;
          timeline.push('server-recorded-confirm');
          stop.abort();
        }
        return response;
      };
    }

    const runs = clients.map((client, index) => runPlayer(
      client,
      fakeConnector({
        seatId: sessions[index].seatId,
        actorSeatId,
        partnerSeatId,
        counters,
        timeline
      }),
      {
        signal: stop.signal,
        pollMs: 25,
        heartbeatMs: 50,
        chatBatchMs: 0,
        negotiationGraceMs: 25,
        decisionTimeoutMs: 1_000
      }
    ));
    const results = await Promise.allSettled(runs);
    const unexpectedFailures = results.filter(result => result.status === 'rejected' && result.reason?.name !== 'AbortError');
    assert.deepEqual(unexpectedFailures.map(result => result.reason?.message), []);

    assert.equal(confirmed, true);
    assert.ok(realTradeId);
    assert.deepEqual(timeline, [
      'amber-proposes',
      'basil-thinking-before-offer',
      'basil-offers',
      'server-recorded-offer',
      'amber-accepts',
      'server-recorded-accept',
      'basil-thinking-before-confirm',
      'basil-confirms',
      'server-recorded-confirm'
    ]);
    assert.equal(timeline.includes('amber-unexpected-end-turn'), false);
    assert.equal(counters.gameplay[actorSeatId], 2);
    assert.equal(counters.gameplay[partnerSeatId], 2);
    assert.equal(counters.gameplay[sessions[2].seatId], 0);
    assert.equal(counters.gameplay[sessions[3].seatId], 0);
    assert.equal(counters.reader, 0);
    assert.equal(counters.speaker, 0);

    const settled = service.rooms.get(created.code);
    const amber = settled.game.players.find(player => player.id === actorSeatId);
    const basil = settled.game.players.find(player => player.id === partnerSeatId);
    assert.deepEqual(amber.resources, emptyResources({brick: 1, lumber: 1, wool: 2, grain: 1}));
    assert.deepEqual(basil.resources, emptyResources({brick: 1, wool: 1}));
    assert.equal(settled.trade, null);
    assert.equal(legalActions(settled.game, actorSeatId)
      .some(action => action.type === 'placeSettlement' && action.payload.vertexKey === expansionVertex), true);

    const publicView = await host.observe();
    const negotiationMessage = publicView.chat.find(message => message.negotiation?.intent?.kind === 'interest');
    assert.ok(negotiationMessage);
    assert.equal(negotiationMessage.authorRole, 'ai');
    assert.equal(negotiationMessage.message, 'Amber is looking for brick and can offer wool to Basil.');
    assert.equal(JSON.stringify(negotiationMessage).includes('amber'), false);

    const relevantEvents = service.eventsFor(settled.recordingId)
      .filter(event => ['aiNegotiation', 'tradeOffer', 'tradeAccept', 'tradeConfirm'].includes(event.type));
    assert.deepEqual(relevantEvents.map(event => event.type), [
      'aiNegotiation', 'tradeOffer', 'tradeAccept', 'tradeConfirm'
    ]);
    const [negotiationEvent, offerEvent, acceptEvent, confirmEvent] = relevantEvents;
    assert.equal(negotiationEvent.actorSeatId, actorSeatId);
    assert.equal(negotiationEvent.summary, negotiationMessage.message);
    assert.equal(negotiationEvent.payload, undefined);
    assert.equal(offerEvent.actorSeatId, partnerSeatId);
    assert.deepEqual(offerEvent.payload, {to: actorSeatId, give: {brick: 1}, get: {wool: 1}});
    assert.equal(acceptEvent.actorSeatId, actorSeatId);
    assert.deepEqual(acceptEvent.payload, {tradeId: realTradeId});
    assert.equal(confirmEvent.actorSeatId, partnerSeatId);
    assert.deepEqual(confirmEvent.payload, {tradeId: realTradeId});
  } finally {
    stop.abort();
    await new Promise(resolve => server.close(resolve));
  }
});
