import { createClient } from '@supabase/supabase-js';

const $ = (id) => document.getElementById(id);
const envUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uglcxkakkilfndubgrac.supabase.co';
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B2ff1Bo8K9CR7UIY5c6deA_v1TWwayF';
const configured = Boolean(envUrl && envKey);
const supabase = configured ? createClient(envUrl, envKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 8 } }
}) : null;

const state = {
  mode: 'signin',
  section: 'messages',
  peopleTab: 'people',
  user: null,
  profile: null,
  conversations: [],
  people: [],
  requests: [],
  contacts: [],
  activeId: null,
  messages: new Map(),
  oldest: null,
  hasOlder: false,
  realtime: null,
  readTimer: null,
  inboxTimer: null,
  peopleTimer: null,
  members: new Map(),
  connectionStatus: 'connecting',
  heartbeat: null
};

const ACCENTS = {
  emerald: ['#16b889','#0b7c60'],
  blue: ['#4387ff','#245ac9'],
  violet: ['#8b6cf4','#6546cf'],
  amber: ['#edae39','#c97a12'],
  rose: ['#ef6f8e','#c94368']
};

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0,2).map(p => p[0] || '').join('').toUpperCase() || '?';
}

function timeLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([], {day:'numeric',month:'short'});
}

function presenceLabel(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 5 * 60 * 1000) return 'active recently';
  if (ms < 60 * 60 * 1000) return Math.max(1, Math.round(ms / 60000)) + 'm ago';
  return timeLabel(value);
}

function dayKey(value) {
  const d = new Date(value);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday:'short', day:'numeric', month:'short' });
}

function currentConversation() {
  return state.conversations.find(x => x.id === state.activeId) || null;
}

function updateUnreadTitle() {
  const total = state.conversations.reduce((sum,x) => sum + Number(x.unread || 0), 0);
  document.title = total ? '(' + Math.min(total,99) + ') msngr' : 'msngr';
}

function setConnectionState(status) {
  state.connectionStatus = status;
  const el = $('connectionState');
  if (!el) return;
  const live = status === 'live';
  const offline = status === 'offline' || !navigator.onLine;
  el.className = 'connection-state ' + (live ? 'live' : offline ? 'offline' : 'connecting');
  el.title = live ? 'Realtime connected' : offline ? 'Offline' : 'Connecting';
}

function renderSkeletons(count=5) {
  const root = $('sideList');
  if (!root) return;
  root.replaceChildren();
  for (let i=0;i<count;i++) {
    const row=document.createElement('div');
    row.className='list-skeleton';
    row.innerHTML='<i></i><span><b></b><em></em></span>';
    root.appendChild(row);
  }
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $('toast').classList.add('hidden'), 2800);
}

function setMessage(el, text, error=false) {
  el.textContent = text || '';
  el.classList.toggle('error', error);
}

function applyAvatar(el, name, url) {
  if (!el) return;
  el.replaceChildren();
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = initials(name);
  }
}

