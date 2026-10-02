// Opt-in integration: real Luna Max + runner + loopback HTTP game server.
// Uses a disposable fixture, not a full match. A low threshold avoids paying
// to fill a real context window; deterministic tests cover the default 80%.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RoomService} from '../server/roomService.js';
import {createAppServer} from '../server/http.js';
import {GameClient} from '../bridge/client.js';
import {runPlayer} from '../bridge/runner.js';
import {codexRuntimeConnector} from '../bridge/connectors/codex-runtime.js';

const service=new RoomService(),model='gpt-6-luna',reasoning='max';
const host=service.create({name:'Local runtime test',seatCount:3,seats:[{kind:'ai',provider:'codex',model,chatEnabled:false},{kind:'human'},{kind:'human'}]});
assert.ok(host.success);
const players=service.rooms.get(host.code).slots.map((slot,index)=>service.join(host.code,{name:`Fixture ${index+1}`,role:index?'human':'ai',
  provider:index?undefined:'codex',model:index?undefined:model,seatId:slot.id}));
function command(actor,type,payload={}) {
  const view=service.observe(host.code,actor.token);
  const r=service.command(host.code,actor.token,{requestId:randomUUID(),revision:view.revision,generation:view.generation,controlEpoch:view.controlEpoch,type,payload});
  assert.ok(r.success,r.error);return r;
}
for(const player of players)command(player,'ready');command(host,'start');
for(let n=0;n<60&&service.rooms.get(host.code).game.phase==='setup';n++) {
  const game=service.rooms.get(host.code).game,player=players.find(p=>p.seatId===game.players[game.currentPlayerIndex].id);
  const action=service.observe(host.code,player.token).legalActions[0];assert.ok(action);
  command(player,action.type,action.payload);
}
const game=service.rooms.get(host.code).game;
assert.equal(game.phase,'playing');
// A useful small decision: nothing affordable, no trades or pending choices.
for(const player of game.players)for(const card of Object.keys(player.resources)){game.bank[card]+=player.resources[card];player.resources[card]=0;}
game.currentPlayerIndex=game.players.findIndex(p=>p.id===players[0].seatId);game.turnPhase='main';
const server=createAppServer({service,hostKey:randomUUID()});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const client=new GameClient({server:`http://127.0.0.1:${server.address().port}`,code:host.code,token:players[0].token});
const stop=new AbortController(),deadline=setTimeout(()=>stop.abort(Error('Runtime game smoke timed out')),600000);
const actions=[],statuses=[],contextIds=new Set();let compacted=false,compactions=0,savedState;
const originalAct=client.act.bind(client),originalHeartbeat=client.heartbeat.bind(client);
client.act=async(...args)=>{
  const receipt=await originalAct(...args);actions.push(args[1]);
  if(compacted)stop.abort();
  return receipt;
};
client.heartbeat=async payload=>{
  const result=await originalHeartbeat(payload);
  if(statuses.at(-1)!==payload.status){statuses.push(payload.status);console.log(JSON.stringify({status:payload.status,decisionRequired:service.observe(host.code,host.token).slots[0].ai.decisionRequired}));}
  const publicStatus=service.watch(host.code).slots[0].ai;
  assert.equal(publicStatus.status,payload.status);
  assert.ok(!JSON.stringify(publicStatus).includes('contextId'));
  return result;
};
const connector={...codexRuntimeConnector,
  compact:async options=>{
    assert.deepEqual(actions,['endTurn'],'compaction must follow accepted turn completion');
    const result=await codexRuntimeConnector.compact(options);compacted=true;compactions++;
    // Advance the fixture to the next turn while the runner is doing maintenance.
    const room=service.rooms.get(host.code);room.game.currentPlayerIndex=room.game.players.findIndex(p=>p.id===players[0].seatId);
    room.game.turnPhase='roll';room.revision++;
    return result;
  }};
try {
  console.log(JSON.stringify({test:'local HTTP runtime integration',model,reasoning,compactAtPercent:1}));
  await runPlayer(client,connector,{model,reasoning,compactAtPercent:1,decisionTimeoutMs:300000,signal:stop.signal,pollMs:25,heartbeatMs:500,
    save:async(_memory,state)=>{savedState=structuredClone(state);if(state.contexts.gameplay?.id)contextIds.add(state.contexts.gameplay.id);}});
} catch(error){if(error.name!=='AbortError')throw error;}
finally {clearTimeout(deadline);await new Promise(resolve=>server.close(resolve));}
assert.deepEqual(actions,['endTurn','rollDice']);assert.equal(compactions,1);assert.equal(contextIds.size,1);
assert.ok(statuses.includes('compacting'));assert.ok(statuses.includes('compaction-scheduled'));
assert.equal(savedState.contexts.gameplay.compactionPending,true,'new response can schedule later maintenance');
console.log(JSON.stringify({success:true,model,reasoning,actions,nativeCompactions:compactions,sameContext:true,transcriptsUploaded:false}));
