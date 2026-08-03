-- ============================================================================
-- FamilyHub — 0030: E2EE family finances + passcode door (strict whitelist+code)
--
-- The passcode is a 6-digit family secret that (a) gates joining and (b) wraps
-- the family's data-encryption key (DEK). The server NEVER sees the passcode:
-- the client stretches it (PBKDF2) and HKDF-splits the result into
--   • K_auth — sent on join, stored only as a bcrypt hash (the door check)
--   • K_wrap — never leaves the device, unwraps the DEK (the safe key)
-- Knowing K_auth reveals nothing about K_wrap (HKDF domain separation), so a
-- server that verifies the door still cannot open the safe.
--
-- Joining is STRICT two-factor: the email must be whitelisted by the owner
-- (a pending invitations row) AND the passcode must verify. join_mode exists
-- so a later product decision can relax to "whitelist opens the door, passcode
-- opens the safe" without a schema change.
--
-- Data encryption is per-family and staged (enc_state):
--   'off'  — plaintext only (default; today's behaviour)
--   'dual' — ciphertext written ALONGSIDE plaintext (verification window)
--   'enc'  — plaintext scrubbed; ciphertext is the only copy
-- The scrub is a separate, owner-only, deliberate RPC — never automatic.
--
-- Applied to production (fhtest) via Supabase MCP on 2026-08-03.
-- Paired revert: 0031_revert_e2ee.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. family_keys — one row per family once a passcode is set
-- ---------------------------------------------------------------------------
create table if not exists public.family_keys (
  family_id   uuid primary key references public.families(id) on delete cascade,
  kdf_version int  not null default 1,
  kdf_salt    text not null,                -- hex, generated client-side
  kdf_iters   int  not null,
  auth_hash   text not null,                -- crypt(K_auth, bf) — never the passcode
  wrapped_dek text not null,                -- b64(iv‖AES-GCM(K_wrap, DEK))
  enc_state   text not null default 'off' check (enc_state in ('off','dual','enc')),
  join_mode   text not null default 'strict' check (join_mode in ('strict','open_door')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_family_keys_updated on public.family_keys;
create trigger trg_family_keys_updated before update on public.family_keys
  for each row execute function set_updated_at();

-- Members may read their family's row (the wrapped DEK is protected by the
-- passcode; members are exactly the people the passcode is shared with).
-- All writes go through the SECURITY DEFINER RPCs below — no write policies.
alter table public.family_keys enable row level security;
create policy family_keys_select on public.family_keys
  for select using (family_id = ( select auth_family_id()));
grant select on public.family_keys to authenticated;

-- realtime: enc_state / passcode changes should reach other devices live
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.family_keys';
  exception when duplicate_object then null; end;
  execute 'alter table public.family_keys replica identity full';
end $$;

-- ---------------------------------------------------------------------------
-- 2. passcode_attempts — online-guessing throttle (5 tries / 15 min / user+family)
--    Invisible to clients: RLS on, no policies, no grants; only the definer
--    functions touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.passcode_attempts (
  id           bigint generated always as identity primary key,
  family_id    uuid not null references public.families(id) on delete cascade,
  user_id      uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists passcode_attempts_pair_idx
  on public.passcode_attempts (family_id, user_id, attempted_at);
alter table public.passcode_attempts enable row level security;

-- throttle guard: REPORTS the lockout (0 = ok, >0 = seconds remaining) rather
-- than raising — callers must be able to commit the failed-attempt row, and an
-- exception would roll the RPC's whole transaction (including that row) back.
create or replace function public._fh_passcode_gate(p_family uuid, p_uid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_oldest timestamptz;
begin
  -- opportunistic prune so the table never grows
  delete from passcode_attempts
   where family_id = p_family and user_id = p_uid and attempted_at < now() - interval '1 hour';
  select count(*), min(attempted_at) into v_n, v_oldest
    from passcode_attempts
   where family_id = p_family and user_id = p_uid and attempted_at > now() - interval '15 minutes';
  if v_n >= 5 then
    return greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - now())))::int);
  end if;
  return 0;
