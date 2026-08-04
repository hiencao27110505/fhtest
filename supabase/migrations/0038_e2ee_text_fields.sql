-- ============================================================================
-- FamilyHub — 0038: E2EE for the remaining user-typed text fields
--
--   • event_memories.caption  — photo captions (free text, user-typed)
--   • categories.name         — custom category names describe spending habits
--   • members.name            — real names, including children's
--
-- Same DEK + AES-GCM + fhField()/fhRead() machinery as 0030. What differs is
-- the DB-side guard: unlike money columns (0033), these tables have legacy
-- plaintext rows that server-side flows still create — create_family seeds
-- categories, redeem_invite inserts a member row — and enc-from-birth families
-- (0032) already hold such rows. A strict 0033-style pair guard would reject
-- ANY later update touching those rows (mark_key_unlocked, archived_at, ...).
--
-- So the text guard is a one-way valve instead:
--   • INSERTs pass — server flows keep working; up-to-date clients always
--     attach ciphertext themselves; the client coverage job re-covers the rest.
--   • UPDATEs may not CHANGE a plaintext value without fresh ciphertext, and
--     in 'enc' a changed value may not materialize as plaintext at all.
--   • The scrub shape (pt -> null beside existing ct) passes, so the coverage
--     job and scrub_plaintext_amounts() can retire legacy plaintext anytime.
--
-- Also in this file, because they are single functions that must move together:
--   • scrub_plaintext_amounts(): the three tables join the uncovered-count and
--     the scrub, so "Hoàn tất" retires caption/name plaintext too.
--   • set_family_enc_state(): the dual->off abort wipes the new _enc columns.
--   • get_family_snapshot(): ships caption_enc / name_enc to the client.
--   • add_member()/update_member(): gain p_name_enc so member names can be
--     written encrypted; old 2/3-arg calls keep working via defaults.
--
-- Apply AFTER the matching client build is deployed (the client must be
-- attaching ciphertext to caption/name writes before the guard starts
-- rejecting plaintext renames from stale tabs).
-- ============================================================================

-- ── 1. ciphertext columns; plaintext becomes nullable (scrub target) ─────────
alter table public.event_memories add column if not exists caption_enc text;
alter table public.categories     add column if not exists name_enc    text;
alter table public.members        add column if not exists name_enc    text;
alter table public.categories alter column name drop not null;
alter table public.members    alter column name drop not null;

