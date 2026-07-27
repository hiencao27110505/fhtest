-- ============================================================================
-- FamilyHub — 0022 performance hardening
--   R2/R6: get_family_snapshot() — one RPC returns the whole hydrate as one JSON
--          payload (replaces the client's 13 parallel table reads). Optional
--          p_txn_from windows the transaction ledger (R6 mechanism; client passes
--          null today = no behaviour change).
--   R8:    covering indexes for the composite/plain FKs the linter flagged;
--          drop three single-column indexes now superseded by those; and wrap
--          every RLS policy's auth_*() calls as (SELECT …) so they evaluate once
--          per query (initplan) instead of once per row.
-- All changes are additive/mechanical. RLS logic is preserved exactly — the DO
-- block only rewrites the function-call form, never the predicate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- R2 / R6 — single-payload hydrate
-- SECURITY DEFINER: reads only the caller's OWN active family (family_id =
-- auth_family_id()), which they can already read via RLS. Running as definer
-- means the 13 inner reads pay ZERO per-row RLS cost — that is the whole point.
-- ---------------------------------------------------------------------------
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
    return null;                                   -- not in a family yet
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
        from saving_goals where family_id = v_fid and archived_at is null) sg)
  ) into v_json;

  return v_json;
end $$;

revoke execute on function public.get_family_snapshot(date) from public, anon;
grant  execute on function public.get_family_snapshot(date) to authenticated;

-- ---------------------------------------------------------------------------
-- R8 — covering indexes for the FKs flagged by the performance advisor
-- ---------------------------------------------------------------------------
create index if not exists category_budgets_cat_fam_idx    on public.category_budgets(category_id, family_id);
create index if not exists event_fundings_event_fam_idx    on public.event_fundings(event_id, family_id);
create index if not exists event_fundings_goal_fam_idx     on public.event_fundings(goal_id, family_id);
create index if not exists event_fundings_member_fam_idx   on public.event_fundings(member_id, family_id);
create index if not exists event_memories_event_fam_idx    on public.event_memories(event_id, family_id);
create index if not exists event_memories_fam_idx          on public.event_memories(family_id);
create index if not exists families_owner_idx              on public.families(owner_id);
create index if not exists incomes_member_fam_idx          on public.incomes(member_id, family_id);
create index if not exists invitations_invited_by_idx      on public.invitations(invited_by);
create index if not exists invitations_member_fam_idx      on public.invitations(member_id, family_id);
create index if not exists members_user_idx                on public.members(user_id);
create index if not exists saving_goals_occasion_fam_idx   on public.saving_goals(occasion_id, family_id);
create index if not exists savings_entries_member_fam_idx  on public.savings_entries(member_id, family_id);
create index if not exists transaction_photos_txn_fam_idx  on public.transaction_photos(transaction_id, family_id);
create index if not exists transactions_cat_fam_idx        on public.transactions(category_id, family_id);
create index if not exists transactions_member_fam_idx     on public.transactions(member_id, family_id);

-- Superseded by the composite covering indexes above (advisor: unused).
drop index if exists public.transactions_category_idx;
drop index if exists public.transactions_member_idx;
drop index if exists public.event_fundings_goal_idx;

-- ---------------------------------------------------------------------------
-- R8 — wrap auth helpers as (SELECT …) so RLS evaluates them ONCE per query
-- (initplan), not once per row. Purely mechanical: preserves each policy's
-- predicate exactly, only changes the function-call form. Idempotent for the
-- current all-bare state; skips anything not referencing an auth helper.
-- ---------------------------------------------------------------------------
do $$
declare
  r    record;
  q    text;
  c    text;
  stmt text;
begin
  for r in
    select pol.polname                                 as name,
           cls.relname                                 as tbl,
           pg_get_expr(pol.polqual,      pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
    from pg_policy pol
    join pg_class     cls on cls.oid = pol.polrelid
    join pg_namespace ns  on ns.oid  = cls.relnamespace
    where ns.nspname = 'public'
  loop
    q := r.qual;
    c := r.chk;

    if (q is not null and (q like '%auth_family_id()%' or q like '%auth.uid()%' or q like '%auth_email()%'))
    or (c is not null and (c like '%auth_family_id()%' or c like '%auth.uid()%' or c like '%auth_email()%')) then

      if q is not null then
        q := replace(q, 'auth_family_id()', '( SELECT auth_family_id())');
        q := replace(q, 'auth.uid()',       '( SELECT auth.uid())');
        q := replace(q, 'auth_email()',      '( SELECT auth_email())');
      end if;
      if c is not null then
        c := replace(c, 'auth_family_id()', '( SELECT auth_family_id())');
        c := replace(c, 'auth.uid()',       '( SELECT auth.uid())');
        c := replace(c, 'auth_email()',      '( SELECT auth_email())');
      end if;

      if q is not null and c is not null then
        stmt := format('alter policy %I on public.%I using (%s) with check (%s)', r.name, r.tbl, q, c);
      elsif q is not null then
        stmt := format('alter policy %I on public.%I using (%s)', r.name, r.tbl, q);
      else
        stmt := format('alter policy %I on public.%I with check (%s)', r.name, r.tbl, c);
      end if;

      execute stmt;
    end if;
  end loop;
end $$;
