-- ============================================================================
-- FamilyHub — 0043: new families born on the Key Card (no passcode)
--
-- A card family still needs a family_keys row for its enc_state (the 0033/0038/
-- 0039 triggers key off family_keys.enc_state), but it has no passcode, so the
-- legacy passcode columns become nullable. The real DEK wrap lives in
-- family_key_wraps (kind='card', 0042); family_keys.wrapped_dek/auth_hash stay
-- null for a card-born family.
--
-- Backward compatible: existing rows (the live passcode family) keep their
-- values untouched. v279 already routes card families to card-unlock (a null
-- wrapped_dek never reaches the passcode prompt), so this is safe to apply
-- before the Phase B client — init_family_card is unused until that client ships.
-- ============================================================================

alter table public.family_keys alter column wrapped_dek drop not null;
alter table public.family_keys alter column auth_hash   drop not null;

-- init_family_card: create the enc row + the first card wrap, atomically.
-- Owner-only, guarded to a brand-new empty family (no family_keys row yet, no
-- transactions) — the same enc-at-birth guard set_family_passcode uses.
create or replace function public.init_family_card(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fid uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select family_id into v_fid from profiles where id = v_uid;
  if v_fid is null then raise exception 'you are not in a family'; end if;
  if not _is_owner(v_fid) then raise exception 'only the owner can set the card'; end if;
  if exists (select 1 from family_keys where family_id = v_fid) then raise exception 'passcode_already_set'; end if;
  if exists (select 1 from transactions where family_id = v_fid) then raise exception 'enc_at_set_requires_empty_family'; end if;
  if length(coalesce(p_wrapped_dek,'')) < 20 or coalesce(p_kdf_salt,'') = '' or coalesce(p_kdf_iters,0) < 100000 then
    raise exception 'bad key material';
  end if;
  insert into family_keys (family_id, kdf_version, kdf_salt, kdf_iters, auth_hash, wrapped_dek, enc_state)
  values (v_fid, p_kdf_version, p_kdf_salt, p_kdf_iters, null, null, 'enc');
  update members set key_unlocked_at = now() where family_id = v_fid and user_id = v_uid and is_shared = false;
  insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
  values (v_fid, 'card', p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.init_family_card(text, int, int, text) from public, anon;
grant  execute on function public.init_family_card(text, int, int, text) to authenticated;
