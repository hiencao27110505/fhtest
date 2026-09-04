-- ============================================================================
-- FamilyHub — 0117: a disconnected forwarding alias is RETIRED, not forgotten
--
-- WHY. disconnect_my_mailbox() (0082, extended by 0087) deletes the
-- mailbox_connections row. That is what stops us READING — and 0087 already
-- says plainly that it cannot stop the transport itself: "It does not revoke
-- the grant at Google — only the person can do that, in their own account
-- settings." Exactly the same is true of a Gmail forwarding rule, which lives
-- in the person's own mailbox and which nothing here can reach.
--
-- So after a forwarding user disconnects, their bank mail KEEPS ARRIVING at the
-- alias, and the pipeline no longer recognises it. processOneMessage reads "no
-- connection" as *onboarding has not finished yet* and holds the message for
-- ROUTING_GRACE_DAYS (14). It cannot tell NOT CONNECTED YET from DISCONNECTED
-- ON PURPOSE; those are opposite situations getting identical treatment, and
-- the row deletion destroys the only evidence that would separate them.
--
-- Two things follow, observed live on 2026-09-04 after a real user moved off
-- forwarding:
--
--   • RETENTION. Held mail sits in txn/inbox, which sweepProcessedMail does not
--     sweep (it passes over txn/processed and txn/parse-failed only), for 14
--     days; then it becomes txn/parse-failed for 90 more, plus a parse_failures
--     row each. That is ~104 days of a withdrawn user's real bank mail in a
--     shared inbox, regenerating every time they use their card, described by
--     no consent text we have shown anyone. Same class as 0115.
--
--   • COST. Every held message is re-walked by the 1-minute trigger and costs a
--     mailbox_connections lookup each time. Fifteen of them is 21,600 UrlFetch
--     calls a day against Apps Script's 20,000/day consumer cap — a third quota
--     ceiling, beside the two Gemini walls in 0116. The queue grows linearly and
--     crosses the line without anything announcing it.
--
-- WHAT THIS ADDS. One tiny table remembering that an alias was deliberately
-- retired, written by the withdrawal itself. The pipeline then TRASHES mail for
-- a retired alias on sight: no 14-day hold, no parse_failures row, nothing
-- staged, nothing kept. Withdrawal becomes a thing the pipeline can observe
-- rather than infer from an absence.
--
-- WHY NOT A soft-delete FLAG ON mailbox_connections. That row carries
-- personal_email, member_id and the OAuth-era columns — the whole point of the
-- withdrawal is that it stops existing. A separate table keeps exactly one fact
-- (this tag is dead) and nothing about the person who held it.
--
-- RE-CONNECTING IS SAFE AND NEEDS NO CLEANUP HERE. get_or_create_mailbox_alias
-- mints a fresh random tag when the connection row is gone, and the pipeline
-- consults this table ONLY after mailbox_connections failed to resolve — so a
-- live alias can never be shadowed by a retired one. Retirement is a fact about
-- a tag, and tags are never reused.
--
-- NO BACKFILL. Aliases retired before this migration left no record to recover,
-- and their mail is already draining through the grace path. Nothing to purge
-- either: unroutable_after_grace rows only appear at 14 days, and the live
-- backlog was trashed at the mailbox before that line was reached.
--
-- Next free migration number after this one: 0118. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

create table if not exists public.retired_aliases (
  forwarding_alias text primary key,
  retired_at       timestamptz not null default now()
);

comment on table public.retired_aliases is
  'Forwarding tags whose owner withdrew. The bank-email pipeline trashes mail '
  'arriving at one instead of holding it for the routing grace. Holds no '
  'member, no email address and no family — only that the tag is dead.';

-- Same posture as mailbox_connections: RLS on, no policies, off the client
-- surface entirely. The pipeline reads it on the service-role key, which
-- bypasses RLS; nothing a browser holds can see a row.
alter table public.retired_aliases enable row level security;
revoke all on public.retired_aliases from public, anon, authenticated;
grant select, insert, delete on public.retired_aliases to service_role;

-- ---------------------------------------------------------------------------
-- disconnect_my_mailbox() — REPLACED, not edited. 0082 and 0087 stay as
-- applied; this is the append-only way to change a function. Everything 0087
-- did still happens, in the same order, and the return shape gains one key
-- rather than changing the ones already there.
--
-- The only new work is the insert below, and it runs BEFORE the delete because
-- after the delete there is nothing left to name. `returning` is not usable
-- here (the alias must be captured whether or not the delete matched a row in
-- the same statement order), so the aliases are read into an array first.
-- ---------------------------------------------------------------------------
create or replace function public.disconnect_my_mailbox()
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_conns int; v_rows int; v_grants int; v_retired int := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id into v_member from members
   where user_id = v_uid and is_shared = false limit 1;
  if v_member is null then raise exception 'no_member_row'; end if;

  delete from email_transactions
   where member_id = v_member and review_status = 'pending';
  get diagnostics v_rows = row_count;

  -- Retire the tags first: the delete below is what makes them unknowable.
  -- on conflict do nothing so disconnecting twice is success, not an error —
  -- the state they asked for is the state that already holds.
  insert into retired_aliases (forwarding_alias)
  select forwarding_alias from mailbox_connections
   where member_id = v_member and forwarding_alias is not null
  on conflict (forwarding_alias) do nothing;
  get diagnostics v_retired = row_count;

  delete from mailbox_connections where member_id = v_member;
  get diagnostics v_conns = row_count;

  -- Keyed on user_id, not member_id: the grant belongs to the person, and a
  -- user with members in several families still holds exactly one of these.
  delete from mailbox_grants where user_id = v_uid;
  get diagnostics v_grants = row_count;

  return json_build_object('connections', v_conns,
                           'pending_deleted', v_rows,
                           'grants', v_grants,
                           'aliases_retired', v_retired);
end $$;

revoke all on function public.disconnect_my_mailbox() from public;
grant execute on function public.disconnect_my_mailbox() to authenticated;

comment on function public.disconnect_my_mailbox() is
  'Withdrawal, not an unlink: deletes the pending staged rows, the forwarding '
  'connection and the OAuth grant, and records the forwarding tag in '
  'retired_aliases so the pipeline can trash mail that keeps arriving at it. '
  'It cannot stop the transport at the source — neither the Google grant nor a '
  'Gmail forwarding rule is ours to revoke — and the app''s copy says so.';
