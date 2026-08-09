# CSV Import

## Problem & Why

Families arrive with expense history already living somewhere else — a bank export, a budgeting app, a Splitwise-style shared-expense export — and hand-re-entering months of transactions is the kind of friction that kills first-run adoption. CSV import exists to turn an arbitrary real-world export file into transactions in the ledger with minimal manual work, while still landing every row through a human review step (nothing auto-writes).

Two constraints shape the whole design:

1. **The files are messy and heterogeneous.** Vietnamese bank exports, English budgeting-app exports, and shared-expense exports disagree on headers, date formats (`dd/mm/yyyy` vs `mm/dd/yyyy` vs ISO vs `Jul 9 2026`), and amount punctuation (`520,000` VN-grouped vs `520.000` vs `520,00` decimal). Column mapping can't be a fixed schema — it has to be inferred per file.
2. **The write path has to respect encryption.** Once a family's `enc_state` is `dual` or `enc`, two independent problems appear that a naive implementation would get wrong: real financial data leaving the device to a third-party LLM (Gemini, used for ambiguous column mapping) contradicts the reason the family turned encryption on; and a bespoke `insert` into `transactions` would be rejected outright by `_fh_enc_guard()` (`0033_enc_enforcement.sql`), which rejects any write to `transactions.amount`/`transactions.note` that doesn't carry proper ciphertext once `enc_state != 'off'`.

`CSV-IMPORT-ENCRYPTION.md` (repo root) is the design conversation that worked out the answer to both. That doc is now stale in its framing — its opening line says "neither fix here is built yet," but its own later sections ("Problem 2 — promotion write: confirmed" and the masking Q&A) describe both as agreed and implemented. **Both are shipped as of this writing**: sample-data masking (`src/js-data/43-redact-for-sharing.js`) runs before every network call to Gemini, and promotion reuses the existing bulk-expense-logging write path instead of a bespoke insert. This doc describes the current, built system — read `CSV-IMPORT-ENCRYPTION.md` only for the historical design reasoning, not as a statement of what's built.

## Architecture & How It Works

The pipeline is entirely client-side except one serverless proxy call, and nothing writes to the database until the user taps Import on the review screen.

```
file picked
  │
  ▼
parseCsvFile()              44-csv-parse.js          — text → { headers, rows }
  │
  ▼
resolveCsvMapping()         45-csv-import.js          — heuristics, then Gemini fallback if needed
  │  (Gemini path only)
  ▼
fhMaskSampleRowsForSharing() 43-redact-for-sharing.js — masks amounts/text before the network call
  │
  ▼
POST /api/csv-column-mapping  api/csv-column-mapping.js — Vercel proxy to Gemini, JWT + rate-limit gated
  │
  ▼
buildCsvCandidates() / bucketCsvCandidates()  57-csv-import-review.js — per-row candidates, ready/needs-category/duplicate/deferred
  │
  ▼
renderCsvReview() / csvPromote()  56-csv-import-ui.js — review UI, human decisions, then promotion
  │
  ▼
bulkRows + submitBulk()     50-sheets-expense-capture.js — SAME write path as bulk expense logging
  │
  ▼
addExpense() × N            60-transactions.js → 50-writethrough-realtime.js → _dbInsertTxn()  40-txn-writes-outbox.js
```

### 1. Parsing — `src/js-data/44-csv-parse.js`

`parseCsv()` (`:5-61`) is a hand-rolled RFC-4180-ish parser: quoted fields, embedded commas/newlines inside quotes, `""` as an escaped quote. Hand-rolled because the repo has no dependencies and a naive `line.split(',')` breaks on a VN bank amount written as `"520,000"` with the thousands comma inside quotes. `parseCsvFile()` (`:65-69`) splits the parsed rows into `{ headers, rows }` and drops fully-blank lines so a blank line mid-export doesn't become a phantom transaction.

### 2. Column mapping — `src/js-data/45-csv-import.js`

Two stages, free-first:

- **Stage 1/2, heuristics — `resolveCsvHeuristically()` (`:76-133`).** Stage 1 matches headers against `CSV_HEADER_ALIASES` (`:9-18`, diacritic-stripped/lowercased) for `occurred_at`, `amount`, `description`, `category`, `counterparty`, `currency`, `paid_by`, `split_with`. Stage 2 content-sniffs every sample row in the mapped date/amount columns via `classifyDate()`/`classifyAmount()` (`:31-70`), collecting the *set* of formats/styles seen. A column can be correctly identified while its values still disagree on format — that split (not the mapping itself) is what decides whether Gemini gets called: `needsLLM` is true if a required field isn't mapped, or the date formats seen have more than one member (`dateAmbiguous`), or the amount styles seen have more than one member (`amountAmbiguous`) (`:109-123`). A single ambiguous row (e.g. day ≤ 12) can't disambiguate `dd/mm` vs `mm/dd` alone — it's a genuinely mixed sample across the file that trips this.
- **Stage 3, Gemini fallback — `callCsvMappingFallback()` (`:139-158`), entry point `resolveCsvMapping()` (`:163-170`, bridged as `window.fhResolveCsvMapping`).** Only called on a genuine heuristic miss. Caps the sample to 15 rows, masks it (see next section), attaches the caller's Supabase access token, and POSTs to `/api/csv-column-mapping`. Rows with `hasMissingRequired` (blank date/amount cells) never reach the LLM at all — there's no signal for it to reason about — and fall through to human review regardless of `resolvedBy`.

### 3. Masking before the network call — `src/js-data/43-redact-for-sharing.js`

This is the privacy fix. `fhShouldMaskForSharing()` (`:11-13`) gates on `fhEncState() !== 'off'` — the family's encryption *intent* — deliberately **not** `fhEncOn()`, which additionally requires `fhKeyReady()` (`15-crypto.js:207`). The reasoning (carried over from `CSV-IMPORT-ENCRYPTION.md`): masking a network-bound sample isn't a write and never touches the key, so it should follow "this family turned encryption on," independent of whether this particular device happens to have the key unwrapped this session (e.g. right after an iOS IndexedDB eviction, before the unlock prompt fires). Gating on `fhEncOn()` would let an un-unlocked device send real data while a locked family "trusts" it not to.

When masking applies, `fhMaskRowForSharing()` (`:56-62`) classifies each cell without needing the resolved mapping yet (masking has to work *before* mapping is known):
- **Amount-shaped** (`fhLooksAmountShaped`, `:37-41`, digits + typical amount punctuation) → `fhMaskAmountText()` (`:23-25`) replaces every digit independently with a random digit, leaving separators/decimal points/sign untouched. This preserves exactly the digit-count/separator shape `classifyAmount()` needs to disambiguate a format — the only reason Gemini is called on an amount column at all — without ever sending a real figure. Randomized per row so masked rows can't be diffed against each other to infer relative magnitude.
- **Free-text-shaped** (`fhLooksFreeTextShaped`, `:47-49`, ≥12 chars with letters — long enough to distinguish a description from a short category/name token) → a single fixed placeholder, `'ghi chú mẫu'` (`fhMaskDescriptionText`, `:30-32`). No shape preservation needed here; Gemini only needs to know "this is a free-text column."
- **Dates are left untouched.** `txn_date` has no `_enc` column anywhere in the schema (the app's own encryption model doesn't treat dates as sensitive), and `date_convention` inference genuinely needs the real values.

The call site is `45-csv-import.js:141-143`, right at the network boundary inside `callCsvMappingFallback()` — masking lives at the actual fetch call rather than relying on every caller to remember to mask first.

This is the sibling the bank-email pipeline's own masking function was explicitly modeled on (per `AGENT_SYNC.md`) — see `docs/features/bank-email-pipeline.md` for that pipeline's version of the same problem.

### 4. Serverless proxy — `api/csv-column-mapping.js`

A Vercel function that proxies to Gemini (`gemini-flash-latest`, `:11`) so the API key never reaches the client. Added during **PWA hardening Phase 6** (`AGENT_SYNC.md:46-53`, shipped v296) with two gates in front of the Gemini call:
- **Auth** (`_verifyUser()`, `:36-44`): the caller's Supabase access token is verified against `/auth/v1/user`; no valid signed-in user → `401`.
- **Rate limit** (`_rateLimited()`, `:26-33`): an in-memory sliding-window cap, 12 calls/user/minute and 60/minute globally per warm instance. Explicitly a backstop, not a hard guarantee — Vercel functions are per-instance and short-lived, so this doesn't cap traffic across instances; the JWT check is the real gate.