-- ── 2. the one-way valve ─────────────────────────────────────────────────────
create or replace function public._fh_enc_txt_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_state text; v_pt text; v_ct text; v_old_pt text; v_old_ct text; v_label text;
begin
  select enc_state into v_state from family_keys where family_id = new.family_id;
  if v_state is null or v_state = 'off' then return new; end if;

  if tg_table_name = 'categories' then
    v_pt := new.name; v_ct := new.name_enc; v_label := 'categories.name';
    if tg_op = 'UPDATE' then v_old_pt := old.name; v_old_ct := old.name_enc; end if;
  elsif tg_table_name = 'members' then
    v_pt := new.name; v_ct := new.name_enc; v_label := 'members.name';
    if tg_op = 'UPDATE' then v_old_pt := old.name; v_old_ct := old.name_enc; end if;
  elsif tg_table_name = 'event_memories' then
    v_pt := new.caption; v_ct := new.caption_enc; v_label := 'event_memories.caption';
    if tg_op = 'UPDATE' then v_old_pt := old.caption; v_old_ct := old.caption_enc; end if;
  else
    return new;
  end if;

  -- a CHANGED plaintext value must carry fresh ciphertext; in 'enc' a changed
  -- value may not be materialized as plaintext at all. Unchanged plaintext
  -- riding along (legacy rows touched for other columns) passes.
  if tg_op = 'UPDATE' and v_pt is not null and v_pt is distinct from v_old_pt then
    if v_ct is not distinct from v_old_ct then raise exception 'enc_required:%', v_label; end if;
    if v_state = 'enc' then raise exception 'enc_required:%', v_label; end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['categories','members','event_memories'] loop
    execute format('drop trigger if exists trg_%1$s_enc_txt_guard on public.%1$I;
                    create trigger trg_%1$s_enc_txt_guard before insert or update on public.%1$I
                      for each row execute function public._fh_enc_txt_guard()', t);
  end loop;
end $$;

-- ── 3. scrub: the three text fields join the count + the wipe (extends 0033) ─
create or replace function public.scrub_plaintext_amounts() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_fid uuid; v_cur text; v_counts json; v_unc int;
  n_tx int; n_inc int; n_se int; n_ef int; n_cb int; n_mb int; n_ev int; n_sg int;
  n_cat int; n_mem int; n_em int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can scrub'; end if;
  select enc_state into v_cur from family_keys where family_id = v_fid;
  if v_cur is distinct from 'dual' then raise exception 'scrub requires dual state'; end if;

  select
    (select count(*) from transactions    where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from incomes         where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from savings_entries where family_id = v_fid and ((amount is not null and amount_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from event_fundings  where family_id = v_fid and amount is not null and amount_enc is null)
  + (select count(*) from category_budgets where family_id = v_fid and amount is not null and amount_enc is null)
  + (select count(*) from monthly_budgets where family_id = v_fid and budget_total <> 0 and budget_total_enc is null)
  + (select count(*) from events          where family_id = v_fid and ((target_amount is not null and target_amount_enc is null) or (name is not null and name_enc is null)))
  + (select count(*) from saving_goals    where family_id = v_fid and ((target_amount is not null and target_amount_enc is null) or (name is not null and name_enc is null) or (note is not null and note_enc is null)))
  + (select count(*) from categories      where family_id = v_fid and name is not null and name_enc is null)
  + (select count(*) from members         where family_id = v_fid and name is not null and name_enc is null)
  + (select count(*) from event_memories  where family_id = v_fid and caption is not null and caption_enc is null)
  into v_unc;
  if v_unc > 0 then raise exception 'uncovered_rows:%', v_unc; end if;

  update transactions set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
  get diagnostics n_tx = row_count;
  update incomes set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
  get diagnostics n_inc = row_count;
  update savings_entries set amount = null, note = null
   where family_id = v_fid and amount_enc is not null and (amount is not null or note is not null);
  get diagnostics n_se = row_count;
  update event_fundings set amount = null
   where family_id = v_fid and amount_enc is not null and amount is not null;
  get diagnostics n_ef = row_count;
  update category_budgets set amount = null
   where family_id = v_fid and amount_enc is not null and amount is not null;
  get diagnostics n_cb = row_count;
  update monthly_budgets set budget_total = 0
   where family_id = v_fid and budget_total_enc is not null and budget_total <> 0;
  get diagnostics n_mb = row_count;
  update events
     set target_amount = case when target_amount_enc is not null then null else target_amount end,
         name          = case when name_enc          is not null then null else name          end
   where family_id = v_fid
     and ((target_amount_enc is not null and target_amount is not null)
       or (name_enc is not null and name is not null));
  get diagnostics n_ev = row_count;
  update saving_goals
     set target_amount = case when target_amount_enc is not null then null else target_amount end,
         name          = case when name_enc          is not null then null else name          end,
         note          = case when name_enc          is not null then null else note          end
   where family_id = v_fid
     and ((target_amount_enc is not null and target_amount is not null)
       or (name_enc is not null and (name is not null or note is not null)));
  get diagnostics n_sg = row_count;
  update categories set name = null
   where family_id = v_fid and name_enc is not null and name is not null;
  get diagnostics n_cat = row_count;
  update members set name = null
   where family_id = v_fid and name_enc is not null and name is not null;
  get diagnostics n_mem = row_count;
  update event_memories set caption = null
   where family_id = v_fid and caption_enc is not null and caption is not null;
  get diagnostics n_em = row_count;

  update family_keys set enc_state = 'enc' where family_id = v_fid;
  v_counts := json_build_object('transactions', n_tx, 'incomes', n_inc, 'savings_entries', n_se,
    'event_fundings', n_ef, 'category_budgets', n_cb, 'monthly_budgets', n_mb,
    'events', n_ev, 'saving_goals', n_sg,
    'categories', n_cat, 'members', n_mem, 'event_memories', n_em);
  return v_counts;
end $$;

-- ── 4. dual->off abort also wipes the new ciphertext columns (extends 0035) ──
create or replace function public.set_family_enc_state(p_state text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_cur text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can change encryption'; end if;
  select enc_state into v_cur from family_keys where family_id = v_fid;
  if v_cur is null then raise exception 'no_passcode'; end if;
  if v_cur = 'enc' then raise exception 'enc_permanent'; end if;
  if not ( (v_cur = 'off' and p_state = 'dual')
        or (v_cur = 'dual' and p_state = 'off') ) then
    raise exception 'bad_transition:% to %', v_cur, p_state;
  end if;
  if v_cur = 'dual' and p_state = 'off' then
    -- abort the trial: plaintext is authoritative, drop every ciphertext so a
    -- future enable starts from a clean slate
    update transactions     set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update incomes          set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update savings_entries  set amount_enc = null, note_enc = null      where family_id = v_fid and (amount_enc is not null or note_enc is not null);
    update event_fundings   set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update category_budgets set amount_enc = null                       where family_id = v_fid and amount_enc is not null;
    update monthly_budgets  set budget_total_enc = null                 where family_id = v_fid and budget_total_enc is not null;
    update events           set target_amount_enc = null, name_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null);
    update saving_goals     set target_amount_enc = null, name_enc = null, note_enc = null where family_id = v_fid and (target_amount_enc is not null or name_enc is not null or note_enc is not null);
    update categories       set name_enc = null                         where family_id = v_fid and name_enc is not null;
    update members          set name_enc = null                         where family_id = v_fid and name_enc is not null;
    update event_memories   set caption_enc = null                      where family_id = v_fid and caption_enc is not null;
  end if;
  update family_keys set enc_state = p_state where family_id = v_fid;
end $$;

-- ── 5. snapshot ships the new ciphertext columns (extends 0032) ──────────────
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

-- ── 6. member RPCs learn the encrypted shape (old callers keep working) ──────
-- Same-name overloads would leave 2-arg calls bound to the OLD function, so the
-- old signatures are dropped and recreated with p_name_enc defaulted.
drop function if exists public.add_member(text, text);
create or replace function public.add_member(p_name text, p_color text default null, p_name_enc text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = auth.uid();
  if not _is_owner(v_family) then raise exception 'only the owner can add members'; end if;
  if coalesce(p_name, p_name_enc) is null then raise exception 'member needs a name'; end if;
  insert into members (family_id, name, name_enc, color) values (v_family, p_name, p_name_enc, p_color) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.add_member(text, text, text) from public, anon;
grant  execute on function public.add_member(text, text, text) to authenticated;

drop function if exists public.update_member(uuid, text, text);
create or replace function public.update_member(p_member_id uuid, p_name text, p_color text default null, p_name_enc text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not (_is_owner(v_family) or v_user = auth.uid()) then raise exception 'you can only edit your own profile'; end if;
  if p_name_enc is not null then
    -- encrypted shape: p_name is the dual-state plaintext twin (null in 'enc')
    update members set name = p_name, name_enc = p_name_enc, color = coalesce(p_color, color) where id = p_member_id;
  else
    update members set name = coalesce(p_name, name), color = coalesce(p_color, color) where id = p_member_id;
  end if;
end $$;
revoke execute on function public.update_member(uuid, text, text, text) from public, anon;
grant  execute on function public.update_member(uuid, text, text, text) to authenticated;
