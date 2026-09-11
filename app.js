let joinRoomImpl = null;
let networkLoadPromise = null;

function loadNetworking() {
  if (joinRoomImpl) return Promise.resolve(joinRoomImpl);
  if (networkLoadPromise) return networkLoadPromise;
  networkLoadPromise = import('https://esm.run/trystero')
    .catch(() => import('https://esm.sh/trystero?bundle'))
    .then(module => {
      if (typeof module.joinRoom !== 'function') throw new Error('P2P library did not load correctly');
      joinRoomImpl = module.joinRoom;
      return joinRoomImpl;
    })
    .catch(error => {
      networkLoadPromise = null;
      throw error;
    });
  return networkLoadPromise;
}

const APP_ID = 'devperson8000-msngr-p2p-v1';
const qs = new URLSearchParams(location.search);
const clientScope = qs.get('client') || 'main';
const STORAGE_KEY = `msngr:v1:${clientScope}`;
const PROFILE_KEY = `msngr:profile:${clientScope}`;

const $ = id => document.getElementById(id);
const els = Object.fromEntries([
  'appShell','roomStack','newRoomRail','testTabButton','createRoomButton','joinRoomButton','emptyCreate','emptyJoin','roomSearch','roomCount','roomList','selfAvatar','selfName','profileButton','settingsButton',
  'emptyState','chatView','mobileBack','roomAvatar','roomTitle','renameRoomButton','connectionStatus','audioCallButton','videoCallButton','shareRoomButton','roomMenuButton','connectionBanner','bannerText','messages','typingRow','composer','messageInput','charCount','emojiButton','sendButton',
  'modalBackdrop','roomModal','modalClose','modalIcon','modalTitle','modalDescription','nameField','codeField','roomNameInput','roomCodeInput','modalSubmit','inviteModal','inviteClose','inviteLink','copyInviteButton','inviteCode','openRoomButton',
  'incomingModal','incomingAvatar','incomingTitle','incomingType','declineCall','acceptCall','roomMenu','menuShare','menuRename','menuClear','menuForget','emojiPicker','toastStack',
  'callOverlay','callTitle','callTimer','callAvatar','remoteName','remotePlaceholder','remoteVideo','localVideo','minimizeCall','muteButton','cameraButton','endCallButton'
].map(id => [id,$(id)]));

const avatarColors = [
  ['#7c5cff','#9c86ff'],['#2d8cff','#65b8ff'],['#0fa87b','#55d6ad'],
  ['#e06c75','#ff9a8b'],['#d87918','#ffb44f'],['#9d5bd2','#d38cff']
];

let state = loadState();
let profile = loadProfile();
let activeRoomId = null;
let activeRoom = null;
let p2pRoom = null;
let peers = new Set();
let actions = {};
let modalMode = 'create';
let typingTimer = null;
let remoteTypingTimer = null;
let incomingCall = null;
let currentCall = null;
let localStream = null;
let callInterval = null;
let callStartedAt = null;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [] };
  } catch { return { rooms: [] }; }
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    if (saved.name) return saved;
  } catch {}
  const suffix = clientScope === 'main' ? '' : ` Test ${clientScope.slice(-2)}`;
  return { name: `Guest${suffix}`, color: Math.floor(Math.random() * avatarColors.length) };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast('Local storage is full', true); }
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  renderProfile();
  if (actions.profile) actions.profile.send(profile).catch(() => {});
}

