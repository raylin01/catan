import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './gameLogic.js';
import {RoomService} from './roomService.js';
import {RoomStore} from './store.js';
import {createAppServer} from './http.js';
import {GameClient} from '../bridge/client.js';
import {baseGameOptions,validateGameOptions} from './gameOptions.js';
import {modelObservation} from '../bridge/connectors/codex.js';
import {scenarioLayouts,SEAFARERS_SCENARIOS} from '../shared/scenarios.js';
import {newWorldComponents} from '../shared/newWorld.js';

const options=(scenario,count=3,seed=42)=>({version:1,extension56:count>=5,expansions:['seafarers'],scenario,
  setup:{layout:scenario==='new_world'?'variable':'fixed',seed}});
let sequence=0;
function issue(service,host,actor,type,payload={}) {
  const view=service.observe(host.code,actor.token);
  return service.command(host.code,actor.token,{requestId:`scenario-${++sequence}`,revision:view.revision,
    generation:view.generation,...(actor.role==='ai'?{controlEpoch:view.controlEpoch}:{}),type,payload});
}
function makeRoom(service,scenario,count=3,seed=42) {
  const host=service.create({name:'Seafarers integration',seatCount:count,gameOptions:options(scenario,count,seed)});
  assert.equal(host.success,true,host.error);
  const actors=service.observe(host.code,host.token).slots.map((slot,index)=>{
    const actor=service.join(host.code,{name:`Player ${index+1}`,role:'human',seatId:slot.id});
    assert.equal(actor.success,true,actor.error);
    assert.equal(issue(service,host,actor,'ready').success,true);
    return actor;
  });
  const start=issue(service,host,host,'start');assert.equal(start.success,true,start.error);
  return {host,actors};
}
function setupAction(view) {
  const actions=view.legalActions;
  const settlement=actions.filter(action=>action.type==='placeSettlement').sort((a,b)=>{
    const score=action=>G.getVertexAdjacentHexes(view.gameState,action.payload.vertexKey)
      .reduce((total,hex)=>total+(hex.terrain==='sea'?3:hex.terrain==='gold'?5:hex.number?1:0),0);
    return score(b)-score(a);
  })[0];
  return actions.find(action=>action.type==='resolveSeafarersChoice')
    ||actions.find(action=>action.type==='placePort')||settlement
    ||actions.find(action=>action.type==='placeShip')||actions.find(action=>action.type==='placeRoad')
    ||actions.find(action=>action.type==='advanceSetup');
}

test('scenario configuration accepts published setups and rejects malformed or unmapped variants',()=>{
  for(const scenario of SEAFARERS_SCENARIOS) for(const count of [3,4,5,6]) {
    for(const layout of ['fixed','variable']) {
      const result=validateGameOptions({...options(scenario.id,count),setup:{layout,seed:0xffffffff}},count);
      assert.equal(result.success,scenarioLayouts(scenario.id,count).includes(layout),`${scenario.id} ${count} ${layout}`);
    }
  }
  for(const seed of [-1,0x100000000,1.5,'42',NaN,Infinity]) {
    assert.equal(validateGameOptions(options('heading_for_new_shores',3,seed),3).success,false);
  }
  for(const patch of [{expansions:['seafarers','seafarers']},{expansions:['cities_knights']},
    {scenario:'unknown'},{setup:[]},{setup:{layout:'fixed',privateSeed:1}}]) {
    assert.equal(validateGameOptions({...options('heading_for_new_shores'),...patch},3).success,false);
  }
  assert.deepEqual(validateGameOptions(undefined,4).gameOptions,baseGameOptions());
});

test('changing expansion rules resets readiness and remains isolated to its lobby',()=>{
  const service=new RoomService();
  const host=service.create({name:'Host',seatCount:4});
  const other=service.create({name:'Other lobby',seatCount:4});
  const actor=service.join(host.code,{name:'Player',role:'human'});
  assert.equal(issue(service,host,actor,'ready').success,true);
  const before=structuredClone(service.rooms.get(host.code));
  const change={seatCount:4,gameOptions:options('the_fog_islands',4)};
  assert.equal(issue(service,host,actor,'configureGame',change).statusCode,403);
  assert.deepEqual(service.rooms.get(host.code),before);
  assert.equal(issue(service,host,host,'configureGame',change).success,true);
  const view=service.observe(host.code,actor.token);
  assert.deepEqual(view.gameOptions,change.gameOptions);
  assert.equal(view.slots.find(slot=>slot.id===actor.seatId).ready,false);
  assert.deepEqual(service.observe(other.code,other.token).gameOptions,baseGameOptions());
});

