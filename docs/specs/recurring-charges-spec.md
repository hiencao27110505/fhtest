# Recurring Charges: knowing which spending comes back

A Google One renewal, a Netflix month, the gym, electricity. Each is a row like
any other in the ledger today, and the ledger has no idea it will happen again
on the 6th. This spec gives a transaction a **recurrence**: how often it comes
back and how we know, so the app can show what is coming, total what the
family pays every month without thinking, and notice when a subscription
quietly costs more than it did last time.

> **Status, 2026-10-07.** Release 1 went live on 2026-10-06 and failed its
> first real test the same evening: it marked a coffee shop and missed rent
> and every subscription (`docs/incidents/2026-10-06-recurring-detection.md`).
> **§18 is detection v2**, the resolution: it supersedes §8 and §9 and
> completes §10. Released 2026-10-07 (SW `v616`, client only, no migration,
> no function deploy); see Part 4. Decisions RR1–RR9 (§15) stand except where RR10–RR19 amend
> them. Release-1 cuts are in §17. This unblocks the "merchant intelligence"
> epic that `habit-streak-spec.md` §15 parked.

> **Audience & layering.** Part 1 Behaviour, Part 2 Technical, Part 3 Build
> plan, §15 decision log.

> **Siblings.** `receipt-enrichment-spec.md` and `receipt-providers-spec.md`
> supply the first source (a receipt that says "Auto-renewing subscription …
> /month"). `personal-ledger-spec.md` and `full-ledger-spec.md` own the rows
> this adds two columns to. `apply-to-similar-spec.md` and `carry-rules-spec.md`
> own the lesson and rule machinery the mark teaches through.
> `transaction-review-spec.md` owns the queue card the mark first appears on.

---

# Part 1 — Behaviour

## 1. Summary

- Every transaction, in every ledger (personal and family, consistently), may
  carry a **recurrence**: `weekly | monthly | yearly`, or none, and a **source**
  that says how we know: the receipt said so, a pattern in the ledger says so,
  or the person set it.
- The **next charge** is never stored. The device derives it from the latest
  charge in the series and its period. A renew date a receipt states lives in
  the encrypted receipt blob and wins on display.
- Charges link into a **series** by a derived key (merchant, period, product)
  with no amount in it, so a price change stays in the same series.
- A **pattern** is a merchant's charges arriving in cadence: at most one per
  period, most gaps the length of a period (§18.3). On a recurring leaf of
  the category tree (rent, a bill, a subscription) two monthly charges are a
  soft guess and a third confirms; elsewhere three are the guess and four the
  fact. The person confirms at any time. A coffee shop visited seven times in five weeks is not a pattern,
  whatever one pair of visits looks like.
- The mark **teaches**: a receipt that says monthly marks the next MoMo
  "Google" row monthly before its receipt even arrives, through the same
  encrypted device lessons items use.
- A **Định kỳ** tile in Tài Chính (beside Đầu tư) shows what is due in the
  next 30 days and "mỗi tháng ~X"; its sheet lists every series. The family
  tab gets the same.
- **Price creep**: a charge more than 5 percent above the previous one in its
  series is flagged on the row and in the sheet. In-app only. No push in this
  epic.

## 2. Why this exists

Recurring charges are the part of spending nobody decides each month, which
is exactly why they drift: the trial that became 149.000đ, the storage plan
upgraded in a hurry, the gym nobody has visited since March. The ledger
already holds every one of these rows; what it lacks is the link between
them and a date for the next. A receipt now arrives with the period printed
on it (`receipt-providers-spec.md` §12), the ledger has months of history for
the pattern, and the person can always just say so. Three sources, one mark.

## 3. What the person sees

### 3.1 The mark

One quiet line under a card's meta, beside the receipt line where there is
one: `Định kỳ · hàng tháng`. Only a settled value wears it; a guess shows on
the card's Định kỳ row and nowhere else. No glyph, no badge, no colour.

### 3.2 The row in the detail screen and the expanded queue card

A **Định kỳ** row in the row language Danh mục and Ngày use. The value is one
word. When there is more to say it goes on a second line under the value, in
the shape the rule line ("Theo quy tắc") already has there:

```
Định kỳ                              Hàng tháng  ›
                          Kỳ tới 16/10 · tăng 24.000 ₫
```

| State | Value | Second line |
|---|---|---|
| In a series | `Hàng tháng` | `Kỳ tới 16/10`, or `Dự kiến 5/10` when that date has passed and the charge has not been seen. `tăng 24.000 ₫` in amber when this charge cost more than the last (§12) |
| A guess, or a first charge on a recurring leaf | `Có vẻ hàng tháng`, in the soft ink | the date when a series gave one |
| On the queue card | as above | where it came from: `Theo hoá đơn`, `Theo các kỳ trước`, `Theo bài học`. A leaf hint has none: "Có vẻ" already says it |
| None | `Không`, soft | |

"Dự kiến" and never "quá hạn" or "trễ": a charge that has not arrived is a
fact about the pattern, not a verdict on the person.

Tapping opens the shared choices sheet with four chips, Không / Hàng tuần /
Hàng tháng / Hàng năm (single-select, DESIGN §3). The subtitle is "Chọn xong
là lưu ngay."; for a guess it is "Có vẻ lặp lại hàng tháng. Chọn xong là lưu
ngay." and no chip is selected: picking the period confirms it, Không
declines. A pick **writes at once** (the Loại khoản precedent), through the
ledger's own door, and teaches the merchant. Choosing Không on a marked row
sets `recurrence_source = 'person'` with `recurrence = null`, which the engine
reads as "asked and declined": no pattern re-marks it, and the lesson is
forgotten (RR5). The next date is derived (RR2) and not editable in release 1
(§17).

### 3.3 The Định kỳ tile and sheet

Picked on 2026-10-07 from `mockups/recurring-options.html` (eight directions
each): tile 3 "Vòng tháng", sheet 5 "Thuê bao". The file also holds eight
variants of the ring tile for the next round.

**The tile: the month as a progress.** Beside Đầu tư, in the bento tile
language. Left: "Tháng 10 còn", the amount still due this month, and "trên
10.558.000 ₫ định kỳ · 2 khoản". Right: the daily-guide ring reused, the paid
share filled in brand, the due share the track, "71% đã trả" inside. Under a
hairline, one line per charge of the month: grey dot and soft ink for paid
("Tiền thuê nhà · 6/10"), sage dot for due. Footer lines only when there is
something to say: a price that rose, and "Có vẻ định kỳ: …". When the month
is done the view rolls to next month (RR20): "Tháng 11", the ring at zero.
With nothing confirmed yet the tile lists the guesses in soft ink with no ring
and no total.

```
Tháng 10 còn                              ╭───╮
3.058.000 ₫                               │71%│
trên 10.558.000 ₫ định kỳ · 2 khoản       ╰───╯
──────────────────────────────────────────────
○ Tiền thuê nhà · 6/10              7.500.000 ₫
● Anthropic · 18/10                 2.970.000 ₫
● YouTube Premium · 20/10              88.000 ₫
```

**The sheet: the language of Cài đặt › Thuê bao.** Subtitle "4 dịch vụ ·
~10,6 tr ₫ mỗi tháng". A square monogram tile per service in one of the six
identity slots (picked by the series key, so a service keeps its colour), the
name, a renewal line, the amount with its cycle underneath ("/tháng",
"/năm"). Groups in order: **Còn lại tháng này** (or "Tháng 11" once rolled),
with a countdown in the renewal line: "Gia hạn 18/10 · còn 11 ngày", "hôm
nay", "ngày mai", or "dự kiến, chưa thấy"; then each later month as its own
group ("Tháng 11"), renewal line "Gia hạn thứ sáu 6/11"; then **Hàng năm**;
then **Có vẻ định kỳ**, each guess with its question and two pills, Không and
Đúng rồi. A price that rose takes the cycle's place under the amount, in
amber: "tăng 24.000 ₫". Rows open the latest transaction.

```
CÒN LẠI THÁNG NÀY
[A] Anthropic                          2.970.000 ₫  ›
    Gia hạn 18/10 · còn 11 ngày             /tháng
[Y] YouTube Premium                      129.000 ₫  ›
    Gia hạn 16/10 · còn 9 ngày          tăng 24.000 ₫
THÁNG 11
[N] NGUYEN VAN QUANG                   7.500.000 ₫  ›
    Gia hạn thứ sáu 6/11                    /tháng
```

Names: the receipt's own ("YouTube Premium") when the row carries one, else
the payee as the bank writes it. Naming a payee-less bank string by its leaf
("Tiền thuê nhà") is shown in the mockups and not built (§17).

Empty: the tile is absent until something repeats. The sheet, opened while
the history is still being read, says "Đang xem lại lịch sử chi tiêu…"; with
nothing found, "Chưa có khoản nào lặp lại. Khi có sẽ hiện ở đây."

## 4. Safety rules

1. The mark never changes an amount, a date, a category or a scope. It is a
   label and a derived date.
2. A pattern never overrides a person. `recurrence_source = 'person'` is
   final for that row until the person changes it.
3. A receipt mark is applied only to the row the receipt joined (and taught
   forward through lessons); it never re-marks older rows retroactively.
4. No notification of any kind in this epic (RR9).
5. Nothing is sent anywhere: detection, series, totals and creep all run on
   device over decrypted rows.

## 5. Limits

- Weekly detection needs at least two charges six to eight days apart; a
  fortnightly charge is not detected (shown as none until set by hand).
- Variable bills (electricity) match only when within 10 percent of the
  previous charge; a hot month breaks the chain and shows a new soft guess
  when it settles. The person's mark fixes this once.
- Family rows have no merchant column; their pattern key is the decrypted
  note plus category plus amount band, which is weaker than the personal key.

---

# Part 2 — Technical Appendix

## 6. Data

Migration `0157` (shared with `receipt-providers-spec.md` L2; one number, one
file):

```sql
alter table public.personal_transactions
  add column if not exists recurrence text check (recurrence in ('weekly','monthly','yearly')),
  add column if not exists recurrence_source text check (recurrence_source in ('receipt','pattern','person'));
alter table public.transactions
  add column if not exists recurrence text check (recurrence in ('weekly','monthly','yearly')),
  add column if not exists recurrence_source text check (recurrence_source in ('receipt','pattern','person'));
create index if not exists personal_transactions_recur_idx on public.personal_transactions (owner_user_id) where recurrence is not null;
create index if not exists transactions_recur_idx on public.transactions (family_id) where recurrence is not null;
```

Staged rows carry the same two fields inside `raw_extracted` (sealed, so no
column): `recurrence` and `recurrence_source`, written by the receipt join or
a lesson on device, never by the worker (the worker only knows `period`).

Both personal RPCs (`personal_txn_insert`, `personal_txn_patch` from 0156)
and the family write path accept the two fields. `get_family_snapshot` (which names its transaction columns one by one, so `0158` adds the two; found after `0157` went live) and the
personal hydrate select them.

## 7. Why plaintext, and what it does and does not give

Amounts, notes and counterparties on personal rows are ciphertext
(`personal-ledger-spec.md` §storage) and family notes are encrypted too. The
period is a small enum that reveals "this row is a subscription" and nothing
about who or how much; dates and `kind` are already clear. Keeping it clear
lets the client query "rows with a recurrence" without decrypting the ledger,
and lets a future server-side count exist. It does **not** let the server sum
anything: totals are device-side by construction. Recorded here as a
deliberate plaintext field, alongside `txn_date`, `kind` and `cat_emoji` in
the personal-ledger column table (that table gains the two rows).

## 8. Series key

> **Superseded by §18.2 (2026-10-07).** The key below put the category in a
> family row's identity and, because personal rows in memory carry no payee,
> was what personal rows used too. Kept for the record.

```
recurKey(row) = merchantKey(row) + '|' + period + ('|' + productSig when a receipt gave one)
```

- Personal rows: `merchantKey` is `fhPersonKey` over the decrypted counterparty
  (the lesson key `apply-to-similar-spec.md` uses), so a merchant lesson that
  renames a payee moves the whole series with it.
- Family rows: `merchantKey` is the normalised decrypted note's first token
  run plus the category id, joined; absent a note, the category alone with an
  amount band (`round(amount / 50.000)`), the weakest key and the reason RR4
  shows family guesses softly until confirmed.
- `productSig` is the receipt item's `sub|…` signature when present, so Google
  One and YouTube Premium billed through the same Google account are two
  series.

Series are a **view** over rows, computed in `fhRecurSeries(rows)` on device;
nothing is stored per series.

## 9. Pattern detection

> **Superseded by §18.1 and §18.3 (2026-10-07).** The rule below let one
> qualifying pair mark a merchant, and it ran over a five-week window. Kept
> for the record.

`fhRecurDetect(rows)` runs after personal hydrate and after the family
snapshot, in the same deferred slot as the receipt join (`fhReceiptLedgerSoon`
pattern), and again when a row is added or edited. Per candidate key (merchant
key with no period), sort charges by date and look at consecutive gaps:

| Period | Gap window | Amount tolerance |
|---|---|---|
| weekly | 6–8 days | ±10 % of the previous charge |
| monthly | 26–35 days | ±10 % |
| yearly | 350–380 days | ±10 % |

Two qualifying consecutive charges produce `recurrence = period,
recurrence_source = 'pattern'` on the **latest** row, flagged soft in the UI
(the row count of the series is 2). A third confirms (count ≥ 3, no longer
soft). Rows whose `recurrence_source = 'person'` are never written by
detection, and a merchant with a `person`-declined row is skipped entirely.
Detection writes through the normal row patch so the mark syncs like any
field.

## 10. Receipt source and `period`

> **Completed by §18.5 (2026-10-07).** Release 1 built only the first
> sentence's queue-import path. The retroactive attach, receipts read before
> the `period` key existed, and the renewal-word fallback were NOT BUILT until
> detection v2.

When the join (`78-receipt-join.js`) attaches a receipt whose block has
`period`, or whose variant text matches the renewal words (`auto-renewing`,
`subscription`, `gia hạn`, `thuê bao`, `/tháng`, `/năm`), the row gets
`recurrence = period || 'monthly'`, `recurrence_source = 'receipt'`, unless the
row already carries a `person` mark. Items' `sub|…` signature feeds the series
key (§8). A renew date printed in the receipt ("Renews on 6 Nov") is kept in
the blob as `renews_on` and shown as the next date when present.

## 11. Lessons

`24-lessons.js` gains `fhLessonRecur(merchantKey)`,
`fhLessonLearnRecur(merchantKey, period)`, `fhLessonForgetRecur(merchantKey)`,
keyed `recur|<merchantKey>`, encrypted with the other lessons. A receipt mark
or a person's mark teaches; a person's Không forgets. On queue render and on
import, a row whose merchant key has a lesson is pre-marked with
`recurrence_source = 'receipt'` or `'person'` as the lesson records, shown as
"Theo bài học". Lessons never set `pattern`.

## 12. Next date and creep

```
nextDate(series) = series.latest.renews_on || addPeriod(series.latest.date, series.period)
creep(series)    = latest.amount > previous.amount * 1.05 ? latest.amount − previous.amount : 0
```

Both are pure functions over the series view, unit-tested in isolation with
fixed dates. `addPeriod` for monthly clamps to the last day of a shorter
month. The 5 percent floor absorbs exchange-rate drift on USD-billed services
(RR8).

## 13. Tests

- `tools/recur-engine.test.js`: series grouping (no amount in key; product
  splits), detection windows at each boundary, soft vs confirmed, `person`
  precedence and decline, creep at 4.9 / 5.1 percent, `nextDate` month clamp,
  yearly over leap years.
- `tools/receipt-join.test.js`: a receipt with `period` marks the row; a
  renewal variant without `period` marks monthly; a `person` row is untouched.
- `pipeline/receipt-contract.test.js`: `period` sealed (shared with the
  providers spec).
- RPC tests: both insert and patch accept and validate the two fields; a bad
  value is refused by the CHECK.

## 14. Telemetry

None server-side: every signal is on device over encrypted data. The Settings
diagnostics line (local) shows series count, soft count, creep count, for
debugging only.

---

# Part 3 — Build plan

| # | Landing | Files |
|---|---|---|
| M1 | `0157` columns and indexes; RPC and snapshot changes | migration, `0156`-style RPC patch, `19-personal.js` hydrate, family snapshot |
| M2 | Engine: series, detection, next date, creep | `src/js-data/26-recur.js` (new), tests |
| M3 | Receipt source via the join; `period` in the contract (providers L3) | `78-receipt-join.js` |
| M4 | Lessons `recur\|` | `24-lessons.js` |
| M5 | Mark on cards, Định kỳ row in detail and queue, picker sheet, copy | `56-csv-import-ui.js`, `61-expense-detail.js`, `72-txn-review.js`, CSS |
| M6 | Định kỳ tile and sheet, personal then family | `21-personal.js`, family finance view, CSS |
| M7 | Build, SW bump, deploy with providers L9 | AGENT_SYNC |

---

## 15. Decision log

From the design interview, 2026-10-06.

| # | Decision |
|---|---|
| RR1 | **`recurrence` enum (weekly, monthly, yearly, null) plus `recurrence_source` (receipt, pattern, person)**, plaintext columns on both `personal_transactions` and family `transactions`, and inside sealed `raw_extracted` on staged rows. A deliberate plaintext field, recorded in the personal-ledger column table. |
| RR2 | **No next-date column.** Device derives latest date plus period. A renew date a receipt states lives in the encrypted blob and wins on display. |
| RR3 | **Series are a derived view**: merchant key + period + product signature, no amount, no entity, no foreign key. |
| RR4 | **Pattern on device after hydrate.** Two charges mark softly, a third or the person confirms. Windows 6–8 / 26–35 / 350–380 days, ±10 % amount. Family rows key on decrypted note + category + amount band. |
| RR5 | **Teaching through lessons** keyed `recur\|<merchantKey>`, encrypted; a person's Không forgets and blocks re-marking. |
| RR6 | **Surfaces:** Định kỳ row in detail and expanded queue card, picker Không / Hàng tuần / Hàng tháng / Hàng năm with an adjustable next date; mark in the card meta; filter chip. |
| RR7 | **Định kỳ tile beside Đầu tư** with the 30-day list and "mỗi tháng ~X"; sheet lists every series. Family ledgers get the same, consistently. |
| RR8 | **Price creep at > 5 %** over the previous charge in the series, shown on the row and in the sheet, in-app only. |
| RR9 | **No push** in this epic; the generic "có khoản định kỳ ngày mai" reminder waits for the merchant-intelligence release. |
| RR10 | *(2026-10-07, detection v2)* **The engine reads a recurrence slice, not the tab's memory:** 25 months of expense rows with payee, note, node, amount and receipt, fetched in the background, never on the boot path. Amends RR4's "after hydrate". |
| RR11 | **Cadence, not a pair.** A series needs at most one charge per period and most gaps the length of one; a merchant's charges are split by amount first. Weekly needs four charges to be even a guess. |
| RR12 | **Softness counts charges in cadence**, never rows at the merchant. Off a leaf: monthly is a guess at 3 and fact at 4, yearly 2 and 3, weekly 4 and 6. On a recurring leaf: monthly a guess at 2 and fact at 3, yearly fact at 2. Two monthly charges are never fact. Only confirmed series enter "mỗi tháng". |
| RR13 | **Identity is the payee**, then a recurring leaf of the tree, then an exact amount. The category leaves the key. Amends RR3: a series' key is the grouping key plus period plus product, still with no amount for payee and leaf series. |
| RR14 | **The tree knows what recurs.** A short list of leaves carries `recurs` (and `recurs_var` for bills whose amount moves). It is a hint and a lower threshold, never a stored mark, and a single charge on such a leaf is hinted on its own row only. |
| RR15 | **Receipts mark rows wherever they attach**, and wording counts: `period`, else the service type, else renewal words in the item's own text. Rows that already carry a receipt are marked by the pass. |
| RR16 | **The queue card asks the ledger:** a candidate that continues a series shows its period, "Theo các kỳ trước". A soft series or a leaf hint shows "Có vẻ", and is not stored on import. |
| RR17 | **A pattern mark is derived, never trusted.** Only a person's or a receipt's mark anchors a merchant. Each run re-derives pattern marks, writes the latest row of a confirmed series, and clears a `pattern` mark no series explains. |
| RR18 | **One truth.** Tile, sheet, detail row and queue card read the same series view. The stored column is the durable trace of it, not a second opinion. |
| RR21 | *(2026-10-07)* **Tile 3 "Vòng tháng", sheet 5 "Thuê bao"** chosen from sixteen rendered directions (`mockups/recurring-options.html`); the ring is the daily-guide ring reused, the sheet is the iPhone Subscriptions language with a countdown on this month's rows. Eight ring variants are in the same file for the next round. |
| RR20 | *(2026-10-07)* **"Sắp tới" is this month.** The tile and the sheet's first group show the confirmed charges still expected before the month ends, with their sum ("Còn 2 khoản tháng này · 3.058.000 ₫"). When none is left, the view rolls to next month and says so ("Tháng 11: 4 khoản"). Replaces the rolling 30-day horizon of RR7. |
| RR19 | **A series that stops, lapses.** More than one full period overdue and it leaves the tile, the upcoming list and the monthly total. Its rows keep their history. |

## 17. Release-1 cuts (2026-10-06)

| Cut | Why | Returns |
|---|---|---|
| Leaf naming for payee-less bank strings ("Tiền thuê nhà" for "6209991888 - NGUYEN VINH") | Shown in the mockups; needs a rule for when a leaf name beats the payee, and the detail screen must say which it chose. | Next round |
| No hand-set next date ("Kỳ tới" picker) | It needs a place to live that is neither a clear column (RR2) nor the receipt blob; the note block was the candidate and deserves its own small design. | Merchant-intelligence epic |
| No filter chip on the list | The mark on the card and the tile cover the reading need; a chip is a list-filter change across both ledgers' lists. | Same |
| Queue-wide detection | Twelve rent payments all waiting in the queue, none in the ledger, show Không on their cards; the pass marks them after import (§18.9). | Merchant-intelligence epic |
| Apple keeps its own reader | Two layouts and storefront sections; the registry carries its labels so folding it into the family walk is a data change later. | Providers release 2 |

## 16. Related documents

- `receipt-providers-spec.md` §12 (`period`), `receipt-enrichment-spec.md` §11
  (the join that applies the receipt mark).
- `personal-ledger-spec.md`, `full-ledger-spec.md`: the rows and their RPCs.
- `apply-to-similar-spec.md`, `carry-rules-spec.md`: lesson mechanics reused.
- `habit-streak-spec.md` §15: the parked epic this unblocks.

---

## 18. Detection v2 (2026-10-07)

The answer to `docs/incidents/2026-10-06-recurring-detection.md`. Five causes,
one section each, then the pieces that follow from them.

### 18.1 What the engine reads (RR10)

`fhPersonalRecurRows()` in `19-personal.js` returns the personal ledger's
expense rows for the last **760 days** as
`{ id, date, amt, payee, note, node, recur, recurSrc, rcPeriod, recurSig, renewsOn }`:

- **The recent part** is `P.txns` itself. The tab hydrate now decrypts
  `counterparty_enc` into `payee` (one more field on the ~80 rows it already
  holds; the name is new so that nothing which reads `who`, `cp` or `_cp`
  changes meaning: apply-to-similar A15).
- **The older part** is one query for rows before `_winFrom()`, decrypted once
  and cached for the session. It is dropped when a write touches a row in it,
  when an import adds a row older than the window, and after ten minutes.
- **Receipts:** rows that carry `receipt_enc` have the blob read into
  `rcPeriod`, `recurSig` and `renewsOn` (§18.5). There are few of them (22 of
  723 on the first real ledger).

It is called from the deferred slot after hydrate and when the review opens,
never awaited by a paint. 760 days is what lets two yearly charges be seen for
a year after the second.

The family ledger already holds full history in `window.txns` (the first
hydrate of a session is never windowed), so it needs no slice.

### 18.2 Who a charge was paid to (RR13)

A row is offered to three groupings, in this order, and belongs to the first
series that claims it:

| Pass | Key | When |
|---|---|---|
| A | `p\|<payee>`, folded (case, diacritics, punctuation) | the row has a payee. Else `n\|<first three words of the note>`, but only for a row that is NOT on a recurring leaf: family rows and hand-typed personal rows |
| B | `k\|<leaf>` | the row has NO payee and its node (or an ancestor) carries `recurs` (§18.4). Such a row comes here before its note is ever used: the note is free text, and rent paid with new wording each month must not be split by it. Rows that have a payee never enter this pass, or two purchases from two software vendors would chain into one "subscription" |
| C | `a\|<exact amount>` | the row is unclaimed and has no payee. Monthly or yearly only, three charges, every gap in cadence, always soft until a person confirms |

Inside a pass-A or pass-B group the charges are first **split by amount**:
sorted by date, each joins the cluster whose latest amount is within 25
percent, else starts one. Two subscriptions billed by one payee (Apple:
YouTube and iCloud) become two series; a price rise up to 25 percent stays in
one, which is what lets §12's creep flag see it. When most of the group sits
on a `recurs_var` leaf (electricity, water) the split is skipped: the amount
is expected to move.

The category is in no key. A row recategorised from Khác to Nhà ở stays in
its series.

### 18.3 Cadence (RR11, RR12)

For a cluster of `n` charges with `G = n − 1` gaps, and a period with window
`[lo, hi]`:

| Gap | Called | Monthly | Weekly | Yearly |
|---|---|---|---|---|
| `lo … hi` | fit | 25–37 d | 6–8 d | 350–380 d |
| `2·lo … 2·hi` | skip (one missed cycle) | 50–74 d | 12–16 d | 700–760 d |
| `< lo` | short | | | |

The cluster is in cadence for that period when **all** hold:

1. at least one fit;
2. short gaps are at most a fifth of the gaps (`short ≤ ⌊0.2·G⌋`), so with
   up to five gaps none may be short: *at most one charge per period*;
3. fits and skips are at least three fifths of the gaps.

The period with the most fits wins; a tie goes to monthly.
`inCadence = fits + 1`.

| | A guess from | Confirmed from | On a recurring leaf: guess / confirmed |
|---|---|---|---|
| Monthly | 3 | 4 | 2 / 3 |
| Yearly | 2 | 3 | 2 / 2 |
| Weekly | 4 | 6 | 4 / 6 |

Below "a guess from" there is no series. Between the two it is **soft**: "Có
vẻ", outside the monthly total, never stored. Softness is `inCadence`
against the table, and has nothing to do with how many rows the merchant has.

Why monthly starts at three off a leaf: two charges a month apart at a
similar amount describe any shop visited twice, and a year of history is full
of such pairs. A guess tier that fires on them would refill the tile with the
noise this section exists to remove. On a leaf the tree has already said what
kind of charge it is (rent, a bill, a subscription), so two are a guess and
three are fact. Two monthly charges are never fact anywhere: two film rentals
a month apart sit on the streaming leaf as well. A new subscription on no
leaf is seen at its third charge; its receipt, or the person, says so sooner.

The coffee shop from the incident: gaps 2, 1, 4, 1, 0, 7. Five short of six.
Rule 2 fails for every period. No series.

Known limit: a habit that really is weekly (the same coffee every Saturday for
six weeks) is in cadence and will be shown, first as a guess. Không ends it.

### 18.4 What the tree already knows (RR14)

`taxonomy/taxonomy.json` nodes may carry `recurs: "monthly" | "yearly"` and
`recurs_var: true`. `FH_TAX.recursOf(code)` answers from the node or its
nearest ancestor.

| Leaf | `recurs` | `recurs_var` |
|---|---|---|
| `rentpay` Tiền thuê nhà, `mgmt` Phí quản lý & chung cư | monthly | |
| `electric` Tiền điện, `waterbill` Tiền nước | monthly | yes |
| `internet` Internet & wifi | monthly | |
| `streaming` Streaming & thuê bao số, `software` Phần mềm & công cụ | monthly | |
| `tuition` Học phí trường | monthly | yes |
| `insurance` Bảo hiểm | yearly | yes |

Deliberately absent: `mobile` (top-ups are not charges that come back), `gym`
(a class pack is not a membership), anything under food or transport.

What the hint does, and all it does:

- opens pass B (§18.2) for payee-less rows and waives the amount split for `recurs_var` leaves;
- lowers both thresholds by one charge (§18.3);
- on a row whose charge is in no series yet, shows "Có vẻ hàng tháng" on that
  row's Định kỳ line, in the detail and on the queue card. Not in the tile.

It is never written to `recurrence`. A one-off software purchase is hinted and
nothing more; Không on it is one tap and teaches the merchant.

The two attributes are emitted to the client target only. The worker's and the
Python reader's taxonomy files stay byte-identical, so no function redeploys
for a client-side hint, and the tree's `version` does not move (no
classification changes).

