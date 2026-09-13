/**
 * Policy boundary for connected public chat.
 *
 * There are two deliberately separate projections:
 *
 * 1. `createChatReaderInput` is the only projection that contains raw public
 *    chat text.  It is intended for a low trust reader model.  It also
 *    contains a small, allow-listed public board projection so the reader can
 *    attach a message to a real seat and a real board location.
 * 2. `projectSpeakerContext` is for the separate public speaker.  It never
 *    contains chat text.  It contains only public board facts, confirmed
 *    structured action outcomes, and structured negotiation that a caller has
 *    explicitly approved.
 *
 * The reader model's output is not an action.  `validateChatProposals`
 * verifies its source message, binds the author seat from that message (the
 * model cannot choose it), validates identifiers and quantities against the
 * current public board, and returns a new object containing only the fields
 * in the proposal contract.  The private gameplay agent still chooses and
 * submits any actual move through the authoritative action API.
 */

export const RESOURCE_NAMES = Object.freeze(['brick', 'lumber', 'wool', 'grain', 'ore']);
export const PROPOSAL_TYPES = Object.freeze([
  'tradeOffer', 'tradeCounter', 'tradeAccept', 'tradeReject', 'tradeConfirm', 'tradeCancel',
  'tradeInterest', 'robberTarget', 'placeSettlement', 'placeRoad', 'upgradeToCity'
]);

export const MAX_CHAT_MESSAGES = 100;
export const MAX_CHAT_PROPOSALS = 24;
export const MAX_CONFIRMED_OUTCOMES = 100;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_LOCATION_LENGTH = 160;
export const MAX_RESOURCE_QUANTITY = 95;
export const MAX_RESOURCE_TOTAL = 95;

