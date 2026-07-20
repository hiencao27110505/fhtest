-- ============================================================================
-- FamilyHub — 0015: a photo-expense's mirror event is bound to its transaction
--
-- Adding a photo to an expense mirrors it into an achieved event so it shows in
-- Events + Memories. That link (t.linkedEvent) lived only in browser memory:
-- events had no column pointing back at a transaction, and neither the txn nor
-- the event hydrate restored it. So after any reload, realtime tick or
-- foreground refresh the link was gone, and the next photo-add minted a *new*
-- event — plus a new funding row.
--
-- Observed in production: one $50 expense had spawned 3 events and 3 × $50
-- budget fundings, so July read $150 reserved. Each clone had also re-uploaded
-- the whole photo set.
--
-- source_txn_id makes the link durable. The partial unique index is the real
-- guarantee: the database physically cannot hold two live mirror events for one
-- transaction, whatever the client does. on delete cascade also cleans up mirror
-- events when their expense is deleted, which previously orphaned them.
-- ============================================================================

alter table events
  add column if not exists source_txn_id uuid references transactions(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 1. Collapse the clones this bug already created.
--
--    Deliberately narrow: same family + name + amount, achieved, and created
--    within an hour of the newest copy. That combination is the clone signature
--    (each was written moments after a re-sync). Two events a user genuinely
--    created days apart with the same name and amount are left alone.
-- ---------------------------------------------------------------------------
create temporary table _clone_losers on commit drop as
with ranked as (
  select id, family_id, name, target_amount, created_at,
         max(created_at) over (partition by family_id, name, target_amount) as newest,
         row_number() over (
           partition by family_id, name, target_amount
           order by created_at desc
         ) as rn
    from events
   where archived_at is null and achieved = true
)
select id from ranked
 where rn > 1
   and newest - created_at < interval '1 hour';

-- Same two operations archive_event() performs, and for the same reasons:
-- fundings are deleted (a full reversal returns the money), the event row is
-- soft-deleted, and event_memories rows are deliberately left intact so an
-- archived event stays recoverable from the database.
delete from event_fundings where event_id in (select id from _clone_losers);

update events
   set archived_at = now(), updated_at = now()
 where id in (select id from _clone_losers);

-- ---------------------------------------------------------------------------
-- 2. Bind surviving mirror events to their transaction, so the very next
--    photo-add updates them instead of creating one more orphan. Only where a
--    single transaction matches unambiguously.
-- ---------------------------------------------------------------------------
update events e
   set source_txn_id = t.id
  from transactions t
 where e.source_txn_id is null
   and e.archived_at is null
   and e.achieved = true
   and t.family_id = e.family_id
   and t.amount    = e.target_amount
   and t.note      = e.name
   and not exists (
     select 1 from transactions t2
      where t2.family_id = e.family_id
        and t2.amount = e.target_amount
        and t2.note   = e.name
        and t2.id <> t.id
   );

-- ---------------------------------------------------------------------------
-- 3. One live mirror event per transaction — enforced by the database, not by
--    the client remembering to check.
-- ---------------------------------------------------------------------------
create unique index if not exists events_source_txn_uniq
  on events(source_txn_id)
  where source_txn_id is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- 4. One budget reservation per (event, month), so a re-sync can't reserve the
--    same money twice. Savings-source fundings are excluded: they carry
--    month = null and are legitimately repeatable (you can add funds to a goal
--    as many times as you like).
-- ---------------------------------------------------------------------------
create unique index if not exists event_fundings_budget_uniq
  on event_fundings(event_id, month)
  where source = 'budget';
