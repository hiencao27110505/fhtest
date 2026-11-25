# Reconcile: one money event is one row, and every copy of it makes that row better

A purchase reaches the app more than once: the bank's alert mail, the monthly
statement, the wallet's history, a scanned receipt, a row typed by hand. Today each
copy is a new card that the person must recognise and remove, and the app
recognises fewer of them than it should. This spec replaces "guess whether two
rows look alike" with "pair the copies of one money event by the facts they
share", and turns a matched copy from something thrown away into something that
improves the row already in the book.

> **Status, 2026-11-25. SPEC, build starting.** Integration branch `feat/recon`,
> worktree `.worktrees/recon`. Client only: no migration, no Edge Function deploy
> is needed for anything in Parts 2 to 6. Two server follow-ups are written as
> hand-overs in §19 and are Hien's to run. Decisions R1 to R31 below. Hien
> answered the design rounds in conversation and closed with "let's write the
> specs and start"; decisions marked *(assumed)* are recommendations he did not
> answer one by one and can still reverse.

> **Siblings.** `dedup-flaws-review.md` Parts A to F own the engine as it stands
> (`src/js-ui/58-dedup-engine.js`); this spec supersedes its tiering rules and
> keeps its two principles ("an exact key may block, a guess may only flag";
> "one ledger row is claimed once"). `statement-capture-spec.md` and
> `pdf-statements-spec.md` own how a file becomes rows; Part 2 here amends S31/S32
> (auto-stage) and the summary reader. `statement-balance-spec.md` owns anchors;
> Part 2 stops an unproved file from creating or re-kinding an account.
> `receipt-enrichment-spec.md` is the precedent for "a second source annotates a
> booked row"; Part 4 generalises it. `card-repayment-routing-spec.md` owns
> `fhResolveRepaidCard`; Part 5 builds on it.

---

# Part 1. The problem, measured

## 1. What was measured

One person's real year, read on their own machine and never copied into this
repo (`research/statements/` is git-ignored; every figure below is an aggregate):

- 1,259 mails over 14 months, 809 of them one bank's transaction alerts, replayed
  through the real reader (`extract.mjs`, model off);
- 8 monthly card statements (326 rows), one deposit account's statements for
  eleven months (347 rows), one wallet's history for eleven months (709 rows),
  read by the real statement reader (`59-statement-table.js`);
- a hand-kept ledger from another app for the same months (450 rows, one
  "wallet", no account, no clock).

Alert mails were paired with statement rows by hand-checked rules into a ground
truth of **499 pairs** (211 card purchases, 288 account movements), then the real
engine was run over it.

## 2. What the engine does with those 499 pairs

| Situation | Found | Missed | Notes |
|---|---|---|---|
| Alert already booked, statement row arrives | 386 (378 `sure`, 8 `likely`) | 113 (23%) | no false flag |
| Both waiting in the queue | 380, all `likely` | 115 | 380 taps; 4 pointed at the wrong row |

Why the 113 are missed:

| Cause | Pairs | Rule responsible |
|---|---|---|
| Card repayment: the engine never looks at transfers | 67 | `if(c.isTransfer) return []` (58:187) |
| The statement's day is not the alert's day | 41 | every ledger rule needs `sameDay` or `t.day < day` |
| Transfer to the person's own other account, booked as transfer | 5 | kind gate `t.kind === want` |

## 3. Families of copies found

| Family | Count | Shape |
|---|---|---|
| Card purchase: alert and statement | 214 | 200 same day; 9 one day EARLIER on the statement (all alerts before 07:00, online merchants); 2 one day later (foreign merchant, late capture). Every pair shares a merchant word. |
| Account movement: alert and statement | 288 (every alert) | 242 same day; 46 next day, all sent 21:12 or later. Between 21:00 and 23:00 both happen: there is no clean cut-off. Memo text identical on 216 of 221 non-repayment pairs. |
| Card repayment | 93 alerts | One payment, three rows: the alert, the deposit account's debit, the card's credit. |
| Wallet funded from the bank | 31 bank rows | The bank words all of them "wallet top-up". 12 are top-ups; 19 are purchases the wallet shows 1 to 7 seconds later. |
| The same file again | 267 of 1,343 rows read | Overlapping periods, a statement saved twice, the bank mailing each card statement two or three times, as PDF and as spreadsheet in one mail. |
| A weekly loyalty-points statement | 62 mails | Lists the week's card purchases again, with points. Not a money statement. |

