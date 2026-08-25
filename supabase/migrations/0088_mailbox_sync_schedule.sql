-- ============================================================================
-- FamilyHub — 0088: run the direct-read poll on a schedule
--
-- Completes the transport added by 0087. `mailbox_grants` holds the credential
-- and the cursor; this is the thing that actually wakes up and reads mail.
--
-- WHY pg_cron AND NOT A GMAIL WATCH.
-- Gmail push is per-mailbox: `users.watch()` registers ONE topic per mailbox
-- and a second call silently replaces the first. Two push pipelines cannot
-- observe one mailbox, and the loser stops receiving notifications with no
-- error anywhere. A watch also lapses after 7 days and takes the notifications
-- with it, again silently, so push needs a renewal job whose failure looks
-- exactly like an idle mailbox. Polling has neither property: it conflicts with
-- nothing, and a poll that does not run is visibly a poll that did not run.
--
-- The cost is latency. A transaction that reaches the review queue four minutes
-- after the bank sent the mail is, to the person reviewing it, the same as one
-- that arrives in four seconds.
--
-- SECRETS LIVE IN THE VAULT, NOT IN THIS FILE. Migrations are committed; the
-- shared secret this passes to the function is not. Same pattern as 0061's
-- Telegram wiring. Set them once, out of band:
--
--   select vault.create_secret('<random 32+ chars>', 'mailbox_sync_secret');
--   select vault.create_secret('<project ref>',      'mailbox_sync_url');
--
-- `mailbox_sync_url` is the full function URL, e.g.
-- https://<ref>.supabase.co/functions/v1/mailbox-sync
--
-- Next free migration number after this one: 0089. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── the tick ────────────────────────────────────────────────────────────────
--
-- Fire-and-forget: net.http_post only ENQUEUES a request (a background worker
-- sends it), so a slow or unreachable function cannot hold this transaction
-- open. The poll's own work is bounded inside the function by its per-run
-- caps, not by anything here.

create or replace function public._mailbox_sync_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'mailbox_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mailbox_sync_secret';

  -- Not configured yet: stay silent rather than raising every five minutes into
  -- a log nobody is reading. The absence of staged rows is the signal, and the
  -- README says where to look.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', v_secret)
  );
end;
$$;

revoke all on function public._mailbox_sync_tick() from public, anon, authenticated;

comment on function public._mailbox_sync_tick() is
  'Wakes the mailbox-sync Edge Function. Reads its URL and shared secret from the vault so neither is committed. No-ops until both are set.';

-- ── the schedule ────────────────────────────────────────────────────────────
--
-- Every five minutes. The floor is not politeness to Gmail — the API quota is
-- far above this — it is that each tick costs one token refresh plus one search
-- per connected mailbox whether or not anything arrived. Five minutes keeps the
-- worst case (a bank mail landing just after a tick) inside what a person reads
-- as "it just showed up".
--
-- Unscheduled first so re-running this migration cannot leave two jobs both
-- polling, which would double every mailbox's API cost and race two runs onto
-- the same window. The idempotency guard would hold, but paying twice for it is
-- not the intent.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-mailbox-sync') then
    perform cron.unschedule('familyhub-mailbox-sync');
  end if;
end $$;

select cron.schedule('familyhub-mailbox-sync', '*/5 * * * *', 'select public._mailbox_sync_tick();');
