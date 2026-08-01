-- ============================================================================
-- FamilyHub — 0024: collaborative requests (align before it's real)
--
-- A proposal — a future expense, a saving goal, or a future occasion — must be
-- reviewed and aligned by at least one OTHER family member before it counts.
-- Strictly ADDITIVE: a `created_by` marker on each proposable entity (the
-- REQUESTER, distinct from the payer/member_id), one polymorphic reviews table,
-- its RLS + realtime, and both spliced into the get_family_snapshot() payload.
-- Applied to production (fhtest) via Supabase MCP on 2026-08-01.
-- ============================================================================

-- ── created_by: who PROPOSED it (the requester), not who pays ────────────────
alter table public.transactions add column if not exists created_by uuid;
alter table public.saving_goals add column if not exists created_by uuid;
alter table public.events       add column if not exists created_by uuid;

-- ── request_reviews: one emoji verdict per (entity, member) ──────────────────
-- Polymorphic so one table covers expenses, goals and occasions. Re-reviewing
-- REPLACES (upsert). Only 🥰 from a member other than created_by aligns it.
create table if not exists public.request_reviews (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  entity_type text not null check (entity_type in ('expense','goal','occasion')),
  entity_id   uuid not null,
  member_id   uuid not null,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (entity_type, entity_id, member_id),
  foreign key (member_id, family_id) references public.members(id, family_id) on delete cascade
);
create index if not exists request_reviews_entity_idx on public.request_reviews(entity_type, entity_id, family_id);
create index if not exists request_reviews_family_idx on public.request_reviews(family_id);

drop trigger if exists set_updated_at on public.request_reviews;
create trigger set_updated_at before update on public.request_reviews
  for each row execute function public.set_updated_at();

-- ── RLS: family-scoped full CRUD (mirrors reactions) ─────────────────────────
alter table public.request_reviews enable row level security;
grant select, insert, update, delete on public.request_reviews to authenticated;
drop policy if exists request_reviews_select on public.request_reviews;
drop policy if exists request_reviews_insert on public.request_reviews;
drop policy if exists request_reviews_update on public.request_reviews;
drop policy if exists request_reviews_delete on public.request_reviews;
create policy request_reviews_select on public.request_reviews for select using (family_id = (select public.auth_family_id()));
create policy request_reviews_insert on public.request_reviews for insert with check (family_id = (select public.auth_family_id()));
create policy request_reviews_update on public.request_reviews for update using (family_id = (select public.auth_family_id())) with check (family_id = (select public.auth_family_id()));
create policy request_reviews_delete on public.request_reviews for delete using (family_id = (select public.auth_family_id()));

-- ── realtime ─────────────────────────────────────────────────────────────────
alter table public.request_reviews replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.request_reviews;
exception when duplicate_object then null; end $$;

-- ── splice created_by + request_reviews into the hydrate payload (extends 0023)
create or replace function public.get_family_snapshot(p_txn_from date default null)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fid  uuid := auth_family_id();
  v_json json;
begin
  if v_fid is null then
    return null;
  end if;

  select json_build_object(
    'family', (
      select row_to_json(f) from (
        select name, currency, default_language
        from families where id = v_fid) f),
    'members', (
      select coalesce(json_agg(row_to_json(m) order by m.created_at), '[]'::json) from (
        select id, name, color, is_shared, user_id, created_at
        from members where family_id = v_fid and archived_at is null) m),
    'categories', (
      select coalesce(json_agg(row_to_json(c) order by c.sort_order), '[]'::json) from (
        select id, name, emoji, color, sort_order, archived_at
        from categories where family_id = v_fid) c),
    'category_budgets', (
      select coalesce(json_agg(row_to_json(cb)), '[]'::json) from (
        select category_id, amount, month
        from category_budgets where family_id = v_fid) cb),
    'monthly_budgets', (
      select coalesce(json_agg(row_to_json(mb)), '[]'::json) from (
        select month, budget_total, closed
        from monthly_budgets where family_id = v_fid) mb),
    'transactions', (
      select coalesce(json_agg(row_to_json(t) order by t.txn_date desc), '[]'::json) from (
        select id, category_id, member_id, note, amount, txn_date, status, created_by
        from transactions
        where family_id = v_fid
          and (p_txn_from is null or txn_date >= p_txn_from)) t),
    'events', (
      select coalesce(json_agg(row_to_json(e) order by e.sort_order), '[]'::json) from (
        select id, name, emoji, cover, target_amount, target_date, achieved, sort_order, source_txn_id, created_by
        from events where family_id = v_fid and archived_at is null) e),
    'event_fundings', (
      select coalesce(json_agg(row_to_json(ef)), '[]'::json) from (
        select id, event_id, goal_id, amount, source, month, member_id
        from event_fundings where family_id = v_fid) ef),
    'savings_entries', (
      select coalesce(json_agg(row_to_json(se)), '[]'::json) from (
        select kind, amount
        from savings_entries where family_id = v_fid) se),
    'event_memories', (
      select coalesce(json_agg(row_to_json(em) order by em.sort_order), '[]'::json) from (
        select id, event_id, emoji, caption, photo_url, sort_order
        from event_memories where family_id = v_fid) em),
    'transaction_photos', (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) from (
        select transaction_id, photo_url
        from transaction_photos where family_id = v_fid) tp),
    'incomes', (
      select coalesce(json_agg(row_to_json(inc)), '[]'::json) from (
        select amount, income_date
        from incomes where family_id = v_fid) inc),
    'saving_goals', (
      select coalesce(json_agg(row_to_json(sg) order by sg.sort_order), '[]'::json) from (
        select id, name, emoji, target_amount, target_date, note, occasion_id, achieved, sort_order, created_by
        from saving_goals where family_id = v_fid and archived_at is null) sg),
    'reactions', (
      select coalesce(json_agg(row_to_json(rx) order by rx.created_at desc), '[]'::json) from (
        select id, transaction_id, member_id, emoji, created_at
        from reactions where family_id = v_fid) rx),
    'request_reviews', (
      select coalesce(json_agg(row_to_json(rr) order by rr.created_at desc), '[]'::json) from (
        select id, entity_type, entity_id, member_id, emoji, created_at
        from request_reviews where family_id = v_fid) rr)
  ) into v_json;

  return v_json;
end $$;

revoke execute on function public.get_family_snapshot(date) from public, anon;
grant  execute on function public.get_family_snapshot(date) to authenticated;
