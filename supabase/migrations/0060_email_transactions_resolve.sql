-- ============================================================================
-- FamilyHub — 0060: retire staged rows once the human has dealt with them
--
-- 0058 granted SELECT only, deliberately: approving a transaction is not a
-- client-side UPDATE. Promotion goes through addExpense() (the encryption-correct
-- write path), and the staging row must then stop existing — otherwise it
-- reappears in the queue forever and the same transaction gets imported twice.
--
-- This is that retirement step. DELETE rather than a review_status flag:
--   • the row holds raw_body — the entire original email — which is the fattest
--     sensitive payload in the system and has no reason to outlive the review.
--   • gmail_message_id uniqueness is not the dedupe mechanism for re-ingestion;
--     the Gmail thread is relabelled txn/processed, so the pipeline never offers
--     the same email again whether the row exists or not.
--   • a "done" row that lingers is a row someone has to remember to exclude from
--     every future query.
--
-- Rejecting deletes too. The user has said this is not a transaction they want;
-- keeping it would mean the queue slowly fills with things they already dismissed.
--
-- SECURITY DEFINER because the table is deny-all for writes, but it re-checks
-- ownership itself: a caller can only retire rows carrying their OWN member_id.
-- Passing another member's row id deletes nothing rather than erroring, so the
-- function cannot be used to probe which ids exist.
-- ============================================================================

create or replace function public.resolve_email_transactions(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_deleted int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  delete from email_transactions
   where id = any(p_ids)
     and member_id in (select m.id from members m where m.user_id = v_uid);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.resolve_email_transactions(uuid[]) from public, anon;
grant  execute on function public.resolve_email_transactions(uuid[]) to authenticated;

comment on function public.resolve_email_transactions(uuid[]) is
  'Deletes staged rows the caller owns, after promotion or rejection. Returns the count actually removed; rows belonging to others are silently skipped.';
