import { createHmac } from 'node:crypto';
const STUN = { urls: 'stun:stun.l.google.com:19302' };
export function buildIceServers(userId, env = process.env, now = Math.floor(Date.now() / 1000)) {
  const servers = [STUN];
  if (!env.TURN_URLS && !env.TURN_SHARED_SECRET) return servers;
  if (!env.TURN_URLS || !env.TURN_SHARED_SECRET) throw new Error('Both TURN_URLS and TURN_SHARED_SECRET are required.');
  const urls = env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length || urls.some(u => !/^turns?:[a-zA-Z0-9.\-[\]:]+(?:\?transport=(?:udp|tcp))?$/.test(u))) throw new Error('Invalid TURN URLs.');
  const username = `${now + 3600}:${userId}`;
  const credential = createHmac('sha1', env.TURN_SHARED_SECRET).update(username).digest('base64');
  return [...servers, { urls, username, credential }];
}
const CLOUDFLARE_KEY_ID = '8733114e9477d352db7d0f2d85958fdd';
const CLOUDFLARE_TTL = 86400;
const isRelay = url => /^turns?:/i.test(url);

export async function getCloudflareIceServers({ keyId = CLOUDFLARE_KEY_ID, token, fetcher = fetch }) {
  if (!token || !/^[a-f0-9]{32}$/i.test(keyId)) throw new Error('Cloudflare TURN configuration is missing or invalid.');
  const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: CLOUDFLARE_TTL }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Cloudflare TURN credentials are unavailable.');
  let data;
  try { data = await response.json(); } catch { throw new Error('Cloudflare TURN returned an invalid response.'); }
  if (!Array.isArray(data?.iceServers) || !data.iceServers.length) throw new Error('Cloudflare TURN returned no ICE servers.');
  const servers = [];
  for (const server of data.iceServers) {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.some(url => typeof url !== 'string' || !/^(?:stun|stuns|turn|turns):[a-z0-9.:[\]\-]+(?:\?transport=(?:udp|tcp))?$/i.test(url))) {
      throw new Error('Cloudflare TURN returned invalid ICE servers.');
    }
    // Port 53 is blocked by browsers. Keep UDP, TCP and TLS alternatives.
    const usable = urls.filter(url => !/:53(?:\?|$)/.test(url));
    if (!usable.length) continue;
    const entry = { urls: usable };
    if (usable.some(isRelay)) {
      if (typeof server.username !== 'string' || !server.username || typeof server.credential !== 'string' || !server.credential) {
        throw new Error('Cloudflare TURN returned missing temporary credentials.');
      }
      entry.username = server.username; entry.credential = server.credential;
    }
    servers.push(entry);
  }
  if (!servers.some(server => server.urls.some(isRelay))) throw new Error('Cloudflare TURN returned no usable relay servers.');
  return servers;
}

export function createIceHandler({ env = process.env, fetcher = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.' }); }
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization) || authorization.length > 8192) return res.status(401).json({ error: 'Sign in to use calling.' });
    const url = env.VITE_SUPABASE_URL || 'https://uglcxkakkilfndubgrac.supabase.co';
    const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B2ff1Bo8K9CR7UIY5c6deA_v1TWwayF';
    try {
      const auth = await fetcher(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, signal: AbortSignal.timeout(8000) });
      if (!auth.ok) return res.status(auth.status >= 500 ? 503 : 401).json({ error: 'Could not verify your session. Sign in again.' });
      const user = await auth.json(); if (!user.id || typeof user.id !== 'string') return res.status(401).json({ error: 'Invalid session.' });
      const cloudflare = Boolean(env.CLOUDFLARE_TURN_API_TOKEN);
      const iceServers = cloudflare
        ? await getCloudflareIceServers({ keyId: env.CLOUDFLARE_TURN_KEY_ID || CLOUDFLARE_KEY_ID, token: env.CLOUDFLARE_TURN_API_TOKEN, fetcher })
        : buildIceServers(user.id, env);
      const relayConfigured = iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(isRelay));
      return res.status(200).json({ iceServers, relayConfigured, expiresAt: Math.floor(Date.now() / 1000) + (cloudflare ? CLOUDFLARE_TTL : 3600) });
    } catch { return res.status(503).json({ error: 'Calling relay configuration is unavailable. Please check server settings and try again.' }); }
  };
}

export default createIceHandler();
