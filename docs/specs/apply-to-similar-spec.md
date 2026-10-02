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

> **Amended 2026-10-02 — one carry surface (A16–A21). BUILT, client only, SW v608,
> no migration, no deploy.** The card used to show two near-identical offers with
> two different counts: this block, and the bottom bar's older "Áp cho N khoản
> giống". The bar's verb is retired and this block does its one unique job too:
> **Loại khoản now carries**, with its follow-up answer (A16, reversing the kind
> half of A7). Also new: edits **stack**, one line and one undo per field (A17); a
> row the person set **by hand is never overwritten** (A18); the count can be
> **looked at before it is applied** (A19); a row with no payee falls back to its
> **wording** (A20); **Danh mục thu nhập** carries. §1, §3–§6, §8, §10 and §13 are
> amended in place; where the A1–A15 text and A16–A21 disagree, the later one runs.

> **Amended again 2026-10-02 (later) — a button and a sheet, and the same in the
> book (A22, A23, L1–L7). BUILT, client only, SW v609, no migration, no deploy.**
> The block under the rows is gone. The card now shows a dot on each changed row
> and **one full-width outlined button on its own line in the bottom bar**; it
> opens a **sheet**: what will change, the rows it would reach (each can be
> unticked; a hand-set row arrives unticked), the booked rows as a switch, one
> CTA (§3a). The sheet replaces both "Xem" (A19's filter) and the timed
> arm-then-confirm on the booked rows. And the pattern now exists **in the ledger**:
> after Lưu on a personal expense's detail, the same button and the same sheet
> carry Danh mục and Tiêu vào gì to the payee's other booked rows (§15). §3, §8's
> block copy and §10's block, look and ledger-tap paragraphs describe the
> morning's presentation and are superseded by §3a; the rules about WHAT carries
> and to WHICH rows (§4, §5, A1–A21) stand. Mockups: `mockups/carry-block-options.html`
> (direction D, bar 1b), `mockups/carry-ledger-options.html` (option A).

> **How this relates to its siblings.** `transaction-review-spec.md` owns the
> queue and its card; this spec adds one block to the expanded card and two
> verbs. `p2p-breakdown-spec.md` owns the person key (P4) this spec's "similar"
> rests on, and the lesson store's đồng contract (P10). `category-tree-spec.md`
> owns the tree and the cascade; the memory this spec writes is the cascade's
> `learned` tier, unchanged in shape. The pre-existing bottom-bar verb "Áp cho N
> khoản giống" (whole-classification copy over `ready`, same wording, same
> bank) was retired on 2026-10-02; §6 records what it did and where each part went.

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
- **It can be undone (A11), a line at a time (A17).** Each changed field has its
  own "Hoàn tác", which reverts that field on the card and on every row it was
  carried to, and forgets the lessons it wrote; the ledger half has its own undo.
- **What carries (A7, A16):** Ghi vào, Loại khoản (with which card / which
  account / who / which position), Danh mục, Danh mục thu nhập, Tiêu vào gì,
  Ai trả. Amount, date, time, description, hẹn trả and số lượng never do: they
  are facts about one row.
- **It never overwrites your own answer (A18).** A row you already set by hand,
  per row or through a bulk verb, is left alone, and the block says how many.
- **You can look first (A19).** "Xem" narrows the queue to exactly the rows the
  pill names; "Xem tất cả" brings the rest back.
- **It is the only carry offer on the card (A21).**

## 2. Why this exists

Memory already existed: a "Tiêu vào gì" pick taught a node lesson, a "Danh mục"
pick taught a label lesson, both keyed on payee + amount band. What did not exist
was any effect on the **present** queue — the cascade runs once when the queue is
built, and nothing re-resolved the sibling cards after a pick. So the founder
corrected one transfer, watched it vanish behind the filter, and faced twelve
identical cards with no way to say "these too". The lesson would have fixed
*next* month; this month was a card at a time.

## 3. What you see

Expand a card, change any of the six carried rows, and under the rows a quiet
block appears. Change a second row and it gains a second line:

```
Đã đổi Loại khoản         → 🤝 Cho vay · LE KHA NIN     Hoàn tác
Đã đổi Tiêu vào gì        → Tiền nhà                    Hoàn tác
[ Áp dụng cho 9 khoản khác của LE KHA NIN     ]  Xem
Giữ nguyên 2 khoản bạn đã tự sửa
… và 12 khoản đã ghi
```

- Each status line names one field, its new value, and its own undo (A17). The
  block is the reason the card is still on screen under a filter. Picking the
  same field again updates its line; its undo still goes back to what the card
  said before the first pick. A later pick that takes an earlier one back drops
  that line: a scope flip to Gia đình clears the kind, and a loan has no category.
- The kind line names the kind **and** the answer to its follow-up question
  (who, which card, which account, which position), read off the card as it
  stands. Correcting only the follow-up of a machine-chosen kind creates the line.
- One pill carries every line. It names the payee as the bank printed it (P8) and
  the count of rows it would actually change: rows that already say the same
  thing are not counted, so the pill disappears once there is nothing left to do.
  With no payee to name it reads "… khoản cùng nội dung" (A20). Hidden when N = 0.
- **Xem** narrows the queue to the card and those rows; the bar under the widgets
  ("Đang xem N khoản khác của … · xem tất cả") or a second tap ends it (A19).
  It outranks the category and person filters while it is on, and they come back
  when it ends.
- The skipped line appears only when rows were left alone because the person had
  already set that field on them by hand (A18).
- The third line appears only for Tiêu vào gì and Danh mục, only when the
  personal ledger is unlocked, and only when M > 0. Tap once: "Chạm lần nữa để
  đổi 12 khoản đã ghi". Tap again within a few seconds: it runs, says "Đang
  đổi…", and reports only after every write has landed. Then: "Đã đổi 12 khoản
  đã ghi · Hoàn tác".

After the pill: "Đã áp dụng cho 9 khoản khác của LE KHA NIN". Each line's "Hoàn
tác" now reverts that field on the card **and** on the rows it reached. With two
ledger-capable lines, each ledger line is tagged with its field.

The block appears with or without a filter (A13). Clearing or changing the
filter removes every block (A1) — and the cards that no longer match go with it.

## 3a. The card and the sheet (2026-10-02, later — supersedes §3's presentation)

**On the card.** A carried row the person changed wears the detail screen's
pending mark: a brand dot after its label and the value in brand ink. Nothing
else is added to the body. In the bottom bar, on its own line above delete and
"Nhập khoản này", one outlined button:

```
[   Áp dụng cho 9 khoản khác của TRAN MINH KHOA   ]
[🗑] [            ✓ Nhập khoản này               ]
```

- It is absent until a carried field changed **and** there is something to carry
  it to: queue rows, or booked rows ("Áp dụng cho 12 khoản đã ghi của …").
  Hidden, never disabled.
- The name is the printed payee less the account number the bank prints in front
  of it (display only; the key is unchanged). No payee: "… khoản cùng nội dung".
- The count is the rows that are ticked. After a carry, with nothing ticked left,
  the button turns quiet, "Đã áp dụng cho N khoản", and still opens the sheet.
- Cards with no bottom bar of their own (Có thể trùng, Để riêng, a merchant
  group) get the same button on a bar that holds only it.

**The sheet** ("Áp dụng cho khoản giống" · "Cùng người nhận: …"), top to bottom:

1. **Sẽ đổi** — one row per changed field: label, new value, "Hoàn tác". That
   undo is A17's: the field on the card, every row it was carried to, its lessons.
2. **N khoản đang chờ duyệt** — the rows a carry would change: day · memo, what
   the row says today, amount, and a tick. Ticked by default; a row the person
   set by hand is listed last, unticked, marked "bạn đã tự sửa", and can be
   ticked on purpose (A23). Four rows show, then "Xem cả N khoản".
3. **Đã áp dụng · K khoản** (after a carry) with one "Hoàn tác" that takes the
   carry back and keeps the card's own edit.
