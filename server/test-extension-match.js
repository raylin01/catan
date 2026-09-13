import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomStore} from './store.js';
import {RoomService} from './roomService.js';
import {applyPatch,captureState} from './recording.js';
import {playScriptedMatch} from './fixtures/scriptedMatch.js';

for(const seatCount of [5,6])test(`${seatCount}-player paired match reaches victory and replays after recovery`,{timeout:300_000},()=>{
  const store=new RoomStore(':memory:');
  try {
    const service=new RoomService({store}),roles=new Set();
    let finalState;
    const match=playScriptedMatch({service,seatCount,gameOptions:{extension56:true},seed:0xC47A2026+seatCount,
      title:`${seatCount} player extension verification`,onTransition:({room})=>{
        const game=room.game;if(!game)return;
        if(game.phase==='playing')roles.add(game.turnRole);
        for(const resource of ['brick','lumber','wool','grain','ore']) {
          assert.equal(game.bank[resource]+game.players.reduce((sum,p)=>sum+p.resources[resource],0),24);
        }
        if(game.phase==='finished')finalState=captureState(room);
      }});
    assert.equal(match.status,'finished');assert.deepEqual([...roles].sort(),['paired','primary']);
    const recovered=new RoomService({store});
    const replay=recovered.replay(match.replayId,{perspective:'omniscient'});
    assert.equal(replay.success,true);assert.deepEqual(replay.state,finalState);
    assert.equal(replay.state.gameState.players.length,seatCount);
    let state;
    for(const line of recovered.replayExport(match.replayId,{perspective:'omniscient'}).lines) {
      const row=JSON.parse(line);
      if(row.kind==='initial')state=row.state;
      else if(row.kind==='event')state=applyPatch(state,row.patch);
      else if(row.kind==='checkpoint')assert.deepEqual(row.state,state);
    }
    assert.deepEqual(state,finalState);
    console.log(JSON.stringify({seatCount,status:match.status,events:replay.recording.lastSeq,turns:replay.recording.turn}));
  } finally {store.close();}
});
