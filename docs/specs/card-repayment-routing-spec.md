# Credit-Card Repayment Routing — naming the card a payment pays off

When a bank-email row is a **credit-card repayment** ("Trả nợ thẻ"), the review
screen must pre-select *which* card is being paid down, so the payment draws the
right card's outstanding balance instead of landing as "Chưa rõ". The card the
mail names is captured at extraction, carried in the sealed box, and matched to
the user's own card at review — end to end.

> **Status, 2026-09-07.** Design + build. Reconstructed from the live pipeline
> and review code; this spec is the record of the gap and the fix. Layer 1
> (client resolution) needs no pipeline deploy; Layer 2 (extraction of the
> repaid card) touches the Edge worker and the template learner.

> **Audience & layering.** Part 1 (Behaviour) is for everyone. Part 2
> (Technical Appendix) is for engineers. This is a vertical slice of the
> [effortless transaction logging](effortless-transaction-logging-spec.md)
> pipeline; it does not repeat the transports, sealing, or dedup — see that
> document and [borrowing-lending-spec.md](borrowing-lending-spec.md) §8 for the
> instrument classifier this builds on.

---

# Part 1 — Behaviour

## 1. Summary

- You pay for things on several credit cards, then repay each card from a bank
  debit account. The direct-mailbox pipeline already recognises the repayment
  as a **card payment** (a transfer, held out of spending totals). What it did
  **not** do is say *which* card — the "Trả cho thẻ" row read "Chưa rõ" even
  though the bank's email names the card and the card is registered in the app.
- The fix names the card at every hop: **extraction** captures the repaid
  card's number (a new `card_masked` field), the **sealed box** carries it, and
  **review** matches it to the owned card and pre-selects it — so "Trả cho thẻ"
  shows the real card, tappable to change.
- Different banks format the mail differently — some send the alert from the
  card's side, some from the paying account's side — so the match is layered and
  fail-safe: a card it cannot confidently name stays "Chưa rõ" (editable),
  never a wrong card.

## 2. Why this exists — the gap, concretely

A repayment email involves **two instruments**: the debit account the money
leaves, and the credit card it pays off. The pipeline only ever captured **one**
account number per row (`account_masked`), and which of the two it captured
depends on the bank's template:

| Mail shape | `account_masked` holds | The repaid card is |
|---|---|---|
| **Card-side alert** (VIB "TÍN DỤNG ··5140", money *into* the card) | the card, 5140 | = `account_masked` |
| **Account-side alert** (VIB "Thanh toán thẻ tín dụng thành công") | the *sending deposit* | printed elsewhere in the mail — captured **nowhere** |

The screenshot that opened this work is the first shape: the header correctly
reads "VIB · TÍN DỤNG ··5140", proving the card reached review — yet "Trả cho
thẻ" said "Chưa rõ", because the review screen never used that identity to
pre-select the card. The second shape is worse: the card number was dropped at
extraction, so nothing downstream could ever name it.

## 3. What changes for the user

- On a card-payment row, **"Trả cho thẻ" pre-fills with the matched card**
  ("VIB ··5140") instead of "Chưa rõ", whenever the mail names a card you own.
  One tap still changes it; a genuinely ambiguous row still shows "Chưa rõ".
- The repayment then draws **that card's** outstanding balance down on import,
  so the card's "Nợ & cho vay" balance stays honest without you assigning it by
  hand later from the card's detail screen.
- Nothing else about the row changes: it is still a **transfer**, still held out
  of spending totals, still per-row scoped (personal by default).

## 4. Safety posture (unchanged from the pipeline's)

- **A card is pre-selected only when it can be named with confidence** — an
  owned card whose last-4 (and provider, when known) match. Otherwise the row
  keeps the neutral "Chưa rõ" that already imports fine; the card is assignable
  later. **Wrong card is worse than no card**, because a wrong repayment moves
  the wrong balance.
- **No new plaintext.** `card_masked` is masked to its last four (like
  `account_masked`), rides inside the sealed box, and is NULL in the database
  columns. The database still cannot read it.
- **The match runs on the reviewer's own device**, against their own decrypted
  cards — never server-side.

---

# Part 2 — Technical Appendix

## 5. The chain today, and where each hop breaks

