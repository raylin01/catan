import {createHash} from 'node:crypto';
import {createAgentBoard} from './agentBoard.js';
import {hexKey} from './gameLogic.js';
import {describeAgentActions} from './agentFacts.js';
import {RESOURCE_CARDS,ALL_HAND_CARDS,combinedHand,hasCitiesKnights} from '../shared/cardTypes.js';
import {scenarioFor,victoryGoal} from '../shared/scenarios.js';
import {projectNegotiations,projectNegotiationWindow} from '../bridge/negotiation-policy.js';

const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>source?.[key]!==undefined).map(key=>[key,structuredClone(source[key])]));
const counts=(value,keys=ALL_HAND_CARDS)=>Object.fromEntries(keys.filter(key=>Number.isSafeInteger(value?.[key])&&value[key]>=0).map(key=>[key,value[key]]));
const total=value=>typeof value==='number'?value:Object.values(counts(value)).reduce((sum,n)=>sum+n,0);
const count=value=>Array.isArray(value)?value.length:Number.isSafeInteger(value)?value:0;
const list=value=>Array.isArray(value)?value:[];
const tracks=value=>counts(value,['science','trade','politics']);
const deckCard=card=>typeof card==='string'?card:pick(card,['id','type']);

/** Binds an executable choice to the authenticated seat/control/revision only.
 * No hidden-state hash or credential enters this public identifier. */
export function agentDecisionId(view) {
  return 'd_'+createHash('sha256').update(JSON.stringify([1,view.seatId,view.generation,view.controlEpoch??null,view.revision])).digest('hex').slice(0,24);
}

function publicPlayers(game) {
  return list(game.players).map((player,index)=>({
    id:player.id,label:`Player ${index+1}`,
    ...pick(player,['victoryPoints','knightsPlayed','roadLength','hasLongestRoad','hasLargestArmy','settlements','cities','roads','ships','warships','cloth','bonusVictoryPoints','defenderPoints','wallSupply']),
    cards:typeof player.resources==='number'?player.resources:total(combinedHand(player)),
    developmentCards:count(player.developmentCards)+count(player.newDevCards),
    ...(game.citiesKnights?{progressCards:count(player.progressCards),progressCardsByTrack:tracks(player.progressCardColors),cityImprovements:tracks(player.cityImprovements),publicVictoryCards:list(player.progressVictoryCards).map(deckCard)}:{})
  }));
}

function selfState(game,seatId) {
  const player=game.players?.find(player=>player.id===seatId);
  if(!player||typeof player.resources!=='object')return null;
  return {hand:counts(combinedHand(player)),
    developmentCards:list(player.developmentCards).map(deckCard),newDevelopmentCards:list(player.newDevCards).map(deckCard),
    hiddenVictoryPoints:player.hiddenVictoryPoints||0,
    ...(game.citiesKnights?{progressCards:list(player.progressCards).map(card=>({...pick(card,['id','type']),track:card.color}))}:{})};
}

function choices(view) {
  const source=view.decision,choice=view.gameState?.pendingChoice;
  if(!source)return null;
  const result=pick(source,['type','count','choiceId','kind']);
  if(source.type==='discardCards')result.availableCards=counts(source.resources);
  if(source.type==='chooseCards') {
    result.availableCards=counts(source.cards);result.allowedCards=list(source.allowedCards).filter(card=>ALL_HAND_CARDS.includes(card));
  }
  if(choice?.actorId===view.seatId)result.choiceKind=choice.kind;
  return result;
}

function trades(view) {
  const own=view.gameState?.players?.find(player=>player.id===view.seatId),hand=combinedHand(own);
  return list(view.trades??(view.trade?[view.trade]:[])).map(trade=>{
    const result={...pick(trade,['id','from','to','status','counterOf']),give:counts(trade.give),get:counts(trade.get)};
    if(trade.from===view.seatId||trade.to===view.seatId) {
      const pay=trade.from===view.seatId?result.give:result.get,receive=trade.from===view.seatId?result.get:result.give;
      result.youPay=pay;result.youReceive=receive;
      result.youCanPay=Object.entries(pay).every(([card,n])=>(hand[card]||0)>=n);
      // This is conditional arithmetic, never a claim about the partner's hand.
      if(result.youCanPay)result.handIfConfirmed=Object.fromEntries(ALL_HAND_CARDS.filter(card=>card in hand||card in pay||card in receive).map(card=>[card,(hand[card]||0)-(pay[card]||0)+(receive[card]||0)]));
    }
    return result;
  });
}

