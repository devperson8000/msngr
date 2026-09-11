let joinRoomImpl = null;
let networkApi = null;
let networkLoadPromise = null;

function loadNetworking() {
  if (joinRoomImpl) return Promise.resolve(joinRoomImpl);
  if (networkLoadPromise) return networkLoadPromise;
  networkLoadPromise = import('https://esm.run/trystero')
    .catch(() => import('https://esm.sh/trystero?bundle'))
    .then(module => {
      if (typeof module.joinRoom !== 'function') throw new Error('P2P library did not load correctly');
      networkApi = module;
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
const PREFS_KEY = `msngr:prefs:${clientScope}`;
const legacySessionId = sessionStorage.getItem(`msngr:id:${clientScope}`);

const $ = id => document.getElementById(id);
const els = Object.fromEntries([
  'appShell','roomStack','newRoomRail','testTabButton','createRoomButton','joinRoomButton','emptyCreate','emptyJoin','roomSearch','roomCount','roomList','selfAvatar','selfName','profileButton','settingsButton',
  'emptyState','chatView','mobileBack','roomAvatar','roomTitle','renameRoomButton','connectionStatus','audioCallButton','videoCallButton','shareRoomButton','roomMenuButton','connectionBanner','bannerText','messages','typingRow','composer','messageInput','charCount','attachmentButton','attachmentInput','emojiButton','sendButton',
  'modalBackdrop','roomModal','modalClose','modalIcon','modalTitle','modalDescription','nameField','codeField','roomNameInput','roomCodeInput','modalSubmit','inviteModal','inviteClose','inviteLink','copyInviteButton','inviteCode','openRoomButton',
  'incomingModal','incomingAvatar','incomingTitle','incomingType','declineCall','acceptCall','roomMenu','menuShare','menuRename','menuClear','menuForget','emojiPicker','toastStack',
  'settingsModal','settingsClose','settingsAvatarPreview','settingsNameInput','changeAvatarButton','removeAvatarButton','avatarFileInput','accentOptions','changeWallpaperButton','removeWallpaperButton','wallpaperFileInput','wallpaperVisibility','wallpaperVisibilityValue','densitySelect','fontScale','fontScaleValue','enterToSendToggle','soundsToggle','motionToggle','settingsSaveButton',
  'callOverlay','callTitle','callTimer','callAvatar','remoteName','remotePlaceholder','remoteVideo','localVideo','minimizeCall','muteButton','cameraButton','shareScreenButton','endCallButton'
].map(id => [id,$(id)]));

const avatarColors = [
  ['#7c5cff','#9c86ff'],['#2d8cff','#65b8ff'],['#0fa87b','#55d6ad'],
  ['#e06c75','#ff9a8b'],['#d87918','#ffb44f'],['#9d5bd2','#d38cff']
];

let state = loadState();
let profile = loadProfile();
let prefs = loadPrefs();
if (!profile.id) {
  profile.id = legacySessionId || uid();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
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
let screenStream = null;
let cameraTrack = null;
let callInterval = null;
let callStartedAt = null;
let peerPingTimer = null;
let peerLatency = null;
let reconnectTimer = null;
const mediaProgress = new Map();
const mediaRequests = new Set();
const mediaUrls = new Map();

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
  return { name: `Guest${suffix}`, color: Math.floor(Math.random() * avatarColors.length), id: legacySessionId || uid() };
}

function loadPrefs() {
  const defaults={accent:'purple',wallpaper:'',wallpaperVisibility:30,density:'comfortable',fontScale:100,enterToSend:true,sounds:true,reduceMotion:false};
  try { return {...defaults,...JSON.parse(localStorage.getItem(PREFS_KEY)||'{}')}; }
  catch { return defaults; }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast('Local storage is full', true); }
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  renderProfile();
  if (actions.profile) actions.profile.send({...profile,userId:profileId(),roomName:activeRoom?.name}).catch(() => {});
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY,JSON.stringify(prefs)); }
  catch { toast('That image is too large to save. Try a smaller one.',true); return false; }
  applyPrefs(); return true;
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
function formatBytes(bytes=0) {
  if (bytes<1024*1024) return `${Math.max(1,Math.round(bytes/1024))} KB`;
  return `${(bytes/(1024*1024)).toFixed(bytes<10*1024*1024?1:0)} MB`;
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

function setAvatarStyle(el,index,image='') {
  const [a,b]=avatarColors[index%avatarColors.length];
  el.style.background=`linear-gradient(145deg,${b},${a})`;
  el.style.backgroundImage=image?`url("${image}")`:`linear-gradient(145deg,${b},${a})`;
  el.classList.toggle('has-image',Boolean(image));
}

function renderProfile() {
  els.selfName.textContent=profile.name;
  els.selfAvatar.textContent=initials(profile.name);
  setAvatarStyle(els.selfAvatar,profile.color||0,profile.avatarImage);
}

function applyPrefs() {
  const accents={
    purple:['#7c5cff','#9c86ff','124,92,255'],
    blue:['#2d8cff','#65b8ff','45,140,255'],
    green:['#14b88a','#55d6ad','20,184,138'],
    rose:['#e85d8e','#ff8cb3','232,93,142']
  };
  const [accent,accent2,rgb]=accents[prefs.accent]||accents.purple;
  const root=document.documentElement;
  root.style.setProperty('--accent',accent); root.style.setProperty('--accent-2',accent2); root.style.setProperty('--accent-rgb',rgb); root.style.setProperty('--accent-soft',`rgba(${rgb},.15)`);
  root.style.setProperty('--chat-wallpaper',prefs.wallpaper?`url("${prefs.wallpaper}")`:'none');
  root.style.setProperty('--wallpaper-opacity',String((Number(prefs.wallpaperVisibility)||30)/100));
  root.style.fontSize=`${Number(prefs.fontScale)||100}%`;
  root.dataset.density=prefs.density==='compact'?'compact':'comfortable';
  root.classList.toggle('reduce-motion',Boolean(prefs.reduceMotion));
}

function renderRooms(filter='') {
  const rooms=[...state.rooms].sort((a,b)=>(b.lastActive||0)-(a.lastActive||0));
  const visible=rooms.filter(r=>r.name.toLowerCase().includes(filter.toLowerCase()));
  els.roomCount.textContent=state.rooms.length;
  els.roomList.innerHTML=''; els.roomStack.innerHTML='';

  if (!visible.length) {
    els.roomList.innerHTML=`<div class="rooms-empty"><span>${filter?'No rooms found':'No rooms yet'}</span><small>${filter?'Try another search':'Create or join one to get started'}</small></div>`;
  }

  visible.forEach(room => {
    const last=room.messages?.at(-1);
    const online=room.id===activeRoomId && peers.size>0;
    const item=document.createElement('button');
    item.className=`room-item${room.id===activeRoomId?' active':''}`;
    const lastPreview=last?.text || (last?.attachment?.kind==='video'?'Video':last?.attachment?'Photo':online?'Connected':'No messages yet');
    item.innerHTML=`<span class="avatar">${escapeHtml(initials(room.name))}</span><span class="room-info"><strong>${escapeHtml(room.name)}</strong><span>${escapeHtml(lastPreview)}</span></span><span class="room-meta"><time>${last?formatRecent(last.time):''}</time><i class="presence${online?' online':''}"></i></span>`;
    setAvatarStyle(item.querySelector('.avatar'),roomColor(room.id),room.peerAvatar);
    item.addEventListener('click',()=>openRoom(room.id));
    els.roomList.appendChild(item);

    const orb=document.createElement('button');
    orb.className=`room-orb${room.id===activeRoomId?' active':''}${online?' online':''}`;
    orb.innerHTML=`${escapeHtml(initials(room.name))}<i class="orb-status"></i>`;
    setAvatarStyle(orb,roomColor(room.id),room.peerAvatar);
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
    setAvatarStyle(els.messages.querySelector('.avatar'),roomColor(activeRoom.id),activeRoom.peerAvatar);
    $('introInvite').addEventListener('click',copyInvite);
    return;
  }
  let html='<div class="day-divider">TODAY</div>';
  for (const msg of list) {
    if (msg.system) { html+=`<div class="system-message">${escapeHtml(msg.text)}</div>`; continue; }
    const self=msg.sender===profileId();
    const stateIcon=msg.status==='delivered'?'✓✓':msg.status==='queued'?'○':'✓';
    const stateLabel=msg.status==='delivered'?'Delivered':msg.status==='queued'?'Waiting to sync':'Sent';
    const attachment=msg.attachment;
    const progress=mediaProgress.get(attachment?.id);
    const content=attachment
      ? `<div class="media-attachment" data-media-id="${escapeHtml(attachment.id)}" data-media-kind="${escapeHtml(attachment.kind)}"><div class="media-loading"><span class="media-spinner"></span><strong>${progress!=null?`${Math.round(progress*100)}%`:'Loading media…'}</strong><small>${escapeHtml(attachment.name||attachment.kind)} · ${formatBytes(attachment.size)}</small></div></div>`
      : escapeHtml(msg.text);
    html+=`<article class="message-row${self?' self':''}${attachment?' has-media':''}">${!self?`<span class="message-author">${escapeHtml(msg.name||'Peer')}</span>`:''}<div class="message-bubble">${content} <span class="message-meta"><time class="message-time">${formatTime(msg.time)}</time>${self?`<span class="message-status ${msg.status||'sent'}" title="${stateLabel}" aria-label="${stateLabel}">${stateIcon}</span>`:''}</span></div></article>`;
  }
  els.messages.innerHTML=html;
  hydrateMedia();
  requestAnimationFrame(()=>els.messages.scrollTop=els.messages.scrollHeight);
}

function openMediaDb() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('msngr-media-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('media');
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
}

async function mediaDb(mode,operation) {
  const db=await openMediaDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('media',mode); const store=tx.objectStore('media'); const request=operation(store);
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); tx.oncomplete=()=>db.close();
  });
}
const storeMedia=(id,blob)=>mediaDb('readwrite',store=>store.put(blob,id));
const getMedia=id=>mediaDb('readonly',store=>store.get(id));
const deleteMedia=id=>mediaDb('readwrite',store=>store.delete(id));

