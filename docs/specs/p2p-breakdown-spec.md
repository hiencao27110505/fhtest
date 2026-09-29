# Transfers to people — the bucket learns to empty itself

"Chuyển cho người khác" is the largest line in the review queue and one of the
largest in the ledger, and it answers nothing. It says money went to a person.
It does not say what for, and it is the one group in the tree where *what for*
is not the useful question in the first place. This spec gives that bucket the
axis it actually has — **who** — so a person can answer once per counterparty
instead of once per row, and it fixes the two reasons the bucket is bigger than
the truth.

> **Status, 2026-09-29. ALL THREE RUNGS BUILT, one deploy pending — SW v594,
> sweep cursor v10, taxonomy v2.** `tools/review-shape-tier.test.js` 15/15,
> `tools/p2p-person-groups.test.js` 29/29, suite 140/141 (the one failure is
> `pipeline/direct-persist-contract`, which needs a Python venv this machine
> does not have). Rung 1 came out wider than "one call site" (§9.1, P9). Rung 2
> found and fixed a units bug the design depended on (§9.2, P10). The founder
> chose to ship the three together rather than one per landing; the
> before-numbers in §17 stand, the after is read once. From the founder's own
> ledger and queue on 2026-09-29: the review queue holds 817 rows totalling
> ↓1.235.927.998đ, of which **"Chuyển cho người khác" is ×113 for
> 966.403.046đ — 78% of the entire outflow, averaging 8,5tr per row.** The same
> node on the ledger's tháng 9 breakdown is 8.475.000đ. The two numbers disagree
> by three orders of magnitude because the ledger sweep re-files transfer shapes
> and the review lane never has (§9.1). No migration. No Edge Function redeploy.
> Client-only, in three landings.

> **How this relates to its siblings.** `category-tree-spec.md` owns the tree,
> the cascade and the E series; this spec is an amendment to it, confined to one
> root (`p2p`) plus the two surfaces that render it, and every decision here is
> numbered into that spec's log as the **P series**. E14a (WHAT outranks WHO)
> and E2 (`fhCountsAsSpending` is the one predicate) are honoured by
> construction and neither is touched. `transaction-review-spec.md` owns the
> queue this adds a grouping to. `personal-ledger-spec.md` owns the ledger and
> the lesson store. `research/category-patterns.html` is the measurement this
> spec rests on; nothing here re-derives it.

---

# Part 1 — Behaviour

## 1. Summary

- **The bucket is bigger than the truth, for two mechanical reasons.** The
  review queue never runs the transfer-shape rules the ledger sweep runs, so
  money that was never spending sits in it (§9.1). And `p2p` has exactly one
  child, so nothing can ever move deeper inside it (§9.3).
- **The axis inside this bucket is who, not what (P1).** Every other group in
  the tree answers what the money bought. This one cannot, and grouping by
  person is the only breakdown that makes it reviewable.
- **A group is a lesson.** The grouping key is exactly the key the lesson store
  already uses — the deburred payee plus the amount band — so assigning a group
  once teaches the answer for every past and future row from that person at
  that size. This is not a new learning mechanism; it is the existing one given
  a surface.
- **Most of the money should leave the bucket, not get a sub-folder in it.**
  Rent, lì xì, mừng cưới, biếu ba mẹ, lending and investment funding all have
  real homes in the tree already. The three new children cover only what
  genuinely stays.
- **Nothing is asked.** No prompt, no "what was this?" card. E14 stands: the
  machine pre-selects from data and rests on the deepest known level; this spec
  only makes the person's own correction cheap to give once instead of 113
  times.

## 2. Why this exists

The queue and the ledger tell the founder two different stories about the same
money, and neither is readable.

Measured on one real mailbox over a year (`research/category-patterns.html`),
273 transfers to people break down as:

| What it actually was | Rows | Money |
|---|---|---|
| Paying a seller, with a system-generated mark | 143 | 74,8tr |
| No mark at all: digits-only account, a person's name, a default memo | 72 | 215,6tr |
| Carries a human message ("cảm ơn anh", "lì xì em bé") | 21 | 143,8tr |
| The bank's mail lost the recipient's name (VIB internal) | 15 | 81,6tr |
| Transfers to the person's own account | 11 | 32,6tr |
| A P2P exchange desk — confirmed by its owner as buying crypto | 11 | **545,1tr** |

