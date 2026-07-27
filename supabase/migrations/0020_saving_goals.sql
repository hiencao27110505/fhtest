-- FamilyHub — 0020: saving goals as a first-class money object
--
-- Splits the old "event" into two independent things:
--   • saving_goals — money you set aside to buy/do something (lives in Thu Chi)
--   • events       — occasions you plan & remember (lives in Khoảnh Khắc)
-- with an OPTIONAL link (saving_goals.occasion_id → events).
--
-- STAGE 1 of the split — strictly ADDITIVE and reversible. Nothing is dropped,
-- no view or app behaviour changes yet: funding keeps its event_id, the money
-- views still read it, and the existing app is untouched. A later migration
-- repoints the views to goal_id once the new Thu Chi ships.

-- ── the table ────────────────────────────────────────────────────────────────
create table if not exists public.saving_goals (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  name          text not null,
  emoji         text,
  cover         text,
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date   date,
  note          text,                 -- "what for"
  occasion_id   uuid,                 -- OPTIONAL link to an occasion
  achieved      boolean not null default false,
  sort_order    integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, family_id),
  constraint saving_goals_occasion_fk foreign key (occasion_id, family_id)
    references public.events(id, family_id) on delete set null
);
create index if not exists saving_goals_family_idx   on public.saving_goals(family_id)   where archived_at is null;
create index if not exists saving_goals_occasion_idx on public.saving_goals(occasion_id) where occasion_id is not null;

-- ── funding now attributes to a goal (kept alongside event_id in Stage 1) ─────
alter table public.event_fundings add column if not exists goal_id uuid;
alter table public.event_fundings drop constraint if exists event_fundings_goal_fk;
alter table public.event_fundings add  constraint event_fundings_goal_fk
  foreign key (goal_id, family_id) references public.saving_goals(id, family_id) on delete cascade;
create index if not exists event_fundings_goal_idx on public.event_fundings(goal_id) where goal_id is not null;

-- ── updated_at ───────────────────────────────────────────────────────────────
drop trigger if exists set_updated_at on public.saving_goals;
create trigger set_updated_at before update on public.saving_goals
  for each row execute function public.set_updated_at();

-- ── RLS: family-scoped; soft-delete only (no DELETE policy, mirroring events) ─
alter table public.saving_goals enable row level security;
grant select, insert, update, delete on public.saving_goals to authenticated;
drop policy if exists saving_goals_select on public.saving_goals;
drop policy if exists saving_goals_insert on public.saving_goals;
drop policy if exists saving_goals_update on public.saving_goals;
create policy saving_goals_select on public.saving_goals for select using (family_id = public.auth_family_id());
create policy saving_goals_insert on public.saving_goals for insert with check (family_id = public.auth_family_id());
create policy saving_goals_update on public.saving_goals for update using (family_id = public.auth_family_id()) with check (family_id = public.auth_family_id());

-- ── realtime ─────────────────────────────────────────────────────────────────
alter table public.saving_goals replica identity full;
alter publication supabase_realtime add table public.saving_goals;

-- ── BACKFILL: every existing event carries a target, so each becomes a goal ──
-- linked back to that event (its occasion). Then re-attribute its fundings.
insert into public.saving_goals
  (family_id, name, emoji, cover, target_amount, target_date, achieved, sort_order, archived_at, occasion_id, created_at)
select e.family_id, e.name, e.emoji, e.cover, e.target_amount, e.target_date,
       e.achieved, e.sort_order, e.archived_at, e.id, e.created_at
from public.events e
where e.target_amount is not null;

update public.event_fundings f
set    goal_id = g.id
from   public.saving_goals g
where  g.occasion_id = f.event_id and f.goal_id is null;
