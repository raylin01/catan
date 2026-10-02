import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlayer } from './runner.js';
import { projectTradeSpeech } from './trade-speech.js';

const seatId = 'alice', otherId = 'bob';
const interest = { kind: 'interest', wants: ['brick'], offers: ['wool'], to: otherId, replyToId: null };
const offer = { id: 'new-offer', from: seatId, to: otherId, status: 'offered', give: { wool: 1 }, get: { brick: 1 }, counterOf: null };
const proposal = { type: 'tradeInterest', sourceMessageId: 'human-message', authorSeatId: otherId, to: seatId, resources: ['brick'], direction: 'offer' };
function view(overrides = {}) {
  const source = {
    revision: 1, generation: 3, controlEpoch: 8, seatId, paused: false, closed: false,
    decision: { type: 'chooseAction' }, trades: [], legalActions: [],
    negotiation: { canInitiate: true, canReply: false, turnKey: 'turn-1', blockedTradeSeatIds: [], tradeOffersRemaining: 2 },
    gameState: { phase: 'playing', turnPhase: 'main', currentPlayerIndex: 0, playerTradingAllowed: true,
      players: [{ id: seatId, name: 'Alice', resources: { wool: 2, brick: 0 }, privateStrategy: 'CANARY_HAND' },
        { id: otherId, name: 'Bob', resources: 5 }], hiddenDeck: ['CANARY_DECK'] },
    slots: [{ id: seatId, ready: true, chatEnabled: true, chatModel: 'public-model', chatReasoning: 'high', ai: { paused: false } }, { id: otherId, ready: true }],
    ai: {}, token: 'CANARY_TOKEN', chat: [{ authorSeatId: otherId, message: 'CANARY_RAW_CHAT' }], memory: 'CANARY_VIEW_MEMORY',
  };
  return { ...source, ...overrides, gameState: { ...source.gameState, ...overrides.gameState } };
}
function harness({ initial = view(), result, speech = 'I can offer one wool for one brick.', speak, act, negotiate, replyChat } = {}) {
  const state = { view: structuredClone(initial), idle: !initial.decision, idleReads: 0, finishInObservations: 0, finishNext: false,
    decisions: [], speech: [], acts: [], negotiations: [], replies: [], saved: [], readerCalls: 0 };
  const controller = new AbortController();
  const client = {
    async observe() {
      if (state.finishNext) state.view.gameState.phase = 'finished';
      else if (state.finishInObservations > 0) {
        if (--state.finishInObservations === 0) state.finishNext = true;
      } else if (state.idle && ++state.idleReads >= 6) state.view.gameState.phase = 'finished';
      return structuredClone(state.view);
    },
    async act(source, type, payload) {
      state.acts.push({ source: structuredClone(source), type, payload: structuredClone(payload) });
      if (act) return act(state, type, payload);
      state.view.revision++; state.view.decision = null; state.idle = true;
      if (['tradeOffer', 'tradeCounter'].includes(type)) {
        const committed = { ...offer, ...(type === 'tradeCounter' ? { id: 'new-counter', counterOf: payload.tradeId } : {}), give: payload.give, get: payload.get };
        state.view.trades = [committed];
        return { success: true, tradeId: committed.id, privateResult: 'CANARY_PRIVATE_RECEIPT' };
      }
      state.view.trades = [];
      return { success: true };
    },
    async negotiate(payload) {
      state.negotiations.push(structuredClone(payload));
      if (negotiate) return negotiate(state, payload);
      state.view.revision++; state.view.decision = null; state.view.negotiation.canInitiate = false; state.idle = true;
      return { success: true };
    },
    async replyChat(payload) {
      state.replies.push(structuredClone(payload));
      if (replyChat) return replyChat(state, payload);
      state.finishNext = true;
      return { success: true };
    },
  };
  const connector = {
    id: 'test-public-speech', ready: async () => {},
    async decide(source, options) {
      state.decisions.push({ source: structuredClone(source), contextId: options.contextId });
      return { memory: 'CANARY_PRIVATE_MEMORY', contextId: 'gameplay-next', publicReply: 'acknowledge', ...result };
    },
    async speak(input, options) {
      state.speech.push({ input: structuredClone(input), model: options.model, reasoning: options.reasoning, contextId: options.contextId });
      if (speak) return speak(state, input, options, controller);
      options.onRuntime({ type: 'context', context: { percent: 17 } });
      return { contextId: 'trade-speaker-next', value: { message: speech } };
    },
    async readChat() { state.readerCalls++; throw Error('Unexpected reader inference'); },
  };
  const options = { signal: controller.signal, pollMs: 1, heartbeatMs: 100000, negotiationGraceMs: 0, decisionTimeoutMs: 500,
    model: 'gameplay-model', reasoning: 'max', memory: 'CANARY_PRIVATE_MEMORY', pendingProposals: [proposal], pendingReplySequence: 10,
    contexts: {
      gameplay: { key: JSON.stringify([connector.id, 'gameplay-model', 'max']), id: 'private-gameplay-context' },
      speaker: { key: JSON.stringify([connector.id, 'public-model', 'high']), id: 'legacy-human-speaker-context' },
      tradeSpeaker: { key: JSON.stringify([connector.id, 'public-model', 'high']), id: 'public-trade-context' },
    },
    save: async (memory, saved) => { state.saved.push({ memory, ...structuredClone(saved) }); },
  };
  return { state, client, connector, controller, options, run: overrides => runPlayer(client, connector, { ...options, ...overrides }) };
}
const offerDecision = { action: { type: 'tradeOffer', payload: { to: otherId, give: { wool: 1 }, get: { brick: 1 } } } };
const assertPublic = input => {
  assert.equal(JSON.stringify(input).includes('CANARY_'), false);
  for (const key of ['hand', 'memory', 'gameState', 'chat', 'revision', 'generation', 'controlEpoch', 'runId', 'token', 'negotiation', 'negotiations', 'confirmedOutcomes']) assert.equal(Object.hasOwn(input, key), false, key);
  assert.deepEqual(input.players, [{ id: seatId, name: 'Alice' }, { id: otherId, name: 'Bob' }]);
};

