import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from './roomService.js';
import { syncNegotiationTurn } from './negotiation.js';

let serial = 0;
const requestId = () => `speech-${++serial}`;
class MemoryStore {
  constructor() { this.saved = []; this.fail = false; }
  load() { return structuredClone(this.saved); }
  save(room) {
    if (this.fail) { const error = Error('private-storage-detail'); error.code = 'SQLITE_FULL'; throw error; }
    const index = this.saved.findIndex(value => value.code === room.code);
    if (index < 0) this.saved.push(structuredClone(room));
    else this.saved[index] = structuredClone(room);
  }
}

function act(f, actor, type, payload = {}, extra = {}) {
  const view = f.service.observe(f.code, actor.token);
  return f.service.command(f.code, actor.token, { requestId: requestId(), revision: view.revision,
    generation: view.generation, ...(actor.role === 'ai' ? { controlEpoch: view.controlEpoch, ...(actor.runId ? { runId: actor.runId } : {}) } : {}),
    type, payload, ...extra });
}

function fixture({ lease = false } = {}) {
  const clock = { value: 10_000 }, store = new MemoryStore();
  const service = new RoomService({ store, now: () => clock.value });
  const host = service.create({ name: 'Speech test', seatCount: 3,
    seats: Array.from({ length: 3 }, () => ({ kind: 'ai', provider: 'codex', model: 'test-model' })) });
  assert.equal(host.success, true);
  const f = { service, store, clock, host, code: host.code };
  const joined = service.roomFor(f.code).slots.map((slot, index) => {
    const actor = service.join(f.code, { name: `Bot ${index + 1}`, role: 'ai', seatId: slot.id, provider: 'codex', model: 'test-model' });
    assert.equal(actor.success, true);
    assert.equal(act(f, actor, 'ready').success, true);
    return actor;
  });
  assert.equal(act(f, host, 'start').success, true);
  const room = service.roomFor(f.code);
  room.game.phase = 'playing'; room.game.turnPhase = 'main'; room.game.hasRolledThisTurn = true;
  room.game.freeRoads = 0; room.game.yearOfPlentyPicks = 0; room.game.currentPlayerIndex = 0;
  for (const player of room.game.players) player.resources = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
  room.paused = false; syncNegotiationTurn(room); service.persist(room);
  f.actors = room.game.players.map(player => joined.find(actor => actor.seatId === player.id));
  if (lease) f.actors.forEach((actor, index) => {
    actor.runId = `speech-runner-${index}`;
    assert.equal(service.aiLease(f.code, actor.token, { runId: actor.runId, controlEpoch: actor.controlEpoch }).success, true);
  });
  return f;
}

function offer(f, actor = f.actors[0], to = f.actors[1], give = { brick: 1 }, get = { wool: 1 }) {
  const result = act(f, actor, 'tradeOffer', { to: to.seatId, give, get });
  assert.equal(result.success, true, result.error);
  assert.equal(typeof result.tradeId, 'string');
  return result;
}

function speech(f, actor, tradeId, extra = {}) {
  const view = f.service.observe(f.code, actor.token);
  return { requestId: requestId(), generation: view.generation, controlEpoch: view.controlEpoch,
    ...(actor.runId ? { runId: actor.runId } : {}), tradeId, message: "I've offered one brick for one wool.", ...extra };
}
const publish = (f, actor, body) => f.service.aiChatReply(f.code, actor.token, body);

function interest(f, actor = f.actors[0], extra = {}) {
  const view = f.service.observe(f.code, actor.token);
  return { requestId: requestId(), revision: view.revision, generation: view.generation,
    controlEpoch: view.controlEpoch, runId: actor.runId,
    intent: { kind: 'interest', wants: ['wool'], offers: ['brick'], to: null, replyToId: null }, ...extra };
}

