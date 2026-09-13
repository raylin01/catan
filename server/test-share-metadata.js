import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RoomService} from './roomService.js';
import {createAppServer} from './http.js';
import {shareMetadata,renderShareHtml} from './shareMetadata.js';

const origin='https://catan.rlin.dev';
const template='<!doctype html><html><head><title>Old title</title></head><body><div id="root"></div></body></html>';

test('metadata whitelists public room data, escapes titles, and discards credentials and extra queries',()=>{
  const service=new RoomService();
  const room=service.create({name:'<script>"room"&'});
  const metadata=shareMetadata({path:'/',query:{room:room.code,role:'human',token:'SECRET',hostKey:'SECRET'},origin,service});
  const html=renderShareHtml(template,metadata,origin);
  assert.equal(metadata.image,'join');assert.equal(metadata.unlisted,true);
  assert.match(html,/og:image" content="https:\/\/catan.rlin.dev\/social\/join.png/);
  assert.match(html,/&lt;script&gt;&quot;room&quot;&amp;/);
  assert.equal(html.includes('SECRET'),false);assert.equal(html.includes(room.token),false);
  assert.match(html,/\?room=[A-F0-9]{8}&amp;role=human/);
  assert.equal(shareMetadata({path:`/watch/${room.code}`,service,origin}).image,'watch');
  assert.equal(shareMetadata({path:'/',query:{room:['BAD','VALUE']},service,origin}).status,404);
  assert.equal(shareMetadata({path:'/watch/invalid',service,origin}).status,404);
  assert.equal(shareMetadata({path:'/missing',service,origin}).status,404);
});

test('stable watch redirects only after terminal closure; live replay metadata promises private hands stay protected',()=>{
  const service=new RoomService(),room=service.create({name:'Sharing fixture'});
  const live=shareMetadata({path:`/replay/${room.replayId}`,service,origin});
  assert.match(live.description,/Private hands remain protected/);
  assert.equal(shareMetadata({path:`/watch/${room.code}`,service,origin}).redirect,undefined);
  const close=service.command(room.code,room.token,{requestId:'close-meta',revision:0,type:'closeRoom',payload:{}});
  assert.equal(close.success,true);
  assert.equal(shareMetadata({path:`/watch/${room.code}`,service,origin}).redirect,`/replay/${room.replayId}`);
  assert.equal(shareMetadata({path:'/',query:{room:room.code},service,origin}).redirect,`/replay/${room.replayId}`);
  const ended=shareMetadata({path:`/replay/${room.replayId}`,service,origin});
  assert.match(ended.description,/inspect every hand/);
  service.deleteReplay(room.replayId);
  assert.equal(shareMetadata({path:`/watch/${room.code}`,service,origin}).status,404);
});

test('crawler HTTP receives complete metadata without JavaScript, with noindex and correct redirects/errors',async()=>{
  const service=new RoomService(),room=service.create({name:'HTTP preview'});
  const server=createAppServer({service,hostKey:'test-only-operator-key',publicUrl:origin,indexHtml:template});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const home=await fetch(`${url}/`),html=await home.text();
    assert.equal(home.status,200);assert.match(html,/<title>Catan Online by rlin<\/title>/);assert.match(html,/twitter:card/);
    const invite=await fetch(`${url}/?room=${room.code}&role=human&token=DO_NOT_LEAK`);
    assert.equal(invite.headers.get('x-robots-tag'),'noindex, noarchive');
    assert.equal((await invite.text()).includes('DO_NOT_LEAK'),false);
    const invalid=await fetch(`${url}/watch/no-such-room`);assert.equal(invalid.status,404);assert.match(await invalid.text(),/Link unavailable/);
    assert.equal(service.command(room.code,room.token,{requestId:'end-http-meta',revision:0,type:'closeRoom',payload:{}}).success,true);
    const watch=await fetch(`${url}/watch/${room.code}`,{redirect:'manual'});
    assert.equal(watch.status,302);assert.equal(watch.headers.get('location'),`/replay/${room.replayId}`);
    const replay=await fetch(`${url}/replay/${room.replayId}`);assert.match(await replay.text(),/social\/replay.png/);
    const robots=await (await fetch(`${url}/robots.txt`)).text();assert.match(robots,/Disallow: \/api\//);assert.equal(robots.includes('Disallow: /watch/'),false);

  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('all generated social images are compact 1200 by 630 PNGs',()=>{
  for(const kind of ['home','join','watch','replay']){
    const buffer=readFileSync(new URL(`../client/public/social/${kind}.png`,import.meta.url));
    assert.equal(buffer.subarray(1,4).toString(),'PNG');assert.equal(buffer.readUInt32BE(16),1200);assert.equal(buffer.readUInt32BE(20),630);
    assert.ok(buffer.length<500000);
  }
});

test('share lookups share the public API budget and ignore forged credentials',async()=>{
  const service=new RoomService(),room=service.create({name:'Budget fixture'});
  const server=createAppServer({service,hostKey:'test-only-operator-key',publicUrl:origin,indexHtml:template});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  let lookups=0;
  const invitation=service.invitation.bind(service);
  service.invitation=(...args)=>{lookups++;return invitation(...args);};
  try {
    for(let index=0;index<1200;index++) {
      const response=await fetch(`${url}/api/site`);
      assert.equal(response.status,200);await response.text();
    }
    for(const path of [`/watch/${room.code}`,`/?room=${room.code}`,`/replay/${room.replayId}`]) {
      const response=await fetch(`${url}${path}`,{headers:{Authorization:`Bearer forged-${path}`}});
      assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);await response.text();
    }
    assert.equal(lookups,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
