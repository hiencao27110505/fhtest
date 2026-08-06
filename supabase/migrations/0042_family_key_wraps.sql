-- ============================================================================
-- FamilyHub — 0042: Key Card auth — the multi-wrap key table + card RPCs
--
-- The 128-bit Key Card replaces the 6-digit passcode as the "safe key" (see
-- KEY-CARD-AUTH-SPEC.md). This migration is ADDITIVE and DORMANT: it creates
-- the wrap table and the RPCs, and teaches get_family_snapshot to ship any
-- live wraps. Nothing writes a card wrap until the client's card flow runs, so
-- an existing family keeps unlocking via its passcode wrap (in family_keys)
-- exactly as before. No column on any existing table changes; the DEK, the
-- envelope, and every enc_state machine are untouched — this is an AUTH change.
--
-- Migration to the card (Phase C) seeds a 'passcode' wrap here from the legacy
-- family_keys row, then set_family_card() adds a 'card' wrap beside it (both
-- live at once). Phase D later rotates the passcode wrap out.
-- ============================================================================

create table if not exists public.family_key_wraps (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  kind         text not null check (kind in ('passcode','card','passkey')),
  kdf_salt     text not null,
  kdf_iters    int  not null,
  kdf_version  int  not null,
  wrapped_dek  text not null,          -- b64(iv‖AES-GCM(K_wrap, DEK)); same DEK as family_keys
  label        text,
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz             -- set when superseded; null = live
);
-- exactly one LIVE wrap per (family, kind); rotated ones don't count
create unique index if not exists family_key_wraps_live_kind
  on public.family_key_wraps (family_id, kind) where rotated_at is null;
create index if not exists family_key_wraps_family_idx
  on public.family_key_wraps (family_id) where rotated_at is null;

-- Members may read their family's wraps. A 128-bit wrap is ungrindable, so
-- exposing it to a joined member is safe (they still can't unwrap without the
-- card). All writes go through the SECURITY DEFINER RPCs below — no write policy.
alter table public.family_key_wraps enable row level security;
drop policy if exists fkw_select on public.family_key_wraps;
create policy fkw_select on public.family_key_wraps for select
  using (family_id = (select auth_family_id()));
grant select on public.family_key_wraps to authenticated;

-- realtime: a new/rotated wrap should reach other devices live (mirrors family_keys)
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.family_key_wraps';
  exception when duplicate_object then null; end;
  execute 'alter table public.family_key_wraps replica identity full';
end $$;

-- ── set_family_card: owner adds/replaces the family's card wrap ──────────────
-- Used at family creation and by the Phase C migration. Owner-only. Idempotent:
-- retires any existing live card wrap first, so a re-set never trips the unique
-- index. Never touches the DEK or any encrypted row.
create or replace function public.set_family_card(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text, p_label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can set the card'; end if;
  if length(coalesce(p_wrapped_dek,'')) < 20 or coalesce(p_kdf_salt,'') = '' or coalesce(p_kdf_iters,0) < 100000 then
    raise exception 'bad key material';
  end if;
  update family_key_wraps set rotated_at = now()
   where family_id = v_fid and kind = 'card' and rotated_at is null;
  insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek, label)
  values (v_fid, 'card', p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek, p_label)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.set_family_card(text, int, int, text, text) from public, anon;
grant  execute on function public.set_family_card(text, int, int, text, text) to authenticated;

-- ── rotate_family_card: regenerate the card (lost / leaked / member left) ────
-- Any keyed MEMBER may rotate (OQ3): producing a valid wrap already requires
-- holding the DEK, so this grants no new capability. Old card dies instantly.
create or replace function public.rotate_family_card(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text, p_label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not exists (select 1 from members where family_id = v_fid and user_id = v_uid and archived_at is null) then
    raise exception 'not a member';
  end if;
  if length(coalesce(p_wrapped_dek,'')) < 20 or coalesce(p_kdf_salt,'') = '' or coalesce(p_kdf_iters,0) < 100000 then
    raise exception 'bad key material';
  end if;
  update family_key_wraps set rotated_at = now()
   where family_id = v_fid and kind = 'card' and rotated_at is null;
  insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek, label)
  values (v_fid, 'card', p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek, p_label)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.rotate_family_card(text, int, int, text, text) from public, anon;
grant  execute on function public.rotate_family_card(text, int, int, text, text) to authenticated;

-- ── snapshot ships live wraps under `key_wraps` (extends 0038) ───────────────
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
    'key_wraps', (
      -- select created_at so the ORDER BY resolves, then drop it from the json
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
