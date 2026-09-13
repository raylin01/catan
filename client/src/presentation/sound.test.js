import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameAudio} from './sound.js';
import {SOUND_CLIPS} from './soundClips.js';

function fakeAudio() {
  const played=[], stopped=[], fetched=[];
  const context={state:'suspended',currentTime:1,destination:{},
    async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';},
    async decodeAudioData(data){return {data};},
    createBufferSource(){return {connect(){},disconnect(){},start(){played.push(this);},stop(){stopped.push(this);}};},
    createGain(){return {gain:{value:0},connect(){},disconnect(){}};}};
  const fetchAudio=async url=>{fetched.push(url);return {ok:true,arrayBuffer:async()=>url};};
  return {context, played, stopped, fetched, fetchAudio};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('recorded audio loads only on opt-in; hidden tabs and mute remain silent',async()=>{
  const fake=fakeAudio();let created=0;
  const sound=createGameAudio(()=>{created++;return fake.context;},fake.fetchAudio);
  sound.play('dice');assert.equal(created,0);assert.equal(fake.fetched.length,0);
  assert.equal(await sound.enable(),true);
  const loads=fake.fetched.length;
  assert.equal(loads,new Set(Object.values(SOUND_CLIPS).flat()).size);
  sound.play('dice',false);assert.equal(fake.played.length,0);
  sound.play('dice');assert.equal(fake.played.length,1);
  sound.mute();assert.equal(fake.stopped.length,1);
  fake.context.currentTime=2;sound.play('piece');assert.equal(fake.played.length,1);
  await sound.enable();assert.equal(fake.fetched.length,loads,'decoded samples are reused');
  sound.play('piece');assert.equal(fake.played.length,2);
  sound.close();assert.equal(await sound.enable(),false);
});

test('rapid receipts are gated; variants rotate and concurrent voices remain bounded',async()=>{
  const fake=fakeAudio(),sound=createGameAudio(()=>fake.context,fake.fetchAudio);
  await sound.enable();sound.play('dice');sound.play('dice');assert.equal(fake.played.length,1);
  fake.context.currentTime+=.2;sound.play('dice');assert.equal(fake.played.length,2);
  assert.notEqual(fake.played[0].buffer,fake.played[1].buffer);
  assert.ok(fake.stopped.includes(fake.played[0]));
  for(const kind of ['card','piece','cardGroup','robber','shuffle']) sound.play(kind);
  assert.ok(fake.played.length-fake.stopped.length<=4,'bound holds even before asynchronous ended callbacks');
  assert.doesNotThrow(()=>sound.play('__proto__'));
  sound.close();
});

test('actions during sample loading are dropped, never played late after opt-in',async()=>{
  const fake=fakeAudio();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  fake.context.decodeAudioData=async data=>{await gate;return {data};};
  const sound=createGameAudio(()=>fake.context,fake.fetchAudio),pending=sound.enable();
  await tick();sound.play('dice');release();assert.equal(await pending,true);
  assert.equal(fake.played.length,0);
  sound.play('dice');assert.equal(fake.played.length,1);sound.close();
});

test('mute during loading wins and a later opt-in reuses the completed samples',async()=>{
  const fake=fakeAudio();let release;
  const gate=new Promise(resolve=>{release=resolve;});
  fake.context.decodeAudioData=async data=>{await gate;return {data};};
  const sound=createGameAudio(()=>fake.context,fake.fetchAudio),pending=sound.enable();
  await tick();sound.mute();release();assert.equal(await pending,false);
  sound.play('dice');assert.equal(fake.played.length,0);
  const count=fake.fetched.length;assert.equal(await sound.enable(),true);assert.equal(fake.fetched.length,count);
  sound.close();
});

test('missing recordings fail quietly and retry on the next opt-in',async()=>{
  const fake=fakeAudio();let failing=true;
  const sound=createGameAudio(()=>fake.context,async url=>failing?{ok:false}:fake.fetchAudio(url));
  assert.equal(await sound.enable(),false);assert.doesNotThrow(()=>sound.play('card'));
  failing=false;assert.equal(await sound.enable(),true);sound.play('card');assert.equal(fake.played.length,1);
  sound.close();
});

test('one corrupt sample does not disable the others',async()=>{
  const fake=fakeAudio();fake.context.decodeAudioData=async data=>{if(data===SOUND_CLIPS.dice[0])throw Error('Corrupt');return {data};};
  const sound=createGameAudio(()=>fake.context,fake.fetchAudio);
  assert.equal(await sound.enable(),true);sound.play('dice');assert.equal(fake.played.length,1);
  assert.equal(fake.played[0].buffer.data,SOUND_CLIPS.dice[1]);sound.close();
});

test('closing during loading aborts requests and cannot later enable playback',async()=>{
  const fake=fakeAudio();const signals=[];
  const sound=createGameAudio(()=>fake.context,(_url,{signal})=>new Promise((_resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(Error('Aborted')));}));
  const pending=sound.enable();await tick();sound.close();assert.equal(await pending,false);
  assert.ok(signals.every(signal=>signal.aborted));assert.equal(await sound.enable(),false);
  sound.play('dice');assert.equal(fake.played.length,0);
});

test('late context resume cannot override a subsequent mute and unavailable audio is harmless',async()=>{
  const fake=fakeAudio();let release;
  fake.context.resume=()=>new Promise(resolve=>{release=resolve;});
  const sound=createGameAudio(()=>fake.context,fake.fetchAudio),pending=sound.enable();
  sound.mute();release();assert.equal(await pending,false);sound.play('dice');assert.equal(fake.played.length,0);
  sound.close();
  const unavailable=createGameAudio(()=>{throw Error('Audio unavailable');},fake.fetchAudio);
  assert.equal(await unavailable.enable(),false);assert.doesNotThrow(()=>unavailable.play('dice'));
});


test('closing before context resume completes does not start any sample requests',async()=>{
  const fake=fakeAudio();let release;
  fake.context.resume=()=>new Promise(resolve=>{release=resolve;});
  const sound=createGameAudio(()=>fake.context,fake.fetchAudio),pending=sound.enable();
  sound.close();release();assert.equal(await pending,false);assert.equal(fake.fetched.length,0);
});


test('a later gesture can recover externally suspended audio without reloading samples', async () => {
  const fake=fakeAudio(), sound=createGameAudio(()=>fake.context,fake.fetchAudio);
  assert.equal(sound.isRunning(),false);
  await sound.enable();
  assert.equal(sound.isRunning(),true);
  const count=fake.fetched.length;
  fake.context.state='suspended';
  assert.equal(sound.isRunning(),false);
  sound.play('dice');
  assert.equal(fake.played.length,0);
  await sound.enable();
  assert.equal(sound.isRunning(),true);
  assert.equal(fake.fetched.length,count);
  sound.play('dice');
  assert.equal(fake.played.length,1);
  sound.mute();
  assert.equal(sound.isRunning(),false);
  sound.close();
});
