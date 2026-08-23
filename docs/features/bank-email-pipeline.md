# Bank-Email Pipeline

## Problem & Why

FamilyHub has two ways money gets into the ledger today: manual entry through the app, and bulk CSV import of bank statement exports (`docs/features/csv-import.md`). Both require the user to actively do something — open the app, pick a file. The bank-email pipeline is a third, passive path: banks and payment providers already email a transaction notification for nearly everything (transfers, card charges, subscription receipts, bill payments); if a user forwards those emails to a dedicated inbox, the transaction can be captured without the user doing anything beyond a one-time Gmail filter setup.

The design was proposed and prototyped by Trang (Growth), validated against real forwarded bank emails in a live test — Gmail forwarding, `+tag` identity resolution, and a spam-flag issue that was found and fixed during that test (`supabase/migrations/0025_bank_email_pipeline.sql:8-12`).

The schema is deliberately staging-first, not a shortcut into the real ledger: every parsed email lands in `email_transactions` with `review_status = 'pending'`, and only promotes into `transactions` after a human approves that specific row — extraction is LLM-assisted and Vietnamese bank email formats vary enough that silent auto-promotion would put unreviewed, potentially wrong amounts into a family's real financial history (`0025_bank_email_pipeline.sql:17-22`). This mirrors the same trust posture as CSV import: bulk/automated writers stage, humans commit.

## Architecture & How It Works

**What's actually live vs. not** — this is the single most important thing to get right when reading this pipeline, because the schema, the code, and the seed data live in three different places with three different statuses:

| Layer | Status | Where |
|---|---|---|
| 6-table schema | **Live on `main`, applied to production** | `supabase/migrations/0025_bank_email_pipeline.sql`, `0027_bank_email_categorization.sql`, `0028_bank_email_member_routing.sql` |
| Pipeline implementation (Google Apps Script) | **Unmerged**, not wired to any CI/CD | branch `origin/bank-email-pipeline-code`, `pipeline/bank-email-pipeline.gs` |
| `known_provider_domains` seed data | **Unmerged**, not applied | branch `origin/bank-email-known-providers-seed`, `supabase/migrations/0050_known_provider_domains_seed.sql` |
| Review/promotion UI | **Does not exist** | grep for `email_transactions` / `mailbox_connections` across `src/` and `api/` returns zero hits |

Concretely: `git show origin/bank-email-pipeline-code:pipeline/bank-email-pipeline.gs` and `git show origin/bank-email-known-providers-seed:supabase/migrations/0050_known_provider_domains_seed.sql` are the only ways to read this code from the current working tree — neither file exists on `main`. The deployed copy of the script runs today as an Apps Script bound to a shared Gmail inbox (`gichisreading@gmail.com`), **deployed by pasting `bank-email-pipeline.gs` into the Apps Script editor whole-file**; wiring `clasp` so deploys come from the repo instead of the clipboard is a stated TODO (`pipeline/README.md`, "How it works" / TODO note on `origin/bank-email-pipeline-code`). There is no automated deploy, no tests running in CI, and no code review gate between an edit to the branch and what's actually running against the live inbox. Promotion into `transactions` is explicitly "a separate, not-yet-built review flow" per the script's own comments (`pipeline/bank-email-pipeline.gs:96` region / Stage 2 promotion comment, `origin/bank-email-pipeline-code`) and the folder README.

### Schema (live, `0025`/`0027`/`0028`)

Six additive tables — no existing table (`transactions`, `members`, `categories`, `families`) is altered:

