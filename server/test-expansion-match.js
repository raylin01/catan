import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {RoomStore} from './store.js';
import {captureState,applyPatch} from './recording.js';
import {playScriptedMatch} from './fixtures/scriptedMatch.js';

for(const [scenario,seatCount] of [['the_fog_islands',3],['heading_for_new_shores',6]]) {
  test(`${seatCount}-player ${scenario} completes through public commands and replays exactly`,{timeout:600_000},()=>{
    const store=new RoomStore(':memory:');
    try {
      const service=new RoomService({store}),phases=new Set();let finalState;
      const match=playScriptedMatch({service,seatCount,seed:0xC47A2026+seatCount,
        gameOptions:{extension56:seatCount>=5,expansions:['seafarers'],scenario,setup:{layout:'fixed',seed:42}},
        title:'Seafarers complete verification',onTransition:({room})=>{
          const game=room.game;if(!game)return;
          if(game.phase==='playing')phases.add(game.turnRole);
          for(const resource of ['brick','lumber','wool','grain','ore']) {
            assert.equal(game.bank[resource]+game.players.reduce((sum,p)=>sum+p.resources[resource],0),seatCount>=5?24:19);
          }
          if(game.phase==='finished')finalState=captureState(room);
        }});
      assert.equal(match.status,'finished');assert.ok(match.successful.placeShip>0);
      if(seatCount>=5)assert.deepEqual([...phases].sort(),['paired','primary']);
      const recovered=new RoomService({store});
      const replay=recovered.replay(match.replayId,{perspective:'omniscient'});
      assert.equal(replay.success,true);assert.deepEqual(replay.state,finalState);
      let state;
      for(const line of recovered.replayExport(match.replayId,{perspective:'omniscient'}).lines) {
        const row=JSON.parse(line);
        if(row.kind==='initial')state=row.state;
        else if(row.kind==='event')state=applyPatch(state,row.patch);
        else if(row.kind==='checkpoint')assert.deepEqual(row.state,state);
      }
      assert.deepEqual(state,finalState);
      console.log(JSON.stringify({scenario,seatCount,turns:match.turns,commands:match.commands,ships:match.successful.placeShip}));
    } finally {store.close();}
  });
}
