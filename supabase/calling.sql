-- Apply to the existing msngr project using the Supabase SQL editor/migration runner.
-- Calls use private Broadcast only, not publicly readable database signaling rows.
begin;
create or replace function private.can_signal_call(p_topic text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_topic like 'call:%' and exists (
    select 1 from public.conversations c
    join public.conversation_members cm on cm.conversation_id = c.id
    where c.id::text = substring(p_topic from 6)
      and c.kind = 'direct' and cm.user_id = (select auth.uid())
      and (select count(*) from public.conversation_members members where members.conversation_id = c.id) = 2
  );
$$;
revoke all on function private.can_signal_call(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_signal_call(text) to authenticated;

-- Supabase already enables RLS on this managed table.
-- Manage policies only: ALTER TABLE requires ownership and is rejected.
drop policy if exists msngr_call_receive on realtime.messages;
create policy msngr_call_receive on realtime.messages for select to authenticated
using (extension = 'broadcast' and private.can_signal_call((select realtime.topic())));
drop policy if exists msngr_call_send on realtime.messages;
create policy msngr_call_send on realtime.messages for insert to authenticated
with check (extension = 'broadcast' and private.can_signal_call((select realtime.topic())));
commit;

-- Audit any other permissive realtime.messages policies: PostgreSQL ORs policies.
-- Unrelated policies must not grant nonmembers access to call:* topics.
-- In Supabase Realtime settings, enable private channels/disable public access
-- if this project does not use public Broadcast channels elsewhere.
