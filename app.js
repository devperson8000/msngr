import { createClient } from '@supabase/supabase-js';

const $ = (id) => document.getElementById(id);
const envUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uglcxkakkilfndubgrac.supabase.co';
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B2ff1Bo8K9CR7UIY5c6deA_v1TWwayF';
const configured = Boolean(envUrl && envKey);
const supabase = configured ? createClient(envUrl, envKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 8 } }
}) : null;

const state = {
  mode: 'signin',
  user: null,
  profile: null,
  conversations: [],
  activeId: null,
  messages: new Map(),
  oldest: null,
  hasOlder: false,
  realtime: null,
  readTimer: null,
  inboxTimer: null
};

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '?';
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => $('toast').classList.add('hidden'), 2600);
}

function setMessage(element, message, isError) {
  element.textContent = message || '';
  element.classList.toggle('error', Boolean(isError));
}

function setAuthMode(mode) {
  state.mode = mode;
  const signup = mode === 'signup';
  $('nameField').classList.toggle('hidden', !signup);
  $('authTitle').textContent = signup ? 'Create account' : 'Sign in';
  const submitLabel = signup ? 'Create account' : 'Sign in';
  const submitText = $('authSubmit').querySelector('span');
  if (submitText) submitText.textContent = submitLabel;
  else $('authSubmit').textContent = submitLabel;
  $('authSwitch').textContent = signup ? 'Already have an account? Sign in' : 'Need an account? Create one';
  const intro = document.querySelector('.auth-card-intro');
  if (intro) intro.textContent = signup
    ? 'Create your account and jump straight into msngr.'
    : 'Pick up where you left off and get straight back into your conversations.';
  $('passwordInput').autocomplete = signup ? 'new-password' : 'current-password';
  setMessage($('authMessage'), '', false);
}

function showAuth() {
  $('authView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('appView').classList.remove('chat-open');
}

function showApp() {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

function openModal(id) {
  $('modalBackdrop').classList.remove('hidden');
  $('newChatModal').classList.add('hidden');
  $('profileModal').classList.add('hidden');
  $(id).classList.remove('hidden');
}

function closeModal() {
  $('modalBackdrop').classList.add('hidden');
  $('newChatModal').classList.add('hidden');
  $('profileModal').classList.add('hidden');
}

async function ensureProfile() {
  let result = await supabase.from('profiles').select('id,email,display_name').eq('id', state.user.id).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    const displayName = state.user.user_metadata?.display_name || state.user.email?.split('@')[0] || 'User';
    const created = await supabase.from('profiles').insert({
      id: state.user.id,
      email: state.user.email,
      display_name: displayName
    }).select('id,email,display_name').single();
    if (created.error) throw created.error;
    result = created;
  }
  state.profile = result.data;
  $('meName').textContent = state.profile.display_name;
  $('meEmail').textContent = state.profile.email;
  $('meAvatar').textContent = initials(state.profile.display_name);
  $('profileName').value = state.profile.display_name;
}

async function loadInbox() {
  const { data, error } = await supabase.rpc('get_inbox');
  if (error) throw error;
  state.conversations = (data || []).map((item) => ({
    id: item.conversation_id,
    otherUserId: item.other_user_id,
    name: item.display_name || 'Unknown',
    lastMessage: item.last_message || '',
    lastMessageAt: item.last_message_at,
    unread: Number(item.unread_count || 0)
  }));
  renderConversations();
  if (state.activeId && !state.conversations.some((item) => item.id === state.activeId)) {
    state.activeId = null;
    showEmpty();
  }
}

function renderConversations() {
  const query = $('chatSearch').value.trim().toLowerCase();
  const items = state.conversations.filter((item) => {
    return !query || item.name.toLowerCase().includes(query) || item.lastMessage.toLowerCase().includes(query);
  });
  $('conversationCount').textContent = String(state.conversations.length);
  const root = $('conversationList');
  root.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.style.padding = '30px 18px';
    empty.style.color = '#86949b';
    empty.style.fontSize = '.78rem';
    empty.textContent = query ? 'No conversations match your search.' : 'No conversations yet.';
    root.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'conversation-item' + (item.id === state.activeId ? ' active' : '');
    button.type = 'button';
    button.addEventListener('click', () => openConversation(item.id));

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(item.name);

    const copy = document.createElement('div');
    copy.className = 'conversation-copy';
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const preview = document.createElement('span');
    preview.textContent = item.lastMessage || 'Start the conversation';
    copy.append(strong, preview);

    const meta = document.createElement('div');
    meta.className = 'conversation-meta';
    const time = document.createElement('time');
    time.textContent = timeLabel(item.lastMessageAt);
    meta.appendChild(time);
    if (item.unread > 0 && item.id !== state.activeId) {
      const unread = document.createElement('span');
      unread.className = 'unread';
      unread.textContent = String(Math.min(item.unread, 99));
      meta.appendChild(unread);
    }

    button.append(avatar, copy, meta);
    root.appendChild(button);
  });
}

