# Lending capture & correction — loans through the review queue

The epic that closes the gap the borrowing-lending v1 left open: **an outgoing
bank transfer that is really a loan to a friend had no correct answer in the
review queue.** The money-out Kind control offered only Chi tiêu / Trả nợ thẻ /
Chuyển đi nội bộ, and the promote path could emit every kind except `loan` — so
captured loans were filed as expenses, inflating the month's spend and never
creating the receivable, which meant the later repayment had nothing to
reconcile against.

> **Status, 2026-09-06.** Built and shipped in one pass (big-bang, decision
> Q22): migration `0122` applied live; app `sw v486`. All four parts: queue
> correction, learning, managing, getting paid.

> **How this relates to its siblings.** `borrowing-lending-spec.md` built the
> counterparty-balance primitive (`loan`/`repayment` kinds, derived balances,
> the Nợ & cho vay surface) and deferred the capture-side entry points this
> epic delivers. `transaction-review-spec.md` is the screen all of Part 1 lives
> in. `effortless-transaction-logging-spec.md` is the pipeline underneath. Read
> those first.

---

# Part 1 — Behaviour

## 1. Correction — the queue and the committed row

**In the queue.** A money-out card's Kind picker gains two options:

- **🤝 Cho vay** — opens a receivable. Follow-up rows: *Cho ai mượn* (chips:
  the captured beneficiary name first, then people with existing balances,
  then free-type) and *Hẹn trả* (optional date). The captured-name chip is the
  one-tap common case — and confirming it does double duty as the lesson key.
- **🤝 Trả nợ** — you repaying someone you owe. The same `repayment` kind the
  credit side already had ("Thu nợ"), with the sign following the money:
  +X = they repaid me, −X = I repaid them. The people chips are
  direction-aware: money in lists who owes *you*; money out lists who *you*
  owe.

