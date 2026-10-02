import test from 'node:test';
import assert from 'node:assert/strict';
import {claimRunnerLease,heartbeatRunner,projectAiStatus,applyAiControl,OFFLINE_TTL_MS} from './aiControl.js';
import {RoomService} from './roomService.js';
import {createGame,addPlayer} from './gameLogic.js';
import {captureState} from './recording.js';

test('heartbeats are ordered, elapsed activity is stable, metadata is allowlisted',()=>{
  const slot={kind:'ai',controlEpoch:0},runId='runtime-one';
  assert.ok(claimRunnerLease(slot,{runId,controlEpoch:0},1000).success);
  const heartbeat={runId,controlEpoch:0,status:'compacting',sequence:2,runtime:{contextPercent:81.3,compaction:'running',
    capabilities:{contextUsage:true,compaction:true},summary:'PRIVATE HAND',prompt:'PRIVATE PROMPT'}};
  assert.ok(heartbeatRunner(slot,heartbeat,2000).success);
  assert.ok(heartbeatRunner(slot,{...heartbeat,sequence:3},3000).success);
  assert.equal(slot.runnerLease.statusSince,2000);
  assert.equal(heartbeatRunner(slot,{...heartbeat,sequence:1,status:'thinking'},4000).ignored,true);
  assert.equal(slot.runnerLease.lastActivityAt,3000);
  assert.equal(heartbeatRunner(slot,{...heartbeat,sequence:undefined},4000).ignored,true);
  const projected=projectAiStatus(slot,3000,null,{decisionRequired:true});
  assert.equal(projected.activity,'compacting');assert.equal(projected.decisionRequired,true);assert.equal(projected.runtime.contextPercent,81);
  assert.ok(!JSON.stringify(slot).includes('PRIVATE'));
  const recording=captureState({slots:[slot],game:null});
  assert.ok(!JSON.stringify(recording).includes('contextPercent'));assert.ok(!JSON.stringify(recording).includes(runId));
});
test('API presence does not pretend to know whether a model is working',()=>{
  const slot={kind:'ai'};
  const status=projectAiStatus(slot,1000,{lastActivityAt:1000},{decisionRequired:true});
  assert.equal(status.source,'api');assert.equal(status.activity,'unknown');assert.equal(status.connection,'online');assert.equal(status.decisionRequired,true);
  assert.equal(status.runtime,undefined);
});
test('errors survive disconnection, while pause and replacement fence old progress',()=>{
  const slot={kind:'ai',controlEpoch:0},runId='runtime-one';
  claimRunnerLease(slot,{runId,controlEpoch:0},1000);
  heartbeatRunner(slot,{runId,controlEpoch:0,status:'error',sequence:1,error:'PRIVATE PROVIDER ERROR'},2000);
  const offline=projectAiStatus(slot,2001+OFFLINE_TTL_MS);
  assert.equal(offline.status,'error');assert.equal(offline.connection,'offline');assert.ok(!JSON.stringify(slot).includes('PRIVATE'));
  claimRunnerLease(slot,{runId:'replacement',controlEpoch:0},3000);
  assert.equal(heartbeatRunner(slot,{runId,controlEpoch:0,status:'thinking',sequence:2},3001).statusCode,409);
  applyAiControl(slot,'pause',3002);
  assert.equal(heartbeatRunner(slot,{runId:'replacement',controlEpoch:0,status:'thinking'},3003).statusCode,409);
  assert.equal(projectAiStatus(slot,3003,null,{decisionRequired:true}).decisionRequired,false);
});
test('room projection derives pending work without exposing legal choices or private cards',()=>{
  const service=new RoomService();
  const room=service.create({name:'Host',seatCount:3,seats:[{kind:'ai',provider:'codex'},{kind:'human'},{kind:'human'}]});
  assert.ok(room.success);
  const raw=service.rooms.get(room.code),ai=service.join(room.code,{name:'AI',role:'ai',provider:'codex',seatId:raw.slots[0].id});
  const state=service.rooms.get(room.code);
  const players=state.slots.map((s,i)=>({id:s.id,name:`Player ${i}`,color:['red','blue','white'][i]}));
  state.game=createGame('fixture',players[0]);for(const player of players.slice(1))addPlayer(state.game,player);
  state.game.phase='playing';state.game.turnPhase='main';state.game.currentPlayerIndex=0;
  state.game.players[0].resources={brick:3,lumber:1,wool:0,grain:0,ore:0};
  service.observe(room.code,ai.token);
  const host=service.observe(room.code,room.token),seat=host.slots[0];
  assert.equal(seat.ai.decisionRequired,true);assert.equal(seat.ai.activity,'unknown');
  const watched=service.watch(room.code);assert.equal(watched.slots[0].ai.decisionRequired,true);
  assert.equal(watched.slots[0].ai.controlEpoch,undefined);assert.equal(watched.slots[0].ai.runnerRunId,undefined);
  assert.equal(typeof host.gameState.players[0].resources,'number');
  assert.equal(seat.ai.legalActions,undefined);assert.equal(seat.ai.resources,undefined);
  state.game.currentPlayerIndex=1;
  assert.equal(service.observe(room.code,room.token).slots[0].ai.decisionRequired,false);
  state.game.pendingChoice={actorId:ai.seatId,selection:'cards',availableCards:{brick:3},allowedCards:['brick'],count:1,expansion:'cities_knights',options:[]};
  assert.equal(service.observe(room.code,room.token).slots[0].ai.decisionRequired,true);
});
