# Foreign-Currency Bank Emails — the USD-as-VND defect & design options

A bank email announcing a **111 USD** card charge (a Claude Max subscription)
arrives in the review queue as **111 ₫**. The amount survives; the currency is
lost at extraction, ignored at display, and dropped at promotion — so if the
row is imported, the ledger records roughly one-thousandth of the real cost of
the purchase, in the wrong currency, with no trace that anything was foreign.
This document is the defect analysis and the design options for fixing it.

> **Status, 2026-09-03 (evening).** Approaches **1+2 BUILT and shipped**, then
> revised the same evening to **Approach 3 (auto-convert)** after a product
> call: the manual-VND-entry gate broke the app's zero-typing promise. The
> live behaviour is now **fully zero-typing** — a foreign row is auto-converted
> to an estimated VND (bank-fee-adjusted), pre-filled, and imported with a tap;
> typing is only ever needed for a currency with no rate on file. See §10 for
> exactly what landed and §11 for the fee model. **Decision #4 is confirmed** —
> first-class multi-currency is the approved direction, formally reversing
> locked decision T10 (`full-ledger-spec.md`) — but it is a separate epic;
> until it lands the ledger stays VND-only and the shipped fix preserves
> machine-readable FX provenance so the migration can recover every original.

> **Follow-up fix, 2026-09-04 (sw v466).** The foreign check compared
> `r.currency` to the home currency by exact string, so a genuinely-VND row whose
> currency arrived as **"đ" / "VNĐ" / "đồng" / "₫"** was misread as *foreign*,
> found no rate to estimate, and rendered a nonsensical "1.000.000 đ → đ?" in the
> review card that also **gated import**. Fixed with `fhCurNorm`
> (`src/js-data/72-txn-review.js`), which folds every home-currency synonym to the
> canonical code before any compare — used in `fhStagedFx` and the amount-cell
> estimate. Only a genuinely different currency is treated as foreign now.

> **How this relates to its siblings.**
> `effortless-transaction-logging-spec.md` is how a bank email becomes a staged
> row — the defect's first two failure points live inside its extraction tiers.
> `transaction-review-spec.md` is the human gate where the mislabeled row is
> displayed and promoted — the third failure point. `email-extraction-reference.md`
> catalogues the per-bank formats the extractor understands; every entry in it
> today is a VND-domestic format. `full-ledger-spec.md` locked VND-only (T10),
> which is why the ledger has no currency column and why promotion has nowhere
> to put a currency even when staging captured one.

---

## 1. The defect, observed

- Email: an outflow notice whose transaction amount is denominated in USD
  ("111 USD" / "$111.00"). Vietnamese banks send these for international card
  charges — foreign subscriptions being the common case.
- Review queue: the card renders **111 ₫**.
- If imported: the ledger stores `111 / 1000 = 0.111` base units — the app
  stores VND in base units of 1.000đ — which redisplays everywhere as 111 ₫.
  The real charge was ~2.9 million đồng. Nothing flags the row; the corruption
  is silent.

The failure is identical on both transports (forwarding via Apps Script and
direct Gmail read via the Edge worker) because they share the same extraction
code and the same `sender_fingerprints` template cache.

## 2. Root cause — a chain of three failures

Currency is not lost in one place. It is lost at extraction, then *ignored* at
two later points that could each have caught it.

### 2.1 Extraction sets `VND` no matter what the email says

The extractor is a three-tier cascade — stored template → label-table reader →
LLM (`extract.mjs:105-329`). Only the most expensive tier can ever report a
non-VND currency, and it is exactly the tier the cascade exists to avoid:

- **Label-table reader** — `parseAmountCell` strips only `VND|đ|dong` before
  grabbing the digits (`labeltable.mjs:225-226`), so a `USD` token is silently
  discarded and `"111 USD"` parses to `111`. The reader's return then
  **hardcodes** `currency: 'VND'` (`labeltable.mjs:424`). There is no code path
  in this tier that can emit any other currency.
- **Stored template** — currency is frozen as a *static* of the
  `(sender, subject_template)` shape at derivation time (`templates.mjs:273`),
  and statics are copied verbatim onto every later mail
  (`templates.mjs:389-390`). A template learned from a VND email of the same
  bank therefore stamps `VND` onto every subsequent USD email that matches the
  same subject shape — the amount is re-read per mail; the currency never is.
  The Apps Script twin behaves identically (`bank-email-pipeline.gs`, the
  `deriveExtractionTemplate` copy around line 1033).
