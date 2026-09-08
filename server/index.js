import {createAppServer} from './http.js';
import {RoomStore} from './store.js';
import {RoomService} from './roomService.js';
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const dataDir=resolve(process.env.CATAN_DATA_DIR||'data');
mkdirSync(dataDir,{recursive:true,mode:0o700});
const keyPath=resolve(dataDir,'host-key');
if(!process.env.CATAN_HOST_KEY&&!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'});
const hostKey=process.env.CATAN_HOST_KEY||readFileSync(keyPath,'utf8').trim();
const store=new RoomStore(resolve(dataDir,'rooms.sqlite'));
const service=new RoomService({store,maxActive:Number(process.env.CATAN_MAX_ACTIVE||1)});
const server=createAppServer({service,hostKey});
server.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>{
 console.log(`Catan is listening on http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`);
 console.log(`Host key file: ${keyPath} (enter its contents only in the host create-room form)`);
});
const stop=()=>server.close(()=>{store.close();process.exit(0);});
process.on('SIGTERM',stop);process.on('SIGINT',stop);
