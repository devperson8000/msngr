# msngr

A full-screen desktop-first messenger built with Vite, Vercel and a dedicated Supabase backend.

## What it does

- Email + password accounts with an application flow designed for instant signup
- A **People** directory of msngr accounts
- Connection requests with pending / accept / decline states
- Direct messages only between accepted contacts
- Group chats made from accepted contacts
- Persistent realtime messages and unread counts
- Profile photos and short profile status
- Per-user accent themes
- Per-user chat backgrounds, including bounded custom image uploads
- Enter-to-send and compact-chat preferences
- Responsive desktop/mobile layout
- Row Level Security plus server-side RPC validation for social and messaging actions

## Social flow

1. Open **People**.
2. Send a connection request to another account.
3. The other person accepts or declines it from **Requests**.
4. Once accepted, either person can start a direct chat.
5. Accepted contacts can also be selected when creating a group.

The database enforces these rules; the frontend is not trusted to bypass them.

## Upload limits

To keep storage/bandwidth controlled:

- Profile photos: JPG / PNG / WebP, maximum **1 MB**
- Custom chat backgrounds: JPG / PNG / WebP, maximum **3 MB**
- Backgrounds affect only the uploading user's own interface.

## Backend

Dedicated Supabase project: `msngr`.

The base schema is in `supabase/schema.sql`. The social/customisation additions are documented in `supabase/social_upgrade.sql`.

Vercel uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never expose a Supabase service-role or secret key in browser code.

## Keeping usage low

- No polling loops.
- One Realtime channel per signed-in browser session.
- Messages load 40 at a time.
- People search is debounced.
- Read-state writes are debounced.
- Message bodies remain capped at 4,000 characters / 12 KB.
- Media messages are not supported; only bounded avatar/background images are stored.

## Auth note

The application contains no confirmation-email, OTP-email, SMTP or Ethereal flow. It expects the Supabase Email provider to issue a session immediately after signup. If the hosted Supabase project still has **Confirm email** enabled, that project-level Auth setting must be disabled or Supabase itself will withhold the new session even though the application has no verification UI.

## Voice and video calls

Open a direct conversation and use the phone or camera button. Your contact gets an incoming-call prompt with Accept/Decline. Calls include microphone mute, camera on/off (including adding video to a voice call), separate screen sharing, elapsed time and connection feedback, and an in-call chat panel. Camera and screen can be shared together. The chat is ephemeral and disappears when a new call starts; it is separate from persistent conversation messages. Group calling is not included.

Media travels through encrypted WebRTC connections, directly or via TURN. Capture targets 720p at 30 fps for camera video and 1080p at 15 fps for screen sharing, with browser adaptation to available bandwidth. Screen audio is not shared. No call recording is implemented. Both participants need msngr open and signed in; there is no background push notification service. Calls time out after 45 seconds without an answer.

Browsers require microphone/camera permission and a user-selected screen-sharing source. Use HTTPS in production; localhost works for development. Screen sharing depends on browser/platform support and is often unavailable on mobile browsers. Device denial, cancellation, missing hardware, signaling failures, and connection loss display actionable feedback. Hangup/signout stops owned capture tracks immediately.

### Required hosted setup

1. Apply `supabase/calling.sql` to the existing msngr project. It authorizes private Realtime Broadcast topics (`call:<conversation UUID>`) for the two members of a direct conversation. Audit existing `realtime.messages` policies: permissive policies are ORed, so unrelated broad policies must not allow nonmembers onto `call:*` topics. Test a member and a nonmember against the live policies before release. Do not substitute public channels.
2. Deploy the Vercel project including `api/ice.js` and the updated `vercel.json`. The headers allow same-origin camera/microphone/display capture and MediaStream playback. The existing Email Auth settings must still issue immediate signup sessions as described above.
3. For reliable calls across NATs, VPNs, and restrictive networks, operate or purchase a TURN service supporting coturn REST/HMAC credentials. Configure **server-only** Vercel variables `TURN_URLS` (comma-separated, e.g. `turn:relay.example.com:3478,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:5349?transport=tcp`) and `TURN_SHARED_SECRET`. The server validates the Supabase session and issues credentials valid for one hour. Never prefix the shared secret with `VITE_` or put it in client code. Configure the same shared secret on the TURN service, TLS for `turns:`, and provider allocation/bandwidth quotas.
4. Vercel's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` must identify the same project in the browser bundle and function. The repository's existing public defaults are used when these are absent. With no TURN settings, the endpoint returns STUN only and the UI warns that restrictive networks may fail. Do not describe STUN-only calling as universally reliable.

The browser requests `/api/ice` with its current Supabase session; credentials are not cached or baked into the bundle. Plain `npm run dev` does not run Vercel functions. In development it uses STUN unless `VITE_WEBRTC_ICE_SERVERS` contains an ICE server JSON array. This override is development-only; use only disposable short-lived credentials. Use a Vercel development environment to exercise the production function locally.

### Checks

Run `npm run check`, `npm run build`, and `npm test`. Browser tests require Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`) and Playwright. Tests connect two isolated browser contexts with real RTCPeerConnections and synthetic devices; the screen-picker acquisition is replaced with a real canvas MediaStream for deterministic tests. A test-only signaling bridge replaces hosted Supabase. This checks the engine and UI, not live RLS or real screen-picker permissions.

If Chromium's managed network policy disables direct UDP, use a disposable **local-only** TURN relay, leaving the browser policy intact:

```sh
turnserver -n --no-cli --no-tls --no-dtls \
  --listening-ip=127.0.0.1 --relay-ip=127.0.0.1 --listening-port=3479 \
  --min-port=49160 --max-port=49200 --realm=msngr-test --lt-cred-mech \
  --user=test:test-only --allow-loopback-peers --no-multicast-peers \
  --relay-threads=1 --userdb=/tmp/msngr-turn-test.sqlite \
  --log-file=/tmp/msngr-turn-test.log --pidfile=/tmp/msngr-turn-test.pid
TEST_TURN_URL='turn:127.0.0.1:3479?transport=tcp' npm test
```

The loopback exception and fixed test credentials above are strictly for a relay bound to localhost; never use them for production. `TEST_TURN_USERNAME` and `TEST_TURN_PASSWORD` can select another disposable relay account. No production keys are needed for the tests. Hosted migration application, live authenticated signaling, physical device capture, native screen selection, and calls across actual networks need deployment validation.