function roomById(id) { return state.rooms.find(room => room.id === id); }
function initials(name='Room') { return name.trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'R'; }
function escapeHtml(value='') { const div=document.createElement('div'); div.textContent=String(value); return div.innerHTML; }
function roomColor(id='') { return [...id].reduce((sum,c)=>sum+c.charCodeAt(0),0) % avatarColors.length; }
function formatTime(value) { return new Intl.DateTimeFormat([], {hour:'numeric',minute:'2-digit'}).format(new Date(value)); }
function formatRecent(value) {
  const date = new Date(value), now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(value);
  return new Intl.DateTimeFormat([], {month:'short',day:'numeric'}).format(date);
}
function uid() { return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`; }
function createCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes=crypto.getRandomValues(new Uint8Array(10));
  const raw=[...bytes].map(v=>chars[v%chars.length]).join('');
  return `${raw.slice(0,5)}-${raw.slice(5)}`;
}
function normalizeCode(input='') {
  const value=input.trim();
  try {
    const url=new URL(value);
    const room=url.searchParams.get('room');
    if (room) return room.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,64);
  } catch {}
  return value.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,64);
}
function inviteUrl(id) {
  const url=new URL(location.href);
  url.search=''; url.hash=''; url.searchParams.set('room',id);
  return url.toString();
}

function toast(message,error=false) {
  const el=document.createElement('div');
  el.className=`toast${error?' error':''}`;
  el.innerHTML=`<i></i><span>${escapeHtml(message)}</span>`;
  els.toastStack.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(12px)'; setTimeout(()=>el.remove(),220); },2600);
}

function setAvatarStyle(el,index) {
  const [a,b]=avatarColors[index%avatarColors.length];
  el.style.background=`linear-gradient(145deg,${b},${a})`;
}

function renderProfile() {
  els.selfName.textContent=profile.name;
  els.selfAvatar.textContent=initials(profile.name);
  setAvatarStyle(els.selfAvatar,profile.color||0);
}

function renderRooms(filter='') {
  const rooms=[...state.rooms].sort((a,b)=>(b.lastActive||0)-(a.lastActive||0));
  const visible=rooms.filter(r=>r.name.toLowerCase().includes(filter.toLowerCase()));
  els.roomCount.textContent=state.rooms.length;
  els.roomList.innerHTML=''; els.roomStack.innerHTML='';

  visible.forEach(room => {
    const last=room.messages?.at(-1);
    const online=room.id===activeRoomId && peers.size>0;
    const item=document.createElement('button');
    item.className=`room-item${room.id===activeRoomId?' active':''}`;
    item.innerHTML=`<span class="avatar">${escapeHtml(initials(room.name))}</span><span class="room-info"><strong>${escapeHtml(room.name)}</strong><span>${escapeHtml(last?.text || (online?'Connected':'No messages yet'))}</span></span><span class="room-meta"><time>${last?formatRecent(last.time):''}</time><i class="presence${online?' online':''}"></i></span>`;
    setAvatarStyle(item.querySelector('.avatar'),roomColor(room.id));
    item.addEventListener('click',()=>openRoom(room.id));
    els.roomList.appendChild(item);

    const orb=document.createElement('button');
    orb.className=`room-orb${room.id===activeRoomId?' active':''}${online?' online':''}`;
    orb.innerHTML=`${escapeHtml(initials(room.name))}<i class="orb-status"></i>`;
    orb.title=room.name;
    orb.addEventListener('click',()=>openRoom(room.id));
    els.roomStack.appendChild(orb);
  });
}

function renderMessages() {
  if (!activeRoom) return;
  const list=activeRoom.messages||[];
  if (!list.length) {
    els.messages.innerHTML=`<div class="room-intro"><div class="avatar">${escapeHtml(initials(activeRoom.name))}</div><h3>${escapeHtml(activeRoom.name)}</h3><p>This is the start of this room. Invite one person to connect directly.</p><button id="introInvite">Copy invite link</button></div>`;
    setAvatarStyle(els.messages.querySelector('.avatar'),roomColor(activeRoom.id));
    $('introInvite').addEventListener('click',copyInvite);
    return;
  }
  let html='<div class="day-divider">TODAY</div>';
  for (const msg of list) {
    if (msg.system) { html+=`<div class="system-message">${escapeHtml(msg.text)}</div>`; continue; }
    const self=msg.sender===profileId();
    html+=`<article class="message-row${self?' self':''}">${!self?`<span class="message-author">${escapeHtml(msg.name||'Peer')}</span>`:''}<div class="message-bubble">${escapeHtml(msg.text)} <time class="message-time">${formatTime(msg.time)}</time></div></article>`;
  }
  els.messages.innerHTML=html;
  requestAnimationFrame(()=>els.messages.scrollTop=els.messages.scrollHeight);
}

function profileId() {
  let id=sessionStorage.getItem(`msngr:id:${clientScope}`);
  if (!id) { id=uid(); sessionStorage.setItem(`msngr:id:${clientScope}`,id); }
  return id;
}

function updateRoomHeader() {
  if (!activeRoom) return;
  els.roomTitle.textContent=activeRoom.name;
  [els.roomAvatar,els.callAvatar,els.incomingAvatar].forEach(el=>{ el.textContent=initials(activeRoom.name); setAvatarStyle(el,roomColor(activeRoom.id)); });
  els.remoteName.textContent=activeRoom.peerName || 'Room peer';
  const connected=peers.size>0;
  els.connectionStatus.classList.toggle('online',connected);
  els.connectionStatus.innerHTML=`<i></i>${connected ? `${peers.size} peer${peers.size===1?'':'s'} connected` : 'Waiting for someone to join'}`;
  els.audioCallButton.disabled=!connected;
  els.videoCallButton.disabled=!connected;
}

async function openRoom(id,{showInvite=false}={}) {
  const room=roomById(id); if (!room) return;
  activeRoomId=id; activeRoom=room; room.lastActive=Date.now(); save();
  els.emptyState.classList.add('hidden'); els.chatView.classList.remove('hidden'); els.appShell.classList.add('chat-open');
  renderRooms(els.roomSearch.value); renderMessages(); updateRoomHeader();
  await connectRoom(room);
  if (showInvite) showInviteModal();
}

async function connectRoom(room) {
  if (p2pRoom) { try { p2pRoom.leave(); } catch {} }
  peers=new Set(); actions={}; updateRoomHeader();
  els.connectionBanner.classList.remove('hidden'); els.bannerText.textContent='Connecting to the room…';
  try {
    els.bannerText.textContent='Loading secure P2P connection…';
    const joinRoom=await loadNetworking();
    if (activeRoomId!==room.id) return;
    els.bannerText.textContent='Connecting to the room…';
    p2pRoom=joinRoom({appId:APP_ID},room.id);
    actions.message=p2pRoom.makeAction('message');
    actions.profile=p2pRoom.makeAction('profile');
    actions.typing=p2pRoom.makeAction('typing');
    actions.sync=p2pRoom.makeAction('history');
    actions.call=p2pRoom.makeAction('call');

    p2pRoom.onPeerJoin=peerId=>{
      peers.add(peerId); updateRoomHeader(); renderRooms(els.roomSearch.value);
      els.connectionBanner.classList.add('hidden');
      actions.profile.send({...profile,userId:profileId()},{target:peerId}).catch(()=>{});
      actions.sync.send((activeRoom.messages||[]).slice(-150),{target:peerId}).catch(()=>{});
      toast('Peer connected');
    };
    p2pRoom.onPeerLeave=peerId=>{
      peers.delete(peerId); updateRoomHeader(); renderRooms(els.roomSearch.value);
      if (currentCall?.peerId===peerId) cleanupCall('Call ended');
      addSystem('Peer disconnected');
    };
    p2pRoom.onPeerStream=(stream,peerId)=>handleRemoteStream(stream,peerId);

    actions.message.onMessage=(msg,{peerId})=>{
      if (!msg?.id || activeRoom.messages?.some(x=>x.id===msg.id)) return;
      activeRoom.messages ||= []; activeRoom.messages.push({...msg,peerId}); activeRoom.lastActive=Date.now(); save();
      renderMessages(); renderRooms(els.roomSearch.value);
      if (document.hidden) document.title=`New message · ${activeRoom.name}`;
    };
    actions.profile.onMessage=(value,{peerId})=>{
      if (!value?.name) return;
      activeRoom.peerName=value.name; activeRoom.peerProfileId=value.userId; activeRoom.lastActive=Date.now(); save(); updateRoomHeader(); renderRooms(els.roomSearch.value);
    };
    actions.typing.onMessage=value=>{
      els.typingRow.classList.toggle('show',Boolean(value));
      clearTimeout(remoteTypingTimer);
      if (value) remoteTypingTimer=setTimeout(()=>els.typingRow.classList.remove('show'),1800);
    };
    actions.sync.onMessage=list=>mergeHistory(list);
    actions.call.onMessage=(data,{peerId})=>handleCallSignal(data,peerId);
    setTimeout(()=>{ if(activeRoomId===room.id && peers.size===0){ els.bannerText.textContent='Room open — waiting for the invite to be opened'; } },1200);
  } catch (error) {
    console.error(error); els.bannerText.textContent='Messaging network unavailable. You can still manage rooms and retry.'; toast('P2P network could not load',true);
  }
}

function mergeHistory(list) {
  if (!Array.isArray(list) || !activeRoom) return;
  const map=new Map((activeRoom.messages||[]).map(x=>[x.id,x]));
  list.forEach(msg=>{ if(msg?.id && typeof msg.text==='string') map.set(msg.id,msg); });
  activeRoom.messages=[...map.values()].sort((a,b)=>a.time-b.time).slice(-300); save(); renderMessages(); renderRooms(els.roomSearch.value);
}

function addSystem(text) {
  if (!activeRoom) return;
  activeRoom.messages ||= []; activeRoom.messages.push({id:uid(),text,time:Date.now(),system:true}); save(); renderMessages();
}

async function sendMessage(text) {
  const clean=text.trim(); if (!clean || !activeRoom) return;
  const msg={id:uid(),text:clean,time:Date.now(),sender:profileId(),name:profile.name};
  activeRoom.messages ||= []; activeRoom.messages.push(msg); activeRoom.lastActive=Date.now(); save();
  renderMessages(); renderRooms(els.roomSearch.value);
  els.messageInput.value=''; resizeComposer();
  if (actions.message && peers.size) {
    try { await actions.message.send(msg); } catch { toast('Message saved; it will sync when you reconnect',true); }
  }
}

function openRoomModal(mode) {
  modalMode=mode; hideModals(); els.modalBackdrop.classList.remove('hidden'); els.roomModal.classList.remove('hidden');
  const join=mode==='join';
  els.modalTitle.textContent=join?'Join a room':'Start a room';
  els.modalDescription.textContent=join?'Paste an invite link or enter its room code. You’ll connect automatically.':'Create a private space, then share one link with the person you want to reach.';
  els.nameField.classList.toggle('hidden',join); els.codeField.classList.toggle('hidden',!join);
  els.modalSubmit.firstChild.textContent=join?'Join room ':'Create and open room ';
  els.roomNameInput.value=''; els.roomCodeInput.value='';
  setTimeout(()=>join?els.roomCodeInput.focus():els.roomNameInput.focus(),50);
}

function hideModals() {
  [els.roomModal,els.inviteModal,els.incomingModal].forEach(el=>el.classList.add('hidden'));
  els.modalBackdrop.classList.add('hidden');
}

async function submitRoomModal() {
  if (modalMode==='create') {
    const name=els.roomNameInput.value.trim() || 'New conversation';
    const id=createCode();
    state.rooms.push({id,name,messages:[],createdAt:Date.now(),lastActive:Date.now()}); save(); hideModals(); await openRoom(id,{showInvite:true});
  } else {
    const id=normalizeCode(els.roomCodeInput.value);
    if (id.length<6) { toast('Enter a valid invite link or room code',true); els.roomCodeInput.focus(); return; }
    let room=roomById(id);
    if (!room) { room={id,name:`Room ${id.slice(0,5)}`,messages:[],createdAt:Date.now(),lastActive:Date.now()}; state.rooms.push(room); save(); }
    hideModals(); await openRoom(id);
  }
}

function showInviteModal() {
  if (!activeRoom) return;
  hideModals(); els.modalBackdrop.classList.remove('hidden'); els.inviteModal.classList.remove('hidden');
  els.inviteLink.value=inviteUrl(activeRoom.id); els.inviteCode.textContent=activeRoom.id;
}

async function copyInvite() {
  if (!activeRoom) return;
  const link=inviteUrl(activeRoom.id);
  try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
  catch { els.inviteLink.value=link; showInviteModal(); els.inviteLink.select(); toast('Select and copy the invite link'); }
}

function renameRoom() {
  if (!activeRoom) return;
  const name=prompt('Room name',activeRoom.name)?.trim();
  if (!name) return;
  activeRoom.name=name.slice(0,40); activeRoom.lastActive=Date.now(); save(); renderRooms(els.roomSearch.value); updateRoomHeader(); renderMessages();
}

async function startCall(kind) {
  const peerId=[...peers][0];
  if (!peerId) { toast('Wait for someone to connect first',true); return; }
  if (currentCall || incomingCall) { toast('A call is already active',true); return; }
  try {
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});
    currentCall={peerId,kind,state:'calling'}; showCallOverlay(kind,'Calling…');
    await actions.call.send({type:'request',kind,name:profile.name},{target:peerId});
  } catch (error) { cleanupCall(); toast(mediaError(error),true); }
}

function mediaError(error) {
  if (error?.name==='NotAllowedError') return 'Camera or microphone permission was blocked';
  if (error?.name==='NotFoundError') return 'No camera or microphone was found';
  return 'Could not start the call';
}

async function handleCallSignal(data,peerId) {
  if (!data?.type) return;
  if (data.type==='request') {
    if (currentCall || incomingCall) { actions.call.send({type:'busy'},{target:peerId}).catch(()=>{}); return; }
    incomingCall={peerId,kind:data.kind==='video'?'video':'audio',name:data.name||activeRoom?.peerName||'Room peer'};
    els.incomingTitle.textContent=incomingCall.name; els.incomingType.textContent=`${incomingCall.kind==='video'?'Video':'Audio'} call`;
    hideModals(); els.modalBackdrop.classList.remove('hidden'); els.incomingModal.classList.remove('hidden');
  }
  if (data.type==='accept' && currentCall?.peerId===peerId) {
    currentCall.state='connected';
    try { await p2pRoom.addStream(localStream,{target:peerId}); startCallTimer(); els.callTitle.textContent=currentCall.kind==='video'?'Video call':'Audio call'; }
    catch { cleanupCall(); toast('Could not send your media',true); }
  }
  if ((data.type==='decline'||data.type==='busy') && currentCall?.peerId===peerId) { cleanupCall(); toast(data.type==='busy'?'They are already in a call':'Call declined'); }
  if (data.type==='end' && (currentCall?.peerId===peerId || incomingCall?.peerId===peerId)) { hideModals(); cleanupCall(); toast('Call ended'); }
}

async function acceptIncoming() {
  if (!incomingCall) return;
  const pending=incomingCall; incomingCall=null;
  try {
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:pending.kind==='video'});
    currentCall={...pending,state:'connected'}; hideModals(); showCallOverlay(pending.kind,pending.kind==='video'?'Video call':'Audio call'); startCallTimer();
    await p2pRoom.addStream(localStream,{target:pending.peerId});
    await actions.call.send({type:'accept'},{target:pending.peerId});
  } catch (error) { actions.call.send({type:'decline'},{target:pending.peerId}).catch(()=>{}); cleanupCall(); toast(mediaError(error),true); }
}

function declineIncoming() {
  if (!incomingCall) return;
  actions.call.send({type:'decline'},{target:incomingCall.peerId}).catch(()=>{}); incomingCall=null; hideModals();
}

function handleRemoteStream(stream,peerId) {
  if (!currentCall) currentCall={peerId,kind:stream.getVideoTracks().length?'video':'audio',state:'connected'};
  els.remoteVideo.srcObject=stream; els.remoteVideo.play().catch(()=>{});
  if (stream.getVideoTracks().length) els.remotePlaceholder.classList.add('hidden');
  else { els.remotePlaceholder.classList.remove('hidden'); els.remotePlaceholder.querySelector('span').textContent='Audio connected'; }
  showCallOverlay(currentCall.kind,currentCall.kind==='video'?'Video call':'Audio call'); startCallTimer();
}

function showCallOverlay(kind,title) {
  els.callOverlay.classList.remove('hidden'); els.callTitle.textContent=title;
  els.cameraButton.classList.toggle('hidden',kind!=='video');
  els.localVideo.classList.toggle('hidden',kind!=='video');
  if (localStream) { els.localVideo.srcObject=localStream; els.localVideo.play().catch(()=>{}); }
  els.remotePlaceholder.classList.remove('hidden');
  els.remotePlaceholder.querySelector('span').textContent=currentCall?.state==='calling'?'Waiting for answer…':'Connecting media…';
  els.callAvatar.textContent=initials(activeRoom?.name); els.remoteName.textContent=activeRoom?.peerName||'Room peer';
}

function startCallTimer() {
  if (callInterval) return;
  callStartedAt=Date.now();
  const tick=()=>{ const n=Math.floor((Date.now()-callStartedAt)/1000); els.callTimer.textContent=`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; };
  tick(); callInterval=setInterval(tick,1000);
}