test('approved interest text is atomic with its typed record, while absent/null messages use first person', () => {
  for (const message of [undefined, null, 'I could use wool. Anyone want brick?']) {
    const f = fixture({ lease: true }), [actor, other] = f.actors;
    const body = interest(f, actor, message === undefined ? {} : { message });
    const first = f.service.aiNegotiate(f.code, actor.token, body);
    assert.equal(first.success, true, first.error);
    const chat = f.service.observe(f.code, f.host.token).chat;
    assert.equal(chat.length, 1);
    assert.equal(chat[0].message, message ?? "I'm looking for wool and can offer brick.");
    assert.equal(f.service.eventsFor(f.service.roomFor(f.code).recordingId).at(-1).summary,chat[0].message);
    assert.deepEqual(chat[0].negotiation.intent, body.intent);
    assert.equal(chat[0].id, first.negotiation.id);
    assert.equal(JSON.stringify(first).includes('message'), false);
    const view = f.service.observe(f.code, other.token);
    const read = f.service.aiChatRead(f.code, other.token, { runId: other.runId, controlEpoch: view.controlEpoch, afterSequence: 0 });
    assert.deepEqual(read.messages, []);
    assert.equal(read.negotiations.length, 1);
    assert.equal(Object.hasOwn(read.negotiations[0], 'message'), false);
    assert.deepEqual(f.service.aiNegotiate(f.code, actor.token, body), first);
    assert.equal(f.service.aiNegotiate(f.code, actor.token, { ...body, message: 'Different prose.' }).statusCode, 409);
    assert.equal(f.service.aiNegotiate(f.code, actor.token, interest(f, actor)).statusCode, 429);
  }
});

test('malformed interest messages and invalid intents publish nothing and never echo private details', () => {
  const f = fixture({ lease: true }), actor = f.actors[0];
  const before = structuredClone(f.service.roomFor(f.code));
  for (const message of ['', '   ', { message: 'PRIVATE_CANARY' }, 'PRIVATE_CANARY'.repeat(100)]) {
    const result = f.service.aiNegotiate(f.code, actor.token, interest(f, actor, { message }));
    assert.equal(result.statusCode, 400);
    assert.equal(JSON.stringify(result).includes('PRIVATE_CANARY'), false);
    assert.deepEqual(f.service.roomFor(f.code), before);
  }
  assert.equal(f.service.aiNegotiate(f.code, actor.token, interest(f, actor, {
    message: 'A valid sentence.', intent: { kind: 'interest', wants: ['brick'], offers: ['brick'], to: null, replyToId: null },
  })).success, false);
  assert.deepEqual(f.service.roomFor(f.code), before);
  const recording = structuredClone(f.service.recordingFor(before.recordingId));
  f.store.fail = true;
  const failed = f.service.aiNegotiate(f.code, actor.token, interest(f, actor, { message: 'PRIVATE_CANARY custom public sentence.' }));
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.stringify(failed).includes('PRIVATE_CANARY'), false);
  assert.equal(JSON.stringify(failed).includes('private-storage-detail'), false);
  assert.deepEqual(f.service.roomFor(f.code), before);
  assert.deepEqual(f.service.recordingFor(before.recordingId), recording);
});

test('offer and counter receipts bind speech to their exact newly created public ID', () => {
  const f = fixture(), [a, b] = f.actors;
  const initial = offer(f, a, b);
  assert.deepEqual(Object.keys(initial).sort(), ['revision', 'success', 'tradeId']);
  assert.equal(f.service.roomFor(f.code).trades[0].id, initial.tradeId);
  const counter = act(f, b, 'tradeCounter', { tradeId: initial.tradeId, to: a.seatId, give: { wool: 2 }, get: { brick: 1 } });
  assert.equal(counter.success, true, counter.error);
  assert.notEqual(counter.tradeId, initial.tradeId);
  const real = f.service.roomFor(f.code).trades[0];
  assert.equal(real.id, counter.tradeId);
  assert.equal(real.counterOf, initial.tradeId);
  assert.equal(publish(f, a, speech(f, a, initial.tradeId)).statusCode, 409);
  const spoken = publish(f, b, speech(f, b, counter.tradeId, { message: "I'd give you two wool for one brick." }));
  assert.equal(spoken.success, true);
  const row = f.service.observe(f.code, f.host.token).chat.at(-1);
  assert.equal(row.tradeId, counter.tradeId);
  assert.equal(row.playerId, b.seatId);
  assert.equal(row.message, "I'd give you two wool for one brick.");
  assert.deepEqual(f.service.eventsFor(f.service.roomFor(f.code).recordingId).at(-1).payload,
    {tradeId:counter.tradeId,message:row.message});
  assert.equal(Object.hasOwn(row, 'negotiation'), false);
  assert.equal(Object.hasOwn(row, 'replyToSequence'), false);
  assert.equal(act(f, a, 'tradeAccept', { tradeId: counter.tradeId }).tradeId, undefined);
});

