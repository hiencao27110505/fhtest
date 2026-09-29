# Corrections that carry — a change on one card reaches its siblings, and is remembered

You open a card in the review queue, change what it was, and the card vanishes:
the filter you were in no longer matches it. Twelve other cards from the same
payee sit in the queue with the same wrong answer, and next month's will arrive
wrong again. This spec makes one correction do the whole job: the card stays put
and says what changed, offers to apply the change to the payee's other cards —
in the queue and in the book — and remembers exactly what you approved.

> **Status, 2026-09-29. BUILT in one landing, with `p2p-breakdown-spec.md`'s
> follow-ups.** Agreed the same day in a fourteen-question grilling (§12). No
> migration; no worker change. It also corrects a defect shipped that morning:
> the personal ledger's person rows were keyed on the note, because personal
> rows carry the payee as `who`, not `counterparty` (§9, A15).

> **How this relates to its siblings.** `transaction-review-spec.md` owns the
> queue and its card; this spec adds one block to the expanded card and two
> verbs. `p2p-breakdown-spec.md` owns the person key (P4) this spec's "similar"
> rests on, and the lesson store's đồng contract (P10). `category-tree-spec.md`
> owns the tree and the cascade; the memory this spec writes is the cascade's
> `learned` tier, unchanged in shape. The pre-existing bottom-bar verb "Áp cho N
> khoản giống" (whole-classification copy over `ready`, same wording, same
> bank) stays as it is; §6 says why the two are different jobs.

---

# Part 1 — Behaviour

## 1. Summary

- **The card you changed does not disappear (A1).** Under any filter, a card you
  just corrected stays exactly where it is, marked with what changed, until you
  clear or change the filter. Leaving the filter is your act, never the card's.
- **It offers to carry the change (A3).** "Áp dụng cho N khoản khác của <payee>"
  — a tap, never automatic. N counts the payee's other cards across the whole
  queue (A2, A12): same payee, any amount.
- **And to the book (A4, A10).** "… và M khoản đã ghi" — a second, separate tap
  with a one-line confirm, because it moves numbers already on your charts.
- **It remembers what you approved, and only that (A5).** The mass-apply writes
  one lesson per size bucket it actually touched. Nothing is learned for sizes
  you never saw.
- **It can be undone (A11).** "Hoàn tác" reverts the queue change and forgets
  the lessons it wrote; the ledger half has its own undo.
- **Only category-shaped edits carry (A7):** Tiêu vào gì, Danh mục, Ghi vào,
  Ai trả. Amount, date, time, description and Loại khoản never do.

## 2. Why this exists

Memory already existed: a "Tiêu vào gì" pick taught a node lesson, a "Danh mục"
pick taught a label lesson, both keyed on payee + amount band. What did not exist
was any effect on the **present** queue — the cascade runs once when the queue is
built, and nothing re-resolved the sibling cards after a pick. So the founder
corrected one transfer, watched it vanish behind the filter, and faced twelve
identical cards with no way to say "these too". The lesson would have fixed
*next* month; this month was a card at a time.

## 3. What you see

Expand a card, change its category (any of the four), and under the rows a quiet
block appears:

```
Đã đổi Tiêu vào gì        → Tiền nhà              Hoàn tác
[ Áp dụng cho 9 khoản khác của LE KHA NIN        ]
… và 12 khoản đã ghi
```

- The first line names the field, the new value, and offers undo. It is the
  reason the card is still on screen under a filter.
- The pill applies the same change to the payee's other cards. It names the
  payee as the bank printed it (P8) and the count. Hidden when N = 0.
- The third line appears only for Tiêu vào gì and Danh mục, only when the
  personal ledger is unlocked, and only when M > 0. Tap once: "Chạm lần nữa để
  đổi 12 khoản đã ghi". Tap again within a few seconds: it runs, says "Đang
  đổi…", and reports only after every write has landed. Then: "Đã đổi 12 khoản
  đã ghi · Hoàn tác".

