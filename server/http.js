import express from 'express';
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {PROVIDERS} from './providers.js';

const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createAppServer({service,hostKey}) {
  if(!hostKey || hostKey.length<16)throw Error('Host key must contain at least 16 characters');
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'24kb'}));
  const buckets=new Map();
  app.use('/api',(req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    // Same-origin browser requests; remote CLIs do not send Origin.
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return res.status(403).json({success:false,error:'Invalid origin'});}
      if(origin.host!==req.headers.host)return res.status(403).json({success:false,error:'Cross-origin browser request denied'});}
    const id=req.socket.remoteAddress,now=Date.now(),bucket=buckets.get(id)||{time:now,n:0};
    if(now-bucket.time>60000){bucket.time=now;bucket.n=0;}bucket.n++;buckets.set(id,bucket);
    if(bucket.n>1200)return res.status(429).json({success:false,error:'Request rate exceeded'});
    if(buckets.size>1000)for(const [key,value]of buckets)if(now-value.time>60000)buckets.delete(key);
    next();
  });
  const send=(res,result)=>res.status(result.statusCode|| (result.success?200:400)).json(result);
  const token=req=>/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  const code=req=>req.params.code.toUpperCase();
  const operator=req=>same(req.headers['x-host-key'],hostKey);
  const replayQuery=req=>{
    const result={token:token(req),perspective:req.query.perspective||'public'};
    if(typeof result.perspective!=='string')throw Error('Invalid perspective');
    for(const name of ['at','after','limit','offset'])if(req.query[name]!==undefined){
      if(typeof req.query[name]!=='string'||!/^\d+$/.test(req.query[name]))throw Error(`Invalid ${name}`);
      const value=Number(req.query[name]);
      if(!Number.isSafeInteger(value))throw Error(`Invalid ${name}`);
      result[name]=value;
    }
    return result;
  };
  app.get('/health',(_req,res)=>res.json({success:true,status:'ok'}));
  app.use(['/api/replays','/replay','/replays'],(_req,res,next)=>{res.setHeader('X-Robots-Tag','noindex, noarchive');next();});
  app.get('/api/replays',(req,res)=>{
    if(!operator(req))return send(res,{success:false,statusCode:403,error:'Enter the operator key to manage recordings'});
    send(res,service.listReplays(replayQuery(req)));
  });
  app.get('/api/replays/:id/events',(req,res)=>send(res,service.replayEvents(req.params.id,replayQuery(req))));
  app.get('/api/replays/:id/metrics',(req,res)=>send(res,service.replayMetrics(req.params.id,replayQuery(req))));
  app.get('/api/replays/:id/export',async(req,res,next)=>{
    try {
      const result=service.replayExport(req.params.id,replayQuery(req));
      if(!result.success)return send(res,result);
      const gzip=req.query.gzip==='1';
      res.setHeader('Content-Type',gzip?'application/gzip':'application/x-ndjson; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="catan-replay.${gzip?'jsonl.gz':'jsonl'}"`);
      const stream=Readable.from(result.lines);
      if(gzip)await pipeline(stream,createGzip(),res);else await pipeline(stream,res);
    }catch(error){if(res.headersSent)res.destroy(error);else next(error);}
  });
  app.get('/api/replays/:id',(req,res)=>send(res,service.replay(req.params.id,replayQuery(req))));
  app.delete('/api/replays/:id',(req,res)=>{
    if(!operator(req))return send(res,{success:false,statusCode:403,error:'Only the operator can delete recordings'});
    send(res,service.deleteReplay(req.params.id));
  });
  app.get('/api/providers',(_req,res)=>res.json({success:true,providers:Object.values(PROVIDERS)}));
  app.post('/api/rooms',(req,res)=>{
    if(!same(req.headers['x-host-key'],hostKey))return send(res,{success:false,statusCode:403,error:'Enter the host key from the hosting computer'});
    send(res,service.create(req.body));
  });
  app.post('/api/rooms/:code/join',(req,res)=>send(res,service.join(code(req),req.body)));
  app.get('/api/rooms/:code',(req,res)=>send(res,service.observe(code(req),token(req))));
  app.post('/api/rooms/:code/ai/lease',(req,res)=>send(res,service.aiLease(code(req),token(req),req.body)));
  app.post('/api/rooms/:code/ai/heartbeat',(req,res)=>send(res,service.aiHeartbeat(code(req),token(req),req.body)));
  app.post('/api/rooms/:code/ai/chat/read',(req,res)=>send(res,service.aiChatRead(code(req),token(req),req.body)));
  app.post('/api/rooms/:code/ai/chat/reply',(req,res)=>send(res,service.aiChatReply(code(req),token(req),req.body)));
  app.post('/api/rooms/:code/commands',(req,res)=>send(res,service.command(code(req),token(req),req.body)));
  app.use('/api',(_req,res)=>send(res,{success:false,statusCode:404,error:'Unknown endpoint'}));
  app.use('/socket.io',(_req,res)=>send(res,{success:false,statusCode:404,error:'Unknown endpoint'}));
  app.use(express.static(fileURLToPath(new URL('../client/dist/',import.meta.url)),{setHeaders(res){res.setHeader('Referrer-Policy','no-referrer');}}));
  app.get('*',(_req,res)=>res.sendFile(fileURLToPath(new URL('../client/dist/index.html',import.meta.url))));
  app.use((err,_req,res,_next)=>res.status(err.status===413?413:400).json({success:false,error:err.status===413?'Request too large':'Invalid request'}));
  return createServer(app);
}
