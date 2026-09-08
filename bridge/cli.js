#!/usr/bin/env node
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {createInterface} from 'node:readline';
import {GameClient} from './client.js';
import {connectors} from './connectors/index.js';
import {runPlayer} from './runner.js';

const [command,...raw]=process.argv.slice(2),options={};
for(let i=0;i<raw.length;i+=2){if(!raw[i].startsWith('--')||raw[i+1]===undefined)throw Error('Options require --name value');options[raw[i].slice(2)]=raw[i+1];}
const reasoningValues=new Set(['minimal','low','medium','high','xhigh','max']);
const reasoning=value=>{if(value===undefined)return undefined;if(!reasoningValues.has(value))throw Error(`Reasoning must be one of: ${[...reasoningValues].join(', ')}`);return value;};
const sessionPath=resolve(options.session||'.catan-session.json');
let session;
const save=async()=>{await mkdir(dirname(sessionPath),{recursive:true,mode:0o700});const temporary=`${sessionPath}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(session),{mode:0o600,flag:'wx'});await rename(temporary,sessionPath);};
const load=async()=>{session=JSON.parse(await readFile(sessionPath,'utf8'));return new GameClient(session);};
async function join(args) {
  const provider=args.provider||'codex';if(!connectors.has(provider))throw Error('Connector is not implemented');
  const selectedReasoning=reasoning(args.reasoning);
  if(!session){try{await load();}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(session?.token){
    try{const prior=await new GameClient(session).observe();
      if(prior.seatId&&prior.gameState?.phase!=='finished')throw Error('This session already controls a seat. Use run, leave that seat, or choose another --session file');
    }catch(error){if(error.status!==401&&error.status!==404)throw error;}
  }
  const server=options.server||session?.server;if(!server)throw Error('Specify --server https://your-game-host');
  const client=new GameClient({server,code:args.code});
  const joined=await client.join({name:args.name,role:'ai',provider,model:args.model,seatId:args.seatId});
  session={server:client.server,code:joined.code,token:joined.token,provider,model:args.model,reasoning:selectedReasoning,memory:''};await save();
  return {success:true,code:joined.code,seatId:joined.seatId};
}

async function mcp() {
  try{await load();}catch{/* Join tool creates a new session. */}
  const tools=[
    {name:'catan_join',description:'Join a vacant remote AI seat by room code. Does not take over an occupied seat.',inputSchema:{type:'object',properties:{code:{type:'string'},name:{type:'string'},provider:{type:'string'},model:{type:'string'},reasoning:{type:'string',enum:[...reasoningValues]},seatId:{type:'string'}},required:['code','name'],additionalProperties:false}},
    {name:'catan_observe',description:'Read your private player view, legal choices, required decisions and structured trades. No free-form chat.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'catan_act',description:'Submit one action against an observed revision and generation. Use a unique requestId; reuse it unchanged for network retries.',inputSchema:{type:'object',properties:{type:{type:'string'},payload:{type:'object'},revision:{type:'integer'},generation:{type:'integer'},requestId:{type:'string'}},required:['type','payload','revision','generation','requestId'],additionalProperties:false}},
  ];
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    let request;
    try {
      if(Buffer.byteLength(line)>65536)throw Error('Request too large');request=JSON.parse(line);
      if(request.id===undefined)continue;
      let result;
      if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'catan-game',version:'0.1.0'}};
      else if(request.method==='ping')result={};
      else if(request.method==='tools/list')result={tools};
      else if(request.method==='tools/call') {
        try {
          const {name,arguments:args={}}=request.params;let value;
          if(name==='catan_join')value=await join(args);
          else {const client=await load();
            if(name==='catan_observe')value=await client.observe();
            else if(name==='catan_act')value=await client.request('/commands',args);
            else throw Error('Unknown tool');
          }
          result={content:[{type:'text',text:JSON.stringify(value)}]};
        } catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}
      } else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}})+'\n');continue;}
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
    } catch(error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request?.id??null,error:{code:-32700,message:'Invalid JSON-RPC request'}})+'\n');}
  }
}

async function main(){
  if(command==='join'){const connector=connectors.get(options.provider||'codex');if(!connector)throw Error('Unknown connector');await connector.ready();console.log(JSON.stringify(await join(options)));}
  else if(command==='observe')console.log(JSON.stringify(await(await load()).observe()));
  else if(command==='act'){
    const client=await load();const envelope=JSON.parse(options.command||'{}');
    console.log(JSON.stringify(await client.request('/commands',envelope)));
  } else if(command==='run') {
    const client=await load(),connector=connectors.get(session.provider);if(!connector)throw Error('Connector unavailable');
    const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
    console.error(`Running ${session.provider} for room ${session.code}. Stop with Ctrl-C; the seat remains reserved.`);
    await runPlayer(client,connector,{model:session.model,reasoning:reasoning(session.reasoning),memory:session.memory,signal:controller.signal,save:async memory=>{session.memory=memory;await save();}});
  } else if(command==='mcp')await mcp();
  else console.log('Catan bridge\n  join --server https://game.example --code ROOM --name Codex [--model MODEL] [--reasoning EFFORT] [--session FILE]\n  run [--session FILE]\n  observe [--session FILE]\n  act --command JSON_ENVELOPE [--session FILE]\n  mcp --server https://game.example [--session FILE]\nEach AI seat must use its own session file.');
}
main().catch(error=>{if(error.name!=='AbortError'){console.error(error.message);process.exitCode=1;}});
