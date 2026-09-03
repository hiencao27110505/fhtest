-- ============================================================================
-- FamilyHub — 0113: re-staged mail carries a certainty badge, not silence
--
-- THE DECISION THIS IMPLEMENTS (2026-09-03). The ledger is the sole anchor of
-- truth for duplicate prevention; email-reading history informs but never
-- gates what a person sees. Until now a tombstone in resolved_email_messages
-- made the worker skip a message forever — correct against double-staging,
-- but invisible: a person who disconnects the mailbox and reconnects cannot
-- tell "excluded because already imported" from "the scan missed it". And the
-- exclusion had real holes (transport switch, pre-0090 promotions) where
-- already-imported mail DID come back, with nothing marking it.
--
-- The new posture: during a BACKFILL (fresh connect or reconnect — exactly the
-- moments a person re-scans history), mail whose tombstone belongs to a
-- previous connection is staged AGAIN, flagged `resolved_before`. The review
-- screen shows it as a certain "đã nhập trước đó" card — message-id equality
-- is not a guess — and the person rules on it with one tap, against their
-- ledger. Steady-state polls keep the tombstone skip unchanged: without it, a
-- row imported today would boomerang back on the next tick, since the poll
-- window still covers its email.
--
-- "Previous connection" is decided by timestamps the schema already has:
-- resolved_at (0090) against mailbox_grants.created_at. A disconnect deletes
-- the grant row (0087), so a reconnect mints a new created_at; tombstones
-- written before it are prior-epoch and re-stage, tombstones written during
-- the current connection's life (an import mid-backfill) stay skipped.
--
-- The column is workflow state, like review_status and duplicate_of_id: clear
-- by design (the sealed-or-plain CHECK of 0068 does not govern it), written
-- only by the worker, read by the review screen.
--
-- Next free migration number after this one: 0114. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

alter table public.email_transactions
  add column if not exists resolved_before boolean not null default false;

comment on column public.email_transactions.resolved_before is
  'This gmail_message_id was already promoted or dismissed in a previous mailbox connection (its tombstone predates the current grant). The review screen shows a certain "đã nhập trước đó" flag; the row is never hidden or auto-dropped.';
