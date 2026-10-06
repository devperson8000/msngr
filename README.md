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
