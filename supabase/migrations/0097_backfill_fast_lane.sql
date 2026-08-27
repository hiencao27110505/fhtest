-- ============================================================================
-- FamilyHub — 0097: a fast lane while a mailbox is still backfilling
--
-- The 5-minute tick is the right cadence for steady state: a mailbox that gets
-- a few transactions a day does not need to be asked more often, and each ask
-- costs a token refresh plus a search whether or not anything arrived.
--
-- It is the wrong cadence for a FIRST read. A backfill stages a bounded share
-- per run and reports `more`, so a 240-message history arrives over several
-- ticks — which at five minutes apiece is half an hour of a new person watching
-- an almost-empty queue, during the exact minutes they are deciding whether the
-- feature works.
--
-- So: a second job, once a minute, that fires ONLY while some grant has never
-- finished its backfill. It costs nothing in steady state because the guard is
-- one indexed count, and it stops on its own the moment the last backfill
-- finishes — there is no flag to remember to turn off.
--
-- WHY NOT JUST RUN THE MAIN JOB EVERY MINUTE. Because that multiplies the
-- steady-state cost by five for every connected mailbox forever, to speed up an
-- event that happens once per mailbox in its lifetime. The expensive thing here
-- is being asked, not answering.
--
-- OVERLAP IS SAFE, AND IS THE REASON THIS CAN BE A SEPARATE JOB AT ALL. Staged
-- rows are idempotent on gmail_message_id, `alreadyStaged` is asked once per
-- window before anything is fetched, and the cursor is only advanced by a run
-- that finished its window. Two ticks landing together cost one extra listing.
--
-- Next free migration number after this one: 0098. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

create or replace function public._mailbox_backfill_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending int;
  v_url     text;
  v_secret  text;
begin
  -- The guard, first and cheapest. `backfilled_at is null` means "this mailbox
  -- has never finished a first read" — which is exactly the state this job
  -- exists for, and it clears itself.
  select count(*) into v_pending
    from public.mailbox_grants
   where backfilled_at is null
     and needs_reauth = false;

  if v_pending = 0 then
    return;
  end if;

  -- Same vault entries as the 5-minute tick: one URL, one secret, neither
  -- committed. Silent when unset rather than raising every minute into a log
  -- nobody is reading.
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'mailbox_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mailbox_sync_secret';
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

revoke all on function public._mailbox_backfill_tick() from public, anon, authenticated;

comment on function public._mailbox_backfill_tick() is
  'Wakes mailbox-sync once a minute, but ONLY while some grant has never finished its backfill. No-ops otherwise, so steady state pays one indexed count per minute and nothing else. Turns itself off when the last backfill completes.';

-- Partial index so the guard is a lookup rather than a scan. Tiny by
-- construction: it only ever holds mailboxes mid-backfill.
create index if not exists mailbox_grants_backfill_pending_idx
  on public.mailbox_grants (backfilled_at)
  where backfilled_at is null and needs_reauth = false;

-- Unscheduled first, so re-running this migration cannot leave two jobs both
-- firing every minute.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'familyhub-mailbox-backfill') then
    perform cron.unschedule('familyhub-mailbox-backfill');
  end if;
end $$;

select cron.schedule('familyhub-mailbox-backfill', '* * * * *',
                     'select public._mailbox_backfill_tick();');