**Scope lock (Q7ii).** Liabilities and receivables are personal, always — a
family can never be the lender (borrowing-lending locked decision #3). Picking
Cho vay or Trả nợ forces the row to 🔒 Cá nhân (refused with a toast while the
personal ledger is locked); flipping a loan row's scope to Gia đình clears the
kind back to Chi tiêu — the mirror of the v446 card-payment rule.

**Committed rows (Q1/Q8).** The personal expense editor gains **"🤝 Đây là
khoản cho vay"**: the row flips *in place* (same id, amount, date, photos),
drops its category, gains a counterparty + optional hẹn trả, and the
receivable appears. The way back lives in the person zoom-in: a loan row's
sheet offers *"Không phải cho vay — chuyển thành chi tiêu"*. A family-scoped
row is two existing gestures (cross-ledger move → flip), not a fused one.

**What a loan is NOT.** Not an expense (no consumption — the money changed
shape, not owner), so it stays out of "Ra", category stats and "Tiền đi đâu".
But it IS cash gone — see §4.

## 2. Learning — pre-select only, precision over recall

The category-lesson mechanism (payee-key + amount band) is extended from
*"payee → category"* to *"payee → kind + counterparty"*.

- **Lesson key**: normalized payee (deburred, bank-noise/gateway-stripped,
  first 40 chars) + amount band (<50k / <500k / <5M / 5M+). **Banded only, no
  bare-key fallback, bands independent** (Q16) — a wrong category is cosmetic,
  a wrong loan *invents a receivable*, so a lesson learned at 2M never touches
  the 80k dinner-split to the same friend.
- **Application strength (Q3/Q9)**: pre-select ONLY, straight into the ready
  list from the first firing. Nothing ever auto-imports — the human gate
  stands. With no forced glance, the collapsed card's chip carries the safety
  story: **🤝 Cho vay · Minh** + a quiet *"đã học từ bạn"* marker.
- **Firing precedence (Q15)**, most-certain first: (1) already classified
  (transfer pair / card payment / internal move) — untouched; (2) beneficiary
  matches someone you OWE → pre-select Trả nợ (this is the veto made
  productive: the loan lesson must never grow a fake receivable while a real
  payable sits untouched); (3) an opposite-direction same-amount candidate
  within ±1.5 days exists in the batch → the transfer matcher's territory,
  lesson stands down; (4) the banded lesson fires → Cho vay.
- **The repayment loop (Q10)**: incoming credits whose sender matches a person
  with an open receivable (balance > 0) pre-select **Thu nợ + the person** —
  the matcher the borrowing-lending spec claimed but never built. Name match
  is whole-phrase, word-boundary, ≥4 letters.
- **What teaches**: an imported loan (picked or a confirmed pre-select), the
  manual Cho vay sheet (lend direction), and the committed-row flip. Lessons
  commit only after the ledger write lands.
- **Unlearning (Q20c)**: flipping a fired lesson away weakens it by one (dies
  at zero, tombstoned); the Kind sheet's explicit *"Đừng gợi ý Cho vay cho
  người này nữa"* kills immediately.
- **Storage (Q4/Q11)**: one `personal_lessons` row per user — a JSON blob
  encrypted under the **personal DEK** (the `personal_budgets` pattern), so
  lessons survive a phone upgrade and the server can never read one. Category
  lessons are mirrored into the same blob (localStorage stays the fast local
  cache + locked-state fallback). Merge on divergence: union by key, higher
  confirmation count wins, **tombstones** so "quên đi" survives a two-device
  life. Synced at review-open (`fhLessonsSync`), pushed debounced.

## 3. Managing — hẹn trả, overdue, the daily guide

- `due_date` (plaintext, like `txn_date`) on loan rows. Set in the queue's
  *Hẹn trả* row, the manual loan sheet, the row's edit sheet, or the flip
  sheet. Optional everywhere.
- **Person zoom-in**: each loan shows *hẹn trả DD/MM* in its timeline row
  (red once passed); the header shows the nearest state — *hẹn trả 15/09* /
  *hẹn trả hôm nay* / *quá hẹn 5 ngày*. The bento person tile wears the same
  chip. Every row taps into an edit sheet (amount · date · note · hẹn trả ·
  delete · convert-back).
- **The nag keys off balance > 0, never row-matching (Q19iv)** — a partial
  repayment silences nothing until the balance clears; among several overdue
  loans the oldest due speaks.
- **Daily guide (Q19ii)**: the personal cash-flow card shows *"⏰ Minh hẹn trả
  2.000.000₫ — hôm nay / quá hẹn 3 ngày"* on the due day and while overdue,
  gone on settle. Current month only (an old month has no "today").

## 4. "Còn lại" feels the loan leave (Q5)

Flow and consumption are different axes. A loan out reduces the cash you can
spend this month even though it is not an expense — so the personal **Còn
lại** now includes the month's net lending flow (loan out −, borrowed +,
repayment received +, repaid −), while "Ra", categories, and "Tiền đi đâu"
stay consumption-only. The card says it out loud with a quiet line under the
tiles: *"🤝 Cho vay & trả nợ riêng: −2.000.000₫"* — without it the math would
look wrong. (Window-limited: the all-time stats slice deliberately carries
expense/income only, so older-month and Toàn thời gian views don't apply the
adjustment.)

## 5. Getting paid — nhắc trả + VietQR (Q13/Q21)

The person zoom-in (receivables only) gains **Nhắc trả**: an editable, plain,
polite message — *"Minh ơi, chuyển lại giúp mình 2.500.000 ₫ nhé. Quét mã QR
đính kèm là xong — hoặc chuyển vào STK … (Vietcombank)."* — plus a **VietQR**
any VN banking app scans to repay the exact amount. No FamilyHub branding, no
humor, no download pitch: the message represents the user, not the app.

- **Fully offline**: the NAPAS IBFT EMVCo payload (static BIN table +
  CRC-16/CCITT-FALSE) is built on-device (`25-vietqr.js`) and rendered by the
  in-house QR encoder — extended to **version 6** (two interleaved RS blocks)
  for the ~129-char payload, verified end-to-end against a reference decoder.
- **The account number** is the one thing capture never has (masked tails
  only). Asked **lazily** on first nhắc trả for the chosen receiving account,
  stored sealed (`account_number_enc`), never asked again. Unknown provider →
  a one-time bank picker.
- **The token loop**: the QR memo auto-embeds *TRA NO MINH 0609* — plumbing
  the visible message never mentions. When the friend pays through it, the
  incoming email's memo carries the name, and §2's matcher pre-selects Thu nợ.