function endCall(send=true) {
  const call=currentCall;
  if (send && call && actions.call) actions.call.send({type:'end'},{target:call.peerId}).catch(()=>{});
  cleanupCall();
}

function cleanupCall(systemText='') {
  if (localStream) {
    try { if (p2pRoom?.removeStream && currentCall) p2pRoom.removeStream(localStream,{target:currentCall.peerId}); } catch {}
    localStream.getTracks().forEach(track=>track.stop());
  }
  const remote=els.remoteVideo.srcObject; if (remote) remote.getTracks().forEach(track=>track.stop());
  localStream=null; currentCall=null; incomingCall=null; els.localVideo.srcObject=null; els.remoteVideo.srcObject=null;
  els.callOverlay.classList.add('hidden'); els.remotePlaceholder.classList.remove('hidden');
  els.muteButton.classList.remove('off'); els.cameraButton.classList.remove('off');
  clearInterval(callInterval); callInterval=null; callStartedAt=null; els.callTimer.textContent='00:00';
  if (systemText) addSystem(systemText);
}

function resizeComposer() {
  els.messageInput.style.height='auto'; els.messageInput.style.height=`${Math.min(els.messageInput.scrollHeight,132)}px`;
  els.charCount.textContent=els.messageInput.value.length>3500?`${els.messageInput.value.length}/4000`:'';
}

