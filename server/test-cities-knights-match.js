import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {RoomStore} from './store.js';
import {captureState,applyPatch} from './recording.js';
import {playScriptedMatch} from './fixtures/scriptedMatch.js';
import {RESOURCE_CARDS,COMMODITY_CARDS} from '../shared/cardTypes.js';

for(const [seatCount,scenario]of [[3,null],[6,'heading_for_new_shores']]) {
  test(`${seatCount}-player Cities & Knights${scenario?' with Seafarers':''} reaches victory and survives replay recovery`,{timeout:600_000},()=>{
    const store=new RoomStore(':memory:');
    try {
      const service=new RoomService({store}),roles=new Set(),played=new Set();
      let finalState,attacks=0,lastAttack=-1;
      const match=playScriptedMatch({service,seatCount,seed:0xC47A2026+seatCount,
        gameOptions:{extension56:seatCount>=5,expansions:scenario?['seafarers','cities_knights']:['cities_knights'],scenario:scenario||'base',
          ...(scenario?{setup:{layout:'fixed',seed:42}}:{})},
        title:'Cities and Knights full verification',onTransition:({room,command})=>{
          const game=room.game;if(!game)return;
          if(game.phase==='playing')roles.add(game.turnRole);
          for(const resource of RESOURCE_CARDS)assert.equal(game.bank[resource]+game.players.reduce((sum,p)=>sum+p.resources[resource],0),seatCount>=5?24:19);
          for(const commodity of COMMODITY_CARDS)assert.equal(game.citiesKnights.commodityBank[commodity]+game.players.reduce((sum,p)=>sum+p.commodities[commodity],0),seatCount>=5?18:12);
          const cards=[...Object.values(game.citiesKnights.progressDecks).flat(),...game.players.flatMap(p=>p.progressCards)];
          assert.equal(new Set(cards.map(card=>card.id)).size,cards.length,'Every concealed progress card has one physical owner');
          assert.equal(cards.length+game.players.reduce((sum,p)=>sum+p.progressVictoryCards.length,0),54);
          const attack=game.citiesKnights.lastBarbarianAttack;
          if(attack&&attack.turnSerial!==lastAttack){lastAttack=attack.turnSerial;attacks++;}
          if(command.type==='playProgressCard')played.add(command.payload.cardId);
          if(game.phase==='finished')finalState=captureState(room);
        }});
      assert.equal(match.status,'finished');assert.ok(attacks>0);
      for(const action of ['recruitKnight','activateKnight','improveCity','playProgressCard'])assert.ok(match.successful[action]>0,`Full match must exercise ${action}`);
      if(scenario)assert.ok(match.successful.placeShip>0);
      if(seatCount>=5)assert.deepEqual([...roles].sort(),['paired','primary']);
      const recovered=new RoomService({store}),replay=recovered.replay(match.replayId,{perspective:'omniscient'});
      assert.equal(replay.success,true);assert.deepEqual(replay.state,finalState);
      let restored;
      for(const line of recovered.replayExport(match.replayId,{perspective:'omniscient'}).lines) {
        const row=JSON.parse(line);
        if(row.kind==='initial')restored=row.state;
        else if(row.kind==='event')restored=applyPatch(restored,row.patch);
        else if(row.kind==='checkpoint')assert.deepEqual(row.state,restored);
      }
      assert.deepEqual(restored,finalState);
      console.log(JSON.stringify({seatCount,scenario:scenario||'base',turns:match.turns,commands:match.commands,attacks,progressCardsPlayed:played.size}));
    } finally {store.close();}
  });
}