async function hydrateMedia() {
  const cards=[...els.messages.querySelectorAll('[data-media-id]')];
  await Promise.all(cards.map(async card=>{
    const id=card.dataset.mediaId;
    try {
      const blob=await getMedia(id);
      if (!blob) {
        if (peers.size && actions.mediaRequest && !mediaRequests.has(id)) { mediaRequests.add(id); actions.mediaRequest.send({id}).catch(()=>mediaRequests.delete(id)); }
        card.querySelector('strong').textContent=peers.size?'Requesting media…':'Reconnect to load media'; return;
      }
      let url=mediaUrls.get(id); if(!url){url=URL.createObjectURL(blob);mediaUrls.set(id,url);}
      const attachment=activeRoom?.messages?.find(message=>message.attachment?.id===id)?.attachment;
      const element=document.createElement(card.dataset.mediaKind==='video'?'video':'img'); element.src=url;
      element.className='chat-media';
      if(element.tagName==='VIDEO'){element.controls=true;element.preload='metadata';element.playsInline=true;}
      else element.alt=attachment?.name||'Shared image';
      card.replaceChildren(element);
    } catch { card.querySelector('strong').textContent='Media unavailable'; }
  }));
}

async function deleteRoomMedia(room) {
  await Promise.all((room?.messages||[]).filter(message=>message.attachment?.id).map(message=>{
    const id=message.attachment.id; const url=mediaUrls.get(id); if(url){URL.revokeObjectURL(url);mediaUrls.delete(id);} return deleteMedia(id).catch(()=>{});
  }));
}

