# Statement balance: a statement sets the account, the ledger brings it to today

A bank statement prints what the setup wizard asks a person to type: the balance,
and for a card the credit limit, the statement day and the due day. This spec makes
the statement the source of those facts. The closing balance becomes a dated
starting point for the account, and the rows the ledger holds beyond the statement
bring it forward to today.

> **Status, 2026-10-10. BUILT and PUSHED to `main` the same day** (built in
> worktree `.worktrees/statement-balance`, on top of statement-auto, S30 to S32).
> Client plus one additive migration, `0160_anchor_meta`, **applied live
> 2026-10-10** (first written as 0159, a number another session took the same
> afternoon). SW `v627`. No Edge Function change. Decisions SB1 to SB16 below; SB6 and SB10 are
> recommendations Hien accepted by saying "spec and then build" and can still
> reverse. Guard: `tools/statement-balance.test.js` (87 checks). Screens:
> `tools/ui-harness/manifests/statement-balance.js`. **Not yet run on a phone, and
> not yet run against a real mailbox**: the first real statement opened after this
> release is the first real test.

> **Siblings.** `statement-capture-spec.md` owns how a statement file becomes
> review rows; this spec replaces its S10 hand-off ("the running balance feeds the
> existing drift detector"). `account-setup-spec.md` owns the wizard and the rule
> that an account shows a number only after the person has given one; SB6 amends
> that rule. `full-ledger-spec.md` §5 owns the anchor model this extends.

---

# Part 1. Behaviour

## 1. The problem, measured

Three real statements were read with the app's own parser (2026-10-10):

| Statement | Printed in the file | Used before this spec |
|---|---|---|
| Bank account | Opening and closing balance, a running balance on every row, period, print date | Closing balance checked the column reading and was then dropped |
| Wallet | Balance after every row, to the second | Stored per row, used only by the drift badge |
| Credit card | Credit limit, statement date, due date, minimum payment, previous and closing debt, auto-debit account | Closing debt checked the reading; the other five were never read |

And the person was still asked to type every one of them:

- The wizard opened blank. The row balance was saved as the "bank-stated balance"
  at import, and nothing read it for an account with no anchor.
- Cards were skipped: the recorder returned early for a credit card.
- The saved balance depended on which rows were imported. A row set aside as "Đã
  có trong sổ" never recorded its balance.
- Bank alert mail does not carry it. 0 of 917 alert mails from two banks print
  "Số dư".

## 2. What a statement balance is

**A statement balance is true for a date in the past.** The anchor of
`full-ledger-spec.md` §5.1 means "true now: every row before this moment is
already inside". Typing a closing balance of 27/04 into today's wizard would
silently drop every row recorded since.

So an anchor can now carry its own date:

```
today's balance = statement balance (as of its last day)
                + every ledger row on this account that the statement does not contain
```

"Does not contain" is decided by three rules, in order:

1. A row dated **after** the statement's last day is added.
2. A row dated **before the edge window** is inside the statement balance, whether
   or not the ledger agrees with the file. The statement is the authority for its
   own period.
3. A row **in the edge window** is inside only when it matches a row of the file
   (same day, same amount). Otherwise it is added.

The edge window is the statement's last day for a bank account or a wallet (a
statement exported at noon misses the afternoon), and the last five days for a
card (a purchase dated before the statement date can post after it, and then
belongs to the next statement).

One exception to "same amount": a ledger row whose note says its amount is an
estimate (`est.`, the foreign-currency marker) matches a file row of the same day
within 6%. The bank's settled figure differs from the estimate, and counting both
would double the purchase.

## 3. Which number is taken from the file

| Kind | Number | As of | Believed when |
|---|---|---|---|
| Bank account | "Số dư cuối kỳ" | The period's last day, or the last row's day | The reading is proved, and the closing balance equals the last row's running balance when both exist |
| Wallet | The balance after the last row that sits on the proved chain | That row's day | The running-balance proof passed and no more than two rows trail the chain |
| Credit card | "Dư nợ cuối kỳ", stored negative | The statement date, or the last row's day | The totals proof passed |

The newest row is not always the balance. One real wallet statement ends on a row
from another pocket that shows 0 ₫, two days after the row that shows the real
3.003.878 ₫. The chain rule takes the second.