function applyPreferences() {
  if (!state.profile) return;
  const [a,b] = ACCENTS[state.profile.accent] || ACCENTS.emerald;
  document.documentElement.style.setProperty('--accent', a);
  document.documentElement.style.setProperty('--accent-dark', b);
  document.body.dataset.wallpaper = state.profile.wallpaper || 'mist';
  document.body.classList.toggle('compact', Boolean(state.profile.compact_mode));
  if (state.profile.wallpaper === 'custom' && state.profile.wallpaper_url) {
    document.documentElement.style.setProperty('--custom-wallpaper', 'url("' + state.profile.wallpaper_url.replace(/"/g,'') + '")');
  } else {
    document.documentElement.style.removeProperty('--custom-wallpaper');
  }
  document.querySelectorAll('[data-accent]').forEach(bn => bn.classList.toggle('active', bn.dataset.accent === state.profile.accent));
  document.querySelectorAll('[data-wallpaper]').forEach(bn => bn.classList.toggle('active', bn.dataset.wallpaper === state.profile.wallpaper));
  $('enterToSend').checked = state.profile.enter_to_send !== false;
  $('compactMode').checked = Boolean(state.profile.compact_mode);
}

function setAuthMode(mode) {
  state.mode = mode;
  const signup = mode === 'signup';
  $('nameField').classList.toggle('hidden', !signup);
  $('authTitle').textContent = signup ? 'Create account' : 'Sign in';
  $('authIntro').textContent = signup ? 'Create an account and enter msngr instantly.' : 'Jump back into your conversations.';
  $('authSubmit').querySelector('span').textContent = signup ? 'Create account' : 'Sign in';
  $('authSwitch').textContent = signup ? 'Already have an account? Sign in' : 'Need an account? Create one';
  $('passwordInput').autocomplete = signup ? 'new-password' : 'current-password';
  setMessage($('authMessage'),'');
}

function showAuth() {
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
}

function showApp() {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

function openModal(id) {
  $('modalBackdrop').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function closeModal() {
  $('modalBackdrop').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

async function ensureProfile() {
  let { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const displayName = state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || 'User';
    const created = await supabase.from('profiles').insert({
      id: state.user.id, email: state.user.email, display_name: displayName
    }).select('*').single();
    if (created.error) throw created.error;
    data = created.data;
  }
  state.profile = data;
  await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', state.user.id);
  $('meName').textContent = data.display_name;
  $('meEmail').textContent = data.email;
  $('settingsName').value = data.display_name;
  $('settingsAbout').value = data.about || '';
  applyAvatar($('meAvatar'), data.display_name, data.avatar_url);
  applyAvatar($('railAvatar'), data.display_name, data.avatar_url);
  applyAvatar($('settingsAvatar'), data.display_name, data.avatar_url);
  applyPreferences();
}

async function loadInbox() {
  const { data, error } = await supabase.rpc('get_inbox');
  if (error) throw error;
  state.conversations = (data || []).map(x => ({
    id:x.conversation_id,
    kind:x.conversation_kind,
    name:x.display_name || 'Conversation',
    avatarUrl:x.avatar_url,
    lastMessage:x.last_message || '',
    lastMessageAt:x.last_message_at,
    unread:Number(x.unread_count || 0),
    memberCount:Number(x.member_count || 0)
  }));
  updateUnreadTitle();
  if (state.section === 'messages') renderSideList();
}

async function loadPeople(search='') {
  const { data, error } = await supabase.rpc('get_people',{p_search:search});
  if (error) throw error;
  state.people = data || [];
  if (state.section === 'people' && state.peopleTab === 'people') renderSideList();
}

async function loadRequests() {
  const { data, error } = await supabase.rpc('get_contact_requests');
  if (error) throw error;
  state.requests = data || [];
  const incoming = state.requests.filter(x => x.direction === 'incoming').length;
  $('requestCount').textContent = String(incoming);
  $('requestBadge').textContent = String(incoming);
  $('requestBadge').classList.toggle('hidden', incoming === 0);
  $('mobileRequestBadge').textContent = String(incoming);
  $('mobileRequestBadge').classList.toggle('hidden', incoming === 0);
  if (state.section === 'people' && state.peopleTab === 'requests') renderSideList();
}

async function loadContacts() {
  const { data, error } = await supabase.rpc('get_contacts');
  if (error) throw error;
  state.contacts = data || [];
  if (state.section === 'people' && state.peopleTab === 'contacts') renderSideList();
}

async function refreshSocial() {
  await Promise.all([loadPeople($('sideSearch').value.trim()), loadRequests(), loadContacts()]);
}

function createAvatar(name,url,className='avatar') {
  const el = document.createElement('div');
  el.className = className;
  applyAvatar(el,name,url);
  return el;
}

function renderConversationList(root) {
  const q = $('sideSearch').value.trim().toLowerCase();
  const items = state.conversations.filter(x => !q || x.name.toLowerCase().includes(q) || x.lastMessage.toLowerCase().includes(q));
  if (!items.length) return renderEmptyList(root, q ? 'No matching conversations.' : 'No conversations yet. Find people and connect first.');
  items.forEach(item => {
    const button = document.createElement('button');
    button.className = 'list-item conversation-item' + (state.activeId === item.id ? ' active' : '');
    button.appendChild(createAvatar(item.name,item.avatarUrl));
    const copy = document.createElement('div'); copy.className='list-copy';
    const top = document.createElement('div'); top.className='list-top';
    const name = document.createElement('strong'); name.textContent=item.name;
    const time = document.createElement('time'); time.textContent=timeLabel(item.lastMessageAt);
    top.append(name,time);
    const bottom = document.createElement('div'); bottom.className='list-bottom';
    const preview = document.createElement('span'); preview.textContent=item.lastMessage || (item.kind==='group' ? item.memberCount+' members' : 'Start the conversation');
    bottom.appendChild(preview);
    if (item.unread) { const badge=document.createElement('b'); badge.textContent=String(Math.min(item.unread,99)); bottom.appendChild(badge); }
    copy.append(top,bottom); button.appendChild(copy);
    button.addEventListener('click',()=>openConversation(item.id));
    root.appendChild(button);
  });
}

function peopleActionLabel(rel) {
  return rel === 'contact' ? 'Message' : rel === 'sent' ? 'Sent' : rel === 'received' ? 'Review' : 'Connect';
}

function renderPeopleList(root, items) {
  if (!items.length) return renderEmptyList(root,'No people found.');
  items.forEach(person => {
    const row=document.createElement('div'); row.className='list-item person-item';
    row.appendChild(createAvatar(person.display_name,person.avatar_url));
    const copy=document.createElement('div'); copy.className='list-copy';
    const name=document.createElement('strong'); name.textContent=person.display_name;
    const about=document.createElement('span'); about.textContent=person.about || presenceLabel(person.last_seen_at) || 'msngr user';
    copy.append(name,about);
    const action=document.createElement('button'); action.className='mini-button'; action.textContent=peopleActionLabel(person.relationship);
    action.disabled=person.relationship==='sent';
    action.addEventListener('click',async()=>{
      try {
        if (person.relationship==='contact') await startDirect(person.user_id);
        else if (person.relationship==='received') { state.peopleTab='requests'; syncPeopleTabs(); renderSideList(); }
        else {
          const {error}=await supabase.rpc('send_contact_request',{p_target_user_id:person.user_id});
          if (error) throw error;
          showToast('Connection request sent');
          await refreshSocial();
        }
      } catch(e){ showToast(e.message || 'Could not complete that action'); }
    });
    row.append(copy,action); root.appendChild(row);
  });
}

function renderRequestList(root) {
  if (!state.requests.length) return renderEmptyList(root,'No pending requests.');
  state.requests.forEach(req => {
    const row=document.createElement('div'); row.className='list-item person-item request-item';
    row.appendChild(createAvatar(req.display_name,req.avatar_url));
    const copy=document.createElement('div'); copy.className='list-copy';
    const name=document.createElement('strong'); name.textContent=req.display_name;
    const sub=document.createElement('span'); sub.textContent=req.direction==='incoming' ? 'Wants to connect' : 'Request sent';
    copy.append(name,sub); row.appendChild(copy);
    const actions=document.createElement('div'); actions.className='request-actions';
    if (req.direction==='incoming') {
      const accept=document.createElement('button'); accept.className='mini-button'; accept.textContent='Accept';
      const decline=document.createElement('button'); decline.className='mini-button ghost'; decline.textContent='Decline';
      accept.onclick=()=>respondRequest(req.request_id,true);
      decline.onclick=()=>respondRequest(req.request_id,false);
      actions.append(accept,decline);
    } else { const pending=document.createElement('span'); pending.className='pending-label'; pending.textContent='Pending'; actions.appendChild(pending); }
    row.appendChild(actions); root.appendChild(row);
  });
}

function renderEmptyList(root,text) {
  const empty=document.createElement('div'); empty.className='side-empty'; empty.textContent=text; root.appendChild(empty);
}

function renderSideList() {
  const root=$('sideList'); root.replaceChildren();
  if (state.section==='messages') renderConversationList(root);
  if (state.section==='people') {
    if (state.peopleTab==='people') renderPeopleList(root,state.people);
    if (state.peopleTab==='requests') renderRequestList(root);
    if (state.peopleTab==='contacts') renderPeopleList(root,state.contacts.map(c=>({...c,relationship:'contact'})));
  }
}

function syncPeopleTabs() {
  document.querySelectorAll('[data-people-tab]').forEach(b=>b.classList.toggle('active',b.dataset.peopleTab===state.peopleTab));
}

function setSection(section) {
  const previous = state.section;
  state.section=section;
  $('appView').dataset.section = section;
  if (previous !== section && $('sideSearch')) $('sideSearch').value = '';
  document.querySelectorAll('.rail-button').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
  document.querySelectorAll('[data-mobile-section]').forEach(b=>b.classList.toggle('active',b.dataset.mobileSection===section));
  $('settingsView').classList.toggle('hidden',section!=='settings');
  $('chatView').classList.toggle('hidden',section==='settings' || !state.activeId);
  $('emptyState').classList.toggle('hidden',section==='settings' || Boolean(state.activeId));
  $('sideTabs').classList.toggle('hidden',section!=='people');
  $('sideSearchWrap').classList.toggle('hidden',section==='settings');
  $('sideAction').classList.toggle('hidden',section==='settings');
  if (section==='messages') {
    $('sideEyebrow').textContent='MSNGR'; $('sideTitle').textContent='Messages'; $('sideSearch').placeholder='Search conversations';
    $('sideAction').title='New group'; $('sideAction').textContent='+';
    renderSideList();
  } else if (section==='people') {
    $('sideEyebrow').textContent='SOCIAL'; $('sideTitle').textContent='People'; $('sideSearch').placeholder='Search people by name';
    $('sideAction').title='New group'; $('sideAction').textContent='+';
    renderSkeletons(5);
    refreshSocial().catch(e=>{ showToast(e.message); renderSideList(); });
  } else {
    $('sideEyebrow').textContent='YOU'; $('sideTitle').textContent='Settings';
    $('sideList').replaceChildren();
  }
}

async function respondRequest(id,accept) {
  try {
    const {error}=await supabase.rpc('respond_contact_request',{p_request_id:id,p_accept:accept});
    if (error) throw error;
    showToast(accept ? 'Contact added' : 'Request declined');
    await refreshSocial();
  } catch(e){ showToast(e.message || 'Could not respond'); }
}

async function startDirect(userId) {
  const {data,error}=await supabase.rpc('start_direct_conversation',{p_target_user_id:userId});
  if (error) throw error;
  await loadInbox();
  setSection('messages');
  await openConversation(data);
}

function renderMessages() {
  const root=$('messages'); root.replaceChildren();
  const list=state.messages.get(state.activeId)||[];
  const conversation=currentConversation();
  const members=state.members.get(state.activeId)||[];
  const memberMap=new Map(members.map(m=>[m.user_id,m]));
  let previousSender=null;
  let previousDay=null;

  if (!list.length) {
    const empty=document.createElement('div');
    empty.className='chat-empty';
    empty.innerHTML='<span>✦</span><strong>No messages yet</strong><p>Say hello and start the conversation.</p>';
    root.appendChild(empty);
    return;
  }

  list.forEach(m=>{
    const messageDay=dayKey(m.created_at);
    if(messageDay!==previousDay){
      const divider=document.createElement('div');
      divider.className='date-divider';
      const label=document.createElement('span');
      label.textContent=dayLabel(m.created_at);
      divider.appendChild(label);
      root.appendChild(divider);
      previousDay=messageDay;
      previousSender=null;
    }

    const mine=m.sender_id===state.user.id;
    const row=document.createElement('div'); row.className='message-row'+(mine?' mine':'');
    const bubble=document.createElement('div'); bubble.className='bubble';

    if(conversation?.kind==='group'&&!mine&&previousSender!==m.sender_id){
      const sender=document.createElement('div');
      sender.className='message-sender';
      sender.textContent=memberMap.get(m.sender_id)?.display_name || 'Member';
      bubble.appendChild(sender);
    }

    const body=document.createElement('div'); body.className='message-body'; body.textContent=m.body;
    const meta=document.createElement('div'); meta.className='bubble-meta'; meta.textContent=timeLabel(m.created_at);
    bubble.append(body,meta); row.appendChild(bubble);
    if(previousSender===m.sender_id) row.classList.add('stacked');
    previousSender=m.sender_id; root.appendChild(row);
  });
}

async function loadMessages(id,older=false) {
  const existing=state.messages.get(id)||[];
  let query=supabase.from('messages').select('id,conversation_id,sender_id,body,created_at').eq('conversation_id',id).order('created_at',{ascending:false}).limit(40);
  if(older&&state.oldest) query=query.lt('created_at',state.oldest);
  const {data,error}=await query; if(error) throw error;
  const page=(data||[]).reverse();
  state.hasOlder=page.length===40; $('loadOlderButton').classList.toggle('hidden',!state.hasOlder);
  const merged=older?[...page,...existing]:page;
  state.messages.set(id,Array.from(new Map(merged.map(x=>[String(x.id),x])).values()));
  const current=state.messages.get(id)||[]; state.oldest=current[0]?.created_at||null;
  if(state.activeId===id){renderMessages(); if(!older) scrollBottom();}
}

function scrollBottom(){requestAnimationFrame(()=>{$('messageScroller').scrollTop=$('messageScroller').scrollHeight;});}

async function loadMembers(id) {
  const {data,error}=await supabase.rpc('get_conversation_members',{p_conversation_id:id});
  if(error) return;
  state.members.set(id,data||[]);
  const root=$('memberPills'); root.replaceChildren();
  (data||[]).slice(0,4).forEach(m=>root.appendChild(createAvatar(m.display_name,m.avatar_url,'member-avatar')));
  const current=state.conversations.find(x=>x.id===id);
  $('chatSub').textContent=current?.kind==='group' ? (current.memberCount+' members') : 'Connected contact';
}

function scheduleRead(id) {
  clearTimeout(state.readTimer);
  state.readTimer=setTimeout(async()=>{
    if(!state.user||state.activeId!==id)return;
    await supabase.from('conversation_members').update({last_read_at:new Date().toISOString()}).eq('conversation_id',id).eq('user_id',state.user.id);
    const item=state.conversations.find(x=>x.id===id); if(item){item.unread=0; renderSideList(); updateUnreadTitle();}
  },700);
}

async function openConversation(id) {
  const item=state.conversations.find(x=>x.id===id); if(!item)return;
  state.activeId=id; state.oldest=null;
  $('chatName').textContent=item.name; applyAvatar($('chatAvatar'),item.name,item.avatarUrl);
  $('settingsView').classList.add('hidden'); $('emptyState').classList.add('hidden'); $('chatView').classList.remove('hidden');
  renderSideList();
  await Promise.all([loadMessages(id,false),loadMembers(id)]);
  scheduleRead(id); $('messageInput').focus();
}

function mergeIncoming(m) {
  const list=state.messages.get(m.conversation_id)||[];
  if(!list.some(x=>String(x.id)===String(m.id))){list.push(m);state.messages.set(m.conversation_id,list);}
  const item=state.conversations.find(x=>x.id===m.conversation_id);
  if(item){
    item.lastMessage=m.body;
    item.lastMessageAt=m.created_at;
    if(m.sender_id!==state.user.id&&state.activeId!==m.conversation_id)item.unread+=1;
    state.conversations.sort((a,b)=>new Date(b.lastMessageAt||0)-new Date(a.lastMessageAt||0));
  } else {
    clearTimeout(state.inboxTimer);
    state.inboxTimer=setTimeout(()=>loadInbox().catch(()=>{}),450);
  }
  if(state.activeId===m.conversation_id){renderMessages();scrollBottom();if(m.sender_id!==state.user.id)scheduleRead(m.conversation_id);}
  updateUnreadTitle();
  renderSideList();
}

async function subscribeMessages() {
  if(state.realtime) await supabase.removeChannel(state.realtime);
  setConnectionState(navigator.onLine ? 'connecting' : 'offline');
  state.realtime=supabase.channel('msngr-live')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>mergeIncoming(p.new))
    .on('postgres_changes',{event:'*',schema:'public',table:'contact_requests'},()=>refreshSocial().catch(()=>{}))
    .subscribe(status=>{
      if(status==='SUBSCRIBED') setConnectionState('live');
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED') setConnectionState(navigator.onLine?'connecting':'offline');
    });
}

async function bootstrap(user) {
  state.user=user; showApp(); renderSkeletons(6);
  await ensureProfile();
  await Promise.all([loadInbox(),refreshSocial()]);
  await subscribeMessages();
  clearInterval(state.heartbeat);
  state.heartbeat=setInterval(()=> {
    if(state.user) supabase.from('profiles').update({last_seen_at:new Date().toISOString()}).eq('id',state.user.id).then(()=>{});
  }, 240000);
  setSection('messages');
}

async function teardown() {
  if(state.realtime){await supabase.removeChannel(state.realtime);state.realtime=null;}
  clearInterval(state.heartbeat); state.heartbeat=null;
  Object.assign(state,{user:null,profile:null,conversations:[],people:[],requests:[],contacts:[],activeId:null});
  state.messages.clear(); state.members.clear(); document.title='msngr'; showAuth();
}

async function uploadImage(bucket,file,maxBytes) {
  if(!file) return null;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if(file.size>maxBytes) throw new Error('Image is too large.');
  const path=state.user.id+'/current';
  const {error}=await supabase.storage.from(bucket).upload(path,file,{upsert:true,cacheControl:'3600',contentType:file.type});
  if(error) throw error;
  const {data}=supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl+'?v='+Date.now();
}

async function savePreferences(patch,message='Settings saved') {
  const {data,error}=await supabase.from('profiles').update(patch).eq('id',state.user.id).select('*').single();
  if(error) throw error;
  state.profile=data; applyPreferences();
  $('meName').textContent=data.display_name; $('settingsName').value=data.display_name; $('settingsAbout').value=data.about||'';
  applyAvatar($('meAvatar'),data.display_name,data.avatar_url); applyAvatar($('railAvatar'),data.display_name,data.avatar_url); applyAvatar($('settingsAvatar'),data.display_name,data.avatar_url);
  showToast(message);
}

function updateGroupSelection() {
  const count=$('groupContacts').querySelectorAll('input:checked').length;
  $('groupSelectedCount').textContent=String(count);
  $('groupSubmit').disabled=count<1;
}

function renderGroupContacts() {
  const root=$('groupContacts'); root.replaceChildren();
  $('groupSelectedCount').textContent='0'; $('groupSubmit').disabled=true;
  if(!state.contacts.length){renderEmptyList(root,'Connect with someone before creating a group.');return;}
  state.contacts.forEach(c=>{
    const label=document.createElement('label'); label.className='group-contact';
    const input=document.createElement('input'); input.type='checkbox'; input.value=c.user_id; input.addEventListener('change',updateGroupSelection);
    label.append(input,createAvatar(c.display_name,c.avatar_url));
    const span=document.createElement('span'); span.textContent=c.display_name; label.appendChild(span); root.appendChild(label);
  });
}

$('authSwitch').onclick=()=>setAuthMode(state.mode==='signin'?'signup':'signin');
$('authForm').onsubmit=async e=>{
  e.preventDefault(); if(!supabase)return;
  const email=$('emailInput').value.trim(), password=$('passwordInput').value, displayName=$('nameInput').value.trim();
  $('authSubmit').disabled=true; setMessage($('authMessage'),'');
  try{
    if(state.mode==='signup'){
      if(!displayName)throw new Error('Enter a display name.');
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName}}}); if(error)throw error;
      if(!data.session?.user) throw new Error('Instant signup is blocked by the Supabase email-confirmation setting.');
      await bootstrap(data.session.user);
    }else{
      const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;await bootstrap(data.user);
    }
  }catch(err){setMessage($('authMessage'),err.message||'Authentication failed.',true);}
  finally{$('authSubmit').disabled=false;}
};

