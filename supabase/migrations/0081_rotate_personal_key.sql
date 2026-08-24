-- 0081 — rotate the personal key (recover a lost personal card)
--
-- Producing a valid wrap requires the DEK client-side, so this grants no new
-- power — it just lets a user who still has their ledger unlocked (DEK cached)
-- mint a fresh card. The client re-encrypts personal rows under the new DEK,
-- then calls this to swap the stored wrap.
create or replace function public.rotate_personal_key(
  p_kdf_salt text, p_kdf_iters int, p_kdf_version int, p_wrapped_dek text
) returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update personal_keys
     set kdf_salt = p_kdf_salt, kdf_iters = p_kdf_iters, kdf_version = p_kdf_version, wrapped_dek = p_wrapped_dek
   where user_id = v_uid;
  if not found then
    insert into personal_keys (user_id, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
    values (v_uid, p_kdf_salt, p_kdf_iters, p_kdf_version, p_wrapped_dek);
  end if;
end $$;
revoke execute on function public.rotate_personal_key(text,int,int,text) from public, anon;
grant execute on function public.rotate_personal_key(text,int,int,text) to authenticated;
