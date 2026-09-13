import * as G from './gameLogic.js';
import * as SF from './seafarersCore.js';
import * as CK from './citiesKnightsCore.js';

const fail = error => ({success:false,error});
const resources = ['brick','lumber','wool','grain','ore'];
const cardOption = (id,label=id,more={}) => ({id,label,...more});
const choose = (game,actorId,kind,label,options,context={}) => {
  if(options.length) CK.enqueueChoice(game,{kind:`card:${kind}`,actorId,label,options,context});
};
const actor = (game,id) => game.players.find(player=>player.id===id);
const ownVertices = (game,id,building=null) => Object.keys(game.vertices).filter(key=>game.vertices[key]?.owner===CK.playerIndex(game,id) && (!building || game.vertices[key]?.building===building));
const adjacentDistinct = (game,id,terrain) => new Set(ownVertices(game,id).flatMap(key=>G.getVertexAdjacentHexes(game,key).filter(hex=>hex.terrain===terrain).map(hex=>G.hexKey(hex.q,hex.r))));
const cardOptions = (player,allowed=CK.CARD_TYPES) => allowed.filter(type=>CK.cardBalance(player,type)>0).map(type=>cardOption(type,type,{cardType:type}));
const progressOptions = player => player.progressCards.filter(card=>!CK.isVpProgressCard(card)).map(card=>cardOption(card.id,`${card.color}: ${card.type}`,{cardId:card.id,cardType:card.type,color:card.color}));
const canApply = (game,action) => action(structuredClone(game)).success;
function stealRandom(game,from,to) {
  const types=CK.CARD_TYPES.flatMap(type=>Array(CK.cardBalance(from,type)).fill(type));
  if(!types.length)return null;
  const type=types[Math.floor(Math.random()*types.length)];
  CK.moveCard(game,from,to,type,1);return type;
}
function bundleChoice(game,kind,playerId,label,count,available,context={}) {
  const allowedCards=Object.keys(available).filter(type=>available[type]>0);
  CK.enqueueChoice(game,{kind:`card:${kind}`,actorId:playerId,label,selection:'cards',count,
    allowedCards,availableCards:available,options:[],context});
}
function receiveBank(game,player,type,count) { return CK.moveCard(game,'bank',player,type,Math.min(count,CK.bankBalance(game,type))); }
function discOptions(game) { return Object.entries(game.hexes).filter(([,hex])=>hex.number!=null && ![2,6,8,12].includes(hex.number)).map(([key,hex])=>cardOption(key,`${hex.number}`,{hexKey:key,number:hex.number})); }

