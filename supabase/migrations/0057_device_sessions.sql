-- ---------------------------------------------------------------------------
-- 0057 — device session registry + cooperative revocation
--
-- Why: on Android, an installed PWA (WebAPK) shares Chrome's origin storage, so
-- uninstalling the app does NOT clear the Supabase session or the cached family
-- key — a reinstall lands straight on Home with no re-auth. There was also no way
-- for a user to see, or cut off, a device that still holds a live session (lost /
-- lent / sold phone).
--
-- This registers every signed-in device under the user's account and lets the
-- owner of the account revoke one. Revocation is COOPERATIVE: Supabase JWTs are
-- stateless, so a device can't be force-killed server-side from the client. Each
-- device instead re-checks device_active() on boot and on foreground; a revoked
-- device signs itself out and wipes its local secrets on the next check. (A hard,
-- immediate kill would need a service-role Edge Function calling
-- auth.admin.signOut — out of scope here, noted for later.)
--
-- Privacy: rows carry only a self-generated random device_id, a coarse label, the
-- UA string and platform, and timestamps. No family data. RLS scopes every row to
-- its owning user.
-- ---------------------------------------------------------------------------

create table if not exists device_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text not null,
  label        text,
  user_agent   text,
  platform     text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (user_id, device_id)
);

create index if not exists device_sessions_user_idx on device_sessions (user_id);

alter table device_sessions enable row level security;

-- A user sees and manages only their own devices. Writes go through the SECURITY
-- DEFINER RPCs below, but these policies also make direct selects (e.g. the
-- devices list) safe and correctly scoped.
drop policy if exists device_sessions_own_select on device_sessions;
create policy device_sessions_own_select on device_sessions
  for select using (user_id = auth.uid());

drop policy if exists device_sessions_own_update on device_sessions;
create policy device_sessions_own_update on device_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists device_sessions_own_delete on device_sessions;
create policy device_sessions_own_delete on device_sessions
  for delete using (user_id = auth.uid());

-- Upsert this device on sign-in / resume. Re-registering a revoked device_id
-- (e.g. a returning legitimate owner) clears the revocation and refreshes it.
create or replace function register_device(
  p_device_id  text,
  p_label      text default null,
  p_user_agent text default null,
  p_platform   text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_device_id), '') = '' then raise exception 'device_id required'; end if;
  insert into device_sessions (user_id, device_id, label, user_agent, platform)
  values (v_uid, p_device_id, p_label, p_user_agent, p_platform)
  on conflict (user_id, device_id) do update
    set label        = coalesce(excluded.label, device_sessions.label),
        user_agent   = coalesce(excluded.user_agent, device_sessions.user_agent),
        platform     = coalesce(excluded.platform, device_sessions.platform),
        last_seen_at = now(),
        revoked_at   = null;
end $$;

-- Heartbeat: bump last_seen_at so the devices list can show "active recently".
create or replace function touch_device(p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update device_sessions set last_seen_at = now()
   where user_id = v_uid and device_id = p_device_id and revoked_at is null;
end $$;

-- Is THIS device still allowed? Unknown device_id counts as active (fail-open:
-- a device that never registered — e.g. registration failed offline — must not be
-- locked out). Only an explicit revoked_at returns false.
create or replace function device_active(p_device_id text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (
    select 1 from device_sessions
     where user_id = auth.uid() and device_id = p_device_id and revoked_at is not null
  );
$$;

-- The devices list for Settings → "Signed-in devices". Newest activity first.
create or replace function my_devices()
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(d order by d.last_seen_at desc), '[]'::json)
  from (
    select device_id, label, user_agent, platform, created_at, last_seen_at, revoked_at
      from device_sessions
     where user_id = auth.uid()
  ) d;
$$;

-- Cut a device off. Cooperative: it signs itself out on its next device_active()
-- check. Own devices only (enforced by the user_id filter under SECURITY DEFINER).
create or replace function revoke_device(p_device_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update device_sessions set revoked_at = now()
   where user_id = v_uid and device_id = p_device_id and revoked_at is null;
end $$;

revoke execute on function public.register_device(text, text, text, text) from public, anon;
revoke execute on function public.touch_device(text)                      from public, anon;
revoke execute on function public.device_active(text)                     from public, anon;
revoke execute on function public.my_devices()                            from public, anon;
revoke execute on function public.revoke_device(text)                     from public, anon;
grant  execute on function public.register_device(text, text, text, text) to authenticated;
grant  execute on function public.touch_device(text)                      to authenticated;
grant  execute on function public.device_active(text)                     to authenticated;
grant  execute on function public.my_devices()                            to authenticated;
grant  execute on function public.revoke_device(text)                     to authenticated;
