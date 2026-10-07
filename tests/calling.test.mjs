import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
let browser, server;
const iceServers = process.env.TEST_TURN_URL ? [{urls:process.env.TEST_TURN_URL,username:process.env.TEST_TURN_USERNAME||'test',credential:process.env.TEST_TURN_PASSWORD||'test-only'}] : [];
before(async () => {
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5180','--strictPort'],{stdio:'ignore'});
  for(let i=0;i<100;i++){try {if((await fetch('http://127.0.0.1:5180/')).ok) break;}catch{} await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],headless:true});
});
after(async()=>{await browser?.close();server?.kill();});
async function pair(t,{screen=true,reorderIce=false}={}){
 const a=await browser.newContext(), b=await browser.newContext();
 t.after(async()=>{await a.close();await b.close();});
 const p=await a.newPage(),q=await b.newPage();
 for(const page of [p,q]){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5180/tests/harness.html');
  await page.waitForFunction(()=>window.ready,{},{timeout:5000}).catch(()=>assert.fail('Calling modules did not load: '+errors.join('; ')));
 }
 const base={conversationId:'conv',peerName:'Contact'};
 let heldOffer;
 await p.exposeFunction('relay',async s=>{
   if(reorderIce && s.type==='offer'){heldOffer=s;return;}
   if(reorderIce && heldOffer && s.type==='ice'){
     await q.evaluate(s=>window.call.receive(window.context,s),s);
     const offer=heldOffer;heldOffer=null;
     await q.evaluate(s=>{window.earlyIceCount=window.call.session.candidates.length;return window.call.receive(window.context,s);},offer);return;
   }
   return q.evaluate(s=>window.call.receive(window.context,s),s);
 });
 await q.exposeFunction('relay',async s=>p.evaluate(s=>window.call.receive(window.context,s),s));
 await p.evaluate(({base,screen,iceServers})=>window.createCall({...base,selfId:'alice',peerId:'bob'},screen,iceServers),{base,screen,iceServers});
 await q.evaluate(({base,screen,iceServers})=>window.createCall({...base,selfId:'bob',peerId:'alice'},screen,iceServers),{base,screen,iceServers});
 return [p,q];
}
async function connect(p,q,kind='video'){
 await p.evaluate(kind=>window.call.start(window.context,kind),kind);
 await q.waitForFunction(()=>window.call.snapshot().phase==='incoming');
 await q.locator('.call-accept').click();
 await Promise.all([p,q].map(page=>page.waitForFunction(()=>window.call.snapshot().phase==='connected',null,{timeout:15000})));
}
test('two peers exchange real audio/video, chat, mute, camera, independent screen, and cleanup',async t=>{
 const [p,q]=await pair(t);await connect(p,q);
 await q.waitForFunction(async()=>{const s=await window.call.pc.getStats();return [...s.values()].some(r=>r.type==='inbound-rtp'&&r.kind==='video'&&r.bytesReceived>0);});
 await q.waitForFunction(async()=>{const s=await window.call.pc.getStats();return [...s.values()].some(r=>r.type==='inbound-rtp'&&r.kind==='audio'&&r.bytesReceived>0);});
 await p.waitForFunction(()=>window.call.snapshot().chatReady);
 await p.locator('.call-chat-toggle').click();
 await p.locator('#callChatInput').fill('<b>hello</b>');
 await p.locator('.call-chat-form button').click();
 await q.waitForFunction(()=>window.chatMessages.some(m=>m.text==='<b>hello</b>'));
 assert.equal(await q.locator('.call-chat-log b').count(),0);
 await p.locator('.call-mic').click();
 assert.equal(await p.evaluate(()=>window.call.localStream.getAudioTracks()[0].enabled),false);
 await p.locator('.call-camera').click();
 await p.waitForFunction(()=>!window.call.snapshot().camera);
 assert.equal(await p.evaluate(()=>window.call.snapshot().camera),false);
 await p.locator('.call-share').click();
 await q.waitForFunction(()=>window.call.snapshot().remoteScreen);
 await q.waitForFunction(async()=>{const s=await window.call.pc.getStats();return [...s.values()].some(r=>r.type==='inbound-rtp'&&r.kind==='video'&&r.mid==='2'&&r.bytesReceived>0);});
 assert.equal(await p.evaluate(()=>window.call.snapshot().screen),true);
 await p.locator('.call-camera').click();
 await p.waitForFunction(()=>window.call.snapshot().camera);
 assert.equal(await p.evaluate(()=>window.call.snapshot().camera),true);
 assert.equal(await p.evaluate(()=>window.call.snapshot().screen),true);
 await p.locator('.call-share').click();
 await q.waitForFunction(()=>!window.call.snapshot().remoteScreen);
 await p.evaluate(()=>window.savedTracks=window.call.localStream.getTracks());
 await p.locator('.call-hangup').click();
 await q.waitForFunction(()=>window.call.snapshot().phase==='ended');
 assert.equal(await p.evaluate(()=>window.savedTracks.every(t=>t.readyState==='ended')),true);
 assert.equal(await p.evaluate(()=>window.call.pc===null),true);
});
test('voice calls start without camera, can enable camera, and render at mobile width',async t=>{
 const [p,q]=await pair(t);await p.setViewportSize({width:390,height:844});await connect(p,q,'audio');
 assert.equal(await p.evaluate(()=>window.call.snapshot().camera),false);
 assert.equal(await p.evaluate(()=>window.call.localStream.getVideoTracks().length),0);
 await p.evaluate(()=>window.call.toggleCamera());await q.waitForFunction(()=>window.call.snapshot().remoteCamera);
 assert.equal(await p.evaluate(()=>window.call.snapshot().camera),true);
 assert.equal(await p.evaluate(()=>document.querySelector('.call-dialog').getBoundingClientRect().width<=390),true);
 await p.evaluate(()=>window.call.end());
});
test('decline needs no media and rejects unrelated or stale signaling',async t=>{
 const [p,q]=await pair(t);
 await p.evaluate(()=>window.call.start(window.context,'audio'));
 const callId=await p.evaluate(()=>window.call.snapshot().id);
 await q.evaluate(id=>window.call.receive(window.context,{type:'bye',id,from:'outsider',to:'bob'}),callId);
 assert.equal(await q.evaluate(()=>window.call.snapshot().phase), 'incoming');
 await q.evaluate(()=>window.call.end('declined'));
 await p.waitForFunction(()=>window.call.snapshot().phase==='ended');
 assert.equal(await q.evaluate(()=>window.call.localStream===null),true);
 await p.evaluate(id=>window.call.receive(window.context,{type:'accept',id,from:'bob',to:'alice'}),callId);
 assert.equal(await p.evaluate(()=>window.call.pc===null),true);
});
test('cancelling while microphone permission is pending releases late acquired tracks',async t=>{
 const [p]=await pair(t);
 await p.evaluate(()=>{
  window.call.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.finishCapture=resolve);
  window.pending=window.call.start(window.context,'audio');
 });
 await p.evaluate(()=>window.call.end());
 await p.evaluate(async()=>{
  window.lateStream=await navigator.mediaDevices.getUserMedia({audio:true});
  window.finishCapture(window.lateStream);await window.pending;
 });
 assert.equal(await p.evaluate(()=>window.lateStream.getTracks().every(t=>t.readyState==='ended')),true);
 assert.equal(await p.evaluate(()=>window.call.pc===null),true);
});
test('denied microphone gives an actionable error and cancelled screen leaves call running',async t=>{
 const [p,q]=await pair(t,{screen:false});
 await p.evaluate(()=>window.call.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');});
 await p.evaluate(()=>window.call.start(window.context,'audio'));
 assert.match(await p.evaluate(()=>window.call.snapshot().error),/permission|allow|microphone/i);
 assert.equal(await p.evaluate(()=>window.call.pc===null),true);
 await p.evaluate(()=>window.call.mediaDevices.getUserMedia=c=>navigator.mediaDevices.getUserMedia(c));
 await connect(p,q,'audio');await p.evaluate(()=>window.call.toggleScreen());
 assert.equal(await p.evaluate(()=>window.call.snapshot().phase),'connected');
 assert.equal(await p.evaluate(()=>window.call.snapshot().screen),false);
 await p.evaluate(()=>window.call.end());
});
test('an ended call cannot be revived by a delayed duplicate invitation',async t=>{
 const [p,q]=await pair(t);await p.evaluate(()=>window.call.start(window.context,'audio'));
 const invite=await p.evaluate(()=>({version:1,type:'invite',kind:'audio',id:window.call.snapshot().id,from:'alice',to:'bob',sentAt:Date.now()}));
 await q.evaluate(()=>window.call.end('declined'));
 await q.evaluate(m=>window.call.receive(window.context,m),invite);
 assert.equal(await q.evaluate(()=>window.call.snapshot().phase),'ended');
});
test('busy invitations and repeated accept preserve a single active session',async t=>{
 const [p,q]=await pair(t);await p.evaluate(()=>window.call.start(window.context,'audio'));
 const id=await q.evaluate(()=>window.call.snapshot().id);
 await q.evaluate(()=>window.call.receive(window.context,{version:1,type:'invite',kind:'audio',id:crypto.randomUUID(),from:'alice',to:'bob',sentAt:Date.now()}));
 assert.equal(await q.evaluate(()=>window.call.snapshot().id),id);
 await q.evaluate(()=>Promise.all([window.call.accept(),window.call.accept()]));
 await p.waitForFunction(()=>window.call.snapshot().phase==='connected');
 await p.evaluate(()=>window.call.end());
});
test('ringing expires and releases the microphone without a response',async t=>{
 const [p,q]=await pair(t);await p.clock.install();
 await p.evaluate(()=>window.call.start(window.context,'audio'));
 await p.evaluate(()=>window.ringingTracks=window.call.localStream.getTracks());
 await p.clock.fastForward(45001);
 assert.equal(await p.evaluate(()=>window.call.snapshot().reason),'no-answer');
 assert.equal(await p.evaluate(()=>window.ringingTracks.every(t=>t.readyState==='ended')),true);
 await q.waitForFunction(()=>window.call.snapshot().phase==='ended');
});
test('camera capture completing after hangup cannot enable the camera in an ended call',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'audio');
 await p.evaluate(()=>{
  window.call.tune=()=>new Promise(resolve=>window.finishTune=resolve);
  window.pendingCamera=window.call.toggleCamera();
 });
 await p.waitForFunction(()=>window.finishTune);
 await p.evaluate(()=>window.call.end());
 await p.evaluate(async()=>{window.finishTune();await window.pendingCamera;});
 assert.equal(await p.evaluate(()=>window.call.snapshot().phase),'ended');
 assert.equal(await p.evaluate(()=>window.call.snapshot().camera),false);
});
test('screen ending during sender tuning cannot restore a sharing indicator',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'audio');
 await p.evaluate(()=>{window.call.tune=()=>new Promise(resolve=>window.finishTune=resolve);window.pendingScreen=window.call.toggleScreen();});
 await p.waitForFunction(()=>window.finishTune);
 await p.evaluate(async()=>{await window.call.stopScreen(window.call.session);window.finishTune();await window.pendingScreen;});
 assert.equal(await p.evaluate(()=>window.call.snapshot().screen),false);
 assert.equal(await p.evaluate(()=>window.call.screenStream===null),true);
 await p.evaluate(()=>window.call.end());
});
test('a delayed screen-stop operation cannot clear a newer call’s screen stream',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'audio');await p.evaluate(()=>window.call.toggleScreen());
 await p.evaluate(()=>{
  window.call.screenSender.replaceTrack=()=>new Promise(resolve=>window.finishReplace=resolve);
  window.pendingStop=window.call.stopScreen(window.call.session);
 });
 await p.evaluate(()=>window.call.end());
 await connect(p,q,'audio');await p.evaluate(()=>window.call.toggleScreen());
 await p.evaluate(async()=>{window.freshScreen=window.call.screenStream;window.finishReplace();await window.pendingStop;});
 assert.equal(await p.evaluate(()=>window.call.screenStream===window.freshScreen),true);
 assert.equal(await p.evaluate(()=>window.freshScreen.getTracks().every(t=>t.readyState==='live')),true);
 await p.evaluate(()=>window.call.end());
});
test('ICE arriving before the offer is buffered and connects successfully',async t=>{
 const [p,q]=await pair(t,{reorderIce:true});await connect(p,q,'audio');
 assert.ok(await q.evaluate(()=>window.earlyIceCount)>0);
 assert.equal(await q.evaluate(()=>window.call.session.candidates.length),0);
 await p.evaluate(()=>window.call.end());
});
test('caller can recover through ICE restart after a transient disconnection',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'audio');
 await p.clock.install();
 await p.evaluate(()=>window.call.connectionChanged(window.call.session,{connectionState:'disconnected',createOffer:args=>window.call.pc.createOffer(args),setLocalDescription:offer=>window.call.pc.setLocalDescription(offer),get localDescription(){return window.call.pc.localDescription;}}));
 await p.clock.fastForward(3001);
 await p.waitForFunction(()=>window.call.snapshot().phase==='connected');
 assert.equal(await p.evaluate(()=>window.call.session.restarted),true);
 await p.evaluate(()=>window.call.end());
});
test('both participants receive and actually play remote camera and microphone media',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'video');
 for(const page of [p,q]){
  const slots=await page.evaluate(()=>window.call.pc.getTransceivers().map(t=>({kind:t.receiver.track.kind,direction:t.currentDirection})));
  assert.equal(slots.length,3);assert.deepEqual(slots.map(t=>t.direction),['sendrecv','sendrecv','sendrecv']);
  assert.deepEqual(slots.map(t=>t.kind),['audio','video','video']);
  await page.waitForFunction(async()=>{const stats=await window.call.pc.getStats();const inbound=[...stats.values()].filter(s=>s.type==='inbound-rtp');return ['audio','video'].every(kind=>inbound.some(s=>s.kind===kind&&s.bytesReceived>0));},null,{timeout:8000});
  await page.waitForFunction(()=>{const v=document.querySelector('.call-remote-video');return v.videoWidth>0&&!v.paused&&v.readyState>=2;},null,{timeout:5000});
  await page.waitForFunction(()=>{const a=document.querySelector('.call-audio');return a.srcObject?.getAudioTracks().length===1&&!a.paused&&a.readyState>=2;},null,{timeout:5000});
 }
 await p.evaluate(()=>window.call.end());
});
test('calls occupy the viewport and Back preserves audio/video while app and popup remain usable',async t=>{
 const [p,q]=await pair(t);await p.setViewportSize({width:1280,height:800});await connect(p,q,'video');
 const box=await p.locator('.call-dialog').boundingBox();assert.equal(Math.round(box.width),1280);assert.equal(Math.round(box.height),800);
 assert.equal(await p.evaluate(()=>document.getElementById('appView').inert),true);
 await p.locator('.call-back').click();assert.equal(await p.locator('.call-overlay').isVisible(),false);
 assert.equal(await p.locator('.call-mini').isVisible(),true);assert.equal(await p.evaluate(()=>document.getElementById('appView').inert),false);
 await p.locator('#testAppInput').fill('Still in the app');assert.equal(await p.locator('#testAppInput').inputValue(),'Still in the app');
 assert.equal(await p.evaluate(()=>window.call.snapshot().phase),'connected');
 assert.equal(await p.evaluate(()=>window.call.localStream.getTracks().every(t=>t.readyState==='live')),true);
 await p.waitForFunction(()=>!document.querySelector('.call-audio').paused&&document.querySelector('.call-audio').readyState>=2);
 const before=await q.evaluate(async()=>[...(await window.call.pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').reduce((n,s)=>n+s.bytesReceived,0));
 await q.waitForFunction(async before=>[...(await window.call.pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').reduce((n,s)=>n+s.bytesReceived,0)>before,before);
 await p.locator('.call-mini-mic').click();assert.equal(await p.evaluate(()=>window.call.localStream.getAudioTracks()[0].enabled),false);
 await p.locator('.call-return').click();assert.equal(await p.locator('.call-overlay').isVisible(),true);assert.equal(await p.locator('.call-mini').isVisible(),false);
 await p.locator('.call-back').click();await p.locator('.call-mini-hangup').click();
 await q.waitForFunction(()=>window.call.snapshot().phase==='ended');assert.equal(await p.locator('.call-mini').isVisible(),false);
});
test('voice calls fill mobile screen, minimize on Escape, and restore focus to the app',async t=>{
 const [p,q]=await pair(t);await p.setViewportSize({width:390,height:844});await connect(p,q,'audio');
 const box=await p.locator('.call-dialog').boundingBox();assert.equal(Math.round(box.width),390);assert.equal(Math.round(box.height),844);
 await p.keyboard.press('Escape');assert.equal(await p.locator('.call-mini').isVisible(),true);
 await p.locator('#testAppButton').click();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'testAppInput');
 await p.locator('.call-return').click();await p.locator('.call-back').click();await q.evaluate(()=>window.call.end());
 await p.waitForFunction(()=>window.call.snapshot().phase==='ended');assert.equal(await p.locator('.call-mini').isVisible(),false);
 assert.equal(await p.locator('.call-overlay').isVisible(),true);
 assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('call-dismiss')),true);
 await p.locator('.call-dismiss').click();assert.equal(await p.locator('.call-overlay').isVisible(),false);
});
test('voice-only calls play microphone audio in both directions without camera tracks',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'audio');
 for(const page of [p,q]){
  await page.waitForFunction(async()=>[...(await window.call.pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.bytesReceived>0));
  await page.waitForFunction(()=>{const a=document.querySelector('.call-audio');return a.srcObject?.getAudioTracks().length===1&&!a.paused&&a.readyState>=2;});
  assert.equal(await page.evaluate(()=>window.call.remoteStream?.getVideoTracks().length),1);
  assert.equal(await page.evaluate(()=>window.call.localStream.getVideoTracks().length),0);
  assert.equal(await page.locator('.call-remote-video').isVisible(),false);
 }
 await p.evaluate(()=>window.call.end());
});
test('answerer shares a screen and camera independently and caller plays each correct stream',async t=>{
 const [p,q]=await pair(t);await connect(p,q,'video');await q.locator('.call-share').click();
 await p.waitForFunction(()=>window.call.snapshot().remoteScreen);
 await p.waitForFunction(()=>{const v=document.querySelector('.call-remote-screen');return v.videoWidth===1280&&!v.paused&&v.readyState>=2;});
 await p.waitForFunction(()=>document.querySelector('.call-remote-video').videoWidth>0);
 assert.equal(await p.evaluate(()=>window.call.remoteStream.getVideoTracks().length),1);
 assert.equal(await p.evaluate(()=>window.call.remoteScreenStream.getVideoTracks().length),1);
 assert.equal(await p.evaluate(()=>window.call.remoteAudioStream.getTracks().every(t=>t.kind==='audio')),true);
 await q.locator('.call-camera').click();await p.waitForFunction(()=>!window.call.snapshot().remoteCamera);
 assert.equal(await p.locator('.call-remote-screen').isVisible(),true);
 await q.locator('.call-camera').click();await p.waitForFunction(()=>window.call.snapshot().remoteCamera);
 await p.waitForFunction(()=>document.querySelector('.call-remote-video').videoWidth>0);
 await q.locator('.call-share').click();await p.waitForFunction(()=>!window.call.snapshot().remoteScreen);
 await q.locator('.call-hangup').click();
});
