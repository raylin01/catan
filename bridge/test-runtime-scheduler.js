import test from 'node:test';
import assert from 'node:assert/strict';
import {runPlayer} from './runner.js';
import {contextUsage} from './connectors/codex-runtime.js';
import {runtimeMetadata,safeToCompact,updateContext} from './compaction.js';

const seatId='ai-seat';

function makeView(overrides={}) {
  const base={
    revision:1,generation:1,controlEpoch:4,seatId,paused:false,closed:false,
    decision:null,trades:[],
    gameState:{phase:'playing',turnPhase:'roll',currentPlayerIndex:1,productionPlayerIndex:1,
      turnRole:'primary',pairedTurnRules:false,players:[{id:seatId},{id:'human-seat'}],
      discardingPlayers:[],pendingChoice:null,freeRoads:0,yearOfPlentyPicks:0},
    slots:[{id:seatId,kind:'ai',ready:true,chatEnabled:false,chatModel:'reader-model',chatReasoning:'high',ai:{paused:false}}],
    ai:{controlEpoch:4,paused:false},
  };
  const result={...base,...overrides};
  result.gameState=Object.hasOwn(overrides,'gameState')&&overrides.gameState===null
    ? null : {...base.gameState,...overrides.gameState};
  result.slots=overrides.slots||base.slots;
  return result;
}

function controllerFixture(initialView) {
  const state={view:structuredClone(initialView)},controller=new AbortController(),heartbeats=[];
  const client={
    observe:async()=>structuredClone(state.view),
    heartbeat:async value=>{heartbeats.push(structuredClone(value));},
  };
  return {state,controller,client,heartbeats};
}

const contextKey=(connectorId,model,reasoning)=>JSON.stringify([connectorId,model,reasoning]);

