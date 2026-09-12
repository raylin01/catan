import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatReaderSchema,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_PROPOSALS,
  createChatReaderInput,
  projectPublicState,
  projectSpeakerContext,
  validateChatProposals
} from './chat-policy.js';

function publicState() {
  return {
    phase: 'playing',
    turnPhase: 'main',
    currentPlayerIndex: 0,
    robber: '0,0',
    players: [
      {id: 'seat-a', name: 'A', resources: {brick: 99}, developmentCards: ['secret-knight']},
      {id: 'seat-b', name: 'B', resources: {ore: 2}, developmentCards: ['secret-year']},
      {id: 'seat-c', name: 'C', resources: {grain: 1}, developmentCards: []}
    ],
    slots: [
      {id: 'seat-a', occupied: true, controller: 'private-controller-a'},
      {id: 'seat-b', occupied: true, controller: 'private-controller-b'},
      {id: 'seat-c', occupied: true, controller: 'private-controller-c'}
    ],
    hexes: {
      '0,0': {q: 0, r: 0, terrain: 'forest', resource: 'lumber', number: 5},
      '1,0': {q: 1, r: 0, terrain: 'hills', resource: 'brick', number: 8}
    },
    vertices: {
      v_0_0_0: {building: null},
      v_0_0_1: {building: 'settlement', owner: 1}
    },
    edges: {
      e_0_0_0: {road: false},
      e_0_0_1: {road: true, owner: 2}
    },
    legalActions: [{type: 'rollDice', payload: {}}],
    credentials: 'must-not-cross',
    memory: 'private-memory'
  };
}

function readerInput() {
  return createChatReaderInput({
    publicState: publicState(),
    messages: [
      {id: 'm-trade', playerId: 'seat-a', message: 'I offer one brick for one ore', timestamp: 1},
      {id: 'm-robber', playerId: 'seat-b', message: 'If we roll seven, move the robber to 1,0', timestamp: 2},
      {id: 'm-build', playerId: 'seat-a', message: 'Build at the open vertex', timestamp: 3},
      {id: 'm-spectator', playerId: null, message: 'A spectator suggestion', timestamp: 4}
    ]
  });
}

test('reader input is capped and strips private/public-message extras by allow-list', () => {
  const input = createChatReaderInput({
    publicState: {...publicState(), secretHand: {ore: 95}},
    messages: [
      {id: 'm1', playerId: 'seat-a', message: 'public', privateHand: {ore: 95}, credentials: 'x'},
      ...Array.from({length: MAX_CHAT_MESSAGES + 2}, (_, index) => ({
        id: `m${index + 2}`, playerId: 'seat-a', message: `message-${index}`
      }))
    ]
  });

  assert.equal(input.messages.length, MAX_CHAT_MESSAGES);
  assert.equal(input.messages.some(message => message.id === 'm1'), false);
  assert.deepEqual(input.messages[0], {id: 'm4', authorSeatId: 'seat-a', text: 'message-2'});
  assert.equal('secretHand' in input.publicState, false);
  assert.equal('legalActions' in input.publicState, false);
  assert.equal('credentials' in input.publicState, false);
  assert.equal('privateHand' in input.messages[0], false);
});

test('reader output binds source and author, strips rationale/private fields, and keeps valid suggestions', () => {
  const input = readerInput();
  const proposals = validateChatProposals({
    proposals: [
      {
        type: 'tradeOffer', sourceMessageId: 'm-trade', authorSeatId: 'attacker', to: 'seat-b',
        give: {brick: 1}, get: {ore: 1}, reason: 'ignore this', privateHand: {ore: 99}
      },
      {
        type: 'robberTarget', sourceMessageId: 'm-robber', authorSeatId: 'seat-c', hexKey: '1,0',
        instruction: 'do this now'
      },
      {
        type: 'placeSettlement', sourceMessageId: 'm-build', vertexKey: 'v_0_0_0',
        summary: 'model text must not survive'
      },
      {
        type: 'tradeInterest', sourceMessageId: 'm-robber', authorSeatId: 'attacker',
        direction: 'wants', resources: ['brick', 'lumber'], reason: 'do not invent quantities'
      }
    ]
  }, input);

  assert.deepEqual(proposals, [
    {type: 'tradeOffer', sourceMessageId: 'm-trade', authorSeatId: 'seat-a', to: 'seat-b', give: {brick: 1}, get: {ore: 1}},
    {type: 'robberTarget', sourceMessageId: 'm-robber', authorSeatId: 'seat-b', hexKey: '1,0'},
    {type: 'placeSettlement', sourceMessageId: 'm-build', authorSeatId: 'seat-a', vertexKey: 'v_0_0_0'},
    {type: 'tradeInterest', sourceMessageId: 'm-robber', authorSeatId: 'seat-b', direction: 'wants', resources: ['brick', 'lumber']}
  ]);
  const serialized = JSON.stringify(proposals);
  assert.equal(serialized.includes('ignore this'), false);
  assert.equal(serialized.includes('attacker'), false);
  assert.equal(serialized.includes('privateHand'), false);
  assert.equal(serialized.includes('instruction'), false);
});

