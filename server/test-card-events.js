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


test('a development draw delivers a concealed card to every observer without leaking its identity',()=>{
  const before={bank:pool(),players:[{id:'a',resources:pool({ore:1,wool:1,grain:1}),developmentCards:[],newDevCards:[]}]};
  const room={revision:5,slots:[{id:'a',generation:2}],game:structuredClone(before)};
  room.game.players[0].resources=pool();
  room.game.bank=pool({ore:1,wool:1,grain:1});
  room.game.players[0].newDevCards=['victoryPoint'];
  appendCardEvent(room,before,'buyDevCard');
  const draw={from:'bank',to:'a',count:1,resource:'development'};
  for(const observer of [{role:'spectator'},{seatId:'a',generation:2},{seatId:'a',generation:3}]) {
    const event=projectCardEvents(room,observer)[0];
    assert.deepEqual(event.transfers.at(-1),draw);
    assert.equal(JSON.stringify(event).includes('victoryPoint'),false);
  }
  assert.deepEqual(projectCardEvents(room,{role:'spectator'})[0].transfers[0],{from:'a',to:'bank',count:3});
  const purchased=structuredClone(room.game);
  room.game.players[0].developmentCards=['victoryPoint'];
  room.game.players[0].newDevCards=[];
  assert.equal(appendCardEvent(room,purchased,'endTurn'),null,'moving new cards to ready cards is not a draw');
});

test('commodity identities stay private while progress colors and instant VP draws remain public',()=>{
  const science={id:'private-card-id',type:'alchemy',color:'science'},printing={id:'printing-id',type:'printing',color:'science'};
  const before={bank:pool(),citiesKnights:{commodityBank:{paper:12,coin:12,cloth:12},progressDecks:{science:[science,printing],trade:[],politics:[]}},
    players:[{id:'a',resources:pool(),commodities:{paper:0,coin:0,cloth:0},progressCards:[],progressVictoryCards:[]}]};
  const room={revision:1,slots:[{id:'a',generation:2}],game:structuredClone(before)};
  room.game.citiesKnights.commodityBank.paper-=2;room.game.players[0].commodities.paper+=2;
  room.game.players[0].progressCards.push(room.game.citiesKnights.progressDecks.science.shift());
  room.game.citiesKnights.progressDecks.science.shift();
  room.game.players[0].progressVictoryCards.push({type:'printing',color:'science'});
  appendCardEvent(room,before,'rollDice','city-roll');
  const own=projectCardEvents(room,{seatId:'a',generation:2})[0];
  assert.deepEqual(own.transfers,[{from:'bank',to:'a',count:2,resource:'paper'},{from:'bank',to:'a',count:2,resource:'progressScience'}]);
  const publicReceipt=projectCardEvents(room,{role:'spectator'})[0];
  assert.deepEqual(publicReceipt.transfers,[{from:'bank',to:'a',count:2},{from:'bank',to:'a',count:2,resource:'progressScience'}]);
  assert.equal(JSON.stringify(publicReceipt).includes('alchemy'),false);
  assert.equal(JSON.stringify(publicReceipt).includes('private-card-id'),false);
  assert.deepEqual(projectCardEvents(room,{seatId:'a',generation:3})[0],publicReceipt);
});
