# Recurring Charges: knowing which spending comes back

A Google One renewal, a Netflix month, the gym, electricity. Each is a row like
any other in the ledger today, and the ledger has no idea it will happen again
on the 6th. This spec gives a transaction a **recurrence**: how often it comes
back and how we know, so the app can show what is coming, total what the
family pays every month without thinking, and notice when a subscription
quietly costs more than it did last time.

> **Status, 2026-10-06 (evening).** BUILT with `receipt-providers-spec.md`
> release 1, not yet deployed (`0157` written, SW `v615` built). Decisions
> RR1–RR9 (§15) from the design interview of 2026-10-06. This unblocks the
> "merchant intelligence" epic that `habit-streak-spec.md` §15 parked.
> Two deliberate release-1 cuts, recorded in §17: no hand-set next date, and
> no filter chip yet.

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
- A **pattern** is two or more charges from the same merchant, amounts within
  10 percent, spaced like a period. Two charges show as a soft guess; a third,
  or the person, confirms.
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

A small "Định kỳ" tag in the card's meta line, next to the receipt glyph
where one exists: `Định kỳ · hàng tháng`. On a pattern of only two charges it
reads `Có vẻ định kỳ · hàng tháng` in the soft text colour. When the latest
charge in a series is more than 5 percent above the previous one, the amount
carries a trailing `↑ 40.000` in `--warn`; the detail row says `Tăng 40.000
so với kỳ trước`. House rules: SVG glyph if any, no emoji, `fmt()` for every
figure, tokens only.

### 3.2 The row in the detail screen and the expanded queue card

A **Định kỳ** row in the same row language as Danh mục and Ngày:

```
Định kỳ                    Hàng tháng · kỳ tới 6/11  ›
```

Tapping opens the shared choices sheet with four options, Không / Hàng tuần
/ Hàng tháng / Hàng năm. A pick **writes at once** (the Loại khoản precedent:
"Chọn xong là lưu ngay"), through the ledger's own door, and teaches the
merchant. Choosing Không on a receipt-marked or pattern-marked row sets
`recurrence_source = 'person'` with `recurrence = null`, which the engine
reads as "asked and declined": no pattern re-marks it, and the lesson for the
merchant is forgotten (RR5). The soft "Có vẻ" guess has one more button in the
sheet: **Đúng rồi, hàng tháng**, which confirms the period as `person`. The
next date is derived (RR2) and not editable in release 1 (§17).

Queue rows carry the same row; a value from a lesson reads "Theo bài học",
from the receipt "Theo hoá đơn", with the usual provenance styling.

### 3.3 The Định kỳ tile and sheet

In Tài Chính, a bento tile beside Đầu tư:

```
ĐỊNH KỲ
3 khoản trong 30 ngày tới           ~1.280.000 / tháng
Google One · 6/11 · 50.000
Netflix · 12/11 · 220.000  ↑ 40.000
Gym · 15/11 · 1.010.000
```

The sheet opens on the same list, then every series grouped by period, each
with merchant, product when a receipt gave one, amount of the latest charge,
next date, charges count, and the creep flag. A series row opens the latest
transaction. "Mỗi tháng ~X" is the sum of monthly amounts plus yearly over
twelve plus weekly times 52 over 12, computed on device from decrypted
amounts (amounts are ciphertext on the server, §7). Family tab: the same tile
in the family finance view, over family rows, same engine.

Empty states: no series yet reads "Chưa có khoản định kỳ nào. Khi một khoản
lặp lại, nó sẽ hiện ở đây." A single soft guess reads "Có vẻ Netflix lặp lại
hàng tháng. Đúng không?" with Đúng rồi / Không.

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
and the family write path accept the two fields. `get_family_snapshot` and the
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

## 17. Release-1 cuts (2026-10-06)

| Cut | Why | Returns |
|---|---|---|
| No hand-set next date ("Kỳ tới" picker) | It needs a place to live that is neither a clear column (RR2) nor the receipt blob; the note block was the candidate and deserves its own small design. | Merchant-intelligence epic |
| No filter chip on the list | The mark on the card and the tile cover the reading need; a chip is a list-filter change across both ledgers' lists. | Same |
| Apple keeps its own reader | Two layouts and storefront sections; the registry carries its labels so folding it into the family walk is a data change later. | Providers release 2 |

## 16. Related documents

- `receipt-providers-spec.md` §12 (`period`), `receipt-enrichment-spec.md` §11
  (the join that applies the receipt mark).
- `personal-ledger-spec.md`, `full-ledger-spec.md`: the rows and their RPCs.
- `apply-to-similar-spec.md`, `carry-rules-spec.md`: lesson mechanics reused.
- `habit-streak-spec.md` §15: the parked epic this unblocks.

---

# Part 4 — Release notes

_(empty until the first deploy)_