const PHASES = new Set(['waiting', 'setup', 'playing', 'finished']);
const TURN_PHASES = new Set(['roll', 'discard', 'robber', 'robberPick', 'yearOfPlenty', 'main', 'specialBuild']);
const TERRAIN_NAMES = new Set(['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert']);
const BUILDINGS = new Set(['settlement', 'city']);
const PUBLIC_EVENT_TYPES = new Set([
  'start', 'placeSettlement', 'placeRoad', 'upgradeToCity', 'rollDice', 'discardCards',
  'moveRobber', 'chooseRobberCard', 'buyDevCard', 'playDevCard', 'bankTrade', 'endTurn',
  'tradeOffer', 'tradeCounter', 'tradeAccept', 'tradeReject', 'tradeConfirm', 'tradeCancel',
  'leave', 'removeController', 'pause', 'resume', 'endGame'
]);
const RESOURCE_SET = new Set(RESOURCE_NAMES);
const TRADE_PROPOSAL_TYPES = new Set([
  'tradeOffer', 'tradeCounter', 'tradeAccept', 'tradeReject', 'tradeConfirm', 'tradeCancel', 'tradeInterest'
]);
const TRADE_INTEREST_DIRECTIONS = new Set(['offers', 'wants']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedString(value, limit) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= limit
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function optionalString(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  return boundedString(value, limit);
}

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function enumValue(value, values) {
  return typeof value === 'string' && values.has(value) ? value : null;
}

function locationKey(value) {
  return boundedString(value, MAX_LOCATION_LENGTH);
}

function normalizeCounts(value, {allowEmpty = false} = {}) {
  if (!isRecord(value)) return null;
  const result = {};
  let total = 0;
  let positive = false;
  try {
    for (const [resource, amount] of Object.entries(value)) {
      if (!RESOURCE_SET.has(resource) || !Number.isSafeInteger(amount)
        || amount < 0 || amount > MAX_RESOURCE_QUANTITY) return null;
      if (amount > 0) {
        total += amount;
        if (total > MAX_RESOURCE_TOTAL) return null;
        result[resource] = amount;
        positive = true;
      }
    }
  } catch {
    return null;
  }
  return allowEmpty || positive ? result : null;
}

function normalizeMessage(message) {
  if (!isRecord(message)) return null;
  try {
    const id = boundedString(message.id, MAX_IDENTIFIER_LENGTH);
    const text = typeof message.message === 'string'
      ? message.message
      : typeof message.text === 'string' ? message.text : null;
    if (!id || text === null || text.length === 0 || text.length > MAX_MESSAGE_LENGTH) return null;
    const rawAuthor = Object.hasOwn(message, 'playerId') ? message.playerId : message.authorSeatId;
    const authorSeatId = rawAuthor === null || rawAuthor === undefined || rawAuthor === ''
      ? null
      : boundedString(rawAuthor, MAX_IDENTIFIER_LENGTH);
    if (rawAuthor !== null && rawAuthor !== undefined && rawAuthor !== '' && !authorSeatId) return null;
    const at = Number.isSafeInteger(message.timestamp)
      ? message.timestamp
      : Number.isSafeInteger(message.at) ? message.at : null;
    return {id, authorSeatId, text, ...(at === null ? {} : {at})};
  } catch {
    return null;
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const result = [];
  const seen = new Set();
  for (const message of messages) {
    const normalized = normalizeMessage(message);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    result.push(normalized);
  }
  return result.slice(-MAX_CHAT_MESSAGES);
}

function normalizeSeatId(value, players = []) {
  if (typeof value === 'string') {
    const id = boundedString(value, MAX_IDENTIFIER_LENGTH);
    return id && players.some(player => player?.id === id) ? id : null;
  }
  if (Number.isSafeInteger(value) && value >= 0 && value < players.length) {
    return boundedString(players[value]?.id, MAX_IDENTIFIER_LENGTH);
  }
  return null;
}

function normalizeOwner(value, players) {
  return normalizeSeatId(value, players);
}

function normalizeSeatRecords(players, slots) {
  const result = [];
  const byId = new Map();
  const add = (raw, occupiedDefault = false) => {
    if (!isRecord(raw)) return;
    const id = boundedString(raw.id, MAX_IDENTIFIER_LENGTH);
    if (!id || byId.has(id)) return;
    const name = optionalString(raw.name, 40);
    const record = {
      id,
      ...(name ? {name} : {}),
      occupied: raw.occupied === undefined ? occupiedDefault : raw.occupied === true
    };
    byId.set(id, record);
    result.push(record);
  };
  if (Array.isArray(players)) for (const player of players) add(player, true);
  if (Array.isArray(slots)) for (const slot of slots) add(slot, slot.occupied === true);
  return result;
}

function normalizeHexes(source) {
  const entries = Array.isArray(source)
    ? source.map(value => [value?.key, value])
    : isRecord(source) ? Object.entries(source) : [];
  const result = [];
  const seen = new Set();
  for (const [rawKey, rawHex] of entries) {
    const key = locationKey(rawKey);
    if (!key || seen.has(key)) continue;
    const hex = isRecord(rawHex) ? rawHex : {};
    const terrain = enumValue(hex.terrain, TERRAIN_NAMES);
    const resource = enumValue(hex.resource, RESOURCE_SET);
    const number = safeInteger(hex.number, 2, 12);
    result.push({key, ...(terrain ? {terrain} : {}), ...(resource ? {resource} : {}), ...(number === null ? {} : {number})});
    seen.add(key);
  }
  return result.slice(0, 256);
}

function normalizeVertices(source, players) {
  const entries = Array.isArray(source)
    ? source.map(value => [value?.key, value])
    : isRecord(source) ? Object.entries(source) : [];
  const result = [];
  const seen = new Set();
  for (const [rawKey, rawVertex] of entries) {
    const key = locationKey(rawKey);
    if (!key || seen.has(key)) continue;
    const vertex = isRecord(rawVertex) ? rawVertex : {};
    const building = enumValue(vertex.building, BUILDINGS);
    const ownerSeatId = normalizeOwner(vertex.ownerSeatId ?? vertex.owner, players);
    result.push({key, building, ...(ownerSeatId ? {ownerSeatId} : {})});
    seen.add(key);
  }
  return result.slice(0, 512);
}

function normalizeEdges(source, players) {
  const entries = Array.isArray(source)
    ? source.map(value => [value?.key, value])
    : isRecord(source) ? Object.entries(source) : [];
  const result = [];
  const seen = new Set();
  for (const [rawKey, rawEdge] of entries) {
    const key = locationKey(rawKey);
    if (!key || seen.has(key)) continue;
    const edge = isRecord(rawEdge) ? rawEdge : {};
    const ownerSeatId = normalizeOwner(edge.ownerSeatId ?? edge.owner, players);
    result.push({key, road: edge.road === true, ...(ownerSeatId ? {ownerSeatId} : {})});
    seen.add(key);
  }
  return result.slice(0, 512);
}

function normalizeProjectedBoard(board, players) {
  const source = isRecord(board) ? board : {};
  return {
    hexes: normalizeHexes(source.hexes),
    vertices: normalizeVertices(source.vertices, players),
    edges: normalizeEdges(source.edges, players)
  };
}

function normalizeTrade(rawTrade, players) {
  if (!isRecord(rawTrade)) return null;
  const id = boundedString(rawTrade.id, MAX_IDENTIFIER_LENGTH);
  const statuses = new Set(['offered', 'accepted']);
  const status = enumValue(rawTrade.status, statuses);
  const from = normalizeSeatId(rawTrade.from, players);
  const to = normalizeSeatId(rawTrade.to, players);
  const give = normalizeCounts(rawTrade.give ?? rawTrade.offer, {allowEmpty: true});
  const get = normalizeCounts(rawTrade.get ?? rawTrade.request, {allowEmpty: true});
  if (!id || !status || !from || !to || from === to || !give || !get) return null;
  return {id, from, to, status, give, get};
}

function sanitizeProjectedFacts(value) {
  const source = isRecord(value) ? value : {};
  const seats = normalizeSeatRecords(source.seats, []);
  const players = seats.map(seat => ({id: seat.id, name: seat.name}));
  const board = normalizeProjectedBoard(source.board, players);
  const seatIds = new Set(seats.map(seat => seat.id));
  const currentPlayerId = typeof source.currentPlayerId === 'string' && seatIds.has(source.currentPlayerId)
    ? source.currentPlayerId : null;
  const winnerSeatId = typeof source.winnerSeatId === 'string' && seatIds.has(source.winnerSeatId)
    ? source.winnerSeatId : null;
  const robberHexKey = locationKey(source.robberHexKey ?? source.robber);
  const hexKeys = new Set(board.hexes.map(hex => hex.key));
  return {
    phase: enumValue(source.phase, PHASES),
    turnPhase: enumValue(source.turnPhase, TURN_PHASES),
    ...(source.playerTradingAllowed === false ? {playerTradingAllowed: false} : {}),
    paused: source.paused === true,
    currentPlayerId,
    ...(winnerSeatId ? {winnerSeatId} : {}),
    ...(robberHexKey && hexKeys.has(robberHexKey) ? {robberHexKey} : {}),
    seats,
    board,
    trade: normalizeTrade(source.trade, players)
  };
}

/** Return only public board/seat facts from a room snapshot or game state. */
export function projectPublicState(value = {}) {
  if (isRecord(value) && isRecord(value.board) && Array.isArray(value.seats)) {
    return sanitizeProjectedFacts(value);
  }
  const root = isRecord(value) ? value : {};
  const game = isRecord(root.gameState) ? root.gameState : root;
  const players = Array.isArray(game.players) ? game.players : [];
  const slots = Array.isArray(root.slots) ? root.slots : Array.isArray(game.slots) ? game.slots : [];
  const seats = normalizeSeatRecords(players, slots);
  const board = {
    hexes: normalizeHexes(game.hexes),
    vertices: normalizeVertices(game.vertices, players),
    edges: normalizeEdges(game.edges, players)
  };
  const seatIds = new Set(seats.map(seat => seat.id));
  const currentPlayer = Number.isSafeInteger(game.currentPlayerIndex) ? players[game.currentPlayerIndex] : null;
  const currentPlayerId = typeof game.currentPlayerId === 'string' && seatIds.has(game.currentPlayerId)
    ? game.currentPlayerId
    : boundedString(currentPlayer?.id, MAX_IDENTIFIER_LENGTH);
  const winner = Number.isSafeInteger(game.winner) ? players[game.winner] : null;
  const winnerSeatId = typeof game.winner === 'string' && seatIds.has(game.winner)
    ? game.winner : boundedString(winner?.id, MAX_IDENTIFIER_LENGTH);
  const robber = locationKey(game.robber);
  const hexKeys = new Set(board.hexes.map(hex => hex.key));
  const rawTrade = root.trade ?? game.trade ?? game.tradeOffer;
  const tradePlayers = players.map(player => ({id: player?.id, name: player?.name}));
  return {
    phase: enumValue(game.phase, PHASES),
    turnPhase: enumValue(game.turnPhase, TURN_PHASES),
    ...(game.playerTradingAllowed === false ? {playerTradingAllowed: false} : {}),
    paused: root.paused === true || game.paused === true,
    ...(currentPlayerId && seatIds.has(currentPlayerId) ? {currentPlayerId} : {}),
    ...(winnerSeatId && seatIds.has(winnerSeatId) ? {winnerSeatId} : {}),
    ...(robber && hexKeys.has(robber) ? {robberHexKey: robber} : {}),
    seats,
    board,
    trade: normalizeTrade(rawTrade, tradePlayers)
  };
}

/**
 * Input contract for the low-trust chat reader. `messages[].text` is the raw
 * public message and is intentionally absent from every other projection.
 */
export function createChatReaderInput(input = {}) {
  const source = isRecord(input) ? input : {};
  const snapshot = isRecord(source.snapshot) ? source.snapshot : null;
  const messages = source.messages ?? source.publicMessages ?? snapshot?.chat ?? source.chat ?? [];
  const publicState = source.publicState ?? snapshot ?? source;
  return {messages: normalizeMessages(messages), publicState: projectPublicState(publicState)};
}

const countSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(RESOURCE_NAMES.map(resource => [resource, {
    type: 'integer', minimum: 0, maximum: MAX_RESOURCE_QUANTITY
  }])),
  required: [...RESOURCE_NAMES]
};

const proposalSchema = {
  anyOf: [
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['tradeOffer']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      to: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH}, give: countSchema, get: countSchema
    }, required: ['type', 'sourceMessageId', 'to', 'give', 'get']},
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['tradeCounter']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      tradeId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      to: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH}, give: countSchema, get: countSchema
    }, required: ['type', 'sourceMessageId', 'tradeId', 'to', 'give', 'get']},
    ...['tradeAccept', 'tradeReject', 'tradeConfirm', 'tradeCancel'].map(type => ({
      type: 'object', additionalProperties: false, properties: {
        type: {type: 'string', enum: [type]}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
        tradeId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH}
      }, required: ['type', 'sourceMessageId', 'tradeId']
    })),
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['tradeInterest']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      direction: {type: 'string', enum: ['offers', 'wants']},
      resources: {type: 'array', minItems: 1, maxItems: RESOURCE_NAMES.length, items: {type: 'string', enum: [...RESOURCE_NAMES]}}
    }, required: ['type', 'sourceMessageId', 'direction', 'resources']},
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['robberTarget']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      hexKey: {type: 'string', minLength: 1, maxLength: MAX_LOCATION_LENGTH}
    }, required: ['type', 'sourceMessageId', 'hexKey']},
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['placeSettlement']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      vertexKey: {type: 'string', minLength: 1, maxLength: MAX_LOCATION_LENGTH}
    }, required: ['type', 'sourceMessageId', 'vertexKey']},
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['placeRoad']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      edgeKey: {type: 'string', minLength: 1, maxLength: MAX_LOCATION_LENGTH}
    }, required: ['type', 'sourceMessageId', 'edgeKey']},
    {type: 'object', additionalProperties: false, properties: {
      type: {type: 'string', enum: ['upgradeToCity']}, sourceMessageId: {type: 'string', minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH},
      vertexKey: {type: 'string', minLength: 1, maxLength: MAX_LOCATION_LENGTH}
    }, required: ['type', 'sourceMessageId', 'vertexKey']}
  ]
};

