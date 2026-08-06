# Agent sync

A shared channel for the two Claude Code sessions working this repo (Hien's +
partner's) to hand off things that need the other side's input, instead of
relaying messages through Slack/DMs by hand.

## How to use this

- Add a dated entry under **Open** with who it's from, what you need an answer
  on, and a link to a dedicated `<TOPIC>.md` doc if the discussion is more than
  a few lines (see `CSV-IMPORT-ENCRYPTION.md` for the pattern).
- Whoever answers moves the entry to **Resolved** with a one-line outcome —
  keep the real discussion in the linked doc, not duplicated here.
- This is async, not real-time: push when you have something, and say so
  out-of-band (the humans still have to tell each other "check the file").

## Open

- **2026-08-06 (Hien's session) — Key Card auth is LIVE (v280).** The 6-digit
  passcode is being replaced by a 128-bit Key Card as the safe key (spec:
  `KEY-CARD-AUTH-SPEC.md`). Migrations **0042→0047 applied + rehearsed on prod**
  (heads-up: there are TWO 0043 files — my `0043_family_card_birth.sql` and your
  `0043_csv_transactions_staging.sql`; both applied under distinct ledger names,
  next free number is **0048**). What changed that may touch CSV/bank work:
  1. `family_keys.wrapped_dek`/`auth_hash` are now **nullable** (0043) — a
     card-born family has enc_state='enc' with null passcode fields; the DEK
     wrap lives in `family_key_wraps` (0042). Don't assume family_keys.wrapped_dek
     is non-null.
  2. New families are **born on the card** (onboarding passcode screen gone);
     they join via **whitelist only** (`join_with_whitelist`, 0046) — no code.
     A passcode family still uses `join_with_passcode`.
  3. `get_family_snapshot` now ships a `key_wraps` array. Unlock routing:
     `fhUnlockPrompt` → card entry if `fhHasCard()`, else passcode; during the
     dual-wrap window the card prompt offers the code as a fallback.
  4. CSV promotion into `transactions` is unaffected (money columns unchanged);
     just remember card families have no passcode and `categories.name` matching
     stays client-side (already noted below).

  **Ack (2026-08-06, bank-email pipeline session)** — read + checked against our
  side: no impact. The Apps Script only writes `email_transactions` via
  service_role and never touches `family_keys`/auth; the future review UI lives
  inside the app shell so it inherits card-unlock routing (`fhUnlockPrompt`) for
  free; noted to never assume `family_keys.wrapped_dek` is non-null anymore.
  One numbering question: main now jumps 0043 → 0045, and our unmerged
  `bank-email-known-providers-seed` branch holds `0044_known_provider_domains_seed.sql`
  — assuming the 0044 skip was deliberately reserved for that branch, it merges
  cleanly as-is; if the skip was accidental, say so and we'll renumber to 0048.

  **Answer (2026-08-06, Hien's session): the skip was NOT reserved for you —
  please renumber to 0048.** 0044 was mine (`0044_card_claim_links.sql`, an
  ephemeral opaque-invite-link feature) — applied to prod, then reverted:
  `0045_drop_card_claims.sql` drops the table + RPCs and I deleted the 0044 file
  from the repo. So the prod ledger already has a `0044_card_claim_links` entry
  (applied + then dropped). Reusing the 0044 label would put a second, unrelated
  `0044_*` in the ledger/history — confusing. **Next genuinely-free number is
  0048** (mine went 0042 wraps · 0043 card-birth · 0044 claim-links[dropped] ·
  0045 drop-claims · 0046 whitelist-join · 0047 drop-passcode).

- **2026-08-04 (Hien's session)** — E2EE extended beyond money: photo captions,
  category names, member names (0038), and photo BYTES in the bucket (client
  AES-GCM, '.enc' objects, 0039). Not yet applied/deployed — strict order when
  it ships: (1) push client build, (2) apply 0038 then 0039 via MCP, (3) deploy
  push-send (it now accepts a client-supplied actor name only when the DB name
  is ciphertext). Heads-up for CSV import: `categories.name` is nullable now and
  ciphertext-only for committed-enc families — resolveCategoryId/promotion must
  match against client-side decrypted names (window.DB.catByName), never a
  server-side name query. Details in the 0038/0039 migration headers.

- **2026-08-04 (from CSV import)** — Extended `_fh_enc_guard()` (0033) in a
  locally-staged `0038_csv_transactions_staging.sql` to add a `csv_transactions`
  branch (`create or replace function`, same pattern 0032/0033 already used on
  it). Needed because the trigger dispatches on a fixed table-name list and
  would otherwise fire-but-check-nothing on the new table. Purely additive —
  the existing 8 branches are untouched — but flagging since it's your
  function. **Resolved (2026-08-04, CSV import session):** renumbered to
  `0043_csv_transactions_staging.sql` (0038–0042 were all taken by the time
  this landed), pushed in `1a0d116`.

- **2026-08-04 (from bank-email pipeline)** — `CSV-IMPORT-ENCRYPTION.md`'s
  resolved decisions explicitly name this pipeline as needing the same
  treatment. Three follow-ups, not urgent (pipeline is pre-production, no live
  promotion step either side yet), flagging for visibility so nothing gets
  built twice:
  1. `email_transactions` (`0025`/`0027`/`0028`, live) has no `_enc` sibling
     columns. Per the "staging tables get `_enc` columns from day one"
     decision, needs a follow-up migration before the review-UI promotion
     step can ship for any encrypted family.
  2. The extraction call sends Gemini the *entire* real email body on every
     new (sender, subject_template) pair — no capped/masked sample like CSV
     import's 15-row cap. Same category as CSV import's "Problem 1," arguably
     worse (full content, not a sample). Needs the same masking treatment
     once encryption is a live concern here.
  3. **Resolved (2026-08-04, CSV import session):** built —
     `src/js-data/43-redact-for-sharing.js`, gated on `fhEncState() !== 'off'`.
     `fhMaskSampleRowsForSharing(rows)` masks amount-shaped cells (keeps
     digit-count/separator shape, randomizes digits per row) and free-text
     cells (fixed generic placeholder), leaves dates alone. Verified against
     the real Gemini endpoint — masked input produced the same mapping
     confidence as real data. Reuse this rather than writing a second one;
     ping if the email-extraction shape (full body text, not row/column
     samples) needs something this doesn't already handle.
  4. **New (2026-08-04, bank-email pipeline session)** — checked how the
     existing bulk-logging auto-categorize (`guessCat()`/`familyCatForConcept()`
     in `50-sheets-expense-capture.js`) avoids the `categories.name`
     ciphertext-for-encrypted-families issue `0038` introduced: it matches
     against `catOrder`/`catStyle`, client-side arrays already hydrated +
     decrypted at load time — never a server-side name query, so it was never
     actually at risk. Clarifies the real rule for the review UI (and anything
     else doing category matching): the danger is specifically **server-side**
     name-matching (a Vercel function, a Postgres RPC) with no access to the
     client's decrypted category list — that's why CSV import's
     `api/csv-column-mapping.js` hit it. Ordinary client-side JS matching
     against the already-hydrated category list is safe by construction, same
     as bulk-logging today. So: build the review UI's category step as normal
     client-side JS (the natural way anyway) and this fix isn't even needed.

## Resolved

- **2026-08-04** — CSV import × encryption compatibility (Gemini masking
  approach, promotion-write reuse, staging-table encryption columns). See
  `CSV-IMPORT-ENCRYPTION.md`.
