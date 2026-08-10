-- 0053_update_member_pname_default.sql
-- 0052 gave update_member p_avatar_url but left p_name with NO default, so a
-- PostgREST call that omits p_name — the avatar-only shape {p_member_id,
-- p_avatar_url} used by fhAvatarSet / fhAvatarRemove / the coverage sweep —
-- could not resolve and returned 404 (surfaced as a toast on every reload via
-- the Google-photo auto-seed). Give p_name a default so those calls resolve.
-- Body is identical to 0052; name-save calls (which always pass p_name) are
-- unaffected. coalesce(p_name, name) keeps the name when p_name is null.
drop function if exists public.update_member(uuid, text, text, text, text);
create or replace function public.update_member(
  p_member_id uuid,
  p_name      text default null,
  p_color     text default null,
  p_name_enc  text default null,
  p_avatar_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_family uuid; v_user uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select family_id, user_id into v_family, v_user from members where id = p_member_id;
  if v_family is null then raise exception 'member not found'; end if;
  if not (_is_owner(v_family) or v_user = auth.uid()) then raise exception 'you can only edit your own profile'; end if;
  if p_name_enc is not null then
    update members set name = p_name, name_enc = p_name_enc, color = coalesce(p_color, color),
      avatar_url = case when p_avatar_url is null then avatar_url when p_avatar_url = '' then null else p_avatar_url end
      where id = p_member_id;
  else
    update members set name = coalesce(p_name, name), color = coalesce(p_color, color),
      avatar_url = case when p_avatar_url is null then avatar_url when p_avatar_url = '' then null else p_avatar_url end
      where id = p_member_id;
  end if;
end $$;
revoke execute on function public.update_member(uuid, text, text, text, text) from public, anon;
grant  execute on function public.update_member(uuid, text, text, text, text) to authenticated;
