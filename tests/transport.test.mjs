import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const ctx={conversationId:'conversation',selfId:'alice',peerId:'bob'};
function fake(){
 const channels=[];
 return {channels,channel(topic,config){const c={topic,config,sendCount:0,on(event,filter,handler){this.handler=handler;return this;},subscribe(fn){this.status=fn;return this;},async send(){this.sendCount++;return this.result||'ok';}};channels.push(c);return c;},async removeChannel(c){c.removed=true;}};
}
test('transport waits for a private subscription and fails closed on denied access',async()=>{
 const {CallTransport}=await import('../calling/transport.js');
 const client=fake(),errors=[];const transport=new CallTransport(client,{onSignal(){},onError:e=>errors.push(e),readyTimeout:100});
 transport.sync([ctx]);const c=client.channels[0];
 assert.equal(c.config.config.private,true);assert.equal(c.config.config.broadcast.ack,true);
 const pending=transport.send(ctx,{type:'invite'});assert.equal(c.sendCount,0);
 c.status('CHANNEL_ERROR');await assert.rejects(pending,/signaling|private|access/i);assert.equal(c.sendCount,0);
 await transport.destroy();assert.equal(c.removed,true);
});
test('transport only routes subscribed conversations and enforces acknowledged sends',async()=>{
 const {CallTransport}=await import('../calling/transport.js');
 const client=fake(),received=[];const transport=new CallTransport(client,{onSignal:(ctx,m)=>received.push([ctx,m]),onError(){},readyTimeout:100});
 transport.sync([ctx]);const c=client.channels[0];c.status('SUBSCRIBED');
 await transport.send(ctx,{type:'invite'});assert.equal(c.sendCount,1);
 c.handler({payload:{type:'invite'}});assert.equal(received[0][0].peerId,'bob');
 c.result='timed out';await assert.rejects(transport.send(ctx,{}),/signaling|deliver/i);
 await transport.destroy();c.handler({payload:{type:'invite'}});assert.equal(received.length,1);
});
test('deployment allows same-origin devices and MediaStream playback',async()=>{
 const v=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 const h=v.headers[0].headers;
 const policy=h.find(x=>x.key==='Permissions-Policy').value;
 assert.match(policy,/camera=\(self\)/);assert.match(policy,/microphone=\(self\)/);
 assert.match(h.find(x=>x.key==='Content-Security-Policy').value,/media-src 'self' blob:/);
});
test('TURN credentials expire, use HMAC, and never reveal the shared secret',async()=>{
 const { buildIceServers }=await import('../api/ice.js');
 const {createHmac}=await import('node:crypto');
 const servers=buildIceServers('alice',{TURN_URLS:'turn:relay.example.com:3478,turns:relay.example.com:5349',TURN_SHARED_SECRET:'test-only-secret'},1000);
 assert.equal(servers[1].username,'4600:alice');
 assert.equal(servers[1].credential,createHmac('sha1','test-only-secret').update('4600:alice').digest('base64'));
 assert.equal(JSON.stringify(servers).includes('test-only-secret'),false);
 assert.throws(()=>buildIceServers('alice',{TURN_URLS:'https://wrong',TURN_SHARED_SECRET:'s'},1000),/TURN/);
});
test('TURN endpoint refuses unauthenticated requests and never caches credentials',async()=>{
 const {default:handler}=await import('../api/ice.js');
 let status,body;const headers={};
 const res={setHeader(k,v){headers[k]=v;},status(n){status=n;return this;},json(data){body=data;return this;}};
 await handler({method:'GET',headers:{}},res);
 assert.equal(status,401);assert.equal(body.iceServers,undefined);assert.match(headers['Cache-Control'],/no-store/);
});
test('transport recovers after a previously denied private subscription reconnects',async()=>{
 const {CallTransport}=await import('../calling/transport.js');
 const client=fake(),transport=new CallTransport(client,{onSignal(){},onError(){},readyTimeout:100});
 transport.sync([ctx]);const c=client.channels[0];c.status('CHANNEL_ERROR');
 await assert.rejects(transport.send(ctx,{}));
 c.status('SUBSCRIBED');await transport.send(ctx,{});assert.equal(c.sendCount,1);await transport.destroy();
});
