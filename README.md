# msngr

A fast, minimal desktop-first messenger backed by Supabase.

## Current build

- Supabase email + password authentication
- No application-level email verification flow
- Persistent user profiles
- Direct one-to-one conversations
- Persistent message history
- Supabase Realtime for incoming messages
- Row Level Security on exposed tables
- Database-side message sending with a basic anti-flood ceiling
- Responsive desktop/mobile interface
- Static Vite hosting on Vercel for normal app traffic

## Auth behavior

msngr is designed for immediate signup: create an account, receive a session, and enter the messenger directly. The application does not send confirmation links, OTP emails, or verification emails.

The Supabase project should therefore have email confirmation disabled for the Email provider. If the hosted Auth project still requires confirmation, Supabase will refuse to issue a session even though the frontend contains no verification flow.

## Keeping usage low

The client avoids polling. It opens one Realtime subscription after sign-in, loads only 40 messages at a time, uses the indexed inbox query, and debounces read-state updates. Text messages are capped at 4,000 characters / 12 KB.

## Backend

Dedicated Supabase project: `msngr`.

Vercel environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Only the publishable key belongs in the browser. Never expose a Supabase secret/service-role key in frontend code.

## Security

- RLS is enabled on public data tables.
- Users can only read conversations and messages they belong to.
- The browser never receives a service-role or secret key.
- Starting a direct chat uses an exact-email database function instead of exposing the user directory.
- Message writes go through a database function that validates membership, message size, and a basic rate ceiling.