Rows that look like copies and are not: refunds (6 of 8 have a same-amount
purchase within 3 days); genuine repeats of one amount within a day of each other
on one account (6 on the card, 7 on the account, **76 on the wallet, 11 of them
within two minutes**).

## 4. The rule that finds all of them

*Same account, same direction, exact amount, days at most one apart*, paired
one-to-one: **499 of 499**. For 483 there is exactly one candidate; the other 16
are genuine repeats that one-to-one pairing in date order resolves. Ignoring the
account costs nothing on this data (0 and 3 cross-account collisions) but the
account is what makes the wallet safe.

Against the hand-kept ledger (no account, no clock), 410 bank rows have a ledger
row of the exact amount within a day; **354 are unique in both directions**, 56
are repeated small amounts. This half has no ground truth (no shared ID), and that
ledger's amounts are mostly exact, which a typed ledger often is not.

## 5. The points statement, traced

A weekly "Sao kê điểm thưởng" PDF was accepted as a deposit account statement
with the wrong account, and its purchases were staged as income. Step by step:

1. Server: known bank sender, `.pdf` attachment, subject shape not seeded, one
   model call whose prompt has no "points" exclusion; the yes is cached for every
   user (`statement.mjs:138-143`, `245`).
2. Roles: "Số tiền (VND)" becomes `amount`; "Số điểm (Loyalty points)" matches
   nothing and is ignored (`59:97-127`).
3. Account: `fhStmtSummary`'s first-hit guard tests `out.account` but writes
   `out.accountTail`, so the guard never fires and the LAST account-labelled row
   wins (`59:198` against `209`). The card's internal account number beat the
   card number.
4. Sign: one amount column is read as printed (`59:249`); purchases print
   positive, so they are money in. "Both signs are tried"
   (`statement-capture-spec.md` §11) is not implemented.
5. Proof: no balance, no totals, so `ok:false`. The file stages itself anyway
   once a mapping for that header signature has been confirmed once (`77:748-751`,
   `762`, `958`). The confirm screen shows neither account, kind nor direction.
6. Kind: no debt lines, so `deposit` (`77:766-771`), though the subject says card.
7. Account: `fhPersonalAccountEnsure` finds no such tail and inserts one
   (`19-personal.js:1683`).

The same reader bug means the real card statement's PDF (one signed column,
purchases positive) is read inverted, while its spreadsheet twin is read right.

---

# Part 2. Statement safety (ships first)

Goal: nothing that is not a money statement becomes rows, a statement is read
with the right account, kind and direction or it asks, and a file read twice adds
nothing. Paths: `src/js-ui/59-statement-table.js`, `src/js-data/77-statement-capture.js`,
tests and synthetic fixtures under `tools/`.

## 6. Decisions

- **R1. A table with a points column is not a money table.** A header cell that
  reads as points ("so diem", "diem thuong", "loyalty point", "reward point",
  "dam", "miles") makes `fhStmtParse` return no table with `why:'not_money'`. The
  card says the file is a points statement and is put away; it never asks for a
  mapping.