function setupEvents() {
  [els.createRoomButton,els.emptyCreate,els.newRoomRail].forEach(el=>el.addEventListener('click',()=>openRoomModal('create')));
  [els.joinRoomButton,els.emptyJoin].forEach(el=>el.addEventListener('click',()=>openRoomModal('join')));
  els.modalClose.addEventListener('click',hideModals); els.inviteClose.addEventListener('click',hideModals);
  els.modalSubmit.addEventListener('click',submitRoomModal);
  els.roomNameInput.addEventListener('keydown',e=>{ if(e.key==='Enter') submitRoomModal(); });
  els.roomCodeInput.addEventListener('keydown',e=>{ if(e.key==='Enter') submitRoomModal(); });
  els.modalBackdrop.addEventListener('click',e=>{ if(e.target===els.modalBackdrop && !incomingCall) hideModals(); });
  els.copyInviteButton.addEventListener('click',copyInvite); els.openRoomButton.addEventListener('click',hideModals);
  els.shareRoomButton.addEventListener('click',showInviteModal); els.renameRoomButton.addEventListener('click',renameRoom);
  els.mobileBack.addEventListener('click',()=>els.appShell.classList.remove('chat-open'));
  els.roomSearch.addEventListener('input',()=>renderRooms(els.roomSearch.value));
  document.addEventListener('keydown',e=>{
    if ((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k') { e.preventDefault(); els.roomSearch.focus(); }
    if (e.key==='Escape') { els.roomMenu.classList.add('hidden'); els.emojiPicker.classList.add('hidden'); if(!incomingCall) hideModals(); }
  });
  els.composer.addEventListener('submit',e=>{ e.preventDefault(); sendMessage(els.messageInput.value); });
  els.messageInput.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(els.messageInput.value);} });
  els.messageInput.addEventListener('input',()=>{
    resizeComposer(); if (!actions.typing||!peers.size) return;
    actions.typing.send(true).catch(()=>{}); clearTimeout(typingTimer); typingTimer=setTimeout(()=>actions.typing?.send(false).catch(()=>{}),900);
  });
  const emoji=['😀','😂','❤️','👍','🔥','🎉','😎','🤝','👀','✨','💀','✅','🚀','💬','🫡'];
  els.emojiPicker.innerHTML=emoji.map(x=>`<button type="button">${x}</button>`).join('');
  els.emojiButton.addEventListener('click',()=>els.emojiPicker.classList.toggle('hidden'));
  els.emojiPicker.addEventListener('click',e=>{ if(e.target.tagName==='BUTTON'){ els.messageInput.value+=e.target.textContent; resizeComposer(); els.messageInput.focus(); els.emojiPicker.classList.add('hidden'); } });
  els.roomMenuButton.addEventListener('click',()=>els.roomMenu.classList.toggle('hidden'));
  els.menuShare.addEventListener('click',()=>{els.roomMenu.classList.add('hidden');showInviteModal();});
  els.menuRename.addEventListener('click',()=>{els.roomMenu.classList.add('hidden');renameRoom();});
  els.menuClear.addEventListener('click',()=>{ if(activeRoom&&confirm('Delete this room’s messages from this browser?')){activeRoom.messages=[];save();renderMessages();renderRooms();} els.roomMenu.classList.add('hidden'); });
  els.menuForget.addEventListener('click',()=>{
    if(!activeRoom||!confirm(`Forget “${activeRoom.name}” and its local messages?`)) return;
    if(currentCall) endCall(); try{p2pRoom?.leave();}catch{} state.rooms=state.rooms.filter(r=>r.id!==activeRoomId); activeRoom=null;activeRoomId=null;p2pRoom=null;peers.clear();save();
    els.chatView.classList.add('hidden');els.emptyState.classList.remove('hidden');els.appShell.classList.remove('chat-open');els.roomMenu.classList.add('hidden');renderRooms();
  });
  els.testTabButton.addEventListener('click',()=>{
    const url=new URL(location.href); url.searchParams.set('client',`test${Math.floor(Math.random()*90+10)}`); if(activeRoomId)url.searchParams.set('room',activeRoomId); window.open(url,'_blank','noopener');
  });
  [els.profileButton,els.settingsButton].forEach(el=>el.addEventListener('click',()=>{
    const name=prompt('Your display name',profile.name)?.trim(); if(!name)return; profile.name=name.slice(0,28);saveProfile();renderMessages();
  }));
  els.audioCallButton.addEventListener('click',()=>startCall('audio')); els.videoCallButton.addEventListener('click',()=>startCall('video'));
  els.acceptCall.addEventListener('click',acceptIncoming); els.declineCall.addEventListener('click',declineIncoming);
  els.endCallButton.addEventListener('click',()=>endCall()); els.minimizeCall.addEventListener('click',()=>els.callOverlay.classList.add('hidden'));
  els.muteButton.addEventListener('click',()=>{ const track=localStream?.getAudioTracks()[0]; if(!track)return; track.enabled=!track.enabled; els.muteButton.classList.toggle('off',!track.enabled); els.muteButton.querySelector('span').textContent=track.enabled?'Mute':'Unmute'; });
  els.cameraButton.addEventListener('click',()=>{ const track=localStream?.getVideoTracks()[0]; if(!track)return; track.enabled=!track.enabled; els.cameraButton.classList.toggle('off',!track.enabled); els.cameraButton.querySelector('span').textContent=track.enabled?'Camera':'Camera off'; });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) document.title='msngr'; });
  addEventListener('beforeunload',()=>{ try{p2pRoom?.leave();}catch{} localStream?.getTracks().forEach(t=>t.stop()); });
}