4. **Đã ghi trong sổ** — a switch, "Đổi cả M khoản đã ghi", when a Tiêu vào gì or
   Danh mục line has booked rows (A4, A9); after it ran, "Đã đổi M khoản đã ghi ·
   Hoàn tác". The switch is off by default: the CTA is the confirm (A10).
5. **One CTA** that says exactly what it will do: "Áp dụng cho 8 khoản",
   "… và 12 khoản đã ghi", "Đổi 12 khoản đã ghi", or "Xong" when nothing is
   ticked. While booked rows are being written it reads "Đang đổi…" and cannot be
   fired twice; the sheet closes and the toast speaks only after every write
   landed (DESIGN §4.2).

Nothing is written before the CTA. Closing the sheet keeps the ticks.

## 4. What "similar" means

Same payee, any size (A2): the bare payee key — the counterparty's letters with
bank noise, gateways and every digit removed (`csvPatternKey`), at least six
letters long. When a row has no usable payee (a phone number, an account number),
the key falls back to the **wording**: the description with digits stripped, at
least six characters, from the **same bank** (A20) — the retired bar verb's key.
The two key spaces never mix. Across all four buckets (A12): the ready list,
merchant groups, "Có thể trùng" and "Tụi mình để riêng". Same direction: money
out never shares an answer with money in. Never the card itself, never a row
that already says the same thing, never a row the person set by hand (A18).

Two rules differ by field:

- **Category-shaped fields** (Ghi vào, Danh mục, Danh mục thu nhập, Tiêu vào gì,
  Ai trả) leave rows whose kind is not a plain spend or income alone (card
  payment, transfer leg, loan, repayment, investment): a category on a repayment
  is not a thing, and a scope flip would clear its kind.
- **Loại khoản** (A16) reaches rows of **any** kind, because changing the kind is
  the point, but only in the **ready list**: the other three buckets each hold
  their own open question (duplicate? spending? which category?) and a kind
  change there would answer it sideways.

A card reached in another bucket **stays in its bucket (A14)**. "Is this a
duplicate?" and "is this spending?" are still unanswered and still yours.

## 5. What is remembered

| You did | Memory written |
|---|---|
| Changed one card | Exactly as before this spec: node → one banded lesson for this payee at this size; label → the existing label lesson (bare + banded) |
| Tapped "Áp dụng cho N khoản" | One lesson **per row touched**, at that row's own band (A5). Node → `fhLessonLearnNode`; label → the banded key only, never the bare one |
| Tapped "… và M khoản đã ghi" | The same, per booked row, at that row's band |
| Tapped "Hoàn tác" on a line | Every lesson that line wrote is put back to what it was: a previous lesson restored, a fresh one forgotten |
| Carried Loại khoản, Ghi vào, Ai trả, Danh mục thu nhập | Nothing at carry time. A kind is learned where it always was: at import, when the row is actually written (`fhKindLearn`, 0122), so a carried loan teaches exactly as a hand-picked one does |

## 6. One verb (was: two verbs, two jobs)