function profileId() {
  return profile.id;
}

function migrateLegacyIdentity() {
  if (!legacySessionId || legacySessionId===profile.id) return;
  let changed=false;
  state.rooms.forEach(room=>(room.messages||[]).forEach(message=>{
    if(message.sender===legacySessionId){message.sender=profile.id;changed=true;}
  }));
  if(changed) save();
}

function updateRoomHeader() {
  if (!activeRoom) return;
  els.roomTitle.textContent=activeRoom.name;
  [els.roomAvatar,els.callAvatar,els.incomingAvatar].forEach(el=>{ el.textContent=initials(activeRoom.peerName||activeRoom.name); setAvatarStyle(el,roomColor(activeRoom.id),activeRoom.peerAvatar); });
  els.remoteName.textContent=activeRoom.peerName || 'Room peer';
  const connected=peers.size>0;
  els.connectionStatus.classList.toggle('online',connected);
  const latency=connected && Number.isFinite(peerLatency) ? ` · ${peerLatency} ms` : '';
  els.connectionStatus.innerHTML=`<i></i>${connected ? `${peers.size} peer${peers.size===1?'':'s'} connected${latency}` : 'Waiting for someone to join'}`;
  els.audioCallButton.disabled=!connected;
  els.videoCallButton.disabled=!connected;
}

async function openRoom(id,{showInvite=false}={}) {
  const room=roomById(id); if (!room) return;
  activeRoomId=id; activeRoom=room; room.lastActive=Date.now(); save();
  els.emptyState.classList.add('hidden'); els.chatView.classList.remove('hidden'); els.appShell.classList.add('chat-open');
  renderRooms(els.roomSearch.value); renderMessages(); updateRoomHeader(); resizeComposer();
  await connectRoom(room);
  if (showInvite) showInviteModal();
}

async function connectRoom(room) {
  if (p2pRoom) { try { p2pRoom.leave(); } catch {} }
  clearPeerHealth(); peers=new Set(); actions={}; updateRoomHeader();
  els.connectionBanner.classList.remove('hidden'); els.bannerText.textContent='Connecting to the room…';
  try {
    els.bannerText.textContent='Loading secure P2P connection…';
    const joinRoom=await loadNetworking();
    if (activeRoomId!==room.id) return;
    els.bannerText.textContent='Connecting to the room…';
    p2pRoom=joinRoom({
      appId:APP_ID,
      relayConfig:{redundancy:10,warnOnRelayFailure:false}
    },room.id,{
      onJoinError:details=>{
        if (activeRoomId!==room.id) return;
        console.warn('P2P join issue',details);
        els.connectionBanner.classList.remove('hidden');
        els.bannerText.textContent='Direct connection interrupted — retrying discovery…';
      }
    });
    actions.message=p2pRoom.makeAction('message');
    actions.profile=p2pRoom.makeAction('profile');
    actions.typing=p2pRoom.makeAction('typing');
    actions.sync=p2pRoom.makeAction('history');
    actions.call=p2pRoom.makeAction('call');
    actions.receipt=p2pRoom.makeAction('receipt');
    actions.media=p2pRoom.makeAction('media');
    actions.mediaRequest=p2pRoom.makeAction('media-request');
    actions.roomInfo=p2pRoom.makeAction('room-info',{
      kind:'request',
      onRequest:()=>({name:activeRoom?.name||'Conversation'})
    });

    p2pRoom.onPeerJoin=peerId=>{
      peers.add(peerId); updateRoomHeader(); renderRooms(els.roomSearch.value);
      startPeerHealth(peerId);
      renderMessages();
      els.connectionBanner.classList.add('hidden');
      actions.profile.send({...profile,userId:profileId(),roomName:activeRoom.name},{target:peerId}).catch(()=>{});
      const history=(activeRoom.messages||[]).slice(-150).map(message=>{
        const copy={...message}; delete copy.status; return copy;
      });
      actions.sync.send(history,{target:peerId}).then(()=>{
        let changed=false;
        (activeRoom.messages||[]).forEach(message=>{
          if(message.sender===profileId() && message.status==='queued'){message.status='sent';changed=true;}
        });
        if(changed){save();renderMessages();}
      }).catch(()=>{});
      if (activeRoom.name.startsWith('Room ')) {
        actions.roomInfo.request(null,{target:peerId,timeoutMs:6000})
          .then(info=>applyRoomInfo(info))
          .catch(()=>{});
      }
      toast('Peer connected');
    };
    p2pRoom.onPeerLeave=peerId=>{
      peers.delete(peerId); mediaRequests.clear(); clearPeerHealth(); updateRoomHeader(); renderRooms(els.roomSearch.value);
      if (currentCall?.peerId===peerId) cleanupCall('Call ended');
      addSystem('Peer disconnected');
    };
    p2pRoom.onPeerStream=(stream,peerId)=>handleRemoteStream(stream,peerId);

    actions.message.onMessage=(msg,{peerId})=>{
      if (msg?.id) actions.receipt.send({id:msg.id},{target:peerId}).catch(()=>{});
      if (!msg?.id || activeRoom.messages?.some(x=>x.id===msg.id)) return;
      activeRoom.messages ||= []; activeRoom.messages.push({...msg,peerId}); activeRoom.lastActive=Date.now(); save();
      renderMessages(); renderRooms(els.roomSearch.value);
      playTone('message');
      if (document.hidden) document.title=`New message · ${activeRoom.name}`;
    };
    actions.profile.onMessage=(value,{peerId})=>{
      if (!value?.name) return;
      activeRoom.peerName=value.name; activeRoom.peerProfileId=value.userId; activeRoom.peerAvatar=typeof value.avatarImage==='string'?value.avatarImage:'';
      if (value.roomName && activeRoom.name.startsWith('Room ')) activeRoom.name=String(value.roomName).slice(0,40);
      activeRoom.lastActive=Date.now(); save(); updateRoomHeader(); renderMessages(); renderRooms(els.roomSearch.value);
    };
    actions.typing.onMessage=value=>{
      els.typingRow.classList.toggle('show',Boolean(value));
      clearTimeout(remoteTypingTimer);
      if (value) remoteTypingTimer=setTimeout(()=>els.typingRow.classList.remove('show'),1800);
    };
    actions.sync.onMessage=(list,{peerId})=>{
      mergeHistory(list);
      if (!Array.isArray(list)) return;
      list.filter(message=>message?.id && message.sender!==profileId()).forEach(message=>{
        actions.receipt.send({id:message.id},{target:peerId}).catch(()=>{});
      });
    };
    actions.receipt.onMessage=data=>{
      const id=data?.id;
      const message=activeRoom?.messages?.find(item=>item.id===id && item.sender===profileId());
      if (!message || message.status==='delivered') return;
      message.status='delivered'; save(); renderMessages();
    };
    actions.media.onReceiveProgress=(percent,{metadata})=>updateMediaProgress(metadata?.id,percent,'Receiving');
    actions.media.onMessage=async(data,{metadata})=>{
      const details=metadata?.attachment; const message=metadata?.message;
      if (!metadata?.id || !details || !(data instanceof ArrayBuffer) || data.byteLength>30*1024*1024) return;
      const blob=new Blob([data],{type:details.mime||'application/octet-stream'});
      await storeMedia(metadata.id,blob); mediaRequests.delete(metadata.id); mediaProgress.delete(metadata.id);
      if (message?.id && typeof message.text==='string' && !activeRoom.messages?.some(item=>item.id===message.id)) {
        activeRoom.messages ||= []; activeRoom.messages.push({...message,attachment:details}); activeRoom.lastActive=Date.now(); save(); renderRooms(els.roomSearch.value); playTone('message');
      }
      renderMessages();
    };
    actions.mediaRequest.onMessage=async(data,{peerId})=>{
      const id=data?.id; if(!id)return;
      const message=activeRoom?.messages?.find(item=>item.attachment?.id===id); const blob=await getMedia(id).catch(()=>null);
      if(message&&blob)sendMediaBlob(message,blob,peerId).catch(()=>{});
    };
    actions.call.onMessage=(data,{peerId})=>handleCallSignal(data,peerId);
    setTimeout(()=>{
      if(activeRoomId!==room.id || peers.size) return;
      const sockets=typeof networkApi?.getRelaySockets==='function' ? Object.values(networkApi.getRelaySockets()) : [];
      const open=sockets.filter(socket=>socket?.readyState===WebSocket.OPEN).length;
      els.bannerText.textContent=open
        ? `Discovery ready on ${open} relay${open===1?'':'s'} — waiting for the other browser`
        : 'Discovery relays are blocked or offline — check browser network access';
    },4500);
  } catch (error) {
    console.error(error); els.bannerText.textContent='Messaging network unavailable. You can still manage rooms and retry.'; toast('P2P network could not load',true);
  }
}