Half the money in the bucket was never spending, and the single largest block
is one counterparty type. Of the 72 genuinely unmarked transfers, **7 recipients
account for 43 rows** — one person paid 16.000đ sixteen times, another paid
exactly 5tr nine times with the same memo, another 7,5tr for eight straight
months. One answer per person resolves roughly 60% of that group permanently,
through machinery that already exists.

What is missing is not the ability to answer. It is any surface that shows a
person as one thing to answer about.

## 3. What changes on screen

### 3.1 The review queue

The "TIỀN ĐI ĐÂU" widget already lists "Chuyển cho người khác ×113". Tapping it
already filters. What it gains is a **second level**: the rows beneath it are
grouped by person, largest first, each showing the payee's name as the bank
printed it, the count and the total.

In the card list, rows that share a person and an amount band collapse into one
group card the same way merchant groups already do — payee name, ×N, the date
range, and the money. Opening it shows the rows. Assigning it assigns all of
them and teaches once.

A person who appears **once** is not collapsed. A group of one is just a row,
and pretending otherwise adds a tap without adding information.

### 3.2 The ledger breakdown

"Tiêu vào gì" → "Chuyển cho người khác" currently filters the list and says
"Đang xem". It gains the same second level: person rows inside the group,
tappable, each narrowing the list, the chart and the breakdown together through
the one selection variable that already governs all three.

This is a deliberate exception and the only one: **`p2p` and its subtree expand
by person; every other node expands by child node** (P2). The exception is
justified by the axis, not by convenience, and it is not offered on `purchase`
— paying a seller already answers *what* well enough that *who* would be noise.

### 3.3 What the numbers do

Transfer shapes reaching the review lane (§9.1) will move real money out of the
queue's spending total. On the measured mailbox that is the 545,1tr of exchange
funding plus the self-transfers. This is the same correction `fhCountsAsSpending`
already applies in the ledger; the queue simply starts agreeing with it.

**The spending number goes down, and it was wrong before.** That is the point,
and it is why this lands on its own (§17, rung 1) with the number recorded
before and after.

## 4. What the person does

- **Assign a person once.** Open a person group, pick from the same whole-tree
  outline every other surface uses, and every row in the group is filed and the
  lesson taught. Nothing new to learn: this is E5's bulk verb over a grouping it
  did not previously have.
- **Move money out of the bucket.** The picker is unscoped, so "Tiền nhà",
  "Biếu ba mẹ & người thân" or "Lì xì & Tết" are one tap from a transfer. This
  already works per row today; the group makes it one tap for nine rows.
- **Keep a person at group level.** Resting on "Chuyển cho người khác" stays a
  correct, final answer for a one-off transfer with nothing more to say. The
  bucket never has to reach zero.
- **Use a sub-category when one fits** (§5).

## 5. The three new children

`p2p` today has one child, `split`. It gains three more, and no others (P3):

| Code | Vietnamese | What it means |
|---|---|---|
| `split` | Chia bill & góp chung | *(exists)* a shared expense settled between people |
| `payback` | Trả lại tiền | settling up informally, where no loan was ever tracked |
| `onbehalf` | Nhờ mua hộ, trả hộ | reimbursing someone who bought something for you |
| `regular` | Gửi đều đặn cho người | a standing monthly transfer whose purpose is private |

The set is small on purpose. Rent goes to `rent`, gifts to `giving`'s four
leaves, money you expect back to the `loan` tree, exchange funding to
`investfund`, seller payments to `purchase`. A child of `p2p` is only correct
when the money genuinely is a transfer between people *and* something more
specific than that is known.

There is no "Khác" leaf, per Q9: `p2p` is its own other, and it already carries
`rest: true`.

## 6. Deliberately unchanged

- **No question is ever asked.** E14 stands.
- **No new learning mechanism.** The lesson store, its key and its amount bands
  are untouched.
