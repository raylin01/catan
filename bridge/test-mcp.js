import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {RoomService} from '../server/roomService.js';
import {createAppServer} from '../server/http.js';
import {GameClient} from './client.js';

const here=dirname(fileURLToPath(import.meta.url));
const runCli=promisify(execFile);

function startMcp(server,sessionPath) {
  const child=spawn(process.execPath,[join(here,'cli.js'),'mcp','--server',server,'--session',sessionPath],{
    cwd:dirname(here),stdio:['pipe','pipe','pipe'],env:{...process.env,PATH:''},
  });
  const pending=new Map();let nextId=1,stderr='';
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    let response;
    try {response=JSON.parse(line);} catch(error) {
      for(const request of pending.values())request.reject(new Error(`Invalid MCP output: ${line}`));
      pending.clear();return;
    }
    const request=pending.get(response.id);
    if(request){pending.delete(response.id);request.resolve({response,line});}
  });
  child.once('exit',(code,signal)=>{
    const error=new Error(`MCP child exited (${code??signal}): ${stderr}`);
    for(const request of pending.values())request.reject(error);
    pending.clear();
  });
  return {
    child,
    request(method,params={}) {
      const id=nextId++;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`MCP ${method} timed out: ${stderr}`));},5000);
        pending.set(id,{
          resolve:value=>{clearTimeout(timer);resolve(value);},
          reject:error=>{clearTimeout(timer);reject(error);},
        });
        child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`,error=>{
          if(error){const request=pending.get(id);pending.delete(id);request?.reject(error);}
        });
      });
    },
    async close() {
      if(child.exitCode!==null)return;
      child.stdin.end();
      await Promise.race([
        new Promise(resolve=>child.once('exit',resolve)),
        new Promise(resolve=>setTimeout(resolve,1000)),
      ]);
      if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
    },
  };
}

function toolValue(reply) {
  assert.equal(reply.response.error,undefined);
  assert.equal(reply.response.result?.isError,undefined);
  const content=reply.response.result?.content;
  assert.equal(content?.length,1);
  assert.equal(content[0].type,'text');
  return JSON.parse(content[0].text);
}

test('MCP stdio joins, observes, acts, and loses access when its seat is revoked',{timeout:15000},async()=>{
  const service=new RoomService(),hostKey='mcp-integration-host-key';
  const created=service.create({name:'Host',seatCount:3,seats:[{kind:'ai',provider:'mcp'},{kind:'ai',provider:'codex'},{kind:'human'}]});
  assert.equal(created.success,true);
  const server=createAppServer({service,hostKey});
  const temporary=await mkdtemp(join(tmpdir(),'catan-mcp-'));
  const sessionPath=join(temporary,'private','session.json');
  let mcp,codexMcp;
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
    });
    const url=`http://127.0.0.1:${server.address().port}`;
    const advertised=(await(await fetch(`${url}/api/providers`)).json()).providers;
    assert.equal(advertised.find(provider=>provider.id==='mcp').mode,'mcp');
    assert.equal(advertised.find(provider=>provider.id==='codex').mode,'runner');
    mcp=startMcp(url,sessionPath);

    const initialized=await mcp.request('initialize',{
      protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test-client',version:'1.0.0'},
    });
    assert.equal(initialized.response.result.protocolVersion,'2024-11-05');
    assert.deepEqual(initialized.response.result.capabilities,{tools:{}});

    const listed=await mcp.request('tools/list');
    assert.deepEqual(listed.response.result.tools.map(tool=>tool.name),['catan_join','catan_observe','catan_act']);

    const joinedReply=await mcp.request('tools/call',{name:'catan_join',arguments:{code:created.code,name:'MCP Bot'}});
    const joined=toolValue(joinedReply);
    assert.equal(joined.success,true);
    assert.equal(joined.code,created.code);
    assert.ok(joined.seatId);
    assert.equal(Object.hasOwn(joined,'token'),false);
    assert.equal(joinedReply.line.includes('token'),false);

    const saved=JSON.parse(await readFile(sessionPath,'utf8'));
    assert.ok(saved.token);
    assert.equal(saved.provider,'mcp');
    assert.equal(joinedReply.line.includes(saved.token),false);
    assert.equal((await stat(sessionPath)).mode&0o777,0o600);

    const observed=toolValue(await mcp.request('tools/call',{name:'catan_observe',arguments:{}}));
    assert.equal(observed.seatId,joined.seatId);
    assert.equal(observed.slots.find(slot=>slot.id===joined.seatId).provider,'mcp');
    assert.equal(observed.slots.find(slot=>slot.id===joined.seatId).ready,false);

    const ready=toolValue(await mcp.request('tools/call',{name:'catan_act',arguments:{
      type:'ready',payload:{},revision:observed.revision,generation:observed.generation,controlEpoch:observed.controlEpoch,requestId:'mcp-ready-1',
    }}));
    assert.equal(ready.success,true);
    assert.equal(ready.revision,observed.revision+1);

    const readyView=toolValue(await mcp.request('tools/call',{name:'catan_observe',arguments:{}}));
    assert.equal(readyView.slots.find(slot=>slot.id===joined.seatId).ready,true);

    const codexSessionPath=join(temporary,'private','codex-session.json');
    codexMcp=startMcp(url,codexSessionPath);
    const codexJoined=toolValue(await codexMcp.request('tools/call',{name:'catan_join',arguments:{code:created.code,name:'Codex MCP Bot',provider:'codex'}}));
    const codexView=toolValue(await codexMcp.request('tools/call',{name:'catan_observe',arguments:{}}));
    assert.equal(codexView.slots.find(slot=>slot.id===codexJoined.seatId).provider,'codex');
    assert.equal(JSON.parse(await readFile(codexSessionPath,'utf8')).provider,'codex');

    const host=new GameClient({server:url,code:created.code,token:created.token});
    const hostView=await host.observe();
    await host.act(hostView,'removeController',{seatId:joined.seatId});

    const revoked=await mcp.request('tools/call',{name:'catan_observe',arguments:{}});
    assert.equal(revoked.response.result.isError,true);
    assert.match(revoked.response.result.content[0].text,/credential.*(invalid|revoked)/i);

    const cliSessionPath=join(temporary,'private','cli-session.json');
    const cliArgs=[join(here,'cli.js'),'join','--server',url,'--code',created.code,'--name','CLI MCP Bot','--provider','mcp','--session',cliSessionPath];
    const cliJoin=await runCli(process.execPath,cliArgs,{cwd:dirname(here),env:{...process.env,PATH:''}});
    assert.equal(JSON.parse(cliJoin.stdout).success,true);
    assert.equal(JSON.parse(await readFile(cliSessionPath,'utf8')).provider,'mcp');
    await assert.rejects(runCli(process.execPath,[join(here,'cli.js'),'run','--session',cliSessionPath],
      {cwd:dirname(here),env:{...process.env,PATH:''}}),error=>{
      assert.match(error.stderr,/External MCP seats have no automatic runner/);
      assert.match(error.stderr,/local STDIO MCP server/);
      return true;
    });
  } finally {
    await mcp?.close();
    await codexMcp?.close();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    await rm(temporary,{recursive:true,force:true});
  }
});
