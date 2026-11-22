-- DRAFT, NOT APPLIED. For Hien to review, number and apply (next free number
-- after checking AGENT_SYNC.md and origin/main; 0164 is reserved for
-- statement_formats). Written from the repo's migrations on 2026-11-22; the
-- live database was not read. Before applying, compare each function below
-- with pg_get_functiondef of the live one: if the live body differs from the
-- repo file named in the comment, merge by hand.
--
-- Spaces ("Nhóm"), docs/specs/spaces-spec.md sections 10, 11 and 16.
-- Everything here is additive or widens an existing guard. Nothing is dropped
-- except the 3-argument create_space, which is replaced by a 4-argument one.
--
-- What changes in behaviour the moment this is applied, before any client
-- ships: (1) a friend/trip space can be made the active container by
-- switch_family; no shipped client offers that except the family picker, where
-- tapping a space used to fail and now works. (2) auth_space_ids() covers
-- family memberships too, so the additive 0106a policies let a member read a
-- family they belong to while another container is active. Membership was
-- already the access rule; the active slot only chose which one hydrates.

-- ── 1. profile + closed ──────────────────────────────────────────────────────
-- Plaintext on purpose: booleans and one default mode. It says what a space can
-- do, never what anyone did. '{}' means "the preset's defaults" (client-side).
alter table public.families add column if not exists profile   jsonb not null default '{}'::jsonb;
alter table public.families add column if not exists closed_at timestamptz;

