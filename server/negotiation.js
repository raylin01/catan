export const NEGOTIATION_LIMITS=Object.freeze({
  maxDepth:2,
  maxMessagesPerRoot:6,
  maxMessagesPerSeat:2,
  maxTradeOffersPerTurn:2,
  cooldownMs:5000,
  rootTtlMs:600000
});

const RESOURCES=['brick','lumber','wool','grain','ore'];
const RESOURCE_SET=new Set(RESOURCES);
const fail=(error,statusCode=400)=>({success:false,error,statusCode});
const ownKeys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const validId=value=>typeof value==='string'&&value.length>=1&&value.length<=100;
const currentSeatId=room=>room.game?.players?.[room.game.currentPlayerIndex]?.id||null;

function safeCounter(value){return Number.isSafeInteger(value)&&value>=0?value:0;}

/** Reconcile persisted gate state with the authoritative game turn. */
export function negotiationState(room) {
  const prior=room.negotiationState&&typeof room.negotiationState==='object'&&!Array.isArray(room.negotiationState)?room.negotiationState:{};
  const activeSeatId=currentSeatId(room);
  let turnNumber=safeCounter(prior.turnNumber);
  let rootStarted=prior.rootStarted===true;
  let root=prior.root&&typeof prior.root==='object'&&!Array.isArray(prior.root)?prior.root:null;
  if(root&&(!validId(root.id)||!Number.isFinite(root.expiresAt)||!Array.isArray(root.messages)||root.messages.length>NEGOTIATION_LIMITS.maxMessagesPerRoot||
    root.messages.some(message=>!message||typeof message!=='object'||!validId(message.id)||!message.intent||typeof message.intent!=='object')))root=null;
  const realSeatIds=new Set((room.slots||[]).map(slot=>slot.id));
  const lastPublishedAtBySeat=Object.fromEntries(Object.entries(prior.lastPublishedAtBySeat||{})
    .filter(([seatId,at])=>realSeatIds.has(seatId)&&Number.isFinite(at)&&at>=0));
  let aiTradeActionsBySeat=Object.fromEntries(Object.entries(prior.aiTradeActionsBySeat||{}).filter(([seatId,value])=>
    realSeatIds.has(seatId)&&value&&Number.isSafeInteger(value.count)&&value.count>=0&&value.count<=NEGOTIATION_LIMITS.maxTradeOffersPerTurn&&
    Array.isArray(value.fingerprints)&&value.fingerprints.length<=NEGOTIATION_LIMITS.maxTradeOffersPerTurn&&value.fingerprints.every(item=>typeof item==='string')));
  let closedTradeSeatIdsBySeat={};
  for(const [seatId,blocked] of Object.entries(prior.closedTradeSeatIdsBySeat||{})) {
    if(!realSeatIds.has(seatId)||!Array.isArray(blocked))continue;
    for(const counterpartId of blocked)if(realSeatIds.has(counterpartId)&&counterpartId!==seatId) {
      closedTradeSeatIdsBySeat[seatId]=[...new Set([...(closedTradeSeatIdsBySeat[seatId]||[]),counterpartId])];
      closedTradeSeatIdsBySeat[counterpartId]=[...new Set([...(closedTradeSeatIdsBySeat[counterpartId]||[]),seatId])];
    }
  }
  if(prior.activeSeatId&&activeSeatId&&prior.activeSeatId!==activeSeatId) {
    turnNumber++;
    rootStarted=false;
    root=null;
    aiTradeActionsBySeat={};
    closedTradeSeatIdsBySeat={};
  }
  const turnKey=activeSeatId?`${turnNumber}:${activeSeatId}`:null;
  if(root?.turnKey!==turnKey)root=null;
  return {version:1,sequence:safeCounter(prior.sequence),turnNumber,activeSeatId,turnKey,rootStarted,root,lastPublishedAtBySeat,aiTradeActionsBySeat,closedTradeSeatIdsBySeat};
}

export function syncNegotiationTurn(room) {
  room.negotiationState=negotiationState(room);
  return room.negotiationState;
}