export function playProgressCard(game,playerId,cardId) {
  if(!CK.isCitiesKnights(game)||game.phase!=='playing'||game.players[game.currentPlayerIndex]?.id!==playerId||game.pendingChoice)return fail('Progress card cannot be played now');
  const player=actor(game,playerId), card=player.progressCards.find(value=>value.id===cardId);
  if(!card)return fail('Progress card is unavailable');
  if(card.type==='alchemy' ? game.turnPhase!=='roll' : game.turnPhase!=='main')return fail('Card cannot be played in this phase');
  // The card is returned to the bottom of its own color deck when played.
  CK.returnProgress(game,player,cardId);
  const state=game.citiesKnights;
  switch(card.type) {
    case 'alchemy': choose(game,playerId,'alchemyRed','Choose the red production die',[1,2,3,4,5,6].map(n=>cardOption(String(n),String(n),{die:n})));break;
    case 'crane': choose(game,playerId,'crane','Choose an improvement for the Crane',Object.keys(CK.TRACKS).flatMap(track=>
      CK.ownCityKeys(game,playerId).filter(vertexKey=>canApply(game,copy=>CK.improveCity(copy,playerId,track,vertexKey,1)))
        .map(vertexKey=>cardOption(`${track}:${vertexKey}`,`${track} at city`,{track,vertexKey}))));break;
    case 'engineering': choose(game,playerId,'engineering','Choose a city for a free wall',CK.ownCityKeys(game,playerId).filter(key=>canApply(game,copy=>CK.buildCityWall(copy,playerId,key,true)))
      .map(key=>cardOption(key,'Build wall',{vertexKey:key})));break;
    case 'invention': choose(game,playerId,'inventionFirst','Choose the first number disc',discOptions(game));break;
    case 'irrigation': receiveBank(game,player,'grain',2*adjacentDistinct(game,playerId,'fields').size);break;
    case 'medicine': choose(game,playerId,'medicine','Choose a settlement to upgrade',ownVertices(game,playerId,'settlement').filter(key=>canApply(game,copy=>G.upgradeToCity(copy,playerId,key,{grain:1,ore:2})))
      .map(key=>cardOption(key,'Upgrade settlement',{vertexKey:key})));break;
    case 'mining': receiveBank(game,player,'ore',2*adjacentDistinct(game,playerId,'mountains').size);break;
    case 'roadBuilding': game.freeRoads+=2;break;
    case 'smithing': choose(game,playerId,'smithingFirst','Choose a knight to promote, or finish',[
      cardOption('finish','Finish'),...Object.keys(state.knights).filter(key=>state.knights[key].ownerId===playerId&&canApply(game,copy=>CK.promoteKnight(copy,playerId,key,true)))
        .map(key=>cardOption(key,'Promote knight',{vertexKey:key}))]);break;
    case 'commercialHarbor': state.harborOffers={ownerId:playerId,offeredTo:[]};break;
    case 'guildDues': choose(game,playerId,'guildTarget','Choose a player with more points',game.players.filter(p=>p.id!==playerId&&p.victoryPoints>player.victoryPoints&&CK.cardCount(p)>0).map(p=>cardOption(p.id,p.name,{targetPlayerId:p.id})));break;
    case 'merchant': choose(game,playerId,'merchant','Choose a resource hex beside your building',[
      ...new Set(ownVertices(game,playerId).flatMap(key=>G.getVertexAdjacentHexes(game,key).filter(hex=>hex.resource).map(hex=>G.hexKey(hex.q,hex.r))))]
      .map(key=>cardOption(key,game.hexes[key].terrain,{hexKey:key,resource:game.hexes[key].resource})));break;
    case 'merchantFleet': choose(game,playerId,'merchantFleet','Choose a card type for 2:1 supply trade',CK.CARD_TYPES.map(type=>cardOption(type,type,{cardType:type})));break;
    case 'resourceMonopoly': choose(game,playerId,'resourceMonopoly','Choose a resource',resources.map(type=>cardOption(type,type,{resource:type})));break;
    case 'tradeMonopoly': choose(game,playerId,'tradeMonopoly','Choose a commodity',CK.COMMODITIES.map(type=>cardOption(type,type,{commodity:type})));break;
    case 'diplomacy': choose(game,playerId,'diplomacy','Choose an open road or ship',openRoutes(game).map(({key,kind})=>cardOption(key,`Remove ${kind}`,{edgeKey:key,kind})));break;
    case 'encouragement': for(const [key,knight] of Object.entries(state.knights))if(knight.ownerId===playerId&&!knight.active)CK.activateKnight(game,playerId,key,true);break;
    case 'espionage': choose(game,playerId,'espionageTarget','Choose a player whose progress cards you will inspect',game.players.filter(p=>p.id!==playerId).map(p=>cardOption(p.id,p.name,{targetPlayerId:p.id})));break;
    case 'intrigue': choose(game,playerId,'intrigue','Choose an opposing knight on your route',Object.keys(state.knights).filter(key=>state.knights[key].ownerId!==playerId&&CK.hasOwnRouteAt(game,playerId,key))
      .map(key=>cardOption(key,'Displace knight',{vertexKey:key})));break;
    case 'sabotage': {
      for(const target of game.players)if(target.id!==playerId&&target.victoryPoints>=player.victoryPoints){
        const count=Math.floor(CK.cardCount(target)/2);if(count)bundleChoice(game,'sabotageCards',target.id,'Choose cards to discard for Sabotage',count,CK.readHand(target));
      }break;
    }
    case 'taxation': if(state.barbarian.attacked)
      choose(game,playerId,'taxation','Choose a different hex for the robber',Object.keys(game.hexes).filter(key=>key!==game.robber&&SF.canMoveRobber(game,key).valid).map(key=>cardOption(key,'Move robber',{hexKey:key})));break;
    case 'treason': choose(game,playerId,'treasonTarget','Choose an opponent to lose a knight',game.players.filter(p=>p.id!==playerId&&Object.values(state.knights).some(k=>k.ownerId===p.id))
      .map(p=>cardOption(p.id,p.name,{targetPlayerId:p.id})));break;
    case 'wedding': for(const target of game.players)if(target.id!==playerId&&target.victoryPoints>player.victoryPoints){
      const count=Math.min(2,CK.cardCount(target));if(count)bundleChoice(game,'weddingCards',target.id,'Choose cards to give for Wedding',count,CK.readHand(target),{recipientId:playerId});
    }break;
    default:return fail('Unknown progress card');
  }
  G.checkWinner(game);
  return {success:true,card:card.type};
}