Server-side, the sample is independently capped to 15 rows (`MAX_SAMPLE_ROWS`, `:14`) regardless of what the client sent. The model is asked to map each column to one of `occurred_at`/`amount`/`description`/`category`/`counterparty`/`currency`/`paid_by`/`split_with`/`unmapped`, plus a whole-column date convention (`dd/mm/yyyy`/`mm/dd/yyyy`/`unclear`) inferred from every sample row together (`SYSTEM_PROMPT`, `:46-59`) — a response schema (`:61-86`) constrains the output shape.

### 5. Candidate building and bucketing — `src/js-ui/57-csv-import-review.js`

Scope for this pass is **expense rows only** — `transactions` has no direction column, and income lives in a separate `incomes` table this code never writes to (file header comment, `:9-15`).

`buildCsvCandidates()` (`:86-136`) turns every parsed row into a candidate, never throwing on a bad row (flags it and continues, so one malformed line can't abort the whole import). Category resolution tries three signals in confidence order, and none of them ever produce a category the family doesn't actually have:
1. The file's own category column, exact match after normalization (`matchCategoryName()`, `:51-59`, against `window.catOrder`).
2. The family's own history — `csvHistoryCategoryMap()` (`:66-74`) walks `window.txns` (already client-side-decrypted, newest-first) for a prior human categorization of the same normalized description.
3. `guessCat()` keyword matching (`:122-124`) — the same guesser bulk logging uses.

A guess is never silently final: it lands as a visible, tappable default on the review screen, which is the actual human gate before anything writes.

`bucketCsvCandidates()` (`:152-184`) sorts every candidate into exactly one of `ready` / `needsCategoryGroups` (grouped by normalized description) / `possibleDuplicate` / `deferred`, running dedup before bucketing so a row can never land in `ready` while also being a duplicate:
- **Self-dedup**: same normalized description + amount seen twice within the batch.
- **Cross-source dedup**: matches an existing `window.txns` entry within 3 days and <1 unit of amount.
- **Deferred**: rows missing a date or amount, or every row in the file when `csvColumnHasMixedSigns()` (`:141-145`) detects the amount column mixes positive and negative values — a real bank statement combining income and expense. This pass doesn't attempt to distinguish them; guessing wrong here corrupts the ledger (miscategorizing an income row as an expense), not just mis-files it, so the whole file defers to manual per-row confirmation rather than auto-importing anything.

### 6. Review UI — `src/js-ui/56-csv-import-ui.js`

`openCsvImport()` → file picked (`onCsvFileSelected`, `:41-64`) → `fhParseCsvFile` + `fhResolveCsvMapping` → `csvBuildReview()` (`:71-85`) builds the review state (kept around so re-adopting categories can rebuild from scratch) → `renderCsvReview()` (`:187-313`).

Notable UI mechanics:
- **Trust strip** (`:285-303`) — answers "is this safe to import?" right before the decision: count, total, date span, rows read from the file, and an explicit breakdown of what's *not* importing (undecided rows, skipped duplicates). Nothing is ever dropped silently.
- **First-run category adoption** (`csvAdoptFileCategories()`, `:131-141`) — one tap adopts every category name the file uses that the family doesn't have yet, then re-runs `csvBuildReview()` so everything re-categorizes against the new set. Client-side only at this point; the actual `categories` DB rows are created lazily by `_categoryIdForName()` at promote time, not at adoption time.
- **Inline expansion** — the same dense `.row` component the Finance tab uses, tapping unfolds an editor in place (`csvExpandHtml`, `:163-183`), one row open at a time, matching bulk logging's accordion interaction.
- **Mixed-sign safety mode** — when `mixedSignsNote` is set, a notice card explains nothing was auto-imported and every row needs a manual tap-to-confirm.

### 7. Promotion — `csvPromote()` (`56-csv-import-ui.js:407-418`)

This is the fix for the second historical problem. `csvPromote()` maps every `csvReview.ready[]` candidate into the same shape bulk expense logging's `bulkRows` array uses (`{ note, amt, cat, who, date }`) and calls `submitBulk()` (`src/js-ui/50-sheets-expense-capture.js:662-693`) directly — **no bespoke insert exists anywhere in the CSV import code.** `submitBulk()` loops calling `window.addExpense()` once per row (`:683`).

`addExpense()` itself is defined in `src/js-ui/60-transactions.js:209-267`, but the call CSV import (and bulk logging) actually goes through is the write-through–wrapped version installed in `src/js-data/50-writethrough-realtime.js:2-25`: that wrapper checks `_fhWriteLocked()` (`40-txn-writes-outbox.js:266-274`) **before** the optimistic local row is even created, then calls the real `addExpense()`, then asynchronously persists via `_dbInsertTxn()` (`40-txn-writes-outbox.js:275-306`), which builds the row through `fhField('amount', ...)` / `fhField('note', ...)` — the correct plaintext/dual/ciphertext shape for the family's current `enc_state` — and queues to the offline outbox on a connection drop or an `enc_required` rejection rather than losing the write.

This is precisely how CSV import inherits `0033`'s encryption enforcement for free instead of needing a second write path kept in sync by hand — and it's a *per-row* gate, not a dedicated batch-level pre-check. `CSV-IMPORT-ENCRYPTION.md`'s design notes floated adding a single up-front `_fhWriteLocked()` check before row 1 of a promotion batch; no such batch-level check exists in `csvPromote()` or `submitBulk()` — each row's `addExpense()` call re-runs the same guard bulk logging always ran per-row. Practically, if the family is locked, every row in the loop hits the same guard and is skipped the same way (the passcode prompt fires from the first blocked call). One real gap worth knowing: `submitBulk()`'s completion toast (`"Đã ghi N khoản"`) and navigation (`:687-692`) fire unconditionally after the loop — it does not check whether `_dbInsertTxn()` calls actually succeeded, so a fully-locked import would still show a "logged" success toast.

## Current State

**Shipped and live** (client-side except the Gemini proxy):
- Full pipeline: parse → heuristic mapping → Gemini fallback (masked) → candidate build/bucket → review UI → promotion via `submitBulk()`.
- Masking before every Gemini call for `enc_state != 'off'` families (`43-redact-for-sharing.js`).
- Promotion reuses the exact write path bulk expense logging uses — inherits `fhField()`/`_fhWriteLocked()` correctness, no bespoke insert.
- Gemini proxy gated behind Supabase JWT verification + best-effort rate limiting (shipped in PWA hardening Phase 6, v296).
- Self-dedup, cross-source dedup against existing transactions, mixed-sign safety deferral, first-run category adoption.

**Known discrepancy — the staging table is schema-only and unused.** `supabase/migrations/0043_csv_transactions_staging.sql` defines a `csv_transactions` table with full `_enc` sibling columns, RLS policies, and a `_fh_enc_guard()` trigger extension (`:119-172`) — built encryption-aware from day one per `CSV-IMPORT-ENCRYPTION.md`'s "staging table" discussion. **Nothing in `src/` or `api/` references `csv_transactions`** (verified via `grep -rn csv_transactions src/ api/` — zero hits). The actual pipeline goes straight from parsed rows to `bulkRows`/`submitBulk()` (§7 above), bypassing the staging table entirely. The table appears to be schema built ahead of a promotion design that was superseded once direct reuse of `submitBulk()` was chosen as the write path — it is not part of the live data flow. The same is true of `supabase/migrations/0034_csv_format_fingerprints.sql` (a mapping-cache table for reusing a resolved column shape across files/families): also schema-only, zero references in `src/`.

There are two different files both numbered migration `0043` in this repo (this one and `0043_family_card_birth.sql`) — a known numbering irregularity from concurrent agent sessions; see `../COLLABORATION.md` for the fuller story.

## Related

- `../ARCHITECTURE.md` — cross-cutting patterns this doc doesn't re-explain (build system, hydrate/write-through model).
- `docs/features/encryption.md` — the `enc_state`/`fhEncState()`/`fhKeyReady()` machinery this doc's masking gate and write-path enforcement key off of; owns the full key hierarchy and `off → dual → enc` lifecycle.
- `docs/features/bank-email-pipeline.md` — the sibling server/bulk-write path into money tables; the masking function in `43-redact-for-sharing.js` was explicitly modeled as the template for that pipeline's own masking fix (per `AGENT_SYNC.md`).
- `CSV-IMPORT-ENCRYPTION.md` (repo root) — the original design conversation between the CSV-import and encryption sides; useful for the reasoning trail, but its "neither fix here is built yet" opening is stale — both fixes described in this doc are shipped.
- `../COLLABORATION.md` — the fuller story on the duplicate `0043` migration numbering.