test('Fog setup, ships, actual seed and private piles survive SQLite recovery and replay',()=>{
  const store=new RoomStore(':memory:');
  try {
    const service=new RoomService({store});
    const {host,actors}=makeRoom(service,'the_fog_islands',3,null);
    let ships=0;
    for(let guard=0;guard<80&&service.rooms.get(host.code).game.phase==='setup';guard++) {
      const game=service.rooms.get(host.code).game;
      const actor=actors.find(candidate=>candidate.seatId===(game.pendingChoice?.actorId||game.players[game.currentPlayerIndex].id));
      const view=service.observe(host.code,actor.token),action=setupAction(view);
      assert.ok(action,`Setup stalled in ${view.gameState.turnPhase}`);
      const accepted=issue(service,host,actor,action.type,action.payload);assert.equal(accepted.success,true,accepted.error);
      if(action.type==='placeShip')ships++;
    }
    const raw=service.rooms.get(host.code).game;
    assert.equal(raw.phase,'playing');assert.ok(ships>0);
    assert.equal(Number.isSafeInteger(raw.gameOptions.setup.seed),true);
    assert.ok(raw.seafarers.fogTerrainPile.length>0);
    const authoritative=structuredClone(raw);
    const views=actors.map(actor=>service.observe(host.code,actor.token));
    const publicView=service.observe(host.code,host.token);
    assert.deepEqual(raw,authoritative,'projecting a view must not remove authoritative hidden piles');
    for(const view of [...views,publicView]) {
      assert.deepEqual(view.gameOptions,raw.gameOptions);
      for(const hidden of ['fogTerrainPile','fogNumberPile','rewardDeck','choiceQueue','portDrawPile']) {
        assert.equal(JSON.stringify(view).includes(`"${hidden}"`),false,hidden);
        assert.equal(JSON.stringify(modelObservation(view)).includes(`"${hidden}"`),false,`AI ${hidden}`);
      }
    }
    assert.equal(publicView.gameState.players.every(player=>typeof player.resources==='number'),true);
    const recovered=new RoomService({store});
    const after=recovered.observe(host.code,actors[0].token);
    assert.equal(after.paused,true);assert.deepEqual(after.gameState,views[0].gameState);
    assert.deepEqual(recovered.rooms.get(host.code).game,authoritative);
    const replay=recovered.replay(host.replayId,{perspective:actors[0].seatId,token:actors[0].token});
    assert.equal(replay.success,true);assert.deepEqual(replay.state.gameState,views[0].gameState);
    assert.deepEqual(replay.recording.gameOptions,raw.gameOptions);
    assert.equal(replay.recording.rulesVersion,'catan-seafarers-2025-v1');
    const exported=recovered.replayExport(host.replayId);
    assert.equal(exported.success,true);
    assert.equal(exported.lines.some(line=>line.includes('fogTerrainPile')||line.includes('fogNumberPile')),false);
    assert.equal(recovered.replay(host.replayId,{perspective:'omniscient'}).success,false);
  } finally {store.close();}
});

