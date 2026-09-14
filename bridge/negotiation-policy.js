import {RESOURCE_NAMES} from './chat-policy.js';
import {cardTypesFor,combinedHand} from '../shared/cardTypes.js';

const resources = new Set(RESOURCE_NAMES);
// Conservative wake-up threshold: at least one advertised resource can cover
// a shortage for one standard build. Multi-build speculation stays silent.
const BUILD_TARGETS = {brick:1,lumber:1,wool:1,grain:2,ore:3,paper:1,coin:1,cloth:1};
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const tradesFor=view=>view.trades??(view.trade?[view.trade]:[]);
const names = value => Array.isArray(value) && value.length > 0 && value.length <= 2
  && new Set(value).size === value.length && value.every(item => resources.has(item));

/** Only the finite public protocol crosses from another AI to private gameplay. */
export function projectNegotiations(view, incoming = [], now = Date.now()) {
  const game = view.gameState, seat = view.seatId;
  if (game?.phase !== 'playing' || game.turnPhase !== 'main' || game.playerTradingAllowed === false || view.paused) return [];
  const players = game.players || [], own = players.find(player => player.id === seat);
  const hand=combinedHand(own), availableTypes=cardTypesFor(game);
  const active = players[game.currentPlayerIndex]?.id;
  const seen = new Set(), result = [];
  for (const item of Array.isArray(incoming) ? incoming.slice(-24) : []) {
    const intent = item?.intent;
    if (!record(item) || !record(intent) || typeof item.id !== 'string' || seen.has(item.id)
      || view.negotiation?.blockedTradeSeatIds?.includes(item.actorSeatId)
      || item.actorSeatId === seat || !players.some(player => player.id === item.actorSeatId)
      || typeof item.rootId !== 'string' || item.turnKey !== view.negotiation?.turnKey
      || !Number.isFinite(item.expiresAt) || item.expiresAt <= now
      || !Number.isInteger(item.depth) || item.depth < 0 || item.depth > 2
      || (intent.to != null && intent.to !== seat)
      || (active !== seat && active !== item.actorSeatId)) continue;
    let safe;
    if (intent.kind === 'interest') {
      if (!names(intent.wants) || !names(intent.offers)
        || intent.wants.some(name => intent.offers.includes(name))
        || [...intent.wants,...intent.offers].some(name=>!availableTypes.includes(name))
        || !intent.wants.some(name => (hand[name] || 0) > 0)
        || !intent.offers.some(name => (hand[name] || 0) < (['paper','coin','cloth'].includes(name)
          ? (own?.cityImprovements?.[{paper:'science',coin:'politics',cloth:'trade'}[name]]||0)+1 : BUILD_TARGETS[name]))) continue;
      safe = {kind: 'interest', wants: [...intent.wants], offers: [...intent.offers],
        to: intent.to ?? null, replyToId: intent.replyToId ?? null};
    } else if (intent.kind === 'offer') {
      const trade=tradesFor(view).find(candidate=>candidate.id===intent.tradeId);
      if (!trade || trade.to !== seat || trade.from !== item.actorSeatId || trade.status !== 'offered') continue;
      safe = {kind: 'offer', tradeId: intent.tradeId, replyToId: intent.replyToId ?? null};
    } else continue; // Declines and terminal announcements never wake a model.
    seen.add(item.id);
    result.push({id: item.id, rootId: item.rootId, parentId: item.parentId ?? null,
      depth: item.depth, actorSeatId: item.actorSeatId, turnKey: item.turnKey,
      createdAt: item.createdAt, expiresAt: item.expiresAt, intent: safe});
  }
  return result;
}

export function projectNegotiationWindow(view) {
  const window = view.negotiation;
  if (!record(window)) return undefined;
  return {canInitiate: window.canInitiate === true, canReply: window.canReply === true, turnKey: window.turnKey,
    ...(Number.isInteger(window.tradeOffersRemaining)?{tradeOffersRemaining:Math.max(0,Math.min(2,window.tradeOffersRemaining))}:{}),
    blockedTradeSeatIds: (Array.isArray(window.blockedTradeSeatIds)?window.blockedTradeSeatIds:[])
      .filter(id=>id!==view.seatId&&view.gameState?.players?.some(player=>player.id===id)),
    maxDepth: 2, maxMessagesPerRoot: 6, maxMessagesPerSeat: 2, cooldownMs: 5000};
}

const resourceArray = {type: 'array', items: {type: 'string', enum: RESOURCE_NAMES}, minItems: 1, maxItems: 2};
export function negotiationSchemaFor(view) {
  const game = view.gameState;
  const selectedResources={...resourceArray,items:{type:'string',enum:cardTypesFor(game)}};
  if (!view.negotiation || game?.phase !== 'playing' || game.turnPhase !== 'main' || game.playerTradingAllowed === false) return {type: 'null'};
  const incoming = view.negotiation.canReply === true
    ? projectNegotiations(view, view.negotiations).filter(item=>item.depth<2) : [];
  const parents = incoming.map(item => item.id), choices = [];
  const canStart = view.negotiation.canInitiate === true;
  const seats = (game.players || []).map(player => player.id).filter(id => id !== view.seatId);
  const parentSchema = canStart ? {type: ['string', 'null'], enum: [...parents, null]} : {type: 'string', enum: parents};
  if (canStart && seats.length) choices.push({type: 'object', additionalProperties: false,
    properties: {kind: {type: 'string', enum: ['interest']}, wants: selectedResources, offers: selectedResources,
      to: {type: ['string', 'null'], enum: [...seats, null]}, replyToId: {type:'null'}},
    required: ['kind', 'wants', 'offers', 'to', 'replyToId']});
  for (const parent of incoming) {
    if (parent.intent.kind==='interest') choices.push({type:'object',additionalProperties:false,
      properties:{kind:{type:'string',enum:['interest']},
        wants:{...resourceArray,items:{type:'string',enum:parent.intent.offers}},
        offers:{...resourceArray,items:{type:'string',enum:parent.intent.wants}},
        to:{type:'string',enum:[parent.actorSeatId]},replyToId:{type:'string',enum:[parent.id]}},
      required:['kind','wants','offers','to','replyToId']});
    choices.push({type: 'object', additionalProperties: false,
    properties: {kind: {type: 'string', enum: ['decline']}, to: {type: 'string', enum: [parent.actorSeatId]},
      replyToId: {type: 'string', enum: [parent.id]}}, required: ['kind', 'to', 'replyToId']});
  }
  const ownOffers=tradesFor(view).filter(trade=>trade.status==='offered'&&trade.from===view.seatId);
  if ((canStart || parents.length) && ownOffers.length) choices.push({
    type: 'object', additionalProperties: false, properties: {kind: {type: 'string', enum: ['offer']},
      tradeId: {type: 'string', enum: ownOffers.map(trade=>trade.id)}, replyToId: parentSchema}, required: ['kind', 'tradeId', 'replyToId']});
  return choices.length ? {anyOf: [...choices, {type: 'null'}]} : {type: 'null'};
}