### 18.5 Receipts (RR15, completes §10)

`FH_RECUR.receiptMeta(blob)` reads a decrypted receipt blob into
`{ period, sig, renewsOn }`:

1. `blob.period` (`month | year | week`) when the reader set it;
2. else `service_type === 'subscription'` reads monthly;
3. else renewal words in the items' names and variants: "(Monthly)",
   "Auto-renewing", "Renews", "subscription", "gia hạn", "thuê bao",
   "/tháng" read monthly; "(Yearly)", "Annual", "/year", "/năm" read yearly;
4. `sig` is the first item's `sub|…` signature; `renewsOn` is a date after
   "Renews" when one parses.

Where it is applied:

- **the pass** (§18.6) marks any row whose receipt reads a period and which
  carries no mark: `receipt`. This covers receipts attached to ledger rows
  after import, and every receipt read before the `period` key existed;
- **queue import**, as in release 1, now through `receiptMeta` so wording
  counts there too.

A receipt-marked row anchors its payee's series at one charge.

### 18.6 The pass: what is written, what is cleared (RR17)

`fhRecurRunPersonal()` and `fhRecurRunFamily()` analyse, then reconcile the
stored column with the view:

| Row | Write |
|---|---|
| latest row of a **confirmed** pattern series, unmarked | `pattern` |
| a row whose receipt reads a period, unmarked | `receipt` |
| a row marked `pattern` that is in no series | cleared |

