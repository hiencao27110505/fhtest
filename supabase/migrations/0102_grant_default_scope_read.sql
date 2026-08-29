-- 0102: let a signed-in browser read the two grant columns added after 0087.
--
-- 0087 paired an RLS select policy (own rows) with a COLUMN-LEVEL grant, so a
-- browser can read a grant's status line and provably not its
-- refresh_token_enc. Correct, and it has one failure mode nobody watches for:
-- a column added LATER is not in the grant, and PostgREST rejects the whole
-- select rather than omitting the column. The client then sees an error, not a
-- row, and concludes there is no connection at all.
--
-- That is what happened. 0093 added default_scope and 0093 backfill_days;
-- neither was granted. `_atxConnection` selects default_scope, so every read
-- failed, every caller decided "not connected", and fhEmailTxnCta sent people
-- with a healthy mailbox — and 209 staged transactions waiting — to the setup
-- screen instead of their review queue.
--
-- Both columns are plain metadata: which ledger this mailbox feeds, and how far
-- back it was asked to read. Neither is a credential.

grant select (default_scope, backfill_days, backfilled_days)
  on public.mailbox_grants to authenticated;