- **`email_transactions`** (`0025_bank_email_pipeline.sql:62-91`) — the staging/ingestion log, never the real ledger. Keyed on `gmail_message_id` (dedupe). Notable columns: `transaction_type` (`bank_txn`/`subscription`/`ecommerce_receipt`/`p2p_transfer`/`bill_payment`), `currency` (per-row — the real `transactions` table has no currency column, see Current State), `raw_body`/`raw_extracted` (full email + full LLM output, kept for reprocessing), `review_status` (`pending`/`approved`/`rejected`), `promoted_transaction_id` (FK into `transactions`, set once a row is promoted), `duplicate_of_id` (self-FK, set by the cross-source dedup check — a **suspicion** shown to the reviewer since 2026-08-23, never a reason to hide a row; see Current State). `member_id` was added later by `0028` (`0028_bank_email_member_routing.sql:15-16`) so a future review UI can route a pending row to the right person's queue without re-deriving identity from the original Gmail message.
- **`parse_failures`** (`0025_bank_email_pipeline.sql:93-101`) — anything the pipeline couldn't parse or classify; raw body + `error_reason` kept for triage.
- **`sender_fingerprints`** (`0025_bank_email_pipeline.sql:118-130`) — classification/extraction cache keyed on `(sender_address, subject_template)`, **not** sender alone, because a single sender (especially a human forwarding address) can send both transaction and non-transaction mail. `is_transaction_source` is the cached classifier verdict; `extraction_regex` is the promoted local-parse template (technical confidence — parsing worked); `human_verified` is set only when a person approves a pending row using that fingerprint (ledger-write confidence) — as of `0027` this no longer gates promotion at all, see below.
- **`mailbox_connections`** (`0025_bank_email_pipeline.sql:138-145`) — resolves a forwarded email to a family member via a per-member `+tag` forwarding alias (`txn+<id>@yourapp.com`) on one shared inbox, not a separate mailbox per user and not by guessing at headers. `member_id` FKs into `members(id)`.
- **`known_provider_domains`** (`0025_bank_email_pipeline.sql:152-159`) — global (not per-user) seed of bank/provider sender domains; drives an onboarding bank-picker UI and backfill targeting. Does not pre-populate `sender_fingerprints` (still needs a real email to derive a `subject_template`).
- **`category_rules`** — existed in `0025`, **dropped by `0027`** (`0027_bank_email_categorization.sql:29`). Original idea was keyword → category-name guessing; superseded by a product decision that categorization is human-driven, not rule-based, because a single sender/template spans many real categories depending on the specific transaction (`0027_bank_email_categorization.sql:9-19`).

All six tables are `enable row level security` with **no policies** (`0025_bank_email_pipeline.sql:168-173`) — service-role-only, matching the project's existing RLS posture for backend-pipeline tables (`0004`/`0005`); `anon`/`authenticated` get zero rows.

### Pipeline stages (unmerged — `pipeline/bank-email-pipeline.gs` on `origin/bank-email-pipeline-code`)