export const chatReaderSchema = {
  type: 'object', additionalProperties: false,
  properties: {proposals: {type: 'array', maxItems: MAX_CHAT_PROPOSALS, items: proposalSchema}},
  required: ['proposals']
};

function validationContext(context) {
  const source = isRecord(context) ? context : {};
  const input = Array.isArray(source.messages)
    ? source
    : createChatReaderInput({messages: source.chat || [], publicState: source.publicState ?? source});
  return {messages: normalizeMessages(input.messages), publicState: projectPublicState(input.publicState)};
}

function validSeats(facts) {
  return new Set((facts.seats || []).map(seat => seat.id));
}

function validTradeParties(authorSeatId, targetSeatId, facts, seats) {
  if (!targetSeatId || !seats.has(targetSeatId) || targetSeatId === authorSeatId) return false;
  // The engine permits an active player to offer to any seat and a passive
  // player to offer only to the active seat.  This is a structural check; the
  // private agent and the authoritative action API still decide affordability.
  return !facts.currentPlayerId || authorSeatId === facts.currentPlayerId || targetSeatId === facts.currentPlayerId;
}

function normalizeTradeProposal(candidate, base, facts, seats) {
  const type = base.type;
  if (facts.playerTradingAllowed === false) return null;
  if (type === 'tradeOffer' || type === 'tradeCounter') {
    const to = boundedString(candidate.to, MAX_IDENTIFIER_LENGTH);
    const give = normalizeCounts(candidate.give);
    const get = normalizeCounts(candidate.get);
    if (!validTradeParties(base.authorSeatId, to, facts, seats) || !give || !get) return null;
    if (Object.keys(give).some(resource => get[resource] > 0)) return null;
    if (type === 'tradeOffer' && facts.trade) return null;
    if (type === 'tradeCounter') {
      const tradeId = boundedString(candidate.tradeId, MAX_IDENTIFIER_LENGTH);
      const trade = facts.trade;
      if (!tradeId || !trade || trade.id !== tradeId || trade.status !== 'offered'
        || base.authorSeatId !== trade.to || to !== trade.from) return null;
      return {...base, tradeId, to, give, get};
    }
    return {...base, to, give, get};
  }

  const tradeId = boundedString(candidate.tradeId, MAX_IDENTIFIER_LENGTH);
  const trade = facts.trade;
  if (!tradeId || !trade || trade.id !== tradeId) return null;
  if (type === 'tradeAccept' || type === 'tradeReject') {
    if (base.authorSeatId !== trade.to || trade.status !== 'offered') return null;
  } else if (type === 'tradeConfirm') {
    if (base.authorSeatId !== trade.from || trade.status !== 'accepted') return null;
  } else if (type === 'tradeCancel') {
    if (base.authorSeatId !== trade.from || !['offered', 'accepted'].includes(trade.status)) return null;
  } else return null;
  return {...base, tradeId};
}