After the pill: "Đã áp dụng cho 9 khoản khác của LE KHA NIN". The one "Hoàn tác"
on the first line now reverts the card **and** the nine.

The block appears with or without a filter (A13). Clearing or changing the
filter removes every block (A1) — and the cards that no longer match go with it.

## 4. What "similar" means

Same payee, any size (A2): the bare payee key — the counterparty's letters with
bank noise, gateways and every digit removed (`csvPatternKey`), at least six
letters long. Across all four buckets (A12): the ready list, merchant groups,
"Có thể trùng" and "Tụi mình để riêng". Same direction: money out never shares
an answer with money in. Never the card itself. Rows whose kind is not a plain
spend (card payment, transfer leg, loan, repayment, investment) are left alone:
a category on a repayment is not a thing.

A card reached in another bucket **stays in its bucket (A14)**. "Is this a
duplicate?" and "is this spending?" are still unanswered and still yours.

## 5. What is remembered

| You did | Memory written |
|---|---|
| Changed one card | Exactly as before this spec: node → one banded lesson for this payee at this size; label → the existing label lesson (bare + banded) |
| Tapped "Áp dụng cho N khoản" | One lesson **per row touched**, at that row's own band (A5). Node → `fhLessonLearnNode`; label → the banded key only, never the bare one |
| Tapped "… và M khoản đã ghi" | The same, per booked row, at that row's band |
| Tapped "Hoàn tác" | Every lesson the block wrote is put back to what it was: a previous lesson restored, a fresh one forgotten |

## 6. Two verbs, two jobs

The bottom bar's "Áp cho N khoản giống" (pre-existing) makes lookalike ready
rows **exactly like this one**: kind flags, card, destination, label, payer —
the whole classification — over rows with the same wording from the same bank.
This block carries **the one edit you just made**, by payee, into every bucket.
They are kept apart on purpose: merging them would either widen the old verb to
kinds a payee does not share, or narrow the new one to wording. An open question
in §11 asks whether the old verb should learn the payee key too.

## 7. Deliberately unchanged

- No question is asked; nothing applies by itself (A3; E14 stands).
- Bucket membership never changes from this block (A14).
- The family book gets no ledger line (A9): family rows carry no payee in
  memory today.
- Ghi vào / Ai trả have no ledger line: moving booked rows between books is the
  cross-ledger move; a personal row has no payer.
- Import, retire, dedup: untouched. The block is a presentation over rows that
  stay where they are.

## 8. Copy

Vietnamese first, English twin via `L()`. No em-dashes in strings.

| Where | Copy |
|---|---|
| Status line | **Đã đổi <Tiêu vào gì · Danh mục · Ghi vào · Ai trả>** · **→ <giá trị>** · **Hoàn tác** |
| Queue pill | **Áp dụng cho N khoản khác của <tên>**; no payee name: **Áp dụng cho N khoản cùng người nhận** |
| After apply | **Đã áp dụng cho N khoản khác của <tên>** |
| Ledger, idle | **… và M khoản đã ghi** |
| Ledger, armed | **Chạm lần nữa để đổi M khoản đã ghi** |
| Ledger, busy | **Đang đổi M khoản đã ghi…** |
| Ledger, done | **Đã đổi M khoản đã ghi · Hoàn tác** |
| Ledger toast, after writes land | **Đã đổi M khoản đã ghi** / with failures **Đã đổi M khoản · K khoản lỗi, thử lại nhé** |
| Offline | **Cần mạng để đổi khoản đã ghi** |
| Undo toast | **Đã hoàn tác** |

---

# Part 2 — Technical appendix

## 9. The payee field — a correction

Personal rows decrypt `counterparty_enc` into **`who`** (`19-personal.js`), and
`who` on a **family** row is the paying member. So the payee may be read from
`who` only on personal rows, and never on family rows. Before this spec,
`raw.counterparty` at `60-transactions.js` was always `undefined`, and the p2p
person rows shipped in v594 keyed on the note alone.

