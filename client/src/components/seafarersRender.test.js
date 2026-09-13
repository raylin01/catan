import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import * as G from '../../../server/gameLogic.js';
import {playerView,legalActions} from '../../../server/actions.js';
import {SEAFARERS_SCENARIOS} from '../../../shared/scenarios.js';

test('every scenario and seat count renders the authoritative board and scenario controls', async()=>{
  const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
  const {default:HexBoard}=await vite.ssrLoadModule('/src/components/HexBoard.jsx');
  const {default:SeafarersPanel}=await vite.ssrLoadModule('/src/components/SeafarersPanel.jsx');
  try {
    for(const scenario of SEAFARERS_SCENARIOS) for(const count of [3,4,5,6]) {
      const game=G.createGame('ui-render',{id:'p0',name:'Rowan'},count>=5,false);
      for(let index=1;index<count;index++)G.addPlayer(game,{id:`p${index}`,name:`Player ${index}`});
      assert.equal(G.configureExpansions(game,{version:1,extension56:count>=5,expansions:['seafarers'],scenario:scenario.id,setup:{layout:scenario.id==='new_world'?'variable':'fixed',seed:42}}).success,true);
      assert.equal(G.startGame(game).success,true);
      const playerId=game.players[game.currentPlayerIndex].id;
      const view=playerView(game,playerId),actions=legalActions(game,playerId);
      const board=renderToString(React.createElement(HexBoard,{...view,gamePhase:view.phase,legalActions:actions,animate:false,selectedAction:scenario.id==='new_world'?'port':'settlement',isMyTurn:true,canBuildNow:true}));
      const controls=renderToString(React.createElement(SeafarersPanel,{game:view,playerId,legalActions:actions,setSelectedAction(){},onAction(){}}));
      assert.equal(board.includes('NaN'),false,`${scenario.id} ${count}: board geometry`);
      assert.equal((board.match(/class="terrain-tile"/g)||[]).length,Object.keys(view.hexes).length);
      assert.ok(controls.includes('Seafarers scenario'));
      if(scenario.id==='the_pirate_islands')assert.ok(board.includes('ship-shape') && board.includes('fortress-token'));
      if(scenario.id==='cloth_for_catan')assert.equal((board.match(/class="village-token /g)||[]).length,count>=5?12:8);
      if(scenario.id==='new_world')assert.ok(board.includes('Place harbor here'));
      if(scenario.id==='the_wonders_of_catan')assert.equal((controls.match(/class="wonder-entry"/g)||[]).length,count>=5?7:5);
    }
  } finally {await vite.close();}
});
