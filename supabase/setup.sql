-- Run once in your Supabase project's SQL Editor. Re-running is safe.
create table if not exists public.eureka_rooms (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  data jsonb not null,
  expires bigint not null,
  history jsonb not null default '[]'::jsonb
);
alter table public.eureka_rooms enable row level security;
revoke all on public.eureka_rooms from anon, authenticated;
grant select, insert, update, delete on public.eureka_rooms to service_role;

-- Atomic append prevents simultaneous messages from overwriting each other.
create or replace function public.eureka_append_message(room_id text, entry jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare current_room public.eureka_rooms;
begin
  select * into current_room from public.eureka_rooms where id = room_id for update;
  if not found then return 'expired'; end if;
  if current_room.expires <= floor(extract(epoch from clock_timestamp()) * 1000) then
    delete from public.eureka_rooms where id = room_id;
    return 'expired';
  end if;
  if jsonb_array_length(current_room.history) >= 2000 then return 'full'; end if;
  update public.eureka_rooms set history = history || jsonb_build_array(entry) where id = room_id;
  return 'ok';
end;
$$;
revoke all on function public.eureka_append_message(text,jsonb) from public, anon, authenticated;
grant execute on function public.eureka_append_message(text,jsonb) to service_role;

-- Cleanup runs in the database even when Render sleeps. Access expires exactly
-- at the deadline; physical row removal follows within approximately one minute.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('eureka-expired-room-cleanup', '* * * * *',
  $$delete from public.eureka_rooms where expires <= floor(extract(epoch from clock_timestamp()) * 1000)$$);
