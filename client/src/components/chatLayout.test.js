import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitChatLayout, resizeChatLayout} from './chatLayout.js';
import {chatMessageKey, newChatMessages} from './chatMessages.js';

test('saved desktop chat remains reachable after changing to a phone viewport',()=>{
  const layout=fitChatLayout({x:1200,y:700,width:650,height:600},{width:390,height:844});
  assert.deepEqual(layout,{x:10,y:234,width:370,height:600});
  assert.ok(layout.x+layout.width<=380);
  assert.ok(layout.y+layout.height<=834);
});
test('fresh and restored chat starts on the left while saved position survives',()=>{
  assert.deepEqual(fitChatLayout(null,{width:1440,height:900}),{x:20,y:410,width:350,height:350});
  assert.deepEqual(fitChatLayout({x:890,y:180,width:350,height:350},{width:1440,height:900}),{x:890,y:180,width:350,height:350});
  assert.equal(fitChatLayout(null,{width:320,height:600}).x,10);
});
test('invalid preferences and extreme drag or resize values cannot hide chat controls',()=>{
  for(const saved of [null,{}, {x:-900,y:-500,width:-20,height:Infinity}, {x:NaN,y:Infinity,width:'500',height:null}]) {
    const layout=fitChatLayout(saved,{width:1024,height:600});
    assert.ok(Object.values(layout).every(Number.isFinite));
    assert.ok(layout.x>=10&&layout.y>=10);
    assert.ok(layout.width>=280&&layout.height>=220);
    assert.ok(layout.x+layout.width<=1014&&layout.y+layout.height<=590);
  }
});
test('incoming chat is detected when the server rolls its 100-message window',()=>{
  const before=Array.from({length:100},(_,i)=>({id:`message-${i}`}));
  const after=[...before.slice(2),{id:'message-100'},{id:'message-101'}];
  assert.deepEqual(newChatMessages(after,chatMessageKey(before.at(-1))).map(m=>m.id),['message-100','message-101']);
  assert.equal(newChatMessages(after,chatMessageKey(after.at(-1))).length,0);
});
test('resizing against a screen edge keeps the opposite corner anchored',()=>{
  assert.deepEqual(resizeChatLayout({x:400,y:300,width:300,height:250},2000,2000,{width:1024,height:768}),
    {x:400,y:300,width:614,height:458});
});
