# Bank-Email Pipeline

Passive transaction capture: a bank emails you about a purchase, and the transaction
appears in the family ledger without anyone typing it.

> **Status, 2026-08-24.** Live end to end for allowlisted members. Pipeline
> `v2026-08-17-d`, sealed staging ON, review UI shipped, notifications delivering.
> Not live: consent screen, sender-auth enforcement, OAuth direct read, bank-domain
> seed. See [Current State](#current-state).

---

## Problem & Why

FamilyHub had two ways money reached the ledger, and both require the user to *do*
something: type an expense, or export and import a CSV. Both are acts of
bookkeeping, and bookkeeping is the thing people stop doing in week three.

Banks and payment providers already email a notification for nearly everything —
transfers, card charges, subscription receipts, bill payments. That mail is a
complete, timely, structured record of household spending that the user already
receives and mostly ignores. If those emails reach us, the transaction can be
captured with no user action beyond a one-time forwarding rule.

The design was proposed and prototyped by Trang (Growth) and validated against real
forwarded Vietnamese bank emails — Gmail forwarding, `+tag` identity resolution, and
a spam-flag issue found and fixed during that test
(`supabase/migrations/0025_bank_email_pipeline.sql:8-12`).

### Two decisions that shape everything downstream

**1. Staging, never direct writes.** Every parsed email lands in
`email_transactions` with `review_status = 'pending'` and reaches the real ledger
only after a person approves that specific row. Extraction is LLM-assisted and
Vietnamese bank formats vary enough that silent auto-promotion would put unreviewed
amounts into a family's financial history. Same trust posture as CSV import:
**automated writers stage, humans commit.**

**2. The writer can never read.** The pipeline is an unattended script. It cannot
hold the family's data-encryption key — there is nobody to unlock it. But
FamilyHub's promise is that nobody but the family can read their money. Those two
facts look incompatible, and resolving them is the reason for the sealed-box design
in [Sealing](#5-sealing--the-writer-that-cannot-read). The pipeline encrypts to a
public key it cannot decrypt with, and never sees the row again.

---

## The trust model

Everything below is easier to read if you hold the custody chain first. The data
crosses **three domains**, and almost every design decision is about what each one
is allowed to know.

| Domain | Holds | Can read a transaction? |
|---|---|---|
| **Google** — Gmail + Apps Script | the raw email, the service-role key, `DEDUP_FP_KEY` | **Yes**, in transit. This is the operator tier. |
| **Supabase** — Postgres + Storage | ciphertext, routing metadata, `staging_pub` | **No.** Sealed rows are opaque to it. |
| **The family** — their devices | the DEK, the staging private key | **Yes.** The only place it is readable again. |

Two consequences worth internalising:

- **The Apps Script sees plaintext.** Sealing does not hide anything from the
  pipeline; it hides it from the *database*. That is the honest boundary, and
  `pipeline/SEALED-STAGING-DESIGN.md` states it plainly rather than implying more.
- **Keys are split across companies on purpose.** `DEDUP_FP_KEY` lives in Apps Script
  Properties, never in Supabase, so a database dump cannot be attacked with it. The
  same Google-vs-Supabase split backs the TOFU key pin.

---

## Architecture & How It Works

### 0. Setup, once per member

| Step | What happens | Where it lives |
|---|---|---|
| Beta gate | `can_use_mailbox()` decides; the allowlist table is readable by no client, so nobody can enumerate the beta | `mailbox_beta_access`, migration `0067`; client `src/js-data/73-mailbox-gate.js` |
| Alias issued | `get_or_create_mailbox_alias()` returns `txn+<tag>@…`; the tag is the **only** identity signal the pipeline gets | `mailbox_connections`, migration `0059`; client `src/js-data/71-mailbox-ui.js` |
| Staging keypair | X25519 pair minted on a family device. Public half stored in the clear (it only locks); private half wrapped under the family DEK | `family_keys.staging_pub` / `.staging_priv_enc`, migration `0051`; client `src/js-data/18-staging-keys.js` |
| Forwarding rule | The user points Gmail at the alias, by hand | Nothing stored. A forwarded message arriving is the only trustworthy proof it works. |

**Identity is the `+tag`, not the `To:` header.** One shared inbox serves all users;
`To:` is typed text and can name anyone. `resolveMailbox()` parses the tag and looks
up `mailbox_connections` — everything else is discarded.

**Gmail search semantics are not what you would guess.** Auto-forwarding *preserves
the original `To:` header*, so `to:<alias>` does **not** match auto-forwarded mail; a
hand-forward does. That asymmetry is why `buildInboxQuery()` carries both `to:<alias>`
terms and a `(from:<bank domains>) newer_than:7d` term.

### 1. The run

An Apps Script trigger fires **every minute** against the shared inbox, holding a
script lock (`tryLock(0)`) so two runs can never overlap. Overlap is not a
theoretical worry: a run with LLM calls can exceed a minute, and two concurrent runs
are how the DRBG hands two rows the same counter — same ephemeral key, same nonce,
keystream reuse.

Every run logs `v<PIPELINE_VERSION> | N thread(s) | q=…`. **That log line is the only
reliable answer to "which code is live"** — see [Deployment](#deployment-is-hand-paste).

### 2. Per message, in order

Each step below can *stop* the message. The stopping behaviour matters as much as the
happy path, because most of these failures are silent by nature.

| # | Step | On failure |
|---|---|---|
| 1 | **Route** — `resolveMailbox()` → `member_id` | Held `ROUTING_GRACE_DAYS = 14` (onboarding may be mid-flight), then `parse_failures` + label `txn/parse-failed` |
| 2 | **Idempotency** — `isAlreadyStaged(gmail_message_id)` | A throw is **deliberately not caught**: if Supabase is unreachable, concluding "not staged" inserts a second copy |
| 3 | **Classify** — `sender_fingerprints` cache, else Gemini | Non-transaction → cache the verdict, relabel, done |
| 4 | **Extract** — stored template, else the LLM on the raw mail | `parse_failures` |
| 5 | **Sender auth** — DKIM + forwarder match | Advisory unless `SENDER_AUTH_ENFORCE` |
| 6 | **Dedup** — `findDuplicate()` | Sets `duplicate_of_id`, never blocks |
| 7 | **Fingerprint** — `dedupFingerprint()` | Key self-mints if absent |
| 8 | **Seal** — `trySealRow()` | Returns null = **HOLD**. No relabel, retry next run. There is no plaintext fallback. |
| 9 | **Insert** — `insertEmailTransaction()` | `parse_failures` + `txn/parse-failed` |
| 10 | **Notify** — `queueReviewNotice()` | Counted only *after* the insert is confirmed |
| 11 | **Relabel** — `txn/processed` | — |

**Routing runs first, before extraction**, so unroutable mail never costs a Gemini
call.

**Step 10's ordering is a scar.** Counting inside `insertEmailTransaction` promised a
banner even when the write failed, because `supabasePost` returns PostgREST's error
**object** on failure — which is truthy. `SEALED-STAGING-DESIGN.md` §8 warns about
exactly this shape.

### 3. Classification and the cache

`sender_fingerprints` is keyed on `(sender_address, subject_template)` — **not sender
alone**. A single sender, especially a human forwarding address, sends both
transaction and non-transaction mail; caching per sender misclassifies whichever
arrived first. `subject_template` is the subject with dates and reference-like
substrings stripped.

Columns: `is_transaction_source` (the cached verdict), `transaction_type`,
`extraction_regex` (the promoted fast path — *technical* confidence, parsing worked),
`human_verified` (*ledger-write* confidence, set only when a person approves a row
using this fingerprint). Since `0027` `human_verified` gates nothing, because nothing
auto-promotes.

Budget: `MAX_NEW_CLASSIFICATIONS_PER_RUN = 10`, `MAX_NEW_CLASSIFICATIONS_PER_DAY = 50`.

### 4. What the model is sent

**The mail goes to the model as written** — real amounts, real names, real account
and reference numbers.

**This reversed a design decision on 2026-08-25.** Until then `maskForSharing()`
replaced every sensitive token with a shape-preserving fake before the call and
`unmaskExtraction()` swapped the real values back locally. It worked and it was
verified against live Gemini on real MB Bank mail. It was removed deliberately, and
**consent replaced it**: the `bank_email` consent sheet now states that a first-time
bank's mail is sent to an AI service to be read, amounts and names included, and
`FH_CONSENT_V` went to 4 so everyone re-affirms against the new text. Anyone who
agreed to v3 agreed to "real values are never sent", which is why a re-consent
rather than a copy edit.

Two things did not move, and they are what the honest version of the claim rests on:

- **Repeat senders never reach a model at all.** A known `(sender, subject_template)`
  with a stored template is parsed locally by `applyExtractionTemplate()`, which is
  most volume, permanently. Before, this was a cost saving on top of a protection;
  now it *is* the protection for everything after the first mail off a template.
- **Sealing is untouched.** The row still lands in the database in a box the pipeline
  cannot open. The model leg and the at-rest leg were always separate problems and
  only the first one changed.

The CSV import redactor (`src/js-ui/43-redact-for-sharing.js`) is a different feature
on a different surface and still masks — see `docs/features/csv-import.md`.

**Memo tidying** runs locally on plaintext already in hand, no LLM, no network:
`tidyMemo()` strips bank auto-fill ("NGUYEN THU TRANG chuyen tien") by removing the
account holder's own name and generic banking verbs and seeing whether anything is
left. It adds `memo_display` **alongside** `memo`, never over it, so a misjudged
heuristic stays recoverable.

### 5. Sealing — the writer that cannot read

`trySealRow()` builds a NaCl box addressed to `family_keys.staging_pub`. The
**`family_id` and `gmail_message_id` are bound inside the plaintext** and verified on
open, so a ciphertext moved to another row or another family is rejected rather than
silently misattributed.

What rides inside: `amount`, `currency`, `direction`, `counterparty`,
`reference_number`, `transaction_type`, and the whole `raw_extracted` blob.

**`raw_body` is not encrypted — it is discarded.** ~20KB of ciphertext per row that
nothing ever reads back, when the original email stays in Gmail for the retention
window. A deliberate deviation from the §3 payload list, recorded in `AGENT_SYNC`.

**Seal-or-hold is absolute.** Missing library, no family, no `staging_pub`, pin
mismatch, any throw — all return null, which means leave the message queued and try
again. There is no code path from "could not seal" to a plaintext insert.

`sealedStagingEnabled()` reads Script Property `SEALED_STAGING_ENABLED`. A manual
`preflight()` answers the four questions that decide whether flipping it is safe;
it is read-only and mints nothing.

### 6. Dedup — the most-revised part of this pipeline

**The problem it solves:** one purchase can generate two emails — the bank says
"debit 200.000đ", the merchant's processor says "receipt 200.000đ". Both would become
ledger rows and double the spending.

**Why it is hard:** the two emails share *no identifier*. Different reference numbers,
different timestamps, different descriptions. Only an amount. **Dedup is a guess, not
a lookup**, and every bug below is a wrong guess rather than a broken query.

**The rule today:**

```
same member  ∧  same amount+direction+currency  ∧  within ±3 days
             ∧  different canonical provider    ∧  not both banks
```

Each clause was added because its absence caused a real failure:

| Clause | Added | Because |
|---|---|---|
| canonical provider | `45774f8` | `MB Bank` / `MBBank` / `MB` compared as strings, so two genuine MB transfers looked cross-source and one was deleted |
| `dedup_fp` instead of `amount` | `0068` | Sealing makes `amount` NULL, so `amount=eq.X` matches nothing — forever, silently |
| **same member** | `-d`, 2026-08-23 | The query runs on the **service-role key**, which bypasses RLS, and carried no member filter — every row was compared against every member of every *family* |
| **not both banks** | `3abc2b8` | Two banks each see only their own account. An MB debit and a VCB debit are two pieces of money, however equal |
| currency | `b26d442` | The client-side port compared the bare number; 200 USD read as 200 VND |

**`dedup_fp` is a keyed fingerprint**, `base64(HMAC-SHA256(DEDUP_FP_KEY,
'v1|amount|direction|currency'))`. An *unkeyed* hash was unshippable: VND amounts are
low-entropy enough to enumerate, so anyone with the database could read every amount
back. The key lives in Apps Script Properties. What it still leaks, on record: rows
with equal fingerprints share an amount — **equality classes, never values**.

**Provider is deliberately excluded from the fingerprint.** A hash matches only
exactly, and bank names need fuzzy matching. Hashing the provider would fragment on
spelling and rebuild the same-bank bug one layer deeper, where nothing could see it.
For the same reason `source_provider` and `occurred_at` stay clear columns.

**`duplicate_of_id` is a suspicion, not a delete order.** It used to be filtered out
of the client fetch, so a guess made unattended at 03:00 could hide a real
transaction *and* cancel its notification, with no screen showing it and no way back.
A genuine 2.000đ transfer went that way. Since `15fe226` flagged rows reach the review
screen's "Có thể trùng" bucket and the reviewer resolves them.

**The screen also runs the rule itself** (`csvStagedCrossSourceDup`), with strictly
more evidence: the decrypted amount, the unsealed provider, `transaction_type`, and
the real ledger to compare against. The pipeline cannot read `transaction_type` on the
rows it compares — they are sealed — so bank-vs-bank is a rule only the client can
apply. Where the screen can prove a pipeline flag wrong, it drops it rather than
passing the tap to a person.

**Not caught by anything today: internal transfers.** Moving money between your own
accounts produces two emails with **opposite** directions. Every dedup mechanism here
matches on *sameness*; a transfer pair is defined by *oppositeness*, so the two legs
never meet in any check. See [Open questions](#open-questions).

### 7. Notification

Counted per run and sent once at the end — a forwarding burst of five emails is one
notification, not five. **Only the owning member** is told; staged rows are scoped to
their member by `0058`, and telling the family that someone has a transaction waiting
would leak the fact of it.

The payload carries **no amount and no merchant** — `review-notify.test.js` asserts
that no copy variant can carry money.

Excluded from the count: rows with no `member_id` (nobody can see them, so there is
no audience). Rows with `duplicate_of_id` used to be excluded too; since `-c` they
are not, because they now really do appear in the queue and a row that arrives
silently is the same bug in a milder costume.

Path: `queueReviewNotice()` → `supabase/functions/push-send` (kind `txn_review`,
service-role entrance) → `push_subscriptions` (`0036`) → `src/js-data/55-push.js`
routes the tap back into the review screen.

### 8. Retention

The intermediate mailbox is a corridor, not an archive. A sweep trashes
`txn/processed` threads older than `RETENTION_DAYS = 7`, capped at
`RETENTION_MAX_THREADS_PER_SWEEP = 50`, per-thread try/catch so one stuck thread
cannot strand the batch forever. The query bounds both ends (`older_than` **and**
`-newer_than`) so a live thread with one ancient message survives.

`INBOX_RETENTION_DAYS` overrides the default via Script Properties.

### 9. The client half

| Step | What | Where |
|---|---|---|
| Fetch | `fhFetchStagedTxns()` — pending, own member, newest first, `TXN_REVIEW_PAGE = 200` | `src/js-data/72-txn-review.js` |
| Open | unwrap `staging_priv` with the DEK, open each box locally | same |
| Bucket | ready / needs-category / possible-duplicate / deferred | `src/js-ui/57-csv-import-review.js` |
| Render | cards, copy, arm-then-confirm removal | `src/js-ui/56-csv-import-ui.js` |
| Promote | `fhPromoteStaged()` → `csvPromote()` → `submitBulk()` → `addExpense()` | `src/js-ui/50-sheets-expense-capture.js` |
| Retire | `resolve_email_transactions(uuid[])` — **DELETE** | migration `0060` |

**The review screen is the CSV import screen.** `csvBuildReview` is fed a synthetic
"source" built from staged rows (`fhStagedAsCsvSource`), with `window.csvStagedMode`
switching off file-only chrome. Every improvement to that screen applies here for
free — the category cascade, learned merchants, the duplicate buckets.

**A row that cannot be opened is never silently skipped.** A locked device, a stale
shell or real tampering all surface as a counted, explained state; a key-mismatch
latches an alarm that freezes approval family-wide until a verify passes again.

**Retirement is deletion, not a status flag** (`0060`). The row holds the whole
email, which has no reason to outlive review; `gmail_message_id` uniqueness is not
what prevents re-ingestion (the Gmail label is); and a lingering "done" row is one
every future query has to remember to exclude. Rejecting deletes too.

`fhStagedIdsForResolved()` computes what may be retired by **exclusion** — everything
readable minus everything still parked in a bucket. Retiring more than was promoted
is silent data loss, which is the one failure this screen exists to prevent.

#### Coupling worth knowing about

`submitBulk()` writes each row into the shared `#ex-*` modal fields and calls
`addExpense()`. Since 2026-08-24 the expense modal defaults its scope chip to
**personal**, and `submitExpense()` reads that chip live from the DOM to route a save
into the personal ledger.

**Our path is safe because it calls `addExpense()` directly and never
`submitExpense()`.** That is one function call of separation. Routing the staged path
through `submitExpense()` — the natural-looking "save an expense" entry point — would
silently start filing bank transactions into the personal ledger.

---

## Schema

Six additive tables from `0025`; no existing table was altered.

### `email_transactions` — 21 columns

**Stays clear under sealing** (8 + `id`/`created_at`):

| Column | Why it cannot be sealed |
|---|---|
| `gmail_message_id` NOT NULL UNIQUE | the idempotency key, queried before anything is decrypted |
| `member_id` | ownership; RLS keys on it |
| `source_provider` | dedup compares bank names **fuzzily**; a hash matches only exactly |
| `occurred_at` | dedup queries a date **range** |
| `dedup_fp` | the equality token that replaces the sealed amount |
| `duplicate_of_id` | workflow state, not content |
| `review_status` | workflow state |

**Sealed** (NULL in the row, inside the box): `amount`, `currency`, `direction`,
`counterparty`, `reference_number`, `transaction_type`, `raw_extracted`.
**Envelope:** `sealed`, `eph_pub`, `nonce`, `enc_v`.

**`raw_body`** — never stored under sealing.
**`promoted_transaction_id`** — dead column, never written; `0060` replaced
mark-as-promoted with deletion.
**`review_status`** — only ever written as `'pending'` and only ever read as
`= 'pending'`; `'approved'`/`'rejected'` in the CHECK constraint are unreachable.

The `email_transactions_sealed_or_plain` CHECK (rewritten by `0068`) makes the
half-sealed state unwritable: either all four envelope columns are NULL, or all four
are set **and** every sensitive column is NULL. `0065`'s version forgot
`raw_extracted` and `transaction_type` — the two most content-bearing fields after
the amount — so a bug writing ciphertext *and* plaintext would have passed the very
check whose job was to prevent it.

### Other tables

- **`parse_failures`** — triage. Since `0068` the pipeline **stops writing
  `raw_body`** here: every failure row storing a full plaintext email was a side door
  around whatever the sealed table protects.
- **`sender_fingerprints`** — the classification cache described above.
- **`mailbox_connections`** — `forwarding_alias` (unique), `personal_email`,
  `member_id`, `verified`.
- **`known_provider_domains`** — seed for a bank-picker UI. Still unmerged.
- **`category_rules`** — keyword → category, editable without code.
- **`mailbox_beta_access`** (`0067`) — the allowlist.

### Access control

```sql
create policy email_transactions_own_select on public.email_transactions
  for select to authenticated
  using (member_id is not null
         and member_id in (select m.id from public.members m where m.user_id = auth.uid()));
```

**User-based, not `auth_family_id()`-based.** That matters more than it looks: the
personal-ledger work found that every *family*-scoped policy silently denied reads
for a non-active container. This policy is immune, and it is also what protected the
family from the unscoped dedup query — the pipeline compared across members for
months, but no client could ever see the result.

**Rows with `member_id IS NULL` are visible to nobody, on purpose.**
`email_transactions` has no `family_id` column, so an unrouted row has no safe
audience at all.

Writes are deny-all. Promotion goes through `addExpense()` (the encryption-correct
path) and retirement through `resolve_email_transactions()`, a `SECURITY DEFINER`
function that re-checks ownership itself: passing another member's id **deletes
nothing rather than erroring**, so it cannot be used to probe which ids exist.

---

## Deployment is hand-paste

`pipeline/bank-email-pipeline.gs` is copied into the Apps Script editor by a human.
There is no deploy step, no CI, and no review gate between an edit and what runs
against the live inbox.

- **`PIPELINE_VERSION` is logged every run and is the only proof your paste took.**
  Bump it on every change; read the log before debugging anything else. Twice, a
  "bug" was simply old code still running.
- **Paste only from `origin/main`.** A version on an unmerged branch is a draft. On
  2026-08-23 two sessions held `2026-08-17-c` (main) and `2026-08-23-a` (a branch) —
  siblings of one parent where neither contained the other, and the branch's later
  *date* made it read as the successor. A linear version string cannot express a
  fork; constraining pastes to one branch is what keeps it honest.
- **Caches in Script Properties outlive code changes.** Version the cache key
  (`ALIAS_QUERY_CACHE_V2`) or a fix will appear not to have been applied.
- Wiring `clasp` would delete this whole class of problem. Not done.

### Script Properties

| Key | Effect |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | REST access, **bypasses RLS** |
| `SEALED_STAGING_ENABLED` | `'true'` → seal or hold; anything else → plaintext era |
| `DEDUP_FP_KEY` | the dedup HMAC key; self-mints on first use |
| `SENDER_AUTH_ENFORCE` | `'true'` → reject failing mail into `parse_failures` |
| `INBOX_RETENTION_DAYS` | overrides `RETENTION_DAYS = 7` |
| `GEMINI_API_KEY` | classification/extraction |

Losing `DEDUP_FP_KEY` costs only dedup continuity — old fingerprints stop matching
new ones. Nothing becomes readable.

---

## Failure modes

Nearly every failure in this pipeline is **silent by construction**, which is the
single most useful thing to know when something "isn't working".

| Symptom | Likely cause | Where to look |
|---|---|---|
| No rows appear at all | Message held: no `staging_pub`, no family, or sealing library missing | Executions log — `holding <id>` |
| No rows, no held messages | Routing failed; alias not matched | `parse_failures`, `unroutable_after_grace` |
| Rows in the DB, none in the app | `member_id` null, or (historically) `duplicate_of_id` set | `select … where member_id is null` |
| Queue reads as locked | Sealed to a different family than the active one | staging alarm; `18-staging-keys.js` |
| Nothing since a "fix" | The paste did not save | Executions log version string |
| Notifications stop | `push-send` not redeployed, or no subscription | Edge function logs |

**RLS denials return empty, not an error.** So do most of the guards above. When you
add a gate here, make it log.

---

## Testing

`node tools/run-tests.js` discovers every `pipeline/*.test.js` and `tools/*.test.js`
and **exits 1 on empty discovery** — a green tick over zero tests once hid the loss of
four suites, including the guard for the feature shipping that day.

Pipeline-side: `dedup-provider` (provider canonicalisation + member scope),
`sealing` (53 assertions), `sealed-box`, `sender-auth`, `retention`, `resilience`,
`memo-tidy`, `extraction-template`, `forwarding-confirm`, `review-notify`,
`client-reference-staging-keys`.

Client-side: `dup-advisory` (the suspicion model, bank-vs-bank, currency),
`review-bucketing`, `staged-retire`, `staged-remove-arm`, `merchant-memory`,
`bulk-promote`, `mailbox-gate`, `autotxn-connect`, `autotxn-return`.

Tests extract real functions from source by name and `eval` them, so a rename breaks
the test loudly rather than leaving it asserting nothing.

---

## Current State

**Live:** beta-gated onboarding, alias issuing, forwarding, the full ingest path,
sealed staging, member-scoped dedup, the review screen, promotion, retirement,
notifications, retention.

**Not live:**

| Thing | Blocked on |
|---|---|
| Consent screen + `disconnect_my_mailbox()` | On `bank-email-sealing` as `0071_user_consents_disconnect.sql`. **`0071` was taken and applied by the personal-ledger work** — needs renumbering to the next free number, and the branch is 11 commits behind main. |
| Sender-auth enforcement | Backfill aliases with no `personal_email` first; they fail closed now (`-b`). |
| Parse-failed retention (90d) | Same branch; wants to ship *with* the consent sheet that states the number. |
| `known_provider_domains` seed | Unmerged, renumbered twice already. |
| OAuth direct mailbox read | Handed to a backend dev; would remove hand-set forwarding entirely. |

---

## Open questions

**Internal transfers double-count.** Two emails, opposite directions, one movement of
money. Designed but unbuilt: stage both legs, pair them (same amount / opposite
direction / both my accounts / near in time), emit one `kind='transfer'` with
`transfer_id`.

Blocking detail: **nothing records which bank accounts are yours.**
`mailbox_connections` holds an alias and an email address, not accounts. The masked
account number lives in `raw_extracted`, which is sealed — readable on the client,
never by the pipeline. So this work is **client-side by necessity**, same as
bank-vs-bank. `transactions.kind` defaults to `'expense'`, so today's promote path is
correct by doing nothing.

**Should `dedup_fp` retire?** The client now runs the same rule with strictly more
evidence, and the pipeline cannot see `transaction_type` or reach outside one member.
Against retiring: it is a second independent implementation, and disagreement between
two implementations is a free correctness signal — it is how the currency bug was
found. Not a decision to take in the same change that built its replacement.

**Currency / FX at promotion.** `email_transactions.currency` is per-row (there is a
real USD sample) but `transactions` has no currency column — the app's currency is
family-level. ~~Where conversion happens is undecided.~~ **Decided & shipped
2026-09-03:** extraction reads the real currency and the review client converts to
VND (bank's own converted figure when the email prints it, else an estimate from the
`fx_rates` table + issuer fee), pre-filled and tap-to-import; the foreign original is
kept as a note tag and sealed `fx_amount`/`fx_currency`. See
`docs/specs/foreign-currency-emails-spec.md`.

**Category resolution.** `resolveCategoryId()` is a stub returning null; a person
picks on every row. Nothing auto-promotes, so this costs nothing today.

---

## Related

- `pipeline/README.md` — operator guide, Gmail behaviour, deploy notes.
- `pipeline/SEALED-STAGING-DESIGN.md` — the sealed-box design and its recorded consequences.
- `pipeline/FORWARDING-HANDOFF.md` — landmines, each one paid for.
- `docs/features/encryption.md` — the DEK/card machinery sealing reuses.
- `docs/features/csv-import.md` — the sibling staging path; still redacts before sharing.
- `docs/features/web-push.md` — the notification transport.
- `docs/features/personal-ledger.md` — `families.type` and the transfer substrate.
- `AGENT_SYNC.md` — cross-session ground rules and live claims.
