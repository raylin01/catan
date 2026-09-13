import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RoomService,ROOM_INACTIVITY_MS} from './roomService.js';
import {RoomStore} from './store.js';
import {createAppServer} from './http.js';
import {requestLimits} from './publicHosting.js';

const HOST_KEY='public-http-operator-key-for-tests';

async function withServer(run,{service=new RoomService(),createLimit=30,publicUrl}={}) {
  const server=createAppServer({service,hostKey:HOST_KEY,createLimit,publicUrl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {await run({service,url});}
  finally {await new Promise(resolve=>server.close(resolve));}
}
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const json=async response=>({status:response.status,body:await response.json(),retryAfter:response.headers.get('retry-after')});

test('public creation reaches the 16-room cap; only a valid operator header overrides it',async()=>{
  await withServer(async({url})=>{
    const site=await json(await fetch(`${url}/api/site`));
    assert.equal(site.body.maxRooms,16);assert.equal(site.body.activeRooms,0);assert.equal(site.body.available,16);
    assert.equal(site.body.inference,'external');assert.equal(site.body.publicUrl,url);
    const rooms=[];
    for(let index=0;index<16;index++) {
      const result=await json(await post(`${url}/api/rooms`,{name:`Public ${index}`,operator:true,isOperator:true}));
      assert.equal(result.status,200);rooms.push(result.body);
    }
    assert.equal((await json(await post(`${url}/api/rooms`,{name:'Seventeenth',operator:true}))).status,429);
    assert.equal((await json(await post(`${url}/api/rooms`,{name:'Wrong key'},{'X-Host-Key':'wrong'}))).status,403);
    const excess=await json(await post(`${url}/api/rooms`,{name:'Operator excess'},{'X-Host-Key':HOST_KEY}));
    assert.equal(excess.status,200);assert.equal((await json(await fetch(`${url}/api/site`))).body.activeRooms,17);
    const room=rooms[0],view=await json(await fetch(`${url}/api/rooms/${room.code}`,{headers:{Authorization:`Bearer ${room.token}`}}));
    assert.equal(view.body.host,true);
    const closed=await json(await post(`${url}/api/rooms/${room.code}/commands`,{
      requestId:'close-capacity-room',revision:view.body.revision,type:'closeRoom',payload:{}},{Authorization:`Bearer ${room.token}`}));
    assert.equal(closed.status,200);
    assert.equal((await json(await fetch(`${url}/api/site`))).body.activeRooms,16);
    assert.equal((await json(await post(`${url}/api/rooms`,{name:'Still full'}))).status,429);
  });
});

test('invitation and watch routes remain public and do not adopt a bearer seat',async()=>{
  await withServer(async({service,url})=>{
    const room=(await json(await post(`${url}/api/rooms`,{name:'Watchable'}))).body;
    const initial=service.roomFor(room.code);
    const players=[];
    for(const [index,seat] of initial.slots.entries()) {
      const player=(await json(await post(`${url}/api/rooms/${room.code}/join`,{name:`Player ${index}`,role:'human',seatId:seat.id}))).body;
      players.push(player);
      assert.equal(service.command(room.code,player.token,{requestId:`watch-ready-${index}`,revision:service.roomFor(room.code).revision,
        generation:player.generation,type:'ready',payload:{}}).success,true);
    }
    assert.equal(service.command(room.code,room.token,{requestId:'watch-start',revision:service.roomFor(room.code).revision,type:'start',payload:{}}).success,true);
    const player=players[0];
    const invitation=await json(await fetch(`${url}/api/rooms/${room.code.toLowerCase()}/invitation`));
    assert.equal(invitation.status,200);
    assert.deepEqual(Object.keys(invitation.body).sort(),['success','code','name','status','seatCount','slots'].sort());
    assert.deepEqual(Object.keys(invitation.body.slots[0]).sort(),['id','kind','name','occupied','ready','provider','model'].sort());
    const fixture=service.roomFor(room.code);
    const ownedIndex=fixture.game.players.findIndex(candidate=>candidate.id===player.seatId);
    fixture.game.players[ownedIndex].resources.brick=4;fixture.game.players[ownedIndex].developmentCards=['victoryPoint'];fixture.game.players[ownedIndex].hiddenVictoryPoints=1;
    const beforeMembers=Object.keys(fixture.members).length,beforeActivity=fixture.lastActivityAt;
    const watch=await json(await fetch(`${url}/api/rooms/${room.code}/watch`,{headers:{Authorization:`Bearer ${player.token}`}}));
    const guest=await json(await fetch(`${url}/api/rooms/${room.code}/watch`));
    assert.equal(watch.status,200);assert.equal(watch.body.role,'spectator');assert.equal(watch.body.seatId,null);
    assert.deepEqual(watch.body,guest.body);
    const owner=(await json(await fetch(`${url}/api/rooms/${room.code}`,{headers:{Authorization:`Bearer ${player.token}`}}))).body;
    assert.equal(owner.gameState.myIndex,ownedIndex);assert.equal(owner.gameState.players[ownedIndex].resources.brick,4);
    assert.equal(watch.body.gameState.myIndex,-1);assert.equal(watch.body.gameState.players[ownedIndex].resources,4);
    assert.equal(watch.body.gameState.players[ownedIndex].developmentCards,1);
    assert.equal(Object.hasOwn(watch.body,'replayId'),false);
    assert.equal(Object.keys(service.roomFor(room.code).members).length,beforeMembers);
    assert.equal(service.roomFor(room.code).lastActivityAt,beforeActivity);
    assert.equal(JSON.stringify(watch.body).includes(player.token),false);
    assert.equal(JSON.stringify(watch.body).includes(room.token),false);
    assert.equal(Object.hasOwn(watch.body.slots[0],'controller'),false);
    assert.equal((await fetch(`${url}/api/rooms/${room.code}`)).status,401);
  });
});

test('agent guides contain public room setup only and terminal watch exposes a replay link',async()=>{
  await withServer(async({service,url})=>{
    const room=(await json(await post(`${url}/api/rooms`,{name:'Guide room',seats:[{kind:'ai',provider:'mcp',model:'sample-model'}]}))).body;
    const generic=await fetch(`${url}/agent-guide.md`);
    assert.equal(generic.status,200);assert.match(generic.headers.get('content-type'),/text\/markdown/);
    const genericText=await generic.text();assert.match(genericText,/ROOM_CODE/);
    const slot=service.roomFor(room.code).slots[0];
    const guide=await fetch(`${url}/api/rooms/${room.code}/agent-guide?seat=${encodeURIComponent(slot.id)}`);
    assert.equal(guide.status,200);assert.match(guide.headers.get('content-disposition'),/attachment/);
    const guideText=await guide.text();
    assert.match(guideText,new RegExp(room.code));assert.match(guideText,/sample-model/);
    assert.match(guideText,/watch\//);assert.equal(guideText.includes(room.token),false);
    assert.equal(guideText.includes(HOST_KEY),false);
    assert.equal((await fetch(`${url}/api/rooms/${room.code}/agent-guide?seat=unknown`)).status,400);
    const view=(await json(await fetch(`${url}/api/rooms/${room.code}`,{headers:{Authorization:`Bearer ${room.token}`}}))).body;
    const closed=await json(await post(`${url}/api/rooms/${room.code}/commands`,{
      requestId:'close-guide-room',revision:view.revision,type:'closeRoom',payload:{}},{Authorization:`Bearer ${room.token}`}));
    assert.equal(closed.status,200);
    const watch=(await json(await fetch(`${url}/api/rooms/${room.code}/watch`))).body;
    assert.equal(watch.status,'closed');assert.equal(watch.replayId,room.replayId);
    const replay=await json(await fetch(`${url}/api/replays/${watch.replayId}?perspective=omniscient`));
    assert.equal(replay.status,200);assert.ok(replay.body.perspectives.some(perspective=>perspective.id==='omniscient'));
    assert.equal((await fetch(`${url}/api/rooms/${room.code}/agent-guide`)).status,410);
    assert.equal((await post(`${url}/api/rooms/${room.code}/join`,{name:'Too late'})).status,410);
    assert.equal((await fetch(`${url}/api/replays/${watch.replayId}`,{method:'DELETE',headers:{'X-Host-Key':HOST_KEY}})).status,200);
    assert.equal((await fetch(`${url}/api/rooms/${room.code}/watch`)).status,404);
    assert.equal((await fetch(`${url}/api/replays/${watch.replayId}`)).status,404);
  });
});

test('SQLite restart keeps unfinished rooms in the public capacity count',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'catan-public-http-')),path=join(dir,'rooms.sqlite');
  let store;
  try {
    store=new RoomStore(path);
    let service=new RoomService({store,maxRooms:2});
    let first;
    await withServer(async({url})=>{
      first=(await json(await post(`${url}/api/rooms`,{name:'Persisted first'}))).body;
      assert.equal((await post(`${url}/api/rooms`,{name:'Persisted second'})).status,200);
      assert.equal((await json(await fetch(`${url}/api/site`))).body.available,0);
    },{service});
    store.close();store=new RoomStore(path);service=new RoomService({store,maxRooms:2});
    await withServer(async({url})=>{
      assert.equal((await json(await fetch(`${url}/api/site`))).body.activeRooms,2);
      assert.equal((await post(`${url}/api/rooms`,{name:'Blocked after restart'})).status,429);
      const observed=(await json(await fetch(`${url}/api/rooms/${first.code}`,{headers:{Authorization:`Bearer ${first.token}`}}))).body;
      assert.equal((await post(`${url}/api/rooms/${first.code}/commands`,{
        requestId:'persistent-close',revision:observed.revision,type:'closeRoom',payload:{}},{Authorization:`Bearer ${first.token}`})).status,200);
      assert.equal((await post(`${url}/api/rooms`,{name:'Admitted after close'})).status,200);
    },{service});
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('passive watch requests do not defer expiry; create rate limit is per source IP',async()=>{
  const clock={now:1000},service=new RoomService({now:()=>clock.now});
  await withServer(async({url})=>{
    const first=await json(await post(`${url}/api/rooms`,{name:'Passive room'}));assert.equal(first.status,200);
    clock.now+=ROOM_INACTIVITY_MS-1;
    assert.equal((await json(await fetch(`${url}/api/rooms/${first.body.code}/watch`))).body.status,'lobby');
    clock.now++;
    const closed=await json(await fetch(`${url}/api/rooms/${first.body.code}/watch`));
    assert.equal(closed.body.status,'closed');assert.equal(closed.body.replayId,first.body.replayId);
    assert.equal((await json(await fetch(`${url}/api/site`))).body.available,16);
    const second=await json(await post(`${url}/api/rooms`,{name:'Second room'}));assert.equal(second.status,200);
    const limited=await json(await post(`${url}/api/rooms`,{name:'Third room'},{Authorization:'Bearer arbitrary-token'}));
    assert.equal(limited.status,429);assert.ok(Number(limited.retryAfter)>0);
    const operator=await json(await post(`${url}/api/rooms`,{name:'Operator bypass'},{'X-Host-Key':HOST_KEY}));
    assert.equal(operator.status,200);
  },{service,createLimit:2});
});


test('forged bearer headers cannot rotate anonymous request budgets or evict creation cooldowns',()=>{
  const limits=requestLimits(),req={ip:'127.0.0.1',headers:{}};
  assert.equal(limits.create(req).allowed,true);
  for(let index=0;index<1200;index++)assert.equal(limits.request({...req,headers:{authorization:`Bearer forged-${index}`}}).allowed,true);
  assert.equal(limits.request({...req,headers:{authorization:'Bearer different'}}).allowed,false);
  // Verified independent controllers can share a network without sharing their seat budget.
  assert.equal(limits.request(req,'verified-seat-a').allowed,true);
  assert.equal(limits.request(req,'verified-seat-b').allowed,true);
  for(let index=0;index<10001;index++)limits.request({ip:`source-${index}`,headers:{}});
  for(let index=0;index<4;index++)assert.equal(limits.create(req).allowed,true);
  assert.equal(limits.create(req).allowed,false);
});

test('natural wins and host endings reject all new joins and mutations but preserve command retries',()=>{
  for(const won of [false,true]) {
    const service=new RoomService(),host=service.create({name:'Terminal fixture',seatCount:3});
    const players=service.roomFor(host.code).slots.map((slot,index)=>service.join(host.code,{role:'human',name:`Player ${index}`,seatId:slot.id}));
    for(const [index,player] of players.entries())assert.equal(service.command(host.code,player.token,{requestId:`ready-${index}`,revision:service.roomFor(host.code).revision,generation:player.generation,type:'ready',payload:{}}).success,true);
    assert.equal(service.command(host.code,host.token,{requestId:'start-terminal',revision:service.roomFor(host.code).revision,type:'start',payload:{}}).success,true);
    const end={requestId:'end-terminal',revision:service.roomFor(host.code).revision,type:'endGame',payload:{}};
    assert.equal(service.command(host.code,host.token,end).success,true);
    if(won) {const room=service.roomFor(host.code);room.game.winner=room.game.players[0].id;}
    const before=structuredClone(service.roomFor(host.code));
    for(const role of ['human','ai','spectator'])assert.equal(service.join(host.code,{role,name:'Late arrival',provider:'mcp'}).statusCode,410);
    assert.equal(service.command(host.code,players[0].token,{requestId:'postgame-chat',revision:before.revision,generation:players[0].generation,type:'chat',payload:{message:'Too late'}}).statusCode,410);
    assert.equal(service.command(host.code,host.token,end).success,true);
    assert.deepEqual(service.roomFor(host.code),before);
  }
});