- **The kind is not converted.** A self-transfer stored as an expense is still
  *named* a transfer and left out of the totals by `fhCountsAsSpending`, exactly
  as E2 decided. Bulk kind conversion stays out of scope (§16).
- **The worker is not redeployed.** No new keyword, no new server rule, no
  change to what the pipeline seals (§8).
- **`purchase` does not get person grouping** (§3.2).
- **Labels are untouched.** Every change here writes a node; no label moves, per
  C2.

## 7. Copy

- Person group header: the payee name **as the bank printed it**, never
  normalised for display. The normalised form is a key, not a name.
- Group card subtitle: **"N khoản · từ <ngày> đến <ngày>"**.
- Breakdown person row: name, ×N, amount. No emoji (a person is not a category).
- Keep-at-group option in the picker, already worded: **"giữ ở mức nhóm"**.
- Filter bar on a person selection: **"Đang xem: <tên> · Xem tất cả"**.
- New node names exactly as §5. English glosses: Settling up · Paid on my behalf ·
  Regular transfer to a person.
- After a group assign: **"Đã xếp N khoản vào <tên nhóm>"** — the existing toast,
  unchanged.

---

# Part 2 — Technical appendix

## 8. Schema, deploys and what this costs

**No migration.** Every column this needs exists: `node`/`node_enc` on both
ledgers (0144), the lesson blob, and the staged row's sealed `raw_extracted`.
`0154` was applied by the other session on 2026-09-29 (marketplace receipts);
the next free number is `0155`, and this spec claims none.

**No Edge Function deploy.** The three new codes are client-assignable only:
they carry no `kw`, so no worker tier can ever emit them, and `validNode()` on
the worker is never asked about a code it does not have. `tools/gen-taxonomy.js`
will regenerate `supabase/functions/_shared/mailbox/taxonomy.mjs` as part of the
build and that regenerated file **is committed but not deployed** — consistent
with the current posture that `mailbox-sync` is not deployed from `main`
(AGENT_SYNC, 2026-09-27). Nothing in this spec depends on the worker knowing the
new codes.

**Cursor bump required.** §9.1 changes what an existing row resolves to, so
`fh-tree-bf:v9` → **`v10`** in both scopes, or no device that already finished a
pass will ever re-file anything (E10).

