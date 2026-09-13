import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';

const fail = error => ({ success: false, error });
const resources = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export const actionNames = ['rollDice','discardCards','moveRobber','movePirate','chooseRobberCard','placeSettlement','placeRoad','placeShip','moveShip','placePort','claimWonder','buildWonder','attackFortress','upgradeToCity','buyDevCard','playDevCard','yearOfPlentyPick','bankTrade','proposeTrade','respondToTrade','cancelTrade','advanceSetup','endTurn','finishFreeRoads','resolveSeafarersChoice'];

/** One transactional authority for every transport. Never trust client setup flags. */
export function executeAction(game, playerId, type, payload = {}, dryRun = false) {
  if (!actionNames.includes(type)) return fail('Unknown action');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail('Invalid action payload');
  const index = game.players.findIndex(p => p.id === playerId);
  if (index < 0) return fail('Player not found');
  if (!['setup','playing'].includes(game.phase)) return fail('Game is not active');
  const current = index === game.currentPlayerIndex;
  if (!current && !['discardCards','respondToTrade'].includes(type) && !(type === 'resolveSeafarersChoice' && game.pendingChoice?.actorId === playerId)) return fail('Not your turn');
  const copy = structuredClone(game);
  try {
    let result;
    if (copy.pendingChoice) {
      if (type !== 'resolveSeafarersChoice') return fail('Finish the current choice first');
      result = SF.resolveSeafarersChoice(copy, playerId, payload.choiceId, payload.optionId);
    } else if (game.phase === 'setup' && game.turnPhase === 'portPlacement') {
      if (type !== 'placePort') return fail('Place the drawn port before settling');
      result = SF.placePort(copy, playerId, payload.edgeKey);
    } else if (game.phase === 'setup') {
      if (!current) return fail('Not your turn');
      const step = copy.setupAction || { settlement: null, road: false };
      if (type === 'placeSettlement' && !step.settlement) {
        if (!Object.hasOwn(copy.vertices, payload.vertexKey)) return fail('Invalid vertex');
        result = G.placeSettlement(copy, playerId, payload.vertexKey);
        if (result.success) step.settlement = payload.vertexKey;
      } else if (type === 'placeRoad' && step.settlement && !step.road) {
        if (!Object.hasOwn(copy.edges, payload.edgeKey)) return fail('Invalid edge');
        result = G.placeRoad(copy, playerId, payload.edgeKey, true, step.settlement);
        if (result.success) step.road = true;
      } else if (type === 'placeShip' && step.settlement && !step.road) {
        if (!Object.hasOwn(copy.edges, payload.edgeKey)) return fail('Invalid edge');
        result = SF.placeShip(copy, playerId, payload.edgeKey, { setup: true, lastSettlement: step.settlement });
        if (result.success) step.road = true;
      } else if (type === 'advanceSetup' && step.settlement && step.road) {
        result = G.advanceSetup(copy, playerId);
        copy.setupAction = null;
      } else return fail('Place one settlement and its road before advancing setup');
      if (type !== 'advanceSetup') copy.setupAction = step;
    } else {
      const allowed = {
        roll: ['rollDice','playDevCard'],
        discard: ['discardCards'],
        robber: ['moveRobber','movePirate'],
        robberPick: ['chooseRobberCard'],
        yearOfPlenty: ['yearOfPlentyPick'],
        main: ['placeSettlement','placeRoad','placeShip','moveShip','claimWonder','buildWonder','attackFortress','upgradeToCity','buyDevCard','playDevCard','bankTrade','proposeTrade','respondToTrade','cancelTrade','endTurn'],
      };
      const resolvingPlenty = game.yearOfPlentyPicks > 0;
      const resolvingRoads = game.freeRoads > 0;
      if (resolvingPlenty && type !== 'yearOfPlentyPick') return fail('Finish choosing resources first');
      if (!(resolvingPlenty && type === 'yearOfPlentyPick') && !(resolvingRoads && ['placeRoad','placeShip','finishFreeRoads'].includes(type)) && !allowed[game.turnPhase]?.includes(type)) return fail('Action is unavailable in this phase');
      if (game.freeRoads > 0 && !['placeRoad','placeShip','finishFreeRoads'].includes(type)) return fail('Finish placing free routes first');
      if (['placeSettlement','upgradeToCity'].includes(type) && !Object.hasOwn(copy.vertices,payload.vertexKey)) return fail('Invalid vertex');
      if (['placeRoad','placeShip'].includes(type) && !Object.hasOwn(copy.edges,payload.edgeKey)) return fail('Invalid edge');
      switch (type) {
        case 'finishFreeRoads':
          if(!resolvingRoads||Object.keys(copy.edges).some(edge=>G.canPlaceRoad(copy,playerId,edge,false,null).valid || SF.canPlaceShip(copy,playerId,edge).valid))return fail('Place the remaining free route');
          copy.freeRoads=0;result={success:true};break;
        case 'rollDice': result = G.rollDice(copy,playerId); break;
        case 'discardCards': result = G.discardCards(copy,playerId,payload.resources); break;
        case 'moveRobber': result = G.moveRobber(copy,playerId,payload.hexKey,payload.stealFromPlayerId); break;
        case 'movePirate': result = SF.movePirate(copy,playerId,payload.hexKey,payload.stealFromPlayerId,payload.stealType); break;
        case 'chooseRobberCard': result = G.chooseRobberCard(copy,playerId,payload.cardId); break;
        case 'placeSettlement': result = G.placeSettlement(copy,playerId,payload.vertexKey); break;
        case 'placeRoad': result = G.placeRoad(copy,playerId,payload.edgeKey,false,null); break;
        case 'placeShip': result = SF.placeShip(copy,playerId,payload.edgeKey); break;
        case 'moveShip': result = SF.moveShip(copy,playerId,payload.fromEdgeKey,payload.toEdgeKey); break;
        case 'claimWonder': result = SF.claimWonder(copy,playerId,payload.wonderId); break;
        case 'buildWonder': result = SF.buildWonder(copy,playerId); break;
        case 'attackFortress': result = G.endTurn(copy,playerId,{attackFortress:true}); break;
        case 'upgradeToCity': result = G.upgradeToCity(copy,playerId,payload.vertexKey); break;
        case 'buyDevCard': result = G.buyDevCard(copy,playerId); break;
        case 'playDevCard': result = G.playDevCard(copy,playerId,payload.cardType,payload.params); break;
        case 'yearOfPlentyPick': result = G.yearOfPlentyPick(copy,playerId,payload.resource); break;
        case 'bankTrade': result = G.bankTrade(copy,playerId,payload.giveResource,payload.giveAmount,payload.getResource); break;
        case 'proposeTrade': result = G.proposeTrade(copy,playerId,payload.offer,payload.request); break;
        case 'respondToTrade': result = G.respondToTrade(copy,playerId,payload.accept); break;
        case 'cancelTrade': result = G.cancelTrade(copy,playerId); break;
        case 'endTurn': result = G.endTurn(copy,playerId); break;
      }
    }
    if (!result?.success) return result || fail('Invalid action');
    G.refreshPlayerTradingAllowed(copy);
    for (const p of copy.players) {
      if (resources.some(r => !Number.isSafeInteger(p.resources[r]) || p.resources[r] < 0)) return fail('Invalid resource balance');
    }
    if(!dryRun){Object.keys(game).forEach(key => delete game[key]);Object.assign(game,copy);}
    return result;
  } catch {
    return fail('Invalid action parameters');
  }
}

