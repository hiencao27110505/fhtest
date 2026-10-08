# Incident: a film rental was shown as the YouTube Premium subscription

| | |
|---|---|
| Date | 2026-10-09, found by Hien on the test account |
| Feature | Recurring charges, detection v2 (`recurring-charges-spec.md` §18) |
| Severity | Low for data, high for trust. Four figures on screen were wrong. Nothing wrong was written. |
| Status | Root causes confirmed by replay on the real engine the same day. Resolution specified in `recurring-charges-spec.md` §19 (detection v3) and built (SW v623, client only). |
| Found by | Hien, opening the Định kỳ sheet and tapping YouTube Premium |

## What happened

The Định kỳ sheet showed **YouTube Premium · 88.000 ₫ · 20/10**. Tapping it
opened an 88.000 ₫ charge of 20 September titled "The Pursuit of Happyness
+1 món": two films rented through Apple. That row's own screen said
"Định kỳ: Hàng tháng · Kỳ tới 20/10".

The real subscription is 105.000 ₫ on the 16th of every month, billed
through Apple, with a receipt each month.

## Impact

| Shown | True |
|---|---|
| YouTube Premium, 88.000 ₫ | 105.000 ₫ |
| Next charge 20/10 | 16/10 |
| A tap opens the film rental | September's YouTube charge |
| "mỗi tháng" 17.000 ₫ too low | |
| The rental's screen says it recurs monthly | It does not |

| | |
|---|---|
| Accounts | One (the test account) |
| Wrong marks written | **None.** Checked on the plaintext columns: the 20 September row has `recurrence` NULL. The sixteen marked rows are the real monthly and yearly charges. |
| Money, dates, categories | Untouched |
| Cleanup needed | None. The wrong link lived only in the derived view. |

## Root causes

Replayed on the real engine with the real row shapes (eleven 105 charges on
the 16th, three 39 rentals, one 88 rental four days after September's
charge): with the rental the series reads 88 / 20 October / opens the rental;
without it, 105 / 16 October.

### 1. Apple is a biller, not a seller

v2 says identity is the payee (§18.2). Every Apple purchase carries the same
payee string, `APPLE.COM/BILL`: a subscription, a film, an app. The engine
gathered them all as "one merchant". The same is true of Google Play and of a
payment rail printed with no merchant beside it.

### 2. Inside a payee, only the amount separated two things

Rows within 25% of each other were one subscription (`CLUSTER_TOL`, there to
let a price rise stay one series). 88 against 105 is 16%.

### 3. A series backed by a receipt never checked timing

Once one row in an amount band carried a subscription receipt, the band was a
series, and every other row in it a member. The rental came four days after
the real charge. No monthly plan charges twice in four days. The cadence rule
that would have refused it applied only to series found by pattern.

### 4. Receipts were read only as evidence FOR a subscription

The rental has its own receipt: two films, no renewal wording, a
`store|apple tv|movie rental` signature. That is evidence against membership
and nothing read it. The spec's own series key (RR3) includes the product; the
code appended the product to the key after grouping and never grouped by it.

### 5. A series described itself from its newest row

Amount, next date and tap target all came from the newest member, and the name
from whichever member had a label. One foreign row, if newest, therefore
replaced three of the four things on the line and kept the fourth.

### Contributing

- The test for "a rental is not in a series" used a 49 rental against a 105
  subscription. Nothing tested a rental close in price.
- The queue card asked the same loose question: a new 88 Apple purchase a
  month after any charge would have been offered as "Định kỳ · Hàng tháng".

## What went well

- The stored column held. v2's rule that a `pattern` mark is derived and a
  receipt mark is written only on the row that carries the receipt (§18.6)
  meant the wrong link was never persisted.
- The corpus of parsed mail kept under `research/statements/` gave the real
  charge history in minutes, with no decryption.

## Resolution

Detection v3, `recurring-charges-spec.md` §19:

1. **The product is the identity** when a receipt names one. Rows of one
   payee are split by product before any amount is compared. A row whose own
   receipt says "not a renewal" never joins a renewal.
2. **Membership is timed.** A row with no proof joins a proven series only in
   an empty slot of its cadence, within 10% of its neighbour. No series keeps
   two charges inside one period.
3. **A biller is not a seller.** Billers are data (`taxonomy/brands.json`).
   Under one, a series needs a product, or one exact amount in step, and a
   pattern stays a question for the person.
4. **A series is described by its proof**: the newest row with a receipt or a
   person's word gives the amount, the name and the row a tap opens.

The queue card asks the same four questions.

## Follow-ups

| | |
|---|---|
| A per-row "Không thuộc khoản này" control | Not built. Approach 4's second half; the person can still say Không on the row's Định kỳ picker. |
| Billers beyond the list | An unlisted biller still behaves as a seller, protected only by rules 1 and 2. Add to `billers` when one is seen. |
| First check after release | The sheet reads YouTube Premium · 105.000 ₫ · 16/10, and the 20 September rental's screen shows Định kỳ: Không. |