**SW bump:** one, for the single deploy — `origin/main` read at v593 (the other
session's receipt work) → **v594**.

## 9. The three changes

### 9.1 Transfer shapes reach the review lane

`fhTransferShape` ([13-partition.js](../../src/js-ui/13-partition.js)) holds the
E18 exchange-desk rule (`/^\d{20}$/` memo → `investfund`; the
`"<sender> chuyen tien <6 digits>"` shape at a non-round amount ≥ 1tr) plus
`bankbank`, `cardpay`, `wallet`, `cashout` and `savings`. It has **exactly one
call site**: [28-tree-backfill.js:85](../../src/js-data/28-tree-backfill.js#L85).

The review cascade
([57-csv-import-review.js:1234-1296](../../src/js-ui/57-csv-import-review.js#L1234-L1296))
never calls it, and the server cannot cover the gap: `broker_funding` in
`signals.mjs` requires `senderKind === 'broker'`, and a P2P exchange desk
transfer arrives from the person's own bank, addressed to a person's name. No
signal fires. This is the whole of the 966tr / 8,5tr discrepancy.

**The change.** One tier, inserted into the review cascade between `learned` and
`keyword`:

```
pipeline → history → learned → SHAPE → keyword → statement → signal → concept → label → who
```

- **Below `learned`** because a person's own answer always wins.
- **Above `keyword`** because a 20-digit order id is a structural fact about the
  memo's format, and the sweep already ranks shape above words for the same
  reason.
- `nodeSource` becomes `'shape'`, so the source is visible in the card exactly
  like every other tier.
- Input is the same joined string the who-tier gets (note ∥ counterparty ∥
  memo), because `fhTransferShape` splits on `|` per segment, plus the absolute
  amount.

**Kind is not touched.** The shape sets the node; `fhCountsAsSpending` takes the
row out of the totals. This is E2's posture verbatim and avoids a kind
conversion inside the review.

**Verified 2026-09-29 — and it failed, so the change is wider than the tier.**
Neither the queue's header sum nor "TIỀN ĐI ĐÂU" asked `fhCountsAsSpending`;
`csvRowGroup` routed by `isTransfer`/`_xfer` only, and `csvTreeLeafOf(c,
'expense')` fell through to the LABEL when the node's kind was `transfer`. And
below that, both import paths gated `_node` on `kindOf(node) === kind`, so a
correctly shaped row would have lost its node the moment it was imported and
waited for the sweep to put it back. Rung 1 therefore touches five sites, all
narrowed to the one crossing E2 already allows — a **transfer** node on an
**expense** row, never any other kind pair:

| Site | Change |
|---|---|
| `57-csv-import-review.js` cascade | the `shape` tier, `nodeSource = 'shape'` |
| `56-csv-import-ui.js` `csvNodeNotSpending(c)` (new) | ONE predicate, delegating to `fhCountsAsSpending`; the queue never grows a second definition of "spending" |
| `56` `csvRowGroup` → `'other'`, `csvSumData` skips | the row leaves TIỀN ĐI ĐÂU and the ↓ header, lands in "Chuyển khoản & khác" under its own node name |
| `56` `csvCatChipText` | the card chip keeps the node's name instead of falling back to the label |
| `56` `csvPromoteNode` (family import), `72-txn-review.js` `_specNode` (personal import) | accept `kindOf === 'transfer'` when writing `kind === 'expense'`; an income or loan node still never rides an expense row |

### 9.2 A group is a lesson

The lesson key is already
`csvPatternKey({counterparty, description}) + '|' + csvAmountBand(amount)`
([24-lessons.js](../../src/js-data/24-lessons.js), `_nodeKey`).

- `csvPatternKey` deburrs, strips bank noise and gateways, and **drops every
  non-letter**, so `"13610000120606 - LE KHA NIN"` → `"le kha nin"`. It is
  already a person-identity function.
- `csvAmountBand`: `a` < 50k, `b` < 500k, `c` < 5tr, `d` ≥ 5tr.

**So the group key is the lesson key, exactly** (P4). Not "similar to" — the
same function, called from the same file. The consequence is the design: assign
a group → `fhLessonLearnNode` fires once per row with that key → every past row
the sweep touches and every future row the review reads resolves itself. If the
two ever diverged, a group would teach a lesson that does not fire on its own
rows, which is the failure this rule exists to make impossible.

**Grouping rules:**
- Group only rows whose node is `p2p` or a descendant.
- Key on `(csvPatternKey, csvAmountBand)`. Two bands from one person are two
  groups, and that is the point: the 16k and the 5tr must not be taught
  together.
- A key shorter than 6 characters does not group (`_nodeKey` refuses it anyway,
  so a group built on one could never teach).
- Groups of 1 render as ordinary rows.
- The displayed name is the **longest** counterparty string among the group's
  rows, by the richest-copy rule already used for merged staged copies.

### 9.3 Selection grammar and the tree children

`window.fhNodeSel` grammar today (E4): `null` all · `code` node and descendants ·
`'=code'` node only · `'_none'` no usable node.

It gains one form (P5): **`'@<patternKey>'`**, and `'@<patternKey>|<band>'`,
matching rows by the grouping key. One variable still governs the list, the
chart and the breakdown, so the three can never disagree — the property E4 was
written to protect.

The children of §5 are a `taxonomy/taxonomy.json` edit plus a regenerate. Codes
`payback`, `onbehalf`, `regular` are confirmed free against all 217 existing
nodes. No `kw` on any of them (§8). `version` bumps; `updated` records the date.

## 10. Module map

| File | Change |
|---|---|
| `taxonomy/taxonomy.json` | three children under `p2p`; version bump |
| `src/js-ui/11-taxonomy.js`, `supabase/functions/_shared/mailbox/taxonomy.mjs`, `earthy/.../taxonomy.py` | regenerated, never hand-edited |
| `src/js-ui/13-partition.js` | **built** — `fhPersonKey` / `fhPersonKeyRow` (THE key, đồng), `fhPersonName` / `fhPersonRemember` (P8), `fhNodeSelMatchRow`; `'@key'` in `fhNodeSelMatch` (→ false: node-only callers hide, never over-show) / `fhNodeSelLabel` / `fhNodeSelCode` (→ null) |
| `src/js-data/24-lessons.js` | **built** — `_nodeKey` delegates to `fhPersonKey`, so the group key and the lesson key are one call (P4) |
| `src/js-ui/57-csv-import-review.js` | **built** — the `shape` tier (§9.1). Person grouping did NOT go into `bucketCsvCandidates`: rows stay in `ready` and the grouping is a presentation over them (P7/E14) |
| `src/js-ui/56-csv-import-ui.js` | **built** — `csvNodeNotSpending` + the four gates (§9.1); `csvPersonRows` / `csvPersonWidgetHTML` (the second level under the p2p leaf in TIỀN ĐI ĐÂU), `csvPersonFilter` / `csvPersonFilterGo` / `csvCatHide` (a person is judged by key across every p2p leaf), `csvStagedSelectAll` respects the filters (P11), `csvBulkNode` + the "Tiêu vào gì" row in sheet ② (E9's outline over the selection, teaches per row) |
| `src/js-data/72-txn-review.js` | **built** — `_specNode` accepts a transfer node on an expense spec (§9.1) |
| `src/js-ui/63-tree-ui.js` | **built** — `fhTreePersonRows` / `fhTreePersonTap`; person lines under `p2p` (and only there, P2) in `fhTreeBreakdownHTML`; `fhTreeRowsFor` carries `cp`/`note` |
| `src/js-ui/60-transactions.js` | **built** — list rows carry `_cp`; `treeRows` carry `cp`/`note`; the list filter is `fhNodeSelMatchRow(t)`; the chip label reads the person's name; `txnBulkNodePick` learns in đồng (P10) |
| `src/js-ui/61-expense-detail.js`, `21-personal.js` | **built** — lessons learned in đồng with the counterparty (P10); the chart narrows by row (P5) |
| `src/js-data/28-tree-backfill.js` | **built** — cursor `v9` → `v10`; the sweep hands `fhTransferShape` / `fhNodeGuess` / `fhWhoNode` đồng and the counterparty (P10) |
| `taxonomy/taxonomy.json` + the three generated twins | **built** — `payback` · `onbehalf` · `regular` under `p2p`, no `kw`; version 2. `taxonomy.mjs` regenerated and committed, NOT deployed (§8) |
| `sw.js` | v593 → **v594** |

## 11. Failure modes

| Scenario | Behaviour |
|---|---|
| A person's name is missing entirely (VIB internal transfers, 15 rows / 81,6tr on the measured mailbox) | `csvPatternKey` returns a short or empty key; the rows do not group and render individually. They are not merged into one false "unknown person" group, which would teach one lesson onto unrelated money |
| Two different people share a normalised name | They group together and one assign teaches both. Accepted: the same collision already exists in the lesson store, and the picker is per-group, so the person sees the rows before assigning |
| A group spans a band boundary after an edit | The row leaves its group on the next render; its own lesson still applies. Groups are derived, never stored |
| `fhTreeOn()` is off | Every surface here hides, exactly as C8 specifies; the shape tier still writes nothing user-visible |
| The shape tier disagrees with a sealed pipeline node | `pipeline` is above it and wins, already guarded by `fhPipeNodeOk` (E16) |
| A person is assigned, then the sweep runs | The sweep reads the same lesson store and agrees. The cursor bump is what makes it re-look |

## 12. Testing

Per the two rules at the end of `category-tree-spec.md` §16.1 — run the real
function, loaded from the whole file, on real shapes; never pin a line of
source.

- `tools/tree-cascade.test.js` gains: the shape tier fires on the real E18 memo
  shapes through the **review** path, not just the sweep; `pipeline` still
  outranks it; `learned` still outranks it.
- A new test asserts **the group key and the lesson key are produced by the same
  call**, so a refactor cannot let them drift.
- A replay test: the measured six-way split from §2 through the real review,
  asserting the exchange-desk rows leave the spending total and the seller rows
  do not move.
- `fhCountsAsSpending` agreement between the queue header and the ledger on the
  same row set.
- **Built:** `tools/review-shape-tier.test.js` — the real `buildCsvCandidates`
  on the two E18 shapes and an ATM line; `learned` and `pipeline` still outrank;
  an ordinary p2p row and a real purchase are untouched; the three 56 gates
  sliced whole; the cursor pin. 15 checks.

## 13. Decision log — the P series

To be appended to `category-tree-spec.md` §16 on landing.

| # | Decision | Why |
|---|---|---|
| P1 | **Inside `p2p`, the axis is who.** The breakdown expands by person, not by child node. | It is the one group where "what did the money buy" has no answer, and the measured data is organised by counterparty: 7 recipients, 43 of 72 rows |
| P2 | **The who-axis is offered on `p2p` only**, never on `purchase` or anywhere else. | Paying a seller already answers what; adding who there is noise, and a second axis loose in the tree breaks Q4 |
| P3 | **Three children, and money that belongs elsewhere leaves.** `payback`, `onbehalf`, `regular` beside `split`; rent, gifts, loans and investment keep their existing homes. | A sub-folder for rent would record the mechanism instead of the purpose, and split the rent total in two |
| P4 | **The group key IS the lesson key**, by calling the same function. | A group that taught a lesson which did not fire on its own rows would be worse than no grouping |
| P5 | **One selection variable, one new form (`'@key'`).** | E4's guarantee that list, chart and breakdown cannot disagree is a property of there being one variable |
| P6 | **The shape tier sits between `learned` and `keyword` in the review**, and sets the node only, never the kind. | A person's answer outranks structure; structure outranks words; and E2 already decided mis-kinded rows are named, not converted |
| P7 | **Groups of one are not groups.** | A collapse that adds a tap without adding information |
| P8 | **The displayed name is what the bank printed**; the normalised form is a key and never reaches the screen. | "le kha nin" is not a person's name |
| P9 | **A transfer node may cross onto an expense row at every gate the queue has — and only that pair.** `csvRowGroup`, `csvSumData`, `csvCatChipText`, `csvPromoteNode`, `_specNode` all accept `kindOf === 'transfer'` when the row is an expense; nothing else crosses. | E2 already writes exactly this state from the sweep; a gate that dropped it at import made the queue and the ledger disagree in the OTHER direction |
| P10 | **The lesson key speaks đồng, everywhere.** `fhPersonKey(counterparty, description, amountDong)`; every ledger-side learner and reader multiplies by `curMult()` before calling; `_nodeKey` in 24-lessons calls `fhPersonKey`. | The review passed đồng and the ledger passed thousands, so the same 5tr row was band `d` from the queue and band `a` from the ledger: no ledger-taught lesson had ever fired in the queue, and "a group is a lesson" (P4) was false until the units agreed |
| P11 | **Select-all acts on the cards you can see.** With a category or person filter on, `csvStagedSelectAll` skips hidden rows; with no filter it is byte-for-byte what it was. | A bulk verb reached through select-all must not touch money the person never looked at — with a person filter on, that was the entire rest of the queue |
| P12 | **Person rows are a presentation over `ready`, never a bucket.** Rows are not moved out of `ready`; the queue groups them at render and the filter narrows to them. | E14: confidence decides where a row shows, never whether it imports — a p2p row already has a label and must stay importable as-is |

## 14. Open questions

- **The 15 name-lost VIB rows (81,6tr)** cannot group until the extraction
  template is fixed. That is template work, not tree work, and it is already
  named as a prerequisite in `category-tree-spec.md` §14.
- **Whether `regular` earns its place** or whether a standing monthly transfer
  is better served by tier 5 rhythm (designed, unbuilt). Shipping it as a
  person-assignable node costs nothing and can be merged away later by the
  alias rule (Q16).
- **Promotion to the registry.** A person-level correction is by definition
  private and must never be promoted to `merchant_concepts`, unlike a merchant
  correction. The seal on this is that `p2p` rows are keyed on a human name;
  worth an explicit guard if Q8's promotion is ever built.
- ~~The sweep hands `fhTransferShape` base units.~~ **Fixed in rung 2 (P10)**,
  riding the same cursor bump: the sweep now converts to đồng once and hands it
  to the shape, the guess and the who-tier.
- **Lessons taught from the ledger before 2026-09-29 are dark.** They were keyed
  in base-unit bands (a 5tr row under band `a`), and the band cannot be inverted
  to recover the amount, so they cannot be re-keyed (C6's lazy re-key needs the
  amount). They never fired in the queue anyway; in the ledger they stop firing
  now. The store is a week old and the next tap re-teaches, so this is recorded,
  not repaired.
- **Corrected 2026-09-30 (A15, `apply-to-similar-spec.md` §9):** personal rows
  decrypt the payee into `who`, not `counterparty`, so the v594 person rows and
  `txnBulkNodePick`'s lesson keyed on the note alone. `fhPersonKeyRow` now reads
  `_cp`/`cp`/`counterparty` only; personal callers map `who` → `_cp`; family
  callers pass null (their `who` is the member). Cursor bumped again for the
  sweep's changed inputs.
- **The family side has no person rows yet.** `fhTreeRowsFor` carries
  `t.counterparty`, but family rows in memory do not expose one today, so
  `fhTreePersonRows` finds no keys there and the family breakdown shows p2p
  exactly as before. The queue and the personal ledger — where the 966tr is —
  are covered. Wiring the family row's counterparty is a hydrate change.
- **Bulk kind conversion** stays out (§16). `fhPersonalConvertToTransfer(id,
  toAccountId)` needs a destination account per row, so a bulk version is not a
  loop over the existing function.

## 15. Scope

**In:** the shape tier in the review; person grouping in the queue and the
ledger breakdown; the `'@key'` selection form; three tree children; the cursor
bump; tests.

**Out (named):** bulk kind conversion; person grouping on `purchase`; the VIB
template fix; tier 5 rhythm; any worker change; any migration; asking the person
anything.

## 16. Related

- `docs/specs/category-tree-spec.md` — the tree, the cascade, the E series this
  amends. §16 receives the P series.
- `docs/specs/transaction-review-spec.md` — the queue.
- `docs/specs/personal-ledger-spec.md` — the ledger and the lesson store.
- `research/category-patterns.html` — the measurement in §2.
- `docs/specs/email-reading-v2-spec.md` — `signals.mjs`, and why the server
  cannot close §9.1's gap.

---

# Part 3 — Implementation plan

Three landings. Each ships alone, each is checked on the founder's own queue
before the next starts, and each is revertable without touching the others.
Order is: correct the money first, then make it reviewable, then give it
somewhere to go.

## 17. The ladder

### Rung 1 — the shape tier *(client only)* — BUILT 2026-09-29, not committed

The whole 966tr discrepancy. It was one call site plus four gates (§9.1).

1. ~~`fhPersonKey` extracted~~ — deferred to rung 2, where it is first used;
   rung 1 ships no unused code.
2. The `shape` tier at §9.1's position; `nodeSource = 'shape'`. **Done.**
3. Verified the queue header and "TIỀN ĐI ĐÂU": **both failed** (§9.1). Added
   `csvNodeNotSpending` and routed `csvRowGroup` / `csvSumData` through it;
   widened `csvCatChipText`, `csvPromoteNode`, `_specNode` to the one E2 pair.
   **Done.**
4. Cursor `v9` → `v10`; the pin in `tree-cascade.test.js` moved with it. **Done.**
5. `tools/review-shape-tier.test.js`, 15 checks, green. Neighbours green
   (`review-history-evidence`, `review-bucketing`, `family-promote-node`,
   `promote-v2-fields`, `quick-review-income-node`, `tree-cascade` 244/244).
   `pipeline/direct-persist-contract` fails on "Python payload builder failed" —
   pre-existing, environmental, touches nothing here.
6. `npm run build` done; SW `v590` (read from `origin/main`) → **`v591`**.
   `npm run check` is a pre-commit guard and is run at commit time.

**Measured before:** "Chuyển cho người khác" ×113 · 966.403.046đ; queue ↓
1.235.927.998đ. **After:** to be read off the founder's queue on next open.
Prediction unchanged: the count falls by the exchange-desk, self-transfer and
ATM rows; the ↓ header falls by the same money; those rows appear in
"Chuyển khoản & khác" under their own node names. If the header does not move,
`csvSumData`'s guard is the place to look.

### Rung 2 — person grouping *(client only)* — BUILT 2026-09-29

What shipped differs from the sketch in one deliberate way (P12): rows never
leave `ready`. The queue's grouping is the **widget's second level plus a
filter**, not a new card type — that reuses the filter, the bulk bar and the
outline that already exist, and keeps every p2p row importable untouched.

1. **The units bug first** (P10). Discovered while wiring P4: the ledger taught
   in thousands, the queue in đồng. Fixed at every ledger-side caller
   (`60`, `61`, the sweep) and `_nodeKey` now calls `fhPersonKey`. **Done.**
2. **Queue.** Tap "Chuyển cho người khác" in TIỀN ĐI ĐÂU → a "THEO NGƯỜI NHẬN"
   block lists each person (printed name, ×N, total; singles rolled into one
   "N người khác" line, P7). Tap a person → the cards narrow to their rows across
   every p2p leaf; the clear bar names them. Chọn nhanh's select-all now ticks
   only what is visible (P11). Sheet ② gains "Tiêu vào gì": E9's whole-tree
   outline over the selection, `csvBulkNode`, one lesson per row. **Done.**
3. **Ledger.** "Tiêu vào gì" → open "Chuyển cho người khác" → a "Theo người
   nhận" section lists the people (≥2 rows each). Tap one → `fhNodeSel =
   '@key'`; the list, the chart and the breakdown narrow together through
   `fhNodeSelMatchRow`, the "Đang xem" bar and the list chip carry the printed
   name, and the existing select → "Tiêu vào gì" bulk verb files and teaches.
   **Done.**
4. `'@key'` in the three `fhNodeSel` helpers; `fhNodeSelMatch` returns false for
   a node-only caller under a person selection, so a missed switch hides rather
   than over-shows. **Done.**
5. `tools/p2p-person-groups.test.js`, 29 checks: key ≡ lesson key; đồng at every
   ledger learner and in the sweep; `'@key'` matching by row, band and person;
   name = longest print; queue grouping with singles; person filter across
   leaves; select-all-visible; the three children. **Done.**

**Not built:** person rows on the family breakdown (§14 — family rows carry no
counterparty in memory today). `fhPersonKey` lives in `13-partition.js`, not
`57`, so the pure helpers stay DOM-free; it reads `csvPatternKey` /
`csvAmountBand` at call time.

**Checked on:** the real queue, after deploy. How many people does ×113 become,
and do the top three carry most of the money?

### Rung 3 — the children — BUILT 2026-09-29

1. `payback` · `onbehalf` · `regular` under `p2p`, no `kw`, version 1 → 2,
   `updated` 2026-09-29. **Done.**
2. `npm run build` regenerated `11-taxonomy.js`, `taxonomy.mjs` and
   `taxonomy.py`; the worker twin is committed and NOT deployed (§8), and no
   worker tier can emit a code with no keywords. **Done.**
3. Pinned in `tools/p2p-person-groups.test.js`; `tree-cascade` 244/244 (the
   generated-target lockstep check passes). The picker draws children from
   `FH_TAX.children('p2p')`, so they appear under "Chuyển cho người khác" with
   no further change.

## 18. Working rules for all three

- `index.html` is generated: edit `src/`, `npm run build`, `npm run check`,
  commit both together.
- `CACHE_NAME` read from `origin/main` before each bump.
- No migration is claimed; `0155` is the next free number (`0154` is applied).
- One deploy for all three rungs, at the founder's call; the §17 before-numbers
  are the baseline, the after is read once from the queue and the breakdown.
- `mailbox-sync` is not deployed by any rung. If that changes, it is a separate
  decision with its own hash-diff.
- No rung carries another rung's UI.
