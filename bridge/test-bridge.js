import test from 'node:test';
import assert from 'node:assert/strict';
import {runPlayer} from './runner.js';
import {GameClient} from './client.js';
import {codexExecArgs,modelObservation,codexConnector} from './connectors/codex.js';
import * as G from '../server/gameLogic.js';
import {playerView,legalActions} from '../server/actions.js';
import {createAgentBoard} from '../server/agentBoard.js';

test('actual connector sends canonical observations, expands common facts, and maps the selected index exactly',async()=>{
  const game=G.createGame('prompt-fixture',{id:'p0',name:'NAME_CANARY'});
  for(let i=1;i<3;i++)G.addPlayer(game,{id:`p${i}`,name:'NAME_CANARY'});
  G.startGame(game);
  const seatId=game.players[game.currentPlayerIndex].id;
  const view={success:true,seatId,revision:27,generation:1,controlEpoch:9,
    token:'TOKEN_CANARY',chat:[{message:'CHAT_CANARY'}],ai:{runnerRunId:'RUN_CANARY'},
    host:true,gameState:playerView(game,seatId),legalActions:legalActions(game,seatId),decision:{type:'chooseAction'}};
  view.gameState.ports[0].icon='⚓';view.gameState.ports[0].rendererCanary='RENDER_CANARY';
  view.gameState.players[0].color='COLOR_CANARY';
  const original=structuredClone(view),projected=modelObservation(view),{ids}=createAgentBoard(view.gameState);
  assert.equal(projected.board.vertices.length,54);assert.equal(projected.board.edges.length,72);
  assert.equal(projected.actions.length,54);assert.equal(view.legalActions.length,114);
  for(const action of projected.actions) {
    assert.equal(action.params.vertexKey,ids.vertices[view.legalActions[action.actionIndex].payload.vertexKey]);
    const facts={...projected.actionDefaults[action.type],...action.facts};
    assert.ok(Array.isArray(facts.production));assert.deepEqual(facts.cost,{});
  }
  const chosen=projected.actions[17];let captured;
  const result=await codexConnector.decide(view,{memory:'local strategic summary',
    lastOutcome:{action:{type:'advanceSetup',payload:{token:'RECEIPT_CANARY'}},rejected:false,receipt:{token:'RECEIPT_CANARY'}},
    complete:async request=>{captured=request;return {contextId:'test',value:{decision:{actionIndex:chosen.actionIndex},memory:'next',publicReply:'silent'}};}});
  assert.deepEqual(result.action,view.legalActions[chosen.actionIndex]);
  const packet=JSON.parse(captured.prompt.split('\nObservation: ')[1]);
  assert.deepEqual(packet,projected);
  assert.deepEqual(captured.schema.properties.decision.anyOf.find(c=>c.properties.actionIndex).properties.actionIndex.enum,projected.actions.map(a=>a.actionIndex));
  for(const forbidden of ['TOKEN_CANARY','NAME_CANARY','COLOR_CANARY','RENDER_CANARY','CHAT_CANARY','RUN_CANARY','RECEIPT_CANARY','"gameState"','"controlEpoch"'])assert.equal(captured.prompt.includes(forbidden),false,forbidden);
  assert.doesNotMatch(captured.prompt,/\p{Extended_Pictographic}|(?:v|e)_-?\d+_-?\d+_[0-5]/u);
  assert.match(captured.prompt,/actionDefaults/);assert.match(captured.prompt,/local strategic summary/);
  assert.deepEqual(view,original);
  // The same projection retains occupied pieces after placement, without aliases.
  assert.equal(G.placeSettlement(game,seatId,view.legalActions[chosen.actionIndex].payload.vertexKey).success,true);
  const occupied=modelObservation({...view,gameState:playerView(game,seatId),legalActions:[]});
  assert.equal(occupied.board.vertices.filter(v=>v.building).length,1);
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
  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,pollMs:1}),{name:'AbortError'});
  assert.equal(attempts.length,2);assert.ok(attempts[1]>attempts[0]);assert.equal(decisions,0);
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
