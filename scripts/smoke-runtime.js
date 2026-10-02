// Opt-in real model check. No game server, credentials, prompts or transcripts
// are uploaded/recorded by this test. Codex retains its normal local sessions.
import assert from 'node:assert/strict';
import {runtimeRequest} from '../bridge/connectors/codex-runtime.js';

const model=process.env.CATAN_TEST_MODEL||'gpt-6-luna';
const reasoning='max',events=[];
const onRuntime=event=>{
  events.push(event);
  if(event.type!=='context-id')console.log(JSON.stringify({event:event.type,...(event.context?{context:event.context}:{})}));
};
const schema={type:'object',properties:{action:{type:'string',enum:['endTurn','rollDice']},goal:{type:'string'}},required:['action','goal'],additionalProperties:false};
const common={model,reasoning,onRuntime,timeoutMs:300000};
console.log(JSON.stringify({test:'native compaction and continuation',model,reasoning}));
const first=await runtimeRequest({...common,schema,prompt:'Catan fixture. Your strategic goal is Harbor Orchard. You have no resources and your only legal action is endTurn. Return that action and the exact goal name. Remember the goal for the next turn.'});
assert.equal(first.value.action,'endTurn');assert.equal(first.value.goal,'Harbor Orchard');
assert.ok(first.context?.contextWindow>0,'runtime must report a context window');
const compacted=await runtimeRequest({...common,contextId:first.contextId,compact:true});
assert.equal(compacted.compacted,true);
assert.ok(events.some(e=>e.type==='compaction-started'));
assert.ok(events.some(e=>e.type==='compaction-completed'));
const next=await runtimeRequest({...common,contextId:first.contextId,schema,prompt:'Your next Catan turn has begun. The only legal action is rollDice. Return that action and the strategic goal you remembered from the previous turn.'});
assert.equal(next.value.action,'rollDice');assert.equal(next.value.goal,'Harbor Orchard');
console.log(JSON.stringify({success:true,model,reasoning,decisions:2,nativeCompactions:1,continuedSameContext:next.contextId===first.contextId}));
