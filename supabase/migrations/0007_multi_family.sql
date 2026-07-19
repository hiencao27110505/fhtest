-- ============================================================================
-- FamilyHub — 0007 multi-family
-- A user can belong to several families and switch the active one.
-- The members table already links (user_id, family_id); this drops the
-- single-family guards and adds my_families() / switch_family().
-- ============================================================================

create or replace function my_families() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'family_id', f.id,
    'name',      f.name,
    'is_owner',  (f.owner_id = auth.uid()),
    'is_active', (f.id = (select family_id from profiles where id = auth.uid()))
  ) order by f.created_at), '[]'::json)
  from families f
  where exists (select 1 from members m where m.family_id = f.id and m.user_id = auth.uid());
$$;

create or replace function switch_family(p_family_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from members where family_id = p_family_id and user_id = v_uid) then
    raise exception 'you are not a member of that family';
  end if;
  update profiles set family_id = p_family_id where id = v_uid;
end $$;

-- create_family: single-family guard removed (create additional families)
create or replace function create_family(p_name text, p_currency currency_code default 'VND', p_language language_code default 'vi')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_family uuid; v_prof profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_prof from profiles where id = v_uid;
  insert into families (name, owner_id, currency, default_language)
  values (p_name, v_uid, p_currency, p_language) returning id into v_family;
  update profiles set family_id = v_family where id = v_uid;
  insert into members (family_id, user_id, name, is_shared)
  values (v_family, v_uid, coalesce(v_prof.display_name, 'Me'), false);
  insert into members (family_id, name, is_shared)
  values (v_family, case when p_language='vi' then 'Chung' else 'Shared' end, true);
  perform seed_default_categories(v_family, p_language);
  return v_family;
end $$;

-- redeem_invite: join additional families; if already a member, just switch
create or replace function redeem_invite(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inv invitations; v_prof profiles; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations where upper(code) = upper(trim(p_code)) and status = 'pending';
  if not found then raise exception 'invalid or already-used code'; end if;
  if v_inv.expires_at < now() then
    update invitations set status = 'expired' where id = v_inv.id;
    raise exception 'this code has expired';
  end if;
  if v_inv.invited_email is not null and lower(v_inv.invited_email) <> auth_email() then
    raise exception 'this invite was sent to a different email';
  end if;
  select * into v_prof from profiles where id = v_uid;
  update profiles set family_id = v_inv.family_id where id = v_uid;
  if not exists (select 1 from members where family_id = v_inv.family_id and user_id = v_uid) then
    if v_inv.member_id is not null then
      update members set user_id = v_uid where id = v_inv.member_id and family_id = v_inv.family_id;
    else
      insert into members (family_id, user_id, name, is_shared)
      values (v_inv.family_id, v_uid, coalesce(v_prof.display_name, auth_email(), 'Member'), false);
    end if;
  end if;
  update invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
  select name into v_name from families where id = v_inv.family_id;
  return json_build_object('family_id', v_inv.family_id, 'family_name', v_name);
end $$;

revoke execute on function public.my_families()       from public, anon;
revoke execute on function public.switch_family(uuid) from public, anon;
grant  execute on function public.my_families()       to authenticated;
grant  execute on function public.switch_family(uuid) to authenticated;
