# msngr

A polished, serverless peer-to-peer messenger with text chat, audio calls, and video calls.

## Features

- Shareable invite links and short room codes
- Direct WebRTC messaging and media
- Nostr-based peer discovery through Trystero (no PeerJS or custom signaling server)
- Incoming call, audio call, and video call flows
- Mute, camera, call timer, minimize, and hang-up controls
- Compact chat bubbles, typing indicators, presence, emoji, and room management
- Local message and room persistence
- One-click isolated second-tab test client
- Responsive desktop and mobile layout

## Deploy on Vercel

Import this repository into Vercel and press **Deploy**. It is a zero-build static site, and `vercel.json` supplies the security and camera/microphone permission headers.

Camera and microphone access require HTTPS, which Vercel provides automatically.

## How connections work

The room link acts as the invitation. Trystero uses Nostr relays only to help browsers discover each other and establish WebRTC. Messages, history sync, audio, and video then travel directly between peers with WebRTC encryption. Chat history stays in each browser's local storage.

Some highly restricted school or corporate networks block direct WebRTC. Supporting every such network requires adding a TURN service to the Trystero configuration.

## Local testing

Serve the folder over HTTP rather than opening `index.html` directly. For example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`. Create a room and use the stacked-windows button in the left rail to open an isolated second client.
