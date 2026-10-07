export class CallTransport {
  constructor(client, { onSignal, onError = () => {}, readyTimeout = 10000 }) {
    Object.assign(this, { client, onSignal, onError, readyTimeout }); this.entries = new Map(); this.closed = false;
  }
  sync(contexts) {
    if (this.closed) return;
    const desired = new Set(contexts.map(c => c.conversationId));
    for (const [id, entry] of this.entries) if (!desired.has(id)) this.remove(id, entry);
    for (const context of contexts) {
      const existing = this.entries.get(context.conversationId);
      if (existing) { existing.context = context; continue; }
      let resolve, reject;
      const ready = new Promise((yes, no) => { resolve = yes; reject = no; }); ready.catch(() => {});
      const entry = { context, ready, resolve, reject, subscribed: false, disposed: false };
      this.entries.set(context.conversationId, entry);
      const unavailable = () => new Error('Private call signaling is unavailable. Check the Supabase calling migration and Realtime access.');
      entry.timer = setTimeout(() => { if (!entry.subscribed && !entry.disposed) { entry.reject(unavailable()); this.onError(unavailable(), entry.context); } }, this.readyTimeout);
      entry.channel = this.client.channel(`call:${context.conversationId}`, { config: { private: true, broadcast: { ack: true, self: false } } })
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          if (!entry.disposed && entry.subscribed) Promise.resolve(this.onSignal(entry.context, payload)).catch(e => this.onError(e, entry.context));
        })
        .subscribe(status => {
          if (entry.disposed) return;
          if (status === 'SUBSCRIBED') { entry.subscribed = true; clearTimeout(entry.timer); entry.resolve(); }
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            entry.subscribed = false; clearTimeout(entry.timer); const error = unavailable(); entry.reject(error); this.onError(error, entry.context);
          }
        });
    }
  }
  async send(context, signal) {
    const entry = this.entries.get(context.conversationId);
    if (this.closed || !entry || entry.disposed) throw new Error('Private call signaling is not available for this conversation.');
    if (!entry.subscribed) await entry.ready;
    if (!entry.subscribed || entry.disposed) throw new Error('Private call signaling is disconnected. Try again when it reconnects.');
    const result = await entry.channel.send({ type: 'broadcast', event: 'signal', payload: signal });
    if (result !== 'ok') throw new Error('Could not deliver call signaling. Check your connection and try again.');
  }
  remove(id, entry) {
    entry.disposed = true; entry.subscribed = false; clearTimeout(entry.timer); entry.reject(new Error('Call signaling closed.'));
    this.entries.delete(id); Promise.resolve(this.client.removeChannel(entry.channel)).catch(() => {});
  }
  async destroy() { this.closed = true; for (const [id, entry] of this.entries) this.remove(id, entry); }
}