test('trade speech authenticates the seat, validates generation/epoch and target XOR, and cannot override author', () => {
  const f = fixture(), [a, b] = f.actors, offered = offer(f, a, b);
  const body = speech(f, a, offered.tradeId);
  const before = structuredClone(f.service.roomFor(f.code));
  assert.equal(f.service.aiChatReply(f.code, 'forged', body).statusCode, 401);
  assert.equal(f.service.aiChatReply(f.code, a.seatId, body).statusCode, 401);
  assert.equal(f.service.aiChatReply(f.code, f.host.token, body).statusCode, 403);
  assert.equal(publish(f, b, speech(f, b, offered.tradeId)).statusCode, 409);
  const invalid = [
    [{ ...body, generation: body.generation + 1 }, 409],
    [{ ...body, generation: undefined }, 400],
    [{ ...body, controlEpoch: body.controlEpoch + 1 }, 409],
    [{ ...body, controlEpoch: undefined }, 409],
    [{ ...body, replyToSequence: 1 }, 400],
    [{ ...body, tradeId: '' }, 400],
    [{ ...body, tradeId: 1 }, 400],
    [{ ...body, tradeId: undefined }, 400],
    [{ ...body, tradeId: 'unavailable-trade' }, 409],
    [{ ...body, message: 'x'.repeat(501) }, 400],
  ];
  for (const [request, status] of invalid) {
    assert.equal(publish(f, a, request).statusCode, status);
    assert.deepEqual(f.service.roomFor(f.code), before);
  }
  assert.equal(publish(f, a, { requestId: requestId(), message: 'No target.', generation: a.generation, controlEpoch: a.controlEpoch }).statusCode, 400);
  assert.equal(publish(f, a, null).statusCode, 400);
  assert.equal(publish(f, a, { ...body, playerId: b.seatId, playerName: 'Forged' }).success, true);
  assert.equal(f.service.observe(f.code, f.host.token).chat.at(-1).playerId, a.seatId);
});

test('direct clients need no lease, but a live managed runner still fences trade publication', () => {
  const direct = fixture(), [a, b] = direct.actors, offered = offer(direct, a, b);
  assert.equal(publish(direct, a, speech(direct, a, offered.tradeId)).success, true);
  const managed = fixture({ lease: true }), [bot, other] = managed.actors, trade = offer(managed, bot, other);
  const body = speech(managed, bot, trade.tradeId);
  assert.equal(publish(managed, bot, { ...body, runId: undefined }).statusCode, 409);
  assert.equal(publish(managed, bot, { ...body, runId: 'another-runner' }).statusCode, 409);
  assert.equal(publish(managed, bot, body).success, true);
});

test('accepted publication retries precede freshness and terminal checks; a new request cannot repeat a trade', () => {
  const f = fixture(), [a, b] = f.actors, trade = offer(f, a, b), body = speech(f, a, trade.tradeId);
  assert.deepEqual(f.service.observe(f.code,a.token).negotiation.offerAnnouncementIds,[trade.tradeId]);
  const first = publish(f, a, body);
  assert.equal(first.success, true);
  f.clock.value += 5000;
  assert.deepEqual(f.service.observe(f.code,a.token).negotiation.offerAnnouncementIds,[]);
  const beforeDuplicate = structuredClone(f.service.roomFor(f.code));
  assert.equal(publish(f, a, { ...body, requestId: requestId() }).statusCode, 409);
  assert.equal(publish(f, a, { ...body, message: 'Changed prose.' }).statusCode, 409);
  assert.deepEqual(f.service.roomFor(f.code), beforeDuplicate);
  assert.equal(act(f, a, 'tradeCancel', { tradeId: trade.tradeId }).success, true);
  assert.equal(act(f, f.host, 'endGame').success, true);
  const terminal = structuredClone(f.service.roomFor(f.code));
  assert.deepEqual(publish(f, a, body), first);
  assert.deepEqual(f.service.roomFor(f.code), terminal);
  assert.equal(publish(f, a, { ...body, requestId: requestId() }).statusCode, 410);
});