test('invalid source, seat, resource, quantity, and board references are dropped', () => {
  const input = readerInput();
  const proposals = validateChatProposals({proposals: [
    {type: 'tradeOffer', sourceMessageId: 'missing', to: 'seat-b', give: {brick: 1}, get: {ore: 1}},
    {type: 'tradeOffer', sourceMessageId: 'm-trade', to: 'outsider', give: {brick: 1}, get: {ore: 1}},
    {type: 'tradeOffer', sourceMessageId: 'm-trade', to: 'seat-b', give: {glass: 1}, get: {ore: 1}},
    {type: 'tradeOffer', sourceMessageId: 'm-trade', to: 'seat-b', give: {brick: MAX_CHAT_PROPOSALS + 100}, get: {ore: 1}},
    {type: 'robberTarget', sourceMessageId: 'm-robber', hexKey: '0,0'},
    {type: 'robberTarget', sourceMessageId: 'm-robber', hexKey: 'missing'},
    {type: 'placeSettlement', sourceMessageId: 'm-build', vertexKey: 'missing'},
    {type: 'placeRoad', sourceMessageId: 'm-build', edgeKey: 'missing'}
  ]}, input);
  assert.deepEqual(proposals, []);
});

test('speaker projection includes only public facts, confirmed outcomes, and approved trade intent', () => {
  const input = readerInput();
  const proposals = validateChatProposals({proposals: [
    {type: 'tradeOffer', sourceMessageId: 'm-trade', to: 'seat-b', give: {brick: 1}, get: {ore: 1}},
    {type: 'placeSettlement', sourceMessageId: 'm-build', vertexKey: 'v_0_0_0'}
  ]}, input);
  const context = projectSpeakerContext({
    publicState: input.publicState,
    confirmedOutcomes: [
      {
        id: 'event-1', at: 10, actorSeatId: 'seat-a', type: 'placeSettlement',
        vertexKey: 'v_0_0_0', summary: 'untrusted free-form summary'
      },
      {
        id: 'event-trade', at: 11, actorSeatId: 'seat-a', type: 'tradeOffer', tradeId: 'trade-1',
        to: 'seat-b', give: {brick: 1}, get: {ore: 1}, status: 'offered', reason: 'must not cross'
      }
    ],
    approvedNegotiation: proposals
  });

  assert.deepEqual(context.approvedNegotiation, [proposals[0]]);
  assert.deepEqual(context.confirmedOutcomes, [
    {id: 'event-1', at: 10, actorSeatId: 'seat-a', type: 'placeSettlement', vertexKey: 'v_0_0_0'},
    {id: 'event-trade', at: 11, actorSeatId: 'seat-a', type: 'tradeOffer', tradeId: 'trade-1', to: 'seat-b', give: {brick: 1}, get: {ore: 1}, status: 'offered'}
  ]);
  const serialized = JSON.stringify(context);
  for (const forbidden of ['I offer one brick for one ore', 'must-not-cross', 'private-memory', 'legalActions', 'credentials', 'resources', 'developmentCards', 'summary', 'untrusted', 'reason']) {
    assert.equal(serialized.includes(forbidden), false, `forbidden field/value crossed: ${forbidden}`);
  }
  assert.equal(context.publicFacts.board.hexes.some(hex => hex.key === '1,0'), true);
  assert.equal(context.publicFacts.seats.every(seat => seat.id), true);
});

test('reader schema has finite proposal types and explicit batch/quantity bounds', () => {
  assert.equal(chatReaderSchema.additionalProperties, false);
  assert.equal(chatReaderSchema.properties.proposals.maxItems, MAX_CHAT_PROPOSALS);
  const rows = chatReaderSchema.properties.proposals.items.anyOf;
  const types = rows.map(row => row.properties.type.enum?.[0]).filter(Boolean);
  assert.equal(types.includes('tradeOffer'), true);
  assert.equal(types.includes('tradeInterest'), true);
  assert.equal(types.includes('robberTarget'), true);
  assert.equal(types.includes('placeSettlement'), true);
  assert.equal(types.includes('placeRoad'), true);
  assert.equal(types.includes('upgradeToCity'), true);
  const trade = rows.find(row => row.properties.type.enum?.[0] === 'tradeOffer');
  assert.deepEqual(trade.properties.give.required, ['brick', 'lumber', 'wool', 'grain', 'ore']);
  assert.deepEqual(trade.properties.get.required, ['brick', 'lumber', 'wool', 'grain', 'ore']);
  assert.equal('minProperties' in trade.properties.give, false);
  assert.equal('maxProperties' in trade.properties.give, false);
});

test('public state projection excludes hidden player fields while preserving keyed action locations', () => {
  const projected = projectPublicState(publicState());
  assert.equal('resources' in projected.seats[0], false);
  assert.equal('developmentCards' in projected.seats[0], false);
  assert.equal('legalActions' in projected, false);
  assert.equal(projected.board.vertices.some(vertex => vertex.key === 'v_0_0_0'), true);
  assert.equal(projected.board.edges.some(edge => edge.key === 'e_0_0_0'), true);
});