The script is a time-driven Apps Script trigger (`processEmails`, every 1 minute per the file's setup header, `pipeline/bank-email-pipeline.gs:1-14`) over a Gmail label:

```
Gmail filter labels bank email txn/inbox
  → processEmails() (gs:20-38) — search label:txn/inbox, iterate messages
      → processOneMessage() (gs:40-94)
          fingerprint lookup (sender + normalizeSubjectTemplate(subject))
            known non-transactional        → relabel txn/processed, skip
            stored extraction template     → applyExtractionTemplate(), zero LLM
            unknown / template mismatch    → maskForSharing() → Gemini classify+extract → unmaskExtraction()
                                              → deriveExtractionTemplate() stores template for next time
      → findDuplicate() cross-source dedup (gs:612-638) → resolveMemberId() via +tag (gs:668-673)
      → buildEmailTransactionRow() → insertEmailTransaction() (gs:640-666) → relabel txn/processed
      → on any error: insertParseFailure() + relabel txn/parse-failed
```

- **Stage 0 (fetch)**: `extractEmailAddress`, `normalizeSubjectTemplate`, `relabelMessageThread`/`relabelThread` (`gs:98-121`). Subject normalization strips reference numbers (`/#[\w-]+/g`, `/\b\d{6,}\b/g`) and date-like substrings so a *specific* subject collapses to a stable *template* — otherwise every email would look like a new kind of email from the same sender.
- **Stage 1 (classify & extract)**: `findFingerprint` (`gs:125-131`) looks up the `(sender, template)` cache. A daily/per-run LLM call ceiling — `MAX_NEW_CLASSIFICATIONS_PER_RUN = 10`, `MAX_NEW_CLASSIFICATIONS_PER_DAY = 50` (`gs:16-17`) — leaves unprocessed messages labeled `txn/inbox` to retry on the next run/day rather than erroring. Model is `gemini-3.5-flash-lite` (free tier, `gs:333`) via `classifyAndExtractViaGemini` (`gs:335-373`); an `ANTHROPIC_API_KEY`/`classifyAndExtractViaHaiku` path (`gs:300-328`, using `claude-haiku-4-5`) is left in place unused — the setup comment notes swapping back is a one-line change in `processOneMessage`.
- **Local-parse fast path**: after the *first* successful LLM extraction for a `(sender, template)` pair, `deriveExtractionTemplate` (`gs:506-568`) builds a per-field anchor+capture+transform spec that provably reproduces that email's own extraction (verified by re-running `applyExtractionTemplate` against its own derivation before storing, `gs:559-568`). Every later matching email is parsed by `applyExtractionTemplate` (`gs:570-598`) with **zero LLM involvement** — no cost, no data leaving the script at all. A structurally different email fails the anchors and falls back to the LLM, re-deriving a new template. Templates carry `EXTRACTION_LOGIC_VERSION` (`gs:406`, currently `2`) — bumping it after a prompt/logic change self-invalidates every stored template, forcing one fresh LLM re-derivation per sender.
- **Stage 2 (write)**: `findDuplicate` (`gs:612-638`) — cross-*source* dedup only (same amount + direction within a ±3-day window from a *different* `source_provider`); two emails from the same provider are never treated as duplicates of each other, since each already carries its own `gmail_message_id`/`reference_number` and same-provider/same-amount/same-day is plausibly two real, separate transactions. `resolveMemberId` (`gs:668-673`) parses the `+tag` off the message's `To:` header via `extractPlusTag` (`gs:675-678`) and looks up `mailbox_connections`; returns `null` (row still written, just unrouted) if no match. `buildEmailTransactionRow`/`insertEmailTransaction` (`gs:640-666`) write the pending row via the Supabase REST API using the service-role key (`supabaseGet`/`supabasePost`/`supabasePatch`, `gs:745-793`) — the same client any RLS-bypassing backend job uses.

### Masking — the one piece that's built and verified

Before either LLM call, `maskForSharing` (`gs:169-233`) replaces every sensitive token in the subject+body with a fake of identical shape — digit count, separators, leading-zero-ness for amounts/accounts/refs/phones; a small fake-name pool for ALL-CAPS personal-name runs (Vietnamese bank emails write names this way), with an institutional-caps blocklist (`VND`, `MB`, `BANK`, `TMCP`, `OTP`, etc., `gs:166`) so bank/product names aren't mistaken for people; email addresses become `userNNNN@example.com`. Dates/times are deliberately left real (the model has to resolve their format, and a date alone identifies no one). This is unconditional — no `enc_state` check — per the product's "no one knows your data except you" stance (`gs:153-163`). `unmaskExtraction` (`gs:235-259`) swaps the real values back into the LLM's JSON output afterward: string fields via longest-first substring replacement, `amount` via a masked-number → real-number map built during masking.

This is explicitly modeled on the app's own CSV-import masking: `src/js-data/43-redact-for-sharing.js` (`fhMaskSampleRowsForSharing`) masks structured CSV rows before they reach Gemini for column-mapping; `maskForSharing`/`unmaskExtraction` are the sibling for unstructured email prose, needing regex passes over free text plus **reversibility** (CSV masking never needs to recover real values from the model's answer — bank-email extraction does, since the extracted amount/name/account has to make it into `email_transactions`). Comments in the `.gs` file call this out directly (`gs:162-163`). It was verified end-to-end against the live Gemini API on a real MB Bank email, 2026-08-06 — identical classification/extraction quality, zero real values sent (AGENT_SYNC.md resolved entry, 2026-08-06 bank-email session; also noted in the masking comment block, `gs:159-161`).

### Proposed hardening: sealed-box staging (design only, unshipped)

`bank-email-sealedbox-flow.drawio.xml` and `encryption-mechanics-granular.drawio.xml` (repo root) design a scheme where the pipeline never has to write plaintext to `email_transactions` at all. Swimlanes: User / Device (keys & crypto) / Webapp Frontend / Webapp Backend (Supabase) / DB (Postgres) / Pipeline (Apps Script) / Mailbox (Gmail) / Gemini. Flow, per the diagram:

