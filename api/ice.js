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
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed.' }); }
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer \S+$/.test(authorization) || authorization.length > 8192) return res.status(401).json({ error: 'Sign in to use calling.' });
  const url = process.env.VITE_SUPABASE_URL || 'https://uglcxkakkilfndubgrac.supabase.co';
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B2ff1Bo8K9CR7UIY5c6deA_v1TWwayF';
  try {
    const auth = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey: key }, signal: AbortSignal.timeout(8000) });
    if (!auth.ok) return res.status(auth.status >= 500 ? 503 : 401).json({ error: 'Could not verify your session. Sign in again.' });
    const user = await auth.json(); if (!user.id || typeof user.id !== 'string') return res.status(401).json({ error: 'Invalid session.' });
    const iceServers = buildIceServers(user.id);
    return res.status(200).json({ iceServers, relayConfigured: iceServers.length > 1, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
  } catch { return res.status(503).json({ error: 'Calling relay configuration is unavailable. Please try again later.' }); }
}
