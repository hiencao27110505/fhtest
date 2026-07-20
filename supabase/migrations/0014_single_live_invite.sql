-- ============================================================================
-- FamilyHub — 0014: one live invite code per family
--
-- create_invite() inserted a brand-new pending row on every call and nothing
-- ever expired the old ones. The invite sheet calls it on open, so simply
-- looking at the invite screen minted a code — and each one stayed a working
-- key to the family's money for 14 days. Six were live on the production
-- family when this was written.
--
-- The dedupe index (family_id, lower(invited_email)) where status='pending'
-- doesn't catch these because code invites have invited_email = null, and
-- NULLs never collide in a unique index.
--
-- Now: create_invite() hands back the family's existing live code, and
-- regenerate_invite() is the explicit way to rotate — it expires the old ones
-- first. Stable by default, rotate on demand.
-- ============================================================================

-- 1. Retire the codes that accumulated, keeping the newest per family so any
--    invite currently being shared still works.
with keep as (
  select distinct on (family_id) id
    from invitations
   where status = 'pending' and invited_email is null
   order by family_id, created_at desc
)
update invitations
   set status = 'expired', updated_at = now()
 where status = 'pending'
   and invited_email is null
   and id not in (select id from keep);

-- 2. create_invite: reuse the family's live code rather than minting another.
create or replace function create_invite(p_member_id uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
  v_code   text;
  v_try    int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'you are not in a family'; end if;

  -- Already an unexpired code out there for this family? Hand back the same one.
  select code into v_code
    from invitations
   where family_id = v_family
     and status = 'pending'
     and invited_email is null
     and expires_at > now()
     and (p_member_id is null or member_id = p_member_id)
   order by created_at desc
   limit 1;
  if v_code is not null then return v_code; end if;

  -- Otherwise bind to the first open seat that has no pending invite.
  if p_member_id is null then
    select m.id into p_member_id from members m
     where m.family_id = v_family and m.user_id is null and not m.is_shared and m.archived_at is null
       and not exists (select 1 from invitations i where i.member_id = m.id and i.status = 'pending')
     order by m.created_at limit 1;
  else
    perform 1 from members where id = p_member_id and family_id = v_family and user_id is null;
    if not found then raise exception 'invalid member slot'; end if;
  end if;

  loop
    v_try := v_try + 1;
    v_code := gen_invite_code();
    begin
      insert into invitations (family_id, invited_email, invited_by, member_id, code)
      values (v_family, null, v_uid, p_member_id, v_code);
      exit;
    exception when unique_violation then
      if v_try > 8 then raise; end if;
    end;
  end loop;
  return v_code;
end $$;

-- 3. regenerate_invite: the only way to change the code. Expires every
--    outstanding code invite for the family, then issues a fresh one — so a
--    passcode that leaked can actually be revoked.
create or replace function regenerate_invite(p_member_id uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_family uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_family from profiles where id = v_uid;
  if v_family is null then raise exception 'you are not in a family'; end if;

  update invitations
     set status = 'expired', updated_at = now()
   where family_id = v_family and status = 'pending' and invited_email is null;

  return create_invite(p_member_id);
end $$;

revoke execute on function public.regenerate_invite(uuid) from public, anon;
grant  execute on function public.regenerate_invite(uuid) to authenticated;