- **LLM tier** — the schema requires `currency` (`llm.mjs:101,147`) and the
  model would correctly return `USD`. But a VIB-style two-column card notice
  satisfies the label-table confidence gate (amount + timestamp + merchant,
  `labeltable.mjs:398`), so the LLM never sees it.

Downstream, three layers default `currency || 'VND'` (`stage.mjs:129`,
`worker.mjs:727`, `ingest.mjs:108`). None of them is the bug — by then the
extractor has already asserted VND — but they mean an extractor that returns
*no* currency is also read as VND.

### 2.2 The review card never consults the row's currency

Currency actually survives into staging. It rides inside the sealed box and
inside `raw_extracted` (`stage.mjs:139-192`), the client reads it back after
decryption (`72-txn-review.js:245`), and the dedup fingerprint hashes it —
the "200 USD equals 200 VND" collision was found and fixed
(`72-txn-review.js:426-430`, `dedup.mjs:91`). But the card renderer formats
every amount with the *family* currency: `csvFmt(c.amount)` → `fmt()` on the
module-global `CUR` (`56-csv-import-ui.js:861,1044` →
`10-nav-model.js:115-118`). Even a correctly-tagged USD row would render with
a đồng symbol today. Currency is consulted for fingerprints, never for pixels.

### 2.3 Promotion drops currency and scales as VND

On Import, the amount goes through the ÷1000 base-unit conversion with no
currency awareness — `csvBaseAmt(c.amount)` for personal rows
(`72-txn-review.js:894`), `parseAmtBase` inside the family writers
(`56-csv-import-ui.js:2719`). The ledger has no per-row currency column to
receive one anyway: `transactions` (`0001_schema.sql:129-144`) and
`personal_transactions` are amount-only by design. The original pipeline
migration left this as an explicit open question — "FX/conversion happens at
promotion time" (`0025_bank_email_pipeline.sql:45-47,71`) — which was never
resolved; `full-ledger-spec.md` later locked VND-only (T10) without answering
it.

## 3. Constraints that bound any fix

- **Sealed rows cannot be re-parsed server-side.** The worker holds only the
  public staging key; `amount`, `currency`, `direction`, `raw_extracted` are
  NULL in the row and live inside the box (`stage.mjs:264-267`, migrations
  `0065`/`0068`). A currency correction must happen either at extraction time
  (pre-seal) or client-side at review. The DB is opaque; there is no
  "re-extract the backlog" job possible.
- **Nothing a machine guessed writes to the ledger.** Every row passes the
  human gate; duplicate flags are advice, not actions
  (`effortless-transaction-logging-spec.md` §9). A currency fix that silently
  rewrites amounts would violate the screen's founding posture.
- **VND-only is a locked product decision** (T10). The ledger's lack of a
  currency column is intentional, not an omission. Reversing it is a product
  call with wide blast radius, not a bug fix.
- **Two transports, one shape.** `templates.mjs` is a verbatim copy of a slice
  of `bank-email-pipeline.gs`, and both share the `sender_fingerprints` cache.
  Any extraction change must land in both copies in lockstep, and existing
  cached templates with `static.currency = 'VND'` frozen in must be
  invalidated or re-derived.
- **Number notation differs by currency.** The per-template amount parse mode
  is derived from whichever printed form matched — a template built on VN
  notation bakes in "dot = thousands" (`email-extraction-reference.md` §4,
  effortless §16.2). US-notation USD amounts (`1,234.56`) read under VN mode
  parse wrong even when the digits are captured. Currency detection and parse
  mode selection are the same problem.
- **The ÷1000 scaling has two call sites** — family writers convert internally
  (`parseAmtBase`), personal writers expect base units at the call site
  (`csvBaseAmt`) — already flagged as a standing hazard (effortless §19.5).
  Any amount-path change touches both.

## 4. Common foundation — make the extractor honest first

Every approach below presupposes the same extraction fix. Without it, nothing
downstream has a truthful currency to act on.

