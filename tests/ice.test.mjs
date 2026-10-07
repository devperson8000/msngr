import { test } from 'node:test';
import assert from 'node:assert/strict';
const keyId='8733114e9477d352db7d0f2d85958fdd';
const token='test-only-cloudflare-api-token';
const fixture={iceServers:[
 {urls:['stun:stun.cloudflare.com:3478']},
 {urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:3478?transport=tcp','turns:turn.cloudflare.com:443?transport=tcp','turn:turn.cloudflare.com:53?transport=udp'],username:'temporary-user',credential:'temporary-password',unexpectedSecret:token}
]};
function response(){return {statusCode:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
const request={method:'GET',headers:{authorization:'Bearer test-only-supabase-session'}};
test('Cloudflare integration requests official ICE format and exposes only temporary credentials',async()=>{
 const {getCloudflareIceServers}=await import('../api/ice.js');let call;
 const servers=await getCloudflareIceServers({keyId,token,fetcher:async(url,options)=>{call={url,options};return Response.json(fixture,{status:201});}});
 assert.equal(call.url,`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`);
 assert.equal(call.options.method,'POST');assert.equal(call.options.headers.Authorization,`Bearer ${token}`);
 assert.equal(JSON.parse(call.options.body).ttl,86400);
 assert.equal(servers[1].username,'temporary-user');assert.equal(servers[1].credential,'temporary-password');
 assert.equal(JSON.stringify(servers).includes(token),false);
 assert.equal(servers[1].urls.some(url=>url.includes(':53?')),false);
 assert.ok(servers[1].urls.some(url=>url.startsWith('turns:')));
});
test('Cloudflare errors and malformed responses fail without exposing provider details or secrets',async()=>{
 const {getCloudflareIceServers}=await import('../api/ice.js');
 for(const result of [Response.json({error:token},{status:401}),Response.json({iceServers:[]},{status:201}),Response.json({iceServers:[{urls:'https://wrong',credential:token}]},{status:201}),Response.json({iceServers:[{urls:'turn:turn.cloudflare.com:3478'}]},{status:201})]){
  await assert.rejects(getCloudflareIceServers({keyId,token,fetcher:async()=>result}),error=>!error.message.includes(token)&&/Cloudflare|TURN/.test(error.message));
 }
});
test('authenticated endpoint verifies Supabase before minting Cloudflare credentials',async()=>{
 const {createIceHandler}=await import('../api/ice.js');const calls=[];
 const handler=createIceHandler({env:{CLOUDFLARE_TURN_API_TOKEN:token},fetcher:async(url,options)=>{
  calls.push({url,options});return url.endsWith('/auth/v1/user')?Response.json({id:'alice'}):Response.json(fixture,{status:201});
 }});
 const res=response();await handler(request,res);
 assert.equal(res.statusCode,200);assert.equal(calls.length,2);
 assert.ok(calls[0].url.endsWith('/auth/v1/user'));
 assert.equal(calls[0].options.headers.authorization,request.headers.authorization);
 assert.ok(calls[1].url.includes(keyId));assert.equal(calls[1].options.headers.Authorization,`Bearer ${token}`);
 assert.equal(res.body.relayConfigured,true);
 assert.ok(res.body.expiresAt>Math.floor(Date.now()/1000)+86000);
 assert.equal(JSON.stringify(res.body).includes(token),false);assert.match(res.headers['Cache-Control'],/no-store/);
});
test('invalid Supabase sessions never mint Cloudflare credentials',async()=>{
 const {createIceHandler}=await import('../api/ice.js');let calls=0;
 const handler=createIceHandler({env:{CLOUDFLARE_TURN_API_TOKEN:token},fetcher:async()=>{calls++;return Response.json({error:'invalid session'},{status:401});}});
 const res=response();await handler(request,res);
 assert.equal(res.statusCode,401);assert.equal(calls,1);assert.equal(res.body.iceServers,undefined);
});
test('configured Cloudflare outage returns an error instead of silently dropping to STUN',async()=>{
 const {createIceHandler}=await import('../api/ice.js');let calls=0;
 const handler=createIceHandler({env:{CLOUDFLARE_TURN_API_TOKEN:token},fetcher:async()=>++calls===1?Response.json({id:'alice'}):Response.json({error:token},{status:503})});
 const res=response();await handler(request,res);
 assert.equal(res.statusCode,503);assert.equal(res.body.iceServers,undefined);assert.equal(JSON.stringify(res.body).includes(token),false);
});
test('coturn remains supported when no Cloudflare token is configured',async()=>{
 const {createIceHandler}=await import('../api/ice.js');
 const handler=createIceHandler({env:{TURN_URLS:'turn:relay.example.com:3478',TURN_SHARED_SECRET:'test-only-secret'},fetcher:async()=>Response.json({id:'alice'})});
 const res=response();await handler(request,res);
 assert.equal(res.statusCode,200);assert.equal(res.body.relayConfigured,true);assert.equal(res.body.iceServers[1].urls[0],'turn:relay.example.com:3478');
});
