-- ============================================================================
-- FamilyHub / Earthy — 0101: a backfill that stops making progress says so
--
-- WHY. v19 (2026-08-29) made a first read notify ONCE, when it finishes,
-- instead of once per run — because announcing every run of a backfill turned
-- "here is your last three months" into ten buzzes in an hour, during the exact
-- minutes someone is deciding whether the feature is worth keeping.
--
-- That fix has a hole. "Finished" means the run held nothing and queued
-- nothing, so a mailbox carrying even ONE permanently unreadable message never
-- finishes — and therefore never notifies at all. The person is left with a
-- queue full of transactions and silence. Noisy was bad; silent is worse.
--
-- These two columns are what lets a STALLED backfill speak: after enough runs
-- with no new rows, the worker sends the completion notice for what did land
-- and keeps retrying the stragglers in the background.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It never sets `backfilled_at`. Marking a
-- stalled backfill complete would abandon mail nobody has read, and unread mail
-- is recoverable only while it is still in the mailbox — the one loss this
-- pipeline is built to make impossible. The threshold changes who gets TOLD,
-- never what gets READ. A transient model outage costs an early notification,
-- not a missing transaction.
--
-- Both columns are also the ops signal that was missing entirely: a mailbox
-- with a high `stalled_runs` and an old `first_stalled_at` is a backfill that
-- needs a human, and until now it looked exactly like a quiet mailbox.
--
-- Additive and nullable: existing rows are untouched, an older worker that
-- knows nothing about these columns keeps working unchanged.
--
-- Next free migration number after this one: 0102. Verify against
-- `git ls-tree origin/main supabase/migrations/` AND the live schema before
-- claiming it — 0100 was applied without an AGENT_SYNC entry, so the file list
-- alone is not enough.
-- ============================================================================

alter table public.mailbox_grants
  add column if not exists stalled_runs    int,
  add column if not exists first_stalled_at timestamptz;

comment on column public.mailbox_grants.stalled_runs is
  'Consecutive runs that staged nothing new while the backfill was still unfinished. Reset to 0 by any run that stages a row. Past WORKER stall threshold the completion notice is sent anyway; backfilled_at is still NOT set, because a stall must never abandon unread mail.';

comment on column public.mailbox_grants.first_stalled_at is
  'When the current stall started. Null whenever stalled_runs is 0 or null. Paired with stalled_runs so "stuck for 40 runs" and "stuck since 09:12" are both answerable — the second is what tells a human whether it is a blip or a broken key.';

-- Small and partial: only ever holds mailboxes mid-stall, which is nearly
-- always none. This is the index an alert would read.
create index if not exists mailbox_grants_stalled_idx
  on public.mailbox_grants (stalled_runs)
  where stalled_runs is not null and backfilled_at is null;