test('accepted, cancelled, rejected, replaced, disabled and paused offers cannot be announced', () => {
  for (const change of ['accept', 'cancel', 'reject', 'counter', 'pause', 'disable', 'endTurn']) {
    const f = fixture(), [a, b] = f.actors, trade = offer(f, a, b), body = speech(f, a, trade.tradeId);
    if (change === 'accept') assert.equal(act(f, b, 'tradeAccept', { tradeId: trade.tradeId }).success, true);
    if (change === 'cancel') assert.equal(act(f, a, 'tradeCancel', { tradeId: trade.tradeId }).success, true);
    if (change === 'reject') assert.equal(act(f, b, 'tradeReject', { tradeId: trade.tradeId }).success, true);
    if (change === 'counter') assert.equal(act(f, b, 'tradeCounter', { tradeId: trade.tradeId, to: a.seatId, give: { wool: 2 }, get: { brick: 1 } }).success, true);
    if (change === 'pause') assert.equal(act(f, f.host, 'pause').success, true);
    if (change === 'disable') assert.equal(act(f, f.host, 'aiSetChat', { seatId: a.seatId, enabled: false }).success, true);
    if (change === 'endTurn') assert.equal(act(f, a, 'endTurn').success, true);
    const before = structuredClone(f.service.roomFor(f.code));
    assert.equal(publish(f, a, body).statusCode, 409, change);
    assert.deepEqual(f.service.roomFor(f.code), before);
  }
  for (const phase of ['roll', 'discard', 'robber', 'specialBuild']) {
    const f = fixture(), [a, b] = f.actors, trade = offer(f, a, b);
    f.service.roomFor(f.code).game.turnPhase = phase;
    assert.equal(publish(f, a, speech(f, a, trade.tradeId)).statusCode, 409);
  }
});

test('publication cooldown is shared by human replies, typed interests, and offer speech', () => {
  const f = fixture({ lease: true }), [a, b] = f.actors;
  assert.equal(act(f, f.host, 'chat', { message: 'Would you trade?' }).success, true);
  const humanSequence = f.service.observe(f.code, f.host.token).chat.at(-1).sequence;
  const human = { requestId: requestId(), controlEpoch: a.controlEpoch, runId: a.runId, replyToSequence: humanSequence, message: "I'll check." };
  assert.equal(publish(f, a, human).success, true);
  assert.equal(f.service.aiNegotiate(f.code, a.token, interest(f, a)).statusCode, 429);
  const trade = offer(f, a, b);
  assert.equal(publish(f, a, speech(f, a, trade.tradeId)).statusCode, 429);
  f.clock.value += 5000;
  assert.equal(f.service.aiNegotiate(f.code, a.token, interest(f, a)).success, true);
  assert.equal(publish(f, a, speech(f, a, trade.tradeId)).statusCode, 429);
  f.clock.value += 5000;
  assert.equal(publish(f, a, speech(f, a, trade.tradeId)).success, true);
  assert.equal(act(f, f.host, 'chat', { message: 'Another question?' }).success, true);
  const laterSequence = f.service.observe(f.code, f.host.token).chat.at(-1).sequence;
  assert.equal(publish(f, a, { ...human, requestId: requestId(), replyToSequence: laterSequence }).statusCode, 429);
  assert.equal(f.service.observe(f.code, a.token).negotiation.canReply, false);
});