1. On connecting a bank-email source, the device generates an X25519 keypair; the private key is wrapped under the family DEK (`priv_enc = encVal(DEK, priv)`) and an RPC stores `family_keys: pubkey` (plaintext, it's public by design) + `priv_enc`.
2. The pipeline fetches the family's **public** key, masks and extracts as today, then seals the row with an ephemeral-X25519 sealed box (`sealed_ct = eph_pub‖ciphertext‖tag`, ephemeral private key discarded immediately) bound to `family_id`/row id, and inserts `email_transactions.sealed_ct` — a value the server itself cannot open.
3. On the family member's next app open, the client fetches the sealed row + `priv_enc`, unwraps `priv` with the already-unlocked DEK, opens the sealed box locally to get the plaintext transaction, runs client-side dedup, and shows it in a review screen.
4. On approval, the client encrypts the money fields under the family DEK as usual (`AES-GCM(DEK) amount/note`) and inserts into `transactions`, marking the staging row promoted.

This is **design intent only** — no sealed-box code exists in `src/js-data/15-crypto.js` or anywhere else in the client, and no schema for `sealed_ct` or the X25519 keypair exists in any migration. It is option 2 in the open encryption question below.

## Current State

> **Read this first — most of this section predates the work that answered it.**
> Everything below the next two paragraphs was written before sealed staging and
> the review screen shipped. It is kept for the reasoning, not the status.
>
> - *"Unresolved: who encrypts `email_transactions`"* — **resolved.** Option 2
>   (asymmetric sealed box) was built: `0065` + `0068`, `pipeline/sealed-box.gs`,
>   `pipeline/SEALED-STAGING-DESIGN.md`. There is no plaintext-at-rest window.
> - *"Review UI unbuilt"* — **built.** `src/js-data/72-txn-review.js` drives the
>   CSV import screen in staged mode.
>
> **Dedup, amended 2026-08-23.** `duplicate_of_id` is a suspicion the reviewer
> resolves, not a row the pipeline may hide. It was filtered out of the staged
> fetch, which let a guess made with no human present — on a rule that treated
> "MB Bank" and "MBBank" as different institutions — delete a real 2.000đ
> transfer from view and cancel its notification, with nothing on screen and no
> way back. Flagged rows now land in the review screen's "possible duplicate"
> bucket, and `queueReviewNotice` announces them. The client additionally runs
> the same cross-source rule itself (`csvStagedCrossSourceDup`), with the
> decrypted amount and the unsealed `source_provider` — more evidence than the
> pipeline has, in front of the person who made the purchase. `dedup_fp` is
> unchanged and still correct; it is no longer load-bearing. Rationale and the
> full comparison of server-side vs client-side dedup: `SEALED-STAGING-DESIGN.md`
> §7.

**Unresolved: who encrypts `email_transactions`, and when.** This is the pipeline's single biggest open design question, raised in `AGENT_SYNC.md`'s Open section (2026-08-07 entry, "from bank-email pipeline") and not yet answered as of the most recent entry in that file. The problem is structural, not a missed detail: FamilyHub's existing "staging tables get `_enc` columns from day one" pattern assumes the writer holds the family DEK (true for CSV import — the client writes CSV staging rows and already has the key in memory) — but the bank-email writer is an **unattended server-side script** (Apps Script today; any future backend replacement has the same property) that by design can **never** hold the family DEK. `_enc` columns alone don't answer who fills them. Three options are on the table (`AGENT_SYNC.md`, Open section, 2026-08-07 entry):

1. **Coverage-job pattern** (reuse existing machinery) — rows land plaintext; the next time any family member opens the app, the client encrypts pending staging rows and nulls the plaintext, the same shape as the existing legacy-row coverage job (`fhEncCoverSweep`, see `docs/features/encryption.md`). Cost: a plaintext-at-rest window between ingestion and the family's next app-open — hours to days for an inactive family.
2. **Asymmetric sealed-box envelope** (new machinery) — a per-family X25519 keypair; the pipeline encrypts staging rows to the family's *public* key at write time, clients decrypt with the private key (itself wrapped under the DEK). Zero plaintext-at-rest window, but new crypto surface in `15-crypto.js` and a second key to wrap/rotate. This is the scheme diagrammed in `bank-email-sealedbox-flow.drawio.xml` / `encryption-mechanics-granular.drawio.xml`, described above.
3. **Treat staging as a transient buffer** — keep plaintext but hard-shrink exposure: auto-delete rows on promotion/rejection plus a short TTL on pending rows. Flagged as the weakest option — the linked `CSV-IMPORT-ENCRYPTION.md` discussion already leaned against "it's temporary" as a justification for a different staging table.

The author's stated lean is **option 1, for pragmatism** — but flags option 2 as the only one of the three that fully honors the product's "no one but you" promise given an unattended writer. The masking step already closes the LLM leg of this problem (subject/body never reach Gemini unmasked); this open question is specifically about the row **at rest** in `email_transactions` between insertion and promotion/rejection.

Three more open design questions, flagged rather than resolved, directly from `0025`'s own migration header (`0025_bank_email_pipeline.sql:43-56`):

- **Currency / FX handling** — `email_transactions.currency` is per-row (there's a real USD sample, e.g. an Anthropic receipt), but the real `transactions` table has no per-row currency column — the app's currency is family-level. Where FX conversion happens before promotion is undecided.
- **Category resolution** — `0027` made categorization human-driven per-transaction rather than cached per-sender (`0027_bank_email_categorization.sql:9-19`), so promotion needs a person to pick a real `category_id` on every row regardless of `sender_fingerprints.human_verified`. `resolveCategoryId()` in the Apps Script is a stub that always returns `null` (referenced in `0025_bank_email_pipeline.sql:49-52`) — nothing auto-promotes today either way, independent of this pipeline's other maturity.
- **Mailbox onboarding UX** — how a member actually obtains their per-member `+tag` forwarding address and sets up the Gmail filter. Designed conceptually (the `known_provider_domains` seed exists specifically to drive a future bank-picker UI), but no UI has been built.

**Migration-numbering churn on the seed branch.** The `known_provider_domains` seed migration was renumbered twice before landing at its current number, entirely due to numbering collisions with unrelated work merging to `main` in parallel (`AGENT_SYNC.md`, Resolved section, 2026-08-06 entries): originally proposed as `0044_known_provider_domains_seed.sql` on `bank-email-known-providers-seed`, that number turned out to already be consumed-then-reverted by an unrelated feature (`0044_card_claim_links.sql`, applied then dropped via `0045_drop_card_claims.sql`) on `main`, so it was renumbered to `0048_known_provider_domains_seed.sql`. A later `main`-side migration (`0048_snapshot_windowing.sql`) then took `0048` for real, so the seed branch needed a second renumber; verifying directly against the branch today (`git ls-tree -r --name-only origin/bank-email-known-providers-seed -- supabase/migrations/`) shows the final filename is **`0050_known_provider_domains_seed.sql`**, still unmerged. Its content: 11 major Vietnamese bank sender domains (Vietcombank, MB Bank, Techcombank, ACB, VPBank, BIDV, Agribank, TPBank, Sacombank, HDBank, SHB), idempotent (`on conflict (domain_or_address) do nothing`), with two corrections from the "obvious" domain guess called out in its own header: Techcombank is `techcombank.com` (not `.com.vn`), TPBank is `tpb.vn` (not `tpbank.com.vn`).

**Summary of what's actually true today:** schema live, pipeline code and provider seed unmerged, review UI unbuilt. Nothing described in this doc beyond the six-table schema itself should be read as "in production." The masking mechanism (`maskForSharing`/`unmaskExtraction`) is the one functional piece verified end-to-end against a real email, but it runs inside code that isn't deployed from this repository at all yet.

## Related

- `../ARCHITECTURE.md` — cross-cutting patterns (hydrate model, RLS posture, migration-numbering conventions) this doc doesn't re-explain.
- `docs/features/encryption.md` — the DEK/AES-GCM layer this pipeline's staging rows will eventually need to respect; that doc's Current State section explicitly defers the "who encrypts `email_transactions`" question back to this doc.
- `docs/features/csv-import.md` — the other server/bulk-write path into money tables, and the source of the masking pattern (`43-redact-for-sharing.js`) this pipeline's `maskForSharing`/`unmaskExtraction` are modeled on.
- `AGENT_SYNC.md` — Open section, 2026-08-07 entry ("design question for the encryption owner") is the live, unresolved encryption-ownership question; Resolved section, 2026-08-06 entries cover the masking build-out and the migration-renumbering history.
- `supabase/migrations/0025_bank_email_pipeline.sql`, `0027_bank_email_categorization.sql`, `0028_bank_email_member_routing.sql` — the live schema.
- `origin/bank-email-pipeline-code` branch, `pipeline/bank-email-pipeline.gs` + `pipeline/README.md` + `pipeline/extraction.md` — the unmerged pipeline implementation, LLM prompt/schema, and masking algorithm notes.
- `origin/bank-email-known-providers-seed` branch, `supabase/migrations/0050_known_provider_domains_seed.sql` — the unmerged provider-domain seed.
- `bank-email-sealedbox-flow.drawio.xml`, `encryption-mechanics-granular.drawio.xml` (repo root) — the proposed sealed-box hardening design (option 2 above), unshipped.
