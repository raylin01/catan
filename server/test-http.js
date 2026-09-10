import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomService} from './roomService.js';
import {createAppServer} from './http.js';
import {GameClient} from '../bridge/client.js';

test('remote HTTP client plays setup with authenticated private views and no legacy socket bypass',async()=>{
  const service=new RoomService(),hostKey='integration-host-key-test';
  const server=createAppServer({service,hostKey});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const create=body=>fetch(`${url}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json','X-Host-Key':hostKey},body:JSON.stringify(body)}).then(r=>r.json());
    assert.equal((await fetch(`${url}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Host'})})).status,403);
    const room=await create({name:'Host',seatCount:3});assert.equal(room.success,true);
    const host=new GameClient({server:url,...room}),players=[];
    for(let i=0;i<3;i++) {
      const player=new GameClient({server:url,code:room.code});await player.join({name:`Player ${i}`,role:'human'});
      await player.act(await player.observe(),'ready');players.push(player);
    }
    await host.act(await host.observe(),'start');
    const view=await players[0].observe();
    const forged=new GameClient({server:url,code:room.code,token:view.gameState.players[1].id});
    await assert.rejects(forged.observe(),/credential/);
    for(let round=0;round<6;round++) {
      let actor;
      for(const player of players){const v=await player.observe();if(v.legalActions.some(a=>a.type==='placeSettlement')){actor=player;break;}}
      assert.ok(actor);
      for(const type of ['placeSettlement','placeRoad','advanceSetup']) {
        const v=await actor.observe(),action=v.legalActions.find(a=>a.type===type);assert.ok(action,type);
        await actor.act(v,type,action.payload);
      }
    }
    const final=await host.observe();assert.equal(final.gameState.phase,'playing');
    assert.equal(final.gameState.myIndex,-1);
    assert.ok(final.gameState.players.every(p=>typeof p.resources==='number'));
    assert.equal((await fetch(`${url}/socket.io/?EIO=4&transport=polling`)).status,404);
  } finally {await new Promise(r=>server.close(r));}
});

test('AI lease, status, control fencing, and human-only chat operate through HTTP',async()=>{
  const service=new RoomService(),hostKey='integration-host-key-ai';
  const server=createAppServer({service,hostKey});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const created=await fetch(`${url}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json','X-Host-Key':hostKey},
      body:JSON.stringify({name:'Host',seatCount:3,seats:[{kind:'ai',provider:'codex',model:'game-model',chatModel:'chat-model',chatReasoning:'high'}]})}).then(response=>response.json());
    const host=new GameClient({server:url,...created}),hostView=await host.observe(),seatId=hostView.slots[0].id;
    const ai=new GameClient({server:url,code:created.code});const joined=await ai.join({name:'Cora',role:'ai',seatId,provider:'codex',model:'game-model'});
    const runId='http-runner-one';
    assert.equal((await ai.lease({runId,controlEpoch:joined.controlEpoch})).success,true);
    assert.equal((await ai.heartbeat({runId,controlEpoch:joined.controlEpoch,status:'thinking'})).success,true);
    let observed=await host.observe();assert.equal(observed.slots[0].ai.status,'thinking');assert.equal(JSON.stringify(observed.slots[0]).includes(runId),false);
    await host.act(observed,'chat',{message:'Would you trade grain?'});
    const batch=await ai.readChat({runId,controlEpoch:joined.controlEpoch,afterSequence:0});
    assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].authorRole,'human');
    await ai.replyChat({runId,controlEpoch:joined.controlEpoch,requestId:'http-reply',replyToSequence:batch.messages[0].sequence,message:'I can consider that.'});
    observed=await host.observe();assert.equal(observed.chat.at(-1).authorRole,'ai');assert.equal(observed.chat.at(-1).playerName,'Cora');
    const own=await ai.observe();await ai.act({...own,runId},'ready');
    observed=await host.observe();await host.act(observed,'aiPause',{seatId});
    await assert.rejects(ai.act({...await ai.observe(),runId},'ready'),/paused|already ready/);
    const unauthorized=await fetch(`${url}/api/rooms/${created.code}/ai/chat/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"afterSequence":0}'});
    assert.equal(unauthorized.status,401);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