1. `parseAmountCell` detects and returns a currency token (USD, `$`, EUR, …)
   instead of ignoring it; `readLabelTable` propagates the detected currency
   instead of hardcoding `'VND'` (`labeltable.mjs:225,424`).
2. Templates stop freezing currency blind: either currency becomes a per-mail
   read (re-detected from the body on every apply), or an apply whose body
   contains a foreign-currency marker that contradicts the frozen static
   degrades the mail to the model tier — following the existing rule that "a
   template can degrade a mail to the expensive path, never to a wrong answer"
   (effortless §16.2). Mirror the change in `bank-email-pipeline.gs`.
3. Detected currency selects the number-parse mode (US notation for USD
   amounts) rather than inheriting the template's VN mode.
4. Invalidate or re-derive `sender_fingerprints` entries whose shapes can
   carry foreign amounts.
5. Add USD fixtures to `pipeline/label-table.test.js` and
   `extraction-template.test.js` — today no test asserts currency detection at
   all, which is how a hardcoded `'VND'` survived.

## 5. The four approaches

### Approach 1 — Honest USD display + manual VND entry at review (the guardrail)

Foundation fix, plus: the review card renders the row's own currency (a
`$111` / `111 USD` badge instead of the family symbol). Foreign-currency rows
are excluded from select-all bulk import, and their Import button is gated
until the person edits the amount — typing the VND value themselves in the
existing amount editor. The original `111 USD` is auto-appended to the note so
the ledger row keeps its provenance.

| Pros | Cons |
|---|---|
| Fully aligned with the human-gate posture: no machine guess reaches the ledger | The person does the FX math by hand for every foreign transaction |
| No FX-rate dependency, no network calls, works offline, no E2EE implications | USD rows can pile up unprocessed if deferred |
| Ledger stays VND-only — zero schema or migration work | The original amount survives only as note text |
| Smallest change: render + gate in `56-csv-import-ui.js`, guard in `fhPromoteStaged` | Dedup asymmetry: a USD-tagged email row never fingerprint-matches the VND settled row a later bank CSV import brings in — the same purchase can appear twice |

### Approach 2 — Extract the bank's own converted VND amount from the email

Vietnamese bank foreign-currency notices frequently carry **both** numbers —
the transaction amount ("Số tiền giao dịch: 111 USD") and the converted /
debited amount ("Số tiền quy đổi / ghi nợ: 2.923.000 VND"). Teach the
extractor a second field: when a converted-VND line exists, stage the **VND
amount as the transaction amount** and carry `111 USD` into the memo and
`raw_extracted`. When the email shows only USD (auth-time notices), fall back
to Approach 1's behaviour.

| Pros | Cons |
|---|---|
| Uses the bank's **actual settled rate** — the ledger matches the money that really left the account; no drift against the statement | Only covers emails that carry the converted amount; USD-only auth notices still need Approach 1's manual path |
| Zero user friction for covered cases — the card simply shows the right VND number | A new extraction field across the label map, templates, and the `.gs` twin; needs real per-bank samples to build the label list (`số tiền quy đổi`, `số tiền ghi nợ`, …) |
| No FX-rate source, no schema change, VND-only stands | Two amounts in one email is exactly the class the pipeline has been burned by before (the cashback line once hijacked the amount — reference §5); field precedence needs care and tests |
| Dedup improves: the staged VND amount matches the bank CSV's settled VND row | Auth-time vs settlement amounts can differ slightly as the rate moves — minor mismatch risk |

### Approach 3 — Auto FX conversion at review time (client-side rate) — **SHIPPED**

> **Decision, 2026-09-03: this is the live behaviour.** Chosen over the manual
> gate because that gate broke zero-typing. Rate + fee live in a shared DB
> table (`fx_rates`, migration 0112), refreshed daily and hydrated to the
> client so the estimate works offline; the card **pre-fills** the estimated
> VND ("≈ $111 · ước tính"), the person taps import, editing is optional. See
> §10–§11.

Foundation fix, plus: the review client converts. A USD→VND reference rate is
fetched from a public source (cached) or kept as a user-editable setting; the
card **prefills** the converted VND amount, visibly marked as a conversion
("≈ quy đổi từ $111 @ 26.350"), and the person confirms or overwrites before
Import. The original rides in the note.