test('approved interest speech uses narrow public input and configured persistent public channel before one atomic intent', async () => {
  const h = harness({ result: { negotiation: interest }, speech: 'Bob, I’m looking for brick and can offer wool.' });
  await h.run();
  assert.equal(h.state.decisions.length, 1); assert.equal(h.state.speech.length, 1); assert.equal(h.state.negotiations.length, 1);
  const spoken = h.state.speech[0];
  assertPublic(spoken.input);
  assert.deepEqual(spoken.input, projectTradeSpeech(view(), { intent: interest }));
  assert.equal(spoken.input.purpose, 'interest');
  assert.equal(spoken.model, 'public-model'); assert.equal(spoken.reasoning, 'high'); assert.equal(spoken.contextId, 'public-trade-context');
  assert.equal(h.state.decisions[0].contextId, 'private-gameplay-context');
  assert.deepEqual(h.state.negotiations[0].intent, interest);
  assert.equal(h.state.negotiations[0].message, 'Bob, I’m looking for brick and can offer wool.');
  assert.equal(h.state.replies.length, 0, 'Interest message is part of the typed publication, with no second prose wakeup');
  const saved = h.state.saved.at(-1);
  assert.equal(saved.contexts.tradeSpeaker.id, 'trade-speaker-next');
  assert.equal(saved.contexts.tradeSpeaker.usage.percent, 17);
  assert.equal(saved.contexts.speaker.id, 'legacy-human-speaker-context');
  assert.deepEqual(saved.pendingProposals, []); assert.equal(saved.pendingReplySequence, 0);
});

test('successful counter speech uses the receipt’s new offer ID and exact terms, suppressing the old human acknowledgment', async () => {
  const incoming = { ...offer, id: 'old-incoming', from: otherId, to: seatId, give: { brick: 1 }, get: { wool: 1 } };
  const h = harness({ initial: view({ trades: [incoming] }), result: { action: { type: 'tradeCounter', payload: { tradeId: incoming.id, give: { wool: 1 }, get: { brick: 2 } } } },
    speech: 'I sent a counteroffer: one wool for two brick.' });
  await h.run();
  assert.equal(h.state.acts.length, 1); assert.equal(h.state.acts[0].payload.tradeId, 'old-incoming');
  assert.equal(h.state.speech.length, 1); assertPublic(h.state.speech[0].input);
  assert.equal(h.state.speech[0].input.purpose, 'counter');
  assert.deepEqual(h.state.speech[0].input.offer, { id: 'new-counter', from: seatId, to: otherId, give: { wool: 1 }, get: { brick: 2 }, counterOf: 'old-incoming' });
  assert.equal(h.state.replies.length, 1); assert.equal(h.state.replies[0].tradeId, 'new-counter');
  assert.equal(h.state.replies[0].generation, 3); assert.equal(h.state.replies[0].controlEpoch, 8);
  assert.equal(Object.hasOwn(h.state.replies[0], 'replyToSequence'), false);
  assert.equal(Object.hasOwn(h.state.replies[0], 'negotiation'), false);
  assert.equal(h.state.saved.at(-1).pendingReplySequence, 0);
});

