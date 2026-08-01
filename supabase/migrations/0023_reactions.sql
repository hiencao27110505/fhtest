-- ============================================================================
-- FamilyHub — 0023: transaction reactions (collaborative emoji reactions)
--
-- A family member can throw ONE emotional reaction (😱 🤨 😂 🥰 😤) onto another
-- member's transaction. The reaction surfaces three ways in the app: an inline
-- chip on the ledger row, a shared "Phòng khách" feed, and an arrival moment on
-- the recipient's phone. This migration is strictly ADDITIVE — one new table,
-- its RLS, its realtime publication, and the reactions key spliced into the
-- get_family_snapshot() hydrate payload (0022). Nothing existing changes.
-- ============================================================================

-- ── the table ────────────────────────────────────────────────────────────────
-- One reaction per (transaction, member): re-reacting REPLACES (upsert), so the
-- feed never fills with a member's rapid-fire taps. Composite FK ties the
-- reaction's tenant tag to its parent transaction and cascades on delete,
-- mirroring transaction_photos exactly.
create table if not exists public.reactions (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families(id) on delete cascade,
  transaction_id uuid not null,
  member_id      uuid not null,
  emoji          text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (transaction_id, member_id),
  foreign key (transaction_id, family_id) references public.transactions(id, family_id) on delete cascade,
  foreign key (member_id,      family_id) references public.members(id,      family_id) on delete cascade
);
create index if not exists reactions_txn_fam_idx    on public.reactions(transaction_id, family_id);
create index if not exists reactions_member_fam_idx on public.reactions(member_id, family_id);
create index if not exists reactions_family_idx     on public.reactions(family_id);

-- ── updated_at ───────────────────────────────────────────────────────────────
drop trigger if exists set_updated_at on public.reactions;
create trigger set_updated_at before update on public.reactions
  for each row execute function public.set_updated_at();

-- ── RLS: family-scoped full CRUD, initplan form (auth helper wrapped once) ────
alter table public.reactions enable row level security;
grant select, insert, update, delete on public.reactions to authenticated;
drop policy if exists reactions_select on public.reactions;
drop policy if exists reactions_insert on public.reactions;
drop policy if exists reactions_update on public.reactions;
drop policy if exists reactions_delete on public.reactions;
create policy reactions_select on public.reactions for select using (family_id = (select public.auth_family_id()));
create policy reactions_insert on public.reactions for insert with check (family_id = (select public.auth_family_id()));
create policy reactions_update on public.reactions for update using (family_id = (select public.auth_family_id())) with check (family_id = (select public.auth_family_id()));
create policy reactions_delete on public.reactions for delete using (family_id = (select public.auth_family_id()));

-- ── realtime ─────────────────────────────────────────────────────────────────
alter table public.reactions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null; end $$;

-- ── splice `reactions` into the single-payload hydrate (extends 0022) ─────────
-- Full function re-declared verbatim from 0022 with one added key, so the client
-- gets reactions in the same round trip. The legacy multi-query fallback in the
-- client reads the identical columns.
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
        select id, category_id, member_id, note, amount, txn_date, status
        from transactions
        where family_id = v_fid
          and (p_txn_from is null or txn_date >= p_txn_from)) t),
    'events', (
      select coalesce(json_agg(row_to_json(e) order by e.sort_order), '[]'::json) from (
        select id, name, emoji, cover, target_amount, target_date, achieved, sort_order, source_txn_id
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
        select id, name, emoji, target_amount, target_date, note, occasion_id, achieved, sort_order
        from saving_goals where family_id = v_fid and archived_at is null) sg),
    'reactions', (
      select coalesce(json_agg(row_to_json(rx) order by rx.created_at desc), '[]'::json) from (
        select id, transaction_id, member_id, emoji, created_at
        from reactions where family_id = v_fid) rx)
  ) into v_json;

  return v_json;
end $$;

revoke execute on function public.get_family_snapshot(date) from public, anon;
grant  execute on function public.get_family_snapshot(date) to authenticated;
