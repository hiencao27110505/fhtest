-- 0106b_join_rpc_space_guards.sql
-- Friend/trip spaces — part 2 of 2: the three join RPCs stop hijacking the
-- active-family slot when the target is a friend/trip space.
--
-- Bodies are the live definitions verbatim (pg_get_functiondef, 2026-09-01)
-- with ONE change each: the profiles update gains
--   "and (select type from families where id = X) = 'family'".
-- Joining a space still adds the member row and accepts the invite — it just
-- never moves the active family. find_my_invites additionally exposes f.type
-- so the join door can route family joins vs space joins.

create or replace function public.join_with_passcode(p_family_id uuid, p_k_auth text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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
  update profiles set family_id = p_family_id
   where id = v_uid
     and (select type from families where id = p_family_id) = 'family';
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
end $function$;

create or replace function public.join_with_whitelist(p_family_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_email text := auth_email(); v_inv invitations; v_row family_keys; v_prof profiles; v_name text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invitations
   where family_id = p_family_id and lower(invited_email) = v_email and status = 'pending'
   order by created_at desc limit 1;
  if not found then raise exception 'not_whitelisted'; end if;
  if v_inv.expires_at < now() then update invitations set status = 'expired' where id = v_inv.id; raise exception 'invite_expired'; end if;
  select * into v_row from family_keys where family_id = p_family_id;
  if v_row.family_id is not null and v_row.auth_hash is not null then raise exception 'passcode_required'; end if;
  select * into v_prof from profiles where id = v_uid;
  update profiles set family_id = p_family_id
   where id = v_uid
     and (select type from families where id = p_family_id) = 'family';
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
end $function$;

create or replace function public.redeem_invite(p_code text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  update profiles set family_id = v_inv.family_id
   where id = v_uid
     and (select type from families where id = v_inv.family_id) = 'family';

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
end $function$;

create or replace function public.find_my_invites()
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(json_agg(sub.row order by sub.created_at desc), '[]'::json)
  from (
    select json_build_object(
      'family_id',   i.family_id,
      'family_name', f.name,
      'family_type', f.type,
      'invited_by',  coalesce(pr.display_name, 'the owner'),
      'passcode_set', (k.family_id is not null),
      'card_only',   (k.family_id is not null and k.auth_hash is null),
      'kdf_salt',    k.kdf_salt,
      'kdf_iters',   k.kdf_iters,
      'kdf_version', k.kdf_version
    ) as row, i.created_at
    from invitations i
    left join families    f  on f.id = i.family_id
    left join family_keys k  on k.family_id = i.family_id
    left join profiles    pr on pr.id = i.invited_by
    where lower(i.invited_email) = auth_email() and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc
    limit 10
  ) sub;
$function$;
