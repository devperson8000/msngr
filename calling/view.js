const icons = {
 mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
 camera: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4"/>',
 screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4m-3-11 3-3 3 3M12 7v6"/>',
 chat: '<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 9h8M8 13h5"/>',
 phone: '<path d="M5 14v5H2v-7c5-6 15-6 20 0v7h-3v-5l-4-2H9l-4 2Z"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
const elapsed = time => { const n = Math.max(0, Math.floor((Date.now() - time) / 1000)); return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`; };

export function mountCallView(engine, root) {
  root.innerHTML = `<div class="call-overlay hidden"><section class="call-dialog" role="dialog" aria-modal="true" aria-labelledby="callPeer" tabindex="-1">
    <header class="call-heading"><div><p class="eyebrow">MSNGR CALL</p><h2 id="callPeer"></h2><p class="call-status" role="status" aria-live="polite"></p></div><span class="call-timer" aria-label="Call duration">00:00</span></header>
    <div class="call-body"><div class="call-stage">
      <div class="call-camera-tile"><video class="call-remote-video" autoplay playsinline muted></video><div class="call-person"><span class="call-avatar"></span><p class="call-person-label"></p></div><span class="call-peer-label"></span></div>
      <div class="call-screen-tile hidden"><video class="call-remote-screen" autoplay playsinline muted></video><span>Contact’s screen</span></div>
      <div class="call-self-tile"><video class="call-local-video" autoplay playsinline muted></video><span class="call-self-placeholder">Camera off</span><span class="call-self-label">You</span></div>
      <div class="call-sharing-note hidden">You’re sharing your screen <button class="call-stop-sharing" type="button">Stop sharing</button></div>
      <audio class="call-audio" autoplay></audio><button class="call-enable-audio hidden" type="button">Tap to enable call audio</button>
    </div><aside class="call-chat hidden" aria-label="In-call chat"><header><strong>In-call chat</strong><span>Only during this call</span></header><div class="call-chat-log" role="log" aria-live="polite" aria-relevant="additions"></div><form class="call-chat-form"><label class="sr-only" for="callChatInput">Message your contact</label><textarea id="callChatInput" rows="2" maxlength="4000" placeholder="Say something…"></textarea><button type="submit">Send</button></form></aside></div>
    <p class="call-error hidden" role="alert"></p><div class="call-incoming hidden"><button class="call-decline" type="button">Decline</button><button class="call-accept" type="button">Accept call</button></div>
    <footer class="call-controls"><button class="call-mic" type="button">${svg('mic')}<span>Mute</span></button><button class="call-camera" type="button">${svg('camera')}<span>Camera</span></button><button class="call-share" type="button">${svg('screen')}<span>Share screen</span></button><button class="call-chat-toggle" type="button" aria-expanded="false">${svg('chat')}<span>Chat</span></button><button class="call-hangup" type="button">${svg('phone')}<span>End call</span></button></footer>
    <div class="call-ended hidden"><button class="call-dismiss" type="button">Close</button></div><p class="call-footer-note">Encrypted peer-to-peer media · No recording</p>
  </section></div>`;
  const $ = selector => root.querySelector(selector);
  let timer, priorFocus, visible = false, lastId, chatOpen = false;
  const run = fn => Promise.resolve().then(fn).catch(e => engine.emit({ error: e.message || 'Please try again.' }));
  $('.call-mic').onclick = () => engine.toggleMic();
  $('.call-camera').onclick = () => run(() => engine.toggleCamera());
  $('.call-share').onclick = () => run(() => engine.toggleScreen());
  $('.call-stop-sharing').onclick = () => run(() => engine.toggleScreen());
  $('.call-hangup').onclick = () => engine.end();
  $('.call-decline').onclick = () => engine.end('declined');
  $('.call-accept').onclick = () => run(() => engine.accept());
  $('.call-dismiss').onclick = () => engine.dismiss();
  $('.call-chat-toggle').onclick = () => { chatOpen = !chatOpen; render(); if (chatOpen) $('#callChatInput').focus(); };
  $('.call-enable-audio').onclick = () => $('.call-audio').play().then(() => $('.call-enable-audio').classList.add('hidden')).catch(() => {});
  $('.call-chat-form').onsubmit = e => { e.preventDefault(); try { engine.sendChat($('#callChatInput').value); $('#callChatInput').value = ''; } catch (error) { engine.emit({ error: error.message }); } };
  $('#callChatInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.call-chat-form').requestSubmit(); } };
  const keydown = e => {
    if (!visible) return;
    if (e.key === 'Escape' && engine.snapshot().phase === 'ended') { engine.dismiss(); return; }
    if (e.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button:not(:disabled),textarea:not(:disabled)')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement) || document.activeElement === $('.call-dialog'))) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keydown, true);
  function attach(video, stream) {
    if (video.srcObject !== stream) { video.srcObject = stream; if (stream) video.play().catch(() => {}); }
  }
  function render() {
    const s = engine.snapshot(), shown = s.phase !== 'idle', incoming = s.phase === 'incoming', ended = s.phase === 'ended';
    $('.call-overlay').classList.toggle('hidden', !shown);
    const app = document.getElementById('appView'); if (app) app.inert = shown;
    if (shown && !visible) { priorFocus = document.activeElement; queueMicrotask(() => (incoming ? $('.call-accept') : $('.call-dialog')).focus()); }
    if (!shown && visible) { priorFocus?.focus?.(); clearInterval(timer); timer = null; }
    visible = shown;
    if (s.id !== lastId) { lastId = s.id; $('.call-chat-log').replaceChildren(); chatOpen = false; }
    if (shown && !timer) timer = setInterval(() => { const st = engine.snapshot(); $('.call-timer').textContent = st.connectedAt ? elapsed(st.connectedAt) : '00:00'; }, 1000);
    if (ended) { clearInterval(timer); timer = null; }
    $('#callPeer').textContent = s.peerName || 'Call';
    $('.call-avatar').textContent = initials(s.peerName);
    $('.call-peer-label').textContent = `${s.peerName || 'Contact'}${s.remoteMic === false ? ' · Mic muted' : ''}`;
    const labels = { preparing: 'Getting your devices ready…', incoming: `Incoming ${s.kind === 'video' ? 'video' : 'voice'} call`, ringing: 'Ringing…', connecting: 'Connecting securely…', connected: s.quality || 'Connected', reconnecting: 'Reconnecting…', ended: ({ declined: 'Call declined', decline: 'Call declined', busy: 'Contact is in another call', 'no-answer': 'No answer', failed: 'Call could not connect' })[s.reason] || 'Call ended' };
    $('.call-status').textContent = labels[s.phase] || '';
    $('.call-person-label').textContent = incoming ? 'Ready when you are.' : ended ? 'See you next time.' : s.phase === 'ringing' ? 'Waiting for your contact…' : s.remoteCamera ? '' : 'Camera off · Still together';
    $('.call-person').classList.toggle('hidden', s.remoteCamera && ['connected', 'reconnecting'].includes(s.phase));
    $('.call-remote-video').classList.toggle('hidden', !s.remoteCamera || !['connected', 'reconnecting'].includes(s.phase));
    $('.call-local-video').classList.toggle('hidden', !s.camera);
    $('.call-self-placeholder').classList.toggle('hidden', s.camera);
    $('.call-self-label').textContent = `You${!s.mic ? ' · Muted' : ''}`;
    $('.call-self-tile').classList.toggle('hidden', incoming || ended || !s.localStream);
    $('.call-screen-tile').classList.toggle('hidden', !s.remoteScreen);
    $('.call-stage').classList.toggle('has-screen', Boolean(s.remoteScreen));
    $('.call-sharing-note').classList.toggle('hidden', !s.screen);
    attach($('.call-local-video'), s.localStream); attach($('.call-remote-video'), s.remoteStream); attach($('.call-remote-screen'), s.remoteScreenStream);
    const audio = $('.call-audio');
    if (audio.srcObject !== s.remoteStream) { audio.srcObject = s.remoteStream; if (s.remoteStream) audio.play().catch(() => { if (engine.snapshot().phase !== 'ended') $('.call-enable-audio').classList.remove('hidden'); }); }
    if (ended || !shown) $('.call-enable-audio').classList.add('hidden');
    $('.call-incoming').classList.toggle('hidden', !incoming); $('.call-ended').classList.toggle('hidden', !ended);
    $('.call-controls').classList.toggle('hidden', incoming || ended);
    const canControl = !!s.localStream && ['ringing', 'connecting', 'connected', 'reconnecting'].includes(s.phase);
    $('.call-mic').disabled = !canControl; $('.call-camera').disabled = !canControl;
    $('.call-share').disabled = !['connected', 'reconnecting'].includes(s.phase);
    $('.call-mic').setAttribute('aria-pressed', String(!s.mic)); $('.call-mic').setAttribute('aria-label', s.mic ? 'Mute microphone' : 'Unmute microphone'); $('.call-mic span').textContent = s.mic ? 'Mute' : 'Unmute';
    $('.call-camera').setAttribute('aria-pressed', String(s.camera)); $('.call-camera').setAttribute('aria-label', s.camera ? 'Turn camera off' : 'Turn camera on'); $('.call-camera span').textContent = s.camera ? 'Camera off' : 'Camera on';
    $('.call-share').setAttribute('aria-pressed', String(s.screen)); $('.call-share span').textContent = s.screen ? 'Stop sharing' : 'Share screen';
    $('.call-chat-toggle').setAttribute('aria-expanded', String(chatOpen));
    $('.call-chat').classList.toggle('hidden', !chatOpen || incoming || ended); $('.call-dialog').classList.toggle('with-chat', chatOpen && !ended && !incoming);
    $('#callChatInput').disabled = !s.chatReady; $('.call-chat-form button').disabled = !s.chatReady;
    $('.call-error').textContent = s.error || ''; $('.call-error').classList.toggle('hidden', !s.error);
  }
  function appendChat(message) {
    const row = document.createElement('div'); row.className = 'call-chat-message' + (message.mine ? ' mine' : '');
    const label = document.createElement('small'); label.textContent = message.mine ? 'You' : engine.snapshot().peerName || 'Contact';
    const text = document.createElement('p'); text.textContent = message.text; row.append(label, text);
    const log = $('.call-chat-log'); log.append(row); while (log.children.length > 200) log.firstChild.remove(); log.scrollTop = log.scrollHeight;
  }
  return { render, appendChat, destroy() { clearInterval(timer); document.removeEventListener('keydown', keydown, true); const app=document.getElementById('appView'); if(app)app.inert=false; root.replaceChildren(); } };
}