test('safe boundaries follow completed setup placements and both paired-phase transitions',()=>{
  const setupOwn=makeView({gameState:{phase:'setup',turnPhase:'setup',currentPlayerIndex:0},
    decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(setupOwn),false,'settlement and route obligations remain in setup');

  const setupAdvanced=makeView({gameState:{phase:'setup',turnPhase:'setup',currentPlayerIndex:1,
    setupAction:null,players:[{id:seatId},{id:'human-seat'}]}});
  assert.equal(safeToCompact(setupAdvanced),true,'advanceSetup moved play to the next seat');

  const snakeRepeat=makeView({gameState:{phase:'setup',turnPhase:'setup',currentPlayerIndex:0,
    setupPhase:1,players:[{id:seatId},{id:'human-seat'}]},decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(snakeRepeat),false,'the last first-round seat still owes its second setup placement');

  const setupFinishedButOwnRollDue=makeView({gameState:{phase:'playing',turnPhase:'roll',currentPlayerIndex:0,
    players:[{id:seatId},{id:'human-seat'}]},decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(setupFinishedButOwnRollDue),false,'the first roll is immediate work after setup');

  const primaryEnded=makeView({gameState:{phase:'playing',turnPhase:'main',pairedTurnRules:true,
    productionPlayerIndex:0,turnRole:'paired',currentPlayerIndex:1}});
  assert.equal(safeToCompact(primaryEnded),true,'the primary seat has ended and the paired seat is now active');

  const pairedEnded=makeView({gameState:{phase:'playing',turnPhase:'roll',pairedTurnRules:true,
    productionPlayerIndex:1,turnRole:'primary',currentPlayerIndex:1}});
  assert.equal(safeToCompact(pairedEnded),true,'the paired action ended and the next production turn is active');
});

test('mandatory choices, discards, and actionable trades block compaction',()=>{
  const pendingChoice=makeView({gameState:{pendingChoice:{id:'choice-1',actorId:seatId,kind:'goldResource'}}});
  assert.equal(safeToCompact(pendingChoice),false);
  const seafarersChoice=makeView({gameState:{turnPhase:'main',pendingChoice:{id:'sea-choice',expansion:'seafarers',
    actorId:seatId,kind:'goldResource'}},decision:{type:'chooseAction',kind:'goldResource'}});
  assert.equal(safeToCompact(seafarersChoice),false,'a Seafarers gold/fleet/pirate choice is still a live obligation');
  const seafarersPort=makeView({gameState:{phase:'setup',turnPhase:'portPlacement',currentPlayerIndex:0,
    players:[{id:seatId},{id:'human-seat'}]},decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(seafarersPort),false,'drawn New World port placement is part of mandatory setup');
  const cityCards=makeView({gameState:{turnPhase:'main',pendingChoice:{id:'city-cards',expansion:'cities_knights',
    actorId:seatId,selection:'cards',kind:'progressHandLimit'}},decision:{type:'chooseCards',count:1},legalActions:[]});
  assert.equal(safeToCompact(cityCards),false,'a card-selection obligation exists even with no legal action indices');

  const discard=makeView({gameState:{turnPhase:'discard',discardingPlayers:[{playerIndex:0,cardsToDiscard:2}],
    players:[{id:seatId},{id:'human-seat'}]},decision:{type:'discardCards',count:2}});
  assert.equal(safeToCompact(discard),false);

  const incoming=makeView({trades:[{id:'incoming',to:seatId,from:'human-seat',status:'offered'}]});
  assert.equal(safeToCompact(incoming),false);
  const confirm=makeView({trades:[{id:'confirm',from:seatId,to:'human-seat',status:'accepted'}]});
  assert.equal(safeToCompact(confirm),false);

  const freeRoads=makeView({gameState:{freeRoads:1},decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(freeRoads),false);
  const plenty=makeView({gameState:{yearOfPlentyPicks:1},decision:{type:'chooseAction'}});
  assert.equal(safeToCompact(plenty),false);

  assert.equal(safeToCompact(makeView({paused:true})),false);
  assert.equal(safeToCompact(makeView({closed:true})),false);
  assert.equal(safeToCompact(makeView({gameState:null})),false);
});

test('usage uses last-turn context occupancy and unknown/reset usage never schedules',()=>{
  assert.equal(contextUsage({last:{inputTokens:78,outputTokens:1},total:{inputTokens:10000},modelContextWindow:100}).percent,79,
    'cumulative totals do not stand in for current context occupancy');
  assert.equal(contextUsage({last:{inputTokens:79,outputTokens:1},total:{inputTokens:10000},modelContextWindow:100}).percent,80);
  assert.equal(contextUsage({last:{inputTokens:200,outputTokens:30}}),null,
    'missing capacity leaves occupancy unknown');
  assert.equal(contextUsage({last:{inputTokens:0,outputTokens:0},modelContextWindow:1000}),null,
    'post-compaction zero usage is treated as an unknown/reset sample');

  const context={id:'context-one',usage:null,compactionPending:false};
  updateContext(context,{type:'context',context:{percent:79}},80);
  assert.equal(context.compactionPending,false);
  updateContext(context,{type:'context',context:null},80);
  assert.equal(context.compactionPending,false);
  updateContext(context,{type:'context',context:{percent:80}},80);
  assert.equal(context.compactionPending,true);
  updateContext(context,{type:'compaction-completed'},80);
  assert.equal(context.compactionPending,false);
  assert.equal(context.usage,null);
  updateContext(context,{type:'context',context:{percent:79}},80);
  assert.equal(context.compactionPending,false,'a confirmed compaction rearms only on a later threshold crossing');
});

test('an 80% trigger waits for the server-observed end of the turn, not a model response',async()=>{
  const {state,controller,client,heartbeats}=controllerFixture(makeView({
    gameState:{phase:'playing',turnPhase:'main',currentPlayerIndex:0,players:[{id:seatId},{id:'human-seat'}]},
    decision:{type:'chooseAction'},
  }));
  const actions=[];let decisions=0,compactAtActionCount=null;
  const connector={
    id:'scheduler-test',capabilities:{contextUsage:true,compaction:true},
    ready:async()=>{},
    decide:async(_view,{onRuntime})=>{
      decisions++;
      onRuntime({type:'context-id',contextId:'gameplay-context'});
      onRuntime({type:'context',context:{percent:80,usedTokens:80,contextWindow:100,estimated:true}});
      return {contextId:'gameplay-context',memory:'private strategic memory',action:decisions===1
        ?{type:'bankTrade',payload:{giveResource:'brick',giveAmount:4,getResource:'ore'}}
        :{type:'endTurn',payload:{}}};
    },
    compact:async options=>{
      compactAtActionCount=actions.length;
      assert.equal(options.contextId,'gameplay-context');
      options.onRuntime({type:'compaction-started'});
      options.onRuntime({type:'compaction-completed'});
      controller.abort();
      return {compacted:true};
    },
  };
  client.act=async(_view,type)=>{
    actions.push(type);state.view.revision++;
    if(type==='endTurn') {
      state.view.gameState.currentPlayerIndex=1;
      state.view.gameState.turnPhase='roll';
      state.view.decision=null;
    } else state.view.gameState.actionSequence=(state.view.gameState.actionSequence||0)+1;
    return {success:true};
  };

  await runPlayer(client,connector,{signal:controller.signal,contexts:{},model:'game-model',reasoning:'max',
    pollMs:0,heartbeatMs:10000,chatBatchMs:10000});
  assert.deepEqual(actions,['bankTrade','endTurn']);
  assert.equal(decisions,2);
  assert.equal(compactAtActionCount,2,'compaction starts after the endTurn receipt and a fresh observation');
  assert.ok(heartbeats.some(value=>value.runtime.compaction==='scheduled'));
});

test('a Seafarers fortress attack is a turn boundary only after the observed transition',async()=>{
  const {state,controller,client}=controllerFixture(makeView({
    gameOptions:{version:1,expansions:['seafarers'],scenario:'the_pirate_islands'},
    gameState:{phase:'playing',turnPhase:'main',currentPlayerIndex:0,players:[{id:seatId},{id:'human-seat'}]},
    decision:{type:'chooseAction'},
  }));
  const actions=[];
  const contexts={gameplay:{key:contextKey('fortress-test','game-model','max'),id:'fortress-context',
    usage:{percent:81},compactionPending:true}};
  const connector={id:'fortress-test',capabilities:{contextUsage:true,compaction:true},ready:async()=>{},
    decide:async()=>({contextId:'fortress-context',memory:'',action:{type:'attackFortress',payload:{}}}),
    compact:async options=>{
      assert.deepEqual(actions,['attackFortress']);
      assert.equal(state.view.gameState.currentPlayerIndex,1);
      options.onRuntime({type:'compaction-started'});options.onRuntime({type:'compaction-completed'});
      controller.abort();return {compacted:true};
    }};
  client.act=async(_view,type)=>{
    actions.push(type);state.view.revision++;state.view.gameState.currentPlayerIndex=1;
    state.view.gameState.turnPhase='roll';state.view.decision=null;return {success:true};
  };
  await runPlayer(client,connector,{signal:controller.signal,contexts,model:'game-model',reasoning:'max',
    pollMs:0,heartbeatMs:10000,chatBatchMs:10000});
  assert.deepEqual(actions,['attackFortress']);
});

test('compaction during an incoming obligation resumes from a fresh authorized observation',async()=>{
  const {state,controller,client}=controllerFixture(makeView({
    gameState:{phase:'playing',turnPhase:'roll',currentPlayerIndex:1,players:[{id:seatId},{id:'human-seat'}]},
  }));
  const decisions=[],actions=[];
  const contexts={gameplay:{key:contextKey('scheduler-test','game-model','max'),id:'gameplay-context',
    usage:{percent:84},compactionPending:true}};
  const connector={
    id:'scheduler-test',capabilities:{contextUsage:true,compaction:true},ready:async()=>{},
    compact:async options=>{
      options.onRuntime({type:'compaction-started'});
      state.view.revision++;
      state.view.gameState.turnPhase='discard';
      state.view.gameState.currentPlayerIndex=0;
      state.view.gameState.discardingPlayers=[{playerIndex:0,cardsToDiscard:1}];
      state.view.decision={type:'discardCards',count:1,resources:{brick:1}};
      options.onRuntime({type:'compaction-completed'});
      return {compacted:true};
    },
    decide:async(view)=>{
      decisions.push({revision:view.revision,phase:view.gameState.turnPhase,decision:view.decision?.type});
      return {contextId:'gameplay-context',memory:'private',action:{type:'discardCards',payload:{resources:{brick:1}}}};
    },
  };
  client.lease=async({runId})=>{state.view.ai.runnerRunId=runId;return {success:true};};
  client.heartbeat=async()=>{};
  client.act=async(_view,type)=>{
    actions.push(type);
    controller.abort();
    return {success:true};
  };

  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,contexts,model:'game-model',reasoning:'max',
    pollMs:0,heartbeatMs:10000,chatBatchMs:10000}),{name:'AbortError'});
  assert.deepEqual(decisions,[{revision:2,phase:'discard',decision:'discardCards'}]);
  assert.deepEqual(actions,['discardCards'],'the old action plan is never replayed after compaction');
});

for(const transition of ['pause','replacement']) {
  test(`an in-flight native compaction is cancelled on ${transition}`,async()=>{
    const {state,controller,client}=controllerFixture(makeView());
    const contexts={gameplay:{key:contextKey('scheduler-test','game-model','max'),id:'gameplay-context',
      usage:{percent:85},compactionPending:true}};
    let compactCalls=0,startedResolve;
    const started=new Promise(resolve=>{startedResolve=resolve;});
    const connector={
      id:'scheduler-test',capabilities:{contextUsage:true,compaction:true},ready:async()=>{},
      compact:async({signal,onRuntime})=>{
        compactCalls++;onRuntime({type:'compaction-started'});startedResolve();
        await new Promise((resolve,reject)=>{
          const abort=()=>reject(signal.reason||new DOMException('Cancelled','AbortError'));
          signal.addEventListener('abort',abort,{once:true});
          if(signal.aborted)abort();
        });
        return {compacted:true};
      },
    };
    client.lease=async({runId})=>{state.view.ai.runnerRunId=runId;return {success:true};};
    client.heartbeat=async value=>{
      if(transition==='pause'&&value.status==='waiting'&&state.view.paused)controller.abort();
    };
    const run=runPlayer(client,connector,{signal:controller.signal,contexts,model:'game-model',reasoning:'max',
      pollMs:0,heartbeatMs:5,chatBatchMs:10000});
    await started;
    if(transition==='pause')state.view.paused=true;
    else {
      state.view.generation++;
      state.view.ai.runnerRunId='replacement-controller';
    }
    if(transition==='pause')await assert.rejects(run,{name:'AbortError'});
    else await run;
    assert.equal(compactCalls,1);
    assert.equal(contexts.gameplay.compactionPending,true,'an interrupted compaction is not treated as completed');
  });
}

test('unknown capability does not invoke native compaction and telemetry contains metadata only',async()=>{
  const {state,controller,client,heartbeats}=controllerFixture(makeView());
  let compactCalls=0;
  const contexts={gameplay:{key:contextKey('unknown-test','game-model','max'),id:'private-context-id',
    usage:{percent:90},compactionPending:true}};
  const connector={id:'unknown-test',capabilities:{contextUsage:false,compaction:false},ready:async()=>{},
    compact:async()=>{compactCalls++;}};
  client.heartbeat=async value=>{
    heartbeats.push(value);
    if(value.status==='waiting')controller.abort();
  };
  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,contexts,model:'game-model',reasoning:'max',
    memory:'private memory must not leave the runner',pollMs:0,heartbeatMs:10000,chatBatchMs:10000}),{name:'AbortError'});
  assert.equal(compactCalls,0);
  const telemetry=runtimeMetadata(connector,contexts,'waiting');
  assert.deepEqual(telemetry,{capabilities:{contextUsage:false,compaction:false},contextPercent:null,compaction:'idle'},
    'unsupported runtime capabilities cannot publish stale usage or a false scheduled state');
  const wire=JSON.stringify(heartbeats);
  assert.equal(wire.includes('private-context-id'),false);
  assert.equal(wire.includes('private memory must not leave the runner'),false);
});

