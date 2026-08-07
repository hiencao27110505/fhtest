-- 0048_snapshot_windowing.sql
-- Extend get_family_snapshot's p_txn_from window to the txn-anchored aggregates.
--
-- Before: p_txn_from windowed ONLY `transactions`; transaction_photos and reactions
-- were always returned in full, so a windowed hydrate still shipped the whole photo
-- and reaction history. Here we window those two to the SAME transaction set, so a
-- windowed refresh is genuinely bounded to recent activity.
--
-- request_reviews stays full on purpose: it's polymorphic (expense/goal/occasion) and
-- small (reviews cluster on pending/recent items), so windowing it buys little and
-- adds join complexity. events, event_memories, saving_goals, members, categories,
-- budgets, incomes, savings_entries, family, enc, key_wraps stay full — the client's
-- month totals and savings-pool math need them whole, and they're naturally bounded.
--
-- BACKWARD COMPATIBLE: with p_txn_from = NULL every added predicate short-circuits to
-- TRUE, so the output is byte-identical to the pre-0048 function. Old clients (which
-- always pass NULL) and the 17-query fallback are unaffected — safe to roll back by
-- re-applying the previous definition.

CREATE OR REPLACE FUNCTION public.get_family_snapshot(p_txn_from date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'enc', (
      select row_to_json(k) from (
        select enc_state, kdf_salt, kdf_iters, kdf_version, wrapped_dek
        from family_keys where family_id = v_fid) k),
    'key_wraps', (
      select coalesce(json_agg(to_jsonb(w) - 'created_at' order by w.created_at), '[]'::json) from (
        select id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek, created_at
        from family_key_wraps where family_id = v_fid and rotated_at is null) w),
    'members', (
      select coalesce(json_agg(row_to_json(m) order by m.created_at), '[]'::json) from (
        select id, name, name_enc, color, is_shared, user_id, created_at, key_unlocked_at
        from members where family_id = v_fid and archived_at is null) m),
    'categories', (
      select coalesce(json_agg(row_to_json(c) order by c.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, color, sort_order, archived_at
        from categories where family_id = v_fid) c),
    'category_budgets', (
      select coalesce(json_agg(row_to_json(cb)), '[]'::json) from (
        select category_id, amount, amount_enc, month
        from category_budgets where family_id = v_fid) cb),
    'monthly_budgets', (
      select coalesce(json_agg(row_to_json(mb)), '[]'::json) from (
        select month, budget_total, budget_total_enc, closed
        from monthly_budgets where family_id = v_fid) mb),
    'transactions', (
      select coalesce(json_agg(row_to_json(t) order by t.txn_date desc), '[]'::json) from (
        select id, category_id, member_id, note, note_enc, amount, amount_enc, txn_date, status, created_by
        from transactions
        where family_id = v_fid
          and (p_txn_from is null or txn_date >= p_txn_from)) t),
    'events', (
      select coalesce(json_agg(row_to_json(e) order by e.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, cover, target_amount, target_amount_enc, target_date, achieved, sort_order, source_txn_id, created_by
        from events where family_id = v_fid and archived_at is null) e),
    'event_fundings', (
      select coalesce(json_agg(row_to_json(ef)), '[]'::json) from (
        select id, event_id, goal_id, amount, amount_enc, source, month, member_id
        from event_fundings where family_id = v_fid) ef),
    'savings_entries', (
      select coalesce(json_agg(row_to_json(se)), '[]'::json) from (
        select kind, amount, amount_enc
        from savings_entries where family_id = v_fid) se),
    'event_memories', (
      select coalesce(json_agg(row_to_json(em) order by em.sort_order), '[]'::json) from (
        select id, event_id, emoji, caption, caption_enc, photo_url, sort_order
        from event_memories where family_id = v_fid) em),
    -- windowed to the in-window transactions (0048)
    'transaction_photos', (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) from (
        select transaction_id, photo_url
        from transaction_photos
        where family_id = v_fid
          and (p_txn_from is null or transaction_id in (
                select id from transactions
                where family_id = v_fid and txn_date >= p_txn_from))) tp),
    'incomes', (
      select coalesce(json_agg(row_to_json(inc)), '[]'::json) from (
        select amount, amount_enc, income_date
        from incomes where family_id = v_fid) inc),
    'saving_goals', (
      select coalesce(json_agg(row_to_json(sg) order by sg.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, target_amount, target_amount_enc, target_date, note, note_enc, occasion_id, achieved, sort_order, created_by
        from saving_goals where family_id = v_fid and archived_at is null) sg),
    -- windowed to the in-window transactions (0048)
    'reactions', (
      select coalesce(json_agg(row_to_json(rx) order by rx.created_at desc), '[]'::json) from (
        select id, transaction_id, member_id, emoji, created_at
        from reactions
        where family_id = v_fid
          and (p_txn_from is null or transaction_id in (
                select id from transactions
                where family_id = v_fid and txn_date >= p_txn_from))) rx),
    'request_reviews', (
      select coalesce(json_agg(row_to_json(rr) order by rr.created_at desc), '[]'::json) from (
        select id, entity_type, entity_id, member_id, emoji, created_at
        from request_reviews where family_id = v_fid) rr)
  ) into v_json;

  return v_json;
end $function$;

-- CREATE OR REPLACE preserves the existing ACL; re-grant is idempotent and keeps the
-- entrypoint callable by signed-in clients (matches 0022's grant).
grant execute on function public.get_family_snapshot(date) to authenticated;
