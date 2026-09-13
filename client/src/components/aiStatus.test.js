import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {projectAiStatus,LEASE_TTL_MS,OFFLINE_TTL_MS} from '../../../server/aiControl.js';
import {captureState} from '../../../server/recording.js';

test('AI status requires live connection evidence and preserves authenticated state',async()=>{
  const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
  try {
    const {AiStatus}=await vite.ssrLoadModule('/src/components/AiControls.jsx');
    const render=slot=>renderToString(React.createElement(AiStatus,{slot}));
    const now=100000;
    const slot={id:'ai-seat',kind:'ai',name:'Ada',aiPaused:false,
      runnerLease:{runId:'test-runner',status:'thinking',lastActivityAt:now,expiresAt:now+LEASE_TTL_MS}};

    // Anonymous presence is not a runner connection, and recorded status is historical.
    for(const connected of [true,false])assert.equal(render({id:slot.id,kind:'ai',connected}),'');
    for(const aiPaused of [false,true]){
      const recorded=captureState({slots:[{...slot,aiPaused}],game:null}).slots[0];
      assert.equal(recorded.ai.status,'thinking');
      assert.equal(render(recorded),'','replay must not invent current connectivity or pause state');
    }
    assert.equal(render({...slot,ai:{connection:'unknown',status:'thinking'}}),'');
    assert.equal(render({kind:'human',ai:{connection:'online'}}),'');

    const cases=[
      ['thinking','Choosing a move',true],
      ['reading-chat','Considering chat',true],
      ['speaking','Preparing a reply',true],
      ['waiting','Waiting for play',false],
      ['error','Controller error',false],
      ['stopped','Controller stopped',false],
    ];
    for(const [status,label,active] of cases){
      const live={...slot,runnerLease:{...slot.runnerLease,status}};
      const html=render({...live,ai:projectAiStatus(live,now)});
      assert.ok(html.includes(label),status);
      assert.equal(html.includes('ai-status-active'),active,status);
      assert.ok(!html.includes('ai-status-offline'),status);
    }
    const stale=render({...slot,ai:projectAiStatus(slot,now+LEASE_TTL_MS+1)});
    assert.ok(stale.includes('Connection stale'));assert.ok(stale.includes('ai-status-offline'));
    const offline=render({...slot,ai:projectAiStatus(slot,now+OFFLINE_TTL_MS+1)});
    assert.ok(offline.includes('Controller offline'));assert.ok(offline.includes('ai-status-offline'));
    const paused={...slot,aiPaused:true};
    assert.ok(render({...paused,ai:projectAiStatus(paused,now)}).includes('AI paused'));
  } finally {await vite.close();}
});