export function negotiationOpportunity(room,slot,now) {
  const state=negotiationState(room);
  const active=room.game?.phase==='playing'&&room.game?.turnPhase==='main'&&!room.game?.freeRoads&&!room.game?.yearOfPlentyPicks;
  const enabled=slot?.kind==='ai'&&slot.chatEnabled!==false&&!slot.aiPaused&&!room.paused;
  const rootAvailable=!room.trade||Boolean(offeredTrade(room,slot?.id,room.trade?.id));
  const lastPublishedAt=state.lastPublishedAtBySeat[slot?.id],cooldownReady=!Number.isFinite(lastPublishedAt)||now-lastPublishedAt>=NEGOTIATION_LIMITS.cooldownMs;
  const rootFresh=rootIsFresh(room,state,now),rootMessages=rootFresh?state.root.messages:[];
  const ownMessages=rootMessages.filter(message=>message.actorSeatId===slot?.id);
  const replyBudgetReady=rootMessages.length<NEGOTIATION_LIMITS.maxMessagesPerRoot&&ownMessages.length<NEGOTIATION_LIMITS.maxMessagesPerSeat&&
    !ownMessages.some(message=>message.intent.kind==='decline');
  const tradeOffersUsed=state.aiTradeActionsBySeat[slot?.id]?.count||0;
  const seatOrder=new Map((room.slots||[]).map((candidate,index)=>[candidate.id,index]));
  const blockedTradeSeatIds=[...(state.closedTradeSeatIdsBySeat[slot?.id]||[])].sort((a,b)=>(seatOrder.get(a)||0)-(seatOrder.get(b)||0));
  return {
    canInitiate:Boolean(enabled&&active&&rootAvailable&&cooldownReady&&currentSeatId(room)===slot.id&&!state.rootStarted),
    canReply:Boolean(enabled&&active&&rootFresh&&replyBudgetReady&&cooldownReady),
    turnKey:state.turnKey,
    tradeOffersRemaining:Math.max(0,NEGOTIATION_LIMITS.maxTradeOffersPerTurn-tradeOffersUsed),
    blockedTradeSeatIds,
    ...NEGOTIATION_LIMITS
  };
}

function realTarget(room,actorSeatId,targetSeatId) {
  if(!targetSeatId||targetSeatId===actorSeatId)return null;
  const slot=room.slots?.find(candidate=>candidate.id===targetSeatId);
  const member=slot?.controller?room.members?.[slot.controller]:null;
  return room.game?.players?.some(player=>player.id===targetSeatId)&&member?.seatId===targetSeatId&&member.generation===slot.generation?slot:null;
}

function resourceList(value) {
  if(!Array.isArray(value)||value.length<1||value.length>2||value.some(resource=>!RESOURCE_SET.has(resource)))return null;
  const unique=[...new Set(value)];
  return unique.length===value.length?unique.sort((a,b)=>RESOURCES.indexOf(a)-RESOURCES.indexOf(b)):null;
}

function offeredTrade(room,actorSeatId,tradeId) {
  const trade=room.trade;
  if(!validId(tradeId)||!trade||trade.id!==tradeId||trade.status!=='offered'||trade.from!==actorSeatId)return null;
  const bundles=[trade.give,trade.get];
  if(bundles.some(bundle=>!bundle||typeof bundle!=='object'||Array.isArray(bundle)||!ownKeys(bundle,RESOURCES)||
    !Object.values(bundle).some(value=>Number.isSafeInteger(value)&&value>0)||Object.values(bundle).some(value=>!Number.isSafeInteger(value)||value<0||value>95)))return null;
  if(RESOURCES.some(resource=>(trade.give[resource]||0)>0&&(trade.get[resource]||0)>0))return null;
  return realTarget(room,actorSeatId,trade.to)?trade:null;
}

