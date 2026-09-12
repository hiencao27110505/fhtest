-- ============================================================================
-- FamilyHub — 0133: the 6AM streak-digest doorbell (habit-streak-spec §7, §12)
--
-- Every morning at 06:00 ICT (23:00 UTC), ring a content-free push at every
-- member seat whose user holds an active personal streak or whose family
-- holds an active family streak. The push carries NO streak content — the
-- service worker composes the verdict on-device; the server only knows *that*
-- streak rows exist (metadata), never what they target (rule_enc).
--
-- SECRETS LIVE OUT OF BAND (0088 pattern). Set once:
--   select vault.create_secret('<random>',      'streak_digest_secret');
--   select vault.create_secret('<function url>','streak_digest_url');
-- and mirror the same secret into push_config (service-role-only table) so
-- the function can verify callers without a manual env-var step:
--   insert into push_config(k,v) values ('streak_digest_secret','<random>');
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── who to ring ─────────────────────────────────────────────────────────────
-- One row per push subscription of a member seat that qualifies. SECURITY
-- DEFINER + service_role-only EXECUTE: this crosses personal_streaks (owner
-- RLS) and push_subscriptions (family RLS) in one query no client may run.
create or replace function public.streak_digest_targets()
returns table (sub_id uuid, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from push_subscriptions s
  join members m on m.id = s.member_id
  where m.archived_at is null
    and (exists (select 1 from personal_streaks p
                  where p.owner_user_id = m.user_id and p.archived_at is null)
      or exists (select 1 from family_streaks f
                  where f.family_id = s.family_id and f.archived_at is null));
$$;

revoke all on function public.streak_digest_targets() from public;
revoke all on function public.streak_digest_targets() from anon;
revoke all on function public.streak_digest_targets() from authenticated;
grant execute on function public.streak_digest_targets() to service_role;

-- ── the tick ────────────────────────────────────────────────────────────────
-- Fire-and-forget: net.http_post only enqueues; a slow function cannot hold
-- this transaction open. Missing secrets → silent no-op (nothing to ring
-- until the operator finishes the out-of-band step above).
create or replace function public._streak_digest_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'streak_digest_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'streak_digest_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url     := v_url || '?secret=' || v_secret,
    body    := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb);
end;
$$;

revoke all on function public._streak_digest_tick() from public;
revoke all on function public._streak_digest_tick() from anon;
revoke all on function public._streak_digest_tick() from authenticated;

-- ── schedule: 23:00 UTC = 06:00 ICT, daily ──────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-streak-digest') then
    perform cron.unschedule('familyhub-streak-digest');
  end if;
  perform cron.schedule('familyhub-streak-digest', '0 23 * * *',
                        $job$select public._streak_digest_tick()$job$);
end;
$$;
