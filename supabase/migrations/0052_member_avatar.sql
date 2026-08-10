-- 0052_member_avatar.sql
-- Encrypted member avatars. members.avatar_url (a dead column since 0001) now
-- holds the storage PATH of an AES-GCM '.enc' object in family-media: the bytes
-- are the member's photo encrypted with the family DEK (imported once from their
-- Google photo, or uploaded in Settings → My profile). The PATH is plaintext,
-- exactly like transaction_photos.photo_url; the FACE never leaves the client
-- unencrypted, so a member stays as unidentifiable as their E2EE name_enc — no
-- plaintext googleusercontent URL is ever stored or fetched by the server.
--
-- Two changes, both backward compatible:
--   1. update_member gains p_avatar_url. null = leave unchanged, '' = clear,
--      any other value = set. The currently-deployed client calls the old 4-arg
--      shape; with the 4-arg dropped and only this 5-arg (p_avatar_url has a
--      default) present, those calls resolve here with p_avatar_url defaulted —
--      so nothing breaks during rollout, and there is no ambiguous overload.
--   2. get_family_snapshot ships members.avatar_url (purely additive column;
--      NULL p_txn_from output stays otherwise identical to 0048).

-- ── update_member: + p_avatar_url ──────────────────────────────────────────
drop function if exists public.update_member(uuid, text, text, text);
create or replace function public.update_member(
  p_member_id uuid,
  p_name      text,
  p_color     text default null,
  p_name_enc  text default null,
  p_avatar_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not (_is_owner(v_family) or v_user = auth.uid()) then raise exception 'you can only edit your own profile'; end if;
  if p_name_enc is not null then
    -- encrypted shape: p_name is the dual-state plaintext twin (null in 'enc')
    update members set
      name = p_name, name_enc = p_name_enc, color = coalesce(p_color, color),
      avatar_url = case when p_avatar_url is null then avatar_url
                        when p_avatar_url = ''   then null
                        else p_avatar_url end
      where id = p_member_id;
  else
    update members set
      name = coalesce(p_name, name), color = coalesce(p_color, color),
      avatar_url = case when p_avatar_url is null then avatar_url
                        when p_avatar_url = ''   then null
                        else p_avatar_url end
      where id = p_member_id;
  end if;
end $$;
revoke execute on function public.update_member(uuid, text, text, text, text) from public, anon;
grant  execute on function public.update_member(uuid, text, text, text, text) to authenticated;

-- ── get_family_snapshot: ship members.avatar_url (only the members select
--    changes vs 0048; the rest is verbatim so CREATE OR REPLACE is a no-op there) ──
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
        select id, name, name_enc, color, is_shared, user_id, created_at, key_unlocked_at, avatar_url
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

grant execute on function public.get_family_snapshot(date) to authenticated;