function normalizeIntent(room,actorSeatId,intent) {
  if(!intent||typeof intent!=='object'||Array.isArray(intent)||typeof intent.kind!=='string')return fail('Invalid negotiation intent');
  if(intent.kind==='interest') {
    if(!ownKeys(intent,['kind','wants','offers','to','replyToId'])||!['wants','offers','to','replyToId'].every(key=>Object.hasOwn(intent,key)))return fail('Invalid negotiation intent');
    const wants=resourceList(intent.wants),offers=resourceList(intent.offers);
    if(!wants||!offers||wants.some(resource=>offers.includes(resource)))return fail('Interest must name separate wanted and offered resources');
    const player=room.game?.players?.find(candidate=>candidate.id===actorSeatId);
    if(!player||offers.some(resource=>!Number.isSafeInteger(player.resources?.[resource])||player.resources[resource]<1))return fail('You do not own every offered resource',409);
    const to=intent.to??null,replyToId=intent.replyToId??null;
    if(to!==null&&!realTarget(room,actorSeatId,to))return fail('Choose another occupied playing seat');
    if(replyToId!==null&&!validId(replyToId))return fail('Invalid negotiation reply');
    return {success:true,intent:{kind:'interest',wants,offers,to,replyToId},targetSeatId:to};
  }
  if(intent.kind==='decline') {
    if(!ownKeys(intent,['kind','replyToId','to'])||!validId(intent.replyToId)||!realTarget(room,actorSeatId,intent.to))return fail('Invalid negotiation decline');
    return {success:true,intent:{kind:'decline',replyToId:intent.replyToId,to:intent.to},targetSeatId:intent.to};
  }
  if(intent.kind==='offer') {
    if(!ownKeys(intent,['kind','tradeId','replyToId'])||!['tradeId','replyToId'].every(key=>Object.hasOwn(intent,key)))return fail('Invalid negotiation offer');
    const replyToId=intent.replyToId??null;
    if(replyToId!==null&&!validId(replyToId))return fail('Invalid negotiation reply');
    const trade=offeredTrade(room,actorSeatId,intent.tradeId);
    if(!trade)return fail('Only your current offered trade can be announced',409);
    return {success:true,intent:{kind:'offer',tradeId:trade.id,replyToId},targetSeatId:trade.to,trade};
  }
  return fail('Invalid negotiation intent');
}

function intentFingerprint(actorSeatId,intent) {
  const publicTerms={...intent};delete publicTerms.replyToId;
  return JSON.stringify([actorSeatId,publicTerms]);
}

function rootMessage(state,id) {
  return state.root?.messages?.find(message=>message.id===id)||null;
}

function tradeCounterpartClosed(state,actorSeatId,targetSeatId) {
  return Boolean(targetSeatId&&state.closedTradeSeatIdsBySeat[actorSeatId]?.includes(targetSeatId));
}

function rootIsFresh(room,state,now) {
  return Boolean(state.root&&state.root.turnKey===state.turnKey&&state.root.expiresAt>now);
}

function interestReplyCompatible(room,parent,intent) {
  if(intent.kind!=='interest')return true;
  let parentOffers,parentWants;
  if(parent.intent.kind==='interest') {
    parentOffers=parent.intent.offers;parentWants=parent.intent.wants;
  } else if(parent.intent.kind==='offer') {
    const trade=offeredTrade(room,parent.actorSeatId,parent.intent.tradeId);
    if(!trade)return false;
    parentOffers=RESOURCES.filter(resource=>(trade.give[resource]||0)>0);
    parentWants=RESOURCES.filter(resource=>(trade.get[resource]||0)>0);
  } else return false;
  return Array.isArray(parentOffers)&&Array.isArray(parentWants)&&
    intent.wants.some(resource=>parentOffers.includes(resource))&&intent.offers.some(resource=>parentWants.includes(resource));
}

function replyContext(room,state,actorSeatId,targetSeatId,intent,now) {
  if(!rootIsFresh(room,state,now))return fail('Negotiation is no longer available',409);
  const parent=rootMessage(state,intent.replyToId);
  if(!parent)return fail('Negotiation reply target was not found',409);
  if(parent.actorSeatId===actorSeatId)return fail('You cannot reply to yourself',409);
  if(parent.intent.kind==='decline')return fail('A decline cannot receive replies',409);
  if(parent.targetSeatId!==null&&parent.targetSeatId!==actorSeatId)return fail('That negotiation was addressed to another player',403);
  if(targetSeatId!==parent.actorSeatId)return fail('Reply must address the player being answered',409);
  if(actorSeatId!==currentSeatId(room)&&targetSeatId!==currentSeatId(room))return fail('Negotiations must involve the active player',409);
  const depth=parent.depth+1;
  if(depth>NEGOTIATION_LIMITS.maxDepth)return fail('Negotiation reply depth is exhausted',429);
  if(!interestReplyCompatible(room,parent,intent))return fail('Interest reply must match the advertised resources',409);
  return {success:true,parent,depth};
}