test('null or failed optional interest speech preserves the approved typed intent and server renderer fallback', async () => {
  for (const failure of [false, true]) {
    const h = harness({ result: { negotiation: interest }, speech: null,
      ...(failure ? { speak: async () => { throw Error('CANARY_PROVIDER_FAILURE'); } } : {}) });
    await h.run();
    assert.equal(h.state.speech.length, 1); assert.equal(h.state.negotiations.length, 1);
    assert.deepEqual(h.state.negotiations[0].intent, interest);
    assert.equal(Object.hasOwn(h.state.negotiations[0], 'message'), false);
    assert.equal(h.state.replies.length, 0); assert.equal(h.state.acts.length, 0);
    assert.equal(h.state.decisions.length, 1, 'Optional failure does not ask gameplay or speech to repair the answer');
  }
});

test('null, failed and ambiguous offer speech leaves the real offer intact and never retries publication', async () => {
  for (const kind of ['null', 'model-error', 'publication-error']) {
    const h = harness({ result: offerDecision, speech: kind === 'null' ? null : 'I sent you an offer for brick.',
      ...(kind === 'model-error' ? { speak: async () => { throw Error('CANARY_PROVIDER_FAILURE'); } } : {}),
      ...(kind === 'publication-error' ? { replyChat: async state => { state.finishNext = true; throw Object.assign(Error('Uncertain publication'), { status: 500 }); } } : {}) });
    await h.run();
    assert.equal(h.state.acts.length, 1); assert.equal(h.state.view.trades[0].id, 'new-offer');
    assert.equal(h.state.view.trades[0].status, 'offered'); assert.equal(h.state.speech.length, 1);
    assert.equal(h.state.replies.length, kind === 'publication-error' ? 1 : 0);
    assert.equal(h.state.decisions.length, 1);
  }
});

test('fresh fences skip accepted, replaced, paused, chat-disabled, model-switched and revoked trade speech', async () => {
  const changes = [
    state => { state.view.trades[0].status = 'accepted'; },
    state => { state.view.trades[0].give = { wool: 2 }; },
    state => { state.view.paused = true; },
    state => { state.view.slots[0].chatEnabled = false; },
    state => { state.view.slots[0].chatModel = 'new-model'; },
    state => { state.view.controlEpoch++; },
    state => { state.view.generation++; },
  ];
  for (const change of changes) {
    const h = harness({ result: offerDecision, speak: async state => {
      change(state); state.finishInObservations = 1;
      return { contextId: 'trade-speaker-next', value: { message: 'I sent an offer.' } };
    } });
    await h.run();
    assert.equal(h.state.acts.length, 1); assert.equal(h.state.speech.length, 1); assert.equal(h.state.replies.length, 0);
    assert.equal(h.state.decisions.length, 1);
  }
});

test('interest is not committed when its hand, turn window, chat setting or control changes while speech runs', async () => {
  for (const change of [
    state => { state.view.gameState.players[0].resources.wool = 0; },
    state => { state.view.negotiation.canInitiate = false; },
    state => { state.view.negotiation.turnKey = 'turn-2'; },
    state => { state.view.slots[0].chatEnabled = false; },
    state => { state.view.controlEpoch++; },
  ]) {
    const h = harness({ result: { negotiation: interest }, speak: async state => {
      change(state); state.finishInObservations = 1;
      return { value: { message: 'I’m looking for brick.' } };
    } });
    await h.run();
    assert.equal(h.state.speech.length, 1); assert.equal(h.state.negotiations.length, 0);
    assert.equal(h.state.replies.length, 0); assert.equal(h.state.decisions.length, 1);
  }
});

test('caller cancellation is honored even if the optional speaker ignores its signal', async () => {
  for (const negotiation of [false, true]) {
    const h = harness({ result: negotiation ? { negotiation: interest } : offerDecision,
      speak: async (_state, _input, _options, controller) => { controller.abort(); return { value: { message: 'Late speech' } }; } });
    await assert.rejects(h.run(), error => error.name === 'AbortError');
    assert.equal(h.state.speech.length, 1); assert.equal(h.state.replies.length, 0); assert.equal(h.state.negotiations.length, 0);
    assert.equal(h.state.acts.length, negotiation ? 0 : 1);
    if (!negotiation) assert.equal(h.state.view.trades[0].status, 'offered');
  }
});

test('heartbeat control cancellation aborts the optional speaker and keeps the committed offer', async () => {
  const h = harness({ result: offerDecision, speak: async (state, _input, options) => {
    state.view.controlEpoch++;
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  } });
  await h.run({ heartbeatMs: 1 });
  assert.equal(h.state.acts.length, 1); assert.equal(h.state.speech.length, 1); assert.equal(h.state.replies.length, 0);
  assert.equal(h.state.view.trades[0].status, 'offered');
});

