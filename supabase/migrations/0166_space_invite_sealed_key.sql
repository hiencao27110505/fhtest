-- 0166_space_invite_sealed_key.sql
-- APPLIED 2026-11-22 by Hien in the Supabase SQL editor (not in schema_migrations,
-- like 0163 and 0165). Verified after: the column, the three new functions, the
-- two widened ones and the grants are in place. Next free is 0167.
--
-- Spaces: the key of a space travels with the invitation, sealed to the
-- invitee's own account (docs/specs/spaces-spec.md section 21).
--
-- Why: an invite link cannot open an installed web app on an iPhone. It opens
-- a browser, where the invitee is signed out and the key lands in the wrong
-- storage. With this, the owner's device seals the space's Key Card to the
-- invitee's public key (personal_keys.staging_pub, the X25519 half every
-- account already has for sealed bank mail) and the invitee's installed app
-- opens it in one tap.
--
-- What the server holds: one opaque box per invitation (invitations.key_sealed),
-- openable only with a private key that is wrapped under the invitee's personal
-- DEK. No plaintext key, card or DEK is added anywhere.
--
-- What this trusts that the link does not: the owner's device asks the server
-- for the invitee's public key. A server that answered with a key of its own
-- could read the box. The client shows a short code derived from the key it
-- sealed to ("mã xác nhận") so the two people can compare; that check is
-- optional and out of band.
--
-- Additive. find_my_invites and space_whitelist_list gain one key each; their
-- bodies are otherwise the live definitions (checked 2026-11-22).

alter table public.invitations add column if not exists key_sealed text;
comment on column public.invitations.key_sealed is
  'The space Key Card sealed (nacl box, ephemeral sender key) to the invitee''s personal_keys.staging_pub by the owner''s device. Opaque to the server.';

-- The public key to seal to. Owner only, and only for an email that already has
-- a pending invitation in that space, so it cannot be used to probe arbitrary
-- emails for accounts. Null = no account (or no personal key) yet.
create or replace function public.space_invite_pubkey(p_family_id uuid, p_email text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare v_type text; v_email text := lower(trim(coalesce(p_email,''))); v_pub text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can invite'; end if;
  if not exists (select 1 from invitations where family_id = p_family_id and lower(invited_email) = v_email and status = 'pending') then
    raise exception 'not_invited';
  end if;
  select k.staging_pub into v_pub
    from profiles p join personal_keys k on k.user_id = p.id
   where lower(p.email) = v_email and k.staging_pub is not null
   order by p.created_at limit 1;
  return v_pub;
end $$;

create or replace function public.space_invite_seal(p_family_id uuid, p_email text, p_sealed text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare v_type text; v_email text := lower(trim(coalesce(p_email,''))); v_n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select type into v_type from families where id = p_family_id and archived_at is null;
  if v_type is null or v_type not in ('friend','trip') then raise exception 'not_a_space'; end if;
  if not _is_owner(p_family_id) then raise exception 'only the owner can invite'; end if;
  if p_sealed is null or length(p_sealed) < 40 or length(p_sealed) > 4000 then raise exception 'bad_sealed'; end if;
  update invitations set key_sealed = p_sealed, updated_at = now()
   where family_id = p_family_id and lower(invited_email) = v_email and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- The box sealed to the caller for one space: their newest invitation there,
-- pending or already accepted (a second device of theirs asks for it too).
create or replace function public.space_my_sealed_key(p_family_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select i.key_sealed
    from invitations i
   where i.family_id = p_family_id
     and lower(i.invited_email) = auth_email()
     and i.key_sealed is not null
     and i.status in ('pending','accepted')
   order by i.created_at desc
   limit 1;
$$;

-- Base: 0106a_space_rls_and_rpcs.sql (live definition identical). + 'sealed'.
create or replace function public.space_whitelist_list(p_family_id uuid)
returns json
language sql stable security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'email', i.invited_email,
           'status', i.status,
           'expires_at', i.expires_at,
           'sealed', (i.key_sealed is not null)
         ) order by i.created_at desc), '[]'::json)
  from invitations i
  where i.family_id = p_family_id
    and i.status = 'pending'
    and exists (select 1 from members m
                 where m.family_id = p_family_id
                   and m.user_id = auth.uid()
                   and m.archived_at is null);
$$;

-- Base: 0106b_join_rpc_space_guards.sql (live definition identical). + 'key_sealed'.
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
      'kdf_version', k.kdf_version,
      'key_sealed',  i.key_sealed
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

revoke execute on function public.space_invite_pubkey(uuid, text)      from public, anon;
revoke execute on function public.space_invite_seal(uuid, text, text)  from public, anon;
revoke execute on function public.space_my_sealed_key(uuid)            from public, anon;
grant  execute on function public.space_invite_pubkey(uuid, text)      to authenticated;
grant  execute on function public.space_invite_seal(uuid, text, text)  to authenticated;
grant  execute on function public.space_my_sealed_key(uuid)            to authenticated;