function nameFor(room,seatId){return room.slots?.find(slot=>slot.id===seatId)?.name||'Player';}
function phrase(items){return items.length===1?items[0]:`${items[0]} or ${items[1]}`;}
function packPhrase(pack) {
  const parts=RESOURCES.filter(resource=>(pack?.[resource]||0)>0).map(resource=>`${pack[resource]} ${resource}`);
  return parts.length===1?parts[0]:parts.length===2?`${parts[0]} and ${parts[1]}`:`${parts.slice(0,-1).join(', ')}, and ${parts.at(-1)}`;
}

export function renderNegotiation(room,actorSeatId,intent,trade=null) {
  const actor=nameFor(room,actorSeatId);
  if(intent.kind==='interest') {
    const target=intent.to?` to ${nameFor(room,intent.to)}`:'';
    return `${actor} is looking for ${phrase(intent.wants)} and can offer ${phrase(intent.offers)}${target}.`;
  }
  if(intent.kind==='decline')return `${actor} declines ${nameFor(room,intent.to)}'s proposal.`;
  const actual=trade||room.trade;
  return `${actor} offers ${packPhrase(actual.give)} to ${nameFor(room,actual.to)} for ${packPhrase(actual.get)}.`;
}

/** Validate and prepare a single bounded public message without mutating the room. */
export function prepareNegotiation(room,actorSeatId,rawIntent,{id,now}) {
  const state=negotiationState(room),active=room.game?.phase==='playing'&&room.game?.turnPhase==='main'&&!room.game?.freeRoads&&!room.game?.yearOfPlentyPicks;
  if(!active)return fail('Negotiation is unavailable outside the main phase',409);
  const normalized=normalizeIntent(room,actorSeatId,rawIntent);if(!normalized.success)return normalized;
  const {intent,targetSeatId,trade}=normalized;
  if(intent.kind!=='decline'&&tradeCounterpartClosed(state,actorSeatId,targetSeatId))return fail('Negotiation with this player is closed for the turn',409);
  const isRoot=intent.replyToId===null;
  let rootId=id,parentId=null,depth=0,root;
  if(isRoot) {
    if(intent.kind==='decline')return fail('A decline must answer an existing negotiation');
    if(currentSeatId(room)!==actorSeatId)return fail('Only the active player can start a negotiation',409);
    if(state.rootStarted)return fail('A negotiation already started this turn',429);
    if(intent.kind==='interest'&&room.trade)return fail('Resolve the current trade before starting another negotiation',409);
    root={id,turnKey:state.turnKey,createdAt:now,expiresAt:now+NEGOTIATION_LIMITS.rootTtlMs,messages:[]};
  } else {
    const context=replyContext(room,state,actorSeatId,targetSeatId,intent,now);if(!context.success)return context;
    root=structuredClone(state.root);rootId=root.id;parentId=context.parent.id;depth=context.depth;
  }
  if(root.messages.length>=NEGOTIATION_LIMITS.maxMessagesPerRoot)return fail('Negotiation message budget is exhausted',429);
  const byActor=root.messages.filter(message=>message.actorSeatId===actorSeatId);
  if(byActor.length>=NEGOTIATION_LIMITS.maxMessagesPerSeat)return fail('Your negotiation message budget is exhausted',429);
  if(byActor.some(message=>message.intent.kind==='decline'))return fail('You already declined this negotiation',409);
  const lastPublishedAt=state.lastPublishedAtBySeat[actorSeatId];
  if(Number.isFinite(lastPublishedAt)&&now-lastPublishedAt<NEGOTIATION_LIMITS.cooldownMs)return fail('Negotiation cooldown is active',429);
  const fingerprint=intentFingerprint(actorSeatId,intent);
  if(root.messages.some(message=>message.fingerprint===fingerprint))return fail('Duplicate negotiation intent',409);
  const sequence=state.sequence+1,expiresAt=root.expiresAt;
  const metadata={id,rootId,parentId,depth,actorSeatId,turnKey:state.turnKey,createdAt:now,expiresAt,intent};
  const internal={...metadata,sequence,targetSeatId,fingerprint};
  root.messages.push(internal);
  let closedTradeSeatIdsBySeat=state.closedTradeSeatIdsBySeat;
  if(intent.kind==='decline')closedTradeSeatIdsBySeat={...closedTradeSeatIdsBySeat,
    [actorSeatId]:[...new Set([...(closedTradeSeatIdsBySeat[actorSeatId]||[]),targetSeatId])],
    [targetSeatId]:[...new Set([...(closedTradeSeatIdsBySeat[targetSeatId]||[]),actorSeatId])]};
  const nextState={...state,sequence,rootStarted:true,root,closedTradeSeatIdsBySeat,lastPublishedAtBySeat:{...state.lastPublishedAtBySeat,[actorSeatId]:now}};
  return {success:true,state:nextState,metadata,sequence,message:renderNegotiation(room,actorSeatId,intent,trade)};
}

