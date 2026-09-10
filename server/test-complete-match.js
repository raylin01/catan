import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import * as G from './gameLogic.js';

const RESOURCES=['brick','lumber','wool','grain','ore'];
const COSTS={city:{ore:3,grain:2},settlement:{brick:1,lumber:1,wool:1,grain:1},road:{brick:1,lumber:1},developmentCard:{ore:1,grain:1,wool:1}};
const PIPS={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};

function seededRandom(seed) {
  return ()=>{
    seed|=0;seed=seed+0x6D2B79F5|0;
    let value=Math.imul(seed^seed>>>15,1|seed);
    value=value+Math.imul(value^value>>>7,61|value)^value;
    return ((value^value>>>14)>>>0)/4294967296;
  };
}

function scoreVertex(game,vertexKey) {
  const hexes=G.getVertexAdjacentHexes(game,vertexKey).filter(hex=>hex.resource);
  const diversity=new Set(hexes.map(hex=>hex.resource)).size;
  return hexes.reduce((score,hex)=>score+(PIPS[hex.number]||0),0)+diversity*3+
    hexes.filter(hex=>hex.resource==='ore'||hex.resource==='grain').length;
}

function scoreRoad(game,edgeKey) {
  const match=edgeKey.match(/^e_(-?\d+)_(-?\d+)_(\d)$/);
  if(!match)return -Infinity;
  const [,q,r,d]=match.map(Number);
  const vertices=[G.vertexKey(q,r,d),G.vertexKey(q,r,(d+1)%6)];
  return Math.max(...vertices.flatMap(vertex=>[vertex,...G.getAdjacentVertices(vertex,game.hexes)]).map(vertex=>scoreVertex(game,vertex)));
}

function best(actions,type,score=()=>0) {
  return actions.filter(action=>action.type===type).sort((a,b)=>score(b.payload)-score(a.payload))[0];
}

function ownPlayer(view) {return view.gameState.players[view.gameState.myIndex];}
function countsOnBoard(view) {
  const counts={settlement:0,city:0};
  for(const vertex of Object.values(view.gameState.vertices))if(vertex.owner===view.gameState.myIndex&&vertex.building)counts[vertex.building]++;
  return counts;
}

function desiredCost(view) {
  const player=ownPlayer(view),built=countsOnBoard(view);
  if(player.cities>0&&built.settlement>0)return COSTS.city;
  if(player.settlements>0)return COSTS.settlement;
  return COSTS.developmentCard;
}

function deficit(cost,hand,resource) {return Math.max(0,(cost[resource]||0)-hand[resource]);}

function chooseBankTrade(view,cost) {
  const hand=ownPlayer(view).resources;
  const actions=view.legalActions.filter(action=>action.type==='bankTrade');
  return actions.sort((a,b)=>{
    const score=action=>deficit(cost,hand,action.payload.getResource)*20+
      Math.max(0,hand[action.payload.giveResource]-(cost[action.payload.giveResource]||0))-
      (cost[action.payload.giveResource]||0)*2;
    return score(b)-score(a);
  }).find(action=>deficit(cost,hand,action.payload.getResource)>0&&hand[action.payload.giveResource]-action.payload.giveAmount>=0);
}

function chooseDiscard(view) {
  let remaining=view.decision.count;
  const result=Object.fromEntries(RESOURCES.map(resource=>[resource,0]));
  const ordered=[...RESOURCES].sort((a,b)=>view.decision.resources[b]-view.decision.resources[a]);
  for(const resource of ordered) {
    const amount=Math.min(remaining,view.decision.resources[resource]);
    result[resource]=amount;remaining-=amount;
  }
  assert.equal(remaining,0);
  return result;
}