When the file's own numbers disagree, no number is taken. The rows still go to
the queue as before.

## 4. First time, and every time after

**An account with no number yet.** The statement's number waits on the account as
an offer. Nothing is shown as a balance. The tile says "Xác nhận số từ sao kê",
and the setup wizard opens already filled:

- the number, on a row labelled "Số dư" or "Dư nợ" (not "hiện tại", which would be
  untrue beside a past date), with the line "Theo sao kê 27/04" under it;
- for a card: hạn mức, ngày chốt sao kê and ngày đến hạn, read from the file;
- the note under the rows: "Số này đúng vào ngày 27/04. Khoản ghi sau ngày đó cộng
  trừ tiếp lên nó."

One tap on Xong keeps the statement's number with its date. Typing another number
is still allowed and is treated as before: true now.

**An account the person has confirmed once.** A later statement moves the starting
point by itself, with no question. This holds for a number that was typed and for
one that came from a statement.

**Never backwards.** A statement replaces the current starting point only when its
date is later. An old statement opened from "Sao kê cũ" changes nothing on an
account that already has a newer one, and a number typed after the statement's
last day stays.

**Card facts do not age.** Hạn mức, ngày chốt and ngày đến hạn are filled whenever
the field is empty, from any statement, old or new. A value the person typed is
never overwritten. The statement's due date and minimum payment feed the tile line
"Đến hạn 25/09 · tối thiểu 50.000 ₫" that card notices already feed.

## 5. What the tile says

A statement can be weeks old, and the rows after it reach the ledger unevenly.
Measured on the same three statements, bank alert mail had covered 84% of the
account's rows but only 55% of its money (incoming payments were missing), and
none of the wallet's. So the tile says how it knows:

| Situation | Headline | Lines under it |
|---|---|---|
| No row after the statement | The statement number | "theo sao kê 27/04" |
| Rows after it, and the ledger had already known at least 95% of the statement's money | Statement number plus those rows | "theo sao kê 27/04", then "+ 12 khoản sau đó" |
| Rows after it, coverage below that | The statement number | "đến 27/04", then "sau đó −4.2tr ₫" |

The second fact has its own line on purpose: a tile is half a phone wide, and a
caption left to wrap broke between a figure and its ₫.

Coverage is measured from the statement itself: each row of the file is looked up
in the ledger by day and amount, and rows that entered the ledger from a statement
do not count. It is recomputed whenever the tile is drawn, so it rises as waiting
rows are imported.

