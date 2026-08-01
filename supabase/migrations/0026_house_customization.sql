-- 0026_house_customization.sql
-- Shared, per-family customization of the living-house home scene: which house
-- style, which savings tree, and which pet the whole family sees. Stored on the
-- families row (one shared house), surfaced through the single hydrate snapshot,
-- written via a security-definer setter, and pushed to other members via realtime.
--
-- Shape: families.house = { "house": text, "tree": text, "pet": text }
--   house ∈ cottage|modern|tile|brick   tree ∈ oak|cherry|pine|willow|kumquat
--   pet   ∈ dog|cat|rabbit|bird|duck | null   (null/absent = no pet)
-- Unknown/absent keys fall back to defaults in the client, so this is additive
-- and safe against older clients.

-- 1. storage ---------------------------------------------------------------
alter table families
  add column if not exists house jsonb not null default '{}'::jsonb;

-- 2. setter: any authenticated member may change their own family's house ---
create or replace function public.set_family_house(p_house jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fid uuid := auth_family_id();
begin
  if v_fid is null then
    raise exception 'not in a family';
  end if;
  -- Normalize to the known keys only; drop nulls so an unset pet stays absent.
  update families
     set house = jsonb_strip_nulls(jsonb_build_object(
           'house', p_house->>'house',
           'tree',  p_house->>'tree',
           'pet',   p_house->>'pet')),
         updated_at = now()
   where id = v_fid;
end $$;

revoke execute on function public.set_family_house(jsonb) from public, anon;
grant  execute on function public.set_family_house(jsonb) to authenticated;

-- 3. surface `house` in the hydrate snapshot -------------------------------
--    (verbatim re-creation of 0024's get_family_snapshot with `house` added to
--    the family sub-select — the only change is on the family row.)
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
        select name, currency, default_language, house
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

-- 4. realtime: let other members' apps see a house change live --------------
--    families has no family_id column, so the client subscribes with id=eq.fid;
--    it just needs to be in the realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'families'
  ) then
    execute 'alter publication supabase_realtime add table public.families';
  end if;
end $$;