document.querySelectorAll('.rail-button').forEach(b=>b.onclick=()=>setSection(b.dataset.section));
document.querySelectorAll('[data-mobile-section]').forEach(b=>b.onclick=()=>setSection(b.dataset.mobileSection));
$('railProfile').onclick=()=>setSection('settings');
$('accountMenu').onclick=()=>setSection('settings');
$('emptyPeople').onclick=()=>setSection('people');

document.querySelectorAll('[data-people-tab]').forEach(b=>b.onclick=()=>{state.peopleTab=b.dataset.peopleTab;syncPeopleTabs();renderSideList();});
$('sideSearch').oninput=()=>{
  if(state.section==='messages')renderSideList();
  else if(state.section==='people'){clearTimeout(state.peopleTimer);state.peopleTimer=setTimeout(()=>loadPeople($('sideSearch').value.trim()).catch(()=>{}),220);}
};
$('sideAction').onclick=()=>{renderGroupContacts();openModal('groupModal');};
document.querySelectorAll('[data-close-modal]').forEach(b=>b.onclick=closeModal);
$('modalBackdrop').onclick=e=>{if(e.target===$('modalBackdrop'))closeModal();};

$('groupForm').onsubmit=async e=>{
  e.preventDefault(); setMessage($('groupMessage'),'');
  const ids=Array.from($('groupContacts').querySelectorAll('input:checked')).map(x=>x.value);
  try{
    const {data,error}=await supabase.rpc('create_group',{p_title:$('groupName').value.trim(),p_member_ids:ids});if(error)throw error;
    $('groupName').value='';closeModal();await loadInbox();setSection('messages');await openConversation(data);
  }catch(err){setMessage($('groupMessage'),err.message||'Could not create group.',true);}
};