The account screen shows both figures in every case: "Theo sao kê 28/09:
48.200.000 ₫. Sau đó 3 khoản đã ghi: −1.815.000 ₫." On a card the second figure is
said as debt (a purchase adds to it), and under low coverage the sentence ends
"Có thể còn khoản chưa ghi, sao kê mới sẽ cập nhật lại." Totals ("Tôi nợ", "Được
nợ") always use the brought-forward figure: it is the best estimate the app has,
and a card's known purchases are debt whether or not the picture is complete.

**Replayed on the real account statement.** The file was cut at three days,
anchored on that day's balance, and brought forward to the day the bank printed
its own closing figure:

| Cut | Rows after, fed completely | Rows after, fed by the alert mail actually captured |
|---|---|---|
| 15/02 | Equal to the bank's figure, to the đồng | 136 million short; coverage 49%, so the tile leads with the dated number |
| 10/03 | Equal, to the đồng | 64 million short; coverage 40%, dated number |
| 01/04 | Equal, to the đồng | 70 million short; coverage 41%, dated number |

The rule is exact when the ledger is complete, and when it is not the coverage
figure catches it. (The mail feed here is the 20/09 reader's, which read almost
no incoming money. The gap is that reader's, and it is what coverage is for.)

## 6. What does not change

- Nothing imports by itself. A statement's rows still wait in the review queue.
- A typed number still means "true now", and still clears the bank-stated balance.
- An account with no number shows no number. An offer is not a balance.
- The drift badge keeps its two resolutions. It now compares the bank's figure with
  the ledger's figure for the same day (SB13).
- "Cập nhật dư nợ thực tế" on a card still books a dated adjustment on top.

## 7. Failure modes

| Case | Result |
|---|---|
| The statement's rows are already in the ledger, all of them | The balance is taken anyway: it comes from the file, not from the import |
| A statement older than the current starting point | Card facts fill empty fields; the balance is ignored |
| The file's closing balance and its last row disagree | No balance from this file |
| A transaction after the statement never reached the ledger | The figure is off by that amount. Low coverage shows the dated number; the next statement corrects it |
| A row on the edge was hand-logged with a rounded amount | It does not match the file and is counted once too often, until the next statement |
| The person's personal ledger is locked when the statement is read | Nothing is written; the rows stage as before and the next statement carries the facts |
| A client older than this release reads a statement anchor | It reads the date as "typed at the end of that day": correct after the last day, and it may count that day's rows twice |
| A database without the `0160` column (it was applied before the client shipped, so this is the safety net, not the plan) | The account read falls back to the old column list; the feature is dormant and nothing else changes |

---

# Part 2. Technical appendix

## 8. Data model: migration 0160

```sql
alter table public.personal_accounts
  add column if not exists anchor_meta_enc text;
```

One nullable column, personal-DEK ciphertext, covered by the table's existing
owner-only policy. It holds a JSON object:

```
{ v: 1, src: 'stmt',
  state: 'offer' | 'set',
  k:     <balance in base units, asset view: a card's debt is negative>,
  sid:   <statement_files.id>,
  asof:  'YYYY-MM-DD',      // the last day the balance is true for
  from:  'YYYY-MM-DD',      // start of the statement's period
  open:  1 | 5,             // days in the edge window, counted back from asof
  how:   'closing' | 'chain' | 'debt',
  rows:  [['YYYY-MM-DD', <signed đồng>], ...]   // the file's rows, newest 400
}
```

- `state: 'offer'`: `anchor_balance_enc` is still null; `k` is what the wizard
  pre-fills. `state: 'set'`: `anchor_balance_enc` holds `k` and `anchor_at` is the
  end of the as-of day (`asof` 23:59:59 +07:00).
- A typed anchor writes `anchor_meta_enc = null`. That is how the two are told
  apart.
- `rows` are amounts and days only, no words. They serve the edge match and the
  coverage figure, and sit inside the same key as the ledger they describe.
- The column joins the `fhPersonalRegen` sweep. A sealed column missing from that
  sweep is lost on a card regeneration.

No value class leaves the device that did not before. Nothing new is plaintext.

## 9. Module map

| File | Change |
|---|---|
| `src/js-ui/59-statement-table.js` | Summary reader learns credit limit, statement date, due date, minimum payment, auto-debit tail. New pure `fhStmtAccountFacts(parsed, kind)` |
| `src/js-ui/19-anchor.js` (new, pure) | `fhAnchorWalk` (the three rules), `fhAnchorDecide` (offer, set, keep), `fhAnchorCoverage`, `fhAnchorView` (which number the tile leads with) |
| `src/js-data/19-personal.js` | Hydrate reads and decrypts the column, tolerant of its absence; `fhPersonalBalance(id, upto)` runs the walk; `fhPersonalAcctView`; `fhPersonalStmtFacts` applies a statement's facts; `fhPersonalAccountUpdate` takes `anchorAt` and `anchorMeta`; regen sweep; signature |
| `src/js-data/77-statement-capture.js` | `_stmWrite` hands the facts over after the rows are staged, in both the tap flow and the unattended one |
| `src/js-data/72-txn-review.js` | `_recBal` skips statement rows; `fhAcctNoticeSet` lets a statement feed the card tile line |
| `src/js-data/23-debts-ui.js` | Wizard pre-fill and the "Theo sao kê" line; tile and account-screen captions |
| `src/js-ui/61-expense-detail.js` | `_exdRow` takes an optional `by`: one quiet line under a row's value, in the review card's `.rl-col` / `.rcr-by` shape. Rows that pass none are unchanged |

`19-anchor.js` and the facts reader are pure and run under Node:
`tools/statement-balance.test.js` runs them against the three synthetic statement
layouts and guards the wiring by source shape. Each rule was broken once on
purpose to see a check fail. `tools/account-setup.test.js` had one guard re-pinned:
the drift rule now asks `fhAnchorAsof` for the anchor's day.

## 10. The walk

`fhAnchorWalk(acct, rows, opts)` returns `{ bal, base, later: { n, sum } }`.
`rows` are the account's ledger rows (`P.debts`, which holds every account-tagged
row of every month, not the tab's two-month window).

- Contribution of a row, in base units: `expense` and `loan` subtract, every other
  kind adds. The sign of a transfer leg, a repayment and an investment leg is
  inside the amount already (0105, 0109, 0122, 0123).
- Typed anchor (no meta, or meta not `set`): the rule of `full-ledger-spec.md`
  §5.1, unchanged.
- Statement anchor: the three rules of §2. The edge match is a multiset over
  `(day, đồng)`: each file row can absorb one ledger row.
- `opts.upto` stops the walk at a day. The drift badge uses it (SB13).

Amounts are compared in đồng (`Math.round(base × curMult())`). The file's rows are
đồng already.

## 11. Deciding what a statement may do

`fhAnchorDecide(acct, facts)`:

| Account | Statement | Result |
|---|---|---|
| No anchor, no offer | Has a balance | `offer` |
| No anchor, an offer | As-of date the same or later | `offer` (replaces it) |
| No anchor, an offer | Earlier | `keep` |
| Anchored | As-of date later than the anchor's | `set` |
| Anchored | Same day or earlier | `keep` |

The anchor's date is `meta.asof` for a statement anchor and the local day of
`anchor_at` for a typed one.

## 12. Standing rules for whoever touches this next

- A new kind of ledger row that moves an account must be added to
  `fhAnchorDelta`, or balances stop moving for it.
- A new sealed column on `personal_accounts` joins the regen sweep.
- `anchor_at` on a statement anchor is not "when it was set". Read the as-of date
  through `fhAnchorAsof(acct)`.
- The edge window sizes (1 and 5) are part of stored anchors. Changing them
  changes only anchors written afterwards.

## 13. Open

- Rows waiting in the review queue are not counted and not named on the tile yet.
- The auto-debit account read from a card statement is not used to pre-select the
  paying account of a card repayment.
- Only one card layout (VIB) and its synthetic twin are verified for the five card
  labels. Another issuer's vocabulary is added to `STMT_LABELS` when its file is
  seen.
- Vietcombank has no statement sample. An account with no statement keeps the
  typed path.
- A foreign-currency row on a card's edge matches within 6% only when its note
  carries the estimate marker.
- The measurement in §1 and §5 is one mailbox, two banks and one wallet.

## 14. Decisions

| # | Decision |
|---|---|
| SB1 | The statement is a source of account facts, not only of rows. |
| SB2 | An anchor may carry its own date. A statement balance is never stored as "true now". |
| SB3 | Today's figure is the statement balance plus the ledger rows the statement does not contain, by three rules: after the last day, before the edge window, matched on the edge. |
| SB4 | The edge window is one day for accounts and wallets, five for cards. |
| SB5 | The number comes from the file when it is read: the closing figure, or the last row on the proved chain. It does not depend on which rows are imported. |
| SB6 | First time: the number is offered and the person confirms with one tap. After that, later statements re-anchor silently. Amends `account-setup-spec.md` "a number only after the person has typed one" to "after the person has typed or confirmed one". |
| SB7 | Newest as-of date wins. A statement never replaces a newer starting point, typed or read. |
| SB8 | Card facts (limit, statement day, due day) fill empty fields from any statement and never overwrite a typed value. |
| SB9 | Coverage is measured from the statement against the ledger, by money, excluding rows that entered from a statement. |
| SB10 | Below 95% coverage with rows after the statement, the tile leads with the dated statement number. Totals always use the brought-forward figure. |
| SB11 | When the file's own numbers disagree, no balance is taken. |
| SB12 | One sealed column, `anchor_meta_enc` (0160). No new plaintext. |
| SB13 | The drift badge compares the bank's figure with the ledger's figure as of the same day. |
| SB14 | Statement rows no longer write the bank-stated balance at import; the anchor carries it. |
| SB15 | The wallet's balance is the last row on the proved chain, not the newest row. |
| SB16 | The account read tolerates a database without the column, so the client and the migration can land in either order. |

## 15. Related

- `statement-capture-spec.md` (S10, S30 to S32), `account-setup-spec.md`,
  `full-ledger-spec.md` §5, `account-setup-knows-spec.md` (proposed; its A1 and A4
  overlap with SB8 for mail notices).