Nothing else. A soft series writes nothing. A `person` mark is never touched.
A `pattern` mark never anchors a merchant: only `person`, `receipt` and a
lesson do. That is what makes the third row safe, and it is what removes the
incident's one wrong mark without a migration.

Personal writes go in one `personal_txn_patch` call. Family writes go row by
row (`fhTxnBulkPatch`), which is why only the latest row of a series is
marked: a family of four devices must not exchange forty realtime updates
about a label.

### 18.7 One view (RR18, RR19)

`FH_RECUR.analyse(rows, today, opts)` returns `{ series, patches, byRow }`.
`opts` carries `lesson(key)`, `declined(key)` and `prior(node)`, so the engine
stays a pure function. A series:

```
{ key, groupKey, period, source: 'person'|'receipt'|'lesson'|'pattern',
  soft, lapsed, inCadence, rows, latest, previous, amount, next, dueInDays,
  creep, perMonth, name, product, node }
```

- **Detail row** (both ledgers): the series the row belongs to; else its
  stored mark; else the leaf hint; else Không.
- **Tile and sheet:** series that are not lapsed. Soft ones are listed under
  "Có vẻ định kỳ" with **Đúng rồi** and **Không**, and stay out of the total.
- **Lapsed:** `dueInDays` below minus one full period (monthly −37, weekly −8,
  yearly −380). The rows keep "Hàng tháng"; the tile forgets them.