$('composer').onsubmit=async e=>{
  e.preventDefault(); const body=$('messageInput').value.trim(); if(!body||!state.activeId)return;
  $('sendButton').disabled=true;
  try{
    const {data,error}=await supabase.rpc('send_message',{p_conversation_id:state.activeId,p_body:body});if(error)throw error;
    const m=Array.isArray(data)?data[0]:data; $('messageInput').value='';$('charCount').textContent='0';$('messageInput').style.height='42px';if(m)mergeIncoming(m);
  }catch(err){showToast(err.message||'Message could not be sent');}
  finally{$('sendButton').disabled=false;$('messageInput').focus();}
};
$('messageInput').oninput=()=>{
  const el=$('messageInput');$('charCount').textContent=String(el.value.length);el.style.height='42px';el.style.height=Math.min(el.scrollHeight,130)+'px';
};
$('messageInput').onkeydown=e=>{
  if(e.key==='Enter'&&!e.shiftKey&&state.profile?.enter_to_send!==false){e.preventDefault();$('composer').requestSubmit();}
};
$('loadOlderButton').onclick=()=>state.activeId&&loadMessages(state.activeId,true).catch(e=>showToast(e.message));

$('avatarPicker').onclick=()=>$('avatarInput').click();
$('avatarInput').onchange=async e=>{
  try{const url=await uploadImage('avatars',e.target.files[0],1024*1024);await savePreferences({avatar_url:url},'Profile photo updated');}
  catch(err){showToast(err.message);} finally{e.target.value='';}
};
$('saveProfileSettings').onclick=async()=>{
  try{await savePreferences({display_name:$('settingsName').value.trim(),about:$('settingsAbout').value.trim()},'Profile saved');await loadInbox();}
  catch(err){showToast(err.message);}
};
document.querySelectorAll('[data-accent]').forEach(b=>b.onclick=async()=>{try{await savePreferences({accent:b.dataset.accent},'Accent updated');}catch(e){showToast(e.message);}});
document.querySelectorAll('[data-wallpaper]').forEach(b=>b.onclick=async()=>{try{await savePreferences({wallpaper:b.dataset.wallpaper,wallpaper_url:null},'Chat background updated');}catch(e){showToast(e.message);}});
$('backgroundPicker').onclick=()=>$('backgroundInput').click();
$('backgroundInput').onchange=async e=>{
  try{const url=await uploadImage('backgrounds',e.target.files[0],3*1024*1024);await savePreferences({wallpaper:'custom',wallpaper_url:url},'Custom background applied');}
  catch(err){showToast(err.message);} finally{e.target.value='';}
};
$('enterToSend').onchange=async e=>{try{await savePreferences({enter_to_send:e.target.checked});}catch(err){showToast(err.message);}};
$('compactMode').onchange=async e=>{try{await savePreferences({compact_mode:e.target.checked});}catch(err){showToast(err.message);}};
$('signOutButton').onclick=async()=>{await supabase.auth.signOut();await teardown();};
$('mobileBack').onclick=()=>{state.activeId=null;$('chatView').classList.add('hidden');$('emptyState').classList.remove('hidden');renderSideList();};

window.addEventListener('online',()=>{setConnectionState('connecting'); if(state.user) subscribeMessages().catch(()=>{});});
window.addEventListener('offline',()=>setConnectionState('offline'));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('modalBackdrop').classList.contains('hidden')){closeModal();return;}
  const mod=e.metaKey||e.ctrlKey;
  if(!mod||!state.user)return;
  if(e.key.toLowerCase()==='k'){
    e.preventDefault();
    if(state.section==='settings')setSection('messages');
    setTimeout(()=>{$('sideSearch')?.focus();$('sideSearch')?.select();},0);
  }
  if(e.key==='1'){e.preventDefault();setSection('messages');}
  if(e.key==='2'){e.preventDefault();setSection('people');}
  if(e.key===','){e.preventDefault();setSection('settings');}
});

async function start(){
  setAuthMode('signin');
  if(!configured){$('configError').classList.remove('hidden');return;}
  const {data}=await supabase.auth.getSession();
  if(data.session?.user){try{await bootstrap(data.session.user);}catch(e){showAuth();setMessage($('authMessage'),e.message||'Could not load your account.',true);}}
  else showAuth();
  supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'&&!session)teardown();});
}
start();
