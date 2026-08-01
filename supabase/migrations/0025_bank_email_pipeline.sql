-- ============================================================================
-- FamilyHub — 0025: bank/transaction email ingestion pipeline
--
-- [renumbered 0023 -> 0025 on merge: 0023/0024 were already taken by
--  reactions/requests. RLS block added at end — service-role-only, matching the
--  project's RLS posture (0004/0005); Hien + Trang's call, 2026-08-01.]
--
-- Proposed by Trang (Growth), designed + validated against real forwarded bank
-- emails over a live test today (Gmail forwarding, +tag identity resolution,
-- spam-flag issue found and fixed). Full design writeup, cost analysis, and the
-- Apps Script that drives this: ask Trang, or see her bank-email-pipeline-*
-- files (schema.sql / extraction.md / README.md / concept-note.md).
--
-- ADDITIVE ONLY — does not modify any existing table (transactions, members,
-- categories, families, or anything else from 0001–0022). Six new tables:
--
--   email_transactions   — staging/ingestion log. NOT the real ledger. Every
--                           parsed email lands here first with review_status
--                           ('pending'/'approved'/'rejected'); only promotes
--                           into the real `transactions` table once a human
--                           has approved that (sender, email-template) pair
--                           once (see sender_fingerprints.human_verified).
--   parse_failures        — anything the pipeline couldn't parse.
--   category_rules        — keyword -> category-name guesses (used at
--                           promotion time — see open question below).
--   sender_fingerprints    — classification cache, keyed on
--                           (sender_address, subject_template) — NOT sender
--                           alone, since a single sender (e.g. a human
--                           forwarding address) can send both transaction and
--                           non-transaction mail.
--   mailbox_connections    — resolves a forwarded email to a member via a
--                           per-user `+tag` forwarding alias
--                           (txn+<id>@yourapp.com), not a separate mailbox
--                           per user and not by guessing at headers.
--   known_provider_domains — seed list of bank/provider sender domains,
--                           global not per-user; drives an onboarding
--                           bank-picker UI + backfill targeting.
--
-- Two foreign keys point INTO existing tables without altering them:
--   email_transactions.promoted_transaction_id -> transactions(id)
--   mailbox_connections.member_id              -> members(id)
--
-- OPEN QUESTIONS for you (not resolved in this file, flagged rather than
-- guessed):
--   1. Currency — `transactions` has no per-row currency column (family-level
--      currency, per your own README). Non-VND emails (we have a real USD
--      sample) need FX handling before promotion. Where should that live?
--   2. Category resolution — category_rules gives a free-text guess;
--      promotion needs a real category_id. Force review when it can't
--      resolve, or default to an "Uncategorized" bucket? Currently
--      unimplemented (resolveCategoryId() in the Apps Script is a stub that
--      always returns null, so nothing auto-promotes yet either way).
--   3. Mailbox onboarding UX — how a member actually gets their
--      `+tag` address and sets up the Gmail filter. Designed conceptually,
--      no UI built.
--
-- Nothing in this migration has been applied to a live database yet as of
-- writing. Please review before applying — this touches the same Supabase
-- project the app runs on.
-- ============================================================================

create table email_transactions (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,           -- dedupe key
  transaction_type text not null check (transaction_type in (
    'bank_txn', 'subscription', 'ecommerce_receipt', 'p2p_transfer', 'bill_payment'
  )),
  source_provider text not null,                    -- 'MB Bank', 'Anthropic', 'Google Play'
  occurred_at timestamptz not null,
  amount numeric not null,
  currency text not null,                           -- 'VND', 'USD' — real `transactions` has no currency col (family-level); FX/conversion happens at promotion time
  direction text not null check (direction in ('debit', 'credit')),
  counterparty text,                                -- beneficiary / merchant / payee
  reference_number text,                            -- bank ref no. / invoice no. — not guaranteed unique across providers
  -- status, account_masked, category deliberately NOT top-level columns — none of them
  -- are read anywhere in the pipeline code today. status/account_masked stay recoverable
  -- from raw_extracted if ever needed; category is left out entirely until category
  -- resolution is actually designed (see open question 2 above).
  raw_body text not null,                           -- original email body, for reprocessing/debugging
  raw_extracted jsonb not null,                     -- full LLM extraction output; category-specific fields live here
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  promoted_transaction_id uuid references transactions(id),  -- set once a human (or an auto-promotion) writes the real ledger row
  duplicate_of_id uuid references email_transactions(id),    -- set when this row matches an earlier one (same amount+direction, ±3 days) — never independently promoted when set
  created_at timestamptz not null default now()
);

