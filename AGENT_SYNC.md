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
  function. **⚠ Numbering collision, found while merging this file
  (2026-08-04, bank-email pipeline session): real `0038` is the E2EE-beyond-money
  migration above, already pushed — this CSV-import file needs renumbering
  (0042+) before it can be applied, same pattern as the earlier 0023/0025
  collision.**

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
  3. Whichever side builds the shared masking utility first
     (`CSV-IMPORT-ENCRYPTION.md`: "one shared masker, two call sites") — the
     other should reuse it, not build a second one. Not claiming this work
     right now.

## Resolved

- **2026-08-04** — CSV import × encryption compatibility (Gemini masking
  approach, promotion-write reuse, staging-table encryption columns). See
  `CSV-IMPORT-ENCRYPTION.md`.