function applyRoomInfo(info) {
  if (!activeRoom || !info?.name || !activeRoom.name.startsWith('Room ')) return;
  const name=String(info.name).trim().slice(0,40);
  if (!name || name.startsWith('Room ')) return;
  activeRoom.name=name; activeRoom.lastActive=Date.now(); save();
  updateRoomHeader(); renderMessages(); renderRooms(els.roomSearch.value);
}

function mergeHistory(list) {
  if (!Array.isArray(list) || !activeRoom) return;
  const map=new Map((activeRoom.messages||[]).map(x=>[x.id,x]));
  list.forEach(msg=>{ if(msg?.id && typeof msg.text==='string' && !map.has(msg.id)) map.set(msg.id,msg); });
  activeRoom.messages=[...map.values()].sort((a,b)=>a.time-b.time).slice(-300); save(); renderMessages(); renderRooms(els.roomSearch.value);
}

function addSystem(text) {
  if (!activeRoom) return;
  activeRoom.messages ||= []; activeRoom.messages.push({id:uid(),text,time:Date.now(),system:true}); save(); renderMessages();
}

async function sendMessage(text) {
  const clean=text.trim(); if (!clean || !activeRoom) return;
  const msg={id:uid(),text:clean,time:Date.now(),sender:profileId(),name:profile.name,status:peers.size?'sending':'queued'};
  activeRoom.messages ||= []; activeRoom.messages.push(msg); activeRoom.lastActive=Date.now(); save();
  renderMessages(); renderRooms(els.roomSearch.value);
  els.messageInput.value=''; resizeComposer();
  if (actions.message && peers.size) {
    try {
      const outbound={...msg}; delete outbound.status;
      await actions.message.send(outbound); msg.status='sent'; save(); renderMessages();
    } catch { msg.status='queued'; save(); renderMessages(); toast('Message saved; it will sync when you reconnect',true); }
  }
}

function dataUrlToBlob(dataUrl) {
  const [header,encoded]=dataUrl.split(','); const mime=header.match(/data:([^;]+)/)?.[1]||'image/jpeg';
  const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)); return new Blob([bytes],{type:mime});
}

function updateMediaProgress(id,percent,label='Sending') {
  if(!id)return; mediaProgress.set(id,percent);
  const card=els.messages.querySelector(`[data-media-id="${CSS.escape(id)}"]`); if(!card)return;
  const title=card.querySelector('.media-loading strong'); if(title)title.textContent=`${label} ${Math.round(percent*100)}%`;
}