function showEmpty() {
  $('emptyState').classList.remove('hidden');
  $('chatView').classList.add('hidden');
}

function renderMessages() {
  const list = state.messages.get(state.activeId) || [];
  const root = $('messages');
  root.replaceChildren();
  let previousSender = null;

  list.forEach((message) => {
    const row = document.createElement('div');
    row.className = 'message-row' + (message.sender_id === state.user.id ? ' mine' : '');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const body = document.createElement('div');
    body.textContent = message.body;
    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = timeLabel(message.created_at);
    bubble.append(body, meta);
    row.appendChild(bubble);
    if (previousSender === message.sender_id) row.style.marginTop = '-2px';
    previousSender = message.sender_id;
    root.appendChild(row);
  });
}

function scrollToBottom() {
  const scroller = $('messageScroller');
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}

async function loadMessages(conversationId, older) {
  const existing = state.messages.get(conversationId) || [];
  let query = supabase.from('messages')
    .select('id,conversation_id,sender_id,body,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (older && state.oldest) query = query.lt('created_at', state.oldest);
  const { data, error } = await query;
  if (error) throw error;

  const page = (data || []).reverse();
  state.hasOlder = page.length === 40;
  $('loadOlderButton').classList.toggle('hidden', !state.hasOlder);

  if (older) {
    const merged = [...page, ...existing];
    const unique = Array.from(new Map(merged.map((item) => [String(item.id), item])).values());
    state.messages.set(conversationId, unique);
  } else {
    state.messages.set(conversationId, page);
  }

  const current = state.messages.get(conversationId) || [];
  state.oldest = current.length ? current[0].created_at : null;
  if (state.activeId === conversationId) {
    renderMessages();
    if (!older) scrollToBottom();
  }
}

function scheduleRead(conversationId) {
  window.clearTimeout(state.readTimer);
  state.readTimer = window.setTimeout(async () => {
    if (!state.user || state.activeId !== conversationId) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('conversation_members')
      .update({ last_read_at: now })
      .eq('conversation_id', conversationId)
      .eq('user_id', state.user.id);
    if (!error) {
      const item = state.conversations.find((entry) => entry.id === conversationId);
      if (item) {
        item.unread = 0;
        renderConversations();
      }
    }
  }, 900);
}

async function openConversation(id) {
  const item = state.conversations.find((entry) => entry.id === id);
  if (!item) return;
  state.activeId = id;
  state.oldest = null;
  $('chatName').textContent = item.name;
  $('chatAvatar').textContent = initials(item.name);
  $('emptyState').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  $('appView').classList.add('chat-open');
  renderConversations();

  try {
    await loadMessages(id, false);
    scheduleRead(id);
    $('messageInput').focus();
  } catch (error) {
    showToast(error.message || 'Could not load messages');
  }
}

function mergeIncoming(message) {
  const list = state.messages.get(message.conversation_id) || [];
  if (!list.some((item) => String(item.id) === String(message.id))) {
    list.push(message);
    state.messages.set(message.conversation_id, list);
  }

  const inboxItem = state.conversations.find((item) => item.id === message.conversation_id);
  if (inboxItem) {
    inboxItem.lastMessage = message.body;
    inboxItem.lastMessageAt = message.created_at;
    if (message.sender_id !== state.user.id && state.activeId !== message.conversation_id) inboxItem.unread += 1;
    state.conversations.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
    renderConversations();
  } else {
    window.clearTimeout(state.inboxTimer);
    state.inboxTimer = window.setTimeout(() => loadInbox().catch(() => {}), 500);
  }

  if (state.activeId === message.conversation_id) {
    renderMessages();
    scrollToBottom();
    if (message.sender_id !== state.user.id) scheduleRead(message.conversation_id);
  }
}

async function subscribeMessages() {
  if (state.realtime) await supabase.removeChannel(state.realtime);
  state.realtime = supabase
    .channel('msngr-user-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      mergeIncoming(payload.new);
    })
    .subscribe();
}

async function bootstrap(user) {
  state.user = user;
  showApp();
  await ensureProfile();
  await loadInbox();
  await subscribeMessages();
}

async function teardown() {
  if (state.realtime) {
    await supabase.removeChannel(state.realtime);
    state.realtime = null;
  }
  state.user = null;
  state.profile = null;
  state.activeId = null;
  state.conversations = [];
  state.messages.clear();
  showAuth();
}

