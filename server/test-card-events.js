import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCardEvent,projectCardEvents} from './cardEvents.js';

const pool=values=>({brick:0,lumber:0,wool:0,grain:0,ore:0,...values});

test('resource deltas become conserved transfers with private resource projection',()=>{
  const before={bank:pool({brick:19,wool:19}),players:[
    {id:'a',resources:pool({brick:1})},{id:'b',resources:pool()}
  ]};
  const room={revision:12,slots:[{id:'a',generation:2},{id:'b',generation:4}],game:structuredClone(before),cardEvents:[],cardEventSequence:0};
  room.game.bank.brick-=1;room.game.bank.wool-=2;
  room.game.players[1].resources.brick+=1;room.game.players[1].resources.wool+=2;
  const event=appendCardEvent(room,before,'rollDice','roll-1');
  assert.equal(event.revision,12);assert.equal(event.sequence,1);assert.equal(event.rollId,'roll-1');

  const owner=projectCardEvents(room,{seatId:'b',generation:4})[0];
  assert.deepEqual(owner.transfers,[
    {from:'bank',to:'b',count:1,resource:'brick'},
    {from:'bank',to:'b',count:2,resource:'wool'}
  ]);
  const spectator=projectCardEvents(room,{role:'spectator'})[0];
  assert.deepEqual(spectator.transfers,[{from:'bank',to:'b',count:3}],
    'hidden resources aggregate so category counts cannot be inferred');
  const replacement=projectCardEvents(room,{seatId:'b',generation:5})[0];
  assert.deepEqual(replacement.transfers,spectator.transfers,'a replacement controller cannot reveal prior private history');
  assert.equal(appendCardEvent(room,structuredClone(room.game),'endTurn'),null);
  assert.equal(room.cardEvents.length,1);
});

test('player exchanges retain both directed legs for each participant',()=>{
  const before={bank:pool(),players:[
    {id:'a',resources:pool({brick:2})},{id:'b',resources:pool({wool:1})}
  ]};
  const room={revision:3,slots:[{id:'a',generation:1},{id:'b',generation:1}],game:structuredClone(before)};
  room.game.players[0].resources=pool({wool:1});
  room.game.players[1].resources=pool({brick:2});
  appendCardEvent(room,before,'tradeConfirm');
  assert.deepEqual(projectCardEvents(room,{seatId:'a',generation:1})[0].transfers,[
    {from:'a',to:'b',count:2,resource:'brick'},
    {from:'b',to:'a',count:1,resource:'wool'}
  ]);
  assert.deepEqual(projectCardEvents(room,{role:'spectator'})[0].transfers,[
    {from:'a',to:'b',count:2},{from:'b',to:'a',count:1}
  ]);
});