function normalizeProposal(candidate, base, facts) {
  const seats = validSeats(facts);
  if (base.type === 'tradeInterest') {
    if (facts.playerTradingAllowed === false) return null;
    const direction = enumValue(candidate.direction, TRADE_INTEREST_DIRECTIONS);
    if (!direction || !Array.isArray(candidate.resources) || candidate.resources.length < 1
      || candidate.resources.length > RESOURCE_NAMES.length) return null;
    const resources = [];
    const seen = new Set();
    for (const resource of candidate.resources) {
      if (typeof resource !== 'string' || !RESOURCE_SET.has(resource) || seen.has(resource)) return null;
      seen.add(resource);
      resources.push(resource);
    }
    return {...base, direction, resources};
  }
  if (base.type === 'tradeOffer' || base.type === 'tradeCounter'
    || base.type === 'tradeAccept' || base.type === 'tradeReject'
    || base.type === 'tradeConfirm' || base.type === 'tradeCancel') {
    return normalizeTradeProposal(candidate, base, facts, seats);
  }
  if (base.type === 'robberTarget') {
    const hexKey = locationKey(candidate.hexKey);
    const keys = new Set(facts.board.hexes.map(hex => hex.key));
    if (!hexKey || !keys.has(hexKey) || hexKey === facts.robberHexKey) return null;
    return {...base, hexKey};
  }
  if (base.type === 'placeSettlement' || base.type === 'upgradeToCity') {
    const vertexKey = locationKey(candidate.vertexKey);
    const keys = new Set(facts.board.vertices.map(vertex => vertex.key));
    return vertexKey && keys.has(vertexKey) ? {...base, vertexKey} : null;
  }
  if (base.type === 'placeRoad') {
    const edgeKey = locationKey(candidate.edgeKey);
    const keys = new Set(facts.board.edges.map(edge => edge.key));
    return edgeKey && keys.has(edgeKey) ? {...base, edgeKey} : null;
  }
  return null;
}

