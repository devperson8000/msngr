# msngr

A minimal desktop-first messenger inspired by the simplicity of WhatsApp Desktop.

## Current rework

This branch replaces the old local-only/WebRTC chat model with:

- Supabase Auth for email + password sign-in
- Persistent user profiles
- Direct one-to-one conversations
- Persistent message history
- Supabase Realtime for new messages
- Row Level Security on every exposed table
- A database-side send function with a basic anti-flood limit
- A clean desktop UI with responsive mobile fallback
- Static Vite hosting on Vercel, so normal chat traffic does not hit Vercel Functions

## Keeping usage low

The client intentionally avoids polling. It opens one Realtime subscription after sign-in, loads only 40 messages at a time, uses an indexed inbox query, and updates read state with a debounce. Text messages are capped at 4,000 characters / 12 KB. Media uploads are intentionally not included yet, because unbounded media is the easiest way for a messenger to burn through storage and bandwidth.

## Backend setup

Create a NEW dedicated Supabase project for msngr. Do not reuse another app database.

Run supabase/schema.sql in that new project, then set these Vercel environment variables:

- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

Use the new Supabase publishable key, not a service-role or secret key.

For Auth, email/password is expected. If email confirmation is enabled, users need to confirm their address before their first sign-in.

## Development

Install dependencies with npm install, copy .env.example to .env.local, add the new project values, then run npm run dev.

Build with npm run build.

## Security notes

- RLS is enabled on all public tables.
- Users can only read conversations and messages they belong to.
- The browser never receives a service-role/secret key.
- Starting a direct chat uses an exact-email database function rather than exposing the whole user directory.
- Message writes go through a database function that validates membership, message size, and a basic send-rate ceiling.