function openRoutes(game) {
  return Object.entries(game.edges).filter(([,edge])=>edge.road||edge.ship).filter(([key,edge])=>{
    const [a,b]=SF.edgeEndpoints(key);
    const owner=game.players[edge.owner];
    return [a,b].some(vertex=>{
      const building=SF.buildingAt(game,vertex)?.vertex;
      const knight=CK.knightAt(game,vertex);
      return SF.incidentRoutes(game,vertex,edge.owner).length===1 && building?.owner!==edge.owner && knight?.ownerId!==owner?.id;
    });
  }).map(([key,edge])=>({key,kind:edge.ship?'ship':'road'}));
}

export function offerCommercialHarbor(game,playerId,targetPlayerId,resource) {
  const state=game.citiesKnights, offer=state?.harborOffers;
  if(!offer||offer.ownerId!==playerId||game.turnPhase!=='main'||game.players[game.currentPlayerIndex]?.id!==playerId)return fail('Commercial Harbor is unavailable');
  if(offer.offeredTo.includes(targetPlayerId)||targetPlayerId===playerId)return fail('That player has already received an offer');
  const target=actor(game,targetPlayerId),source=actor(game,playerId);
  if(!target||!resources.includes(resource)||CK.cardBalance(source,resource)<1)return fail('Choose a resource you hold');
  offer.offeredTo.push(targetPlayerId);
  if(!CK.COMMODITIES.some(type=>CK.cardBalance(target,type)>0))return {success:true,noTrade:true};
  choose(game,targetPlayerId,'commercialHarbor','Choose a commodity to return for the offered resource',cardOptions(target,CK.COMMODITIES),{sourceId:playerId,resource});
  return {success:true};
}

export function finishAlchemyRoll(game,red,other) {
  if(!Number.isInteger(red)||red<1||red>6||!Number.isInteger(other)||other<1||other>6)return fail('Invalid dice');
  const total=red+other;
  game.diceRoll={die1:red,die2:other,total};
  game.hasRolledThisTurn=true;
  CK.rollEvent(game,red,total);
  return {success:true};
}

