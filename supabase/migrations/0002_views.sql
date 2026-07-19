-- ============================================================================
-- FamilyHub — 0002 views (all derived aggregates)
-- security_invoker=on  => the querying user's RLS applies (tenant isolation holds
-- through the view).  "today" is always family-local (families.timezone), so the
-- realized/planned and achieved splits track real 'now' as it moves.
--
-- Accounting note: v_month_spent is the month TOTAL and includes budget-funded
-- money on ACHIEVED events (the prototype books these as spend). v_category_spent
-- and v_member_spent cover TRANSACTION spend only (events are not categorized or
-- attributed to a member's spend — same as the prototype), so their sums can be
-- <= v_month_spent when achieved budget-fundings exist. The month-level identity
-- budget_total - spent - reserved stays correct.
-- ============================================================================

-- helper: each family's local calendar "today"
create or replace view v_family_today
  with (security_invoker = on) as
select id as family_id, (now() at time zone timezone)::date as today
from families;

-- effective achieved (stored flag OR target date passed) — mirrors achievedNow()
-- Declared early: v_month_spent and v_reserved both depend on it.
create or replace view v_event_status
  with (security_invoker = on) as
select e.id as event_id, e.family_id,
       (e.achieved or (e.target_date is not null and e.target_date < ft.today)) as is_achieved
from events e
join v_family_today ft on ft.family_id = e.family_id;

-- ---- spend: month TOTAL = realized transactions + achieved budget-fundings ----
create or replace view v_month_spent
  with (security_invoker = on) as
select family_id, month, sum(amount) as spent
from (
  -- realized transactions (txn_date <= family-local today)
  select t.family_id, date_trunc('month', t.txn_date)::date as month, t.amount
  from transactions t
  join v_family_today ft on ft.family_id = t.family_id
  where t.txn_date <= ft.today
  union all
  -- budget-source contributions to events that have been achieved = realized spend
  select ef.family_id, ef.month, ef.amount
  from event_fundings ef
  join v_event_status es on es.event_id = ef.event_id
  where ef.source = 'budget' and es.is_achieved
) q
group by family_id, month;

-- category breakdown: transaction spend only (events carry no category)
create or replace view v_category_spent
  with (security_invoker = on) as
select t.family_id,
       date_trunc('month', t.txn_date)::date as month,
       t.category_id,
       sum(t.amount) as spent
from transactions t
join v_family_today ft on ft.family_id = t.family_id
where t.txn_date <= ft.today
group by t.family_id, date_trunc('month', t.txn_date)::date, t.category_id;

-- member breakdown: transaction spend only; member_id NULL = "unassigned" bucket
-- (no null filter, so sum over members reconciles to the transaction total)
create or replace view v_member_spent
  with (security_invoker = on) as
select t.family_id,
       date_trunc('month', t.txn_date)::date as month,
       t.member_id,
       sum(t.amount) as spent
from transactions t
join v_family_today ft on ft.family_id = t.family_id
where t.txn_date <= ft.today
group by t.family_id, date_trunc('month', t.txn_date)::date, t.member_id;

-- ---- budgets ---------------------------------------------------------------
create or replace view v_category_budget_sum
  with (security_invoker = on) as
select family_id, month, sum(amount) as category_budget_total
from category_budgets
group by family_id, month;

-- ---- events: saved = ALL fundings; LEFT JOIN so zero-funding goals show 0 ---
create or replace view v_event_saved
  with (security_invoker = on) as
select e.family_id, e.id as event_id, coalesce(sum(ef.amount), 0) as saved
from events e
left join event_fundings ef on ef.event_id = e.id
group by e.family_id, e.id;

-- ---- savings pool balance --------------------------------------------------
create or replace view v_savings_balance
  with (security_invoker = on) as
select f.id as family_id,
       coalesce((select sum(case when s.kind='deposit' then s.amount else -s.amount end)
                 from savings_entries s where s.family_id = f.id), 0)
     - coalesce((select sum(ef.amount)
                 from event_fundings ef where ef.family_id = f.id and ef.source = 'savings'), 0)
       as balance
from families f;
-- NOTE (v2): no guard stops savings-source fundings over-drawing the pool
-- (balance can go negative). Add an allocate_savings() RPC with a per-family
-- lock if that must be prevented. Fine for a small trusted family.

-- ---- reserved per family/month  (matches eventsReserved + futureExpReserved) -
-- budget-source fundings for NON-achieved events, tagged to that month,
-- plus planned (future-dated) transactions.  << the pl CTE month-scoping is the
-- open product decision: bucket by txn_date month (below) vs. always the current
-- month (prototype). Flip the commented lines to switch. >>
create or replace view v_reserved
  with (security_invoker = on) as
with bud as (
  select ef.family_id, ef.month, sum(ef.amount) as amt
  from event_fundings ef
  join v_event_status es on es.event_id = ef.event_id
  where ef.source = 'budget' and not es.is_achieved
  group by ef.family_id, ef.month
),
pl as (
  select t.family_id,
         date_trunc('month', t.txn_date)::date as month,   -- option A: by the expense's own month
         -- date_trunc('month', ft.today)::date as month,   -- option B: prototype (all future → current month)
         sum(t.amount) as amt
  from transactions t
  join v_family_today ft on ft.family_id = t.family_id
  where t.txn_date > ft.today
  group by t.family_id, 2
)
select coalesce(bud.family_id, pl.family_id) as family_id,
       coalesce(bud.month,     pl.month)     as month,
       coalesce(bud.amt, 0) + coalesce(pl.amt, 0) as reserved
from bud
full join pl on bud.family_id = pl.family_id and bud.month = pl.month;
