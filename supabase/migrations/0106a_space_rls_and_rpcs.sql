-- 0106a_space_rls_and_rpcs.sql
-- Friend/trip spaces become usable WITHOUT ever being the active family — part 1 of 2.
-- (0106 was applied to the live DB as two migrations, a/b; the repo mirrors that.)
--
-- The gap this closes: every family-table policy gates on auth_family_id()
-- (the active-family slot in profiles), and switch_family (0078) hard-rejects
-- type <> 'family' — correct, since hydrate/mailbox/metrics key off the active
-- slot. So a friend space was legal in the schema (families_type_check already
-- allows 'friend'/'trip') but completely unreadable by its members.
--
-- This half is purely ADDITIVE: a membership-based space resolver, new
-- permissive policies (existing policies untouched — verified all-permissive
-- in pg_policy, so new policies OR in cleanly), and the space lifecycle RPCs
-- (explicit-fid twins of the active-family-bound family versions).
--
-- Deliberately NOT granted to space members: incomes, budgets, events, photos,
-- goals — a friend space is a split ledger, not a second family.

-- 1 ▸ membership-based space resolution (friend/trip only, never 'family' —
--     family access stays exclusively active-slot-gated)
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
    and f.type in ('friend','trip');
$$;

-- 2 ▸ additive space-access policies
drop policy if exists tx_space_all on public.transactions;
create policy tx_space_all on public.transactions
  for all to authenticated
  using (family_id in (select auth_space_ids()))
  with check (family_id in (select auth_space_ids()));

drop policy if exists cat_space_select on public.categories;
create policy cat_space_select on public.categories
  for select to authenticated
  using (family_id in (select auth_space_ids()));

drop policy if exists cat_space_insert on public.categories;
create policy cat_space_insert on public.categories
  for insert to authenticated
  with check (family_id in (select auth_space_ids()));

drop policy if exists members_space_select on public.members;
create policy members_space_select on public.members
  for select to authenticated
  using (family_id in (select auth_space_ids()));

drop policy if exists fk_space_select on public.family_keys;
create policy fk_space_select on public.family_keys
  for select to authenticated
  using (family_id in (select auth_space_ids()));

drop policy if exists fkw_space_select on public.family_key_wraps;
create policy fkw_space_select on public.family_key_wraps
  for select to authenticated
  using (family_id in (select auth_space_ids()));

-- 3 ▸ creation + card + invites for spaces (never touch the active-family
--     slot; spaces are enc-from-birth via the card)

create or replace function public.create_space(
  p_name text,
  p_type text default 'friend',
  p_idempotency_key uuid default null
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

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_idempotency_key::text, 0));
    select family_id into v_fid
      from family_creation_keys
     where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return v_fid; end if;
  end if;

  select * into v_prof from profiles where id = v_uid;

  insert into families (name, owner_id, type)
  values (trim(p_name), v_uid, p_type) returning id into v_fid;

  -- no profiles update, no 'Chung' shared member — a space is not a family
  insert into members (family_id, user_id, name, is_shared)
  values (v_fid, v_uid, coalesce(v_prof.display_name, 'Me'), false);

  perform seed_default_categories(v_fid, 'vi');

  if p_idempotency_key is not null then
    insert into family_creation_keys (user_id, idempotency_key, family_id)
    values (v_uid, p_idempotency_key, v_fid);
  end if;

  return v_fid;
end $$;

create or replace function public.init_space_card(
  p_family_id uuid,
  p_kdf_salt text, p_kdf_iters integer, p_kdf_version integer, p_wrapped_dek text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_type text; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null then raise exception 'no_such_space'; end if;
  if v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can set the card'; end if;
  if exists (select 1 from family_keys where family_id = p_family_id) then raise exception 'passcode_already_set'; end if;
  if exists (select 1 from transactions where family_id = p_family_id) then raise exception 'enc_at_set_requires_empty_family'; end if;
  if length(coalesce(p_wrapped_dek,'')) < 20 or coalesce(p_kdf_salt,'') = '' or coalesce(p_kdf_iters,0) < 100000 then
    raise exception 'bad key material';
  end if;
  insert into family_keys (family_id, kdf_version, kdf_salt, kdf_iters, auth_hash, wrapped_dek, enc_state)
  values (p_family_id, p_kdf_version, p_kdf_salt, p_kdf_iters, null, null, 'enc');
  update members set key_unlocked_at = now() where family_id = p_family_id and user_id = v_uid and is_shared = false;
  insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
  values (p_family_id, 'card', p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.space_whitelist_list(p_family_id uuid)
returns json
language sql stable security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'email', i.invited_email,
           'status', i.status,
           'expires_at', i.expires_at
         ) order by i.created_at desc), '[]'::json)
  from invitations i
  where i.family_id = p_family_id
    and i.status = 'pending'
    and exists (select 1 from members m
                 where m.family_id = p_family_id
                   and m.user_id = auth.uid()
                   and m.archived_at is null);
$$;

create or replace function public.space_whitelist_add(p_family_id uuid, p_email text)
returns json
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_type text; v_email text := lower(trim(coalesce(p_email,'')));
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can invite'; end if;
  if position('@' in v_email) < 2 or length(v_email) < 5 then raise exception 'bad_email'; end if;
  if not exists (select 1 from family_keys where family_id = p_family_id) then raise exception 'no_card'; end if;
  if exists (select 1 from members m join profiles p on p.id = m.user_id
              where m.family_id = p_family_id and m.archived_at is null and lower(p.email) = v_email) then
    raise exception 'already_member';
  end if;
  insert into invitations (family_id, invited_email, invited_by)
  values (p_family_id, v_email, v_uid)
  on conflict (family_id, lower(invited_email)) where (status = 'pending')
    do update set expires_at = now() + interval '14 days', updated_at = now();
  return space_whitelist_list(p_family_id);
end $$;

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
end $$;

grant execute on function public.create_space(text, text, uuid) to authenticated;
grant execute on function public.init_space_card(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.space_whitelist_add(uuid, text) to authenticated;
grant execute on function public.space_whitelist_list(uuid) to authenticated;
grant execute on function public.leave_space(uuid) to authenticated;
