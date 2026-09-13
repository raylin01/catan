import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import * as G from '../../../server/gameLogic.js';
import {playerView,legalActions} from '../../../server/actions.js';
import {SEAFARERS_SCENARIOS} from '../../../shared/scenarios.js';
import {CITIES_KNIGHTS_CARDS} from '../../../shared/citiesKnights.js';

const markup=element=>renderToString(element).replaceAll('<!-- -->','');

test('all supported CK boards, painted progress cards, choices and private/public hands render',async()=>{
  const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom',logLevel:'error'});
  try {
    const [{default:Board},{default:Panel},{ProgressCard},{default:Choice},{default:ReplayHand},{CARD_ARTWORK}]=await Promise.all(['/src/components/HexBoard.jsx','/src/components/CitiesKnightsPanel.jsx','/src/components/ProgressCards.jsx','/src/components/CitiesKnightsChoice.jsx','/src/replay/ReplayHand.jsx','/src/presentation/artwork.js'].map(path=>vite.ssrLoadModule(path)));
    for(const scenario of ['base',...SEAFARERS_SCENARIOS.map(s=>s.id).filter(id=>!['the_pirate_islands','the_forgotten_tribe'].includes(id))])for(const count of [3,4,5,6]){
      const game=G.createGame('ck-render',{id:'p0',name:'Rowan'},count>=5,false);
      for(let i=1;i<count;i++)G.addPlayer(game,{id:`p${i}`,name:`Player ${i}`});
      assert.equal(G.configureExpansions(game,{version:1,extension56:count>=5,expansions:scenario==='base'?['cities_knights']:['seafarers','cities_knights'],scenario,...(scenario==='base'?{}:{setup:{layout:scenario==='new_world'?'variable':'fixed',seed:42}})}).success,true);
      assert.equal(G.startGame(game).success,true);
      const id=game.players[game.currentPlayerIndex].id,view=playerView(game,id),actions=legalActions(game,id);
      const board=markup(React.createElement(Board,{...view,gamePhase:view.phase,legalActions:actions,animate:false,selectedAction:scenario==='new_world'?'port':'settlement',isMyTurn:true,canBuildNow:true}));
      const panel=markup(React.createElement(Panel,{game:view,playerId:id,legalActions:actions}));
      assert.ok(!board.includes('NaN'),`${scenario}/${count} geometry`);assert.ok(panel.includes('Barbarian voyage'));assert.ok(board.includes('ck-board-layer'));
    }
    // A city retained on its side uses its existing piece, even with no city supply.
    const retained=G.createGame('ck-retained',{id:'p0',name:'Rowan'},false,false);
    for(let i=1;i<3;i++)G.addPlayer(retained,{id:`p${i}`,name:`Player ${i}`});
    G.configureExpansions(retained,{version:1,extension56:false,expansions:['cities_knights'],scenario:'base'});
    G.startGame(retained);
    retained.phase='playing';retained.turnPhase='main';retained.currentPlayerIndex=0;retained.pendingChoice=null;
    const retainedPlayer=retained.players[0];retainedPlayer.cities=0;retainedPlayer.settlements=0;retainedPlayer.resources={brick:0,lumber:0,wool:0,grain:2,ore:3};
    const retainedVertex=Object.values(retained.vertices)[0];retainedVertex.owner=0;retainedVertex.building='settlement';retainedVertex.pillagedNoPiece=true;
    const retainedView=playerView(retained,retainedPlayer.id),retainedActions=legalActions(retained,retainedPlayer.id);
    assert.ok(retainedActions.some(action=>action.type==='upgradeToCity'),'retained city has an authoritative restore action with zero spare cities');
    const {default:ActionPanel}=await vite.ssrLoadModule('/src/components/ActionPanel.jsx');
    const restorePanel=markup(React.createElement(ActionPanel,{isMyTurn:true,turnPhase:'main',player:retainedView.players[0],legalActions:retainedActions,citiesKnights:retainedView.citiesKnights,restoringPillagedCity:true}));
    const restoreButton=restorePanel.match(/<button[^>]*aria-label="Restore pillaged city[^>]*>/)?.[0];
    assert.ok(restoreButton);assert.ok(!restoreButton.includes('disabled'),'legal restoration stays enabled with zero spare cities');
    const restoreBoard=markup(React.createElement(Board,{...retainedView,gamePhase:'playing',turnPhase:'main',legalActions:retainedActions,selectedAction:'city',isMyTurn:true,canBuildNow:true,animate:false}));
    assert.ok(restoreBoard.includes('aria-label="Restore pillaged city"'));assert.ok(restoreBoard.includes('rotate(-90)'),'retained piece is shown on its side');
    for(const [type,info] of Object.entries(CITIES_KNIGHTS_CARDS)){
      assert.ok(CARD_ARTWORK[type],`${type} artwork`);
      const html=markup(React.createElement(ProgressCard,{card:{type,color:info.color}}));
      assert.ok(html.includes(info.name.replaceAll('&','&amp;')),`${type} named face`);assert.ok(html.includes('card-artwork'));assert.ok(!html.includes('src="undefined"'));
    }
    const pending={id:'wedding',expansion:'cities_knights',actorId:'p1',label:'Give cards for Wedding',selection:'cards',count:2,allowedCards:['paper','ore'],availableCards:{paper:1,ore:2},options:[]};
    const actor=markup(React.createElement(Choice,{choice:pending,playerId:'p1',players:[{id:'p1',name:'Ada'}]}));
    const spectator=markup(React.createElement(Choice,{choice:{...pending,options:[],availableCards:undefined},playerId:'p0',players:[{id:'p1',name:'Ada'}]}));
    assert.ok(actor.includes('Choose one paper'));assert.ok(actor.replaceAll('<!-- -->','').includes('Confirm 0 cards'));assert.ok(spectator.includes('Waiting for Ada'));assert.ok(!spectator.includes('Choose one paper'));
    const publicHtml=markup(React.createElement(ReplayHand,{players:[{id:'p1',name:'Ada',resources:9,progressCards:2,progressCardColors:{science:1,politics:1,trade:0}}]}));
    assert.ok(publicHtml.includes('Science progress cards'));assert.ok(publicHtml.includes('Politics progress cards'));assert.ok(!publicHtml.includes('Alchemy'));assert.ok(!publicHtml.includes('data-hand-resource="paper"'));
  } finally {await vite.close();}
});