async function sendMediaBlob(message,blob,target) {
  const id=message.attachment.id;
  const sharedMessage={...message}; delete sharedMessage.status;
  await actions.media.send(blob,{
    target,
    metadata:{id,attachment:message.attachment,message:sharedMessage},
    onProgress:percent=>updateMediaProgress(id,percent,'Sending')
  });
  mediaProgress.delete(id); if(message.status!=='delivered')message.status='sent'; save(); renderMessages();
}

async function sendAttachment(file) {
  if(!activeRoom||!file)return;
  const isImage=file.type.startsWith('image/'),isVideo=file.type.startsWith('video/');
  if(!isImage&&!isVideo){toast('Choose an image or video file',true);return;}
  if(isVideo&&file.size>30*1024*1024){toast('Videos must be smaller than 30 MB',true);return;}
  try {
    let blob=file;
    if(isImage)blob=dataUrlToBlob(await resizeImageFile(file,{maxWidth:1920,maxHeight:1920,quality:.84}));
    const mediaId=uid(); const kind=isVideo?'video':'image';
    const message={id:uid(),text:'',time:Date.now(),sender:profileId(),name:profile.name,status:peers.size?'sending':'queued',attachment:{id:mediaId,kind,mime:blob.type,name:file.name.slice(0,120),size:blob.size}};
    await storeMedia(mediaId,blob); activeRoom.messages ||= []; activeRoom.messages.push(message); activeRoom.lastActive=Date.now(); save(); renderMessages(); renderRooms(els.roomSearch.value);
    if(actions.message&&peers.size){
      const outbound={...message};delete outbound.status; await actions.message.send(outbound);
      await sendMediaBlob(message,blob);
    } else toast('Media saved — it will transfer when your peer reconnects');
  } catch(error){console.error(error);toast(error.message||'Could not send that media',true);}
}

function startPeerHealth(peerId) {
  clearPeerHealth();
  const measure=async()=>{
    if (!p2pRoom || !peers.has(peerId)) return;
    try { peerLatency=Math.round(await p2pRoom.ping(peerId)); updateRoomHeader(); }
    catch { peerLatency=null; }
  };
  measure(); peerPingTimer=setInterval(measure,10000);
}

function clearPeerHealth() {
  clearInterval(peerPingTimer); peerPingTimer=null; peerLatency=null;
}

async function getCallMedia(kind) {
  const stream=await navigator.mediaDevices.getUserMedia({
    audio:{
      echoCancellation:true,
      noiseSuppression:true,
      autoGainControl:true,
      channelCount:{ideal:2},
      sampleRate:{ideal:48000},
      latency:{ideal:.02}
    },
    video:kind==='video'?{
      width:{ideal:1920},
      height:{ideal:1080},
      frameRate:{ideal:30,max:60},
      facingMode:'user'
    }:false
  });
  stream.getAudioTracks().forEach(track=>{ try { track.contentHint='speech'; } catch {} });
  stream.getVideoTracks().forEach(track=>{ try { track.contentHint='motion'; } catch {} });
  return stream;
}

async function tuneCallQuality(peerId,kind) {
  const connection=p2pRoom?.getPeers?.()[peerId];
  if (!connection) return;
  await Promise.all(connection.getSenders().map(async sender=>{
    const mediaKind=sender.track?.kind; if (!mediaKind) return;
    const parameters=sender.getParameters(); parameters.encodings ||= [{}];
    parameters.encodings.forEach(encoding=>{
      if (mediaKind==='audio') encoding.maxBitrate=128000;
      if (mediaKind==='video') { encoding.maxBitrate=3000000; encoding.maxFramerate=30; }
    });
    if (mediaKind==='video' && 'degradationPreference' in parameters) parameters.degradationPreference='maintain-framerate';
    try { await sender.setParameters(parameters); } catch {}
  }));
  if (currentCall?.peerId===peerId) els.callTitle.textContent=kind==='video'?'Video call · HD':'Audio call · Clear voice';
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
  [els.roomModal,els.inviteModal,els.incomingModal,els.settingsModal].forEach(el=>el.classList.add('hidden'));
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

function openSettings() {
  hideModals();
  els.settingsNameInput.value=profile.name;
  els.settingsAvatarPreview.textContent=initials(profile.name); setAvatarStyle(els.settingsAvatarPreview,profile.color||0,profile.avatarImage);
  els.wallpaperVisibility.value=prefs.wallpaperVisibility; els.wallpaperVisibilityValue.textContent=`${prefs.wallpaperVisibility}%`;
  els.densitySelect.value=prefs.density; els.fontScale.value=prefs.fontScale; els.fontScaleValue.textContent=`${prefs.fontScale}%`;
  els.enterToSendToggle.checked=prefs.enterToSend; els.soundsToggle.checked=prefs.sounds; els.motionToggle.checked=prefs.reduceMotion;
  [...els.accentOptions.children].forEach(button=>button.classList.toggle('active',button.dataset.accent===prefs.accent));
  els.removeAvatarButton.disabled=!profile.avatarImage; els.removeWallpaperButton.disabled=!prefs.wallpaper;
  els.modalBackdrop.classList.remove('hidden'); els.settingsModal.classList.remove('hidden');
}

function resizeImageFile(file,{maxWidth,maxHeight=maxWidth,quality=.8,crop=false}) {
  return new Promise((resolve,reject)=>{
    if (!file?.type?.startsWith('image/')) { reject(new Error('Choose an image file')); return; }
    if (file.size>15*1024*1024) { reject(new Error('Choose an image smaller than 15 MB')); return; }
    const image=new Image(); const objectUrl=URL.createObjectURL(file);
    image.onload=()=>{
      const canvas=document.createElement('canvas'); let sourceX=0,sourceY=0,sourceW=image.width,sourceH=image.height;
      if (crop) {
        const side=Math.min(image.width,image.height); sourceX=(image.width-side)/2; sourceY=(image.height-side)/2; sourceW=sourceH=side;
        canvas.width=maxWidth; canvas.height=maxHeight;
      } else {
        const scale=Math.min(1,maxWidth/image.width,maxHeight/image.height); canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale));
      }
      canvas.getContext('2d').drawImage(image,sourceX,sourceY,sourceW,sourceH,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(objectUrl); resolve(canvas.toDataURL('image/jpeg',quality));
    };
    image.onerror=()=>{URL.revokeObjectURL(objectUrl);reject(new Error('Could not read that image'));}; image.src=objectUrl;
  });
}