function expansionState(game,ids) {
  const result={};
  const tileLocation=key=>ids.tiles[key]??(typeof key==='string'&&key.startsWith('frame:')?{frame:key.slice(6)}:null);
  const ck=game.citiesKnights;
  if(ck)result.citiesKnights={
    ...pick(ck,['turnSerial','eventDie']),barbarian:pick(ck.barbarian,['position','max','attacked']),
    commodityAvailable:Object.fromEntries(['paper','coin','cloth'].map(card=>[card,ck.commodityBank?.[card]===true])),
    progressCardsRemaining:tracks(ck.progressDecks),
    merchant:ck.merchant?{owner:ck.merchant.ownerId,tile:ids.tiles[ck.merchant.hexKey]??null}:null,
    merchantFleet:ck.merchantFleet?pick(ck.merchantFleet,['ownerId','type']):null,
    harborOffers:ck.harborOffers?pick(ck.harborOffers,['ownerId','offeredTo']):null,
    ...(ck.robberStart?{robberStart:tileLocation(ck.robberStart)}:{}),
    ...(ck.pirateStart?{pirateStart:tileLocation(ck.pirateStart)}:{}),
    ...(ck.lastBarbarianAttack?{lastBarbarianAttack:pick(ck.lastBarbarianAttack,['turnSerial','defense','cities','repelled','defenderIds','pillagedPlayerIds'])}:{})
  };
  const sf=game.seafarers;
  if(sf)result.seafarers={
    ...pick(sf,['scenario','goal','shipMovedThisPhase','currentPortType','clothSupply','fleetActive','fleetIndex']),
    fleetRoute:list(sf.fleetRoute).map(hex=>({tile:ids.tiles[hexKey(hex.q,hex.r)]??null,...(hex.noAttack?{noAttack:true}:{})})),
    homeRegions:structuredClone(sf.homeRegions??{}),bonusRegions:structuredClone(sf.bonusRegions??{}),
    villageRelations:structuredClone(sf.villageRelations??{}),
    wonders:list(sf.wonders).map(wonder=>pick(wonder,['id','ownerId','level'])),
    ...(sf.lastFortressAttack?{lastFortressAttack:pick(sf.lastFortressAttack,['playerId','die','lostShips','fortressLairs'])}:{})
  };
  return result;
}

// Costs, balances and rule explanations often repeat across every location.
// Factor only exactly equal facts; every candidate and its distinct facts stay.
function compactActions(source) {
  const actions=structuredClone(source),actionDefaults={};
  for(const type of new Set(actions.map(action=>action.type))) {
    const group=actions.filter(action=>action.type===type);
    if(group.length<2)continue;
    for(const key of ['cost','handAfterCost','building','productionBasis','choice','outcome','scope']) {
      const value=group[0].facts[key];
      if(value===undefined||!group.every(action=>JSON.stringify(action.facts[key])===JSON.stringify(value)))continue;
      (actionDefaults[type]??={})[key]=value;
      for(const action of group)delete action.facts[key];
    }
  }
  return {actions,actionDefaults};
}

function recentEvents(view,ids) {
  return list(view.events).filter(event=>event.actorSeatId&&event.type!=='chat').slice(-8).map(event=>{
    const result=pick(event,['id','type','actorSeatId']);const details=event.details||{};
    if(details.dice)result.dice=pick(details.dice,['die1','die2','total','eventDie']);
    if(details.trade)result.trade={...pick(details.trade,['id','from','to','status','counterOf']),give:counts(details.trade.give),get:counts(details.trade.get)};
    if(details.bankTrade)result.bankTrade={give:counts(details.bankTrade.give),get:counts(details.bankTrade.get)};
    if(details.devCard)result.devCard=pick(details.devCard,['cardType']);
    if(details.monopoly)result.monopoly=pick(details.monopoly,['resource']);
    if(details.yearOfPlenty)result.yearOfPlenty=pick(details.yearOfPlenty,['resource','remainingPicks']);
    if(details.freeRoute)result.freeRoute={kind:details.freeRoute.kind,edge:ids.edges[details.freeRoute.edgeKey],remaining:details.freeRoute.remaining};
    if(details.robber)result.robber={tile:ids.tiles[details.robber.hexKey],victim:details.robber.victimSeatId};
    return result;
  });
}

/** The shared model-facing boundary. Call ONLY with an authorized room view.
 * Browsers retain their normal view; providers and HTTP clients share this DTO.
 * All display names, chat prose, engine aliases, and control credentials stay out. */
