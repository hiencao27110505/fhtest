-- ============================================================================
-- FamilyHub — 0065: sealed staging columns on email_transactions
--
-- [renumbered 0062 -> 0063 -> 0065 before commit: 0062, 0063 and 0064 were all
--  taken by founder-digest work on main. Check
--  `git ls-tree origin/main supabase/migrations/` before naming the next one.]
--
-- The last DB-side piece of sealed staging. Everything else already exists:
--   * 0051 — family_keys.staging_pub / staging_priv_enc + the two RPCs
--   * pipeline/sealed-box.gs        — seal side, Apps Script (forwarding)
--   * pipeline/lib/sealed-box.js    — seal side, Node (direct read)
--   * src/js-data/18-staging-keys.js — open side, browser (shipped v325)
--   * src/js-data/72-txn-review.js  — already branches on `row.sealed`
--
-- The review screen has been written against these columns since it was built
-- ("rows staged before sealing was switched on carry plain columns; rows staged
-- after carry {sealed, eph_pub, nonce}"). They just never existed. This adds
-- them, so sealing can be switched on without a client change.
--
-- ADDITIVE. Every new column is nullable, and the NOT NULLs being dropped are
-- only dropped — nothing is tightened. A plaintext-era row and a sealed row are
-- both valid, which is required: both will exist in the table during the
-- transition, and the 13 existing staged rows must keep working.
--
-- WHAT STAYS CLEAR, AND WHY: source_provider and occurred_at remain non-null
-- and unsealed. The review screen renders a locked row with them
-- (72-txn-review.js lines ~51-52) so a person whose device cannot open a row
-- still sees that something arrived, from whom, and when. Everything that says
-- HOW MUCH and TO WHOM moves inside the envelope. That is a deliberate,
-- documented metadata trade, not an oversight — see SEALED-STAGING-DESIGN.md.
--
-- Apply AFTER 0062 (direct mailbox read): the sync worker seals by default, so
-- these columns must exist before it writes its first row.
-- Next free migration number after this one: 0064.
-- ============================================================================

alter table public.email_transactions
  -- The envelope. NaCl box to the family's staging public key: the ciphertext,
  -- the ephemeral public key, and the nonce, all base64.
  add column if not exists sealed  text,
  add column if not exists eph_pub text,
  add column if not exists nonce   text,
  -- Envelope version. Null = a plaintext-era row. The client refuses any
  -- version it does not know rather than guessing.
  add column if not exists enc_v   integer;

-- The sensitive columns become nullable, because a sealed row does not have
-- them: the values live inside `sealed` and nowhere else.
--
-- `amount` is the one that matters most. Dropping its NOT NULL is what makes
-- the server unable to hold a family's transaction amounts at all — and it is
-- also why server-side dedup dies (AGENT_SYNC 2026-08-07): findDuplicate()
-- queries amount=eq.X, and any server-computable blind index over VND amounts
-- is dictionary-attackable. Dedup moves client-side, into the review step,
-- where it works better anyway.
alter table public.email_transactions alter column transaction_type drop not null;
alter table public.email_transactions alter column amount           drop not null;
alter table public.email_transactions alter column currency         drop not null;
alter table public.email_transactions alter column direction        drop not null;
alter table public.email_transactions alter column raw_body         drop not null;
alter table public.email_transactions alter column raw_extracted    drop not null;

-- A row must be one thing or the other. Half-sealed is the state where a bug
-- writes ciphertext AND leaves the plaintext amount behind — which would make
-- the whole exercise pointless, silently.
alter table public.email_transactions
  drop constraint if exists email_transactions_sealed_or_plain;
alter table public.email_transactions
  add constraint email_transactions_sealed_or_plain check (
    (sealed is null and eph_pub is null and nonce is null and enc_v is null)
    or
    (sealed is not null and eph_pub is not null and nonce is not null and enc_v is not null
     and amount is null and currency is null and direction is null
     and counterparty is null and reference_number is null and raw_body is null)
  );

comment on column public.email_transactions.sealed is
  'NaCl box to family_keys.staging_pub. family_id + gmail_message_id are bound INSIDE the plaintext and verified on open, so a ciphertext moved to another row or family is rejected. The pipeline that writes this cannot read it back.';

-- The pending-review index assumed a plaintext amount; a sealed row has none.
-- Rebuild it on the columns that stay clear.
drop index if exists email_transactions_amount_occurred_at_idx;
create index if not exists email_transactions_pending_review
  on public.email_transactions (occurred_at desc)
  where review_status = 'pending' and duplicate_of_id is null;
