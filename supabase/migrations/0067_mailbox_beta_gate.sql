-- ============================================================================
-- FamilyHub — 0067: bank-email onboarding is allowlist-only
--
-- [next free number checked against `git ls-tree origin/main
--  supabase/migrations/` on 2026-08-16 — 0061..0064 are founder-digest work,
--  0065/0066 are sealed-staging and mailbox-oauth.]
--
-- WHY THIS EXISTS, STATED PLAINLY: the product promises that nobody but the
-- family can read their data, and for the bank-email path that is not true yet.
-- Staged rows are written in plaintext (0065 adds the sealed columns but
-- sealForFamily() is still never called), and every forwarded email accumulates
-- in an operator-readable Gmail inbox that the pipeline never deletes from.
-- Collecting a stranger's bank mail under a promise we are not keeping is the
-- part that cannot be undone later, so issuing new mailboxes stops until it is
-- true.
--
-- WHY THE RPC AND NOT THE MENU: hiding the Settings row changes nothing —
-- get_or_create_mailbox_alias is granted to `authenticated`, so anyone able to
-- call it can still mint an alias and start forwarding. The UI hide is worth
-- doing for tidiness; this is the boundary.
--
-- WHY THIS ONE FUNCTION IS ENOUGH: no alias means nothing routes, which means
-- nothing stages, which means the review screen is empty by construction. One
-- gate covers both entry points and everything downstream.
--
-- WHAT IT DELIBERATELY DOES *NOT* DO: it does not revoke anyone already
-- connected. Routing reads mailbox_connections, not this table, so existing
-- mailboxes keep working exactly as before — including the founders', so
-- nothing breaks the moment this is applied. That also means anyone already
-- connected is still having their mail ingested in plaintext; see the note at
-- the bottom for how to see who, and how to stop it. That is a product
-- decision, not a schema one.
--
-- REVERSING IT: drop the `if not exists (...)` block from the function body, or
-- simply insert every user into the table. Nothing else depends on it.
-- ============================================================================

create table if not exists public.mailbox_beta_access (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);

comment on table public.mailbox_beta_access is
  'Allowlist for issuing bank-email forwarding aliases. Empty by design until '
  'sealed staging ships and the shared inbox stops retaining plaintext. '
  'Managed from the dashboard/service role — no client policy exists.';

-- Deny-all: RLS on, no policies. Only the service role and the SECURITY DEFINER
-- function below can see it, so a client cannot enumerate who is in the beta.
alter table public.mailbox_beta_access enable row level security;

-- Seeded EMPTY on purpose. Add people deliberately, one row each:
--
--   insert into public.mailbox_beta_access (user_id, note)
--   values ('<auth.users.id>', 'founder — Trang');
--
-- To find the id for someone already connected:
--
--   select m.user_id, mc.forwarding_alias, mc.personal_email, mc.verified
--   from mailbox_connections mc
--   join members m on m.id = mc.member_id;

-- Lets the UI hide the entry point instead of offering it and then refusing.
--
-- The allowlist itself is deny-all, so the client cannot read it — this answers
-- the single question "may I?" about the caller only, and nothing else. It is
-- NOT the security boundary: the check inside get_or_create_mailbox_alias is.
-- A client that lies to itself about this gains nothing.
--
-- Mirrors that function's logic exactly, including the already-connected escape,
-- so the menu never disagrees with what tapping it would do.
create or replace function public.can_use_mailbox()
returns boolean
language sql
security definer
set search_path = public
stable as $$
  select exists (select 1 from mailbox_beta_access where user_id = auth.uid())
      or exists (select 1
                   from mailbox_connections mc
                   join members m on m.id = mc.member_id
                  where m.user_id = auth.uid());
$$;

revoke all on function public.can_use_mailbox() from public, anon;
grant execute on function public.can_use_mailbox() to authenticated;

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
  -- someone connected before this migration keeps working and the founders do
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
  -- and specific so the client can show "not open yet" rather than a failure —
  -- the same way it already branches on not_whitelisted / wrong_passcode.
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

-- ============================================================================
-- AFTER APPLYING — two things worth doing in the same sitting.
--
-- 1. See who is already connected. Anyone here who is not a founder is having
--    their bank mail ingested in plaintext right now, and this migration does
--    not change that:
--
--      select m.user_id, mc.forwarding_alias, mc.personal_email, mc.verified,
--             mc.created_at
--      from mailbox_connections mc
--      join members m on m.id = mc.member_id
--      order by mc.created_at;
--
-- 2. To actually stop ingestion for someone, delete their connection — the
--    pipeline's routing gate then holds their mail unprocessed instead of
--    staging it (ROUTING_GRACE_DAYS), and nothing new enters the database:
--
--      delete from mailbox_connections where forwarding_alias = '<tag>';
--
--    Tell them first. Their forwarding rule will keep sending mail to an inbox
--    that no longer routes it, which is worse than an honest "we have paused
--    this while we finish encryption".
-- ============================================================================