| Pros | Cons |
|---|---|
| Low friction, and works even when the email carries no converted amount | A reference rate is not the bank's card rate (spread of ~2–3%): logged amounts systematically disagree with the statement, then collide with a later CSV import of the settled amount |
| Prefill-not-autolog keeps the human gate; the person can overwrite | A prefilled machine guess on the *amount* is the thing the specs warn about — a soft violation of "machine guesses surface, not act" |
| No schema change; conversion is purely client-side, composes cleanly with sealing | Adds an external network dependency to an offline-first PWA; rate staleness needs handling |
| | Rate lookups timed per-row would correlate with foreign purchases — a mild metadata leak; would need scheduled fetching, not on-demand |

### Approach 4 — First-class multi-currency (per-transaction currency column)

> **Decision, 2026-09-03: CONFIRMED as the product direction.** T10 is
> reversed. Scheduled as its own epic with its own spec, not as part of this
> bug fix; Approaches 1+2 are the bridge, and their `[111 USD]` note tags plus
> the sealed `fx_amount`/`fx_currency` pair are what the migration will read.

Reverse locked decision T10: add a currency column to both ledgers
(encrypted alongside the amount on the personal side), store `111 USD`
natively, render per-row currency everywhere, and either segregate foreign
rows from VND totals or convert at display time.

| Pros | Cons |
|---|---|
| The only approach that is actually *true* — no lossy conversion; history matches reality forever | Reopens a locked product decision; this is a product call, not a bug fix |
| Future-proof: EUR subscriptions, travel spending, USD income all just work | Touches everything: migrations on both ledgers, the sealed payload shape, `fmt()`/`curMult()`/`parseAmtBase` (the known two-site ÷1000 hazard), budgets, goals, totals, charts, CSV import, mirror pairing |
| Fixes display and dedup permanently and coherently | Totals become ill-defined without an FX layer anyway — "how much did I spend this month" now needs a conversion policy, so Approach 3's rate problem is inherited *on top* |
| | Weeks of work for what is today a handful of USD subscriptions a month |

## 6. Recommendation

> **Superseded by what shipped (see the status note and §10).** The original
> recommendation was 1+2 with a manual-entry fallback; the manual gate was
> then dropped for **Approach 3 (auto-convert)** to keep the app zero-typing.
> The final shape is: **2 first** (use the bank's own converted VND whenever
> the email prints it — most accurate, zero cost), **3 for the rest**
> (estimate USD-only emails with a fee-adjusted rate, pre-filled, tap to
> import), and **1's honest display + edit affordance** retained as the visible
> layer (the foreign original is always shown; the amount is always editable;
> only a no-rate currency ever forces typing). Approach 4 remains a separate
> epic.

The reasoning below is kept for the record; §10 is what to read for current
behaviour.

**Ship 1 + 2 together, in that order.** Approach 1 is the safety fix — the app
is silently corrupting data today, and the guardrail stops that immediately.
Approach 2 then removes the friction for the majority of real emails by
trusting the bank's own converted amount, with Approach 1's honest-USD card as
the fallback where no VND line exists. Defer Approach 3 (rate drift creates
statement mismatches that surface later as phantom discrepancies) and treat
Approach 4 as a separate product decision to revisit only if foreign
transactions stop being a niche.

## 7. Remediation of existing rows

The fix is forward-looking only; two classes of existing damage need a sweep:

- **Already-staged foreign rows** are sealed with `currency: 'VND'` inside the
  box and cannot be repaired server-side. They can only be corrected by the
  owner editing the amount at review — the Approach 1 badge cannot appear for
  them because the sealed currency is wrong. Acceptable: the population is
  small and the amount editor already exists.
- **Already-promoted foreign rows** sit in the ledger at ~1/1000 of their real
  value (0.111 base units for the $111 example). A one-time client-side sweep
  can flag suspiciously tiny amounts on email-sourced rows for hand-fixing;
  with today's volume, hand-fixing the known few is also fine.

## 8. Related parts