test('three scripted remote seats complete a deterministic match through RoomService', {timeout:300_000}, ()=>{
  const originalRandom=Math.random;
  Math.random=seededRandom(0xC47A2026);
  try {
    const providers={scripted:{id:'scripted',name:'Deterministic test agent',remote:true,modelSelection:false,models:null}};
    const service=new RoomService({providers});
    const created=service.create({name:'Match referee',seatCount:3,seats:Array.from({length:3},()=>({kind:'ai',provider:'scripted'}))});
    assert.equal(created.success,true);
    const code=created.code,host={token:created.token,generation:0},bots=[];
    const lobby=service.observe(code,host.token);
    for(const [index,slot] of lobby.slots.entries()) {
      const joined=service.join(code,{name:`Scripted ${index+1}`,role:'ai',seatId:slot.id,provider:'scripted'});
      assert.equal(joined.success,true);bots.push(joined);
    }

    let request=0,actions=0,turns=0,structuredTrade=false,rejectionChecked=false;
    const successful={},playedCards=new Set();let freeRoadPlacements=0;
    const command=(actor,view,type,payload={})=>{
      assert.ok(actions<1000,`action cap reached at ${view.gameState?.phase}/${view.gameState?.turnPhase}`);
      actions++;
      const result=service.command(code,actor.token,{requestId:`match-${++request}`,revision:view.revision,generation:actor.generation,
        ...(actor.role==='ai'?{controlEpoch:view.controlEpoch}:{}),type,payload});
      if(result.success){
        successful[type]=(successful[type]||0)+1;
        if(type==='playDevCard')playedCards.add(payload.cardType);
        if(type==='placeRoad'&&view.gameState?.freeRoads>0)freeRoadPlacements++;
      }
      return result;
    };
    const observe=actor=>{
      const view=service.observe(code,actor.token);assert.equal(view.success,true);return view;
    };
    const actorFor=id=>bots.find(bot=>bot.seatId===id);

    for(const bot of bots)assert.equal(command(bot,observe(bot),'ready').success,true);
    assert.equal(command(host,observe(host),'start').success,true);

    // Public player IDs cannot authenticate, and a spectator never gets private hands.
    const spectator=service.join(code,{name:'Spectator',role:'spectator'});assert.equal(spectator.success,true);
    const publicView=observe(host),forgedToken=publicView.gameState.players[0].id;
    const revisionBeforeForgery=publicView.revision;
    assert.equal(service.observe(code,forgedToken).statusCode,401);
    const spectatorView=observe(spectator);
    assert.ok(spectatorView.gameState.players.every(player=>typeof player.resources==='number'));
    assert.equal(observe(host).revision,revisionBeforeForgery);

    // Setup uses only legal actions, favoring productive and diverse intersections.
    while(observe(host).gameState.phase==='setup') {
      const state=observe(host).gameState;
      const actor=actorFor(state.players[state.currentPlayerIndex].id),view=observe(actor);
      const settlement=best(view.legalActions,'placeSettlement',payload=>scoreVertex(view.gameState,payload.vertexKey));
      if(settlement)assert.equal(command(actor,view,settlement.type,settlement.payload).success,true);
      else {
        const road=best(view.legalActions,'placeRoad',payload=>scoreRoad(view.gameState,payload.edgeKey));
        if(road)assert.equal(command(actor,view,road.type,road.payload).success,true);
        else {
          const advance=best(view.legalActions,'advanceSetup');assert.ok(advance,'setup has no legal continuation');
          assert.equal(command(actor,view,advance.type,advance.payload).success,true);
        }
      }
    }

    // A wrong-phase resource action is rejected atomically through the public API.
    {
      const state=observe(host).gameState,actor=actorFor(state.players[state.currentPlayerIndex].id),before=observe(actor);
      const rejected=command(actor,before,'bankTrade',{giveResource:'brick',giveAmount:-4,getResource:'ore'});
      assert.equal(rejected.success,false);
      const after=observe(actor);
      assert.equal(after.revision,before.revision);
      assert.deepEqual(ownPlayer(after).resources,ownPlayer(before).resources);
      rejectionChecked=true;
    }

    const turnMemory=new Map(bots.map(bot=>[bot.seatId,{paidRoad:false}]));
    let lastTurnId=null;
    while(true) {
      const hostView=observe(host),game=hostView.gameState;
      if(game.phase==='finished')break;
      assert.ok(turns<1000,`turn cap reached after ${actions} actions`);

      if(game.turnPhase==='discard') {
        let discarded=false;
        for(const bot of bots) {
          const view=observe(bot);
          if(view.decision?.type==='discardCards') {
            assert.equal(command(bot,view,'discardCards',{resources:chooseDiscard(view)}).success,true);
            discarded=true;break;
          }
        }
        assert.ok(discarded,'discard phase has no player decision');
        continue;
      }

      const currentId=game.players[game.currentPlayerIndex].id,actor=actorFor(currentId),view=observe(actor);
      assert.ok(actor,'current player has no scripted controller');
      const me=ownPlayer(view);
      assert.ok(RESOURCES.every(resource=>Number.isSafeInteger(me.resources[resource])&&me.resources[resource]>=0));
      if(lastTurnId!==currentId&&game.turnPhase==='roll') {
        lastTurnId=currentId;turnMemory.get(currentId).paidRoad=false;
      }

      if(game.turnPhase==='robber') {
        const moves=view.legalActions.filter(action=>action.type==='moveRobber');
        const move=moves.find(action=>action.payload.stealFromPlayerId)||moves[0];
        assert.ok(move,'robber has no legal destination');
        assert.equal(command(actor,view,move.type,move.payload).success,true);continue;
      }
      if(game.turnPhase==='robberPick') {
        const card=view.legalActions.find(action=>action.type==='chooseRobberCard');
        assert.ok(card,'robber has no face-down card choice');
        assert.equal(command(actor,view,card.type,card.payload).success,true);continue;
      }
      if(game.yearOfPlentyPicks>0) {
        const cost=desiredCost(view),hand=me.resources;
        const picks=view.legalActions.filter(action=>action.type==='yearOfPlentyPick');
        const pick=picks.sort((a,b)=>deficit(cost,hand,b.payload.resource)-deficit(cost,hand,a.payload.resource))[0];
        assert.ok(pick,'Year of Plenty has no available bank resource');
        assert.equal(command(actor,view,pick.type,pick.payload).success,true);continue;
      }
      if(game.freeRoads>0) {
        const road=best(view.legalActions,'placeRoad',payload=>scoreRoad(view.gameState,payload.edgeKey));
        const finish=best(view.legalActions,'finishFreeRoads');
        assert.ok(road||finish,'Road Building has no resolution');
        const action=road||finish;assert.equal(command(actor,view,action.type,action.payload).success,true);continue;
      }

      if(game.turnPhase==='roll') {
        const devPriority=['knight','yearOfPlenty','monopoly','roadBuilding'];
        const dev=devPriority.map(card=>view.legalActions.find(action=>action.type==='playDevCard'&&action.payload.cardType===card)).find(Boolean);
        if(dev) {
          if(dev.payload.cardType==='monopoly') {
            const cost=desiredCost(view);
            dev.payload= view.legalActions.filter(action=>action.type==='playDevCard'&&action.payload.cardType==='monopoly')
              .sort((a,b)=>deficit(cost,me.resources,b.payload.params.resource)-deficit(cost,me.resources,a.payload.params.resource))[0].payload;
          }
          assert.equal(command(actor,view,dev.type,dev.payload).success,true);continue;
        }
        const roll=best(view.legalActions,'rollDice');assert.ok(roll,'roll phase has no roll action');
        assert.equal(command(actor,view,roll.type,roll.payload).success,true);turns++;continue;
      }

      assert.equal(game.turnPhase,'main');

      // Once both parties naturally hold a card, execute one explicit offer,
      // acceptance, and confirmation using each participant's own observation.
      if(!structuredTrade) {
        for(const target of bots.filter(bot=>bot.seatId!==actor.seatId)) {
          const targetView=observe(target),theirHand=ownPlayer(targetView).resources;
          const exchange=RESOURCES.flatMap(give=>RESOURCES.map(get=>({give,get})))
            .find(({give,get})=>give!==get&&me.resources[give]>=2&&theirHand[get]>=2);
          if(!exchange)continue;
          let result=command(actor,view,'tradeOffer',{to:target.seatId,give:{[exchange.give]:1},get:{[exchange.get]:1}});
          assert.equal(result.success,true);
          let responseView=observe(target);assert.equal(responseView.trade.to,target.seatId);
          result=command(target,responseView,'tradeAccept',{tradeId:responseView.trade.id});assert.equal(result.success,true);
          responseView=observe(actor);assert.equal(responseView.trade.status,'accepted');
          result=command(actor,responseView,'tradeConfirm',{tradeId:responseView.trade.id});assert.equal(result.success,true);
          structuredTrade=true;break;
        }
        if(structuredTrade)continue;
      }

      const city=best(view.legalActions,'upgradeToCity',payload=>scoreVertex(view.gameState,payload.vertexKey));
      if(city){assert.equal(command(actor,view,city.type,city.payload).success,true);continue;}
      const settlement=best(view.legalActions,'placeSettlement',payload=>scoreVertex(view.gameState,payload.vertexKey));
      if(settlement){assert.equal(command(actor,view,settlement.type,settlement.payload).success,true);continue;}

      const cost=desiredCost(view),bankTrade=chooseBankTrade(view,cost);
      if(bankTrade){assert.equal(command(actor,view,bankTrade.type,bankTrade.payload).success,true);continue;}

      const memory=turnMemory.get(currentId);
      const road=best(view.legalActions,'placeRoad',payload=>scoreRoad(view.gameState,payload.edgeKey));
      if(road&&!memory.paidRoad&&countsOnBoard(view).settlement===0) {
        assert.equal(command(actor,view,road.type,road.payload).success,true);memory.paidRoad=true;continue;
      }
      if(road&&!memory.paidRoad&&me.settlements>0&&me.resources.brick>=1&&me.resources.lumber>=1) {
        assert.equal(command(actor,view,road.type,road.payload).success,true);memory.paidRoad=true;continue;
      }

      const buy=best(view.legalActions,'buyDevCard');
      if(buy){assert.equal(command(actor,view,buy.type,buy.payload).success,true);continue;}

      const end=best(view.legalActions,'endTurn');assert.ok(end,'main phase has no end-turn action');
      assert.equal(command(actor,view,end.type,end.payload).success,true);
    }

    const final=observe(host),winner=final.gameState.players.find(player=>player.id===final.gameState.winner);
    assert.ok(winner,'completed game has no winner');
    assert.ok(winner.victoryPoints>=10);
    assert.equal(structuredTrade,true,'match never found a naturally affordable structured trade');
    assert.equal(rejectionChecked,true);
    for(const type of ['rollDice','discardCards','moveRobber','chooseRobberCard','placeSettlement','placeRoad','upgradeToCity','buyDevCard','playDevCard','yearOfPlentyPick','bankTrade','endTurn','tradeOffer','tradeAccept','tradeConfirm']) {
      assert.ok(successful[type]>0,`match did not exercise ${type}`);
    }
    for(const card of ['knight','yearOfPlenty','monopoly','roadBuilding'])assert.ok(playedCards.has(card),`match did not play ${card}`);
    assert.ok(freeRoadPlacements>0,'match did not resolve Road Building with a free road');
    assert.ok(actions<1000);assert.ok(turns<1000);
    console.log(`complete match: ${turns} turns, ${actions} commands, winner ${winner.name} with ${winner.victoryPoints} VP`);
    console.log(`covered actions: ${JSON.stringify(successful)}`);
  } finally {
    Math.random=originalRandom;
  }
});
