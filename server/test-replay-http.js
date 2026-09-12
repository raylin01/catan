import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {RoomService} from './roomService.js';
import {createAppServer} from './http.js';

const HOST_KEY = 'replay-http-operator-key-for-tests';

async function withServer(run) {
  let now = 1_800_000_000_000;
  const service = new RoomService({now: () => now});
  const server = createAppServer({service, hostKey: HOST_KEY});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let request = 0;
  const issue = (room, actor, type, payload = {}) => {
    now += 3_000;
    const result = service.command(room.code, actor.token, {
      requestId: `replay-http-${++request}`, revision: service.rooms.get(room.code).revision,
      generation: actor.generation, type, payload
    });
    assert.equal(result.success, true, `${type}: ${result.error}`);
    return result;
  };
  try { await run({service, url, issue}); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function startedMatch(service, issue) {
  const room = service.create({name: 'Replay HTTP test', title: 'An unfinished test', seatCount: 3});
  assert.equal(room.success, true);
  const players = service.rooms.get(room.code).slots.map((slot, index) => {
    const player = service.join(room.code, {role: 'human', seatId: slot.id, name: `Player ${index + 1}`});
    assert.equal(player.success, true);
    issue(room, player, 'ready');
    return player;
  });
  issue(room, room, 'start');
  for (let index = 0; index < 6; index++) {
    const actor = players.find(player => service.observe(room.code, player.token).legalActions.some(action => action.type === 'placeSettlement'));
    assert.ok(actor);
    for (const type of ['placeSettlement', 'placeRoad', 'advanceSetup']) {
      const action = service.observe(room.code, actor.token).legalActions.find(candidate => candidate.type === type);
      assert.ok(action, type);
      issue(room, actor, type, action.payload);
    }
  }
  return {room, players};
}

test('HTTP replay routes protect unfinished perspectives, exports and the unlisted directory', async () => {
  await withServer(async ({service, url, issue}) => {
    const {room, players} = startedMatch(service, issue);
    assert.match(room.replayId, /^[A-Za-z0-9_-]{40,}$/);
    assert.notEqual(room.replayId, room.code);
    const base = `${url}/api/replays/${room.replayId}`;
    const publicResponse = await fetch(base);
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    assert.match(publicResponse.headers.get('x-robots-tag'), /noindex/);
    const publicView = await publicResponse.json();
    assert.ok(publicView.state.gameState.players.every(player => typeof player.resources === 'number'));
    assert.ok(!publicView.perspectives.some(perspective => perspective.id === 'omniscient'));
    assert.equal((await fetch(`${url}/api/replays`)).status, 403);
    assert.equal((await fetch(`${url}/api/replays/${room.code}`)).status, 404);
    assert.equal((await fetch(base, {method: 'DELETE'})).status, 403);
    assert.equal((await fetch(base, {method: 'DELETE', headers: {'X-Host-Key': HOST_KEY}})).status, 409);

    for (const suffix of ['', '/events', '/metrics', '/export']) {
      assert.equal((await fetch(`${base}${suffix}?perspective=omniscient`)).status, 403, suffix);
      assert.equal((await fetch(`${base}${suffix}?perspective=${players[1].seatId}`, {
        headers: {Authorization: `Bearer ${players[0].token}`}
      })).status, 403, suffix);
    }
    const own = await fetch(`${base}?perspective=${players[0].seatId}`, {
      headers: {Authorization: `Bearer ${players[0].token}`}
    }).then(response => response.json());
    assert.equal(typeof own.state.gameState.players.find(player => player.id === players[0].seatId).resources, 'object');
    assert.ok(own.state.gameState.players.filter(player => player.id !== players[0].seatId).every(player => typeof player.resources === 'number'));

    const listed = await fetch(`${url}/api/replays?limit=1&offset=0`, {headers: {'X-Host-Key': HOST_KEY}}).then(response => response.json());
    assert.equal(listed.total, 1);
    assert.equal(listed.recordings[0].id, room.replayId);
    for (const query of ['at=-1', 'at=nope', 'at=9007199254740992', 'at=1&at=2', 'perspective[bad]=omniscient']) {
      assert.equal((await fetch(`${base}?${query}`)).status, 400, query);
    }
    const exportText = await fetch(`${base}/export`).then(response => response.text());
    assert.ok(exportText.endsWith('\n'));
    const records = exportText.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(records.length > 2);
    for (const secret of [room.token, ...players.map(player => player.token)]) {
      assert.equal(exportText.includes(secret), false);
    }
    assert.equal(exportText.includes('tokenHash'), false);
    assert.equal(exportText.includes('runId'), false);
    const metrics = await fetch(`${base}/metrics`).then(response => response.json());
    assert.ok(metrics.points.length > 0);
    assert.ok(metrics.points.every(point => point.players.every(player => !Object.hasOwn(player, 'totalVP'))));
  });
});

test('terminal recordings offer all perspectives and compressed parseable exports without changing live views', async () => {
  await withServer(async ({service, url, issue}) => {
    const {room, players} = startedMatch(service, issue);
    issue(room, players[0], 'chat', {message: 'I am looking for brick.'});
    issue(room, room, 'endGame');
    const base = `${url}/api/replays/${room.replayId}`;
    const omniscient = await fetch(`${base}?perspective=omniscient`).then(response => response.json());
    assert.equal(omniscient.recording.status, 'ended');
    assert.equal(omniscient.recording.winnerId, null);
    assert.ok(omniscient.state.gameState.players.every(player => typeof player.resources === 'object'));
    assert.equal(omniscient.state.chat.at(-1).message, 'I am looking for brick.');
    const seat = await fetch(`${base}?perspective=${players[1].seatId}`).then(response => response.json());
    assert.equal(typeof seat.state.gameState.players.find(player => player.id === players[1].seatId).resources, 'object');
    assert.ok(seat.state.gameState.players.filter(player => player.id !== players[1].seatId).every(player => typeof player.resources === 'number'));
    assert.ok(service.observe(room.code, room.token).gameState.players.every(player => typeof player.resources === 'number'));
    const plain = await fetch(`${base}/export?perspective=omniscient`).then(response => response.text());
    const zipped = await fetch(`${base}/export?perspective=omniscient&gzip=1`);
    assert.equal(zipped.headers.get('content-type'), 'application/gzip');
    assert.match(zipped.headers.get('content-disposition'), /jsonl\.gz/);
    const decoded = gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString('utf8');
    assert.equal(decoded, plain);
    assert.ok(decoded.trim().split('\n').every(line => JSON.parse(line)));
    const metrics = await fetch(`${base}/metrics?perspective=omniscient`).then(response => response.json());
    assert.ok(metrics.points.at(-1).players.every(player => typeof player.totalVP === 'number'));
    const removed = await fetch(base, {method: 'DELETE', headers: {'X-Host-Key': HOST_KEY}});
    assert.equal(removed.status, 200);
    assert.equal((await fetch(base)).status, 404);
    const listed = await fetch(`${url}/api/replays`, {headers: {'X-Host-Key': HOST_KEY}}).then(response => response.json());
    assert.equal(listed.total, 0);
  });
});

test('public bank history cannot reveal the resource composition of a private discard', async () => {
  await withServer(async ({service, url, issue}) => {
    const {room, players} = startedMatch(service, issue);
    const fixture = service.rooms.get(room.code);
    const index = fixture.game.players.findIndex(player => player.id === players[1].seatId);
    const discarder = fixture.game.players[index];
    // Prepare a legal seven-discard decision without relying on random dice.
    for (const resource of Object.keys(discarder.resources)) {
      fixture.game.bank[resource] += discarder.resources[resource];
      discarder.resources[resource] = resource === 'brick' ? 8 : 0;
      fixture.game.bank[resource] -= discarder.resources[resource];
    }
    fixture.game.turnPhase = 'discard';
    fixture.game.discardingPlayers = [{playerIndex: index, cardsToDiscard: 4}];
    service.persist(fixture, {type: 'testFixture', summary: 'Prepared discard decision'});
    const beforeSeq = service.recordingFor(room.replayId).lastSeq;
    const base = `${url}/api/replays/${room.replayId}`;
    const before = await fetch(base).then(response => response.json());
    issue(room, players[1], 'discardCards', {resources: {brick: 4}});
    const after = await fetch(base).then(response => response.json());
    assert.equal(Object.hasOwn(before.state.gameState, 'bank'), false);
    assert.equal(Object.hasOwn(after.state.gameState, 'bank'), false);
    assert.deepEqual(before.state.gameState.bankAvailable, after.state.gameState.bankAvailable);
    assert.equal(after.state.gameState.bankTotal - before.state.gameState.bankTotal, 4);
    const live = service.observe(room.code, players[0].token).gameState;
    assert.equal(Object.hasOwn(live, 'bank'), false, 'live and replay use the same disclosure policy');
    const events = await fetch(`${base}/events?after=${beforeSeq}`).then(response => response.json());
    assert.deepEqual(events.events.at(-1).payload, {count: 4});
    const publicFile = await fetch(`${base}/export`).then(response => response.text());
    assert.equal(publicFile.includes('"bank":'), false);
    assert.equal(publicFile.includes('"path":"/gameState/bank/'), false);
    issue(room, room, 'endGame');
    const full = service.replay(room.replayId, {perspective: 'omniscient'});
    assert.equal(full.state.gameState.bank.brick, fixture.game.bank.brick + 4);
  });
});

test('journal payloads omit ignored nested model data from stored and exported facts', async () => {
  await withServer(async ({service, issue}) => {
    const room = service.create({name: 'Payload normalization'});
    const seatId = service.rooms.get(room.code).slots[0].id;
    const sentinel = 'PRIVATE_MODEL_PROMPT_MUST_NOT_BE_ARCHIVED';
    issue(room, room, 'configureSeat', {seatId, kind: 'human', model: {privatePrompt: sentinel}});
    const event = service.replayEvents(room.replayId).events.at(-1);
    assert.deepEqual(event.payload, {seatId, kind: 'human'});
    assert.equal(service.replayExport(room.replayId).lines.join('').includes(sentinel), false);
    assert.equal(JSON.stringify(service.recordingFor(room.replayId)).includes(sentinel), false);
  });
});
