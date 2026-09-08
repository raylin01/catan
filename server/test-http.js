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
