-- ============================================================================
-- FamilyHub — 0068: sealed-staging hardening — dedup fingerprint, a tighter
-- sealed-or-plain constraint, and closing the parse_failures side door
--
-- Apply AFTER 0065 (this rewrites the constraint 0065 creates, and the sealed
-- columns must exist). Confirm the free number against
-- `git ls-tree origin/main supabase/migrations/` — this range has collided
-- five times.
--
-- 1. DEDUP FINGERPRINT. findDuplicate() queries amount=eq.X, which returns
--    nothing once amounts are sealed. The recorded plan (AGENT_SYNC 2026-08-07,
--    sealed-box.gs header constraint 2) moved dedup client-side; Trang decided
--    on 2026-08-16 that dedup stays server-side, which supersedes that. The
--    construction that allows both that and sealing:
--
--        dedup_fp = base64( HMAC-SHA256( DEDUP_FP_KEY, 'v1|amount|direction|currency' ) )
--
--    computed by the pipeline while it still holds plaintext, with DEDUP_FP_KEY
--    living in Apps Script Script Properties — the same Google-vs-Supabase
--    trust split the TOFU key pin uses, and the reason SEALED-STAGING-DESIGN §7's
--    dictionary-attack objection does not apply: an attacker holding the
--    database does not hold the key, so VND amounts cannot be enumerated
--    against it. What it DOES leak, stated plainly: rows with equal fingerprints
--    share an amount+direction+currency (equality classes, not values). The
--    operator tier is unchanged — the Apps Script sees plaintext in transit
--    regardless. Provider is deliberately NOT in the fingerprint: dedup is
--    cross-source (findDuplicate filters source_provider=neq), and provider
--    stays a clear column for exactly that filter.
alter table public.email_transactions
  add column if not exists dedup_fp text;

comment on column public.email_transactions.dedup_fp is
  'Keyed dedup fingerprint: HMAC-SHA256(DEDUP_FP_KEY, v1|amount|direction|currency), base64. Key lives in Apps Script properties, never here. Reveals equality of amounts across rows, never the amounts. Written for both plaintext-era and sealed rows.';

create index if not exists email_transactions_dedup_fp_idx
  on public.email_transactions (dedup_fp)
  where dedup_fp is not null;

-- 2. TIGHTEN THE CONSTRAINT. 0065's sealed branch forgot raw_extracted and
--    transaction_type — the two most content-bearing fields after amount
--    (raw_extracted carries the memo, the masked account, the sender-auth
--    verdicts). A bug writing ciphertext AND raw_extracted would have passed
--    the very check whose job is making that state impossible. dedup_fp is
--    valid on both shapes, so it appears in neither branch.
alter table public.email_transactions
  drop constraint if exists email_transactions_sealed_or_plain;
alter table public.email_transactions
  add constraint email_transactions_sealed_or_plain check (
    (sealed is null and eph_pub is null and nonce is null and enc_v is null)
    or
    (sealed is not null and eph_pub is not null and nonce is not null and enc_v is not null
     and amount is null and currency is null and direction is null
     and counterparty is null and reference_number is null and raw_body is null
     and raw_extracted is null and transaction_type is null)
  );

-- 3. PARSE_FAILURES SIDE DOOR. Every failure row stored the full plaintext
--    email under a NOT NULL — a backdoor around whatever the sealed table
--    protects (SEALED-STAGING-DESIGN §7). The pipeline stops writing raw_body
--    here entirely; the email itself stays in Gmail under txn/parse-failed,
--    which the retention sweep deliberately never touches, so the debugging
--    path is the inbox, where reading it is at least an auditable mailbox
--    access rather than a database SELECT. Dropping NOT NULL is what lets the
--    pipeline stop; existing rows keep their bodies until the operator decides
--    to null them (their call, recorded in AGENT_SYNC — not done here, this
--    migration stays additive).
alter table public.parse_failures alter column raw_body drop not null;

comment on column public.parse_failures.raw_body is
  'Historic rows only. The pipeline stopped writing bodies here 2026-08-16; the source email stays in Gmail under txn/parse-failed instead.';
