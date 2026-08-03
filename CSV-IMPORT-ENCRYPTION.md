# CSV import × encryption — compatibility guide

Written from the CSV-import side (a parallel Claude Code session, this same repo) for
whoever's working on encryption to read and discuss. Neither fix here is built yet —
this is the concept writeup so we agree on an approach before either side builds it.
It's also, concretely, the "explicit lane" `0033_enc_enforcement.sql`'s own comment
says a bank-import-style pipeline needs before it can write into an encrypted family.

## Where CSV import stands today

Built and tested, all client-side except the one serverless function noted:

- `src/js-data/44-csv-parse.js` — quote-aware CSV parser (raw text → headers + rows).
- `src/js-data/45-csv-import.js` — header-alias + per-row format heuristics
  (`resolveCsvHeuristically`); decides if the mapping is confident enough or needs
  the Gemini fallback (`resolveCsvMapping`, bridged as `window.fhResolveCsvMapping`).
- `api/csv-column-mapping.js` — Vercel serverless function, proxies to Gemini
  (`gemini-flash-latest`) only when heuristics can't confidently resolve column
  mapping or a date/amount format. Validated end-to-end against real messy sample
  data (a Vietnamese shared-expenses export with 8 mixed date formats).
- `src/js-ui/56-csv-import-ui.js` — a technical-preview screen: add-sheet entry →
  pick a file → shows the resolved mapping. **Writes nothing to the database** —
  preview only, by design, labeled as such on screen.
- `supabase/migrations/0034_csv_format_fingerprints.sql` — cache table so a second
  file with the same header shape (from any family) skips the Gemini call. Stores
  only `{column_index, field, confidence}` shapes, never real values — no
  encryption implications on its own.

**Not built yet:** the review/confirm screen (merchant grouping, category
assignment, duplicate check) and the promotion step that writes approved rows into
`transactions`. That promotion step is where both problems below actually bite —
nothing shipped so far touches money data server-side or writes to the ledger.

## Problem 1 — Gemini sees real sample data

`resolveCsvMapping` sends a small sample of real rows (capped at 15, never the
whole file) to Gemini when heuristics can't confidently resolve the mapping —
including real amounts and descriptions. For a family with `enc_state != 'off'`,
that's real financial data leaving the device to a third party, independent of
anything about our own database — it contradicts the reason the family turned
encryption on in the first place.

Three options, need to pick one:

- **(a) Mask amounts before sending.** Replace real digits with fake ones that
  preserve the format shape (grouping style, digit count) — Gemini can still infer
  "this is an amount column" without ever seeing the real figure. Best privacy,
  keeps the smart fallback working for encrypted families too. Most engineering
  effort (need a reliable number-shape-preserving redactor).
- **(b) Skip Gemini entirely when `fhEncState() != 'off'`.** Heuristics-only for
  encrypted families; fall back to a manual "pick your columns" UI on a genuine
  miss. Zero risk, simplest to build, but encrypted families get a worse import
  experience specifically because they're encrypted — a little backwards.
- **(c) No special handling.** Accept the exposure as a small, ephemeral sample.
  Simplest, but inconsistent with what encryption promises everywhere else in the
  app.

Leaning (a) from the CSV-import side, but this is as much a product/values call as
a technical one — flagging for discussion, not deciding unilaterally.

## Problem 2 — the promotion write needs an encryption-aware path

This one is sharper, and already enforced, not just a future gap: `_fh_enc_guard()`
(`0033_enc_enforcement.sql`) rejects any insert/update on `transactions.amount`
(and the other protected column pairs) that doesn't carry proper ciphertext, once
`enc_state != 'off'`. A naive `sb.from('transactions').insert({amount: ...})` from
a CSV promotion step throws `enc_required:transactions.amount` for any dual/enc
family today. This isn't something to close later — it already blocks a naive
implementation outright, which is arguably the right failure mode (loud, not
silent) but still needs an actual fix before CSV import can promote anything for
an encrypted family.