/** Only public observations and the authenticated seat's private cards. */
export function playerView(game, playerId) {
  const view = G.getPlayerView(game,playerId);
  delete view.pendingRobberPick;
  // Exact bank deltas reveal another seat's private discard composition.
  // Clients need availability to choose legal exchanges, not each pile's size.
  view.bankAvailable = Object.fromEntries(resources.map(resource => [resource, (game.bank?.[resource] || 0) > 0]));
  view.bankTotal = resources.reduce((sum, resource) => sum + (game.bank?.[resource] || 0), 0);
  delete view.bank;
  // Spectators and other seats never receive hidden cards, including at game end.
  view.players = view.players.map((p,index) => {
    const raw = game.players[index];
    if (raw.id === playerId) return p;
    return {...p, resources: Object.values(raw.resources).reduce((a,b)=>a+b,0),
      developmentCards: raw.developmentCards.length, newDevCards: raw.newDevCards.length, hiddenVictoryPoints: 0};
  });
  return view;
}

export function legalActions(game,playerId) {
  const choices = [];
  if (game.pendingChoice) {
    if (game.pendingChoice.actorId !== playerId) return choices;
    return game.pendingChoice.options.map(option => ({ type: 'resolveSeafarersChoice', payload: { choiceId: game.pendingChoice.id, optionId: option.id } }));
  }
  if(!['setup','playing'].includes(game.phase)||game.players[game.currentPlayerIndex]?.id!==playerId)return choices;
  if (game.phase === 'setup' && game.turnPhase === 'portPlacement') return SF.legalPortPlacements(game,playerId);
  const player=game.players[game.currentPlayerIndex];
  const add = (type,payload={}) => {
    if (executeAction(game,playerId,type,payload,true).success) choices.push({type,payload});
  };
  // Do not sample dice, hidden cards, or steals when enumerating possible actions.
  if (game.phase === 'playing' && game.turnPhase === 'roll' && !game.freeRoads && !game.yearOfPlentyPicks && game.players[game.currentPlayerIndex]?.id === playerId) choices.push({type:'rollDice',payload:{}});
  const building=game.phase==='setup'||game.turnPhase==='main';
  if(building)for (const vertexKey of Object.keys(game.vertices)) {
    const setupStep = game.setupAction || { settlement:null, road:false };
    if ((game.phase === 'setup' && !setupStep.settlement || game.phase === 'playing' && !game.freeRoads && !game.yearOfPlentyPicks &&
        player.resources.brick && player.resources.lumber && player.resources.wool && player.resources.grain) &&
        G.canPlaceSettlement(game,playerId,vertexKey,game.phase==='setup').valid) choices.push({type:'placeSettlement',payload:{vertexKey}});
    if(player.resources.ore>=3&&player.resources.grain>=2)add('upgradeToCity',{vertexKey});
  }
  if(!game.yearOfPlentyPicks&&(game.phase==='setup'||game.freeRoads||(game.turnPhase==='main'&&player.resources.brick&&player.resources.lumber)))for (const edgeKey of Object.keys(game.edges)) {
    const step = game.setupAction || { settlement:null, road:false };
    if (game.phase === 'setup' && (!step.settlement || step.road)) continue;
    if (G.canPlaceRoad(game,playerId,edgeKey,game.phase==='setup',step.settlement).valid) choices.push({type:'placeRoad',payload:{edgeKey}});
  }
  if (SF.isSeafarers(game) && (game.phase === 'setup' || game.freeRoads || (game.turnPhase === 'main' && player.resources.lumber && player.resources.wool))) {
    for (const edgeKey of Object.keys(game.edges)) {
      const step = game.setupAction || { settlement: null, road: false };
      if (game.phase === 'setup' && (!step.settlement || step.road)) continue;
      if (SF.canPlaceShip(game, playerId, edgeKey, { setup: game.phase === 'setup', lastSettlement: step.settlement }).valid) choices.push({ type: 'placeShip', payload: { edgeKey } });
    }
  }
  if (SF.isSeafarers(game) && game.phase === 'playing' && game.turnPhase === 'main' && !game.freeRoads && !game.yearOfPlentyPicks) {
    choices.push(...SF.legalShipMoves(game, playerId));
    for (const wonderId of SF.availableWonders(game)) if (SF.canClaimWonder(game,playerId,wonderId).valid) choices.push({type:'claimWonder',payload:{wonderId}});
    if (SF.canBuildWonder(game,playerId).valid) choices.push({type:'buildWonder',payload:{}});
  }
  for (const type of ['advanceSetup','finishFreeRoads']) add(type);
  if (game.phase === 'playing' && game.turnPhase === 'main' && !game.freeRoads && !game.yearOfPlentyPicks && !game.pendingRobberPick && !game.pendingChoice) {
    choices.push({ type: 'endTurn', payload: {} });
    if (SF.canAttackFortress(game,playerId).valid) choices.push({ type: 'attackFortress', payload: {} });
  }
  if (game.phase === 'playing' && game.turnPhase === 'main' && game.players[game.currentPlayerIndex]?.id === playerId && game.freeRoads === 0 && !game.yearOfPlentyPicks) {
    const p = game.players.find(p=>p.id===playerId);
    if (game.devCardDeck.length && p.resources.ore && p.resources.grain && p.resources.wool) choices.push({type:'buyDevCard',payload:{}});
  }
  for (const resource of resources) {
    add('yearOfPlentyPick',{resource});
    for (const getResource of resources) if (getResource!==resource) add('bankTrade',{giveResource:resource,giveAmount:G.getTradeRatio(game,game.players.findIndex(p=>p.id===playerId),resource),getResource});
  }
  for (const cardType of ['knight','roadBuilding','yearOfPlenty']) add('playDevCard',{cardType});
  for (const resource of resources) add('playDevCard',{cardType:'monopoly',params:{resource}});
  if (game.phase === 'playing' && game.turnPhase === 'robber' && game.players[game.currentPlayerIndex]?.id===playerId) {
    for (const hexKey of Object.keys(game.hexes)) if (hexKey!==game.robber && SF.canMoveRobber(game,hexKey).valid) {
      const victims = G.getPlayersOnHex(game,hexKey,game.currentPlayerIndex).filter(index=>Object.values(game.players[index]?.resources||{}).some(n=>n>0));
      if (!victims.length) choices.push({type:'moveRobber',payload:{hexKey}});
      else for(const index of victims) choices.push({type:'moveRobber',payload:{hexKey,stealFromPlayerId:game.players[index].id}});
    }
    if (SF.isSeafarers(game)) choices.push(...SF.legalPirateMoves(game, playerId));
  }
  if (game.phase === 'playing' && game.turnPhase === 'robberPick' && game.pendingRobberPick?.thiefId===playerId) {
    for (const card of game.pendingRobberPick.cards) add('chooseRobberCard',{cardId:card.id});
  }
  return choices;
}
