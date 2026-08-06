-- ============================================================================
-- FamilyHub — 0047: retire the 6-digit passcode (owner action, gated)
--
-- After a family migrates to the card (Phase C), both keys coexist: the passcode
-- wrap in family_keys and the card wrap in family_key_wraps. Once everyone holds
-- the card, the owner can retire the passcode. GATED: refuses unless a live card
-- wrap exists (else it would lock everyone out). Not automatic — the client
-- surfaces it as a warned, arm-then-confirm owner action.
-- ============================================================================
create or replace function public.drop_family_passcode() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can remove the passcode'; end if;
  if not exists (select 1 from family_key_wraps where family_id = v_fid and kind = 'card' and rotated_at is null) then
    raise exception 'no_card';   -- never strand the family without a key
  end if;
  update family_keys set wrapped_dek = null, auth_hash = null where family_id = v_fid;
  delete from passcode_attempts where family_id = v_fid;
end $$;
revoke execute on function public.drop_family_passcode() from public, anon;
grant  execute on function public.drop_family_passcode() to authenticated;