Đúng rồi and Không write a `person` mark on the series' latest row and teach
or forget the lesson under `groupKey`, so the answer covers the series and
every later charge.

### 18.8 The queue card (RR16)

`FH_RECUR.matchCandidate(series, cand, opts)` takes
`{ payee, note, amt, node, date }` and returns the first that applies:

| Order | Source | Card shows |
|---|---|---|
| 1 | the person's pick on the card | the pick |
| 2 | the joined receipt (`receiptMeta`) | "Theo hoá đơn" |
| 3 | a series in the ledger with the candidate's key, an amount in its cluster, and a date one period (or one skipped period) from one of its charges | "Theo các kỳ trước"; "Có vẻ" when the series is soft |
| 4 | a merchant lesson | "Theo bài học" |
| 5 | the leaf hint | "Có vẻ hàng tháng" |

On import, 1, 2 and 4 are stored as before; 3 is stored as `pattern` only
when the series is confirmed; a soft 3 and 5 are not stored. The pass decides
later with the row in the ledger.

Amounts: a candidate is in đồng, the ledger in base units; the card converts
with `curMult()` before asking.

### 18.9 Limits

- **A queue with no ledger behind it.** After a reset and a year-long
  re-read, hundreds of rows wait and none is booked. Their cards show Không
  or a leaf hint; the pass marks the series after import. Analysing the queue
  with the ledger is the natural next step and is not built.
