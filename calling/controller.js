import { CallEngine } from './engine.js';
import { CallTransport } from './transport.js';
import { mountCallView } from './view.js';

export function createCalling({ supabase, getUser, notify }) {
  const root = document.createElement('div'); root.id = 'callRoot'; document.body.append(root);
  let view, generation = 0, contexts = new Map(), loading = new Map(), transport, ownerId;
  const engine = new CallEngine({ send: (context, signal) => transport.send(context, signal),
    onChange: () => view?.render(), onChat: message => view?.appendChat(message), getIceServers: loadIce });
  view = mountCallView(engine, root); view.render();
  function makeTransport() {
    return new CallTransport(supabase, { onSignal: (context, signal) => engine.receive(context, signal),
      onError: (error, context) => { if (engine.session?.context.conversationId === context.conversationId && engine.alive(engine.session)) engine.fail(engine.session, error); } });
  }
  transport = supabase ? makeTransport() : null;
  async function loadIce() {
    const custom = import.meta.env.VITE_WEBRTC_ICE_SERVERS;
    if (import.meta.env.DEV && custom) {
      const servers = JSON.parse(custom);
      if (!Array.isArray(servers) || !servers.length || servers.some(s => !s.urls)) throw new Error('Invalid calling ICE configuration.');
      return servers;
    }
    const { data, error } = await supabase.auth.getSession(); if (error || !data.session) throw new Error('Sign in again to start a call.');
    const response = await fetch('/api/ice', { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      if (import.meta.env.DEV) {
        engine.emit({ error: 'No TURN relay is configured locally. Calls on restrictive networks may fail.' });
        return [{ urls: 'stun:stun.l.google.com:19302' }];
      }
      throw new Error('Calling relay endpoint is missing. Please check deployment.');
    }
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.iceServers)) throw new Error(result.error || 'Could not load calling relay configuration.');
    if (!result.relayConfigured) engine.emit({ error: 'No TURN relay is configured. Calls on restrictive networks may fail.' });
    return result.iceServers;
  }
  async function contextFor(conversation) {
    const user = getUser(); if (!user || !supabase || conversation.kind !== 'direct') throw new Error('Calling is available in direct conversations with contacts.');
    const saved = contexts.get(conversation.id); if (saved?.selfId === user.id) { saved.peerName = conversation.name; return saved; }
    if (loading.has(conversation.id)) return loading.get(conversation.id);
    const epoch = generation;
    const pending = (async () => {
      const { data, error } = await supabase.rpc('get_conversation_members', { p_conversation_id: conversation.id });
      if (error) throw new Error('Could not load call participants. Please reconnect and try again.');
      if (generation !== epoch || getUser()?.id !== user.id) throw new Error('Your session changed. Please try again.');
      const members = data || [], self = members.find(m => m.user_id === user.id), peers = members.filter(m => m.user_id !== user.id);
      if (!self || members.length !== 2 || peers.length !== 1) throw new Error('Calls need a direct conversation with two members.');
      const context = { conversationId: conversation.id, selfId: user.id, peerId: peers[0].user_id, peerName: peers[0].display_name || conversation.name };
      contexts.set(conversation.id, context); transport.sync([...contexts.values()]); return context;
    })().finally(() => { if (loading.get(conversation.id) === pending) loading.delete(conversation.id); });
    loading.set(conversation.id, pending); return pending;
  }
  async function refresh(conversations) {
    if (!getUser() || !supabase) return;
    if (ownerId !== getUser().id) {
      generation++; contexts.clear(); loading.clear(); void transport?.destroy(); transport = makeTransport(); ownerId = getUser().id;
    }
    const ids = new Set(conversations.filter(c => c.kind === 'direct').map(c => c.id));
    for (const id of contexts.keys()) if (!ids.has(id)) contexts.delete(id);
    if (engine.session && engine.alive(engine.session) && !ids.has(engine.session.context.conversationId)) engine.end();
    transport.sync([...contexts.values()]);
    const queue = conversations.filter(c => c.kind === 'direct');
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && getUser()?.id === ownerId) { const conversation = queue.shift(); try { await contextFor(conversation); } catch { /* Starting a call reports participant errors; messaging remains available. */ } }
    }));
  }
  async function start(conversation, kind) {
    if (!conversation) return;
    try { const context = await contextFor(conversation); await engine.start(context, kind); } catch (error) { notify(error.message); }
  }
  async function destroy() {
    engine.end(); engine.dismiss(); generation++; contexts.clear(); loading.clear(); ownerId = null;
    await transport?.destroy(); transport = supabase ? makeTransport() : null;
  }
  const unload = () => engine.end(); window.addEventListener('pagehide', unload);
  return { refresh, start, destroy, engine };
}