/**
 * Validate reader output. Invalid proposals are dropped independently so one
 * malformed model row cannot suppress valid rows. Unknown fields are never
 * copied. The returned array is safe to pass as normalized suggestions to a
 * private gameplay agent; it contains no message text or model rationale.
 */
export function validateChatProposals(readerOutput, context) {
  const raw = Array.isArray(readerOutput)
    ? readerOutput
    : isRecord(readerOutput) && Array.isArray(readerOutput.proposals) ? readerOutput.proposals : [];
  const {messages, publicState} = validationContext(context);
  const facts = projectPublicState(publicState);
  const messageById = new Map(messages.map(message => [message.id, message]));
  const result = [];
  const seen = new Set();
  for (const candidate of raw.slice(0, MAX_CHAT_PROPOSALS * 2)) {
    if (!isRecord(candidate)) continue;
    try {
      const type = boundedString(candidate.type, 40);
      const sourceMessageId = boundedString(candidate.sourceMessageId, MAX_IDENTIFIER_LENGTH);
      const source = sourceMessageId ? messageById.get(sourceMessageId) : null;
      const authorSeatId = source?.authorSeatId;
      if (!type || !PROPOSAL_TYPES.includes(type) || !source || !authorSeatId || !validSeats(facts).has(authorSeatId)) continue;
      const normalized = normalizeProposal(candidate, {type, sourceMessageId: source.id, authorSeatId}, facts);
      if (!normalized) continue;
      const fingerprint = JSON.stringify(normalized);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push(normalized);
      if (result.length >= MAX_CHAT_PROPOSALS) break;
    } catch {
      // A malformed row is untrusted model output, not a room failure.
    }
  }
  return result;
}

