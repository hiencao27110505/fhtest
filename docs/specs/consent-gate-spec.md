# Consent Gate — asked at the feature's door, every time, for exactly what it needs

A person who tapped "Để sau" once on the statement consent is still on v4 weeks
later, every statement their bank emails is silently held, and nothing in the app
says so. This spec names the consent each email feature needs, asks for it at
that feature's own door every time the door is tapped, and keeps a visible line
on the queue while anything is off.

> **Status, 2026-11-08. BUILT** (branch `feat/email-capture`, SW v634, client
> only, no migration), the same day it was agreed (decision log §9, CG1–CG12)
> and its target reviewed (§3.1 and §3.2 carry the target-time amendments).
> `pdf-statements-spec.md` §7 will add one sentence (v8) through this spec's
> mechanism when that step is built.

> **How this relates to its siblings.** `docs/PDPL-COMPLIANCE.md` §5 owns the
> legal shape (one table, affirmative rows, withdrawal symmetric); nothing here
> changes a record's meaning. `statement-capture-spec.md` S23 and
> `receipt-enrichment-spec.md` §13 introduced the server-side version gates this
> spec surfaces. `transaction-review-spec.md` gains the queue's status line.

---

# Part 1 — Behaviour

## 1. Summary

- **Every feature names the consent it needs** (CG1): bank mail v4, statement
  files v5, receipts v6, the store registry v7, receipt scan (its own kind) v1,
  and, when `pdf-statements-spec.md` §7 ships, learning a statement layout v8.
- **One gate asks for it at the feature's door, every tap** (CG2, CG3): no
  once-per-session latch. "Để sau" means the feature does not run now; the
  person's existing capture carries on; the next tap asks again.
- **The sheet is scoped** (CG4): it names the feature, says what the person is
  agreeing to in addition, shows the changes since their version, and folds the
  full text they already know.
- **The queue never hides that something is off** (CG5): one status line on
  every open, in the queue, in its empty sheet and in Settings, with "Bật".
- **The server stays the truth** (CG7): every lane keeps checking the recorded
  version itself. The client gate is the ask, not the law.

## 2. Why this exists

- The statement lane needs `bank_email ≥ 5`. The only place that asked was the
  review queue, through a soft offer shown once per session, whose "Để sau"
  continued into the queue as if nothing happened. Someone connected under v4
  who tapped it once stays on v4 with no way to notice (the teammate case of
  2026-11-08 is this or the PDF gap; both were silent).
- Statements, receipts and the store registry are passive features: they have no
  tap of their own, so nothing could ask at the moment the person wanted them.
- A person asked for "the current consent" on a screen that does not need it
  reads the whole sheet hunting for why; a person asked for "sao kê từ email"
  at the row that says "Sao kê từ email" knows exactly what they are answering.

## 3. What the person sees

### 3.1 The status line

While any email sub-feature's need is above the person's recorded version, the
review queue shows, on **every** open, above the cards and in the empty sheet:

> **Sao kê từ email** · Đang tắt ›
> **Hoá đơn từ cửa hàng** · Đang tắt ›

(one row per feature that is off), under the eyebrow **ĐỌC TỪ EMAIL**. The row
is the privacy sheet's own: glyph (`file` / `receipt`), title, the current
value in the muted slot, a disclosure chevron. The trailing text states the
**value only**; the verb lives in the sheet the row opens (the chevron means
"this opens something", and a verb beside it would read as a second control).
A row whose feature is on reads "Đang bật ›" and opens the read-only sheet
(`fhConsentReview` precedent), so the chevron always navigates. Settings →
Email ngân hàng shows the same block; the store list shows **Chọn cửa hàng ·
Đang tắt ›** with its footer while the registry consent is below v7. The Cá
nhân tab's "Khoản thu chi từ email" row keeps only its pending badge (CG8). No
"vì bạn chưa đồng ý": the row states a fact; it does not blame.

*(Amended at target time, 2026-11-08, after the HIG and design reviews: the
spec's "đang tắt · Bật" put a verb in the value slot next to a chevron; CG5 and
CG11 now read as above.)*

### 3.2 The scoped sheet

Tapping "Bật", or any door in §3.3, opens the consent sheet scoped to that feature:

> ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN · SAO KÊ TỪ EMAIL
> **Bật sao kê từ email**
> Để đọc sao kê gửi kèm email, cần bạn đồng ý thêm một điều.
> *(the change block holds the feature's own entry only; its footer says
> "Bản hiện tại cũng gồm N thay đổi khác, nằm trong toàn văn bên dưới.")*
> ▸ Đọc toàn bộ nội dung bản v7
> **[Tôi hiểu và đồng ý]** · Để sau

The kicker keeps its legal label (`_cstKicker(extra)`: the document type, then
the feature). The title is the same verb as the row's outcome and the toast
("Bật sao kê từ email" / "Đã bật sao kê từ email"); the lead is a sentence in
`.sheet-sub`, not the title. With one entry in the block the whole sheet, buttons
included, fits one screen; the other entries stay in the folded full text.

- Agreeing records the **current** version, as today (one `(user, kind, version)`
  row; a duplicate is handled). The single monotone version stays (CG10): "Bật
  sao kê" is agreeing to the current text, receipts included, and the sheet shows
  every change so that is honest.
- "Để sau" closes the sheet and does nothing else. No record, never a withdraw.
- The next tap on the same door asks again (CG3).

### 3.3 The doors

| Door | Need | Behaviour while unconsented |
|---|---|---|
| Connect: forwarding (`fhMailboxStart`), OAuth (`fhAutoTxnGrant`) | current version | blocks, as today, through the same gate |
| Settings → Email ngân hàng → "Sao kê từ email" | `statements` (v5) | the scoped sheet, every tap |
| Settings → Email ngân hàng → "Hoá đơn từ cửa hàng" | `receipts` (v6) | the scoped sheet, every tap |
| Settings → the store list (`78-receipt-stores`) | `stores` (v7) | the list paints the status row and the sheet instead of the stores |
| Receipt scan (`78-receipt-scan`) | `scan` (own kind, v1) | its existing sheet and its own check on every use (unchanged); `fhConsentNeed('scan', …)` returns false and does nothing, so one call shape exists without a second gate *(amended at build time: routing it through the bank sheet's gate was dead code)* |
| The queue's "Bật" line | the feature named | the scoped sheet |
| "Phân tích" on an unreadable statement (`pdf-statements-spec.md` §7) | `learn` (v8) | the scoped sheet |

Nothing else is gated (CG9). Opening the review queue itself needs v4 only and
is never blocked by a later version (CG6).

### 3.4 What is retired

- `fhConsentOffer` and its `sessionStorage` once-per-session latch. The status
  line replaces it.
- The paragraph in `docs/PDPL-COMPLIANCE.md` that describes the once-per-session
  offer (amended in place).

## 4. Safety rules

- **A failed read is "ask"** (unchanged): an unreadable consent record never
  counts as consent.
- **Agreeing is the only write.** Declining writes nothing; withdrawal stays the
  disconnect action.
- **Copy localises both ways** (`L()`), with full diacritics; no em-dashes in
  strings.
- **The sheet lists what moved** between the person's version and the current
  one, the feature's own entry first; a bump without its `FH_CONSENT_CHANGES`
  entry fails the existing test.

---

# Part 2 — Technical Appendix

## 5. The needs table

```js
// 75-consent-ui.js
var FH_CONSENT_NEEDS = {
  // kicker = the `extra` segment of _cstKicker (the legal label stays); title = the
  // verb the row and the toast use; lead = one sentence in .sheet-sub. bank_email
  // (the first-time door) keeps today's headline and has no lead.
  bank_email: { kind: 'bank_email',   v: FH_CONSENT_V, kicker: ['EMAIL NGÂN HÀNG', 'BANK EMAIL'], title: null, lead: null },   // the connect door asks for the CURRENT text (§3.3)
  statements: { kind: 'bank_email',   v: 5, kicker: ['SAO KÊ TỪ EMAIL', 'STATEMENTS FROM EMAIL'],
                title: ['Bật sao kê từ email', 'Turn on statements from email'],
                lead:  ['Để đọc sao kê gửi kèm email, cần bạn đồng ý thêm một điều.', 'To read statements attached to your emails, there is one more thing to agree to.'] },
  receipts:   { kind: 'bank_email',   v: 6, kicker: ['HOÁ ĐƠN TỪ CỬA HÀNG', 'STORE RECEIPTS'],
                title: ['Bật hoá đơn từ cửa hàng', 'Turn on store receipts'],
                lead:  ['Để đọc hoá đơn từ cửa hàng, cần bạn đồng ý thêm một điều.', 'To read store receipts, there is one more thing to agree to.'] },
  stores:     { kind: 'bank_email',   v: 7, kicker: ['CHỌN CỬA HÀNG', 'CHOOSE STORES'],
                title: ['Chọn cửa hàng được đọc hoá đơn', 'Choose the stores we read receipts from'],
                lead:  ['Để tự chọn cửa hàng cho hộp thư này, cần bạn đồng ý thêm một điều.', 'To pick the stores for this mailbox, there is one more thing to agree to.'] },
  learn:      { kind: 'bank_email',   v: 8, kicker: ['HỌC CÁCH ĐỌC SAO KÊ', 'LEARNING A STATEMENT LAYOUT'],
                title: ['Học cách đọc sao kê này', 'Learn to read this statement'],
                lead:  ['Để gửi bản đã che số cho AI học cách đọc, cần bạn đồng ý thêm một điều.', 'To send a masked copy for the AI to learn the layout, there is one more thing to agree to.'] },
  scan:       { kind: 'receipt_scan', v: 1, kicker: ['QUÉT HOÁ ĐƠN', 'RECEIPT SCAN'], title: null, lead: null },
};
```

`tools/consent-gate.test.js` pins `statements.v === STATEMENT_CONSENT_V`,
`receipts.v === RECEIPT_CONSENT_V`, `stores.v === RECEIPT_REGISTRY_V`, and
`learn.v === FH_CONSENT_V` once `pdf-statements-spec.md` §7 ships, so the client
and the worker cannot disagree (CG1). `learn` is absent until that bump lands.

## 6. The gate

```js
window.fhConsentNeed = async function (feature, go) {
  var need = FH_CONSENT_NEEDS[feature];
  var rec = null;
  try { rec = await _cstFetch(need.kind); } catch (e) { /* unreadable: ask */ }
  if (rec && rec.version >= need.v) { go(); return true; }
  window.fhConsentSheet({ then: go, prior: rec, priorKnown: true, feature: feature });
  return false;
};
```

- Replaces `fhConsentEnsure` (connect doors call `fhConsentNeed('bank_email', …)`)
  and `fhConsentOffer` (removed with its latch).
- `fhConsentSheet` gains `feature`: the kicker and the lead come from the needs
  table; `_cstChangedBlock` is asked for the changes from `prior.version` to the
  current version with the feature's own version first; the full text folds.
  Agreeing still records `FH_CONSENT_V` (CG10).
- `fhConsentLater` closes the sheet; the `later` continuation is gone (the soft
  offer was its only user).
- `receipt_scan` keeps its own sheet, insert and per-use check
  (`78-receipt-scan.js`, unchanged). `fhConsentNeed('scan', …)` is a no-op that
  returns false; the needs table names the kind so the test pins it (CG9, amended
  at build time).

## 7. The status line

`fhConsentStatusHTML()` in `75-consent-ui.js` returns, for every email feature
whose need is above the cached record (`fhConsentCached`), **the privacy sheet's
own row** (`_cstNavRow`: `.cst-lrow` with glyph · title · muted value
"Đang tắt · Bật" · chevron, the whole 56 px row tappable), inside one
`.cst-group`. *(Amended at target time, 2026-11-08: the spec's text-plus-verb
`.cst-line` lint-failed the 44 px rule as a text button, and `.cst-lrow` already
exists for exactly this job; no new class.)* Tapping a row calls
`fhConsentNeed('<feature>', fhConsentStatusRefresh)`. Drawn by:

- `72-txn-review.js`: at the top of the queue body on every `fhTxnReviewSheet`
  open, and in the empty sheet above "Nhập file sao kê" (the empty-sheet markup
  at `72-txn-review.js:1443`). It joins the queue's render signature
  (`csvReviewSigCompute`) so a change is one paint and an unchanged state is
  skipped (device-heat B).
- `74-autotxn-ui.js`: Settings → Email ngân hàng, as rows "Sao kê từ email" and
  "Hoá đơn từ cửa hàng" with value "Đang tắt · Bật" or "Đang bật".
- `78-receipt-stores.js`: in place of the store list while `stores` is off.

After an agree, `fhConsentStatusRefresh` re-reads the record and repaints the
three surfaces; the queue's next open fetches statements the lane captured
meanwhile (the lane needs no nudge: it reads the record on its next tick).

## 8. Testing

| Suite | Pins |
|---|---|
| `tools/consent-gate.test.js` | the needs table against the worker constants; `fhConsentNeed` asks again on a second tap (no latch); a record at v4 shows two status lines, at v5 one, at current none; "Để sau" writes nothing; agreeing records `FH_CONSENT_V`; the scoped sheet's kicker, lead and first change entry per feature; the `learn` entry is absent until the v8 bump |
| `tools/review-attention.test.js` | the status line is in the queue's render signature |
| `tools/ui-harness/flows/consent-gate.flow.js` (new) | a v4 person opens the queue, sees the line, taps Bật, agrees, the line is gone; the Settings rows; the store list |

Thresholds (stage 1): among connected people below v5 on release day, ≥ 70%
reach the current version within 14 days (`user_consents` × `mailbox_grants`);
kill if more than 30% of them decline the sheet three or more times in a week
(CG12).

## 9. Decision log

Grilling of 2026-11-08.

| # | Decision | Why |
|---|---|---|
| CG1 | **A needs table per feature**, pinned to the worker constants by a test. | Client and server must name the same version |
| CG2 | **One gate**, `fhConsentNeed(feature, go)`, replaces `fhConsentEnsure` and `fhConsentOffer`. | One behaviour, one test |
| CG3 | **Asked every tap, no session latch.** "Để sau" = not now, nothing recorded. | The founder: prompt whenever the feature is tried |
| CG4 | **The sheet is scoped**: kicker and lead name the feature; changes since the person's version, the feature's first; full text folded. | The person knows what they are answering |
| CG5 | **A status line on every queue open**, in the queue, its empty sheet and Settings, with "Bật". | Nothing off is ever silent |
| CG6 | **The queue itself is not a statement door**; it needs v4 only and is never blocked by a later version. | Nagging fatigue; the line converts better than a sheet in the way |
| CG7 | **The server stays the truth**: every lane keeps checking the recorded version. | The client gate is the ask, not the law |
| CG8 | **Not on the Cá nhân tab row.** | One voice per surface |
| CG9 | Doors: connect (both), the two Settings rows, the store list, receipt scan, the queue line, the learn offer. Nothing else. | — |
| CG10 | **Single monotone version stays.** Per-feature opt-in (accept statements, refuse receipts) is a future spec. | Schema and worker change; not this epic |
| CG11 | Copy (amended at target time): row "Sao kê từ email · Đang tắt ›" (value only, chevron navigates); sheet kicker keeps the legal label, title "Bật sao kê từ email", lead "Để đọc sao kê gửi kèm email, cần bạn đồng ý thêm một điều."; toast "Đã bật sao kê từ email"; no blame phrasing; EN twins via `L()`. | HIG: a verb in the value slot beside a chevron reads as two controls; a clause as a sheet title wraps three lines in EN |
| CG12 | Thresholds as in §8. | — |

## 10. Module map

| File | Change |
|---|---|
| `src/js-data/75-consent-ui.js` | `FH_CONSENT_NEEDS`, `fhConsentNeed`, scoped `fhConsentSheet`, `fhConsentStatusHTML` / `fhConsentStatusRefresh`; `fhConsentOffer` and the latch removed; `fhConsentEnsure` kept as an alias of `fhConsentNeed('bank_email', …)` for one release |
| `src/js-data/71-mailbox-ui.js`, `74-autotxn-ui.js` | connect doors through the gate; the two Settings rows |
| `src/js-data/72-txn-review.js` | the status line in the queue and the empty sheet; the offer call removed; signature field |
| `src/js-data/78-receipt-stores.js` | the status row while `stores` is off |
| `src/js-data/78-receipt-scan.js` | unchanged (its own per-use check is already the no-latch behaviour) |
| `src/css/74-mailbox.css` | no change: the rows are `.cst-lrow` in `.cst-group` (amended at target time) |
| `docs/PDPL-COMPLIANCE.md` | §5 paragraph on the once-per-session offer, amended |
| `tools/consent-gate.test.js`, flows | §8 |

## 11. Related

- `docs/PDPL-COMPLIANCE.md` — the legal shape; §5.
- `docs/specs/statement-capture-spec.md` — S23 (v5 gates statements only).
- `docs/specs/receipt-enrichment-spec.md` — §13 (v6), `receipt-providers-spec.md` (v7).
- `docs/specs/pdf-statements-spec.md` — §7, the v8 sentence.
- `docs/specs/transaction-review-spec.md` — the queue's status line.