- **Fortnightly and quarterly** charges are not periods. A quarterly charge
  reads as nothing; the person's mark is the way.
- **A price rise above 25 percent** starts a new series beside the old one,
  which then lapses.
- **Pass C** can pair unrelated hand-typed rows of the same amount that happen
  to fall a month apart three times. It is soft by rule for that reason.

### 18.10 Tests

`tools/recur-engine.test.js`, rewritten around the incident:

- the coffee shop, seven visits, one weekly pair: no series, and a stored
  `pattern` mark on it is cleared;
- rent whose wording and category change: one series through the leaf;
- the same charges through a five-week window and through the slice;
- two subscriptions from one payee, different amounts: two series;
- electricity with a 40 percent swing on a `recurs_var` leaf: one series;
- softness from charges in cadence; thresholds with and without a leaf;
- skip (one missed month), lapse, creep, yearly over 25 months;
- `person` precedence and decline, lessons anchoring and blocking;
- `receiptMeta` over the YouTube and Google Play blob shapes;
- `matchCandidate`: continues a series, wrong amount, wrong date, leaf hint.

`tools/recur-flow.test.js` runs the real engine, tile, tree and the queue
card's functions together over the incident's ledger: the pass over a complete
slice (four writes, one of them the clear), over an incomplete one (no
writes), the tile's wording and total, the detail row on an old rent row, the
queue card for October's rent, and Đúng rồi / Không on a guess. It also
covers the family ledger: electricity with drifting notes and amounts gathers
through its leaf, and only the latest row is written.