end $$;
revoke execute on function public._fh_passcode_gate(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ciphertext columns beside every money/name/note column in scope.
--    Plaintext columns become nullable; either-or presence checks keep rows sane.
--    (events.target_amount is already nullable+checked since 0019.)
-- ---------------------------------------------------------------------------
alter table public.transactions add column if not exists amount_enc text;
alter table public.transactions add column if not exists note_enc   text;
alter table public.transactions alter column amount drop not null;
alter table public.transactions drop constraint if exists transactions_amount_check;
alter table public.transactions add constraint transactions_amount_check
  check (amount is null or amount > 0);
alter table public.transactions drop constraint if exists transactions_amount_presence;
alter table public.transactions add constraint transactions_amount_presence
  check (amount is not null or amount_enc is not null);

alter table public.incomes add column if not exists amount_enc text;
alter table public.incomes add column if not exists note_enc   text;
alter table public.incomes alter column amount drop not null;
alter table public.incomes drop constraint if exists incomes_amount_check;
alter table public.incomes add constraint incomes_amount_check
  check (amount is null or amount > 0);
alter table public.incomes drop constraint if exists incomes_amount_presence;
alter table public.incomes add constraint incomes_amount_presence
  check (amount is not null or amount_enc is not null);

alter table public.savings_entries add column if not exists amount_enc text;
alter table public.savings_entries add column if not exists note_enc   text;
alter table public.savings_entries alter column amount drop not null;
alter table public.savings_entries drop constraint if exists savings_entries_amount_check;
alter table public.savings_entries add constraint savings_entries_amount_check
  check (amount is null or amount > 0);
alter table public.savings_entries drop constraint if exists savings_entries_amount_presence;
alter table public.savings_entries add constraint savings_entries_amount_presence
  check (amount is not null or amount_enc is not null);

alter table public.event_fundings add column if not exists amount_enc text;
alter table public.event_fundings alter column amount drop not null;
alter table public.event_fundings drop constraint if exists event_fundings_amount_check;
alter table public.event_fundings add constraint event_fundings_amount_check
  check (amount is null or amount > 0);
alter table public.event_fundings drop constraint if exists event_fundings_amount_presence;
alter table public.event_fundings add constraint event_fundings_amount_presence
  check (amount is not null or amount_enc is not null);

alter table public.category_budgets add column if not exists amount_enc text;
alter table public.category_budgets alter column amount drop not null;
alter table public.category_budgets drop constraint if exists category_budgets_amount_check;
alter table public.category_budgets add constraint category_budgets_amount_check
  check (amount is null or amount > 0);
alter table public.category_budgets drop constraint if exists category_budgets_amount_presence;
alter table public.category_budgets add constraint category_budgets_amount_presence
  check (amount is not null or amount_enc is not null);

-- monthly cap: keep NOT NULL DEFAULT 0 (0 is the scrubbed placeholder; readers
-- prefer budget_total_enc whenever the family is in 'enc' state)
alter table public.monthly_budgets add column if not exists budget_total_enc text;

alter table public.events add column if not exists target_amount_enc text;
alter table public.events add column if not exists name_enc          text;
alter table public.events alter column name drop not null;
alter table public.events drop constraint if exists events_name_presence;
alter table public.events add constraint events_name_presence
  check (name is not null or name_enc is not null);

alter table public.saving_goals add column if not exists target_amount_enc text;
alter table public.saving_goals add column if not exists name_enc          text;
alter table public.saving_goals add column if not exists note_enc          text;
alter table public.saving_goals alter column target_amount drop not null;
alter table public.saving_goals alter column name drop not null;
alter table public.saving_goals drop constraint if exists saving_goals_target_amount_check;
alter table public.saving_goals add constraint saving_goals_target_amount_check
  check (target_amount is null or target_amount > 0);
alter table public.saving_goals drop constraint if exists saving_goals_name_presence;
alter table public.saving_goals add constraint saving_goals_name_presence
  check (name is not null or name_enc is not null);

-- ---------------------------------------------------------------------------
-- 4. Passcode lifecycle RPCs
-- ---------------------------------------------------------------------------
-- First-time setup (owner of the ACTIVE family). Refuses to overwrite: an
-- existing row holds the only wrap of the DEK — changes go through
-- change_family_passcode so the old code is always verified first.
create or replace function public.set_family_passcode(
  p_k_auth text, p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text
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
  if exists (select 1 from family_keys where family_id = v_fid) then
    raise exception 'passcode_already_set';
  end if;
  insert into family_keys (family_id, kdf_version, kdf_salt, kdf_iters, auth_hash, wrapped_dek)
  values (v_fid, p_kdf_version, p_kdf_salt, p_kdf_iters, crypt(p_k_auth, gen_salt('bf', 10)), p_wrapped_dek);
end $$;

-- Passcode change (owner): verify the old K_auth (throttled), swap in the new
-- verifier + the client-re-wrapped DEK in one atomic row update. The DEK itself
-- never changes here, so other members' cached keys stay valid.
-- wrong_passcode / locked_out come back as PAYLOAD values ({error: ...}), not
-- exceptions — the failed-attempt row must commit for the throttle to work.
create or replace function public.change_family_passcode(
  p_old_k_auth text, p_new_k_auth text,
  p_new_kdf_salt text, p_new_kdf_iters int, p_new_kdf_version int, p_new_wrapped_dek text
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_row family_keys; v_lock int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can change the passcode'; end if;
  select * into v_row from family_keys where family_id = v_fid;
  if not found then raise exception 'no_passcode'; end if;
  if length(coalesce(p_new_k_auth,'')) not between 40 and 128 then raise exception 'bad key material'; end if;
  if coalesce(p_new_kdf_salt,'') = '' or coalesce(p_new_wrapped_dek,'') = '' or coalesce(p_new_kdf_iters,0) < 100000 then
    raise exception 'bad kdf parameters';
  end if;
  v_lock := _fh_passcode_gate(v_fid, v_uid);
  if v_lock > 0 then return json_build_object('error', 'locked_out', 'retry_secs', v_lock); end if;
  if v_row.auth_hash <> crypt(p_old_k_auth, v_row.auth_hash) then
    insert into passcode_attempts (family_id, user_id) values (v_fid, v_uid);
    return json_build_object('error', 'wrong_passcode');
  end if;
  delete from passcode_attempts where family_id = v_fid and user_id = v_uid;
  update family_keys
     set kdf_version = p_new_kdf_version, kdf_salt = p_new_kdf_salt, kdf_iters = p_new_kdf_iters,
         auth_hash = crypt(p_new_k_auth, gen_salt('bf', 10)), wrapped_dek = p_new_wrapped_dek
   where family_id = v_fid;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Whitelist RPCs (owner-managed email list = pending invitations rows)
-- ---------------------------------------------------------------------------
create or replace function public.whitelist_list() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'email', i.invited_email, 'expires_at', i.expires_at) order by i.created_at desc), '[]'::json)
  from invitations i
  where i.family_id = (select family_id from profiles where id = auth.uid())
    and i.status = 'pending' and i.invited_email is not null and i.expires_at > now();
