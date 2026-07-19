-- ============================================================================
-- FamilyHub — 0002 views (all derived aggregates)
-- security_invoker=on  => the querying user's RLS applies (tenant isolation holds
-- through the view).  "today" is always family-local (families.timezone), so the
-- realized/planned and achieved splits track real 'now' as it moves (the frozen
-- prototype clock is replaced by now() AT TIME ZONE the family's tz).
-- ============================================================================

-- helper: each family's local calendar "today"
create or replace view v_family_today
  with (security_invoker = on) as
select id as family_id, (now() at time zone timezone)::date as today
from families;

-- ---- spend: realized = txn_date <= family-local today ----------------------
create or replace view v_month_spent
  with (security_invoker = on) as
select t.family_id,
       date_trunc('month', t.txn_date)::date as month,
       sum(t.amount) as spent
from transactions t
join v_family_today ft on ft.family_id = t.family_id
where t.txn_date <= ft.today
group by t.family_id, date_trunc('month', t.txn_date)::date;

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

create or replace view v_member_spent
  with (security_invoker = on) as
select t.family_id,
       date_trunc('month', t.txn_date)::date as month,
       t.member_id,
       sum(t.amount) as spent
from transactions t
join v_family_today ft on ft.family_id = t.family_id
where t.txn_date <= ft.today and t.member_id is not null
group by t.family_id, date_trunc('month', t.txn_date)::date, t.member_id;

-- ---- budgets ---------------------------------------------------------------
create or replace view v_category_budget_sum
  with (security_invoker = on) as
select family_id, month, sum(amount) as category_budget_total
from category_budgets
group by family_id, month;

-- ---- events: saved = ALL fundings (savings + budget) -----------------------
create or replace view v_event_saved
  with (security_invoker = on) as
select ef.family_id, ef.event_id, sum(ef.amount) as saved
from event_fundings ef
group by ef.family_id, ef.event_id;

-- effective achieved (stored flag OR target date passed) — mirrors achievedNow()
create or replace view v_event_status
  with (security_invoker = on) as
select e.id as event_id, e.family_id,
       (e.achieved or (e.target_date is not null and e.target_date < ft.today)) as is_achieved
from events e
join v_family_today ft on ft.family_id = e.family_id;

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

-- ---- reserved per family/month  (matches eventsReserved + futureExpReserved) -
-- budget-source fundings for NON-achieved events, tagged to that month,
-- plus planned (future-dated) transactions falling in that month.
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
  select t.family_id, date_trunc('month', t.txn_date)::date as month, sum(t.amount) as amt
  from transactions t
  join v_family_today ft on ft.family_id = t.family_id
  where t.txn_date > ft.today
  group by t.family_id, date_trunc('month', t.txn_date)::date
)
select coalesce(bud.family_id, pl.family_id) as family_id,
       coalesce(bud.month,     pl.month)     as month,
       coalesce(bud.amt, 0) + coalesce(pl.amt, 0) as reserved
from bud
full join pl on bud.family_id = pl.family_id and bud.month = pl.month;