Rule, one place: `fhPersonKeyRow(row)` reads `row._cp` / `row.cp` /
`row.counterparty` and **never `who`**. Callers map personal `who` → `_cp`
themselves: the list rows and `treeRows` in 60, the chart's `_keep` in 21, the
sweep for `scope === 'personal'`, the personal detail in 61. The family paths
pass `null`. `fhPersonalMatchSlice` now decrypts `who` too, for the ledger half.
The sweep's inputs changed, so the cursor moves (E10): `fh-tree-bf` v10 → **v11**.

## 10. Mechanics

**State lives on the candidate.** `c._fix = { id, f, v, prev, lesson, applied, ledger }`:
`f` ∈ node · cat · scope · who; `prev` the snapshot to restore (for scope: the
scope and the kind flags `csvScopeClearKinds` touches); `lesson` what the
original pick wrote (with the previous value at each key, captured **before**
the pick taught); `applied` = `{ rows:[{r, prev, lesson}] }` after the pill;
`ledger` = `{ state, rows, done:[{id, prev, lesson}] }`. A registry
`csvFixes[id] → c` lets `onclick` find the card whatever bucket or index it is
rendered at.

**Recording.** `csvSheetPick` (node, cat, who) and `csvPickRowScope` (both scope
surfaces) call `csvFixRecord(c, f, v, prev, lesson)` before rendering. A second
correction on the same card replaces its block; `prev` then points at the state
before *that* pick.

**Pinning (A1).** `csvCatHide(c)` returns `false` for any `c._fix`.
`csvCatFilterGo` / `csvPersonFilterGo` / a fresh queue open call
`csvFixClearAll()`.

**Similar (A2, A12).** `csvFixSimilar(c)` walks `ready`, `groups[].items`,
`dup[].c`, `deferred`; keeps `r !== c`, `csvPatternKey(r) === csvPatternKey(c)`
(≥ 6 letters), `!!r.isIncome === !!c.isIncome`, and drops kind rows
(`isTransfer/_xfer/_repay/_loan/_invest`). For `node` it also drops rows whose
kind the node cannot ride (the same `_okN` rule as the cascade, with E2's
transfer-on-expense allowance).

**Apply (A3, A5, A14).** `csvFixApply(id)`: per row, snapshot, set the one field
(`_node` + `_nodeSource='user'` · `categoryName` + `catSource='user'` · `_scope`
with `csvScopeClearKinds` when leaving personal · `who`), teach per row — node:
`prevLesson = fhLessonNode(...)`, then `fhLessonLearnNode(...)`; label: the
**banded** key only (`csvLearnKey(r)`), previous value kept, `csvLearnSave()`
once. Bucket untouched. Render.

**Undo (A11).** `csvFixUndo(id)`: restore the card's `prev`, every applied row's
`prev`, then every lesson: node → previous node re-learned or forgotten
(`fhLessonForgetNode`); label → previous value restored or key deleted,
`csvLearnSave()`. Drop the block. The ledger half undoes separately.

**Ledger half (A4, A9, A10).** On record (node/cat only, personal `ready`,
online), `csvFixLedgerScan(id)` awaits `fhPersonalMatchSlice()` (365 days,
cached, now carrying `who`), keeps `!link && kind === 'expense'` rows whose
`csvPatternKey({counterparty: who, description: note})` matches, and renders the
count. Tap: idle → armed (3 s reset) → run: `state='busy'`, render; node →
`fhPersonalSetNode(id, v)`; label → `fhPersonalUpdateExpense(id, {amt, note,
cat, emoji, time, dateIso}, true)`; a lesson per row in đồng (`amt × curMult()`);
then `fhPersonalMatchSliceInvalidate()`, one `fhPersonalHydrate()`, toast from
the completion handler (DESIGN §4.2). `done` keeps `[{id, prev, lesson}]`;
"Hoàn tác" replays them backwards through the same writers.