function playTone(type='message') {
  if (!prefs.sounds) return;
  try {
    const AudioContextClass=window.AudioContext||window.webkitAudioContext; if(!AudioContextClass)return;
    const context=new AudioContextClass(); const oscillator=context.createOscillator(); const gain=context.createGain();
    oscillator.frequency.value=type==='call'?620:480; gain.gain.setValueAtTime(.035,context.currentTime); gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+.14);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime+.15); oscillator.onended=()=>context.close();
  } catch {}
}

async function startCall(kind) {
  const peerId=[...peers][0];
  if (!peerId) { toast('Wait for someone to connect first',true); return; }
  if (currentCall || incomingCall) { toast('A call is already active',true); return; }
  try {
    localStream=await getCallMedia(kind); cameraTrack=localStream.getVideoTracks()[0]||null;
    currentCall={peerId,kind,state:'calling'}; showCallOverlay(kind,'Calling…');
    await actions.call.send({type:'request',kind,name:profile.name},{target:peerId});
  } catch (error) { cleanupCall(); toast(mediaError(error),true); }
}

async function handleCallSignal(data,peerId) {
  if (!data?.type) return;
  if (data.type==='request') {
    if (currentCall || incomingCall) { actions.call.send({type:'busy'},{target:peerId}).catch(()=>{}); return; }
    incomingCall={peerId,kind:data.kind==='video'?'video':'audio',name:data.name||activeRoom?.peerName||'Room peer'};
    els.incomingTitle.textContent=incomingCall.name; els.incomingType.textContent=`${incomingCall.kind==='video'?'Video':'Audio'} call`;
    hideModals(); els.modalBackdrop.classList.remove('hidden'); els.incomingModal.classList.remove('hidden');
    playTone('call');
  }
  if (data.type==='accept' && currentCall?.peerId===peerId) {
    currentCall.state='connected';
    try { await p2pRoom.addStream(localStream,{target:peerId}); await tuneCallQuality(peerId,currentCall.kind); setTimeout(()=>tuneCallQuality(peerId,currentCall?.kind),600); startCallTimer(); }
    catch { cleanupCall(); toast('Could not send your media',true); }
  }
  if (data.type==='screen' && currentCall?.peerId===peerId) {
    els.callTitle.textContent=data.active?'Screen sharing':(currentCall.kind==='video'?'Video call · HD':'Audio call · Clear voice');
  }
  if ((data.type==='decline'||data.type==='busy') && currentCall?.peerId===peerId) { cleanupCall(); toast(data.type==='busy'?'They are already in a call':'Call declined'); }
  if (data.type==='end' && (currentCall?.peerId===peerId || incomingCall?.peerId===peerId)) { hideModals(); cleanupCall(); toast('Call ended'); }
}

async function acceptIncoming() {
  if (!incomingCall) return;
  const pending=incomingCall; incomingCall=null;
  try {
    localStream=await getCallMedia(pending.kind); cameraTrack=localStream.getVideoTracks()[0]||null;
    currentCall={...pending,state:'connected'}; hideModals(); showCallOverlay(pending.kind,pending.kind==='video'?'Video call':'Audio call'); startCallTimer();
    await p2pRoom.addStream(localStream,{target:pending.peerId});
    await tuneCallQuality(pending.peerId,pending.kind); setTimeout(()=>tuneCallQuality(pending.peerId,currentCall?.kind),600);
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
  if (currentCall.kind==='video') els.remotePlaceholder.classList.add('hidden');
  else { els.remotePlaceholder.classList.remove('hidden'); els.remotePlaceholder.querySelector('span').textContent='Audio connected'; }
  showCallOverlay(currentCall.kind,currentCall.kind==='video'?'Video call':'Audio call'); startCallTimer();
}

function showCallOverlay(kind,title) {
  els.callOverlay.classList.remove('hidden'); els.callOverlay.classList.toggle('audio-only',kind!=='video'); els.callTitle.textContent=title;
  els.cameraButton.classList.toggle('hidden',kind!=='video');
  els.shareScreenButton.classList.toggle('hidden',kind!=='video');
  els.localVideo.classList.toggle('hidden',kind!=='video');
  if (localStream) { els.localVideo.srcObject=localStream; els.localVideo.play().catch(()=>{}); }
  els.remotePlaceholder.classList.toggle('hidden',kind==='video');
  els.remotePlaceholder.querySelector('span').textContent=currentCall?.state==='calling'?'Waiting for answer…':'Audio connected';
  els.callAvatar.textContent=initials(activeRoom?.peerName||activeRoom?.name); setAvatarStyle(els.callAvatar,roomColor(activeRoom?.id),activeRoom?.peerAvatar); els.remoteName.textContent=activeRoom?.peerName||'Room peer';
}

async function toggleScreenShare() {
  if (!currentCall || currentCall.kind!=='video') { toast('Start a video call to share your screen',true); return; }
  if (screenStream) { await stopScreenShare(); return; }
  if (currentCall.state!=='connected') { toast('Wait for the call to connect first',true); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { toast('Screen sharing is not supported in this browser',true); return; }
  try {
    const next=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:false});
    const screenTrack=next.getVideoTracks()[0]; const connection=p2pRoom?.getPeers?.()[currentCall.peerId];
    const sender=connection?.getSenders().find(item=>item.track?.kind==='video');
    if (!sender) { next.getTracks().forEach(track=>track.stop()); throw new Error('Video connection is not ready'); }
    try { screenTrack.contentHint='detail'; } catch {}
    await sender.replaceTrack(screenTrack); screenStream=next;
    const parameters=sender.getParameters(); parameters.encodings ||= [{}]; parameters.encodings.forEach(encoding=>{encoding.maxBitrate=4000000;encoding.maxFramerate=30;});
    try { await sender.setParameters(parameters); } catch {}
    els.localVideo.srcObject=screenStream; els.localVideo.play().catch(()=>{});
    els.shareScreenButton.classList.add('sharing'); els.shareScreenButton.querySelector('span').textContent='Stop share'; els.callTitle.textContent='You’re sharing your screen';
    actions.call.send({type:'screen',active:true},{target:currentCall.peerId}).catch(()=>{});
    screenTrack.onended=()=>stopScreenShare();
  } catch (error) {
    if (error?.name!=='NotAllowedError') toast(error.message||'Could not share your screen',true);
  }
}