test('announcement state caps at two IDs per seat and resets on a real turn transition', () => {
  const f = fixture(), [a, b] = f.actors;
  const first = offer(f, a, b), second = offer(f, a, b, { brick: 2 }, { wool: 1 });
  assert.equal(publish(f, a, speech(f, a, first.tradeId)).success, true);
  f.clock.value += 5000;
  assert.equal(publish(f, a, speech(f, a, second.tradeId)).success, true);
  // A legacy persisted room may contain more offers than the current command cap.
  const room = f.service.roomFor(f.code);
  room.trades.push({ id: 'legacy-third-offer', from: a.seatId, to: b.seatId, give: { ore: 1 }, get: { grain: 1 }, status: 'offered', counterOf: null });
  f.clock.value += 5000;
  assert.equal(publish(f, a, speech(f, a, 'legacy-third-offer')).statusCode, 429);
  assert.deepEqual(f.service.roomFor(f.code).negotiationState.announcedTradeIdsBySeat[a.seatId], [first.tradeId, second.tradeId]);
  assert.equal(act(f, a, 'endTurn').success, true);
  assert.deepEqual(f.service.roomFor(f.code).negotiationState.announcedTradeIdsBySeat, {});
  const next = f.service.roomFor(f.code);
  next.game.turnPhase = 'main'; next.game.hasRolledThisTurn = true;
  const active = f.actors.find(actor => actor.seatId === next.game.players[next.game.currentPlayerIndex].id);
  const recipient = f.actors.find(actor => actor.seatId !== active.seatId);
  const newTrade = offer(f, active, recipient);
  assert.equal(publish(f, active, speech(f, active, newTrade.tradeId)).success, true);
});

test('persisted announcement gates survive recovery without leaking internal IDs into observations', () => {
  const f = fixture(), [a, b] = f.actors, trade = offer(f, a, b), body = speech(f, a, trade.tradeId);
  const first = publish(f, a, body);
  assert.equal(first.success, true);
  f.service = new RoomService({ store: f.store, now: () => f.clock.value });
  assert.equal(f.service.roomFor(f.code).paused, true);
  assert.deepEqual(publish(f, a, body), first);
  assert.equal(act(f, f.host, 'resume').success, true);
  f.clock.value += 5000;
  assert.equal(publish(f, a, speech(f, a, trade.tradeId)).statusCode, 409);
  assert.deepEqual(f.service.roomFor(f.code).negotiationState.announcedTradeIdsBySeat[a.seatId], [trade.tradeId]);
  for (const observer of [a, b, f.host]) {
    const view = f.service.observe(f.code, observer.token);
    assert.equal(JSON.stringify(view).includes('announcedTradeIdsBySeat'), false);
  }
});

test('legacy typed offer and free prose share the same duplicate-announcement gate', () => {
  for (const typedFirst of [true, false]) {
    const f = fixture({ lease: true }), [a, b] = f.actors, trade = offer(f, a, b);
    const typed = () => f.service.aiNegotiate(f.code, a.token, interest(f, a, {
      intent: { kind: 'offer', tradeId: trade.tradeId, replyToId: null },
    }));
    if (typedFirst) assert.equal(typed().success, true);
    else assert.equal(publish(f, a, speech(f, a, trade.tradeId)).success, true);
    f.clock.value += 5000;
    assert.equal((typedFirst ? publish(f, a, speech(f, a, trade.tradeId)) : typed()).statusCode, 409);
    assert.equal(f.service.observe(f.code, f.host.token).chat.length, 1);
    assert.deepEqual(f.service.roomFor(f.code).negotiationState.announcedTradeIdsBySeat[a.seatId], [trade.tradeId]);
  }
});

test('trade prose never enters the AI reader, typed negotiation feed or gameplay observation', () => {
  const f = fixture(), [a, b] = f.actors, trade = offer(f, a, b), canary = 'RAW_AI_PROSE_ATTACK_CANARY';
  assert.equal(publish(f, a, speech(f, a, trade.tradeId, { message: canary })).success, true);
  const body = f.service.observe(f.code, b.token);
  const read = f.service.aiChatRead(f.code, b.token, { controlEpoch: body.controlEpoch, afterSequence: 0 });
  assert.deepEqual(read.messages, []);
  assert.deepEqual(read.negotiations, []);
  assert.equal(JSON.stringify(body).includes(canary), false);
  assert.equal(JSON.stringify(f.service.agentObserve(f.code, b.token)).includes(canary), false);
  assert.equal(body.trades.find(trade => trade.id === body.trade.id).status, 'offered');
  assert.equal(f.service.observe(f.code, f.host.token).chat.at(-1).message, canary);
});
