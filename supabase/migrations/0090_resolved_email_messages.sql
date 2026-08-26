-- ============================================================================
-- FamilyHub — 0090: remember which mail was already dealt with
--
-- THE BUG THIS FIXES, which cost a real user 42 duplicate rows in their queue.
--
-- `resolve_email_transactions` (0060) DELETES a staged row once the person has
-- promoted or dismissed it. That is right: the row holds a sealed copy of a
-- bank email and keeping it after the person is done with it would be data we
-- have no further reason to hold.
--
-- But the worker's idempotency check asks exactly one question — "is this
-- gmail_message_id already in email_transactions?" — and after a promotion the
-- answer is no. Ordinarily that never comes up, because the cursor has long
-- since moved past that window. It comes up the moment anything re-reads an
-- old window: a widened backfill, a cleared `backfilled_at`, an outage that
-- makes `windowDays` reach back. Then every message the person already dealt
-- with is staged again, and the queue fills with transactions that are already
-- in their ledger.
--
-- WHY THE CLIENT'S OWN GUARD DOES NOT COVER IT. `72-txn-review.js` remembers
-- what it promoted in localStorage, which is what keeps a queue correct while
-- the delete is still in flight. It cannot help here for two independent
-- reasons: it remembers the staged row's UUID, and a re-staged message is a new
-- row with a new UUID; and `_stagedRetiredPrune` drops any id the server stops
-- returning, so the memory is gone long before the message comes back.
--
-- WHAT THIS STORES, AND WHAT IT DELIBERATELY DOES NOT. A member id and a Gmail
-- message id. No amount, no merchant, no date, nothing sealed and nothing that
-- says what the transaction was — only that this mailbox has finished with this
-- message. That is the least that answers the question, and it is why this can
-- be a plain table with no encryption story of its own.
--
-- Next free migration number after this one: 0091. Verify against
-- `git ls-tree origin/main supabase/migrations/` before claiming it.
-- ============================================================================

create table if not exists public.resolved_email_messages (
  -- Scoped per member, exactly as email_transactions is: two people in one
  -- family can each connect the same shared mailbox, and one finishing with a
  -- message says nothing about the other.
  member_id         uuid        not null references public.members (id) on delete cascade,

  -- The same key the worker's idempotency check uses. Text, not a hash: the id
  -- is already an opaque Google handle that reveals nothing on its own, and
  -- hashing it would only stop the one query this table exists to serve.
  gmail_message_id  text        not null,

  resolved_at       timestamptz not null default now(),

  primary key (member_id, gmail_message_id)
);

comment on table public.resolved_email_messages is
  'Gmail message ids this member has already promoted or dismissed. Read by the sync worker so a re-read of an old window cannot re-stage mail the person has finished with. Carries no transaction content by design.';

-- The worker asks "which of these ids are done" for a whole window at once, so
-- the lookup is by member plus a set of ids — which the primary key already
-- serves. No second index earns its keep here.

alter table public.resolved_email_messages enable row level security;

-- Same shape as 0058's rule for email_transactions: a member sees only their
-- own rows. The client never writes here — resolve_email_transactions does, as
-- SECURITY DEFINER — so there is no insert policy to grant.
revoke all on public.resolved_email_messages from anon, authenticated;
grant select on public.resolved_email_messages to authenticated;
grant select, insert, delete on public.resolved_email_messages to service_role;

create policy resolved_email_messages_select_own on public.resolved_email_messages
  for select to authenticated
  using (member_id in (select m.id from public.members m where m.user_id = (select auth.uid())));

comment on policy resolved_email_messages_select_own on public.resolved_email_messages is
  'Own rows only. Initplan form — (select auth.uid()) — per 0022; a bare call here loses the per-row planner optimisation.';

-- ── the write, folded into the existing resolve ─────────────────────────────
--
-- REPLACED, not edited, and the insert happens BEFORE the delete on purpose:
-- if the insert fails the whole statement rolls back and the staged row
-- survives, which is the recoverable direction. Losing the row while failing to
-- record that it was resolved is the one ordering that cannot be recovered from
-- — the message would come back on the next wide read with nothing to stop it.

create or replace function public.resolve_email_transactions(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_deleted int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  -- Record first. `on conflict do nothing` because a second resolve of the same
  -- message is ordinary: a row can be re-staged and re-dismissed, and the
  -- earlier timestamp is the more honest one to keep.
  insert into resolved_email_messages (member_id, gmail_message_id)
  select t.member_id, t.gmail_message_id
    from email_transactions t
   where t.id = any(p_ids)
     and t.gmail_message_id is not null
     and t.member_id in (select m.id from members m where m.user_id = v_uid)
  on conflict (member_id, gmail_message_id) do nothing;

  delete from email_transactions
   where id = any(p_ids)
     and member_id in (select m.id from members m where m.user_id = v_uid);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.resolve_email_transactions(uuid[]) from public, anon;
grant  execute on function public.resolve_email_transactions(uuid[]) to authenticated;

comment on function public.resolve_email_transactions(uuid[]) is
  'Deletes staged rows the caller owns, after promotion or rejection, recording each message id in resolved_email_messages FIRST so a later re-read of the same window cannot stage it again. Returns the count actually removed; rows belonging to others are silently skipped.';
