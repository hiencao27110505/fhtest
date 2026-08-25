-- ============================================================================
-- FamilyHub — 0089: Gmail push for direct mailbox read
--
-- 0087/0088 read mailboxes on a 5-minute schedule. That is a correct floor and
-- a poor ceiling: a bank sends the mail, and the person waits up to five minutes
-- to hear about a transaction that already happened. Gmail can tell us the
-- moment the mailbox changes, and this is the state that needs storing for it.
--
-- WHAT A WATCH IS, AND WHY IT NEEDS A COLUMN.
-- `users.watch()` asks Gmail to publish `{emailAddress, historyId}` to a Pub/Sub
-- topic whenever the mailbox changes. It carries no mail content — it is a
-- doorbell, not a delivery — so the worker still fetches, still filters by
-- sender, still stages exactly as it does on a poll. What changes is only WHEN.
--
-- The registration LAPSES AFTER 7 DAYS, and when it does Gmail simply stops
-- publishing: no error, no final notification, nothing in any log. A pipeline
-- relying on push alone would look idle rather than broken, and the first sign
-- would be transactions quietly missing. So the expiry is stored rather than
-- inferred, and something has to renew it before it arrives.
--
-- THE POLL IS NOT REPLACED. Push is the latency optimisation; the poll is the
-- guarantee. It keeps running on the same schedule and catches whatever push
-- missed — a lapsed watch, a dropped notification, a mailbox connected while
-- the topic was misconfigured. The two fail in different ways on purpose, and
-- the staged rows are idempotent on `gmail_message_id`, so a push and a poll
-- landing on the same message costs one wasted lookup and nothing else.
--
-- Next free migration number after this one: 0090. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

alter table public.mailbox_grants
  -- When Gmail stops publishing for this mailbox unless we renew first. Null
  -- means no watch has ever been registered, which is a mailbox that works on
  -- the poll alone: correct, just slower. Renewal treats it as due.
  add column if not exists watch_expires_at timestamptz;

comment on column public.mailbox_grants.watch_expires_at is
  'When the Gmail watch lapses. A lapsed watch stops delivering notifications SILENTLY, so this is stored rather than inferred, and the renewal job reads it. Null = no watch yet; the mailbox still works on the 5-minute poll.';

-- Drives the renewal sweep: "which watches expire soonest". Partial, because a
-- grant awaiting re-consent cannot mint an access token, so renewing it would
-- only burn a call on a mailbox we cannot read anyway.
create index if not exists mailbox_grants_watch_due_idx
  on public.mailbox_grants (watch_expires_at nulls first)
  where needs_reauth = false;

-- The app reads its own connection status through a column-level grant (0087).
-- The watch expiry joins it: "connected, and receiving mail as it arrives"
-- versus "connected, checking every few minutes" is a real difference to a
-- person waiting on a notification, and it is not a credential.
grant select (watch_expires_at) on public.mailbox_grants to authenticated;
