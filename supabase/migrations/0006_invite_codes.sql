-- ============================================================================
-- FamilyHub — 0006 short invite codes
-- Reconciles the onboarding's 6-char code UI with the invitations table.
-- Owner calls create_invite() → a shareable 6-char code (auto-bound to the first
-- open member seat). Joiner calls redeem_invite(code) → joins the family.
-- ============================================================================

alter table invitations alter column invited_email drop not null;
alter table invitations add column code text;
create unique index invitations_code_pending on invitations(code) where status = 'pending';

create or replace function gen_invite_code() returns text
language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin
  for i in 1..6 loop
    c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return c;
end $$;

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

create or replace function redeem_invite(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_inv  invitations;
  v_prof profiles;
  v_name text;
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
  if v_prof.family_id is not null then raise exception 'you already belong to a family'; end if;

  update profiles set family_id = v_inv.family_id where id = v_uid;

  if v_inv.member_id is not null then
    update members set user_id = v_uid where id = v_inv.member_id and family_id = v_inv.family_id;
  else
    insert into members (family_id, user_id, name, is_shared)
    values (v_inv.family_id, v_uid, coalesce(v_prof.display_name, auth_email(), 'Member'), false);
  end if;

  update invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;

  select name into v_name from families where id = v_inv.family_id;
  return json_build_object('family_id', v_inv.family_id, 'family_name', v_name);
end $$;

revoke execute on function public.gen_invite_code()   from public, anon, authenticated;
revoke execute on function public.create_invite(uuid)  from public, anon;
revoke execute on function public.redeem_invite(text)  from public, anon;
grant  execute on function public.create_invite(uuid)  to authenticated;
grant  execute on function public.redeem_invite(text)  to authenticated;
