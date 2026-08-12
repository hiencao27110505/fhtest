-- ============================================================================
-- FamilyHub — 0058: let the review UI read its own family's staged rows
--
-- 0025 enabled RLS on email_transactions with ZERO policies (service-role only),
-- which was right while nothing but the Apps Script touched it. The review UI
-- needs to read pending rows, so it needs an explicit way in.
--
-- WHY A POLICY AND NOT AN RPC: the review screen filters, groups and paginates
-- (own rows, by date, pending only). Expressing that through an RPC means
-- reinventing query parameters; a SELECT policy lets PostgREST do it and keeps
-- the filtering honest — the database decides what you may see, not the caller.
--
-- SCOPE — deliberately narrower than "my family":
--   member_id = the caller's own member row.
-- Not family-wide, because these rows come from a person's PRIVATE mailbox. A
-- forwarded bank email is that member's own spending record; the family sees it
-- once it is promoted into `transactions` (which is family-scoped and reviewed),
-- not before. Review is private, the result is shared.
--
-- ROWS WITH member_id IS NULL ARE VISIBLE TO NOBODY, ON PURPOSE.
-- email_transactions has no family_id column; member_id is the ONLY link to a
-- family. An unrouted row therefore has no family linkage at all — there is no
-- safe audience for it, and a "show unassigned to the family" policy would leak
-- one household's transaction to every other. The pipeline now holds unroutable
-- mail in txn/inbox instead of staging it (ROUTING_GRACE_DAYS), so this state
-- should be rare; when it does occur it is an operator/setup problem, reachable
-- with the service role, not a user-facing queue.
--
-- SELECT ONLY. Approving a row is not an UPDATE from the client: promotion goes
-- through addExpense() (which carries the encryption-correct write path), and
-- the staging row is then deleted. Those need their own RPC when the review UI
-- is built — deliberately not granted here, so a client cannot flip
-- review_status or edit an amount directly.
-- ============================================================================

create policy email_transactions_own_select
  on public.email_transactions
  for select
  to authenticated
  using (
    member_id is not null
    and member_id in (
      select m.id from public.members m
      where m.user_id = auth.uid()
    )
  );

comment on policy email_transactions_own_select on public.email_transactions is
  'A member reads only their own staged rows. Unrouted rows (member_id null) have no family linkage and are visible to no client by design.';
