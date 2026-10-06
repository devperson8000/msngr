-- msngr social upgrade
-- Applied to the dedicated msngr Supabase project.
-- This file documents the live post-baseline schema additions.

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists about text not null default '',
  add column if not exists accent text not null default 'emerald',
  add column if not exists wallpaper text not null default 'mist',
  add column if not exists wallpaper_url text,
  add column if not exists compact_mode boolean not null default false,
  add column if not exists enter_to_send boolean not null default true,
  add column if not exists last_seen_at timestamptz not null default now();

alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('direct','group'));
alter table public.conversations add column if not exists title text, add column if not exists avatar_url text;

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  pair_key text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- The live project additionally contains the following authenticated RPCs:
-- get_people(text), get_contact_requests(), get_contacts(),
-- send_contact_request(uuid), respond_contact_request(uuid, boolean),
-- start_direct_conversation(uuid), create_group(text, uuid[]),
-- get_inbox(), get_conversation_members(uuid), and send_message(uuid, text).
--
-- The RPCs enforce:
-- * DMs only between accepted contacts.
-- * Group members must all be accepted contacts of the creator.
-- * At most 21 people in a group including the creator.
-- * Existing message size/rate limits remain in force.
--
-- Storage buckets:
-- avatars     public read, authenticated own-folder writes, 1 MiB, JPG/PNG/WebP
-- backgrounds public read, authenticated own-folder writes, 3 MiB, JPG/PNG/WebP
--
-- contact_requests is also included in supabase_realtime.