$('authSwitch').addEventListener('click', () => setAuthMode(state.mode === 'signin' ? 'signup' : 'signin'));

$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const email = $('emailInput').value.trim();
  const password = $('passwordInput').value;
  const displayName = $('nameInput').value.trim();
  $('authSubmit').disabled = true;
  setMessage($('authMessage'), '', false);

  try {
    if (state.mode === 'signup') {
      if (!displayName) throw new Error('Enter a display name.');
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } }
      });
      if (error) throw error;

      if (data.session?.user) {
        await bootstrap(data.session.user);
        return;
      }

      // msngr intentionally has no email-verification flow.
      // If Supabase is still configured to require confirmation, a session will
      // not be returned. Try a direct password sign-in so the UI stays aligned
      // with the intended instant-signup behavior.
      const signedIn = await supabase.auth.signInWithPassword({ email, password });
      if (signedIn.error) {
        throw new Error('Instant signup is currently blocked by the Supabase Auth project setting.');
      }
      await bootstrap(signedIn.data.user);
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await bootstrap(data.user);
    }
  } catch (error) {
    setMessage($('authMessage'), error.message || 'Authentication failed.', true);
  } finally {
    $('authSubmit').disabled = false;
  }
});

$('newChatButton').addEventListener('click', () => openModal('newChatModal'));
$('emptyNewChat').addEventListener('click', () => openModal('newChatModal'));
$('profileButton').addEventListener('click', () => openModal('profileModal'));
document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
$('modalBackdrop').addEventListener('click', (event) => {
  if (event.target === $('modalBackdrop')) closeModal();
});

$('newChatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('newChatEmail').value.trim();
  setMessage($('newChatMessage'), '', false);
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const { data, error } = await supabase.rpc('start_direct_conversation', { target_email: email });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.conversation_id) throw new Error('No account found with that email.');
    $('newChatEmail').value = '';
    closeModal();
    await loadInbox();
    await openConversation(row.conversation_id);
  } catch (error) {
    setMessage($('newChatMessage'), error.message || 'Could not start conversation.', true);
  } finally {
    submit.disabled = false;
  }
});

$('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('profileName').value.trim();
  if (!name) return;
  const { data, error } = await supabase.from('profiles').update({ display_name: name }).eq('id', state.user.id).select('id,email,display_name').single();
  if (error) {
    showToast(error.message || 'Could not update profile');
    return;
  }
  state.profile = data;
  $('meName').textContent = data.display_name;
  $('meAvatar').textContent = initials(data.display_name);
  closeModal();
  showToast('Profile updated');
});

$('signOutButton').addEventListener('click', async () => {
  await supabase.auth.signOut();
  await teardown();
});

$('chatSearch').addEventListener('input', renderConversations);

$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = $('messageInput').value.trim();
  if (!body || !state.activeId) return;
  $('sendButton').disabled = true;
  try {
    const { data, error } = await supabase.rpc('send_message', {
      p_conversation_id: state.activeId,
      p_body: body
    });
    if (error) throw error;
    const message = Array.isArray(data) ? data[0] : data;
    $('messageInput').value = '';
    $('messageInput').style.height = '44px';
    if (message) mergeIncoming(message);
  } catch (error) {
    showToast(error.message || 'Message could not be sent');
  } finally {
    $('sendButton').disabled = false;
    $('messageInput').focus();
  }
});

$('messageInput').addEventListener('input', () => {
  const input = $('messageInput');
  input.style.height = '44px';
  input.style.height = Math.min(input.scrollHeight, 130) + 'px';
});

$('messageInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});

$('loadOlderButton').addEventListener('click', async () => {
  if (!state.activeId || !state.hasOlder) return;
  $('loadOlderButton').disabled = true;
  const scroller = $('messageScroller');
  const oldHeight = scroller.scrollHeight;
  try {
    await loadMessages(state.activeId, true);
    requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight - oldHeight; });
  } catch (error) {
    showToast(error.message || 'Could not load older messages');
  } finally {
    $('loadOlderButton').disabled = false;
  }
});

$('mobileBack').addEventListener('click', () => $('appView').classList.remove('chat-open'));

async function start() {
  setAuthMode('signin');
  if (!configured) {
    $('configError').classList.remove('hidden');
    $('authSubmit').disabled = true;
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    try {
      await bootstrap(data.session.user);
    } catch (error) {
      showAuth();
      setMessage($('authMessage'), error.message || 'Could not load your account.', true);
    }
  } else {
    showAuth();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !session) teardown();
  });
}

start();
