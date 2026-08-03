-- ============================================================================
-- FamilyHub — 0031: PAIRED REVERT for 0030_e2ee_passcode.sql  (do not auto-apply)
--
-- Rolls the schema back to its pre-E2EE shape. Safe to run ONLY while every
-- family is still in enc_state = 'off' or 'dual' (plaintext still present).
-- If any family reached 'enc', run the in-app decrypt-back ("Tắt mã hóa")
-- first — restoring NOT NULL below fails, by design, while scrubbed rows exist.
-- Kept alongside 0030 as the escape hatch; apply manually via MCP if needed.
-- ============================================================================

-- 1. new RPCs go away
drop function if exists public.set_family_passcode(text, text, int, int, text);
drop function if exists public.change_family_passcode(text, text, text, int, int, text);
drop function if exists public.whitelist_list();
drop function if exists public.whitelist_add(text);
drop function if exists public.whitelist_remove(text);
drop function if exists public.find_my_invite();
drop function if exists public.join_with_passcode(uuid, text);
drop function if exists public.set_family_enc_state(text);
drop function if exists public.scrub_plaintext_amounts();
drop function if exists public._fh_passcode_gate(uuid, uuid);

-- 2. re-open the code-invite door (0014 flow)
grant execute on function public.create_invite(uuid)     to authenticated;
grant execute on function public.redeem_invite(text)     to authenticated;
grant execute on function public.regenerate_invite(uuid) to authenticated;

-- 3. restore the pre-E2EE snapshot (0024 shape + house from 0026)
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

-- 4. restore plaintext-only constraints (fails if scrubbed rows still exist — intended)
alter table public.transactions alter column amount set not null;
alter table public.transactions drop constraint if exists transactions_amount_check;
alter table public.transactions add constraint transactions_amount_check check (amount > 0);
alter table public.transactions drop constraint if exists transactions_amount_presence;
alter table public.transactions drop column if exists amount_enc;
alter table public.transactions drop column if exists note_enc;

alter table public.incomes alter column amount set not null;
alter table public.incomes drop constraint if exists incomes_amount_check;
alter table public.incomes add constraint incomes_amount_check check (amount > 0);
alter table public.incomes drop constraint if exists incomes_amount_presence;
alter table public.incomes drop column if exists amount_enc;
alter table public.incomes drop column if exists note_enc;

alter table public.savings_entries alter column amount set not null;
alter table public.savings_entries drop constraint if exists savings_entries_amount_check;
alter table public.savings_entries add constraint savings_entries_amount_check check (amount > 0);
alter table public.savings_entries drop constraint if exists savings_entries_amount_presence;
alter table public.savings_entries drop column if exists amount_enc;
alter table public.savings_entries drop column if exists note_enc;

alter table public.event_fundings alter column amount set not null;
alter table public.event_fundings drop constraint if exists event_fundings_amount_check;
alter table public.event_fundings add constraint event_fundings_amount_check check (amount > 0);
alter table public.event_fundings drop constraint if exists event_fundings_amount_presence;
alter table public.event_fundings drop column if exists amount_enc;

alter table public.category_budgets alter column amount set not null;
alter table public.category_budgets drop constraint if exists category_budgets_amount_check;
alter table public.category_budgets add constraint category_budgets_amount_check check (amount > 0);
alter table public.category_budgets drop constraint if exists category_budgets_amount_presence;
alter table public.category_budgets drop column if exists amount_enc;

alter table public.monthly_budgets drop column if exists budget_total_enc;

alter table public.events drop constraint if exists events_name_presence;
alter table public.events alter column name set not null;
alter table public.events drop column if exists target_amount_enc;
alter table public.events drop column if exists name_enc;

alter table public.saving_goals drop constraint if exists saving_goals_name_presence;
alter table public.saving_goals alter column name set not null;
alter table public.saving_goals alter column target_amount set not null;
alter table public.saving_goals drop constraint if exists saving_goals_target_amount_check;
alter table public.saving_goals add constraint saving_goals_target_amount_check check (target_amount > 0);
alter table public.saving_goals drop column if exists target_amount_enc;
alter table public.saving_goals drop column if exists name_enc;
alter table public.saving_goals drop column if exists note_enc;

-- 5. drop the new tables last (family_keys leaves realtime publication with it)
do $$ begin
  begin execute 'alter publication supabase_realtime drop table public.family_keys';
  exception when undefined_table or undefined_object then null; end;
end $$;
drop table if exists public.passcode_attempts;
drop table if exists public.family_keys;
