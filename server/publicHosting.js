import {createHash} from 'node:crypto';

export function normalizePublicUrl(value) {
  if(!value)return null;
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('CATAN_PUBLIC_URL must be an origin without credentials, path or query');
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('CATAN_PUBLIC_URL must use HTTPS outside loopback');
  return url.origin;
}
export function requestPublicUrl(req,configured) {
  return configured||normalizePublicUrl(`${req.protocol}://${req.get('host')}`);
}

export function requestLimits({now=Date.now,createLimit=5}={}) {
  const aggregate=new Map(),identities=new Map(),creation=new Map();
  function allow(buckets,key,limit,windowMs) {
    const time=now();let bucket=buckets.get(key);
    if(!bucket||time>=bucket.until)bucket={n:0,until:time+windowMs};
    bucket.n++;buckets.delete(key);buckets.set(key,bucket);
    while(buckets.size>10000)buckets.delete(buckets.keys().next().value);
    return {allowed:bucket.n<=limit,retryAfter:Math.max(1,Math.ceil((bucket.until-time)/1000))};
  }
  return {
    // Only the HTTP layer may supply a credential after authenticating it.
    // Anonymous routes ignore Authorization, so forged tokens cannot create buckets.
    request(req,verifiedCredential=null) {
      const source=allow(aggregate,req.ip,7200,60000);
      if(!source.allowed)return source;
      const key=verifiedCredential?`token:${createHash('sha256').update(verifiedCredential).digest('hex')}`:`ip:${req.ip}`;
      return allow(identities,key,1200,60000);
    },
    // Traffic on other endpoints cannot evict the creation cooldown.
    create(req) {return allow(creation,req.ip,createLimit,10*60000);}
  };
}