| Hop | File | State before this spec |
|---|---|---|
| Extraction — label table | [`labeltable.mjs`](../../supabase/functions/_shared/mailbox/labeltable.mjs) | matches a `card` label ("số thẻ") but **drops it** — the return object omits `got.card` (extraction-reference §3 marked it "context only") |
| Extraction — model | [`llm.mjs`](../../supabase/functions/_shared/mailbox/llm.mjs) | schema has a single `account_masked`; no field for the repaid card |
| Extraction — template | [`templates.mjs`](../../supabase/functions/_shared/mailbox/templates.mjs) | anchors `account_masked` but no card field; a graduated repayment shape would carry no card |
| Seal | [`stage.mjs`](../../supabase/functions/_shared/mailbox/stage.mjs) | `raw_extracted` carries `account_masked`/`account_kind`, no card field |
| Review — candidate build | [`57-csv-import-review.js`](../../src/js-ui/57-csv-import-review.js) | reads the sealed shape only to set `isTransfer`; **never sets `_payCardId`** |
| Review — display | [`56-csv-import-ui.js`](../../src/js-ui/56-csv-import-ui.js) | `pc = c._payCardId \|\| (cards.length===1 ? cards[0].id : '')` — with many cards and no `_payCardId`, falls to "Chưa rõ" |
| Promote | [`72-txn-review.js`](../../src/js-data/72-txn-review.js) | tries `fhPersonalAccountEnsure(ai)` and mines `c.description` digits, then falls back to "one card only" — fragile, invisible to the user |

The header "VIB · TÍN DỤNG ··5140" is drawn by `csvStagedAcctChip` →
`fhStagedAcct`, which reads `account_masked` + `account_kind`. That the header
is right while "Trả cho thẻ" is "Chưa rõ" is the whole bug: the identity was
present but never routed into the pay-card field.

## 6. The data field — `card_masked`

A new content field, semantically **"a credit-card number the mail names"**,
role-neutral at extraction, masked to last-4. It rides inside `raw_extracted`
(never a new column — `email_transactions`' key set is pinned by the `0068`
sealed-or-plain CHECK, exactly like `account_kind`/`flow`/`fx_amount`). NULL
means the mail named no card.

- On a **card-side** alert it usually equals `account_masked` (both name the
  card) — redundant but harmless.
- On an **account-side** repayment it is the value that was previously lost: the
  card printed in the "Số thẻ / Thẻ tín dụng số" row while `account_masked` is
  the funding deposit.
- On a plain card **purchase** it may equal the spending card; the client only
  consumes it on rows classified as card payments, so this does no harm.

The **role judgment stays on the client** (matching the pipeline's contract:
extraction states facts, the client judges). `card_masked` is a fact the mail
prints; "this is the card being repaid" is a judgment the review screen already
makes when it sets `isTransfer`.

## 7. Extraction changes (Layer 2)

### 7.1 Label-table reader (`labeltable.mjs`)

- **Emit** the already-matched card: add `card_masked: got.card || null` to the
  `readLabelTable` return object (raw as printed; masking happens in `_tidy`).
- **Broaden** the `card` label vocabulary to catch repayment phrasings without
  eating merchant names: keep the existing `'so the'`, `'the card'`, and the
  start-anchored bare `'the'`; add `'so the tin dung'`, `'the tin dung so'`,
  `'the duoc thanh toan'`, `'the thanh toan'`. The absorber/first-hit ordering
  is unchanged — `card` stays last, so a value-bearing row already claimed by
  `account`/`beneficiary`/`amount` is never re-read as a card.
- The confidence gate (amount + instant + counterpart) is untouched; a card row
  neither satisfies nor blocks it.

### 7.2 Model schema + prompt (`llm.mjs`)

- Add an **optional, non-required** property
  `card_masked: { type: ['string', 'null'] }`. (Non-required keeps Gemini's
  pinned schema valid; `additionalProperties` stays absent.)
- Prompt rule: *"card_masked — on a credit-card payment or repayment mail
  (thanh toán / trả nợ thẻ tín dụng), the credit card whose balance is being
  paid down, distinct from the funding account in account_masked. Masked to its
  last digits is fine. Null on every mail that is not a card repayment; never
  guess."* Consent copy is unaffected — no new class of value leaves the
  machine (a masked card tail is less than the amounts already sent, §8 of the
  umbrella spec).

### 7.3 Template learner (`templates.mjs`)