create index on email_transactions (occurred_at desc);
create index on email_transactions (transaction_type);
create index on email_transactions (source_provider);
create index on email_transactions (review_status) where review_status = 'pending';
create index on email_transactions (amount, occurred_at) where duplicate_of_id is null;  -- speeds up the cross-source dedup lookup

create table parse_failures (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null,
  sender text not null,
  subject text not null,
  raw_body text not null,
  error_reason text not null,                       -- classifier said no / extraction failed / schema mismatch
  created_at timestamptz not null default now()
);

-- keyword -> category, editable without touching code
create table category_rules (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  category text not null,
  created_at timestamptz not null default now()
);

-- per-(sender, subject-template) fingerprint cache: first email matching a given
-- sender + normalized-subject-template gets LLM-classified once; every subsequent
-- email matching that same (sender, template) pair reuses the cached verdict + regex.
-- NOT per-sender alone — a single sender (especially a human forwarding address) can
-- send both transaction and non-transaction email; caching at the sender level would
-- misclassify whichever kind wasn't seen first. subject_template is the subject with
-- dates and reference-number-like substrings stripped.
create table sender_fingerprints (
  id uuid primary key default gen_random_uuid(),
  sender_address text not null,
  subject_template text not null,
  is_transaction_source boolean not null,           -- classifier verdict, cached
  transaction_type text,                            -- null if is_transaction_source = false
  extraction_regex text,                            -- the promoted fast-path pattern, if extraction succeeded via regex (technical confidence — parsing worked)
  human_verified boolean not null default false,    -- set true only when a person approves a pending email_transactions row using this fingerprint
                                                     -- (ledger-write confidence — gates auto-promotion; separate from extraction_regex's technical confidence)
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (sender_address, subject_template)
);

-- Resolves which family/member a forwarded email belongs to. One shared inbox for
-- all users — identity comes from a per-user +tag on that same address
-- (txn+abc123@yourapp.com), not from a separate mailbox per user and not from
-- guessing at the forwarded email's original recipient. The +tag is preserved in
-- the forwarded email's To: header on arrival — parse it, match against
-- forwarding_alias, done. Deterministic, not a fallback/guess.
create table mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  forwarding_alias text not null unique,   -- 'txn+abc123@yourapp.com' — the identity-resolution key
  personal_email text,                      -- their actual Gmail address; informational only, not used for identity resolution
  verified boolean not null default false,  -- whether the one-time destination-verification email was auto-confirmed
  created_at timestamptz not null default now()
);

-- Seed list of known bank/provider sender domains — global, not per-user. Two jobs:
-- (1) drives the onboarding bank-picker UI (user selects from this list, we generate
--     the multi-sender filter deep link), (2) targets the onboarding backfill search.
-- Does NOT pre-populate sender_fingerprints — that still needs a real email to derive
-- a subject_template from.
create table known_provider_domains (
  id uuid primary key default gen_random_uuid(),
  domain_or_address text not null unique,   -- 'mbbank.com.vn' or a specific address
  provider_name text not null,               -- 'MB Bank'
  transaction_type text,                     -- best-guess, informs backfill triage only
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Row-Level Security — all six tables are backend-pipeline tables written by
-- the Apps Script service role, never by app clients. Enable RLS with NO
-- policies: the service_role key bypasses RLS, while anon/authenticated get
-- zero rows. This matches the project's RLS posture (0004/0005) and keeps
-- these tables off the public PostgREST surface.
-- ============================================================================
alter table email_transactions     enable row level security;
alter table parse_failures         enable row level security;
alter table category_rules         enable row level security;
alter table sender_fingerprints    enable row level security;
alter table mailbox_connections    enable row level security;
alter table known_provider_domains enable row level security;
