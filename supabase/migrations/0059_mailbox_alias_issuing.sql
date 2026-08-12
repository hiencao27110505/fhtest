-- ============================================================================
-- FamilyHub — 0059: issue a forwarding alias to a member (bank-email onboarding)
--
-- The bank-email pipeline routes a forwarded email to a person by reading the
-- +tag on the receiving address and looking it up in mailbox_connections.
-- Nothing has ever written that table — the alias-issuing step was designed but
-- not built — so every staged row has been unowned, and unowned rows are
-- visible to nobody (0058: no family_id column, so no member_id means no family
-- linkage at all). This is the missing write.
--
-- WHY AN RPC AND NOT A POLICY: mailbox_connections stays deny-all and off the
-- PostgREST surface. Alias generation must be server-side anyway — the client
-- must not choose its own tag (it would let one member claim another's, or pick
-- something guessable), and uniqueness has to be enforced at the point of
-- insert, not hoped for.
--
-- IDEMPOTENT. Calling it again returns the alias already issued rather than
-- minting a second one. A member with two aliases would be a routing ambiguity
-- (which one owns mail arriving on the other?), and re-issuing would strand
-- every email still being forwarded to the old address.
--
-- TAG SHAPE: 10 chars from a 32-symbol alphabet with look-alikes removed
-- (no 0/O/1/I/L) so it survives being read aloud, handwritten, or retyped from
-- a screenshot. ~50 bits — not a secret, but not enumerable either: anyone who
-- learns a tag can post mail at it, which is why sender authenticity (DKIM +
-- X-Forwarded-For) exists in the pipeline rather than relying on the tag being
-- unguessable.
--
-- The full address is assembled CLIENT-side from the tag plus the configured
-- inbox domain, so moving off the shared Gmail inbox to a real owned domain
-- later is a client/config change and does not require rewriting stored rows.
-- ============================================================================

create or replace function public._fh_gen_mailbox_tag()
returns text
language plpgsql
volatile as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';  -- no 0/o/1/i/l
  out text := '';
  i int;
begin
  for i in 1..10 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

create or replace function public.get_or_create_mailbox_alias(p_personal_email text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_row mailbox_connections;
  v_tag text;
  v_tries int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- The caller's own member row. is_shared members are placeholders for people
  -- without logins and cannot own a mailbox.
  select id into v_member
    from members
   where user_id = v_uid and is_shared = false
   limit 1;
  if v_member is null then raise exception 'no_member_row'; end if;

  -- Already issued: hand back the same one. Refresh personal_email if the
  -- caller supplied one, since that is what the pipeline's forwarder check
  -- compares X-Forwarded-For against and it may legitimately change.
  select * into v_row from mailbox_connections where member_id = v_member limit 1;
  if found then
    if p_personal_email is not null and p_personal_email is distinct from v_row.personal_email then
      update mailbox_connections
         set personal_email = p_personal_email
       where id = v_row.id
       returning * into v_row;
    end if;
    return json_build_object(
      'forwarding_alias', v_row.forwarding_alias,
      'personal_email',   v_row.personal_email,
      'verified',         v_row.verified,
      'created',          false);
  end if;

  -- Mint one. Retry on the astronomically unlikely collision rather than
  -- failing the caller.
  loop
    v_tries := v_tries + 1;
    v_tag := _fh_gen_mailbox_tag();
    begin
      insert into mailbox_connections (member_id, forwarding_alias, personal_email, verified)
      values (v_member, v_tag, p_personal_email, false)
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_tries >= 5 then raise; end if;
    end;
  end loop;

  return json_build_object(
    'forwarding_alias', v_row.forwarding_alias,
    'personal_email',   v_row.personal_email,
    'verified',         v_row.verified,
    'created',          true);
end $$;

-- Read-back for the UI (the address must be displayable after onboarding, and
-- `verified` drives the connection-status screen). Returns nulls when the
-- member has no alias yet — a normal state, not an error.
create or replace function public.get_my_mailbox_alias()
returns json
language plpgsql security definer set search_path = public
stable as $$
declare v_uid uuid := auth.uid(); v_row mailbox_connections;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select mc.* into v_row
    from mailbox_connections mc
    join members m on m.id = mc.member_id
   where m.user_id = v_uid and m.is_shared = false
   limit 1;
  return json_build_object(
    'forwarding_alias', v_row.forwarding_alias,
    'personal_email',   v_row.personal_email,
    'verified',         v_row.verified);
end $$;

revoke execute on function public._fh_gen_mailbox_tag()                  from public, anon, authenticated;
revoke execute on function public.get_or_create_mailbox_alias(text)      from public, anon;
grant  execute on function public.get_or_create_mailbox_alias(text)      to authenticated;
revoke execute on function public.get_my_mailbox_alias()                 from public, anon;
grant  execute on function public.get_my_mailbox_alias()                 to authenticated;