export function resolveCardChoice(game,playerId,choice,option,cards) {
  const kind=choice.kind.slice(5), state=game.citiesKnights, player=actor(game,playerId), context=choice.context||{};
  switch(kind) {
    case 'alchemyRed': choose(game,playerId,'alchemyOther','Choose the other production die',[1,2,3,4,5,6].map(n=>cardOption(String(n),String(n),{die:n})),{red:Number(option.id)});break;
    case 'alchemyOther': return {success:true,afterRoll:{red:context.red,other:Number(option.id)}};
    case 'crane': return CK.improveCity(game,playerId,option.track,option.vertexKey,1);
    case 'engineering': return CK.buildCityWall(game,playerId,option.vertexKey,true);
    case 'inventionFirst': choose(game,playerId,'inventionSecond','Choose the second number disc',discOptions(game).filter(value=>value.hexKey!==option.hexKey),{first:option.hexKey});break;
    case 'inventionSecond': {const a=game.hexes[context.first],b=game.hexes[option.hexKey];if(!a||!b)return fail('Number disc is unavailable');[a.number,b.number]=[b.number,a.number];break;}
    case 'medicine': return G.upgradeToCity(game,playerId,option.vertexKey,{grain:1,ore:2});
    case 'smithingFirst': if(option.id!=='finish') {const result=CK.promoteKnight(game,playerId,option.vertexKey,true);if(!result.success)return result;
      choose(game,playerId,'smithingSecond','Choose a different knight to promote, or finish',[cardOption('finish','Finish'),...Object.keys(state.knights).filter(key=>key!==option.vertexKey&&state.knights[key].ownerId===playerId&&canApply(game,copy=>CK.promoteKnight(copy,playerId,key,true)))
        .map(key=>cardOption(key,'Promote knight',{vertexKey:key}))]);}break;
    case 'smithingSecond': if(option.id!=='finish')return CK.promoteKnight(game,playerId,option.vertexKey,true);break;
    case 'guildTarget': {const victim=actor(game,option.id);choose(game,playerId,'guildCount','How many cards do you want to take?',
      Array.from({length:Math.min(2,CK.cardCount(victim))+1},(_,count)=>cardOption(String(count),`${count} cards`,{count})),{victimId:victim.id});break;}
    case 'guildCount': {const count=Number(option.id);if(count)bundleChoice(game,'guildCards',playerId,'Choose cards to take',count,CK.readHand(actor(game,context.victimId)),context);break;}
    case 'guildCards': return transferBundleChoice(game,choice,cards,actor(game,context.victimId),player);
    case 'merchant': {const prior=state.merchant.ownerId;if(prior)actor(game,prior).victoryPoints--;state.merchant={ownerId:playerId,hexKey:option.hexKey};player.victoryPoints++;G.checkWinner(game);break;}
    case 'merchantFleet': state.merchantFleet={ownerId:playerId,type:option.id};break;
    case 'resourceMonopoly': for(const other of game.players)if(other.id!==playerId)CK.moveCard(game,other,player,option.id,Math.min(2,CK.cardBalance(other,option.id)));break;
    case 'tradeMonopoly': for(const other of game.players)if(other.id!==playerId)CK.moveCard(game,other,player,option.id,Math.min(1,CK.cardBalance(other,option.id)));break;
    case 'diplomacy': {const route=game.edges[option.edgeKey];if(!route?.road&&!route?.ship)return fail('Route is unavailable');const owner=game.players[route.owner];const kind=route.ship?'ship':'road';delete game.edges[option.edgeKey];game.edges[option.edgeKey]={};owner[kind==='ship'?'ships':'roads']++;
      if(owner.id===playerId){
        const preview=structuredClone(game);preview.freeRoads++;
        const edges=Object.keys(game.edges).filter(key=>kind==='ship'?SF.canPlaceShip(preview,playerId,key).valid:G.canPlaceRoad(preview,playerId,key,false,null).valid);
        choose(game,playerId,'diplomacyReplace','Place that piece on another legal edge',[cardOption('finish','Return piece to supply'),...edges.map(key=>cardOption(key,'Place piece',{edgeKey:key,kind}))],{kind});
      }else G.updateLongestRoad(game);
      break;}
    case 'diplomacyReplace': if(option.id!=='finish'){
      game.freeRoads++;
      const placed=context.kind==='ship'?SF.placeShip(game,playerId,option.edgeKey):G.placeRoad(game,playerId,option.edgeKey,false,null);
      if(!placed.success)game.freeRoads--;
      return placed;
    }else G.updateLongestRoad(game);break;
    case 'espionageTarget': {const victim=actor(game,option.id);choose(game,playerId,'espionageCard','Choose a progress card to steal, or finish',[cardOption('finish','Finish'),...progressOptions(victim)],{victimId:victim.id});break;}
    case 'espionageCard': if(option.id!=='finish'){const victim=actor(game,context.victimId),index=victim.progressCards.findIndex(card=>card.id===option.id);if(index<0)return fail('Card is unavailable');player.progressCards.push(victim.progressCards.splice(index,1)[0]);}break;
    case 'intrigue': {const knight=state.knights[option.vertexKey];if(!knight)return fail('Knight is unavailable');const destination=CK.routeReachableVertices(game,knight.ownerId,option.vertexKey).filter(key=>!CK.vertexHasPiece(game,key));
      const options=destination.length?destination.map(key=>cardOption(key,'Move knight',{vertexKey:key})):[cardOption('remove','Return to supply')];
      delete state.knights[option.vertexKey];choose(game,knight.ownerId,'intrigueDisplace','Move your displaced knight or return it to supply',options,{knight});break;}
    case 'intrigueDisplace': if(option.id!=='remove')state.knights[option.vertexKey]=context.knight;G.updateLongestRoad(game);break;
    case 'sabotageCards': return transferBundleChoice(game,choice,cards,player,'bank');
    case 'taxation': {game.robber=option.hexKey;for(const other of game.players)if(other.id!==playerId&&G.getPlayersOnHex(game,option.hexKey,CK.playerIndex(game,playerId)).includes(CK.playerIndex(game,other.id)))stealRandom(game,other,player);break;}
    case 'treasonTarget': {const victim=actor(game,option.id);choose(game,victim.id,'treasonVictim','Choose a knight to remove',Object.keys(state.knights).filter(key=>state.knights[key].ownerId===victim.id).map(key=>cardOption(key,'Remove knight',{vertexKey:key})),{attackerId:playerId});break;}
    case 'treasonVictim': {const removed=state.knights[option.vertexKey];if(!removed||removed.ownerId!==playerId)return fail('Knight is unavailable');delete state.knights[option.vertexKey];
      const attacker=actor(game,context.attackerId),placements=Object.keys(game.vertices).filter(key=>!CK.vertexHasPiece(game,key)&&CK.hasOwnRouteAt(game,attacker.id,key));
      choose(game,attacker.id,'treasonPlace','Place a knight, or finish',[cardOption('finish','Finish'),...placements.flatMap(key=>[1,2,3].filter(strength=>strength<=removed.strength&&CK.ownKnightCount(game,attacker.id,strength)<2)
        .map(strength=>cardOption(`${key}:${strength}`,`Place strength ${strength} knight`,{vertexKey:key,strength})))],{active:removed.active});break;}
    case 'treasonPlace': if(option.id!=='finish'){const result=CK.recruitKnight(game,playerId,option.vertexKey,option.strength,true,context.active);if(!result.success)return result;}
      else G.updateLongestRoad(game);break;
    case 'weddingCards': return transferBundleChoice(game,choice,cards,player,actor(game,context.recipientId));
    case 'commercialHarbor': {const source=actor(game,context.sourceId);if(CK.cardBalance(player,option.id)<1||CK.cardBalance(source,context.resource)<1)return fail('Offered cards are unavailable');CK.moveCard(game,source,player,context.resource,1);CK.moveCard(game,player,source,option.id,1);break;}
    default:return fail('Unknown progress effect');
  }
  return {success:true};
}

function transferBundleChoice(game,choice,cards,from,to) {
  if(!cards||typeof cards!=='object'||Array.isArray(cards))return fail('Choose card amounts');
  const allowed=new Set(choice.allowedCards),available=choice.availableCards;
  let count=0;
  for(const [type,amount] of Object.entries(cards)){
    if(!CK.CARD_TYPES.includes(type)||!Number.isSafeInteger(amount)||amount<0||amount>0&&(!allowed.has(type)||amount>available[type]||amount>CK.cardBalance(from,type)))return fail('Invalid card selection');
    count+=amount;
  }
  if(count!==choice.count)return fail(`Choose exactly ${choice.count} cards`);
  return CK.transferCards(game,from,to,cards);
}
