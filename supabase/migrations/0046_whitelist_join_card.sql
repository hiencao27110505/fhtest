-- ============================================================================
-- FamilyHub — 0046: whitelist-only join for card families
--
-- A card family (0043) has a family_keys row with enc_state but NO passcode
-- (auth_hash null), so join_with_passcode can't be its door. The door for a
-- card family is just the whitelist (owner adds the Gmail) + Google SSO; the
-- card is needed only to READ data, applied separately. find_my_invite gains a
-- `card_only` flag; join_with_whitelist adds the member without a code, and is
-- guarded to card families only (a passcode family still requires the code).
-- ============================================================================

create or replace function public.find_my_invite() returns json
language sql stable security definer set search_path = public as $$
  select case when i.id is null then null else json_build_object(
    'family_id',   i.family_id,
    'family_name', f.name,
    'invited_by',  coalesce(pr.display_name, 'the owner'),
    'passcode_set', (k.family_id is not null),
    'card_only',   (k.family_id is not null and k.auth_hash is null),
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

create or replace function public.join_with_whitelist(p_family_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text := auth_email(); v_inv invitations; v_row family_keys; v_prof profiles; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations
   where family_id = p_family_id and lower(invited_email) = v_email and status = 'pending'
   order by created_at desc limit 1;
  if not found then raise exception 'not_whitelisted'; end if;
  if v_inv.expires_at < now() then update invitations set status = 'expired' where id = v_inv.id; raise exception 'invite_expired'; end if;
  select * into v_row from family_keys where family_id = p_family_id;
  -- whitelist-only door is for CARD families; a passcode family keeps its code
  if v_row.family_id is not null and v_row.auth_hash is not null then raise exception 'passcode_required'; end if;
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
  return json_build_object('family_id', p_family_id, 'family_name', v_name, 'enc_state', coalesce(v_row.enc_state, 'off'));
end $$;
revoke execute on function public.join_with_whitelist(uuid) from public, anon;
grant  execute on function public.join_with_whitelist(uuid) to authenticated;