test('accept, confirm, reject, cancel and bank trades do not speak or double-acknowledge source proposals', async () => {
  for (const type of ['tradeAccept', 'tradeConfirm', 'tradeReject', 'tradeCancel', 'bankTrade']) {
    const h = harness({ result: { action: { type, payload: { tradeId: 'old-trade' } } } });
    await h.run();
    assert.equal(h.state.acts.length, 1); assert.equal(h.state.speech.length, 0); assert.equal(h.state.replies.length, 0);
    assert.deepEqual(h.state.saved.at(-1).pendingProposals, []); assert.equal(h.state.saved.at(-1).pendingReplySequence, 0);
  }
});

test('typed offer/decline negotiations use the server renderer without extra speaker inference', async () => {
  for (const intent of [{ kind: 'offer', tradeId: 'own-offer', replyToId: null }, { kind: 'decline', to: otherId, replyToId: 'incoming-interest' }]) {
    const h = harness({ initial: view({ trades: [{ ...offer, id: 'own-offer' }] }), result: { negotiation: intent } });
    await h.run();
    assert.equal(h.state.speech.length, 0); assert.equal(h.state.negotiations.length, 1);
    assert.equal(Object.hasOwn(h.state.negotiations[0], 'message'), false);
    assert.equal(h.state.replies.length, 0); assert.equal(h.state.saved.at(-1).pendingReplySequence, 0);
  }
});

test('missing new trade ID does not announce the counter’s old payload ID', async () => {
  const h = harness({ result: { action: { type: 'tradeCounter', payload: { tradeId: 'old-id', give: { wool: 1 }, get: { brick: 1 } } } },
    act: async state => { state.view.decision = null; state.idle = true; state.view.trades = [offer]; return { success: true }; } });
  await h.run();
  assert.equal(h.state.acts.length, 1); assert.equal(h.state.speech.length, 0); assert.equal(h.state.replies.length, 0);
});

test('idle polling and raw AI prose make no gameplay, reader or speaker inference calls', async () => {
  const initial = view({ decision: null, gameState: { currentPlayerIndex: 1 }, chat: [{ authorRole: 'ai', authorSeatId: otherId, message: 'I would like brick.' }] });
  const h = harness({ initial });
  h.client.readChat = async () => ({ messages: [], negotiations: [], chatSequence: 0, negotiationSequence: 0 });
  await h.run({ pendingProposals: [], pendingReplySequence: 0, chatBatchMs: 0 });
  assert.equal(h.state.decisions.length, 0); assert.equal(h.state.speech.length, 0); assert.equal(h.state.readerCalls, 0);
  assert.equal(h.state.acts.length, 0); assert.equal(h.state.negotiations.length, 0); assert.equal(h.state.replies.length, 0);
});

test('trade speaker model changes start a new public context rather than reusing another purpose', async () => {
  const initial = view(); initial.slots[0].chatModel = 'replacement-public-model'; initial.slots[0].chatReasoning = 'low';
  const h = harness({ initial, result: { negotiation: interest }, speech: 'I’m looking for brick.' });
  h.options.contexts.tradeSpeaker.compactionPending = true;
  await h.run();
  assert.equal(h.state.speech.length, 1);
  assert.equal(h.state.speech[0].contextId, null);
  assert.equal(h.state.speech[0].model, 'replacement-public-model'); assert.equal(h.state.speech[0].reasoning, 'low');
  assert.equal(h.state.saved.at(-1).contexts.tradeSpeaker.id, 'trade-speaker-next');
  assert.equal(h.state.saved.at(-1).contexts.tradeSpeaker.compactionPending, undefined, 'Old occupancy state is discarded with the old model');
});

test('public trade speaker context joins generic safe-boundary compaction with chat model settings', async () => {
  const h = harness({ initial: view({ decision: null, gameState: { currentPlayerIndex: 1 } }) });
  h.options.contexts.tradeSpeaker.compactionPending = true; h.options.contexts.tradeSpeaker.usage = { percent: 85 };
  const compacted = [];
  h.connector.capabilities = { compaction: true, contextUsage: true };
  h.connector.compact = async options => {
    compacted.push({ model: options.model, reasoning: options.reasoning, contextId: options.contextId });
    options.onRuntime({ type: 'compaction-started' }); options.onRuntime({ type: 'compaction-completed' });
    h.controller.abort();
    return { compacted: true };
  };
  await h.run({ pendingProposals: [], pendingReplySequence: 0 });
  assert.deepEqual(compacted, [{ model: 'public-model', reasoning: 'high', contextId: 'public-trade-context' }]);
  assert.equal(h.state.saved.at(-1).contexts.tradeSpeaker.compactionPending, false);
  assert.equal(h.state.decisions.length, 0); assert.equal(h.state.speech.length, 0);
  assert.equal(h.state.saved.at(-1).contexts.gameplay.id, 'private-gameplay-context');
});