`card_masked` must **graduate** with the shape, or a repayment sender that has
learned a template would silently stop carrying the card once it leaves the
model/label tier.

- Add `'card_masked'` to `strFields` (the per-mail anchored set) and to the
  final-proof `keys` list.
- Make it **degradable like `account_masked`** (not fail-hard): an unanchorable
  card omits the field and stores the rest, rather than blocking the whole
  template. A degraded card costs a "Chưa rõ" that the client can still recover
  from memo/`account_masked`; a blocked template costs a model call per mail
  forever — the same trade `account_masked` already makes.
- It is **optional**: absent from the derivation mail ⇒ not anchored, no
  degradation, no proof entry.
- **Upgrade-on-hit** (2026-09-07, `extract.mjs` stage 1): templates derived
  BEFORE this spec carry no `card_masked` key at all, and a template hit
  returns before the label-table tier — so every pre-existing card-payment
  shape served "Chưa rõ" forever (found live: the VIB "Thanh toán thẻ tín
  dụng… thành công" template of 2026-08-26). On a hit whose stored JSON lacks
  the key and whose applied read has no card, the reader runs the (local,
  free) label table on that same mail; a card read at the **same amount** is
  adopted into the extraction and the template is re-derived and re-saved, so
  the upgrade is one-time per shape. No model call on any path; a failed
  re-derivation just repeats the cheap table walk next mail. Stale templates
  can also simply have `extraction_regex` nulled — the shape re-derives fresh
  on its next mail. (Transport A's .gs has no label-table tier and no gate;
  it benefits through the shared `sender_fingerprints` cache.)

### 7.4 Seal (`stage.mjs`)

Add to the `raw_extracted` payload, beside `account_masked`:

```
card_masked: reading.cardMasked ?? reading.card_masked ?? null,
```

`_tidy` (extract.mjs) applies `maskAccount(out.card_masked)` so every tier's
output is last-4 only, exactly as `account_masked` is handled (`maskAccount(null)`
returns null, so the no-card case is unaffected).

> **The mapping IS the wire (2026-09-07, mailbox-sync v43).** `reading` is not
> the extraction — it is `worker.mjs _toReading`'s remap of it, and the line
> above reads `reading.cardMasked`. The original build added the field to every
> tier EXCEPT that remap, so every sealed row staged card-less while extraction
> and templates worked perfectly. Any future field added to this payload must
> also be added to `_toReading` (worker.mjs) and `normaliseReading`
> (ingest.mjs); the .gs transport is immune (it seals the extraction whole).
> Rows sealed before v43 are card-less forever — boxes are never amended.

### 7.5 Transport C (`/ingest`, pre-live)

Additive to the contract: `normaliseReading` maps an optional `card_masked` (or
`cardMasked`) from the caller into the same payload key. Not blocking — a caller
that omits it produces today's behaviour. Pin alongside the existing
`direct-persist-contract.test.js`.

## 8. Review changes (Layer 1) — the immediate, deploy-free fix

### 8.1 One shared resolver

A single pure function resolves the repaid card from the evidence a staged row
carries, returning an owned-card id or null. It lives in the data layer
([`72-txn-review.js`](../../src/js-data/72-txn-review.js)) so both the candidate
builder and the promote path call **one** implementation:

```
fhResolveRepaidCard(rawExtracted, stagedAcct, description, ownedCards) → id | null
```

Resolution order — most specific first, each matching a `credit_card` account
by last-4 tail (and provider when both sides carry one), mirroring
`fhPersonalAccountEnsure`:

1. **`card_masked` tail** → the card the mail explicitly named (Layer 2). This
   is the account-side-alert answer that was previously impossible.
2. **`account_masked` tail when `account_kind === 'credit_card'`** → the
   card-side-alert answer (the screenshot's ··5140). Matches only against owned
   *cards*, so a deposit number here yields nothing and falls through — safe.
3. **Digits mined from `memo_display`/`memo`/`counterparty`/`reference`/desc**
   → the "…THE MASTER 4751" case the promote path already handled, now shared.
4. **Exactly one owned credit card** → the existing one-card default.
5. **Otherwise null** → genuinely ambiguous; the row keeps "Chưa rõ".

### 8.2 Candidate build (`57-csv-import-review.js`)

When a staged row is classified as a card payment (`isTransfer` set from the
sealed shape), call the resolver and set `c._payCardId` on the returned
candidate. This is the single missing wire: the identity that already drives the
header now also pre-selects the card. No behaviour change for non-transfer rows.

### 8.3 Display (`56-csv-import-ui.js`)

Unchanged in shape — `pc = c._payCardId || …` already renders the pre-selected
card and marks the "Trả cho thẻ" row non-`soft` once a card is chosen. With
`_payCardId` now populated at build, the multi-card user sees the card instead
of "Chưa rõ". The one-card fallback stays as belt-and-braces (the resolver's
step 4 covers it identically).

### 8.4 Promote (`72-txn-review.js`)

Fold the existing ad-hoc matching into the shared resolver, **preferring
`card_masked`** first, then the current `fhPersonalAccountEnsure(ai)` /
memo-digit / one-card chain. The two-legged transfer pairing (funding leg −,
card leg +, one `transferGroupId`) when both the sending account and the card
are known is unchanged — the resolver only improves which card the `+` leg
tags. An explicit user pick (`c._payCardId` from the expanded card) still wins
over everything.

## 9. Failure modes

| Scenario | Behaviour |
|---|---|
| Card-side alert, card owned (screenshot) | Resolver step 2 names ··5140 at build; pre-selected. Fixed by Layer 1 alone |
| Account-side alert, card printed in a "Số thẻ" row, card owned | Layer 2 captures `card_masked`; resolver step 1 names it. Needs the pipeline deploy |
| Account-side alert, card **not** owned yet | No match → "Chưa rõ"; imports as an untagged transfer, assignable later. Never a wrong card |
| `account_masked` is the deposit but `account_kind` mislabelled `credit_card` | Step 2 matches only owned *cards*, so a deposit tail finds none and falls through — no mis-tag (the 2026-09-06 VIB deposit hazard stays fixed) |
| Repayment shape graduated to a template without `card_masked` | Field degraded at derivation → resolver falls to steps 2–4; re-derivation on the next layout change picks it up. No crash, no wrong card |
| Two owned cards share a last-4 | Ambiguous by tail; provider disambiguates when present, else null → "Chưa rõ" |
| User explicitly picked a card, then re-review | The explicit `_payCardId` is preserved and wins over the resolver |

## 10. Security invariants (delta only)

1. `card_masked` is last-4-only (`maskAccount`), inside the sealed box, NULL in
   every database column — the `0068` CHECK is unchanged (no new columns).
2. The card match runs client-side against the reviewer's own decrypted cards;
   the server never sees a card-to-card mapping.
3. No new value class is sent to the model beyond what consent (v4) already
   covers; a masked card tail is strictly less than the amounts already sent.
4. Confidence-gated: a card is bound only on a last-4 (+provider) match;
   ambiguity fails to "Chưa rõ", never to a guessed card.

## 11. Testing

- **Extraction:** a card-side and an account-side repayment fixture per format
  in hand (VIB both shapes to start); assert `card_masked` last-4 on the parsed
  reading, and template-path parity (graduated shape still yields `card_masked`,
  or degrades cleanly).
- **Resolver:** unit table over the five steps — including the deposit-tail-as-
  `account_kind:credit_card` safety case (must return null, not the deposit).
- **Review:** a staged card-payment candidate resolves `_payCardId` at build;
  the "Trả cho thẻ" row renders the card, not "Chưa rõ".
- **Promote:** the `+` card leg tags the resolved card; explicit pick still wins.

## 12. Related documents

- [effortless-transaction-logging-spec.md](effortless-transaction-logging-spec.md)
  — the umbrella pipeline (§16 extraction, §17 seal, §19 review/promote, §24
  the `account_masked`-routing open question this advances).
- [borrowing-lending-spec.md](borrowing-lending-spec.md) §8 — the `account_kind`
  instrument classifier and the instrument × direction matrix (card payment =
  transfer).
- [transaction-review-spec.md](transaction-review-spec.md) — the review screen,
  the "which card" follow-up picker this pre-fills.
- [email-extraction-reference.md](email-extraction-reference.md) §3 — the field
  map, where `card` moves from "context only" to `card_masked`.
- [personal-ledger-spec.md](personal-ledger-spec.md) — the personal accounts /
  cards the match runs against, and `fhPersonalAccountEnsure`.