## 11. Open questions

- Should the bottom-bar "Áp cho N khoản giống" adopt the payee key beside its
  wording key? It would find the same N as this block for most rows. Not
  decided; the two verbs stay separate meanwhile (§6).
- The label path's original pick still writes the **bare** key (cross-size), as
  it always has; only the mass-apply is banded-only (A5). Whether the single
  pick should become banded-only too is a question for the label lessons, not
  this spec.
- `fhSyncMerchantCorrection` (the hashed merchant → concept hint that voices
  notifications) is per merchant, not per band, and has no undo. The block calls
  it as a single pick does; an undo leaves the server hint until the next pick.

## 12. Decision log — the A series

From the grilling of 2026-09-29. Q6 was folded into Q3.

| # | Decision |
|---|---|
| A1 | **The corrected card stays in place, marked, until the filter is cleared or changed.** |
| A2 | **Similar = same payee, any amount.** The bare payee key; amounts shown, never hidden. |
| A3 | **Suggested, never automatic.** A pill with the count; explicit tap. |
| A4 | **Both books.** Queue cards and booked personal rows. |
| A5 | **Mass-apply remembers one lesson per size bucket it touched.** Nothing for sizes never seen. |
| A7 | **Only category-shaped edits carry:** Tiêu vào gì, Danh mục, Ghi vào, Ai trả. Per-row facts and Loại khoản never. |
| A8 | **When mass-apply empties the filtered view, the view stays.** Q1's rule, consistently. |
| A9 | **Ledger side = personal book, mirror rows excluded, all months.** Family rows carry no payee yet. |
| A10 | **The ledger half is its own tap with a one-line confirm** (arm-then-confirm in place). |
| A11 | **Undo reverts the queue change and forgets its lessons; the ledger half has its own undo.** |
| A12 | **All four buckets are candidates for "similar".** |
| A13 | **The block appears after any category-shaped edit, filter or not.** |
| A14 | **A card reached in another bucket stays in its bucket.** The field changes; the bucket's question stays open. |
| A15 | **The payee on a personal row is `who`; on a family row `who` is the member.** `fhPersonKeyRow` never reads `who`; callers map it. Corrects v594. |

## 13. Module map

| File | Change |
|---|---|
| `src/js-ui/56-csv-import-ui.js` | `csvFixRecord` / `csvFixSimilar` / `csvFixApply` / `csvFixUndo` / `csvFixLedgerScan` / `csvFixLedgerTap` / `csvFixLedgerUndo` / `csvFixClearAll`; the block in `csvStagedRowsCard`; hooks in `csvSheetPick` and `csvPickRowScope`; `csvCatHide` pin; filter-change clears |
| `src/css/74-mailbox.css` | `.csv-fix*` — tokens only, 44px targets, one accent |
| `src/js-ui/13-partition.js` | `fhPersonKeyRow` never reads `who` (A15) |
| `src/js-ui/60-transactions.js`, `21-personal.js`, `61-expense-detail.js`, `src/js-data/28-tree-backfill.js` | personal `who` → payee; family → null (A15) |
| `src/js-data/19-personal.js` | `fhPersonalMatchSlice` decrypts `who` |
| `src/js-data/28-tree-backfill.js` | cursor v10 → v11 |
| `tools/apply-to-similar.test.js` | the contract, on the real functions |

## 14. Related

- `docs/specs/p2p-breakdown-spec.md` — P4 (the key), P8 (the printed name), P10 (đồng).
- `docs/specs/transaction-review-spec.md` — the card this block lives in.
- `docs/specs/category-tree-spec.md` — the `learned` tier this writes into.
- `DESIGN.md` §3 Buttons, §4.2 Async actions — the arm-then-confirm and "report after the write lands" rules the ledger half follows.
