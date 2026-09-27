-- 0153_first_slice.sql — first light for a long backfill
-- (docs/specs/first-ninety-seconds-spec.md §2b, UT report problem 01)
--
-- A person who chose a 365-day read used to wait for all of it before the
-- client showed anything. The worker now reads the newest 45 days as a FIRST
-- SLICE and stamps this column when that slice is whole; the client's phase
-- becomes 'deepening' (queue hold released, picture visible) while the rest
-- of the window keeps arriving behind the same cursor.
--
-- One nullable timestamp, set once (the writer PATCHes with first_slice_at
-- is.null, so a race is a no-op). A widen/reconnect that clears backfilled_at
-- deliberately does NOT clear this: the picture already exists, and a re-read
-- must not push the client back behind the hold.

alter table public.mailbox_grants
  add column if not exists first_slice_at timestamptz;

comment on column public.mailbox_grants.first_slice_at is
  'When the newest 45-day slice of the first read completed (0153). Null on grants from before two-phase backfills; set once by the worker, kept across widen/re-reads.';

-- The browser reads connection status straight off the table under 0087''s
-- column-level grant; each later migration grants its own additions
-- (0102, 0121 pattern). Without this line the client''s tiered select would
-- fail wholesale on the new column and fall back to reporting no slice.
grant select (first_slice_at) on public.mailbox_grants to authenticated;