function normalizeApprovedNegotiation(value, facts) {
  if (!Array.isArray(value)) return [];
  const seats = validSeats(facts);
  const result = [];
  const seen = new Set();
  for (const candidate of value.slice(0, MAX_CHAT_PROPOSALS * 2)) {
    if (!isRecord(candidate)) continue;
    try {
      const type = boundedString(candidate.type, 40);
      const sourceMessageId = boundedString(candidate.sourceMessageId, MAX_IDENTIFIER_LENGTH);
      const authorSeatId = boundedString(candidate.authorSeatId, MAX_IDENTIFIER_LENGTH);
      if (!type || !TRADE_PROPOSAL_TYPES.has(type) || !sourceMessageId || !authorSeatId || !seats.has(authorSeatId)) continue;
      const normalized = normalizeProposal(candidate, {type, sourceMessageId, authorSeatId}, facts);
      if (!normalized) continue;
      const fingerprint = JSON.stringify(normalized);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      result.push(normalized);
      if (result.length >= MAX_CHAT_PROPOSALS) break;
    } catch {
      // Approved intent is still copied through an explicit allow-list.
    }
  }
  return result;
}

function resolveActorSeatId(event, facts) {
  const seats = facts.seats || [];
  const explicit = boundedString(event.actorSeatId, MAX_IDENTIFIER_LENGTH);
  if (explicit && seats.some(seat => seat.id === explicit)) return explicit;
  const actorName = boundedString(event.actor, 40);
  if (!actorName) return null;
  const matches = seats.filter(seat => seat.name === actorName);
  return matches.length === 1 ? matches[0].id : null;
}

function normalizeOutcomeLocation(event, facts) {
  const hexKey = locationKey(event.hexKey);
  if (hexKey && facts.board.hexes.some(hex => hex.key === hexKey)) return {hexKey};
  const vertexKey = locationKey(event.vertexKey);
  if (vertexKey && facts.board.vertices.some(vertex => vertex.key === vertexKey)) return {vertexKey};
  const edgeKey = locationKey(event.edgeKey);
  if (edgeKey && facts.board.edges.some(edge => edge.key === edgeKey)) return {edgeKey};
  return null;
}