- Share = `navigator.share` (message + QR image where supported), else copy.

## 6. Trust posture

Unchanged, and load-bearing: nothing auto-imports; every pre-select passes the
human gate; the server can read no amount, name, lesson, or account number
(all personal-DEK ciphertext); a lesson can only ever make the queue *guess*
better, never act alone. "Never invent a debt" (borrowing-lending §8.4)
motivates the banded-only, veto-first firing rules.

---

# Part 2 — Technical appendix

## 7. Schema (migration `0122_lending_capture.sql`, applied live 2026-09-06)

- **`personal_lessons`** — `owner_user_id uuid PK → auth.users`, `lessons_enc
  text`, `updated_at`. RLS `owner_user_id = auth.uid()` all verbs. Blob shape:
  `{ kind: { "<payee>|<band>": {who,n,t} }, cat: { key: name }, tomb:
  { "kind|<key>": {t} } }`.
- **`personal_transactions.due_date date`** — loans only by convention.
- **`personal_accounts.account_number_enc text`** — sealed receiving number.
- NB: the live DB also carries a `0123_investment` migration (2026-09-05) from
  a separate workstream, not present in this repo. `0122` was free on both
  sides; the numeric-collision caveat from `transaction-review-spec.md` stands.

## 8. Module map

| File | What this epic added |
|---|---|
| `src/js-data/19-personal.js` | `due_date`/`account_number_enc` through hydrate + writers; `fhPersonalConvertToLoan` / `fhPersonalConvertToExpense` / `fhPersonalDebtRowUpdate`; loans/repayments with an `account_id` now move `fhPersonalBalance` (loan −amt, repayment +amt) so a captured loan can't fake drift; **regen sweep re-encrypts `account_number_enc` + `personal_lessons.lessons_enc`** (rotation that misses a field strands it forever) |
| `src/js-data/24-lessons.js` | the lessons store: `fhKindLesson/Learn/Weaken/Kill`, `fhKindLearnManual`, `fhLessonsSync`, tombstoned merge, debounced encrypted push |
| `src/js-data/25-vietqr.js` | NAPAS BIN table (`fhVietQRBanks/BinFor`) + EMVCo payload builder (`fhVietQRPayload`) with CRC-16/CCITT-FALSE |
| `src/js-data/16-qr.js` | encoder extended v5 → v6: data/EC tables, alignment 34, 2×(86,68,18) block interleaving |
| `src/js-ui/57-csv-import-review.js` | `csvLendingPass` (precedence + veto + matchers + lesson firing), `_debtNameHit`, lessons↔localStorage bridge (`csvLearnedExport/MergeIn`), bucketing guard so loan/repay rows never fall into the pick-a-category groups |
| `src/js-ui/56-csv-import-ui.js` | Kind picker + rows-card faces for `loan`/direction-aware `repay`; `loanwho`/`loandue` sheets; captured-name default; scope lock both directions; collapsed-card chip + *đã học từ bạn* marker; `csvLessonKill`; lookalike-copy carries loan fields; xfer-proposal exclusion |
| `src/js-data/72-txn-review.js` | promote emits `kind:'loan'` (+dueDate, +accountId) and signed `repayment`; learn/weaken ops applied only after the write lands; `fhLessonsSync` at queue-open |
| `src/js-data/23-debts-ui.js` | `_personDue` + tile/header/timeline due states; `fhDebtRowSheet` (edit/delete/convert-back); loan sheet hẹn trả + manual lesson; `fhExpenseToLoanSheet`; `fhDebtRemindSheet` + `_remindResult` (VietQR, share/copy) |
| `src/js-ui/21-personal.js` | Còn lại lending adjustment + `cf-lend` line + `cf-duealert` heads-up |
| `src/js-ui/55-expense-photos-writes.js`, `50-sheets-expense-capture.js` | `#ex-toloan` button injection (personal edit only, hidden elsewhere) |
| `src/css/41-debts.css`, `40-spending-tabs.css`, `55-event-sheet-catrows.css` | `.dbt-due.over`, `.dbt-overtxt`, `.dbt-rq-qr/.dbt-rq-cv`, `.cf-lend`, `.cf-duealert`, `.ex-toloan` |

## 9. Sign & unit conventions (the two classic hazards)

