-- ============================================================================
-- FamilyHub — 0118: issuing a tag clears its tombstone
--
-- WHY. 0117 gave the pipeline a tombstone table: a tag in retired_aliases means
-- its owner withdrew, and mail arriving at it is trashed on sight. The intended
-- invariant is
--
--     a tag is in retired_aliases  IFF  no live connection holds it
--
-- and nothing enforced the second half. get_or_create_mailbox_alias mints a
-- random tag and tests it for uniqueness by catching unique_violation on
-- mailbox_connections — a table retired tags are, by construction, no longer in.
-- So the minter could hand a live user a tag that is also marked dead.
--
-- HOW BAD IS THAT TODAY: not at all, and that is exactly why it is worth fixing
-- now. processOneMessage checks resolveMailbox FIRST and only consults the
-- retired list when it returns null, so a live connection always wins and the
-- stale tombstone is never read. The bug is invisible while that ordering
-- holds, and the day someone reorders those two checks — or writes a second
-- consumer of retired_aliases that reads it first — it deletes a live user's
-- bank mail with no error anywhere. A latent condition whose only defence is a
-- comment in a different file is worth one line of SQL.
--
-- The odds are ~50 bits against per mint (10 chars, 31-symbol alphabet), so
-- this will almost certainly never fire. "Almost certainly never" is the right
-- frequency for a silent data-deletion path to be closed at the source rather
-- than reasoned about.
--
-- REPLACED, not edited: 0059 defined this function and 0067 replaced it to add
-- the beta gate. This is the third version and it is 0067's body verbatim plus
-- the delete below — the gate, the pre-gate "already issued" return that keeps
-- existing users working, and the retry loop all behave exactly as they do now.
--
-- WHY THE DELETE SITS INSIDE THE LOOP rather than before it: the tag is not
-- known until the insert succeeds. Before the loop there is nothing to clear.
--
-- Withdrawal is untouched. disconnect_my_mailbox (0117) still inserts on the
-- way out; this only removes the row when a tag comes back into service, which
-- is the other direction of the same invariant.
--
-- Next free migration number after this one: 0119. Verify against
-- `git ls-tree origin/main supabase/migrations/` IMMEDIATELY BEFORE YOU PUSH,
-- not only before you write — 0112/0113/0114 were each claimed twice in one
-- day because two sessions checked hours apart and both got true answers.
-- ============================================================================

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

  -- Already issued: hand back the same one. Checked BEFORE the allowlist, so
  -- someone connected before the beta gate keeps working and the founders do
  -- not lock themselves out by applying it.
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

  -- Minting a NEW mailbox is what the gate stops. The error string is stable
  -- and specific so the client can show "not open yet" rather than a failure.
  if not exists (select 1 from mailbox_beta_access where user_id = v_uid) then
    raise exception 'mailbox_not_in_beta';
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

      -- THE ONE NEW LINE. A tag now held by a live connection cannot also be a
      -- tombstone, or the pipeline holds two contradictory facts about it and
      -- which one wins depends on the order two checks happen to run in.
      delete from retired_aliases where forwarding_alias = v_tag;

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

revoke all on function public.get_or_create_mailbox_alias(text) from public, anon;
grant execute on function public.get_or_create_mailbox_alias(text) to authenticated;

comment on function public.get_or_create_mailbox_alias(text) is
  'Issues (or returns) the caller''s forwarding tag, gated on mailbox_beta_access '
  'for new mints. Clears any retired_aliases tombstone for a tag it issues, so '
  'a live connection and a tombstone can never name the same tag.';