$$;

create or replace function public.whitelist_add(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_email text := lower(trim(coalesce(p_email,'')));
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can invite'; end if;
  if position('@' in v_email) < 2 or length(v_email) < 5 then raise exception 'bad_email'; end if;
  if not exists (select 1 from family_keys where family_id = v_fid) then raise exception 'no_passcode'; end if;
  -- already a member of this family?
  if exists (select 1 from members m join profiles p on p.id = m.user_id
              where m.family_id = v_fid and m.archived_at is null and lower(p.email) = v_email) then
    raise exception 'already_member';
  end if;
  insert into invitations (family_id, invited_email, invited_by)
  values (v_fid, v_email, v_uid)
  on conflict (family_id, lower(invited_email)) where (status = 'pending')
    do update set expires_at = now() + interval '14 days', updated_at = now();
  return whitelist_list();
end $$;

create or replace function public.whitelist_remove(p_email text) returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_email text := lower(trim(coalesce(p_email,'')));
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can manage invites'; end if;
  update invitations set status = 'revoked', updated_at = now()
   where family_id = v_fid and status = 'pending' and lower(invited_email) = v_email;
  return whitelist_list();
end $$;

-- ---------------------------------------------------------------------------
-- 6. Joining: find my pending invite, then the strict door
-- ---------------------------------------------------------------------------
-- What the signed-in user needs BEFORE authenticating: which family invited
-- them + the KDF recipe so the client can derive K_auth/K_wrap. Salts and KDF
-- params are not secrets; the wrapped DEK is NOT returned here.
create or replace function public.find_my_invite() returns json
language sql stable security definer set search_path = public as $$
  select case when i.id is null then null else json_build_object(
    'family_id',   i.family_id,
    'family_name', f.name,
    'invited_by',  coalesce(pr.display_name, 'the owner'),
    'passcode_set', (k.family_id is not null),
    'kdf_salt',    k.kdf_salt,
    'kdf_iters',   k.kdf_iters,
    'kdf_version', k.kdf_version
  ) end
  from (
    select * from invitations
     where lower(invited_email) = auth_email() and status = 'pending' and expires_at > now()
     order by created_at desc limit 1
  ) i
  left join families    f  on f.id = i.family_id
  left join family_keys k  on k.family_id = i.family_id
  left join profiles    pr on pr.id = i.invited_by;
$$;

-- The strict door: whitelisted email AND verified passcode, throttled.
-- Success attaches membership (multi-family aware, mirrors 0007's redeem) and
-- hands back the wrapped DEK + KDF recipe so the device can unlock the safe.
create or replace function public.join_with_passcode(p_family_id uuid, p_k_auth text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid(); v_email text := auth_email();
  v_inv invitations; v_row family_keys; v_prof profiles; v_name text; v_lock int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations
   where family_id = p_family_id and lower(invited_email) = v_email and status = 'pending'
   order by created_at desc limit 1;
  if not found then raise exception 'not_whitelisted'; end if;
  if v_inv.expires_at < now() then
    update invitations set status = 'expired' where id = v_inv.id;
    raise exception 'invite_expired';
  end if;
  select * into v_row from family_keys where family_id = p_family_id;
  if not found then raise exception 'no_passcode'; end if;
  v_lock := _fh_passcode_gate(p_family_id, v_uid);
  if v_lock > 0 then return json_build_object('error', 'locked_out', 'retry_secs', v_lock); end if;
  if v_row.auth_hash <> crypt(p_k_auth, v_row.auth_hash) then
    insert into passcode_attempts (family_id, user_id) values (p_family_id, v_uid);
    return json_build_object('error', 'wrong_passcode');
  end if;
  delete from passcode_attempts where family_id = p_family_id and user_id = v_uid;

  select * into v_prof from profiles where id = v_uid;
  update profiles set family_id = p_family_id where id = v_uid;
  if not exists (select 1 from members where family_id = p_family_id and user_id = v_uid) then
    if v_inv.member_id is not null then
      update members set user_id = v_uid where id = v_inv.member_id and family_id = p_family_id;
    else
      insert into members (family_id, user_id, name, is_shared)
      values (p_family_id, v_uid, coalesce(v_prof.display_name, v_email, 'Member'), false);
    end if;
  end if;
  update invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;

  select name into v_name from families where id = p_family_id;
  return json_build_object(
    'family_id', p_family_id, 'family_name', v_name,
    'wrapped_dek', v_row.wrapped_dek, 'enc_state', v_row.enc_state,
    'kdf_salt', v_row.kdf_salt, 'kdf_iters', v_row.kdf_iters, 'kdf_version', v_row.kdf_version);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Encryption state machine
-- ---------------------------------------------------------------------------
-- Reversible transitions only: off→dual (opt in), dual→off (abort/decrypt-back
-- finished), enc→dual (decrypt-back started: client re-materializes plaintext).
-- dual→enc is EXCLUSIVELY the scrub RPC below.
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
  if not ( (v_cur = 'off' and p_state = 'dual')
        or (v_cur = 'dual' and p_state = 'off')
        or (v_cur = 'enc' and p_state = 'dual') ) then
    raise exception 'bad_transition:%→%', v_cur, p_state;
  end if;
  update family_keys set enc_state = p_state where family_id = v_fid;
end $$;

-- The one destructive step, deliberately separate. Owner-only, only from
-- 'dual', and only rows that HAVE ciphertext lose their plaintext — bank-import
-- or legacy rows without ciphertext are untouched.
create or replace function public.scrub_plaintext_amounts() returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_fid uuid; v_cur text; v_counts json;
  n_tx int; n_inc int; n_se int; n_ef int; n_cb int; n_mb int; n_ev int; n_sg int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can scrub'; end if;
  select enc_state into v_cur from family_keys where family_id = v_fid;
  if v_cur is distinct from 'dual' then raise exception 'scrub requires dual state'; end if;

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

  update family_keys set enc_state = 'enc' where family_id = v_fid;
  v_counts := json_build_object('transactions', n_tx, 'incomes', n_inc, 'savings_entries', n_se,
    'event_fundings', n_ef, 'category_budgets', n_cb, 'monthly_budgets', n_mb,
    'events', n_ev, 'saving_goals', n_sg);
  return v_counts;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Snapshot: pass the ciphertext columns through + the family's enc recipe
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
        select id, name, color, is_shared, user_id, created_at
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

-- ---------------------------------------------------------------------------
-- 9. Grants + retiring the code-invite door
-- ---------------------------------------------------------------------------
revoke execute on function public.set_family_passcode(text, text, int, int, text)                    from public, anon;
revoke execute on function public.change_family_passcode(text, text, text, int, int, text)          from public, anon;
revoke execute on function public.whitelist_list()                                                  from public, anon;
revoke execute on function public.whitelist_add(text)                                               from public, anon;
revoke execute on function public.whitelist_remove(text)                                            from public, anon;
revoke execute on function public.find_my_invite()                                                  from public, anon;
revoke execute on function public.join_with_passcode(uuid, text)                                    from public, anon;
revoke execute on function public.set_family_enc_state(text)                                        from public, anon;
revoke execute on function public.scrub_plaintext_amounts()                                         from public, anon;
revoke execute on function public.get_family_snapshot(date)                                         from public, anon;
grant execute on function public.set_family_passcode(text, text, int, int, text)                    to authenticated;
grant execute on function public.change_family_passcode(text, text, text, int, int, text)           to authenticated;
grant execute on function public.whitelist_list()                                                   to authenticated;
grant execute on function public.whitelist_add(text)                                                to authenticated;
grant execute on function public.whitelist_remove(text)                                             to authenticated;
grant execute on function public.find_my_invite()                                                   to authenticated;
grant execute on function public.join_with_passcode(uuid, text)                                     to authenticated;
grant execute on function public.set_family_enc_state(text)                                         to authenticated;
grant execute on function public.scrub_plaintext_amounts()                                          to authenticated;
grant execute on function public.get_family_snapshot(date)                                          to authenticated;

-- The 6-char code door is replaced by whitelist+passcode. Old clients lose the
-- invite/join buttons only; everything else keeps working.
revoke execute on function public.create_invite(uuid)     from public, anon, authenticated;
revoke execute on function public.redeem_invite(text)     from public, anon, authenticated;
revoke execute on function public.regenerate_invite(uuid) from public, anon, authenticated;

-- retire outstanding code invites (invited_email null = code rows)
update public.invitations set status = 'expired', updated_at = now()
 where status = 'pending' and invited_email is null;
