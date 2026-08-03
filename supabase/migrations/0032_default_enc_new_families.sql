-- ============================================================================
-- FamilyHub — 0032: encryption on by default for NEW families + unlock tracking
--
-- 1. set_family_passcode() gains p_enc_state ('off'|'enc', default 'off').
--    The create-family onboarding passes 'enc': a brand-new family has no
--    plaintext history, so there is nothing to dual-verify or migrate — it is
--    ciphertext-only from its very first write. Existing families keep the
--    staged off → dual → scrub path. 'enc' at set-time is guarded to families
--    with no transactions yet, so the shortcut can't skip the migration path.
--
-- 2. members.key_unlocked_at + mark_key_unlocked(): a device that successfully
--    unwraps the family DEK stamps its member row. Purely informational — it
--    lets the owner's encryption sheet show "who has entered the code" before
--    pressing the destructive scrub. Never used for authorization.
--
-- Applied to production (fhtest) via Supabase MCP on 2026-08-03.
-- ============================================================================

alter table public.members add column if not exists key_unlocked_at timestamptz;

-- device stamped in after a successful local DEK unwrap (fire-and-forget)
create or replace function public.mark_key_unlocked() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then return; end if;
  update members set key_unlocked_at = now()
   where family_id = v_fid and user_id = v_uid and is_shared = false;
end $$;
revoke execute on function public.mark_key_unlocked() from public, anon;
grant  execute on function public.mark_key_unlocked() to authenticated;

-- new signature replaces the 5-arg version (default keeps old callers working)
drop function if exists public.set_family_passcode(text, text, int, int, text);
create or replace function public.set_family_passcode(
  p_k_auth text, p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text,
  p_enc_state text default 'off'
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_fid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can set the passcode'; end if;
  if length(coalesce(p_k_auth,'')) not between 40 and 128 then raise exception 'bad key material'; end if;
  if coalesce(p_kdf_salt,'') = '' or coalesce(p_wrapped_dek,'') = '' or coalesce(p_kdf_iters,0) < 100000 then
    raise exception 'bad kdf parameters';
  end if;
  if p_enc_state not in ('off','enc') then raise exception 'bad enc_state'; end if;
  if p_enc_state = 'enc' and exists (select 1 from transactions where family_id = v_fid) then
    raise exception 'enc_at_set_requires_empty_family';     -- existing data must go through the staged path
  end if;
  if exists (select 1 from family_keys where family_id = v_fid) then
    raise exception 'passcode_already_set';
  end if;
  insert into family_keys (family_id, kdf_version, kdf_salt, kdf_iters, auth_hash, wrapped_dek, enc_state)
  values (v_fid, p_kdf_version, p_kdf_salt, p_kdf_iters, crypt(p_k_auth, gen_salt('bf', 10)), p_wrapped_dek, p_enc_state);
  -- the setter's device obviously holds the key
  update members set key_unlocked_at = now() where family_id = v_fid and user_id = v_uid and is_shared = false;
end $$;
revoke execute on function public.set_family_passcode(text, text, int, int, text, text) from public, anon;
grant  execute on function public.set_family_passcode(text, text, int, int, text, text) to authenticated;

-- snapshot: members now carry key_unlocked_at (feeds the owner's unlock roster)
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
    'enc', (
      select row_to_json(k) from (
        select enc_state, kdf_salt, kdf_iters, kdf_version, wrapped_dek
        from family_keys where family_id = v_fid) k),
    'members', (
      select coalesce(json_agg(row_to_json(m) order by m.created_at), '[]'::json) from (
        select id, name, color, is_shared, user_id, created_at, key_unlocked_at
        from members where family_id = v_fid and archived_at is null) m),
    'categories', (
      select coalesce(json_agg(row_to_json(c) order by c.sort_order), '[]'::json) from (
        select id, name, emoji, color, sort_order, archived_at
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
        select id, event_id, emoji, caption, photo_url, sort_order
        from event_memories where family_id = v_fid) em),
    'transaction_photos', (
      select coalesce(json_agg(row_to_json(tp)), '[]'::json) from (
        select transaction_id, photo_url
        from transaction_photos where family_id = v_fid) tp),
    'incomes', (
      select coalesce(json_agg(row_to_json(inc)), '[]'::json) from (
        select amount, amount_enc, income_date
        from incomes where family_id = v_fid) inc),
    'saving_goals', (
      select coalesce(json_agg(row_to_json(sg) order by sg.sort_order), '[]'::json) from (
        select id, name, name_enc, emoji, target_amount, target_amount_enc, target_date, note, note_enc, occasion_id, achieved, sort_order, created_by
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
