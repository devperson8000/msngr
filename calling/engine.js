const ACTIVE = new Set(['preparing', 'incoming', 'ringing', 'connecting', 'connected', 'reconnecting']);
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' };
const stop = stream => stream?.getTracks().forEach(track => track.stop());
const validText = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 4000 && new TextEncoder().encode(text).length <= 12000;

export class CallEngine {
  constructor({ send, onChange = () => {}, onChat = () => {}, mediaDevices = navigator.mediaDevices,
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }], getIceServers } = {}) {
    Object.assign(this, { send, onChange, onChat, mediaDevices, iceServers, getIceServers });
    this.state = { phase: 'idle', camera: false, mic: true, screen: false, remoteCamera: false, remoteScreen: false, remoteMic: true, error: '', quality: '' };
    this.seenCalls = new Map();
    this.session = null; this.pc = null; this.localStream = null; this.screenStream = null;
    this.remoteStream = null; this.remoteScreenStream = null; this.channel = null;
  }
  snapshot() { return { ...this.state, chatReady: this.channel?.readyState === 'open', localStream: this.localStream,
    screenStream: this.screenStream, remoteStream: this.remoteStream, remoteScreenStream: this.remoteScreenStream }; }
  emit(patch = {}) { Object.assign(this.state, patch); this.onChange(this.snapshot()); }
  alive(s) { return this.session === s && ACTIVE.has(this.state.phase); }
  newSession(context, kind, id, role) {
    const now = Date.now();
    for (const [key, time] of this.seenCalls) if (now - time > 90000) this.seenCalls.delete(key);
    this.seenCalls.set(`${context.selfId}:${context.conversationId}:${id}`, now);
    while (this.seenCalls.size > 256) this.seenCalls.delete(this.seenCalls.keys().next().value);
    this.session = { context: { ...context }, kind, id, role, candidates: [], offerHandled: false, restarted: false, mediaBusy: false, messages: [] };
    this.state = { phase: role === 'caller' ? 'preparing' : 'incoming', id, kind, peerName: context.peerName,
      camera: false, mic: true, screen: false, remoteCamera: kind === 'video', remoteScreen: false, remoteMic: true,
      error: '', quality: '', connectedAt: null, reason: '' };
    this.emit(); return this.session;
  }
  async signal(s, type, extra = {}) {
    if (!this.alive(s) && !['bye', 'decline', 'busy'].includes(type)) return;
    await this.send(s.context, { version: 1, id: s.id, from: s.context.selfId, to: s.context.peerId,
      type, sentAt: Date.now(), ...extra });
  }
  timeout(s) {
    clearTimeout(this.ringTimer);
    this.ringTimer = setTimeout(() => { if (this.alive(s) && ['incoming', 'ringing'].includes(this.state.phase)) this.end('no-answer'); }, 45000);
  }
  async start(context, kind = 'audio') {
    if (ACTIVE.has(this.state.phase)) return;
    if (!globalThis.RTCPeerConnection || !this.mediaDevices?.getUserMedia) {
      this.emit({ phase: 'ended', error: 'Calling requires a supported browser and HTTPS.' }); return;
    }
    const s = this.newSession(context, kind, crypto.randomUUID(), 'caller');
    try {
      await this.prepare(s);
      if (!this.alive(s)) return;
      this.emit({ phase: 'ringing' }); this.timeout(s);
      await this.signal(s, 'invite', { kind });
    } catch (e) { this.fail(s, e); }
  }
  async prepare(s) {
    const stream = await this.mediaDevices.getUserMedia({ audio: AUDIO, video: s.kind === 'video' ? CAMERA : false });
    if (!this.alive(s)) { stop(stream); return; }
    this.localStream = stream;
    const servers = this.getIceServers ? await this.getIceServers() : this.iceServers;
    if (!this.alive(s)) return;
    const pc = this.pc = new RTCPeerConnection({ iceServers: servers, bundlePolicy: 'max-bundle' });
    this.remoteStream = new MediaStream(); this.remoteScreenStream = new MediaStream();
    this.audioSender = pc.addTransceiver(stream.getAudioTracks()[0], { direction: 'sendrecv', streams: [stream] }).sender;
    this.cameraSender = pc.addTransceiver(stream.getVideoTracks()[0] || 'video', { direction: 'sendrecv', streams: [stream] }).sender;
    this.screenSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    pc.onicecandidate = ({ candidate }) => { if (candidate && this.alive(s)) this.signal(s, 'ice', { candidate: candidate.toJSON() }).catch(e => this.fail(s, e)); };
    pc.ontrack = e => {
      if (!this.alive(s)) return;
      const index = pc.getTransceivers().indexOf(e.transceiver);
      const target = index === 2 ? this.remoteScreenStream : this.remoteStream;
      if (!target.getTracks().some(t => t.id === e.track.id)) target.addTrack(e.track);
      this.emit();
    };
    pc.onconnectionstatechange = () => this.connectionChanged(s, pc);
    pc.oniceconnectionstatechange = () => {
      if (this.alive(s) && this.state.phase === 'reconnecting' && ['connected', 'completed'].includes(pc.iceConnectionState)) this.connectionChanged(s, pc);
    };
    pc.ondatachannel = e => { if (this.alive(s)) this.setupChannel(s, e.channel); };
    if (s.role === 'caller') this.setupChannel(s, pc.createDataChannel('msngr-call', { ordered: true }));
    this.emit({ camera: stream.getVideoTracks().length > 0 });
    await this.tune(this.cameraSender, 1800000, 'maintain-framerate');
  }
  async tune(sender, bitrate, degradationPreference) {
    if (!sender?.track) return;
    try {
      const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = bitrate; p.degradationPreference = degradationPreference;
      await sender.setParameters(p);
    } catch { /* Browsers without sender parameter support retain adaptive defaults. */ }
  }
  async receive(context, message) {
    if (!message || message.from !== context.peerId || message.to !== context.selfId || typeof message.id !== 'string' || message.id.length > 64) return;
    if (message.version !== 1 || !Number.isFinite(message.sentAt) || Math.abs(Date.now() - message.sentAt) > 90000) return;
    if (message.type === 'invite') {
      if (this.seenCalls.has(`${context.selfId}:${context.conversationId}:${message.id}`)) return;
      if (!['audio', 'video'].includes(message.kind)) return;
      if (ACTIVE.has(this.state.phase)) {
        if (this.session.id === message.id) return;
        await this.send(context, { version: 1, type: 'busy', id: message.id, from: context.selfId, to: context.peerId, sentAt: Date.now() }); return;
      }
      const s = this.newSession(context, message.kind, message.id, 'callee'); this.timeout(s); return;
    }
    const s = this.session;
    if (!s || !this.alive(s) || s.id !== message.id || s.context.conversationId !== context.conversationId || s.context.peerId !== message.from) return;
    try {
      if (['bye', 'decline', 'busy'].includes(message.type)) { this.finish(s, message.type === 'bye' ? 'ended' : message.type); return; }
      if (message.type === 'accept' && s.role === 'caller' && this.state.phase === 'ringing') {
        clearTimeout(this.ringTimer); this.emit({ phase: 'connecting' }); this.connectionTimeout(s);
        const offer = await this.pc.createOffer(); if (!this.alive(s)) return;
        await this.pc.setLocalDescription(offer); if (!this.alive(s)) return;
        await this.signal(s, 'offer', { description: this.pc.localDescription.toJSON() });
      } else if (message.type === 'offer' && s.role === 'callee' && this.pc && ['connecting', 'connected', 'reconnecting'].includes(this.state.phase)) {
        if (message.description?.type !== 'offer' || typeof message.description.sdp !== 'string' || message.description.sdp.length > 64000) return;
        if (s.offerHandled && this.state.phase === 'connecting') return;
        s.offerHandled = true;
        await this.pc.setRemoteDescription(message.description); if (!this.alive(s)) return;
        await this.flushIce(s);
        const answer = await this.pc.createAnswer(); if (!this.alive(s)) return;
        await this.pc.setLocalDescription(answer); if (!this.alive(s)) return;
        await this.signal(s, 'answer', { description: this.pc.localDescription.toJSON() });
      } else if (message.type === 'answer' && s.role === 'caller' && this.pc?.signalingState === 'have-local-offer') {
        if (message.description?.type !== 'answer' || typeof message.description.sdp !== 'string' || message.description.sdp.length > 64000) return;
        await this.pc.setRemoteDescription(message.description); if (!this.alive(s)) return;
        await this.flushIce(s);
        if (this.alive(s) && this.state.phase === 'reconnecting' && this.pc.connectionState === 'connected') this.connectionChanged(s, this.pc);
      } else if (message.type === 'ice' && message.candidate && typeof message.candidate.candidate === 'string' && message.candidate.candidate.length < 4096) {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
        else if (s.candidates.length < 128) s.candidates.push(message.candidate);
      }
    } catch (e) { this.fail(s, e); }
  }
  async flushIce(s) {
    for (const candidate of s.candidates.splice(0)) { if (!this.alive(s)) return; await this.pc.addIceCandidate(candidate); }
  }
  async accept() {
    if (this.state.phase !== 'incoming') return;
    const s = this.session; clearTimeout(this.ringTimer); this.emit({ phase: 'preparing' });
    try {
      await this.prepare(s); if (!this.alive(s)) return;
      this.emit({ phase: 'connecting' }); this.connectionTimeout(s); await this.signal(s, 'accept');
    } catch (e) { this.fail(s, e); }
  }
  connectionTimeout(s) {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => this.fail(s, new Error('Could not connect. Try another network or check the TURN relay configuration.')), 25000);
  }
  connectionChanged(s, pc) {
    if (!this.alive(s)) return;
    if (pc.connectionState === 'connected') {
      clearTimeout(this.connectTimer); clearTimeout(this.disconnectTimer);
      this.emit({ phase: 'connected', connectedAt: this.state.connectedAt || Date.now(), error: '' });
      if (!this.statsTimer) this.statsTimer = setInterval(() => this.measure(s), 3000);
    } else if (pc.connectionState === 'disconnected') {
      this.emit({ phase: 'reconnecting' });
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(async () => {
        if (!this.alive(s)) return;
        if (s.role === 'caller' && !s.restarted) {
          s.restarted = true;
          try {
            const offer = await pc.createOffer({ iceRestart: true }); if (!this.alive(s)) return;
            await pc.setLocalDescription(offer); if (!this.alive(s)) return;
            await this.signal(s, 'offer', { description: pc.localDescription.toJSON() });
          } catch (e) { this.fail(s, e); return; }
        }
        this.connectionTimeout(s);
      }, 3000);
    } else if (pc.connectionState === 'failed') this.fail(s, new Error('Connection lost. Try another network or check the TURN relay configuration.'));
  }
  async measure(s) {
    if (!this.alive(s) || !this.pc) return;
    try {
      const stats = await this.pc.getStats(); if (!this.alive(s)) return;
      let rtt, loss = 0;
      for (const r of stats.values()) {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) rtt = r.currentRoundTripTime;
        if (r.type === 'inbound-rtp' && r.packetsReceived) loss = Math.max(loss, Math.max(0, r.packetsLost || 0) / (r.packetsReceived + Math.max(0, r.packetsLost || 0)));
      }
      this.emit({ quality: loss > .05 || rtt > .4 ? 'Unstable connection' : rtt == null ? 'Connected' : `Connected · ${Math.round(rtt * 1000)} ms` });
    } catch { /* A peer may close between the timer and getStats. */ }
  }
  setupChannel(s, channel) {
    this.channel = channel;
    channel.onopen = () => { if (this.alive(s)) { this.sendMedia(); this.emit(); } };
    channel.onclose = () => { if (this.alive(s)) this.emit(); };
    channel.onmessage = ({ data }) => {
      if (!this.alive(s) || typeof data !== 'string' || data.length > 16000) return;
      try {
        const m = JSON.parse(data);
        if (m.type === 'media') this.emit({ remoteCamera: m.camera === true, remoteScreen: m.screen === true, remoteMic: m.mic !== false });
        else if (m.type === 'chat' && validText(m.text)) {
          const now = Date.now(); s.messages = s.messages.filter(t => now - t < 1000);
          if (s.messages.length >= 10) return; s.messages.push(now);
          this.onChat({ text: m.text, mine: false, time: now });
        }
      } catch { /* Ignore malformed peer data. */ }
    };
  }
  sendMedia() {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'media', camera: this.state.camera, mic: this.state.mic, screen: this.state.screen }));
  }
  sendChat(text) {
    if (!validText(text)) throw new Error('Write a message of up to 4,000 characters / 12 KB.');
    if (this.channel?.readyState !== 'open') throw new Error('Chat will be available when the call connects.');
    if (this.channel.bufferedAmount > 65536) throw new Error('Chat is catching up. Please try again.');
    this.channel.send(JSON.stringify({ type: 'chat', text: text.trim() }));
    this.onChat({ text: text.trim(), mine: true, time: Date.now() });
  }
  toggleMic() {
    if (!this.localStream || !ACTIVE.has(this.state.phase)) return;
    const mic = !this.state.mic; this.localStream.getAudioTracks().forEach(t => { t.enabled = mic; });
    this.emit({ mic }); this.sendMedia();
  }
  async toggleCamera() {
    const s = this.session; if (!this.alive(s) || !this.pc || s.mediaBusy) return;
    s.mediaBusy = true;
    try {
      if (this.state.camera) {
        await this.cameraSender.replaceTrack(null); if (!this.alive(s)) return;
        this.localStream.getVideoTracks().forEach(t => { t.stop(); this.localStream.removeTrack(t); }); this.emit({ camera: false });
      } else {
        const stream = await this.mediaDevices.getUserMedia({ audio: false, video: CAMERA });
        if (!this.alive(s)) { stop(stream); return; }
        const track = stream.getVideoTracks()[0];
        try { await this.cameraSender.replaceTrack(track); } catch (e) { stop(stream); throw e; }
        if (!this.alive(s)) { stop(stream); return; }
        this.localStream.addTrack(track); track.onended = () => { if (this.alive(s)) { this.emit({ camera: false }); this.sendMedia(); } };
        await this.tune(this.cameraSender, 1800000, 'maintain-framerate');
        if (!this.alive(s) || track.readyState !== 'live' || !this.localStream?.getTracks().includes(track)) return;
        this.emit({ camera: true, error: '' });
      }
      this.sendMedia();
    } catch (e) { if (this.alive(s)) this.emit({ error: this.mediaError(e) }); }
    finally { s.mediaBusy = false; }
  }
  async toggleScreen() {
    const s = this.session; if (!this.alive(s) || !this.pc || s.screenBusy) return;
    if (!this.mediaDevices?.getDisplayMedia) { this.emit({ error: 'Screen sharing is not supported in this browser.' }); return; }
    s.screenBusy = true;
    try {
      if (this.screenStream) { await this.stopScreen(s); return; }
      const stream = await this.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } }, audio: false });
      if (!this.alive(s)) { stop(stream); return; }
      const track = stream.getVideoTracks()[0]; track.contentHint = 'detail';
      try { await this.screenSender.replaceTrack(track); } catch (e) { stop(stream); throw e; }
      if (!this.alive(s)) { stop(stream); return; }
      this.screenStream = stream;
      track.onended = () => { if (this.alive(s)) this.stopScreen(s).catch(e => this.emit({ error: this.mediaError(e) })); };
      await this.tune(this.screenSender, 3500000, 'maintain-resolution');
      if (!this.alive(s) || this.screenStream !== stream || track.readyState !== 'live') return;
      this.emit({ screen: true, error: '' }); this.sendMedia();
    } catch (e) { if (this.alive(s) && e.name !== 'NotAllowedError' && e.name !== 'AbortError') this.emit({ error: this.mediaError(e) }); }
    finally { s.screenBusy = false; }
  }
  async stopScreen(s) {
    const stream = this.screenStream, sender = this.screenSender;
    if (!this.alive(s) || !stream) return;
    await sender.replaceTrack(null);
    stop(stream);
    if (!this.alive(s) || this.screenStream !== stream) return;
    this.screenStream = null; this.emit({ screen: false }); this.sendMedia();
  }
  mediaError(e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'Allow microphone/camera permission in your browser, then try again.';
    if (e?.name === 'NotFoundError') return 'No microphone or camera was found. Connect a device and try again.';
    if (e?.name === 'NotReadableError') return 'Your microphone or camera is busy. Close other apps using it and try again.';
    return e?.message || 'Could not start calling. Please try again.';
  }
  fail(s, error) {
    if (!this.alive(s)) return;
    this.end('failed', this.mediaError(error));
  }
  end(reason = 'ended', error = '') {
    const s = this.session; if (!s || !this.alive(s)) return;
    const type = this.state.phase === 'incoming' ? 'decline' : 'bye';
    // Cleanup is immediate, even if signaling is disconnected or slow.
    const notification = this.signal(s, type);
    this.finish(s, reason, error); notification.catch(() => {});
  }
  finish(s, reason, error = '') {
    if (this.session !== s) return;
    for (const timer of ['ringTimer', 'connectTimer', 'disconnectTimer', 'statsTimer']) { clearTimeout(this[timer]); this[timer] = null; }
    this.channel?.close(); this.channel = null;
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.onicecandidate = null; this.pc.ontrack = null; this.pc.oniceconnectionstatechange = null; this.pc.close(); this.pc = null; }
    stop(this.localStream); stop(this.screenStream); stop(this.remoteStream); stop(this.remoteScreenStream);
    this.localStream = this.screenStream = this.remoteStream = this.remoteScreenStream = null;
    s.candidates = [];
    this.emit({ phase: 'ended', reason, error, camera: false, screen: false, remoteCamera: false, remoteScreen: false });
  }
  dismiss() { if (!ACTIVE.has(this.state.phase)) this.emit({ phase: 'idle', error: '' }); }
}