async function stopScreenShare(notifyPeer=true) {
  if (!screenStream) return;
  const peerId=currentCall?.peerId; const connection=peerId?p2pRoom?.getPeers?.()[peerId]:null;
  const sender=connection?.getSenders().find(item=>item.track?.kind==='video');
  try { if(sender&&cameraTrack)await sender.replaceTrack(cameraTrack); } catch {}
  screenStream.getTracks().forEach(track=>{track.onended=null;track.stop();}); screenStream=null;
  els.localVideo.srcObject=localStream; els.localVideo.play().catch(()=>{});
  els.shareScreenButton.classList.remove('sharing'); els.shareScreenButton.querySelector('span').textContent='Share';
  if (currentCall) els.callTitle.textContent='Video call · HD';
  if (notifyPeer&&peerId) actions.call?.send({type:'screen',active:false},{target:peerId}).catch(()=>{});
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
  if (screenStream) { screenStream.getTracks().forEach(track=>{track.onended=null;track.stop();}); screenStream=null; }
  if (localStream) {
    try { if (p2pRoom?.removeStream && currentCall) p2pRoom.removeStream(localStream,{target:currentCall.peerId}); } catch {}
    localStream.getTracks().forEach(track=>track.stop());
  }
  const remote=els.remoteVideo.srcObject; if (remote) remote.getTracks().forEach(track=>track.stop());
  localStream=null; cameraTrack=null; currentCall=null; incomingCall=null; els.localVideo.srcObject=null; els.remoteVideo.srcObject=null;
  els.callOverlay.classList.add('hidden'); els.remotePlaceholder.classList.remove('hidden');
  els.callOverlay.classList.remove('audio-only');
  els.muteButton.classList.remove('off'); els.cameraButton.classList.remove('off');
  els.shareScreenButton.classList.remove('sharing'); els.shareScreenButton.querySelector('span').textContent='Share';
  clearInterval(callInterval); callInterval=null; callStartedAt=null; els.callTimer.textContent='00:00';
  if (systemText) addSystem(systemText);
}

function resizeComposer() {
  els.messageInput.style.height='38px';
  els.messageInput.style.height=`${Math.max(38,Math.min(els.messageInput.scrollHeight,120))}px`;
  els.charCount.textContent=els.messageInput.value.length>3500?`${els.messageInput.value.length}/4000`:'';
}

