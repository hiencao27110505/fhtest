-- 0054_find_my_invites_plural.sql
-- Onboarding "Your family" can now show every pending invite for the signed-in
-- email (up to 3+ in practice), not just the newest. find_my_invite() (singular,
-- limit 1) stays for back-compat; this adds the plural sibling returning a JSON
-- array with the same per-invite shape. SECURITY DEFINER + auth_email() filter,
-- mirroring 0046 — RLS on `invitations` never lets an invitee SELECT by email.

create or replace function public.find_my_invites() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(sub.row order by sub.created_at desc), '[]'::json)
  from (
    select json_build_object(
      'family_id',   i.family_id,
      'family_name', f.name,
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
$$;

revoke execute on function public.find_my_invites() from public, anon;
grant  execute on function public.find_my_invites() to authenticated;
