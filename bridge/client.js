import {randomUUID} from 'node:crypto';

export class GameClient {
  constructor({server,code,token}) {
    const url=new URL(server);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Use an HTTP(S) server URL without embedded credentials');
    if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Remote connections require HTTPS');
    this.server=url.origin;this.code=code.toUpperCase();this.token=token;
  }
  async request(path,body) {
    const response=await fetch(`${this.server}/api/rooms/${encodeURIComponent(this.code)}${path}`,{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(this.token?{Authorization:`Bearer ${this.token}`}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!result.success){const error=new Error(result.error||'Game request failed');error.status=result.statusCode||response.status;throw error;}
    return result;
  }
  async join(options){const session=await this.request('/join',options);this.token=session.token;return session;}
  lease(body){return this.request('/ai/lease',body);}
  heartbeat(body){return this.request('/ai/heartbeat',body);}
  readChat(body){return this.request('/ai/chat/read',body);}
  replyChat(body){return this.request('/ai/chat/reply',body);}
  observe(){return this.request('');}
  act(view,type,payload={},requestId=randomUUID()) {
    return this.request('/commands',{requestId,revision:view.revision,generation:view.generation,controlEpoch:view.controlEpoch,runId:view.runId,type,payload});
  }
}