function setupEvents() {
  [els.createRoomButton,els.emptyCreate,els.newRoomRail].forEach(el=>el.addEventListener('click',()=>openRoomModal('create')));
  [els.joinRoomButton,els.emptyJoin].forEach(el=>el.addEventListener('click',()=>openRoomModal('join')));
  els.modalClose.addEventListener('click',hideModals); els.inviteClose.addEventListener('click',hideModals); els.settingsClose.addEventListener('click',hideModals);
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
  els.messageInput.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&prefs.enterToSend){e.preventDefault();sendMessage(els.messageInput.value);} });
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
  els.menuClear.addEventListener('click',async()=>{ if(activeRoom&&confirm('Delete this room’s messages from this browser?')){await deleteRoomMedia(activeRoom);activeRoom.messages=[];save();renderMessages();renderRooms();} els.roomMenu.classList.add('hidden'); });
  els.menuForget.addEventListener('click',async()=>{
    if(!activeRoom||!confirm(`Forget “${activeRoom.name}” and its local messages?`)) return;
    if(currentCall) endCall(); await deleteRoomMedia(activeRoom); try{p2pRoom?.leave();}catch{} state.rooms=state.rooms.filter(r=>r.id!==activeRoomId); activeRoom=null;activeRoomId=null;p2pRoom=null;peers.clear();save();
    els.chatView.classList.add('hidden');els.emptyState.classList.remove('hidden');els.appShell.classList.remove('chat-open');els.roomMenu.classList.add('hidden');renderRooms();
  });
  els.testTabButton.addEventListener('click',()=>{
    const url=new URL(location.href); url.searchParams.set('client',`test${Math.floor(Math.random()*90+10)}`); if(activeRoomId)url.searchParams.set('room',activeRoomId); window.open(url,'_blank','noopener');
  });
  els.attachmentButton.addEventListener('click',()=>els.attachmentInput.click());
  els.attachmentInput.addEventListener('change',()=>{const file=els.attachmentInput.files?.[0];if(file)sendAttachment(file);els.attachmentInput.value='';});
  [els.profileButton,els.settingsButton].forEach(el=>el.addEventListener('click',openSettings));
  els.settingsNameInput.addEventListener('input',()=>{
    els.settingsAvatarPreview.textContent=initials(els.settingsNameInput.value||profile.name); setAvatarStyle(els.settingsAvatarPreview,profile.color||0,profile.avatarImage);
  });
  els.changeAvatarButton.addEventListener('click',()=>els.avatarFileInput.click());
  els.avatarFileInput.addEventListener('change',async()=>{
    const file=els.avatarFileInput.files?.[0]; if(!file)return;
    try { profile.avatarImage=await resizeImageFile(file,{maxWidth:256,maxHeight:256,quality:.84,crop:true}); saveProfile(); openSettings(); toast('Profile photo updated'); }
    catch(error){toast(error.message||'Could not use that image',true);} finally{els.avatarFileInput.value='';}
  });
  els.removeAvatarButton.addEventListener('click',()=>{delete profile.avatarImage;saveProfile();openSettings();toast('Profile photo removed');});
  els.changeWallpaperButton.addEventListener('click',()=>els.wallpaperFileInput.click());
  els.wallpaperFileInput.addEventListener('change',async()=>{
    const file=els.wallpaperFileInput.files?.[0]; if(!file)return;
    try { const next=await resizeImageFile(file,{maxWidth:1600,maxHeight:1000,quality:.72}); const previous=prefs.wallpaper; prefs.wallpaper=next; if(!savePrefs())prefs.wallpaper=previous; openSettings(); toast('Chat background updated'); }
    catch(error){toast(error.message||'Could not use that image',true);} finally{els.wallpaperFileInput.value='';}
  });
  els.removeWallpaperButton.addEventListener('click',()=>{prefs.wallpaper='';savePrefs();openSettings();toast('Chat background cleared');});
  els.accentOptions.addEventListener('click',event=>{
    const button=event.target.closest('[data-accent]'); if(!button)return; prefs.accent=button.dataset.accent; savePrefs();
    [...els.accentOptions.children].forEach(item=>item.classList.toggle('active',item===button));
  });
  els.wallpaperVisibility.addEventListener('input',()=>{prefs.wallpaperVisibility=Number(els.wallpaperVisibility.value);els.wallpaperVisibilityValue.textContent=`${prefs.wallpaperVisibility}%`;savePrefs();});
  els.fontScale.addEventListener('input',()=>{prefs.fontScale=Number(els.fontScale.value);els.fontScaleValue.textContent=`${prefs.fontScale}%`;savePrefs();});
  els.densitySelect.addEventListener('change',()=>{prefs.density=els.densitySelect.value;savePrefs();});
  els.enterToSendToggle.addEventListener('change',()=>{prefs.enterToSend=els.enterToSendToggle.checked;savePrefs();});
  els.soundsToggle.addEventListener('change',()=>{prefs.sounds=els.soundsToggle.checked;savePrefs();});
  els.motionToggle.addEventListener('change',()=>{prefs.reduceMotion=els.motionToggle.checked;savePrefs();});
  els.settingsSaveButton.addEventListener('click',()=>{
    const name=els.settingsNameInput.value.trim(); if(!name){toast('Enter a display name',true);els.settingsNameInput.focus();return;}
    profile.name=name.slice(0,28); saveProfile(); savePrefs(); renderMessages(); hideModals(); toast('Settings saved');
  });
  els.audioCallButton.addEventListener('click',()=>startCall('audio')); els.videoCallButton.addEventListener('click',()=>startCall('video'));
  els.acceptCall.addEventListener('click',acceptIncoming); els.declineCall.addEventListener('click',declineIncoming);
  els.endCallButton.addEventListener('click',()=>endCall()); els.minimizeCall.addEventListener('click',()=>els.callOverlay.classList.add('hidden'));
  els.shareScreenButton.addEventListener('click',toggleScreenShare);
  els.muteButton.addEventListener('click',()=>{ const track=localStream?.getAudioTracks()[0]; if(!track)return; track.enabled=!track.enabled; els.muteButton.classList.toggle('off',!track.enabled); els.muteButton.querySelector('span').textContent=track.enabled?'Mute':'Unmute'; });
  els.cameraButton.addEventListener('click',()=>{ const track=localStream?.getVideoTracks()[0]; if(!track)return; track.enabled=!track.enabled; els.cameraButton.classList.toggle('off',!track.enabled); els.cameraButton.querySelector('span').textContent=track.enabled?'Camera':'Camera off'; });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) document.title='msngr'; });
  addEventListener('offline',()=>{
    if (!activeRoom) return;
    els.connectionBanner.classList.remove('hidden'); els.bannerText.textContent='You’re offline — messages will stay safely on this device';
  });
  addEventListener('online',()=>{
    if (!activeRoom) return;
    clearTimeout(reconnectTimer); toast('Back online — reconnecting');
    reconnectTimer=setTimeout(()=>{ if(activeRoom && !currentCall) connectRoom(activeRoom); },500);
  });
  addEventListener('beforeunload',()=>{ clearPeerHealth(); clearTimeout(reconnectTimer); mediaUrls.forEach(url=>URL.revokeObjectURL(url)); try{p2pRoom?.leave();}catch{} localStream?.getTracks().forEach(t=>t.stop()); });
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
  applyPrefs(); migrateLegacyIdentity(); renderProfile(); renderRooms(); setupEvents(); registerWebMcp(); resizeComposer();
  const linked=normalizeCode(qs.get('room')||'');
  if (linked) {
    let room=roomById(linked);
    if (!room) { room={id:linked,name:`Room ${linked.slice(0,5)}`,messages:[],createdAt:Date.now(),lastActive:Date.now()}; state.rooms.push(room); save(); }
    await openRoom(linked);
    history.replaceState({},'',inviteUrl(linked)+(clientScope==='main'?'':`&client=${encodeURIComponent(clientScope)}`));
  }
}

init();
