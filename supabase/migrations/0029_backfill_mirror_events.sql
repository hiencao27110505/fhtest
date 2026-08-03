-- ============================================================================
-- FamilyHub — 0029: backfill mirror events dropped by the broken upsert
--
-- Since 0015_event_source_txn's partial unique index landed, the client's
-- mirror-event write (`events.upsert(row, {onConflict:'source_txn_id'})`) has
-- silently failed on every photo-expense: Postgres cannot match a plain
-- ON CONFLICT(column) to a PARTIAL unique index (WHERE archived_at IS NULL),
-- so it threw 42P10 on every call, caught and swallowed by the client's
-- generic write-error handler. No events row was ever created — not even an
-- orphan — for any expense photo added since.
--
-- The app itself no longer depends on this for display (Memories/the calendar
-- now read photos straight off `transactions`/`transaction_photos`), and the
-- client write path is fixed separately (select-then-insert-or-update instead
-- of the broken upsert). This backfill just brings the database's mirror-event
-- bookkeeping back in line with what it should have recorded all along, for
-- any feature that still expects one to exist.
-- ============================================================================

insert into events (family_id, name, emoji, cover, target_amount, target_date, achieved, sort_order, created_by, source_txn_id)
select
  t.family_id,
  t.note,
  coalesce(c.emoji, '📸'),
  'sun',
  t.amount,
  coalesce((select min(tp.taken_on) from transaction_photos tp where tp.transaction_id = t.id), t.txn_date),
  true,
  0,
  null,
  t.id
from transactions t
join categories c on c.id = t.category_id
where exists (select 1 from transaction_photos tp where tp.transaction_id = t.id)
  and not exists (select 1 from events e where e.source_txn_id = t.id);