- Signs inside `amount_enc`, from MY point of view (0105): loan +X = I lent ·
  loan −X = I borrowed · repayment +X = they repaid me · repayment −X = I
  repaid. The queue writes: Cho vay → `+base`; Trả nợ (debit) → `−base`;
  Thu nợ (credit) → `+base`.
- Amounts: candidate `c.amount` is raw đồng; every personal write converts via
  `csvBaseAmt` (÷1000). Lesson bands are computed on raw đồng; manual-entry
  lessons multiply base × `curMult()` before banding — mixing these up shifts
  every lesson two bands.

## 10. Known limitations

- **Quick review** (`76-quick-review.js`) stays a simple expense/income
  surface; a loan-shaped row popped there is corrected in the full screen.
- Category-lesson "quên hết" doesn't tombstone (kind lessons do) — another
  device's blob can re-contribute old category lessons. Accepted: categories
  are cosmetic; receivable-minting lessons get the strong machinery.
- The Q15 pair-shaped stand-down looks only within the current batch; a leg
  whose partner arrives days later relies on the review chip being editable.
- Lending flow adjusts Còn lại for slice-window months only (§4).

## 11. Decision log

The full design interview (23 questions, all settled 2026-09-05/06).

| # | Decision |
|---|---|
| Q1 | Correction reaches the queue AND committed personal rows; family rows via move-then-flip, no fused gesture. |
| Q2 | Lesson key = normalized payee + amount band; memo keywords not relied on (VN memos are auto-filled names). |
| Q3 | Learning = pre-select only. Never auto-file; human gate inviolable. |
| Q4 | Lessons synced in ONE encrypted blob under the personal DEK; category lessons migrated into it. |
| Q5 | Loans count against Còn lại / daily guide (cash truly left) while staying out of expense stats. |
| Q6 | v1 attributes: counterparty + hẹn trả + purpose (reuses note) + reminder-lite + VietQR get-paid. Interest deferred. |
| Q7 | Cho vay pick: captured-name chip + balance chips + free-type; kind forces personal scope, scope flip clears kind. |
| Q8 | Committed-row flip is personal-rows-only v1. |
| Q9 | Lesson hits land pre-selected in the READY list from the first firing (no ramp). |
| Q10 | Repayment side in scope: Thu nợ pre-select on matching credits; manual loans teach lessons too. |
| Q11 | `personal_lessons`: single-row blob, count-wins merge, tombstoned forgetting. |
| Q12 | `due_date` plaintext (consistent with `txn_date`); purpose = `note_enc`, no second field. |
| Q13 | VietQR in v1; full account number asked lazily, stored sealed. |
| Q14 | The ready-list card keeps the kind + counterparty + "đã học từ bạn" chip — it carries the whole safety story. |
| Q15 | Precedence: transfer-pair > card-payment > loan lesson > cascade; veto — never fire Cho vay toward a creditor. |
| Q16 | Kind lessons banded-only, bands independent, no bare-key fallback. |
| Q17 | 🤝 Trả nợ added to money-out (the veto made productive); writes signed `repayment`. |
| Q18 | Lesson beats standing per-source route (a loan can't be family-scoped); route governs non-lesson rows. |
| Q19 | Zoom-in due/overdue states; guide fires due-day + overdue; nudge amount defaults to TOTAL open balance; nag keys off balance > 0. |
| Q20 | Unlearning = weaken-on-flip (count −1, dies at 0) + explicit kill in the Kind sheet, both tombstoned. |
| Q21 | Nhắc trả message: plain, polite, editable, unbranded; QR token invisible in the visible text. |
| Q22 | Big-bang delivery, internal build order queue → learning → managing → getting paid. |
| Q23 | This spec is its own doc, cross-referencing the siblings. |

## 12. Related

- `docs/specs/borrowing-lending-spec.md` — the counterparty-balance primitive
  this rides on (its deferred "review-side repayment matching" is delivered
  here).
- `docs/specs/transaction-review-spec.md` — the screen (§4a card grammar, §5
  destination routing, category cascade §C the lessons extend).
- `docs/specs/effortless-transaction-logging-spec.md` — capture pipeline.
- `docs/specs/full-ledger-spec.md` — transfer pairs, anchored balances, drift
  (why account-tagged loans must move the derived balance).