**Proposed fix:** don't write a bespoke insert for promotion — reuse the existing
write path. Bulk expense logging (`submitBulk()` in
`src/js-ui/50-sheets-expense-capture.js`) already loops calling `window.addExpense()`
per row, which is the same shape as "promote N approved CSV rows." That path
already goes through `_dbInsertTxn()` → `fhField('amount', v)` / `fhField('note', v)`
→ the correct plaintext/ciphertext write shape for the family's current state, and
already checks `_fhWriteLocked()` (blocks the write and prompts for the passcode if
the family is `enc` and this device hasn't unwrapped the key). Reusing it means CSV
import inherits encryption-correctness for free, and stays correct automatically as
the encryption feature keeps evolving, instead of a second write path that has to
be kept in sync by hand.

One UX adaptation this needs: `_fhWriteLocked()` today gates a single write.
Promotion is a batch of N rows — we'd want that check once, up front, for the
whole batch (block the entire import and prompt for the passcode before starting),
rather than getting partway through and stalling mid-loop on row 12. Small
adaptation, not a new mechanism.

## Also worth deciding together

- If CSV import gets its own staging table (open architectural question regardless
  of encryption — reuse `email_transactions` broadened, or a dedicated table?),
  should that table get `_enc` sibling columns from day one? Or is a
  staging-before-review window acceptable in plaintext, comparable to an amount
  sitting in a form's `<input>` before Save is pressed?
- The same open question applies to the bank-email pipeline — `0033`'s own comment
  flags it needs "its own explicit lane" too, and it's dormant for an unrelated
  reason (never deployed yet). If the shape of the fix is the same for both
  pipelines, worth designing it once, not twice.

## Encryption side: answers to the masking questions

Answering from `15-crypto.js` directly rather than from first principles, since the
existing design already implies these:

**1. Does masking need to cover description text too?** Yes. The encryption scheme
doesn't distinguish text from numbers — `fhField`/`fhRead` (`15-crypto.js:131,150`)
encrypt whatever field name they're given, and `note` sits in the protected-column
list right next to `amount` on every money table. There's no basis for treating a
description column as lower-stakes. Practically it's easier than amount-masking:
Gemini only needs to know "this is a free-text column," so generic placeholder
phrases (no shape preservation needed) are enough.

**2. Which check gates masking — `fhEncState() !== 'off'` or `fhEncOn()`?** Use
`fhEncState() !== 'off'`. The reason `fhEncOn()` adds `fhKeyReady()` is specific to
*writing*: `fhField`'s own comment (`15-crypto.js:123-130`) explains that in `enc`
state a missing key throws, because writing plaintext there would break the
promise — that's a capability check, it needs actual key material to produce
ciphertext. Masking a CSV sample before it leaves the device isn't a capability
question — it doesn't touch the key at all. What should gate it is the family's
*intent* ("we turned encryption on"), which `fhEncState()` captures independent of
whether this device happens to have unwrapped the key this session (e.g. right
after an iOS IndexedDB eviction, before the unlock prompt has fired). Gating on
`fhEncOn()` would let an un-unlocked device send real data while a locked family
"trusts" it not to — backwards.

**3. Existing masking utility to reuse?** No — grepped `src/` and `api/` for
`mask`/`redact`; the only hits are `scrub_plaintext_amounts` (server-side,
destructive, unrelated) and the crypto/enc-ui files. `fhField`/`fhRead` encrypt
real values for storage, they don't redact for third-party sharing — different
job. Worth writing as one small standalone utility rather than embedding it in
`45-csv-import.js`, since this doc already flags the bank-email pipeline will need
the identical fix later — one shared masker, two call sites.

**4. How much shape-leakage is OK?** Keep digit-count and separator style — that's
literally what `classifyAmount` (`45-csv-import.js:40`) is trying to disambiguate,
and it's the only reason Gemini gets called on amount columns (only on
`amountAmbiguous` / unmapped cases). But randomize the actual digits per row rather
than perturbing the real value, so masked rows can't be diffed against each other
to infer relative magnitude ("row 3 > row 1"). Flattening further (e.g. a fixed
`X,XXX` placeholder) would remove the exact signal the Gemini fallback exists to
resolve, which just pushes this back toward option (b)/skip-Gemini instead of the
Option A we picked.