Until 2026-10-02 the bottom bar carried a second offer, "Áp cho N khoản giống"
(2026-09-04): it made lookalike ready rows **exactly like this one** — kind flags,
card, destination, label, payer — over rows with the same wording from the same
bank. It was kept apart from this block on purpose, and that turned out wrong on
the screen: one card showed two sentences that read the same with two different
counts. It also had defects of its own: no undo and no preview, it did not copy
Tiêu vào gì (the value the card's chip leads with), it overwrote rows the person
had already corrected, it copied a per-row fact (số lượng), and its wording key
is empty on transfers to people, the rows where a kind matters most.

It is retired (A21). Where each part went:

| The bar verb did | Now |
|---|---|
| Copy Loại khoản + its follow-up | The kind line of this block (A16) |
| Copy Ghi vào, Danh mục, Ai trả | Already this block's job |
| Copy Danh mục thu nhập | A carried field of this block |
| Match by wording + bank | The fallback key, when the row names no payee (A20) |
| Offer itself with nothing changed | Gone: a carry follows an edit (A3, A13) |

The bottom bar is now delete and "Nhập khoản này".

## 7. Deliberately unchanged

- No question is asked; nothing applies by itself (A3; E14 stands).
- Bucket membership never changes from this block (A14). A carried kind can move
  a ready row between the queue's three lists (spending / money in / transfers),
  exactly as picking that kind on the row would; it stays in `ready`.
- A kind has no ledger line: converting booked rows is per row, from the detail
  screen (`category-tree-spec.md` §14, bulk kind conversion is still out).
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
| Status line | one per field; labels add **Loại khoản** (value: the kind, then ` · ` and the follow-up answer) and **Danh mục** for income |
| Queue pill | **Áp dụng cho N khoản khác của <tên>**; no payee: **Áp dụng cho N khoản cùng nội dung** |
| After apply | **Đã áp dụng cho N khoản khác của <tên>** / **… N khoản cùng nội dung** |
| Look first | **Xem** · on: **Xem tất cả** |
| Look bar | **Đang xem N khoản khác của <tên> · xem tất cả** / **Đang xem N khoản cùng nội dung · xem tất cả** |
| Left alone | **Giữ nguyên K khoản bạn đã tự sửa** |
| Ledger, two lines | the idle and done texts end with ` · <Tiêu vào gì / Danh mục>` |
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

*(Rewritten 2026-10-02 for A16–A21.)*

**State lives on the candidate.** `c._fix = { id, items:{ <field>: item }, peek }`,
`item = { f, v, prev, lesson, hand0, applied, ledger }`: `f` ∈ scope · kind · cat ·
inccat · node · who; `prev` the snapshot to restore (scope and kind share one
snapshot set: `_scope`, the kind flags, their follow-ups, `_kindPicked`,
`_sigHold`); `lesson` what the original pick wrote (captured **before** the pick
taught); `hand0` whether the card's field was already hand-set; `applied` =
`{ rows:[{r, prev, lesson}] }`; `ledger` = `{ state, rows, done:[{t, prev, lesson}] }`
on node and cat items. A registry `csvFixes[id] → c` lets `onclick` find the card
whatever bucket or index it is rendered at. Lines render in `CSV_FIX_ORDER`.

**The hand mark (A18).** `c._hand[field] = 1` is written by `csvHandMark` from
every per-row pick (through `csvFixRecord`) and every bulk verb over a selection
(`csvBulkCat`, `csvBulkNode`, `csvBulkScope`, the merchant-group pick). A carry
never writes it. `catSource === 'user'` could not serve: a carry sets that too.
`_hand.paycard` marks a card the person picked, as opposed to the one the kind
pick resolved by itself.

**Recording.** `csvSheetPick` (node, cat, inccat, who), `csvPickRowScope`,
`csvPickRowKind`, and through `csvFixKindTouch` every follow-up
(`csvPickPayCard`, `csvPickXferAcct`, `csvPickRepayWho`, `csvPickLoanWho`,
`csvPickInvPos`, the two typed names in `csvSheetValDone`, the two "Tạo"
handlers) call `csvFixRecord(c, f, v, prev, lesson)` before rendering. The same
field again keeps the first `prev`. `csvFixPrune` then drops every other line
whose value the card no longer holds (`csvFixHolds`).

**Pinning (A1).** `csvCatHide(c)` returns `false` for any `c._fix`.
`csvCatFilterGo` / `csvPersonFilterGo` / a fresh queue open call
`csvFixClearAll()`, which also ends a look.

**Similar (A2, A12, A16, A18, A20).** `csvFixKey(c)` is `'p:' + csvPatternKey(c)`
at six letters or more, else `'w:' + csvSimKey(c) + '|' + csvStagedProvider(c)`.
`csvFixRowsFor(c, item)` walks all four buckets (`ready` only for a kind); keeps
`r !== c`, same key, same direction; drops kind rows unless the field is the
kind; applies the node-kind rule (`_okN`, with E2's allowance); drops rows that
already say it (`csvFixSame`); and sets aside rows with `r._hand[f]` as `skip`.
`csvFixPending(c)` is the union over the lines.

**Apply (A3, A5, A14, A17).** `csvFixApply(id)` walks the lines in order and, per
row, snapshots, sets the one field, and teaches (node and label only). A kind is
copied by `csvFixKindCopy`: the flags; `_scope = 'personal'` for the kinds the
family book cannot hold; the follow-up — the person or position as picked, the
counterpart account only where it is not the row's own instrument
(`csvFixXferOk`), the card from each row's own mail (`csvPayCardFor`) unless the
person picked one. `_loanDue` and `_investQty` are never copied. A row reached
twice keeps its first snapshot.

**Undo (A11, A17).** `csvFixUndo(id, f)`: restore the card's `prev` for that
line, every applied row's `prev`, every lesson, the hand mark if the line set it;
drop the line, prune, and drop the block with its last line.

**Look first (A19).** `csvFixPeekGo(id)` stores the rows (pending ∪ applied) on
`fx.peek` and sets `csvFixPeek`; `csvCatHide` then hides everything but the card
and those rows, ahead of every other filter. While it is on: select-all acts on
what is visible (P11), transfer-pair proposals stand down, and the reveal window
does not cut the list. The way out renders even with the widgets folded.

**Ledger half (A4, A9, A10).** Per node or cat line, unchanged in substance:
`csvFixLedgerScan(id, f)` → `fhPersonalMatchSlice()` → `!link && kind ===
'expense'` rows on the payee key (never the wording key); idle → armed (3 s) →
busy → done, toast from the completion handler (DESIGN §4.2);
`csvFixLedgerUndo(id, f)` replays backwards through the same writers.

## 11. Open questions

- ~~Should the bottom-bar "Áp cho N khoản giống" adopt the payee key?~~ Closed
  2026-10-02: the verb is retired and its wording key is this block's fallback (§6).
- A line dropped by a later pick (A17) loses its own undo; the later line's undo
  restores the card, but rows the dropped line had already been carried to keep
  the carried value. Rare (carry a category, then turn the card into a loan);
  recorded, not built around.
- Undoing a queue line whose ledger half already ran drops that ledger line's
  undo with it (true before this amendment too). The ledger rows keep the value.
- A kind carried to the family-scoped half of a payee's rows moves them to the
  private book (loans, repayments, investments, transfers live only there). The
  count and "Xem" show them first; there is no separate warning.
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
| A7 | **Only category-shaped edits carry:** Tiêu vào gì, Danh mục, Ghi vào, Ai trả. Per-row facts never. ~~Loại khoản never.~~ *(the kind half reversed by A16)* |
| A8 | **When mass-apply empties the filtered view, the view stays.** Q1's rule, consistently. |
| A9 | **Ledger side = personal book, mirror rows excluded, all months.** Family rows carry no payee yet. |
| A10 | **The ledger half is its own tap with a one-line confirm** (arm-then-confirm in place). |
| A11 | **Undo reverts the queue change and forgets its lessons; the ledger half has its own undo.** |
| A12 | **All four buckets are candidates for "similar".** |
| A13 | **The block appears after any category-shaped edit, filter or not.** |
| A14 | **A card reached in another bucket stays in its bucket.** The field changes; the bucket's question stays open. |
| A15 | **The payee on a personal row is `who`; on a family row `who` is the member.** `fhPersonKeyRow` never reads `who`; callers map it. Corrects v594. |

Added 2026-10-02, from the founder's question "why are there two CTAs?":

| # | Decision | Why |
|---|---|---|
| A16 | **Loại khoản carries, with its follow-up answer; ready list only; no ledger half.** Reverses the kind half of A7. Per-row facts (hẹn trả, số lượng) still never. | It was the one job the bar verb did that people need ("these nine are all loans to him"), and the only reason two offers existed |
| A17 | **Edits stack: one line and one undo per field, one pill for all.** The same field again keeps the first snapshot; a line the card no longer holds is dropped. | One slot per card meant a second correction silently replaced the first one's offer and its undo |
| A18 | **A carry never overwrites a row the person set by hand**, and says how many it left. Tracked by an explicit mark, not by `catSource`. | Both verbs rewrote hand-corrected rows off-screen |
| A19 | **The count can be looked at before it is applied.** "Xem" narrows the queue to those rows. | The payee key folds two people with one name and spans 16k to 5tr; a blind count is a leap |
| A20 | **No payee → the wording from the same bank.** One fallback, never mixed with the payee space; no lesson and no ledger half under it. | Keeps the bar verb's reach for rows whose counterparty is a number |
| A21 | **One carry surface.** The bottom bar's "Áp cho N khoản giống" is removed. | Two near-identical sentences with two counts on one card |

Added 2026-10-02 (later), from the UI review (`mockups/carry-block-options.html`):

| # | Decision | Why |
|---|---|---|
| A22 | **The card shows a dot per changed row and ONE full-width outlined button in the bottom bar; everything else lives in a sheet.** The block is removed. Chosen from four directions (D), with the bar on its own line (1b). | The block ran to seven rows and 300px, said each change twice, truncated the payee, and put brand ink on eight controls |
| A23 | **The sheet's ticks decide.** Every row a carry would reach is listed and can be unticked; a hand-set row arrives unticked and may be ticked on purpose. Supersedes A19's "Xem" filter and refines A18: never overwritten *by default*. | A preview that is the rows themselves beats a filter that moves the queue behind the open card |
| A10′ | **The booked rows are a switch read before the CTA**, not a timed arm-then-confirm line. | A write to booked rows should not hang on a text that swaps for three seconds |

The L series — the same carry in the book (`mockups/carry-ledger-options.html`, option A):

| # | Decision | Why |
|---|---|---|
| L1 | **After Lưu on a personal expense's detail, the view state shows the same button; it opens the same sheet.** | One pattern to learn, one sheet body to build (`fhCarryBodyHTML`) |
| L2 | **Fields: Danh mục and Tiêu vào gì only.** Kind and book are per-row conversions and moves with their own confirm. | The two the queue's ledger half already writes |
| L3 | **Rows: private expense rows of the same payee in the 365-day match slice.** Mirrors excluded; the family book has no payee (A9). | Same reach as the queue's "khoản đã ghi" |
| L4 | **A row that looks deliberate arrives unticked:** its value is neither empty nor what the edited row said before. | Booked rows carry no hand mark; this is the honest proxy |
| L5 | **Nothing is asked and nothing is offered until the save has landed.** The button stays until the person leaves the screen. | E14; a toast would expire, a prompt would interrupt |
| L6 | **A node teaches one banded lesson per row; a label teaches nothing from this screen.** | The label-lesson store is the review's and is not loaded here; writing it blind could clobber it |
| L7 | **No switch into the review queue.** Pending rows follow through the lessons the carry wrote, the next time the queue is built. | The queue is sealed and not loaded outside the review |

## 13. Module map

| File | Change |
|---|---|
| `src/js-ui/56-csv-import-ui.js` | `csvFixRecord` / `csvFixSimilar` / `csvFixApply` / `csvFixUndo` / `csvFixLedgerScan` / `csvFixLedgerTap` / `csvFixLedgerUndo` / `csvFixClearAll`; the block in `csvStagedRowsCard`; hooks in `csvSheetPick` and `csvPickRowScope`; `csvCatHide` pin; filter-change clears. **2026-10-02:** `csvHandMark`, `csvFixKey`, `csvKindLbl` / `csvFixKindLabel`, `csvFixHolds` / `csvFixPrune`, `csvFixKindTouch` / `csvFixKindCopy` / `csvFixKindSame` / `csvFixXferOk`, `csvFixRowsFor` / `csvFixPending`, `csvFixPeekGo` / `csvFixPeekBarHTML`; hooks in `csvPickRowKind` and every follow-up pick; hand marks in the bulk verbs; `csvSimilarRows` / `csvApplySimilar` and the bar button removed |
| `src/css/74-mailbox.css` | `.csv-fix*` — tokens only, 44px targets, one accent. **2026-10-02:** `.csv-fix-row`, `.csv-fix-peek`, `.csv-fix-skip`; `.csv-cta-ghost` removed |
| `src/js-ui/56-csv-import-ui.js` (later) | **A22/A23:** `csvFixBarBtnHTML`, `csvFixSheetOpen` / `csvFixSheetHTML` / `csvFixSheetRows` / `csvFixTick` / `csvFixSheetMore` / `csvFixLedgerToggle` / `csvFixSheetGo`, `csvFixUnapply`, `csvFixLedgerUndoAll`, `csvFixPayeeName`, the shared `fhCarryBodyHTML`; `csvRowSheet === 'carry'`; `.chg` on changed rows. Removed: `csvFixBlockHTML`, `csvFixPeek*`, `csvFixLedgerTap` |
| `src/js-ui/61-expense-detail.js`, `src/index.html`, `src/css/46-expense-detail.css` | **L1–L7:** `pexdCarryScan` / `_pexdCarryPaint` / `pexdCarrySheet` / `pexdCarryRender` / `pexdCarryTick` / `pexdCarryGo` / `pexdCarryUndo`; the `#sheet-carry` shell; the foot button |
| `src/css/74-mailbox.css` (later) | `.csv-cta-sec`, `.cry-*` (the sheet body), the staged `.csv-srow.chg`; every `.csv-fix*` rule removed |
| `tools/txn-detail-view-edit.test.js` | the "bottom bar is emptied" pin now allows the one carry door |
| `tools/p2p-person-groups.test.js`, `tools/staged-bulk-select.test.js` | **2026-10-02:** harness stubs for `csvFixPeek` / `csvHandMark` (their sliced `csvCatHide` / `csvStagedSelectAll` / `csvBulkCat` now read them) |
| `src/js-ui/13-partition.js` | `fhPersonKeyRow` never reads `who` (A15) |
| `src/js-ui/60-transactions.js`, `21-personal.js`, `61-expense-detail.js`, `src/js-data/28-tree-backfill.js` | personal `who` → payee; family → null (A15) |
| `src/js-data/19-personal.js` | `fhPersonalMatchSlice` decrypts `who` |
| `src/js-data/28-tree-backfill.js` | cursor v10 → v11 |
| `tools/apply-to-similar.test.js` | the contract, on the real functions |

## 15. In the book — the ledger detail (L1–L7)

On the personal transaction detail (`61-expense-detail.js`), `pexdSave` captures
what the row said before the write. When the row is an expense and Danh mục or
Tiêu vào gì actually changed, `pexdCarryScan` reads `fhPersonalMatchSlice()` and
keeps `!link && kind === 'expense'` rows with the same `csvPatternKey` that do
not already agree, unticking the deliberate ones (L4). `_pexdCarryPaint` then
draws the button into `#pexd-cta` in the view state only; `pexdCarrySheet` fills
`#sheet-carry` through the shared `fhCarryBodyHTML`.

`pexdCarryGo` writes one row at a time through the ledger's own writers
(`fhPersonalUpdateExpense(…, quiet)` for the label, `fhPersonalSetNode` for the
node, with a node lesson in đồng per row), shows "Đang đổi k/N…", then
invalidates the slice, hydrates once, refreshes the tab and the list, and only
then closes the sheet and toasts. The button turns quiet; the sheet then shows
the applied rows with "Hoàn tác" (`pexdCarryUndo`, backwards through the same
writers, lessons restored or forgotten). The offer is dropped when the detail
closes or another row opens.

Not built here: the family detail (family rows carry no payee in memory); a row
opened straight into edit from a zoom-in (it closes on save, so there is no view
state to carry the button); label lessons (L6).

## 14. Related

- `docs/specs/p2p-breakdown-spec.md` — P4 (the key), P8 (the printed name), P10 (đồng).
- `docs/specs/transaction-review-spec.md` — the card this block lives in.
- `docs/specs/category-tree-spec.md` — the `learned` tier this writes into.
- `DESIGN.md` §3 Buttons, §4.2 Async actions — the arm-then-confirm and "report after the write lands" rules the ledger half follows.