function registerWebMcp() {
  const context=document.modelContext;
  if (!context?.registerTool) return;
  const register=tool=>{
    try { Promise.resolve(context.registerTool(tool)).catch(error=>console.warn('WebMCP registration failed',error)); }
    catch (error) { console.warn('WebMCP registration failed',error); }
  };
  register({
    name:'list_rooms', title:'List rooms',
    description:'List saved msngr rooms and indicate which room is open.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute:()=>({activeRoomId,rooms:state.rooms.map(({id,name,lastActive})=>({id,name,lastActive}))})
  });
  register({
    name:'create_room', title:'Create room',
    description:'Create and open a new private msngr room, returning its invite link.',
    inputSchema:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:40}},required:['name'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    async execute(input) {
      const name=typeof input?.name==='string'?input.name.trim():'';
      if (!name) throw new Error('A room name is required');
      const id=createCode(); state.rooms.push({id,name:name.slice(0,40),messages:[],createdAt:Date.now(),lastActive:Date.now()}); save(); await openRoom(id);
      return {id,name:activeRoom.name,inviteUrl:inviteUrl(id)};
    }
  });
  register({
    name:'join_room', title:'Join room',
    description:'Join and open an msngr room using an invite code or link.',
    inputSchema:{type:'object',properties:{invite:{type:'string',minLength:6,maxLength:500}},required:['invite'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:true},
    async execute(input) {
      const id=normalizeCode(input?.invite||''); if(id.length<6) throw new Error('A valid invite code or link is required');
      let room=roomById(id); if(!room){room={id,name:`Room ${id.slice(0,5)}`,messages:[],createdAt:Date.now(),lastActive:Date.now()};state.rooms.push(room);save();}
      await openRoom(id); return {id,name:room.name,connectedPeers:peers.size};
    }
  });
  register({
    name:'send_message', title:'Send message',
    description:'Send a text message in the currently open msngr room.',
    inputSchema:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:4000}},required:['text'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:true},
    async execute(input) {
      if(!activeRoom) throw new Error('Open a room before sending a message');
      const text=typeof input?.text==='string'?input.text.trim():''; if(!text) throw new Error('Message text is required');
      await sendMessage(text); return {sent:true,roomId:activeRoomId,connectedPeers:peers.size};
    }
  });
}

async function init() {
  renderProfile(); renderRooms(); setupEvents(); registerWebMcp(); resizeComposer();
  const linked=normalizeCode(qs.get('room')||'');
  if (linked) {
    let room=roomById(linked);
    if (!room) { room={id:linked,name:`Room ${linked.slice(0,5)}`,messages:[],createdAt:Date.now(),lastActive:Date.now()}; state.rooms.push(room); save(); }
    await openRoom(linked);
    history.replaceState({},'',inviteUrl(linked)+(clientScope==='main'?'':`&client=${encodeURIComponent(clientScope)}`));
  }
}

init();
