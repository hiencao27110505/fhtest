-- ============================================================================
-- FamilyHub — 0028: bank email pipeline — store resolved member on ingestion
--
-- Follow-up to 0025/0027. email_transactions had no member_id, so once a
-- review UI exists it would have no way to route a pending row to the right
-- person's queue without re-deriving identity from the original Gmail
-- message — which isn't available from the database alone.
--
-- The Apps Script resolves this at write time via mailbox_connections (the
-- +tag on the receiving address) and stores it here. Storage only — the
-- pipeline does not promote based on this; promotion is a separate,
-- not-yet-built review flow (see 0027's header for why).
-- ============================================================================

alter table email_transactions
  add column member_id uuid references members(id);

create index on email_transactions (member_id) where review_status = 'pending';
