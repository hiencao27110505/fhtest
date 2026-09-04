-- 0116: one shared model-call budget, measured where the quota actually lives.
--
-- WHY. On 2026-09-02 a mailbox connected while an EXTRACTION_LOGIC_VERSION bump
-- had just invalidated every learned template, so its first backfill had to
-- re-derive every shape through the model at once. It spent its whole per-run
-- budget in 31 minutes, the rest held, and the run never finished — 66 stalled
-- runs re-read the same window while a live 136,670đ card payment sat unstaged
-- inside it, invisible, for ninety minutes. Nothing errored. Nothing was
-- recorded. The app simply looked like it had stopped noticing bank mail.
--
-- Reverting the bump cleared that incident. It did not touch what let it happen:
--
--   • THREE BUDGETS, NONE MEASURING THE REAL QUOTA. The Edge worker caps 40
--     calls per run and has no daily cap at all. The Apps Script caps 50/day in
--     Script-Properties, on the SCRIPT's timezone. The actual limit is 500
--     requests/day for the whole PROJECT — both transports draw on one pool —
--     and it resets at midnight America/Los_Angeles, which is 14:00 Vietnam.
--     Neither counter could see the other, and neither measured Google's day.
--
--   • A BACKFILL COULD STARVE LIVE MAIL. Nothing distinguished "read three
--     months of history" from "read the transaction that arrived one minute
--     ago", so history consumed the pool the live mail needed. That is exactly
--     the failure above, and the lane split below is its fix: backfill may take
--     at most 350 of the 450, so at least 100 calls a day are always reachable
--     by mail arriving now.
--
--   • RETRYING INTO A KNOWN WALL. A 429 is now classified (per-minute vs
--     per-day) in both writers; model_pause is where a per-day verdict is
--     written down so every other run and the OTHER transport stand down too,
--     instead of each rediscovering the wall a request at a time.
--
-- WHY NOT read_tally. It answers a different question (which tier read a mail)
-- and, decisively, it keys on current_date — the DATABASE's day, which is UTC.
-- A UTC-keyed counter against a Pacific-resetting quota is wrong for 7 hours of
-- every day, silently, and always in the direction of over-spending.
--
-- Cap is 450, not 500. The margin absorbs the Apps Script's own retries, manual
-- testing, and the fact that a rejected request still costs a request.

begin;

-- ── the ledger ─────────────────────────────────────────────────────────────
-- Keyed on the PACIFIC date. Never current_date; see the header.
create table if not exists public.model_budget (
  day    date    not null,
  model  text    not null,
  lane   text    not null check (lane in ('live', 'backfill')),
  spent  integer not null default 0 check (spent >= 0),
  primary key (day, model, lane)
);
alter table public.model_budget enable row level security;
revoke all on table public.model_budget from anon, authenticated;

-- ── the wall, written down once ────────────────────────────────────────────
create table if not exists public.model_pause (
  model        text primary key,
  paused_until timestamptz not null,
  reason       text,
  set_at       timestamptz not null default now()
);
alter table public.model_pause enable row level security;
revoke all on table public.model_pause from anon, authenticated;

-- ── caps, in one place both transports read ────────────────────────────────
create or replace function public.model_budget_caps()
returns table (daily_cap integer, backfill_cap integer)
language sql
immutable
set search_path = public
as $$ select 450, 350 $$;
revoke all on function public.model_budget_caps() from public, anon, authenticated;
grant execute on function public.model_budget_caps() to service_role;

-- ── ask for n calls; get a yes or a no ─────────────────────────────────────
-- ATOMIC ON PURPOSE. Two transports and several concurrent runs ask this, so a
-- read-then-write would let the pool go negative under exactly the burst it
-- exists to contain. The insert..on conflict..do update..where does the check
-- and the spend in one statement; `found` reports whether the row moved.
create or replace function public.spend_model_budget(
  p_model text,
  p_lane  text,
  p_n     integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day       date;
  v_daily     integer;
  v_backfill  integer;
  v_total     integer;
  v_ok        boolean := false;
begin
  if p_n is null or p_n <= 0 then
    return false;
  end if;
  if p_lane is null or p_lane not in ('live', 'backfill') then
    raise exception 'model_budget: unknown lane %', p_lane;
  end if;

  -- A live pause refuses everything for this model, both lanes. This is the
  -- row that stops 66 runs rediscovering the same wall one request at a time.
  if exists (
    select 1 from public.model_pause
     where model = p_model and paused_until > now()
  ) then
    return false;
  end if;

  v_day := (now() at time zone 'America/Los_Angeles')::date;
  select daily_cap, backfill_cap into v_daily, v_backfill from public.model_budget_caps();

  -- The whole day for this model, both lanes, as it stands before we spend.
  --
  -- HONEST ABOUT THE RACE: this read-then-write can let two concurrent runs
  -- both pass the daily check and overshoot by their combined p_n. That is why
  -- the cap is 450 against a real 500 — the margin absorbs it. Making it exact
  -- would need a lock held across the model call's lifetime, which would
  -- serialise every mailbox in the fleet behind one HTTP request to Google.
  -- A cost guard with a 50-call cushion is the right trade; a correctness
  -- guard would not be, and this comment exists so nobody "tightens" it into
  -- one without knowing what it costs.
  select coalesce(sum(spent), 0) into v_total
    from public.model_budget where day = v_day and model = p_model;

  if v_total + p_n > v_daily then
    return false;
  end if;

  -- The lane ceiling is enforced on BOTH paths. The `select ... where` guards
  -- the first spend of the day (no conflict to fall through to), the `do
  -- update ... where` guards every later one. Guarding only the update let a
  -- single oversized first request past the backfill ceiling.
  insert into public.model_budget as b (day, model, lane, spent)
  select v_day, p_model, p_lane, p_n
   where p_lane = 'live' or p_n <= v_backfill
  on conflict (day, model, lane) do update
     -- Backfill stops at its own ceiling while live mail keeps the remainder.
     set spent = b.spent + p_n
     where p_lane = 'live' or b.spent + p_n <= v_backfill;

  get diagnostics v_ok = row_count;
  return v_ok;
end;
$$;
revoke all on function public.spend_model_budget(text, text, integer) from public, anon, authenticated;
grant execute on function public.spend_model_budget(text, text, integer) to service_role;

-- ── record a wall ──────────────────────────────────────────────────────────
-- Latest wins, so a longer pause can extend a shorter one; a caller that
-- learns the pool is back can pass a past timestamp to clear it.
create or replace function public.pause_model(
  p_model  text,
  p_until  timestamptz,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.model_pause as p (model, paused_until, reason, set_at)
  values (p_model, p_until, p_reason, now())
  on conflict (model) do update
     set paused_until = excluded.paused_until,
         reason       = excluded.reason,
         set_at       = now();
$$;
revoke all on function public.pause_model(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.pause_model(text, timestamptz, text) to service_role;

-- ── what the app is allowed to say about it ────────────────────────────────
-- The banner needs two facts: are we paused, and how many of MY rows are
-- waiting. Both come from here rather than from table grants, so the client
-- never reads the ledger itself and the pending count stays scoped to the
-- caller's own rows — a global service state must not become a way to count
-- another family's mail.
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
        and (e.owner_user_id = (select auth.uid())
             or e.member_id in (select m.id from public.members m
                                 where m.user_id = (select auth.uid()))));
$$;
revoke all on function public.mailbox_read_status() from public, anon;
grant execute on function public.mailbox_read_status() to authenticated, service_role;

commit;
