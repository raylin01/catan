import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';

test('concurrent offers render role-specific controls and public event details', async()=>{
  const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
  try {
    const {default:Panel}=await vite.ssrLoadModule('/src/components/RoomTradePanel.jsx');
    const {EventDetails}=await vite.ssrLoadModule('/src/components/GameLog.jsx');
    const {createFixture,DESIGN_SLOTS}=await vite.ssrLoadModule('/src/design/fixture.js');
    const game=createFixture('play');
    const trades=[{id:'incoming',from:'seat-b',to:'seat-a',give:{wool:2},get:{grain:1},status:'offered'},
      {id:'outgoing',from:'seat-a',to:'seat-c',give:{brick:1},get:{ore:1},status:'accepted'}];
    const props={snapshot:{trades,slots:DESIGN_SLOTS,paused:false},gameState:game,onCommand(){},onClose(){},addNotification(){}};
    const player=renderToString(React.createElement(Panel,{...props,seatId:'seat-a'}));
    for(const text of ['Mara','Theo','Accept offer','Reject','Confirm trade','New offer'])assert.ok(player.includes(text),text);
    const spectator=renderToString(React.createElement(Panel,{...props,seatId:null}));
    for(const text of ['Mara','Theo','Wool','Ore'])assert.ok(spectator.includes(text),text);
    for(const text of ['Accept offer','Reject','Confirm trade','New offer','available'])assert.equal(spectator.includes(text),false,text);
    const detail=renderToString(React.createElement(EventDetails,{event:{type:'tradeReject',details:{trade:trades[0]},payload:{resources:{ore:999},privateNote:'sentinel-secret'}},players:game.players}));
    assert.ok(detail.includes('Mara'));assert.ok(detail.includes('wool'));assert.equal(detail.includes('999'),false);assert.equal(detail.includes('sentinel-secret'),false);
    const roll=renderToString(React.createElement(EventDetails,{event:{details:{dice:{die1:2,die2:6,total:8}}}}));
    assert.ok(roll.includes('Dice: 2 plus 6 equals 8'));
    assert.equal(renderToString(React.createElement(EventDetails,{event:{summary:'Legacy event without details'}})), '');
  } finally {await vite.close();}
});
