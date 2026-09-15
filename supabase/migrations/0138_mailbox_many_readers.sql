-- 0138: a mailbox may have more than one reader.
--
-- Drops 0103's one-reader index. Apply ONLY after the mailbox-sync worker from
-- the same change is confirmed live (owner-scoped staged lookup, grantsByEmail
-- fan-out on push and ingest, family-twin flag in findDuplicate) and 0137 is
-- applied. Behind an older worker a second reader would be let in while the
-- staged check was still global, and 0103's split feed would return.
--
-- What a second reader gets: every mail in its own queue. Mail another reader
-- already imported is staged again for it (decisions are per owner); two
-- FAMILY rows for one message are flagged "Có thể trùng" (findDuplicate), and
-- review matches against the family ledger. Gmail keeps one watch per mailbox,
-- and every grant renews the same topic, so they share it. Model calls double
-- for mail neither reader has a template for yet.

drop index if exists public.mailbox_grants_one_per_mailbox;