`tools/taxonomy-recurs.test.js`: the nine leaves, `recursOf` on the client
with inheritance, and the worker and Python targets carrying neither key.

---

# Part 4 — Release notes

**2026-10-06 — Live with receipt providers release 1.** `0157` adds
`recurrence` / `recurrence_source` to both ledgers and widens
`personal_txn_patch`; engine `29-recur.js` + `tools/recur-engine.test.js`;
Định kỳ row on both detail screens and the queue card (pick saves at once);
mark on cards; tile and sheet in Tài chính and on the home tab; lessons
`recur|<merchantKey>`. Cuts in §17 (no hand-set next date, no filter chip).

**2026-10-07 — Detection v2 (§18) and the UI pass, SW `v616`.** Client only:
no migration, no function deploy (`taxonomy.mjs` byte-identical). Fixes the
incident of 2026-10-06 (`docs/incidents/2026-10-06-recurring-detection.md`):
760-day recurrence slice, cadence rule, payee identity, derived pattern marks
that clear themselves, receipts mark wherever they attach, the queue card
asks the ledger, one view for tile, detail and card. §3 rewritten to the
screens as shipped (rendered and checked against DESIGN.md before release).
First check after release: the 2026-09-17 mark is cleared and rent, Anthropic
and YouTube Premium are marked.
