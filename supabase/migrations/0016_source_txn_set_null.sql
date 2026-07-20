-- ============================================================================
-- FamilyHub — 0016: source_txn_id must not hard-cascade
--
-- 0015 added events.source_txn_id with `on delete cascade`, reasoning that
-- deleting an expense should take its mirror event with it. That breaks: a hard
-- delete of the event trips the RESTRICT foreign key on event_fundings, so
-- deleting any photo-expense that had been funded fails outright with
--   "update or delete on table events violates foreign key constraint
--    event_fundings_event_id_family_id_fkey"
--
-- 0013 called this out explicitly — "because nothing is hard deleted, the
-- event_fundings RESTRICT FK is never hit and needs no change" — and the app
-- soft-deletes everywhere (members, categories, events, families). A hard
-- cascade was the wrong instinct.
--
-- So: set null as a safety valve, and the client archives the mirror event
-- properly (archive_event → funding reversal + archived_at) before deleting the
-- expense, which is the same path the Delete Event button already uses.
-- ============================================================================

alter table events drop constraint if exists events_source_txn_id_fkey;

alter table events
  add constraint events_source_txn_id_fkey
  foreign key (source_txn_id) references transactions(id) on delete set null;