export function createAgentObservation(view) {
  const game=view.gameState;
  const base={format:'catan-agent-v1',seatId:view.seatId??null,paused:!!view.paused,closed:!!view.closed};
  if(!game)return {...base,phase:'waiting',players:list(view.slots).map((slot,index)=>({id:slot.id,label:`Player ${index+1}`,occupied:!!slot.occupied,ready:!!slot.ready})),actions:[],decision:null};
  const canonical=createAgentBoard(game),{board,ids}=canonical;
  const facts=describeAgentActions(view,canonical);
  const options=view.gameOptions??game.gameOptions??{},scenario=scenarioFor(options.scenario);
  const observation={...base,phase:game.phase,
    rules:{...pick(options,['extension56','expansions','scenario']),victoryPoints:victoryGoal(options),
      ...(scenario?{scenarioObjective:scenario.description}:{}),
      resources:hasCitiesKnights(game)?ALL_HAND_CARDS:RESOURCE_CARDS,
      production:'Dice frequencies are out of 36; resource production assumes an unblocked tile and sufficient bank supply.',
      missingFields:'Absent piece/flag means empty/false. Concealed card identities and unexplored terrain are unknown.'},
    turn:{player:game.players?.[game.currentPlayerIndex]?.id,phase:game.turnPhase,
      ...pick(game,['turnRole','setupPhase','freeRoads','yearOfPlentyPicks','hasRolledThisTurn','devCardPlayedThisTurn','playerTradingAllowed']),
      ...(game.setupAction?{setup:{settlement:ids.vertices[game.setupAction.settlement]??null,routePlaced:!!game.setupAction.road}}:{}),
      ...(game.productionPlayerIndex!==undefined?{rollingPlayer:game.players?.[game.productionPlayerIndex]?.id}:{})},
    decision:choices(view),self:selfState(game,view.seatId),players:publicPlayers(game),board,
    awards:{longestRoad:{holder:game.players?.[game.longestRoadPlayer]?.id??null,length:game.longestRoadLength},
      largestArmy:{holder:game.players?.[game.largestArmyPlayer]?.id??null,size:game.largestArmySize}},
    bank:{available:Object.fromEntries(RESOURCE_CARDS.map(card=>[card,game.bankAvailable?.[card]===true])),developmentCardsRemaining:count(game.devCardDeck),tradeRatios:counts(game.tradeRatios)},
    ...expansionState(game,ids),...compactActions(facts.actions),
    opportunities:{horizon:facts.horizon,items:facts.opportunities},trades:trades(view),recentEvents:recentEvents(view,ids)
  };
  if(game.diceRoll)observation.lastRoll=Array.isArray(game.diceRoll)?[...game.diceRoll]:pick(game.diceRoll,['die1','die2','total']);
  if(view.rollEvent)observation.lastProduction={id:view.rollEvent.id,gains:counts(view.rollEvent.gains)};
  if(game.pendingChoice)observation.pendingChoice={actor:game.pendingChoice.actorId,kind:game.pendingChoice.kind,
    ...pick(game.pendingChoice,['sourcePlayerId','offeredResource'])};
  if(view.robberPick)observation.robberPick={thief:view.robberPick.thiefId,victim:view.robberPick.victimId,count:view.robberPick.count};
  if(game.winner||game.winners)observation.winners=game.winners??[game.winner];
  if(view.negotiation) {
    observation.negotiation=projectNegotiationWindow(view);
    observation.negotiations=projectNegotiations(view,view.negotiations);
  }
  // Proposals have already crossed validateChatProposals in the reader boundary.
  // Re-project even here so unknown extension fields cannot reach gameplay.
  if(view.proposals?.length)observation.proposals=view.proposals.slice(-24).map(proposal=>{
    const clean=pick(proposal,['type','sourceMessageId','authorSeatId','to','tradeId','direction']);
    if(proposal.resources)clean.resources=list(proposal.resources).filter(card=>ALL_HAND_CARDS.includes(card));
    if(proposal.give)clean.give=counts(proposal.give);
    if(proposal.get)clean.get=counts(proposal.get);
    for(const [key,map]of [['vertexKey',ids.vertices],['edgeKey',ids.edges],['hexKey',ids.tiles]])if(proposal[key]&&map[proposal[key]])clean[key.replace('Key','')]=map[proposal[key]];
    return clean;
  });
  return observation;
}

export function agentEnvelope(view) {
  if(!view.success)return view;
  return {success:true,control:{...pick(view,['revision','generation','controlEpoch']),decisionId:agentDecisionId(view)},observation:createAgentObservation(view)};
}