function normalizeOutcomeTrade(event, facts, type) {
  if (!TRADE_PROPOSAL_TYPES.has(type) || type === 'tradeInterest') return {};
  const trade = isRecord(event.trade) ? event.trade : event;
  const tradeId = boundedString(trade.tradeId ?? trade.id, MAX_IDENTIFIER_LENGTH);
  const to = normalizeSeatId(trade.to ?? trade.targetSeatId, facts.seats);
  const give = normalizeCounts(trade.give ?? trade.offer, {allowEmpty: true});
  const get = normalizeCounts(trade.get ?? trade.request, {allowEmpty: true});
  const status = enumValue(trade.status, new Set(['offered', 'accepted', 'rejected', 'cancelled', 'confirmed']));
  const result = {};
  if (tradeId) result.tradeId = tradeId;
  if (to) result.to = to;
  if (give && Object.keys(give).length) result.give = give;
  if (get && Object.keys(get).length) result.get = get;
  if (status) result.status = status;
  return result;
}

function normalizeOutcome(event, facts) {
  if (!isRecord(event)) return null;
  const id = boundedString(event.id, MAX_IDENTIFIER_LENGTH);
  const actorSeatId = resolveActorSeatId(event, facts);
  const type = enumValue(event.type, PUBLIC_EVENT_TYPES);
  if (!id || !actorSeatId || !type) return null;
  const at = Number.isSafeInteger(event.at) ? event.at : Number.isSafeInteger(event.timestamp) ? event.timestamp : null;
  const location = normalizeOutcomeLocation(event, facts);
  const rawRoll = isRecord(event.roll) ? event.roll : null;
  const die1 = safeInteger(rawRoll?.die1, 1, 6);
  const die2 = safeInteger(rawRoll?.die2, 1, 6);
  const total = safeInteger(rawRoll?.total, 2, 12);
  const roll = die1 !== null && die2 !== null && total === die1 + die2
    ? {die1, die2, total} : null;
  return {
    id,
    actorSeatId,
    type,
    ...(at === null ? {} : {at}),
    ...(location || {}),
    ...(roll ? {roll} : {}),
    ...normalizeOutcomeTrade(event, facts, type)
  };
}

/**
 * Positive whitelist for the separate public speaker. In particular, this
 * does not expose `messages`, `chat`, `legalActions`, resource counts,
 * development cards, memory, credentials, revisions, or controller tokens.
 * `approvedNegotiation` must come from `validateChatProposals` or an equally
 * trusted structured approval path; it is never parsed from raw chat here.
 */
export function projectSpeakerContext({publicState = {}, confirmedOutcomes = [], approvedNegotiation = []} = {}) {
  const facts = projectPublicState(publicState);
  const publicFacts = {
    phase: facts.phase,
    turnPhase: facts.turnPhase,
    ...(facts.playerTradingAllowed === false ? {playerTradingAllowed: false} : {}),
    paused: facts.paused,
    ...(facts.currentPlayerId ? {currentPlayerId: facts.currentPlayerId} : {}),
    ...(facts.winnerSeatId ? {winnerSeatId: facts.winnerSeatId} : {}),
    ...(facts.robberHexKey ? {robberHexKey: facts.robberHexKey} : {}),
    seats: facts.seats.map(seat => ({id: seat.id, ...(seat.name ? {name: seat.name} : {}), occupied: seat.occupied})),
    board: facts.board
  };
  const outcomes = [];
  const seen = new Set();
  if (Array.isArray(confirmedOutcomes)) {
    for (const event of confirmedOutcomes.slice(-MAX_CONFIRMED_OUTCOMES)) {
      const normalized = normalizeOutcome(event, facts);
      if (!normalized) continue;
      const fingerprint = JSON.stringify(normalized);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      outcomes.push(normalized);
    }
  }
  return {
    publicFacts,
    confirmedOutcomes: outcomes,
    approvedNegotiation: normalizeApprovedNegotiation(approvedNegotiation, facts)
  };
}
