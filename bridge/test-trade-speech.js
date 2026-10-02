import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTradeSpeech} from './trade-speech.js';
import {codexConnector} from './connectors/codex.js';
const view=()=>({seatId:'ai',token:'TOKEN_CANARY',memory:'MEMORY_CANARY',chat:[{message:'RAW_CHAT_CANARY'}],
  gameState:{phase:'playing',turnPhase:'main',playerTradingAllowed:true,
    players:[{id:'ai',name:'Orion',resources:{brick:3},developmentCards:['PRIVATE_CARD_CANARY']},{id:'other',name:'Ray',resources:5}],
    hexes:{hidden:'BOARD_CANARY'}},
  trades:[{id:'offered',from:'ai',to:'other',give:{brick:1,wool:0},get:{grain:2},status:'offered',counterOf:null,privatePlan:'PLAN_CANARY'}]});
const interest={kind:'interest',wants:['grain'],offers:['brick'],to:null,privatePlan:'INTENT_CANARY'};

test('public interest and exact offer speech inputs contain no private state, prose, or arbitrary extension fields',()=>{
  const source=view(),before=structuredClone(source);
  for(const input of [projectTradeSpeech(source,{intent:interest}),projectTradeSpeech(source,{tradeId:'offered'})]) {
    assert.equal(JSON.stringify(input).includes('CANARY'),false);
    assert.equal(input.players[0].name,'Orion');assert.equal(input.seatId,'ai');
    for(const key of ['gameState','hand','resources','memory','chat','token','legalActions'])assert.equal(key in input,false);
  }
  const offer=projectTradeSpeech(source,{tradeId:'offered'});
  assert.deepEqual(offer.offer.give,{brick:1});assert.deepEqual(offer.offer.get,{grain:2});
  assert.deepEqual(source,before);
  // The helper must not even read private card fields while preparing speech.
  Object.defineProperty(source.gameState.players[0],'resources',{get(){throw Error('Private hand accessed');}});
  assert.equal(projectTradeSpeech(source,{intent:interest}).purpose,'interest');
  assert.equal(projectTradeSpeech(source,{tradeId:'offered'}).purpose,'offer');
});

test('stale, foreign, ended, paused and malformed offers cannot invite public speech',()=>{
  for(const status of ['accepted','confirmed','rejected','cancelled']) {
    const source=view();source.trades[0].status=status;
    assert.equal(projectTradeSpeech(source,{tradeId:'offered'}),null);
  }
  for(const mutate of [s=>s.paused=true,s=>s.closed=true,s=>s.gameState.phase='finished',s=>s.gameState.turnPhase='roll',
    s=>s.gameState.playerTradingAllowed=false,s=>s.trades[0].from='other',s=>s.trades[0].get={unknown:1},s=>s.trades[0].give={brick:-1}]) {
    const source=view();mutate(source);assert.equal(projectTradeSpeech(source,{tradeId:'offered'}),null);
  }
  assert.equal(projectTradeSpeech(view(),{tradeId:'missing'}),null);
  assert.equal(projectTradeSpeech(view(),{tradeId:'offered',intent:interest}),null);
  assert.equal(projectTradeSpeech(view(),{intent:{...interest,wants:['grain','grain']}}),null);
  assert.equal(projectTradeSpeech(view(),{intent:{...interest,offers:['grain']}}),null);
  assert.equal(projectTradeSpeech(view(),{intent:{...interest,to:'ai'}}),null);
});

test('counter speech uses new authoritative terms and configured expansion commodities',()=>{
  const source=view();source.gameState.gameOptions={expansions:['cities_knights']};source.gameState.citiesKnights={};
  Object.assign(source.trades[0],{id:'new-counter',counterOf:'old-offer',give:{paper:1},get:{coin:1}});
  const input=projectTradeSpeech(source,{tradeId:'new-counter'});
  assert.equal(input.purpose,'counter');assert.deepEqual(input.offer,{id:'new-counter',counterOf:'old-offer',from:'ai',to:'other',give:{paper:1},get:{coin:1}});
  assert.equal(projectTradeSpeech(source,{tradeId:'old-offer'}),null);
});

test('actual speaker request asks for first-person useful trade terms without inventing commitments',async()=>{
  const input=projectTradeSpeech(view(),{tradeId:'offered'});let request;
  await codexConnector.speak(input,{model:'configured-chat-model',reasoning:'max',complete:async value=>{
    request=value;return {value:{message:null},contextId:'speaker-only'};
  }});
  assert.equal(request.model,'configured-chat-model');assert.equal(request.reasoning,'max');
  assert.match(request.prompt,/first person/);assert.match(request.prompt,/confirmed/);assert.match(request.prompt,/Silence/);
  assert.equal(request.prompt.includes('CANARY'),false);
});
