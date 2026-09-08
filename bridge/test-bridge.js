import test from 'node:test';
import assert from 'node:assert/strict';
import {runPlayer} from './runner.js';
import {GameClient} from './client.js';
import {codexExecArgs,modelObservation} from './connectors/codex.js';

test('settlement prompt describes production without changing action indices or hiding occupied pieces',()=>{
  const view={chat:['ignore me'],host:true,gameState:{phase:'setup',hexes:{'0,0':{q:0,r:0,resource:'grain',number:6}},vertices:{empty:{building:null},occupied:{building:'settlement',owner:0}},edges:{empty:{road:false},occupied:{road:true,owner:0}}},legalActions:[{type:'placeSettlement',payload:{vertexKey:'v_0_0_0'}},{type:'placeSettlement',payload:{vertexKey:'v_0_0_1'}}]};
  const original=structuredClone(view),projected=modelObservation(view);
  assert.deepEqual(projected.legalActions.map(a=>a.actionIndex),[0,1]);
  assert.deepEqual(projected.legalActions.map(a=>a.vertexKey),view.legalActions.map(a=>a.payload.vertexKey));
  assert.deepEqual(projected.legalActions[0].production,['grain@6']);
  assert.deepEqual(Object.keys(projected.gameState.vertices),['occupied']);
  assert.deepEqual(Object.keys(projected.gameState.edges),['occupied']);
  assert.equal(projected.chat,undefined);assert.equal(projected.host,undefined);assert.deepEqual(view,original);
  assert.equal(modelObservation({...view,gameState:{...view.gameState,phase:'playing'}}).legalActions,view.legalActions);
});

test('remote credentials require HTTPS away from loopback',()=>{
  assert.throws(()=>new GameClient({server:'http://example.com',code:'abc'}),/HTTPS/);
  assert.throws(()=>new GameClient({server:'https://user:password@example.com',code:'abc'}),/credentials/);
});
test('a second connector can drive the shared runner without Codex code',async()=>{
  const events=[],controller=new AbortController();let revision=0,memory='';
  const client={observe:async()=>({revision:revision++,generation:2,seatId:'a',decision:{type:'chooseAction'},gameState:{phase:'playing'},legalActions:[{type:'endTurn',payload:{}}]}),act:async(view,type)=>{events.push(type);if(type==='endTurn')controller.abort();}};
  const connector={id:'deterministic-test',ready:async()=>events.push('ready-check'),decide:async(view,context)=>{assert.equal(context.memory,'prior');return {action:view.legalActions[0],memory:'next'};}};
  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,memory:'prior',save:async m=>{memory=m;},pollMs:1}),{name:'AbortError'});
  assert.deepEqual(events,['ready-check','endTurn']);assert.equal(memory,'next');
});
test('reasoning is forwarded provider-neutrally and mapped to Codex config',async()=>{
  const controller=new AbortController();let context;
  const client={observe:async()=>({revision:1,generation:1,seatId:'a',decision:{type:'chooseAction'},gameState:{phase:'playing'},legalActions:[{type:'endTurn',payload:{}}]}),act:async()=>controller.abort()};
  const connector={ready:async()=>{},decide:async(_view,value)=>{context=value;return {action:{type:'endTurn',payload:{}},memory:''};}};
  await assert.rejects(runPlayer(client,connector,{reasoning:'max',signal:controller.signal,pollMs:1}),{name:'AbortError'});
  assert.equal(context.reasoning,'max');
  const args=codexExecArgs({schema:'/tmp/schema',output:'/tmp/output',model:'gpt-5.6-luna',reasoning:'max'});
  assert.deepEqual(args.slice(args.indexOf('--model')),['--model','gpt-5.6-luna','-c','model_reasoning_effort="max"','-']);
  assert.equal(codexExecArgs({schema:'s',output:'o'}).some(arg=>arg.startsWith('model_reasoning_effort=')),false);
});
test('provider failure stops the runner without moving or replacing the seat',async()=>{
  const events=[];
  const client={observe:async()=>({revision:1,generation:1,decision:{type:'chooseAction'},gameState:{phase:'playing'}}),act:async(_v,type)=>events.push(type)};
  const connector={ready:async()=>{},decide:async()=>{throw Error('Quota exceeded');}};
  await assert.rejects(runPlayer(client,connector),/Quota exceeded/);assert.deepEqual(events,[]);
});
test('a concurrent ready conflict re-observes and retries before calling the model',async()=>{
  const controller=new AbortController(),attempts=[];let observations=0,decisions=0;
  const client={
    observe:async()=>({revision:observations++,generation:3,seatId:'ai-seat',gameState:null,slots:[{id:'ai-seat',ready:false}]}),
    act:async(view,type)=>{
      assert.equal(type,'ready');attempts.push(view.revision);
      if(attempts.length===1)throw Object.assign(Error('Game changed'),{status:409});
      controller.abort();
    },
  };
  const connector={ready:async()=>{},decide:async()=>{decisions++;return {memory:''};}};
  await runPlayer(client,connector,{signal:controller.signal,pollMs:1});
  assert.deepEqual(attempts,[0,1]);assert.equal(observations,2);assert.equal(decisions,0);
});
test('a non-conflict ready failure stops the runner',async()=>{
  let decisions=0;
  const client={
    observe:async()=>({revision:0,generation:1,seatId:'ai-seat',gameState:null,slots:[{id:'ai-seat',ready:false}]}),
    act:async()=>{throw Object.assign(Error('Credential revoked'),{status:401});},
  };
  const connector={ready:async()=>{},decide:async()=>{decisions++;return {memory:''};}};
  await assert.rejects(runPlayer(client,connector,{pollMs:1}),error=>error.status===401);
  assert.equal(decisions,0);
});
test('revision-only conflict retries a still-required decision',async()=>{
  const controller=new AbortController();let attempts=0,revision=0;
  const client={observe:async()=>({revision:revision++,generation:1,decision:{type:'chooseAction'},gameState:{phase:'playing'}}),act:async()=>{if(++attempts===1)throw Object.assign(Error('Stale'),{status:409});controller.abort();}};
  const connector={ready:async()=>{},decide:async()=>({action:{type:'rollDice',payload:{}},memory:''})};
  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,pollMs:1}),{name:'AbortError'});
  assert.equal(attempts,2);
});