test('channel context keys invalidate stale threshold state before compaction',async()=>{
  const {state,controller,client,heartbeats}=controllerFixture(makeView());
  let observations=0,persistedContexts=null;
  client.observe=async()=>{
    observations++;
    if(observations>=3) {
      state.view.revision=2;
      state.view.gameState.turnPhase='main';
      state.view.gameState.currentPlayerIndex=0;
      state.view.decision={type:'chooseAction'};
    }
    return structuredClone(state.view);
  };
  let compactCalls=0;
  const contexts={gameplay:{key:contextKey('scheduler-test','old-model','max'),id:'old-context',
    usage:{percent:91},compactionPending:true}};
  const connector={id:'scheduler-test',capabilities:{contextUsage:true,compaction:true},ready:async()=>{},
    decide:async(_view,{contextId})=>{
      assert.equal(contextId,null,'the replacement model starts without the stale context ID');
      return {contextId:'new-context',memory:'',action:{type:'endTurn',payload:{}}};
    },
    compact:async()=>{compactCalls++;}};
  client.act=async()=>{controller.abort();return {success:true};};
  client.heartbeat=async value=>{
    heartbeats.push(value);
    if(value.status==='waiting')controller.abort();
  };
  await assert.rejects(runPlayer(client,connector,{signal:controller.signal,contexts,model:'new-model',reasoning:'max',
    save:async(_memory,value)=>{persistedContexts=structuredClone(value.contexts);},
    pollMs:0,heartbeatMs:10000,chatBatchMs:10000}),{name:'AbortError'});
  assert.equal(compactCalls,0);
  assert.deepEqual(persistedContexts.gameplay,{key:contextKey('scheduler-test','new-model','max'),id:'new-context'},
    'an old model context must not carry its occupancy threshold into the replacement context');
  assert.ok(heartbeats.some(value=>value.runtime.contextPercent===null&&value.runtime.compaction==='idle'));
});

test('reader and gameplay contexts compact independently with their own model settings',async()=>{
  const {controller,client}=controllerFixture(makeView());
  const contexts={
    gameplay:{key:contextKey('scheduler-test','game-model','max'),id:'game-context',usage:{percent:60},compactionPending:false},
    reader:{key:contextKey('scheduler-test','reader-model','high'),id:'reader-context',usage:{percent:82},compactionPending:true},
  };
  const compacted=[];
  const connector={id:'scheduler-test',capabilities:{contextUsage:true,compaction:true},ready:async()=>{},
    compact:async options=>{
      compacted.push({contextId:options.contextId,model:options.model,reasoning:options.reasoning});
      options.onRuntime({type:'compaction-started'});options.onRuntime({type:'compaction-completed'});
      controller.abort();return {compacted:true};
    }};
  await runPlayer(client,connector,{signal:controller.signal,contexts,model:'game-model',reasoning:'max',
    pollMs:0,heartbeatMs:10000,chatBatchMs:10000});
  assert.deepEqual(compacted,[{contextId:'reader-context',model:'reader-model',reasoning:'high'}]);
  assert.equal(contexts.gameplay.compactionPending,false);
  assert.equal(contexts.reader.compactionPending,false);
});