| Part | Where | Role |
|---|---|---|
| Label-table reader | `labeltable.mjs:224-236, 424` | Strips the USD token, hardcodes `'VND'` — primary defect |
| Template statics | `templates.mjs:273, 389-390` + `bank-email-pipeline.gs` twin (~1033) | Freeze VND onto later USD mails of a learned shape; both copies change in lockstep |
| LLM tier | `llm.mjs:57, 101, 147` | Already currency-aware — the reference behaviour, but bypassed by the cheap tiers |
| VND defaults | `stage.mjs:129`, `worker.mjs:727`, `ingest.mjs:108` | `\|\| 'VND'` fallbacks — fine once the extractors are honest |
| Template cache | `sender_fingerprints` | Shared by both transports; VND-frozen entries need invalidation/re-derivation |
| Review read + dedup | `72-txn-review.js:245, 343, 426-430` | Currency decrypted from the box, used for fingerprints only |
| Card render | `56-csv-import-ui.js:861, 1044` → `10-nav-model.js:115-118` | Formats with the family `CUR`, never the row's currency |
| Promotion | `72-txn-review.js:849-1000`, `56-csv-import-ui.js:2679-2719` | Drops currency, ÷1000 as VND — where the corruption lands in the ledger |
| Ledger schema | `0001_schema.sql:129-144`, personal `0079`/`0109` | No currency column (locked T10) |
| Sealing constraint | `0065`/`0068`, `stage.mjs:264-267` | Staged rows unreadable server-side → fix pre-seal or client-side only |
| Tests | `pipeline/label-table.test.js`, `extraction-template.test.js` | No USD coverage today — add fixtures with the foundation fix |

## 9. Open questions

- Which banks put the converted VND amount in the *first* (auth-time) email vs
  only in a later settlement notice? The label list for Approach 2 needs real
  samples per bank; the corpus currently holds one confirmed USD sample.
- ~~Should an imported foreign row carry a machine-readable trace?~~
  **Answered by decision #4 (2026-09-03): yes.** The shipped fix appends a
  fixed-format `[<amount> <ISO code>]` tag to the note (e.g. `[111 USD]`) and
  seals the pair as `raw_extracted.fx_amount`/`fx_currency`; the Approach 4
  migration parses the tag / reads the pair to recover originals.
- Does the Approach 2 settled-VND amount dedup cleanly against a later card
  CSV import, or does the auth-vs-settlement drift (§5, Approach 2 cons) need
  a tolerance window in the fingerprint comparison?

## 10. What shipped (2026-09-03)

**Extraction (both transports — Edge worker + Apps Script twin):**

- `parseAmountCell` detects the cell's currency (word codes + `$€£¥` symbols)
  and parses foreign notation with cents kept; `cellCurrency` exported.
- `readLabelTable`: new `converted` field (`số tiền quy đổi / ghi nợ / thanh
  toán`, billed/billing/converted amount) preferred over a foreign transaction
  amount, with the original as `fx_amount`/`fx_currency`; new `currency_row`
  field (`loại tiền (tệ) / đơn vị tiền tệ`); `tỷ giá` added to the charge
  absorber so an FX rate can never be the amount; hardcoded `currency: 'VND'`
  removed.
- Templates: derivation refuses non-VND readings (`foreign_currency` trace),
  so no foreign-static template can exist; apply degrades to the smarter tiers
  when the amount line carries a foreign token or the body has a foreign
  currency row. `EXTRACTION_LOGIC_VERSION` stays 4 — existing cached templates
  remain valid and are now guarded.
- LLM prompt/schema: explicit currency rule (never default VND, prefer the
  converted VND figure, report the original as `fx_amount`/`fx_currency`).
- `fx_amount`/`fx_currency` threaded through `_toReading` (worker),
  `normaliseReading` (ingest) and into the sealed `raw_extracted` (stage).
- Tests: USD fixtures in `label-table.test.js` (USD-only, converted, currency
  row, cent-keeping) and foreign parity blocks in `direct-templates.test.js`.

**Rate + fee store (migration 0112 + `fx-refresh` edge function):**

- Table `public.fx_rates` (`currency` PK, `rate_to_vnd`, `fee_pct` default 3.0,
  `updated_at`, `source`) — global, not family-scoped; RLS allows any signed-in
  user to read, only the service role writes. Seeded with ~15 majors so the
  feature works before the refresh ever runs.
- `fx-refresh` edge function pulls `open.er-api.com` (keyless), computes
  VND-per-unit for each currency, and upserts `rate_to_vnd` only — `fee_pct` is
  a policy value it never touches. Fail-soft: an unreachable feed leaves the
  existing rates in place, never nulls them.
