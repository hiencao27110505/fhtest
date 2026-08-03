-- ============================================================================
-- FamilyHub — 0036: Web Push subscriptions (lock-screen notifications)
--
-- One row per device that opted in. The client saves its PushManager
-- subscription here; the push-send Edge Function reads the family's rows and
-- fires a VAPID-signed Web Push at each endpoint. Strictly ADDITIVE.
--
-- push_config holds the VAPID key pair. RLS is enabled with NO policies and
-- all grants revoked, so only the service role (the Edge Function) can read
-- it — the private key must never reach a client. Keys are inserted directly
-- (never in a migration file, so they stay out of git).
--
-- Applied to production (fhtest) via Supabase MCP on 2026-08-04.
-- ============================================================================

-- ── push_subscriptions: one device that said yes to notifications ────────────
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (member_id, family_id) references public.members(id, family_id) on delete cascade
);
create index if not exists push_subscriptions_family_idx on public.push_subscriptions(family_id);

drop trigger if exists set_updated_at on public.push_subscriptions;
create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- ── RLS: read family-wide; write only rows for MY OWN member seat ────────────
-- A device subscribes itself and may re-point its row when the active family
-- changes (upsert on endpoint), but nobody can edit another member's devices.
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select
  using (family_id = (select public.auth_family_id()));
create policy push_subscriptions_insert on public.push_subscriptions for insert
  with check (
    family_id = (select public.auth_family_id())
    and member_id in (select id from public.members where user_id = (select auth.uid())));
create policy push_subscriptions_update on public.push_subscriptions for update
  using (member_id in (select id from public.members where user_id = (select auth.uid())))
  with check (
    family_id = (select public.auth_family_id())
    and member_id in (select id from public.members where user_id = (select auth.uid())));
create policy push_subscriptions_delete on public.push_subscriptions for delete
  using (member_id in (select id from public.members where user_id = (select auth.uid())));

-- NOT added to supabase_realtime and NOT in get_family_snapshot — the client
-- never needs to observe other devices' subscriptions.

-- ── push_config: VAPID keys, service-role only ───────────────────────────────
create table if not exists public.push_config (
  k           text primary key,
  v           text not null,
  updated_at  timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated, public;
