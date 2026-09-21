-- 0136_backfill_cursor — THE BACKFILL POSITION.  ALREADY LIVE; recorded after the fact.
--
-- Applied to production by hand around 2026-09-15 (the live ledger has no row for
-- it) and written down on 2026-09-21 from the live catalog, when the worker code
-- that uses it was re-landed from docs/archive/mailbox-sync-live-v49/. Every
-- statement is idempotent: running this against production changes nothing.
-- It records what the WORKER depends on. The same session also left a backfill
-- monitoring system live and unrecorded (backfill_expectation_alerts,
-- backfill_pace_config, mailbox_message_attempts, my_backfill_status and the
-- _backfill_* helpers); that is NOT reproduced here — see the archive README.
--
-- WHY. A backfill used to list the newest mail in the window on every run and
-- work on the first N it had not finished. Promo mail is settled on its headers
-- and recorded nowhere, so it kept those slots forever: with more than 400 promos
-- newer than the oldest mail reached, every run was the same 400 promos and the
-- backfill could never get further back. A real 365-day connect stopped at 333
-- days. `backfill_before` is the point everything newer than has been finished
-- with; a backfill run lists only mail older than it (worker.mjs).

alter table public.mailbox_grants
  add column if not exists backfill_before       timestamptz,
  add column if not exists backfill_started_at   timestamptz,
  add column if not exists backfill_requested_at timestamptz,
  add column if not exists backfill_moved_at     timestamptz;

comment on column public.mailbox_grants.backfill_before is
  'Backfill position: everything newer than this has been finished with. A backfill run lists only mail before it and advances it past the messages it finished, stopping at the first hold. Null = start from the newest mail. Cleared when backfilled_at is set.';
comment on column public.mailbox_grants.backfill_started_at is
  'When the backfill position first moved. On finish, last_synced_at is written as this time so the first ordinary poll covers mail that arrived during the backfill. Cleared when backfilled_at is set.';
comment on column public.mailbox_grants.backfill_requested_at is
  'When the current first read was requested: stamped by trigger on insert, and whenever backfilled_at is cleared (a widening, 0098). The clock the 5-minute promise is measured from.';
comment on column public.mailbox_grants.backfill_moved_at is
  'When backfill_before (0136) last moved, stamped by trigger. With the newest staged row it tells a read that is working through promo mail apart from one that has stopped.';

create or replace function public._mailbox_backfill_stamps()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.backfilled_at is null
     and (tg_op = 'INSERT' or old.backfilled_at is not null) then
    new.backfill_requested_at := now();
  end if;
  if tg_op = 'UPDATE'
     and new.backfill_before is not null
     and new.backfill_before is distinct from old.backfill_before then
    new.backfill_moved_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists mailbox_grants_backfill_stamps on public.mailbox_grants;
create trigger mailbox_grants_backfill_stamps
  before insert or update of backfilled_at, backfill_before on public.mailbox_grants
  for each row execute function public._mailbox_backfill_stamps();
