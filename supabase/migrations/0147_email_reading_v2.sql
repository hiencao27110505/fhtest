-- 0147_email_reading_v2.sql
--
-- The database side of email reading v2 (docs/specs/email-reading-v2-spec.md).
-- ADDITIVE ONLY: every existing row, column, policy and function keeps working
-- for a worker and a client that have never heard of any of this. Order of
-- deploy does not matter: a v1 worker ignores the new columns, and a v2 worker
-- on a database without them is not deployed (the columns land first).
--
--   1. mailbox_grants.reader_v        which reader a mailbox runs on (R15)
--   2. email_transactions.row_kind    a notice is not a pending review (R5)
--   3. mail_formats                   learned label maps, keyed by what the mail
--                                     LOOKS like, not what its subject says (R6)
--   4. parking                        the two things 0146's table lacked (R7)
--   5. sender_fingerprints            one model read per format per build (R13)
--
-- "A second of something" (AGENT_SYNC §3). This migration introduces a second
-- template store beside sender_fingerprints, a second kind of row in
-- email_transactions, and a second reader. The singular assumptions that were
-- found and changed WITH it: every place that counts or lists pending rows
-- (mailbox_read_status() below; db.mjs pendingCount; 72-txn-review.js,
-- 74-autotxn-ui.js, 76-quick-review.js on the device). Left alone on purpose:
-- disconnect_my_mailbox() and resolve_email_transactions() treat a notice like
-- any staged row (deleted with the mailbox; tombstoned when retired), which is
-- what a notice should get. _backfill_expectation_tick() counts every staged
-- row for its Telegram copy; it is live-only and unrecorded, so it is not
-- touched here, and a notice arriving mid-backfill will be reported to the
-- founders as one more "giao dịch" until that function is dumped and fixed.

begin;

-- ── 1. Which reader a mailbox runs on ───────────────────────────────────────
-- A per-mailbox switch, not a deploy flag: moving one mailbox back to the old
-- reader is an UPDATE, not a redeploy, and the other mailboxes are protected
-- from a regression in the new one. The v1 cascade is frozen the day v2 lands
-- and is deleted once every mailbox is on 2.
alter table public.mailbox_grants
  add column if not exists reader_v smallint not null default 1;
do $$ begin
  alter table public.mailbox_grants
    add constraint mailbox_grants_reader_v_known check (reader_v in (1, 2));
exception when duplicate_object then null; end $$;
-- 0102's lesson: a column added after 0087's explicit column grant is invisible
-- to the app. The device does not need reader_v today; granting it now means
-- the day it does is not a silent "not set up".
grant select (reader_v) on public.mailbox_grants to authenticated;

-- ── 2. A notice is not a pending review ─────────────────────────────────────
-- Card due notices and instalment reminders are read, sealed and staged like
-- any row, and they must never count toward "N khoản chờ duyệt". The column is
-- CLEAR on purpose: the badge is a head-only count and cannot open a box to
-- find out. What it reveals: that a person received a financial notice, never
-- what it says. Recorded in the umbrella spec's "metadata is not sealed" entry.
-- email_transactions_sealed_or_plain (0068) does not list it, so a clear
-- row_kind on a sealed row is legal.
alter table public.email_transactions
  add column if not exists row_kind text not null default 'txn';
do $$ begin
  alter table public.email_transactions
    add constraint email_transactions_row_kind_known check (row_kind in ('txn', 'notice'));
exception when duplicate_object then null; end $$;

create or replace function public.mailbox_read_status()
returns table (paused_until timestamptz, pending_count integer)
language sql
security definer
set search_path = public
as $$
  select
    (select max(p.paused_until) from public.model_pause p where p.paused_until > now()),
    (select count(*)::integer
       from public.email_transactions e
      where e.review_status = 'pending'
        and e.row_kind = 'txn'
        and (e.owner_user_id = (select auth.uid())
             or e.member_id in (select m.id from public.members m
                                 where m.user_id = (select auth.uid()))));
$$;
revoke all on function public.mailbox_read_status() from public, anon;
grant execute on function public.mailbox_read_status() to authenticated, service_role;

-- ── 3. Learned formats ──────────────────────────────────────────────────────
-- A format is a LABEL MAP for one mail layout ("the row labelled X is field Y"),
-- keyed by provider and by a hash of the mail's ordered labels. Labels only:
-- the rows hold no value from anyone's mail, the same promise
-- sender_fingerprints makes and the reason this table may be shared by all
-- users. Seeds are NOT rows here: hand-written formats ship in code
-- (formats.mjs SEED_FORMATS), versioned with the reader that applies them and
-- tested against real mail, so "a seed is never overwritten" is true by
-- construction and needs no trigger.
create table if not exists public.mail_formats (
  provider     text        not null,
  sig          text        not null,
  format       jsonb       not null,
  source       text        not null check (source in ('table', 'model')),
  reader_build text,
  hits         bigint      not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (provider, sig)
);
alter table public.mail_formats enable row level security;
revoke all on public.mail_formats from anon, authenticated;
grant all on public.mail_formats to service_role;

-- ── 4. Parking ──────────────────────────────────────────────────────────────
-- 0146's table counts attempts and gives up. Two things were missing.
-- (a) The list of what is still worth retrying, for the slow lane that works
--     parked mail as the model's quota returns.
create or replace function public.parked_messages(p_grant uuid, p_limit integer default 50)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select gmail_message_id
    from public.mailbox_message_attempts
   where grant_id = p_grant and gave_up_at is null
   order by last_held_at
   limit greatest(1, least(500, coalesce(p_limit, 50)));
$$;
revoke all on function public.parked_messages(uuid, integer) from public, anon, authenticated;
grant execute on function public.parked_messages(uuid, integer) to service_role;

-- (b) A way back for mail the READER gave up on, as opposed to mail the quota
--     refused. "One model read per format per reader build" (section 5) and a
--     multi-transaction mail are given up on at once; neither improves by
--     waiting, only by a better reader. So each give-up remembers the build
--     that gave up, and a new build releases exactly those.
alter table public.mailbox_message_attempts
  add column if not exists reader_build text;

create or replace function public.release_reader_giveups(p_build text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.mailbox_message_attempts
     set gave_up_at = null, attempts = 0, last_held_at = now()
   where gave_up_at is not null
     and reader_build is not null
     and reader_build <> p_build;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.release_reader_giveups(text) from public, anon, authenticated;
grant execute on function public.release_reader_giveups(text) to service_role;

-- Orphans 0146 left possible: attempts whose mailbox is gone.
delete from public.mailbox_message_attempts a
 where not exists (select 1 from public.mailbox_grants g where g.id = a.grant_id);

-- ── 5. One model read per format per reader build ───────────────────────────
-- Consent says a new format is sent to the model "một lần". Twelve formats were
-- paying the model on every mail because their template could not be derived
-- and nothing remembered that the question had already been asked.
alter table public.sender_fingerprints
  add column if not exists model_reads integer not null default 0,
  add column if not exists model_read_build text;

commit;