- **R2. The account label is read once, and a card answers to its card number.**
  `fhStmtSummary` collects every account-labelled number into
  `summary.accountTails` (ordered, distinct) with the label that named each. The
  primary `accountTail` is: the card number ("so the chinh", "primary card
  number", a masked PAN shape) when one is present; otherwise the FIRST
  account-labelled number in the preamble. In-table sub-header numbers are
  collected but never become the primary. The guard bug in §5.3 goes.
- **R3. One amount column gets its sign from the file's own arithmetic.** With a
  single `amount` role, `fhStmtProve` tries the printed sign and the inverted
  sign against the totals checks; the sign that proves is the sign. If neither
  proves, wording decides per row only where it is unambiguous ("Mua hàng",
  "Thanh toán" out; "Hoàn", "Refund" in) and the file asks (R5).
- **R4. Kind takes the subject and the labels as evidence.** `_stmAcctKind` reads
  debt lines as now, then the mail's own kind word (`_stmKindKey`: "thẻ tín
  dụng", "credit card") and the presence of a card number. A file whose evidence
  disagrees (card word, no debt lines) asks.
- **R5. A file that cannot prove itself never stages unseen, and a remembered
  mapping remembers what was confirmed.** `_stmNeedsAsk` is true when the proof
  fails unless the kept mapping carries `v:2` with the account, kind and sign the
  person confirmed and they equal this file's. Old `v:1` mappings ask once more.
- **R6. The confirm screen says what will happen.** One block above the sample
  rows: provider and account ("VIB · thẻ ••6789"), kind, count, money out total,
  money in total. Existing screen, existing classes; copy vi + en.
- **R7. A statement never creates or re-kinds an account silently when its
  account is not one the person has.** Unknown tail on a known provider: the file
  asks "Sao kê này của tài khoản nào?" with the person's accounts at that
  provider and "Tài khoản mới". The answer is kept as an alias (R8). A proved
  file whose tail matches an owned account is unchanged.
- **R8. An account answers to more than one number.** Aliases live in the synced,
  encrypted lessons blob under a new namespace `alias`:
  `providerKey|tail -> accountId`. `fhPersonalAccountEnsure`, `fhStagedAcct` and
  `fhResolveRepaidCard` consult it after the account's own tail. Merging an
  account into another writes the source's tail as an alias of the target, so a
  merged-away number is never re-created. No migration.
- **R9. A statement row has one identity whatever file carried it.** Before
  staging, `_stmPlan` drops rows whose canonical key (provider key, resolved
  account id, date, signed amount, normalised description, running balance when
  printed, ordinal among equal rows) is already waiting in the queue from another
  file or already in `resolved_statement_rows`. The same statement mailed twice,
  PDF beside spreadsheet, and overlapping periods all add nothing. The ordinal
  keeps two real same-day same-amount rows two rows.

## 7. What does not change

A known layout that proves itself with an owned account stages exactly as today.
Fingerprints already in `resolved_statement_rows` stay valid: R9 adds a second,
account-id-based key and reads both.

## 8. Cleaning up what is already there

For people who already hold an account created by a misread file: the account
screen's existing "Gộp vào tài khoản khác" does it, and R8 now leaves the alias
behind. Rows such a file left in the queue are the person's to remove; the queue
gains nothing automatic here.

---

# Part 3. The matcher (ships second, in shadow first)

Paths: new pure module `src/js-ui/58-recon.js`; `58-dedup-engine.js` (index
fields, dispatch); `57-csv-import-review.js` and `src/js-data/76-quick-review.js`
(candidate fields); `src/js-data/19-personal.js` (match slice); tests.

## 9. Facts, not sources

A copy of a money event carries some of these facts, whatever produced it:

| Fact | Alert mail | Statement | Wallet history | Scan | Typed |
|---|---|---|---|---|---|
| Account | yes | yes | yes | rarely | if picked |
| Direction | yes | yes | yes | yes | yes |
| Exact amount | yes | yes (final) | yes | yes | often rounded |
| Day | yes | yes (may be ±1) | yes | yes | yes |
| Clock | minute | rarely | second | often | no (typing time) |
| Source ID | reference | rarely | transaction id | no | no |
| Words | merchant or memo | description | service, payee | seller | note |

- **R10. Any two rows can be the same event; certainty comes only from the facts
  both carry.** A missing fact never blocks a match and never makes one certain.
  The rule is symmetric: which row arrived first does not matter.

## 10. Must agree, proves different, raises certainty

**Must agree** (a pair that fails any of these is not a candidate):
- direction of money (R13 covers a statement read the wrong way round);
- amount exact to the đồng, or within 999 đ when one side is typed by hand and
  the amounts differ (`rounded`);
- days at most one apart; a day-only row and a timed row may also be one apart;
- the account, when both sides resolve to one of the person's accounts.

**Proves two events** (clears any pairing):
- both sides resolve to two different owned accounts and neither is the other's
  funding (Part 5);
- both carry a machine-read clock and they differ by 120 minutes or more on one
  day (`FH_DEDUP_MOMENT_GAP`, unchanged), or they fall on different days and
  neither is day-only;
- both carry a source ID of the same kind and the IDs differ;
- both came from the same source lane in the same shape and R9 did not fold them
  (two alerts, two rows of one statement): two real movements;
- the person said so before (R17).

**Raises to "Đã có trong sổ"** (`sure`): any one of
- the same source ID;
- the same account on both sides and a shared merchant word, or identical memo
  text (one contains the other after normalising);
- the same account and the same minute;
- the same account and this is the only row of that amount on that account in
  the window, in both directions (mutual uniqueness);
- no account on the booked side, exact amount, and mutual uniqueness across the
  whole book in the window (R15).

Everything else that passes "must agree" and is not proved different is
**"Có thể trùng"** (`likely`).

- **R11. Kind is not a gate.** A booked loan, transfer or expense can each be the
  copy of a statement row; the card names what the booked row is recorded as.
  *(Hien: aligned.)*
- **R12. One day of tolerance, for every source.** Per-bank cut-offs are not
  learned: the data shows a fuzzy band, not a cut-off, and with the account and
  the exact amount agreeing the tolerance produced no false pair. *(Replaces the
  earlier per-clock window idea.)*
- **R13. Opposite direction is its own question.** Same account, exact amount,
  same day, identical wording apart from direction, and neither row worded as a
  refund ("Hoàn", "Refund", "Reversal"): `likely`, why `direction_conflict`. A
  refund-worded row is never a duplicate of its purchase.
- **R14. Transfers, repayments and loans are matched like anything else.** The
  `isTransfer` early return goes. Part 5 decides what a matched pair of legs
  means.
- **R15. Mutual uniqueness counts when the booked row names no account.**
  *(assumed)* It reaches `sure` only above 200.000 đ or with a shared word; below
  that it is `likely`. Wallet rows never reach `sure` on uniqueness alone: a
  wallet repeats amounts too often (76 genuine repeats).
- **R16. Pairing is one-to-one and done per batch.** All candidates and all
  ledger rows in the window are paired together: certain pairs first (ID, then
  words, then minute), then remaining pairs by nearest day, ties broken by
  arrival order. A ledger row is claimed once; two equal rows on each side pair
  off in order and neither is asked about.
- **R17. "Vẫn nhập" is remembered.** *(assumed)* The pair (booked row id,
  fingerprint of the incoming row: account, day, signed amount, normalised text)
  is written to the lessons blob, namespace `ndup`, and proves two events from
  then on. Entries for booked rows that no longer exist are pruned on load.
- **R18. The matcher reads the ledger for the period it is judging.** The match
  slice is loaded for `[earliest candidate day - 4, latest + 4]`, not a fixed
  horizon, and `window._fhPersonalMatchSlice` is refreshed after every write that
  invalidates it. The tab-cache fallback maps `accountId` to `acct`.
- **R19. Foreign-currency alerts keep the existing `fx_final` rule**, moved into
  the new module unchanged and with the account added to "must agree".

## 11. What the candidate and the ledger entry gain

Candidate (built in `57` and `76`): `acctTail`, `acctProviderKey`, `acctId`
(resolved synchronously against `fhPersonalData().accounts` and the `alias`
namespace; null when unknown), `ref` (`reference_number`), `timePrecision`,
`lane` (`'alert' | 'statement' | 'wallet' | 'scan' | 'file'`), `refundWorded`.
Ledger entry (`fhDedupLedgerIndex`): `acct` on both personal paths, `who`
(counterparty) kept instead of blanked, `kind`, `src`, `refs` and `sources` from
the `mrg` namespace (Part 4) when present.

`csvRowSig` and `csvReviewSigCompute` are extended with the twin's account, the
candidate's `acctId` and the `alias`/`ndup` generation, or the screen will skip
repaints (`device-heat-spec.md`).

## 12. Why codes and copy

Existing codes keep their meaning and copy. New: `same_ref`, `acct_text`,
`acct_minute`, `acct_unique`, `book_unique`, `day_shift` (suffix on any why when
the days differ: "ngày sao kê lệch 1 ngày"), `direction_conflict`,
`leg_of_transfer` (Part 5). Each needs vi and en in both `csvDupAsk` and
`csvDupWhy` (`56-csv-import-ui.js`); plain words, no em-dashes.

## 13. Shadow first

- **R20. The new matcher ships beside the old engine and changes nothing until
  it is switched on.** `fhReconMode()` reads localStorage `fh-recon`:
  `'off'` (old engine only), `'shadow'` (default in the first release: old engine
  decides; the new one runs on the same inputs and its disagreements are counted
  on the device), `'on'` (new matcher decides). A build constant sets the
  default; the localStorage value overrides it per device.
- Shadow output: counts only, on the device, shown on the existing diagnostics
  surface (the heat meter's sheet): rows the old engine flagged, rows the new one
  would flag, by why code, and how many differ. No row text leaves the queue.
- Promotion to `'on'` is a one-line default change in a later release, after
  Hien has looked at the shadow counts on a real phone.

---

# Part 4. A matched copy enriches the booked row (ships third)

Paths: `56-csv-import-ui.js` (the skip actions), `19-personal.js` (one write
helper), `24-lessons.js` (namespaces), `61-expense-detail.js` (sources line, undo).

## 14. Decisions

- **R21. Absorb, do not discard.** *(Replaces "the statement row retires and only
  donates its account".)* When a queue row is settled as a copy of a booked
  personal row, its facts are merged into that row before the queue row is
  retired.
- **R22. Field rules.**

| Field | Rule |
|---|---|
| Amount | statement, then alert or wallet, then scan, then typed. The final posted figure wins; a typed 467.000 becomes the bank's 467.290. The old figure stays in the merge record. |
| Day | the booked row keeps its day unless it was day-only from a statement and the copy carries a clock (then the copy's day). |
| Clock | a machine-read clock fills an empty one. A day never replaces a clock; a typed row's typing time is not a clock. |
| Account | fills when empty. Two different owned accounts is not a match in the first place. A row on a catch-all wallet with no bank identity moves to the bank's account (R25). |
| Counterparty | fills when empty. |
| Note | never overwritten. An empty note takes the copy's description. |
| Category, node, label, kind, split | the person's values are never touched. A node the machine guessed and the person never confirmed may be replaced by a deeper node the copy carries (MCC, wallet service). |
| Source IDs, sources | appended to the merge record. |

- **R23. Silent only when certain.** `sure` pairs are absorbed when the person
  removes or bulk-skips them, exactly where `csvStmtTagTwin` runs today (✕,
  "Bỏ qua cả N"), and at import for unticked `sure` rows. `likely` pairs are
  absorbed only when the person confirms that pair.
- **R24. Reversible.** Every absorb writes one merge record: booked row id, the
  previous value of each field it changed, the copy's lane, day, IDs, and the
  date. The transaction's detail screen lists the sources ("Email 31/10 17:01 ·
  Sao kê 11/2026") and offers "Tách ra": the fields go back to their previous
  values, the pair is written to `ndup`, and the copy is booked as its own row.
- **R25. A matched row moves to the bank's account.** *(assumed)* Only for rows
  whose current account has no provider identity or is empty.
- **R26. A match teaches a category.** *(assumed)* When the booked row's node or
  category was set by the person, the copy's bank text is learned to it through
  the existing lesson writers. Machine guesses teach nothing.
- **R27. Family rows.** A copy of a family-book row fills only what the family
  row has columns for (clock, instrument) and only on rows the person authored.
  The mirror in their personal book follows through the existing mirror path.

## 15. Storage, with no migration

`personal_transactions` has no free encrypted blob (the receipt blob must not be
reused: any non-null value shows a receipt). The merge record lives in the
lessons blob, namespace `mrg`, keyed by booked row id:

```
mrg[rowId] = { v:1, src:[{lane,day,t,prov}], ids:[hash…], prev:{amt,time,acct,who,note,node}, at:'2026-11-25' }
```

IDs are stored as short keyed hashes, never the bank's printed reference. The
namespace is capped: `prev` (the undo data) is kept for the 400 most recent
merges; `src` and `ids` are kept for every row younger than 400 days. Field
writes go through `fhPersonalPatchMany` (amount, time, account, node, note) and
one direct update for `counterparty_enc`, which the patch RPC does not accept.

If the blob's size becomes a problem, §19 describes the one-column migration
that replaces this namespace.

---

# Part 5. Money between the person's own accounts (ships fourth)

- **R28. A repayment or own-account move is one event with two legs.** When the
  paying account's debit and the receiving account's credit both arrive, they are
  the two legs of ONE transfer: the second to arrive completes the first
  (`leg_of_transfer`, `sure` when the amounts are exact, the days at most one
  apart, and either leg names the other account: card number, card account
  alias, wallet phone number, own account number). Nothing is booked twice and
  the card is credited once.
- **R29. A bank "wallet top-up" that the wallet shows as a purchase is how that
  purchase was paid.** A bank debit worded as a top-up and a wallet spending row
  of the exact amount within 120 seconds (by the clock the bank prints in its
  memo, or the alert's minute) are one expense paid from the bank account: the
  wallet row supplies what it was, the bank row supplies the account, and one
  expense is booked on the bank account. A top-up matched by a wallet "money in"
  row stays a transfer.
- **R30. A card repayment names its card by either number.** The memo's card
  number or card account number resolves through R8's aliases, so "Trả cho thẻ"
  pre-selects the card.

---

# Part 6. Exact IDs and batch answers (ships with Parts 3 and 4)

- **R31. A statement answers once.** The statement's line in the queue reads
  "N khoản: A đã có trong sổ, B cần bạn xem, C mới" and one action settles the
  A rows (absorbing them, Part 4). The individual cards stay underneath. Existing
  line, existing sections; no new screen.
- Source IDs: the wallet's transaction id and the bank's reference are compared
  first and decide silently (Part 3). A wallet row never reaches `sure` without
  an ID, a minute, or words.

---

# Part 7. Delivery

## 16. Order, and what each release changes for the person

| # | Release | Changes behaviour? | Flag |
|---|---|---|---|
| 1 | Part 2 statement safety | yes: fewer wrong rows, one more question on unproved files | none (bug fixes) |
| 2 | Part 3 matcher in shadow | no | `fh-recon` default `shadow` |
| 3 | Part 3 matcher on, Part 6 | yes: more rows recognised, fewer taps | default `on` |
| 4 | Part 4 enrichment | yes: booked rows gain facts | `fh-recon-absorb` default `on`, `'off'` restores tag-account-only |
| 5 | Part 5 own-account legs | yes | under `fh-recon` |

Each release is its own preview branch and its own SW bump, read from
`origin/main` at the time. Later, as separate specs: duplicates already in the
book (ledger against ledger), the "+" on income cards, seller and category work.

## 17. Rollback

- **A bad build.** `git revert` of that release's merge commit and push; the page
  is network-first, so the next load is the old code. Every release is one merge
  commit for this reason.
- **A bad rule, without a deploy, on one device.** `localStorage['fh-recon'] =
  'off'` returns that device to the old engine, which stays in the build
  untouched until release 5 has been live for 30 days.
- **A bad rule, for everyone.** Flip the build default and push: one line.
- **Bad data.** The only writes this work adds to booked rows are Part 4's, and
  each has its merge record. `fhReconUndoSince(dateIso)` replays the records
  backwards for one person on their device (a console helper in release 4, a
  button only if it is ever needed). Parts 2, 3 and 5 write nothing that the old
  code did not already write; they change which queue rows are ticked.
- **What cannot be rolled back.** A queue row the person removed because the new
  matcher called it a copy is deleted, as today. That is why `sure` needs one of
  the listed proofs, why release 2 is a shadow, and why R24's "Tách ra" re-books
  the copy from the merge record.

## 18. Tests

Synthetic rows only; real data never enters the repo.

- `tools/recon.test.js`: every rule in §10 both ways round (A booked then B
  arrives, B booked then A), built from the measured shapes: the day-early card
  purchase before 07:00, the next-day account row after 21:00, the repayment
  triple, the own transfer, two equal purchases on one day (pair off, no flag),
  eleven wallet repeats within two minutes (never `sure`), the refund beside its
  purchase (never a duplicate), the typed rounded row, the catch-all-wallet
  ledger with mutual and non-mutual uniqueness.
- Old engine tests stay green untouched while the mode is `off` or `shadow`:
  `dedup-engine` (62), `dedup-evidence-flow` (14), `dedup-fx-final` (11),
  `dup-advisory` (26), `review-bucketing`, `statement-bucketing`,
  `statement-tag-twin`, `review-attention`, `heat-queue-render`.
- `tools/statement-table.test.js` and a new `tools/statement-safety.test.js`:
  the points layout (no table, `not_money`), the two-number card preamble (card
  number wins, both collected), the single signed column (inverted sign proves),
  the unproved file with a `v:1` mapping (asks), the same statement as two files
  (second adds nothing), two real equal rows (both stay).
- A parity harness that is NOT committed with data: `tools/recon-parity.js` reads
  a local, git-ignored corpus when one exists and prints counts only (found,
  missed, false) for the old engine and the new. On the measured corpus the
  target is 499 of 499 with no false `sure`.
- Gates before every preview: `npm run check && npm test`, the boot harness
  timing run, `flows/baseline.flow.js`.

## 19. Hand-overs (Hien's to run; not part of the client work)

1. **Server statement verdict.** Add "a loyalty, rewards or points statement" to
   the false list in `statementVerdict`'s prompt, and a deterministic subject
   test ("diem thuong", "reward", "loyalty", "points") before the cache lookup
   (`statement.mjs:228-246`). The cached yes for the points subject shape in
   `statement_shapes` must be flipped by hand: a seed with `on conflict do
   nothing` will not override it. Needs a `mailbox-sync` deploy (diff live
   against main first). Until then R1 stops the file on the device.
2. **Server duplicate flag.** `findDuplicate` returns early for a person with no
   family (`if (!row.memberId) return null`), and retiring a flagged pair can
   fail on the `duplicate_of_id` foreign key. Both in `dedup.mjs` / migration
   territory; neither blocks this work because the client no longer depends on
   the server flag for anything but a hint.
3. **Optional column.** If the `mrg` namespace outgrows the lessons blob: one
   nullable `meta_enc text` on `personal_transactions`, added to the
   `personal_txn_patch` whitelist. Claim the number in `AGENT_SYNC.md` first.

## 20. Risks

- **The lessons blob is replaced whole on every save.** Three new namespaces
  ride on it; the caps in §15 bound it, and `tools/lessons-sync.test.js` must
  cover the merge of each.
- **Accounts may not exist yet when the queue is bucketed** (the census is
  asynchronous). A candidate whose account is not yet materialised matches as
  "no account" and can only be `likely`; the bucket is recomputed when the
  census lands.
- **One year of one person at one bank.** The rule set is deliberately free of
  bank-specific knowledge, but it has been measured on one. The shadow release
  is the second measurement.
- **Mutual uniqueness on a thin ledger has no ground truth.** R15 keeps small
  amounts and wallets at `likely`.

## 21. Out of scope

Server-side dedup changes beyond §19; duplicates between two rows already in the
book; category and seller recognition; the "+" on income cards; a server-driven
kill switch (the app has no flag service; §17 uses what exists).
