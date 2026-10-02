import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {contextUsage,runtimeRequest,runtimeArgs} from './connectors/codex-runtime.js';

const id='12345678-1234-1234-1234-123456789abc';
function fakeRuntime({compaction=false,failTurn=false,noComplete=false,tool=false,crash=false,inheritedTool=false,fragmentUtf8=false,abort}={}) {
  const requests=[];
  const spawnProcess=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
    child.kill=()=>{if(child.exitCode===null){child.exitCode=0;child.emit('close',0);}};
    const notify=(method,params)=>{
      const line=Buffer.from(JSON.stringify({method,params})+'\n');
      const start=line.indexOf(Buffer.from('港'));
      if(fragmentUtf8&&start>=0) {
        child.stdout.write(line.subarray(0,start+1));
        child.stdout.write(line.subarray(start+1));
      } else child.stdout.write(line);
    };
    child.stdin=new Writable({write(chunk,_encoding,done){
      const req=JSON.parse(chunk.toString());requests.push(req);
      if(req.id===undefined||!req.method){done();return;}
      const result=req.method==='mcpServerStatus/list'?{data:[{name:'local-tool',tools:(!req.params.threadId||inheritedTool)?{unsafe:{}}:{},resources:[],resourceTemplates:[]}],nextCursor:null}:req.method.startsWith('thread/')&&req.method!=='thread/compact/start'?{thread:{id}}:{};
      child.stdout.write(JSON.stringify({id:req.id,result})+'\n');done();
      if(req.method==='turn/start'||req.method==='thread/compact/start')setImmediate(()=>{
        if(crash)return child.kill();
        notify('turn/started',{threadId:id,turn:{id:'turn-1'}});
        if(abort)return abort.abort();
        if(tool)return child.stdout.write(JSON.stringify({id:90,method:'item/commandExecution/requestApproval',params:{threadId:id}})+'\n');
        notify('thread/tokenUsage/updated',{threadId:id,tokenUsage:{last:{inputTokens:79,outputTokens:1,cachedInputTokens:79},total:{inputTokens:9999},modelContextWindow:100}});
        if(compaction){
          notify('item/started',{threadId:id,item:{type:'contextCompaction',id:'compact-1'}});
          if(!noComplete)notify('item/completed',{threadId:id,item:{type:'contextCompaction',id:'compact-1'}});
        } else notify('item/completed',{threadId:id,item:{type:'agentMessage',text:JSON.stringify({move:'endTurn',...(fragmentUtf8?{message:'港口'}:{})})}});
        notify('turn/completed',{threadId:id,turn:{id:'turn-1',status:failTurn?'failed':'completed'}});
      });
    }});
    return child;
  };
  return {spawnProcess,requests};
}

test('context occupancy uses latest input/output, never cumulative or double-counted cache',()=>{
  assert.deepEqual(contextUsage({last:{inputTokens:70,outputTokens:10,cachedInputTokens:60},total:{totalTokens:9000},modelContextWindow:100}),
    {usedTokens:80,contextWindow:100,percent:80,estimated:true});
  for(const value of [undefined,{}, {last:{inputTokens:0,outputTokens:0},modelContextWindow:100}, {last:{inputTokens:70,outputTokens:1},modelContextWindow:null},
    {last:{inputTokens:-1,outputTokens:1},modelContextWindow:100}])assert.equal(contextUsage(value),null);
});
test('native transport streams metadata, uses explicit model/effort and isolated saved context',async()=>{
  const fake=fakeRuntime(),events=[];
  const result=await runtimeRequest({...fake,model:'gpt-6-luna',reasoning:'max',schema:{type:'object'},prompt:'fixture',onRuntime:e=>events.push(e)});
  assert.equal(result.contextId,id);assert.equal(result.value.move,'endTurn');assert.equal(result.context.percent,80);
  assert.deepEqual(events.map(e=>e.type),['context-id','context']);
  const turn=fake.requests.find(r=>r.method==='turn/start');assert.equal(turn.params.model,'gpt-6-luna');assert.equal(turn.params.effort,'max');
  assert.ok(!JSON.stringify(events).includes('endTurn'),'model output is not telemetry');
  assert.deepEqual(fake.requests.find(r=>r.method==='thread/start').params.config.mcp_servers,{'local-tool':{enabled:false}});
  assert.ok(runtimeArgs().includes('hooks'));assert.ok(runtimeArgs().includes('mcp_servers={}'));
});
test('native JSON frames preserve Unicode split across stdout chunks',async()=>{
  const result=await runtimeRequest({...fakeRuntime({fragmentUtf8:true}),schema:{type:'object'},prompt:'fixture'});
  assert.equal(result.value.message,'港口');
});
test('compaction waits for native completion and resumes only the specified context',async()=>{
  const fake=fakeRuntime({compaction:true}),events=[];
  const result=await runtimeRequest({...fake,contextId:id,compact:true,onRuntime:e=>events.push(e)});
  assert.equal(result.compacted,true);assert.equal(result.context,null,'old usage invalidated');
  assert.equal(fake.requests.find(r=>r.method==='thread/resume').params.threadId,id);
  assert.ok(events.some(e=>e.type==='compaction-started'));assert.ok(events.some(e=>e.type==='compaction-completed'));
  assert.equal(fake.requests.some(r=>r.method==='turn/start'),false);
  await assert.rejects(runtimeRequest({...fakeRuntime({compaction:true,noComplete:true}),contextId:id,compact:true}),/confirm compaction/);
});
test('native failure, disconnect, cancellation and unsupported tool calls fail closed',async()=>{
  await assert.rejects(runtimeRequest({...fakeRuntime({inheritedTool:true})}),/isolate the game/);
  await assert.rejects(runtimeRequest({...fakeRuntime({failTurn:true})}),/did not complete/);
  await assert.rejects(runtimeRequest({...fakeRuntime({crash:true})}),/disconnected/);
  await assert.rejects(runtimeRequest({...fakeRuntime({tool:true})}),/unsupported tool/);
  const abort=new AbortController();await assert.rejects(runtimeRequest({...fakeRuntime({abort}),signal:abort.signal}),{name:'AbortError'});
  await assert.rejects(runtimeRequest({contextId:'--last'}),/Invalid Codex context/);
});