- `_fx_refresh_tick()` + a daily `pg_cron` job (01:00 UTC) wake it, via a vault
  URL + shared secret, exactly like the mailbox-sync tick (0088). No-ops until
  the vault secrets are set; the seed carries the app until then.
- Client loads `fx_rates` on hydrate → `window.FX_RATES`, cached to
  `localStorage` (`fh-fx`) and restored at boot so the estimate works offline.

**Review client (zero-typing auto-convert):**

- `fhFxEstimate(amount, currency)` (72-txn-review.js): `round(amount × rate ×
  (1 + fee/100))` to the nearest 1.000đ from `window.FX_RATES`, or `null` when
  no rate is known. `fhStagedFx(rowIndex)` returns
  `{kind:'foreign', currency, amount, est}` | `{kind:'converted', …}` | `null`.
- `fhStagedAsCsvSource` puts the **estimated VND** into the candidate's amount
  cell, so totals, the write, and `csvBaseAmt` all work in VND and never see
  "$111" as a number. The foreign original stays visible via `fhStagedFx`.
- Cards render the VND (estimate or bank-converted) with **"≈ $111 · ước tính"**
  beside it (the "· ước tính / est." marker only when it's the app's estimate);
  the amount editor **pre-fills the estimate**, editable — an untouched editor
  keeps the estimate, which is the zero-typing path. Editing sets `_fxVnd`
  (the person's own figure overrides the estimate and drops the marker).
- Estimated rows behave like any VND row: selected by default, counted in the
  spend panel, importable with a tap.
- The **only** row that still requires typing is a foreign currency with **no
  rate on file** (`csvFxUnresolved`): shown as "$111 → ₫?", deselected, and
  held staged at import until a ₫ figure is entered. With the majors seeded
  this is the rare exotic-currency case.
- `fhPromoteStaged` appends provenance to the note before the write:
  `[111 USD]` for a bank-converted or person-typed amount, `[111 USD @26,350
  +3% est.]` when the app estimated it — so an estimate is never later mistaken
  for an exact figure, and the Approach 4 migration can recover the original
  plus the rate/fee it was estimated at.

**Not shipped here:** the Approach 4 epic (ledger schema, totals policy,
native display) and any remediation sweep for rows corrupted before the fix
(§7 still applies — hand-fix the known few).

**Deploy surfaces:** `mailbox-sync` edge function (shared `_shared/mailbox`
code), **migration 0112** + the **`fx-refresh` edge function** + its two vault
secrets (`fx_refresh_url`, `fx_refresh_secret`) and the `FX_REFRESH_SECRET`
function env, the client bundle (build + service-worker bump), and a **manual
re-paste of `bank-email-pipeline.gs`** into the Apps Script editor — the
forwarding transport does not deploy from this repo.

## 11. The fee model

A foreign card charge does not hit the account at the mid-market rate. The
issuer bills `foreign × its own rate`, where that rate carries a spread over
mid-market, and Vietnamese issuers frequently add an explicit foreign-
transaction fee on top — together commonly ~2–4%. Estimating with a bare
mid-market rate therefore lands systematically **low**, and a spend tracker
that always under-reads foreign spend is quietly wrong in one direction.

So the estimate is `round(amount × rate_to_vnd × (1 + fee_pct/100))`:

- `rate_to_vnd` is a reference/mid rate, refreshed daily.
- `fee_pct` is the issuer's markup+fee as a percent — a **policy value**,
  defaulting to 3.0, stored per currency and editable in the DB, never
  overwritten by the rate refresh.

It is an estimate and is labelled as one ("· ước tính"); the person can edit it
to the exact debit when the statement lands. When the bank email itself prints
the converted VND (Approach 2), that real number is used and no fee is applied —
the bank already baked its fee into the figure it billed.

Two refinements deliberately left for later, both recorded so they are not
rediscovered as bugs: (a) a per-**family** or per-**card** fee override, since
issuers differ; (b) back-solving the effective rate from Approach-2 emails
(where both the foreign and the billed VND are printed) to self-tune `fee_pct`
per issuer over time. Neither is needed for a correct-enough estimate today.