test('New World custom terrain and saved swaps match every lobby preview and the started board',()=>{
  const service=new RoomService(),count=6;
  const components=newWorldComponents(count);
  const terrainMix={...components.defaultTerrain};
  // Exchange gold for sea within the printed component supply.
  terrainMix.sea++;terrainMix.gold--;
  const gameOptions={...options('new_world',count,null),setup:{layout:'variable',seed:null,terrainMix}};
  const host=service.create({name:'Custom New World',seatCount:count,gameOptions});
  assert.equal(host.success,true,host.error);
  let view=service.observe(host.code,host.token);
  assert.equal(Number.isSafeInteger(view.gameOptions.setup.seed),true);
  const hexes=view.boardPreview.hexes;
  const entries=Object.entries(hexes);
  const gold=entries.find(([,hex])=>hex.terrain==='gold')[0];
  const sea=entries.find(([,hex])=>hex.terrain==='sea')[0];
  const actors=view.slots.map((slot,index)=>{
    const actor=service.join(host.code,{name:`Explorer ${index+1}`,role:'human',seatId:slot.id});
    assert.equal(issue(service,host,actor,'ready').success,true);return actor;
  });
  const savedOptions={...view.gameOptions,setup:{...view.gameOptions.setup,hexSwaps:[[gold,sea]]}};
  assert.equal(issue(service,host,host,'configureGame',{seatCount:count,gameOptions:savedOptions}).success,true);
  view=service.observe(host.code,host.token);
  assert.equal(view.slots.every(slot=>!slot.ready),true);
  assert.equal(view.boardPreview.hexes[gold].terrain,'sea');
  assert.equal(view.boardPreview.hexes[sea].terrain,'gold');
  for(const actor of actors) {
    assert.deepEqual(service.observe(host.code,actor.token).boardPreview,view.boardPreview);
    assert.equal(issue(service,host,actor,'ready').success,true);
  }
  assert.equal(issue(service,host,host,'start').success,true);
  const started=service.observe(host.code,host.token);
  assert.equal(started.boardPreview,undefined);
  assert.deepEqual(started.gameOptions,savedOptions);
  for(const [key,hex] of Object.entries(view.boardPreview.hexes)) {
    assert.equal(started.gameState.hexes[key].terrain,hex.terrain,key);
    assert.equal(started.gameState.hexes[key].number,hex.number,key);
  }
  const replay=service.replay(host.replayId);
  assert.deepEqual(replay.recording.gameOptions,savedOptions);
  assert.deepEqual(replay.state.gameState.hexes,started.gameState.hexes);
  for(const setup of [{...savedOptions.setup,terrainMix:{...terrainMix,sea:0}},
    {...savedOptions.setup,hexSwaps:[[gold,'not-a-hex']]},
    {...savedOptions.setup,hexSwaps:[[gold,gold]]}]) {
    assert.equal(validateGameOptions({...savedOptions,setup},count).success,false);
  }
});

test('six-player New World alternates harbor placement over authenticated HTTP before settlement setup',async()=>{
  const service=new RoomService(),hostKey='seafarers-integration-host';
  const server=createAppServer({service,hostKey});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const created=await fetch(`${url}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json','X-Host-Key':hostKey},
      body:JSON.stringify({name:'New World',seatCount:6,gameOptions:options('new_world',6)})}).then(response=>response.json());
    assert.equal(created.success,true,created.error);
    const host=new GameClient({server:url,...created}),players=[];
    for(let index=0;index<6;index++) {
      const player=new GameClient({server:url,code:created.code});
      const joined=await player.join({name:`Sailor ${index+1}`,role:'human'});
      await player.act(await player.observe(),'ready');players.push({client:player,seatId:joined.seatId});
    }
    await host.act(await host.observe(),'start');
    let view=await host.observe(),placed=0;
    while(view.gameState.turnPhase==='portPlacement'&&placed<20) {
      const current=view.gameState.players[view.gameState.currentPlayerIndex].id;
      const actor=players.find(player=>player.seatId===current);
      const own=await actor.client.observe();
      assert.equal(own.legalActions.every(action=>action.type==='placePort'),true);
      assert.ok(own.legalActions.length>0);
      const action=own.legalActions[0],other=players.find(player=>player!==actor);
      await assert.rejects(other.client.act(await other.client.observe(),action.type,action.payload),/turn/);
      await actor.client.act(own,action.type,action.payload);placed++;
      const next=await host.observe();
      assert.equal(next.gameState.ports.length,placed);
      if(next.gameState.turnPhase==='portPlacement')assert.equal(next.gameState.currentPlayerIndex,(view.gameState.currentPlayerIndex+1)%6);
      view=next;
    }
    assert.ok(placed>0);assert.notEqual(view.gameState.turnPhase,'portPlacement');
    assert.equal(view.gameState.phase,'setup');
    const actor=players.find(player=>player.seatId===view.gameState.players[view.gameState.currentPlayerIndex].id);
    assert.ok((await actor.client.observe()).legalActions.some(action=>action.type==='placeSettlement'));
    assert.equal(JSON.stringify(view).includes('portDrawPile'),false);
    const recording=service.replay(created.replayId);assert.equal(recording.success,true);
    assert.deepEqual(recording.state.gameState.ports,view.gameState.ports);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