function tradeFingerprint(trade) {
  const amounts=bundle=>RESOURCES.map(resource=>trade[bundle]?.[resource]||0);
  return JSON.stringify([trade.to,amounts('give'),amounts('get')]);
}

/** Record a validated real AI offer/counter in the bounded per-turn gate. */
export function recordAiTradeAction(room,actorSeatId) {
  const trade=room.trade;
  if(!trade||trade.from!==actorSeatId||!offeredTrade(room,actorSeatId,trade.id))return fail('Authoritative AI trade is unavailable',409);
  const state=negotiationState(room),prior=state.aiTradeActionsBySeat[actorSeatId]||{count:0,fingerprints:[]};
  if(tradeCounterpartClosed(state,actorSeatId,trade.to))return fail('Trading with this player is closed for the turn',409);
  const fingerprint=tradeFingerprint(trade);
  if(prior.fingerprints.includes(fingerprint))return fail('Duplicate AI trade terms this turn',409);
  if(prior.count>=NEGOTIATION_LIMITS.maxTradeOffersPerTurn)return fail('AI trade offer budget is exhausted for this turn',429);
  room.negotiationState={...state,aiTradeActionsBySeat:{...state.aiTradeActionsBySeat,
    [actorSeatId]:{count:prior.count+1,fingerprints:[...prior.fingerprints,fingerprint]}}};
  return {success:true};
}

function rootTerminalFor(room,state,seatId,now) {
  const root=state.root;
  if(!rootIsFresh(room,state,now))return true;
  const own=root.messages.filter(message=>message.actorSeatId===seatId);
  return own.some(message=>message.intent.kind==='decline');
}

/** Project only structured, actionable public negotiation records for one AI. */
export function readNegotiations(room,seatId,afterSequence,now) {
  const state=negotiationState(room),nextSequence=state.sequence;
  if(rootTerminalFor(room,state,seatId,now))return {negotiations:[],negotiationSequence:nextSequence,negotiationHasMore:false};
  const blocked=new Set(state.closedTradeSeatIdsBySeat[seatId]||[]);
  const messages=state.root.messages.filter(message=>message.sequence>afterSequence&&message.actorSeatId!==seatId&&!blocked.has(message.actorSeatId)&&message.intent.kind!=='decline'&&message.depth<=NEGOTIATION_LIMITS.maxDepth&&
    (message.targetSeatId===null||message.targetSeatId===seatId)&&
    !(message.intent.kind==='offer'&&!offeredTrade(room,message.actorSeatId,message.intent.tradeId)));
  const page=messages.slice(0,50).map(({id,rootId,parentId,depth,actorSeatId,turnKey,createdAt,expiresAt,intent,sequence})=>
    ({id,rootId,parentId,depth,actorSeatId,turnKey,createdAt,expiresAt,intent:structuredClone(intent),sequence}));
  return {negotiations:page,negotiationSequence:page.length<messages.length?page.at(-1).sequence:nextSequence,negotiationHasMore:messages.length>page.length};
}