-- ── 2. the next container to make active when the current one goes away ──────
-- Families first, then other spaces, oldest first. Never the personal ledger.
create or replace function public._next_active_space(p_uid uuid, p_exclude uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select f.id
    from families f
    join members m on m.family_id = f.id and m.user_id = p_uid and m.archived_at is null
   where f.archived_at is null
     and f.type <> 'personal'
     and (p_exclude is null or f.id <> p_exclude)
   order by (f.type = 'family') desc, f.created_at
   limit 1;
$$;
revoke execute on function public._next_active_space(uuid, uuid) from public, anon, authenticated;

-- ── 3. switch_family: any space the caller belongs to (was: type = 'family') ─
-- Base: 0078_personal_ledger_metrics_guards.sql:168
create or replace function public.switch_family(p_family_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from members where family_id = p_family_id and user_id = v_uid and archived_at is null)
     or exists (select 1 from families where id = p_family_id and (archived_at is not null or type = 'personal')) then
    raise exception 'you are not a member of that family';
  end if;
  update profiles set family_id = p_family_id where id = v_uid;
end $function$;

-- ── 4. leave_family: acts on the active slot, so it now meets spaces ─────────
-- Base: 0078:151. Two changes: the owner of a friend/trip space cannot leave it
-- (leave_space's rule, which this path used to bypass), and the next active
-- container is any remaining membership, not only a family.
create or replace function public.leave_family()
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_family uuid; v_next uuid; v_type text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'no active family'; end if;
  select type into v_type from families where id = v_family;
  if v_type in ('friend','trip') and _is_owner(v_family) then raise exception 'owner_cannot_leave'; end if;
  update members set archived_at = now() where family_id = v_family and user_id = v_uid;
  v_next := _next_active_space(v_uid, v_family);
  update profiles set family_id = v_next where id = v_uid;
  return v_next;
end $function$;

-- ── 5. leave_space: also frees the active slot if it pointed here ────────────
-- Base: 0106a_space_rls_and_rpcs.sql:185
create or replace function public.leave_space(p_family_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_type text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if _is_owner(p_family_id) then raise exception 'owner_cannot_leave'; end if;
  update members set archived_at = now()
   where family_id = p_family_id and user_id = v_uid and archived_at is null;
  update profiles set family_id = _next_active_space(v_uid, p_family_id)
   where id = v_uid and family_id = p_family_id;
end $$;

-- ── 6. archive_family / archive_member: hand each person their next space ────
-- Base: 0010_income_savings_members.sql:56 and :66. Was: family_id = null,
-- which strands a person who still belongs to other spaces on the picker.
create or replace function public.archive_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can archive the family'; end if;
  update families set archived_at = now() where id = p_family_id;
  update profiles p set family_id = _next_active_space(p.id, p_family_id) where p.family_id = p_family_id;
end $$;

create or replace function public.archive_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not _is_owner(v_family) then raise exception 'only the owner can remove members'; end if;
  if v_user = auth.uid() then raise exception 'owner_cannot_leave'; end if;
  update members set archived_at = now() where id = p_member_id;
  if v_user is not null then
    update profiles set family_id = _next_active_space(v_user, v_family) where id = v_user and family_id = v_family;
  end if;
end $$;
-- NOTE for review: the "owner cannot remove themselves" line is new. Drop it if
-- a family owner archiving their own seat is a path you rely on.

-- ── 7. create_space: carries a profile ───────────────────────────────────────
-- Base: 0106a:70. The 3-argument form is dropped so a 3-named-argument call
-- cannot be ambiguous with the new default. Old clients calling
-- create_space(p_name, p_type, p_idempotency_key) keep working: the fourth
-- argument defaults.
drop function if exists public.create_space(text, text, uuid);
create or replace function public.create_space(
  p_name text,
  p_type text default 'friend',
  p_idempotency_key uuid default null,
  p_profile jsonb default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid;
  v_prof profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_type not in ('friend','trip') then raise exception 'bad_space_type'; end if;
  if length(trim(coalesce(p_name,''))) < 1 then raise exception 'bad_name'; end if;
  if p_profile is not null and (jsonb_typeof(p_profile) <> 'object' or length(p_profile::text) > 2000) then
    raise exception 'bad_profile';
  end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_idempotency_key::text, 0));
    select family_id into v_fid
      from family_creation_keys
     where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_fid; end if;
  end if;

  select * into v_prof from profiles where id = v_uid;

  insert into families (name, owner_id, type, profile)
  values (trim(p_name), v_uid, p_type, coalesce(p_profile, '{}'::jsonb)) returning id into v_fid;

  -- no profiles update (the client switches in after the card is set),
  -- no 'Chung' shared member
  insert into members (family_id, user_id, name, is_shared)
  values (v_fid, v_uid, coalesce(v_prof.display_name, 'Me'), false);

  perform seed_default_categories(v_fid, 'vi');

  if p_idempotency_key is not null then
    insert into family_creation_keys (user_id, idempotency_key, family_id)
    values (v_uid, p_idempotency_key, v_fid);
  end if;

  return v_fid;
end $$;
revoke execute on function public.create_space(text, text, uuid, jsonb) from public, anon;
grant  execute on function public.create_space(text, text, uuid, jsonb) to authenticated;

-- ── 8. space_update: owner renames or changes the switches ───────────────────
-- Works for a family too (its profile switches), never for the personal ledger.
create or replace function public.space_update(p_family_id uuid, p_name text default null, p_profile jsonb default null)
returns json
language plpgsql security definer
set search_path = public
as $$
declare v_type text; v_row families;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type = 'personal' then raise exception 'no_such_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can change this'; end if;
  if p_name is not null and length(trim(p_name)) < 1 then raise exception 'bad_name'; end if;
  if p_profile is not null and (jsonb_typeof(p_profile) <> 'object' or length(p_profile::text) > 2000) then
    raise exception 'bad_profile';
  end if;
  update families
     set name    = coalesce(nullif(trim(p_name), ''), name),
         profile = coalesce(p_profile, profile)
   where id = p_family_id
   returning * into v_row;
  return json_build_object('family_id', v_row.id, 'name', v_row.name, 'profile', v_row.profile);
end $$;
revoke execute on function public.space_update(uuid, text, jsonb) from public, anon;
grant  execute on function public.space_update(uuid, text, jsonb) to authenticated;

-- ── 9. my_families: profile, member count, closed ────────────────────────────
-- Base: 0076_personal_ledger.sql:98. Additive keys only.
create or replace function public.my_families() returns json
language sql stable security definer set search_path to 'public' as $$
  select coalesce(json_agg(json_build_object(
    'family_id', f.id, 'name', f.name,
    'type',      f.type,
    'is_owner',  (f.owner_id = auth.uid()),
    'is_active', (f.id = (select family_id from profiles where id = auth.uid())),
    'profile',   f.profile,
    'closed',    (f.closed_at is not null),
    'members',   (select count(*) from members m2
                   where m2.family_id = f.id and m2.archived_at is null and m2.is_shared = false)
  ) order by f.created_at), '[]'::json)
  from families f
  where f.archived_at is null
    and exists (select 1 from members m where m.family_id = f.id and m.user_id = auth.uid() and m.archived_at is null);
$$;

-- ── 10. auth_space_ids: every membership except the personal ledger ──────────
-- Base: 0106a:21 (was: type in ('friend','trip')). This is what lets the Nhóm
-- section read a space that is not the active one, and lets review file a
-- captured row into it. The policies that use it (0106a, 0107) are unchanged.
create or replace function public.auth_space_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select f.id
  from families f
  join members m on m.family_id = f.id
               and m.user_id = auth.uid()
               and m.archived_at is null
  where f.archived_at is null
    and f.type <> 'personal';
$$;

-- ── 11. lifecycle: close, remove a member, cancel an invite ──────────────────
create or replace function public.space_close(p_family_id uuid, p_closed boolean default true)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_type text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can close the space'; end if;
  update families set closed_at = case when p_closed then coalesce(closed_at, now()) else null end
   where id = p_family_id;
end $$;
-- A closed space is read-only in the client. The table policies are not
-- tightened here: members are trusted with their space, as in a family.

create or replace function public.space_remove_member(p_family_id uuid, p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_type text; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can remove members'; end if;
  select user_id into v_user from members where id = p_member_id and family_id = p_family_id and archived_at is null;
  if not found then raise exception 'member not found'; end if;
  if v_user = auth.uid() then raise exception 'owner_cannot_leave'; end if;
  -- the row stays (archived): their name and balance remain on the record
  update members set archived_at = now() where id = p_member_id;
  if v_user is not null then
    update profiles set family_id = _next_active_space(v_user, p_family_id) where id = v_user and family_id = p_family_id;
  end if;
end $$;

create or replace function public.space_whitelist_cancel(p_family_id uuid, p_email text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare v_type text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can cancel an invite'; end if;
  update invitations set status = 'expired', updated_at = now()
   where family_id = p_family_id and lower(invited_email) = lower(trim(coalesce(p_email,''))) and status = 'pending';
  return space_whitelist_list(p_family_id);
end $$;
-- NOTE for review: 'expired' is used because it is a status the invitations
-- check already allows in the repo. If a 'revoked' status exists live, prefer it.

revoke execute on function public.space_close(uuid, boolean)          from public, anon;
revoke execute on function public.space_remove_member(uuid, uuid)     from public, anon;
revoke execute on function public.space_whitelist_cancel(uuid, text)  from public, anon;
grant  execute on function public.space_close(uuid, boolean)          to authenticated;
grant  execute on function public.space_remove_member(uuid, uuid)     to authenticated;
grant  execute on function public.space_whitelist_cancel(uuid, text)  to authenticated;

-- ── Deliberately NOT changed ─────────────────────────────────────────────────
-- * The three join RPCs (0106b): joining a space still does not make it active.
-- * get_family_snapshot (0158): the client reads type and profile from
--   my_families, so the snapshot body is untouched.
-- * txn_shares / settle_ups (0107): unchanged. The member subset and the count
--   of outside shares live inside shares_enc (ciphertext).
-- * Founder metrics (0078): still count type = 'family' only.
-- * Family-only RPCs that act on the active slot (add_member, the passcode and
--   card functions, set_family_staging_key, set_family_house …): the client
--   does not offer them in a friend space. They are not guarded server-side;
--   a member of a friend space calling them by hand affects only that space.
-- * get_or_create_mailbox_alias (0118) picks a member row with no type filter
--   and no ORDER BY. That is older than this work and worth its own fix.
