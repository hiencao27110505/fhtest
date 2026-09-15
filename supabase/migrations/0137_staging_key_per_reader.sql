-- 0137: "already staged?" is per reader, not per system.
--
-- WHY. `email_transactions.gmail_message_id` has been globally UNIQUE since
-- 0025, when every bank mail was forwarded into ONE relay inbox and a Gmail
-- message id was therefore unique across the whole system. Direct read (0087)
-- reused the column, but a Gmail id is only unique WITHIN a mailbox, so the key
-- stopped meaning "have we processed this mail?" and started meaning "which
-- account got to this mail first?". Two accounts reading one mailbox raced for
-- every message (the incident 0103 records). 0103 banned the second reader;
-- this migration fixes the cause, and 0138 lifts the ban.
--
-- DEPLOY ORDER. The mailbox-sync worker that scopes its staged lookup by owner
-- and rings every grant on a push (grantsByEmail) must be live first. This
-- migration is safe either way while 0103 still allows one reader per mailbox;
-- 0138 is the step that is not, and it waits until that worker is confirmed.
--
-- 1. Fill owner_user_id where a row has a member but no owner, so the owner
--    scoped lookup and the new key both see it (0 such rows at writing; a
--    safety net for forwarding rows, which set member_id only).
-- 2. UNIQUE NULLS NOT DISTINCT (owner_user_id, gmail_message_id). Rows that
--    still have no owner (unrouted forwarding mail) stay globally unique among
--    themselves, which is what bank-email-pipeline.gs's 409 handling relies on.
-- 3. A plain index on gmail_message_id: the Apps Script still asks "is this id
--    staged?" without an owner, and must stay cheap.

update public.email_transactions t
   set owner_user_id = m.user_id
  from public.members m
 where t.owner_user_id is null
   and t.member_id = m.id
   and m.user_id is not null;

alter table public.email_transactions
  add constraint email_transactions_owner_message_key
  unique nulls not distinct (owner_user_id, gmail_message_id);

alter table public.email_transactions
  drop constraint email_transactions_gmail_message_id_key;

create index if not exists email_transactions_gmail_message_id_idx
  on public.email_transactions (gmail_message_id);
