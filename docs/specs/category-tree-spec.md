# Category Tree — one closed tree per kind, the person's labels on top

Every captured transaction lands on a real node of a system-owned tree, chosen by
the machine, without a model call per row. The person never sees that tree at
capture: they see their own labels, which are a **partition** of the tree. Budgets,
"Tiền đi đâu" and the review screen keep working exactly as today on day one; what
changes underneath is that "Khác" stops being where software puts things it could
not read.

> **Status, 2026-09-20.** Spec agreed after the grilling of 2026-09-19/20
> (decision log §16) and measured on two real mailboxes the same day (§12).
> Build is **in progress, additive**: `taxonomy/taxonomy.json` (v1, 214 nodes),
> `tools/gen-taxonomy.js`, the generated `src/js-ui/11-taxonomy.js` and the
> partition helpers in `src/js-ui/13-partition.js` are in the tree. Migration
> **0144**, the worker cascade on nodes, the on-device backfill
> (`28-tree-backfill.js`) and the tree surfaces (`63-tree-ui.js`) are the
> remaining steps. Rollback at any point is a display flag (C8), never a schema
> revert.

> **How this relates to its siblings.** `transaction-review-spec.md` §C is the
> cascade this replaces: eight flat concepts, resolved to a family category, with a
> catch-all fallback that 58.6% of one mailbox's rows fell into. This spec keeps
> §C's posture (a guess is a tappable default, never final; corrections learned
> only from an explicit pick, amount-banded) and changes what the cascade returns:
> a node code from one closed tree instead of one of eight words.
> `full-ledger-spec.md` fixed the kinds the trees hang off (`expense · income ·
> transfer · loan · repayment`, plus `investment` since 2026-09-06);
> `borrowing-lending-spec.md` explains why repayment has no tree of its own.
> `personal-ledger.md`'s "category is denormalised on the row" stays true; the row
> now also carries its node. `ARCHITECTURE.md`'s dedup model gains two rows (§6).

---

# Part 1 — Behaviour

## 1. Summary

- **Two layers (B).** L1 is the system tree: closed, exhaustive, one tree per
  kind, machine-assigned. L2 is the person's labels: the family's categories on
  the family book, a person's own labels on the personal book. Each L2 label
  *claims* L1 nodes; every node is owned by exactly one label; the catch-all
  label owns the root, so no node is ever outside the budget.
- **A row rests on the deepest confident node (Q2).** Resting on a group
  ("Ăn uống") when the evidence stops there is a correct, coarse answer, not
  "uncategorized". Only a person can file a row on the root "Chưa rõ" (Q9).
- **Free before paid, cached forever.** Seven tiers, the first that answers
  answers; the model is the last tier, asked once per new counterparty across
  all users, batched, and its answer is written to a global registry. Volume
  never touches the quota (§4).
- **Capture shows label chips, never the leaf picker (Q7).** The tree is a
  reading aid and a stats layer; the person refines, corrects, regroups. They
  never add nodes (Q1). The tree grows from real gaps, reported as words only
  and only with consent (Q11).
- **Nothing visible changes on day one (C1).** Same labels, same budgets, same
  totals. A stats layer selector appears; everything else waits for the person
  to look for it.

## 2. The two layers

### 2.1 L1: the system tree

The tree lives in one file, `taxonomy/taxonomy.json` (Q16). A node is
`{code, kind, parent, depth, vi, en, kw, concept, pool, rest, manual, derived}`:
an opaque permanent code, its kind, a structural parent, Vietnamese name with an
English gloss, deburred evidence keywords, the legacy `concept`/`pool` older
readers still need (C5), and three flags: `rest` (a group a row may honestly rest
on with no further evidence: "Chuyển cho người khác"), `manual` (only a person
can file here: the two "Chưa rõ" roots), `derived` (decided by structure, never
read: every transfer node, the two repayment signs).

Axis is **what the money bought** (Q4), at most three levels, uneven: deep where
habits differ (Đồ uống › Cà phê / Trà sữa / Bia rượu), flat where they do not
(Tiền điện). The expense skeleton is COICOP adapted to Vietnamese life (Q9) with
two groups COICOP lacks: **Biếu tặng & hiếu hỉ** and **Phí, thuế & bảo hiểm**
(Q10). There are no "Khác" leaves: **every parent is its own "other"**, so a
purchase that fits no leaf rests on its parent and the tree is exhaustive by
construction.

| Kind | Tree shape | Groups (depth 1) |
|---|---|---|
| Chi tiêu (`expense`) | 12 groups · 41 categories · 103 leaves | Ăn uống · Nhà ở & hoá đơn · Đi lại · Mua sắm · Sức khỏe & làm đẹp · Giải trí · Giáo dục · Biếu tặng & hiếu hỉ · Phí, thuế & bảo hiểm · Công việc & kinh doanh · Chuyển cho người khác (`rest`) · Chưa rõ (`manual`) |
| Thu nhập (`income`) | 7 groups · 21 categories | Lương & công việc · Kinh doanh · Đầu tư & tài sản · Được cho & nhận · Hoàn & bồi hoàn · Trợ cấp & hưu trí · Chưa rõ (`manual`) |
| Chuyển khoản (`transfer`) | 8 nodes, all `derived` | Rút tiền mặt · Nộp tiền mặt · Giữa tài khoản ngân hàng · Nạp & rút ví điện tử · Trả nợ thẻ tín dụng · Gửi & rút tiết kiệm · Nạp & rút tài khoản đầu tư · Đổi ngoại tệ |
| Vay & cho vay (`loan`) | 2 groups · 7 categories · 3 leaves | Đi vay (ngân hàng › mua nhà / mua xe / tín chấp · trả góp · công ty tài chính · người thân) · Cho vay (người thân · ứng trước & trả hộ · hụi & góp vốn) |
| Trả nợ & thu nợ (`repayment`) | 2 signs, no tree (Q5) | Trả nợ · Thu nợ; the row inherits its loan's node. Interest is an expense: Phí, thuế & bảo hiểm › Lãi vay & lãi thẻ |
| Đầu tư (`investment`) | 8 asset classes | Cổ phiếu · Quỹ · Trái phiếu · Vàng · Tiền mã hoá · Bất động sản · Tiết kiệm có kỳ hạn · Góp vốn kinh doanh |

### 2.2 L2: labels as a partition

A label is a family category (`categories`) or a personal label
(`personal_labels`). It carries `claims`: a list of node codes; a claim covers
the node's whole subtree. Rules (`13-partition.js`):

1. **Most specific claim wins.** If "Đi chợ" claims `groceries` and "Ăn uống"
   claims `food`, a row on `fresh` belongs to Đi chợ.
2. **`'*'` is the catch-all.** The fallback label ("Khác" / "Others") claims
   `'*'` and therefore owns the root and every node nothing else claims.
3. **One shared tree, one partition per scope (Q6).** The family has its
   partition; each person has their own over the same tree. A node's owner can
   differ between the family book and a member's private book.
4. **Stored label, per-row override (Q12).** The node gives the label its
   default at write time; the person may change the label on any row without
   touching the node. No keyword rules on labels in v1.
5. **Label and node may disagree (Q14).** The label is evidence for the node
   only when the note is weak (tier 6). The machine never changes a label.

**Default partitions (D1).** A new family's six seeded categories claim their
groups: Nhà ở → `home`, Đi chợ → `groceries`, Ăn ngoài → `eatout` + `drinks`,
Đi lại → `transport`, Giải trí → `leisure`, Mua sắm → `shopping`; Others claims
`'*'`. A family-less person gets labels derived from their own rows (distinct
category name + emoji, claims from `fhDefaultClaimsFor`) plus Khác `'*'`.

## 3. How a row lands

### 3.1 Step one: kind, from structure

Kind is decided before anything is read, from direction, the instruments on both
sides and a small fixed vocabulary. When structure also settles the category the
row is `derived`: no reading, no cache, no model.

| Signal | Kind | Node, when structure already says it |
|---|---|---|
| Debit whose counterparty is the holder's own name, or both legs in the queue (opposite direction, exact amount, ±1 day) | Chuyển khoản | From the two account kinds: ATM → `cashout`; deposit ↔ deposit → `bankbank`; deposit → ewallet → `wallet`; deposit → card → `cardpay` |
| Card-repayment vocabulary, `card_masked`, or `flow: transfer` | Chuyển khoản | `cardpay`, card pre-selected from the masked tail |
| Credit from a known lender, memo "giải ngân" | Vay | `borrow` › the lender's class |
| Debit to a known lender, or memo matches an open loan's counterparty and rhythm | Trả nợ | Inherits the loan's node |
| Credit from a person with an open cho vay row | Thu nợ | Inherits the loan's node |
| Broker, fund, gold shop or exchange as counterparty; "mua/bán CP", "NAV" | Đầu tư | Asset class from the registry |
| Credit, none of the above | Thu nhập | Income cascade (payroll sender → `salary`; "hoàn tiền" → `refund`) |
| Debit, none of the above | Chi tiêu | Expense cascade below |

### 3.2 Step two: category, seven tiers

Every tier returns a code from the same closed tree, so nothing downstream
translates.

| # | Tier | Scope · storage | What it answers |
|---|---|---|---|
| 1 | Shape statics | global · `sender_fingerprints` template | (sender, subject shape) pairs that always mean one leaf: EVN → `electric`, VNPT → `internet`. Frozen into the template like `direction`, only when the shape never produced a different node |
| 2 | Type codes & bill vocabulary | global · the tree file's `kw` | Bank machine phrases ("NAP TIEN DIEN THOAI", "MUA VE MAY BAY"), MCC on statements, brand words. Deepest, longest keyword wins; 3-letter words trusted only in short typed notes |
| 3 | Counterparty registry | global, hashed · `merchant_concepts.node` | The existing merchant cache, storing a node instead of a concept. Seeded offline with the common Vietnamese merchants and billers so the first user of a brand never pays |
| 4 | Personal lessons | per person, encrypted · `personal_lessons`, `merchant_corrections` | A note word or counterparty the person once filed, banded by amount ("chuyen tien" at 35k and 7M learn separately). Makes "cafe 50k" land on Cà phê the second time |
| 5 | Rhythm | per person, on device | Same counterparty, same round amount, monthly → rent / subscription / instalment by kind. Fills silence only; never overrides a text hit |
| 6 | The label the person tapped | this row | "200k" with label Ăn uống rests on `food`. A label spanning several groups (Con cái) contributes nothing; the row rests on the root until refined |
| 7 | Model, batched | global · `merchant_concepts` | Only what tiers 1 to 6 could not place. Answers a leaf from the closed enum, up to 20 unknowns per call, cached for everyone. The row is already staged on its tier 1 to 6 node; the model refines asynchronously. A 429 delays refinement, never staging |

A person's own correction (tier 4) outranks the registry (tier 3) for that
person; with enough agreement across people a correction is promoted to the
registry (Q8).

### 3.3 The "no others" guarantee, stated honestly

- Kind is always decided. Group is decided for every row with a memo, a
  counterparty, an MCC or a label tap, which is nearly every bank mail.
- The one honest gap is a bare transfer to a person with an empty memo and no
  history. It rests on **Chuyển cho người khác**, a real group with its own
  insight, not on the root. Next time that person appears, tier 4 has learned
  them.
- The root therefore holds only rows a person deliberately filed there. The
  target is < 1% of captured rows at the root after tier 7 has answered; the
  review screen reports the share while it has not.

## 4. What the person does

- **Refine.** Tap a row resting on a parent and pick among its children. Never a
  flat 90-item list.
- **Correct (Q3).** Siblings under the same parent first, the full tree behind
  search. The correction is learned per person and may be promoted.
- **Regroup (Q13).** Move nodes between their own labels in the budget sheet.
  The sheet asks **"Áp dụng cho N khoản cũ?"**, default yes; closed months are
  excluded. Budgets and totals follow the labels; the tree does not move.
- **Rename, split, hide (Q1).** Labels are the person's; nodes are not. A label
  can be split by handing some of its claims to a new label.
- **File as Chưa rõ.** The only way a row reaches the root.
- **See the tree (Q15).** Breakdown surfaces ("Tiền đi đâu", the personal
  category strip, budget detail) gain a layer selector: **Nhãn** (the labels, as
  today) · **Nhóm** · **Danh mục** · **Chi tiết**. The transaction list gains a
  tree filter. Budgets attach to labels only.
- **Report gaps (Q11).** Note words no tier recognised can be sent as bare words
  (never amounts, never notes) after an explicit opt-in, so the tree file grows
  from real gaps.

## 5. Backward compatibility, as the person experiences it

| | Rule |
|---|---|
| C1 | Nothing visible changes on day one except the layer selector. Labels, budgets, totals, review defaults: identical |
| C2 | Old rows are backfilled **coarse first** (the label's implied group), then refined on device from note and counterparty. A backfill never changes a label |
| C3 | Custom labels auto-map by name and emoji (`fhDefaultClaimsFor`). A label that maps to nothing keeps its rows and its budget; its nodes fall to Khác, and a **non-blocking regroup card** offers to fix the mapping later |
| C4 | Additive columns only; no flag day. A client that never learns about nodes keeps working |
| C5 | The pipeline emits the legacy `category_hint` (concept) and `pool` **and** the node for a window, so old builds and the notification copy see no change |
| C6 | Lessons and streaks re-key lazily: a concept-keyed lesson is read as before and rewritten with a node the first time it fires |
| C7 | The node is encrypted on the row in both ledgers, like the category name. The tree itself is public |
| C8 | Rollback is `localStorage['fh-tree'] = 'off'`: every tree surface hides, the cascade keeps writing nodes silently |

## 6. Two additions to the dedup model

Both extend `ARCHITECTURE.md`'s "what the same means" table; both are guesses,
so they may only propose, never delete or hide (an exact key may block, a guess
may only flag).

- **Receipt-join (D3).** A merchant receipt email (Grab, ShopeeFood, Shopee
  orders, Apple) is never imported as a row. It is matched to the bank or wallet
  row for the same money (exact amount, ±2 days, same person's queue) and
  **enriches that row's node** with what was bought; the receipt message is
  then retired. Unmatched receipts wait in the queue until their bank row
  arrives or the window closes. This is the only way a marketplace charge ("the
  bank names the platform, not the goods") ever passes group level.
- **Loan-pair (D4).** An exact amount sent to a person and the same amount
  received from a person within 45 days is proposed as **cho vay → thu nợ** (or
  vay → trả nợ by direction) in one grouped card, like the transfer pair.
  Propose-only; a rejection separates the rows back into ordinary candidates.

## 7. Copy

- Root node: **"Chưa rõ"**. Catch-all label: **"Khác"** (EN "Others").
- Regroup confirm: **"Áp dụng cho N khoản cũ?"** with "Tháng đã đóng không đổi".
- Layer selector: **Nhãn · Nhóm · Danh mục · Chi tiết**.
- Refine row hint: **"Chọn rõ hơn"** over the children of the resting node.
- Regroup card after migration: **"Nhãn 'X' chưa gắn với nhóm nào. Gắn ngay?"**
- Consent for gap words: **"Gửi những từ chưa nhận ra để cải thiện cây danh mục?
  Chỉ gửi từ, không gửi số tiền hay ghi chú."**

---

# Part 2 — Technical Appendix

## 8. Schema — migration 0144

All additive; every existing reader is untouched (C4).

| Table | Change | Notes |
|---|---|---|
| `transactions` | `node text`, `node_enc text` | Same off/dual/enc lifecycle as `note`/`amount`: plaintext column for `enc_state='off'` families, ciphertext for enc-committed ones; the enc-guard trigger learns the pair. `fhField` reads it like every other dual column |
| `categories` | `claims text[]`, `claims_enc text` | The family partition. Claims are node codes (public vocabulary) but the *shape* of a family's partition is private, so enc families carry `claims_enc` only |
| `personal_transactions` | `node_enc text`, `label_id uuid references personal_labels` | Ciphertext-only table, so no plaintext twin. `label_id` null = label resolved from the node at read time (the pre-0144 rows) |
| `personal_labels` (new) | `id, owner_user_id, name_enc, emoji, claims_enc, sort_order, hidden, created_at` | Owner-only RLS like every personal table. Replaces "no personal-category table" from `personal-ledger.md`; the denormalised `cat_name_enc` on the row survives for the C4 window |
| `merchant_concepts` | `node text` | Beside `concept`; both written for the C5 window, `node` authoritative when present |
| `merchant_corrections` | `node text` | Same; a correction row with only `concept` is re-keyed lazily (C6) |
| `get_family_snapshot` RPC | returns `node`/`node_enc` on transactions and `claims`/`claims_enc` on categories | Hydrate builds `window.catClaims` from it |
| `seed_default_categories` | writes `claims` for the six seeded categories (§2.2, D1) | Existing families are backfilled by the same mapping on first hydrate, client side, through the ordinary category writer |

Migration test on a branch first, as for 0109; the data backfill is on device
(§10.3), so the migration itself only adds columns and re-creates the two
functions.

## 9. The worker cascade (`_shared/mailbox/classify.mjs`)

Today's `enrichCategory` decides a concept in five steps (extractor's own →
user correction → curated dictionary → merchant cache → one-shot model). The
tree version keeps the seam and the order, and changes the vocabulary:

```
enrichCategory(extraction, grant, ctx)
  kind, derived node   ← structure (direction, account kinds, card_masked, flow)   [T-kind]
  1. extraction.node   ← the extractor's own answer (LLM saw the whole email)
  2. merchant_corrections.node for this owner (hash of merchantKey)                 [T4]
  3. TAX.keywordNode(merchantText, kind) from taxonomy.mjs (replaces DICTIONARY)   [T2]
  4. merchant_concepts.node, incl. the negative "tried, unknowable"                 [T3]
  5. model, batched (classifyBatch): schema enum = EXPENSE_LEAVES | INCOME_LEAVES  [T7]
     by direction; answer written to merchant_concepts {node, concept, pool}
  then: extraction.category = conceptOf(node); extraction.pool = poolOf(node)      [C5]
```

- `llm.mjs` extraction schema: `category` enum (the eight concepts) is kept and a
  `node` property with `enum: LEAF_CODES` is added; the prompt names the tree
  file's version so an answer from an older prompt can be told apart.
- `stage.mjs` writes `raw_extracted.node` beside `category_hint`; both sealed.
- `notify-copy.mjs` derives `{c, p}` from the node via `conceptOf`/`poolOf`, so
  the tiny enum that leaves the process is unchanged and copy is composed before
  sealing (C7).
- Tier 1 (shape statics) lands in `labeltable.mjs` as a template static named
  `node`, frozen by the same never-disagreed rule as `direction`.
- `mailbox-dryrun` reports depth reached per row (leaf / category / group /
  root) so §12 can be re-measured after any tree change.

## 10. Client module map

### 10.1 `src/js-ui/11-taxonomy.js` (generated)

`window.FH_TAX`: `get · children · isLeaf · ancestors · root · kindOf · roots ·
leaves · conceptOf · poolOf · rollup · pathVi · keywordIndex · keywordNode ·
deburr`. Regenerated by `build.js` before every assembly, so the client can never
drift from the JSON. Never hand-edited.

### 10.2 `src/js-ui/13-partition.js` (pure, no DOM, no key)

`fhTreeOn` (C8) · `fhLabelForNode(node, labels)` (most specific claim, `'*'`
catch-all) · `fhFamilyLabelFor` (from `window.catClaims`, falls back to
`CAT_FALLBACK`) · `fhPersonalLabelFor` (from `P.labels`) · `fhDefaultClaimsFor(name,
emoji, kind)` (exact vi/en name → keyword lifted to depth ≤ 2 → emoji map; the
catch-all name → `['*']`) · `fhNodeFromClaims` (T6: one non-star claim, else null)
· `fhNodeGuess({kind, note, counterparty, memo, amount, labelClaims})` (T4 lesson
→ T2 keywords → T6 label; repayment returns null and inherits) ·
`fhNodeCorrections` (siblings, parent, parent's siblings, then the kind's groups)
· `fhNodeDepth` (3 leaf · 2 · 1 · 0 for the coverage metric).

### 10.3 `src/js-data/28-tree-backfill.js` (new)

Runs after hydrate, idle-scheduled, resumable from a local cursor, both ledgers:

1. Rows without a node get the **coarse** node from their label's claims
   (`fhNodeFromClaims`), or nothing when the label spans groups.
2. Rows with a coarse node are **refined** by `fhNodeGuess` on note, counterparty
   and memo, **only when the guessed node's root equals the label's implied root
   (D2)**. A note that says "cafe" under a label that claims `home` keeps its
   coarse node; refinement never crosses the person's own grouping.
3. Writes go through the ordinary writers (`40-txn-writes-outbox.js`,
   `19-personal.js`) with node only; the label column is never touched (C2).

### 10.4 `src/js-ui/63-tree-ui.js` (new)

Layer selector on breakdown surfaces; tree filter in the transaction list; the
refine/correct picker (siblings first, search behind); the regroup sheet with
"Áp dụng cho N khoản cũ?" (closed months skipped); the non-blocking regroup card
for labels that mapped to nothing (C3); the gap-word consent card (Q11). All
gated by `fhTreeOn()`.

### 10.5 Changes in existing modules

| Module | Change |
|---|---|
| `30-hydrate.js` | Builds `window.catClaims` from the snapshot; backfills claims for existing categories once (D1) |
| `19-personal.js` | Loads `P.labels`; derives a family-less person's labels from rows on first run (D1); writers accept `node`, `labelId` |
| `40-txn-writes-outbox.js` | Family writers accept `node` (dual column through `fhField`) |
| `50-sheets-expense-capture.js` | On save, `fhNodeGuess` with the tapped label's claims; chips unchanged (Q7) |
| `72-txn-review.js`, `76-quick-review.js` | Promote reads `raw_extracted.node`; label default via `fhFamilyLabelFor`/`fhPersonalLabelFor`; the §C cascade becomes tiers 2 to 6 over nodes, `familyCatForConcept` retired behind C5 |
| `57-csv-import-review.js` | Lessons store node; `fhMerchantKey` unchanged (must stay byte-identical to the worker's `merchantKey`) |
| `24-lessons.js` | `fhLessonNode` (T4), amount-banded; lazy re-key from concept (C6) |
| `27-streaks.js` | Streak keys on node roll up via `FH_TAX.root`; concept-keyed streaks re-key on first read (C6) |
| `20-budget.js` | Budget rows unchanged (labels only, Q15); the regroup entry point |

## 11. Notification copy

Unchanged in shape. `push-send` still receives `{c, t, d, p}`; the worker
derives `c` and `p` from the node. Contextual lines keyed on pools (`coffee`,
`milktea`, `ride`, `cinema`) keep firing because those pools are attributes of
tree nodes now, not of a separate keyword table.

## 12. Measured on real mail, 2026-09-20

Original bank and wallet emails through the pipeline's own extractor
(`mailbox-dryrun`), then the seven tiers with a registry seeded by hand from the
brands seen. **A**: one year, VIB + Vietcombank + MoMo, 905 emails → 775
transactions. **B**: 90 days, MB Bank, 211 emails → 202 transactions, zero model
calls (every shape had a template). A transfer's single node counts as terminal.

| Where rows land | A · before model | A · after one batched call (19 companies) | A · + two Grab amount-band lessons | B · before model | B · after model (2 companies) | Today's pipeline |
|---|---|---|---|---|---|---|
| Leaf | 45.3% | 45.3% | 49.0% | 59.4% | 59.4% | 8 flat concepts; **58.6%** (A) and **68.8%** (B) get none, several wrong (REVI → Housing, Anthropic → Fun) |
| Category | 15.6% | 18.8% | 18.8% | 17.8% | 18.8% | |
| Group | 32.1% | 32.1% | 32.1% | 21.8% | 21.8% | |
| **Kind root** | **7.0%** | **3.7%** | **0%** | **1.0%** | **0%** | |

What the group-level rows are: transfers to people (150 in A, 29 in B: rent,
family support, sellers, friends; the memo says who, never what; about half of
A's money) and marketplace charges (~110 in A, 15 in B). Correct, coarse answers.

What made the root reach 0%: structure settled 99 transfers, including 80 card
repayments the current extractor labels `p2p_transfer`; one model call for 19
never-seen companies; Grab (29 rows) is the only brand spanning two groups and
the amount-banded lesson splits it after two corrections (≤60k rides, larger
orders). About half the leaf hits came from brands a curated top-N seed carries.

Cost model: calls are bounded by distinct new counterparties across all users,
not by volume. 228 mails in a 90-day backfill held ~40 distinct counterparties,
~2 model calls first time, 0 for the next family on the same banks.

## 13. Taxonomy evolution rules

Enforced by `tools/gen-taxonomy.js` at every build (a violation fails the build,
because a broken taxonomy silently corrupts stored rows):

- **One source, three targets:** `taxonomy/taxonomy.json` →
  `src/js-ui/11-taxonomy.js` (classic script, `window.FH_TAX`),
  `supabase/functions/_shared/mailbox/taxonomy.mjs` (ESM, exports `LEAF_CODES`,
  `EXPENSE_LEAVES`, `INCOME_LEAVES` for the LLM schema), and
  `earthy/serverless/functions/transaction-parser/parser/taxonomy.py`. Output is
  deterministic; the client can never drift from the JSON.
- **Codes are opaque and permanent:** `[a-z][a-z0-9]*`, unique across all
  kinds, never encode the parent. Re-parenting edits the file, not a stored row.
- **Structure:** every parent exists and is of the same kind; roots are depth 1;
  depth ≤ 3.
- **A code is never deleted or reused.** A **split** adds children; old rows
  rest on the parent and are right in the meantime. A **merge** leaves the
  retired code in the file as an alias of the survivor. A client that meets a
  code it does not know **rolls it up** to the nearest ancestor it does know
  (`FH_TAX.rollup`; an alias resolves to its survivor first).
- `version` bumps on every published change; `updated` records the date. The
  worker's LLM prompt and `mailbox-dryrun` name the version they ran with.
- Keywords are evidence hints, deburred, either language; adding one is a data
  change with no code path. Node names may be reworded freely; codes may not.

## 14. Open questions

- **Money-in is invisible.** 2 credits in 775 rows (A), 0 in 202 (B). VIB, VCB
  and MB either do not email credits or their credit shape never derived a
  template. The income tree has nothing to read until this is fixed upstream
  (still the open item from `full-ledger-spec.md` §10).
- **Grab needs amount-band lessons.** The one brand spanning two groups (`ride`
  vs `delivery`) is only split by two personal corrections. Whether the registry
  should carry a band-aware entry for such brands is undecided.
- **Marketplace rows need receipts.** Shopee, Tiki, Amazon and the food apps
  never pass group level from the bank row alone; receipt-join (§6) is the
  design, but the sender list does not yet fetch merchant-receipt mail, so "the
  what for a third of spending lives in mail we never read".
- **The group-level residue.** Even after the model and the Grab lessons, only
  49% of A's rows reach a leaf and 32% rest on a group, almost all transfers to
  people. Per-person lessons close it one counterparty at a time (~60 people in
  A's year); whether that is fast enough, or whether the p2p group needs its own
  reading (memo salutations, VietQR payloads), is to be measured after launch.
- Two VIB template fixes are prerequisites, not tree work: "Thanh toán thẻ tín
  dụng VIB thành công" (80 rows, counterparty lost, harmless) and "Chuyển tiền
  đến tài khoản VIB thành công" (14 rows, recipient replaced by the salutation).

## 15. Scope

**In:** the tree file and generator; migration 0144; worker cascade on nodes with
C5 dual emission; on-device backfill; partition helpers, default partitions,
label writers; layer selector, tree filter, refine/correct picker, regroup sheet
and card; receipt-join and loan-pair as propose-only review cards; the
`fh-tree` display flag.

**Out (named):** user-added nodes (Q1); keyword rules on labels (Q12); budgets
on nodes (Q15); automatic regroup of closed months (Q13); importing merchant
receipts as rows (D3); auto-commit of loan pairs (D4); a full income analytics
screen; any change to the notification enum.

## 16. Decision log

Agreed with the founder 2026-09-19/20 (B, Q, C series) and during the build (D).

| # | Decision |
|---|---|
| B | **Two layers.** L1 is the system tree, machine-assigned. L2 is the person's labels, a partition of L1: each node owned by exactly one label, "Others" owns the root. |
| Q1 · Q11 | **L1 is closed and exhaustive.** Users regroup, rename, split, hide; they never add nodes. Unmatched note words are reported as words only, with consent, so the tree grows from real gaps. |
| Q2 | **Rest on the deepest confident node.** A parent is a correct coarse answer, not "uncategorized". |
| Q3 | **Corrections allowed**, siblings first, full tree behind search; corrections are learned. |
| Q4 | **Axis = what the money bought.** ≤ 3 levels, uneven depth. |
| Q5 | **One tree per kind** (expense, income, transfer, loan, investment); repayment inherits its loan's node. |
| Q6 | **Partitions per family and per person** over one shared tree. |
| Q7 | **Capture shows label chips, never the leaf picker.** |
| Q8 | **Learn per person**, promote to the global registry on agreement. |
| Q9 | **COICOP skeleton**; every parent is its own "other"; root "Chưa rõ" is manual-only. |
| Q10 | Groups **Biếu tặng & hiếu hỉ** and **Phí, thuế & bảo hiểm** added to the skeleton. |
| Q12 | **Stored label with per-row override**; no keyword rules on labels in v1. |
| Q13 | **Regroup asks "Áp dụng cho N khoản cũ?"**, default yes; closed months excluded. |
| Q14 | **Label and node may disagree.** The label is evidence for the node only when the note is weak. |
| Q15 | **Layer selector** on breakdown surfaces and a transaction-list filter; **budgets attach to labels only**. |
| Q16 | **One source file, opaque permanent codes.** Split adds children; merge leaves an alias; an unknown code rolls up to the nearest known ancestor. |
| C1 | **Nothing visible changes on day one** (the stats layer selector is added). |
| C2 | **Backfill coarse, then refine on device**, never changing a label. |
| C3 | **Custom labels auto-map** by name and emoji, else Khác plus a non-blocking regroup card. |
| C4 | **Additive columns, no flag day.** |
| C5 | **Pipeline emits legacy concept and pool AND the node** for a window. |
| C6 | **Lessons and streaks re-keyed lazily.** |
| C7 | **Node encrypted on both ledgers**; the tree itself is public. |
| C8 | **Rollback = display flag**: `localStorage['fh-tree'] = 'off'`. |
| D1 | **Default partitions.** A new family: the six seeded categories claim their groups (Nhà ở → home, Đi chợ → groceries, Ăn ngoài → eatout + drinks, Đi lại → transport, Giải trí → leisure, Mua sắm → shopping) plus Others `'*'`. A family-less person: labels derived from their own rows plus Khác. |
| D2 | **Backfill refinement only when the keyword node's root equals the label's implied root.** |
| D3 | **Receipt-join.** A merchant receipt email enriches the matched bank/wallet row's node (exact amount, ±2 days) and is retired, never imported. |
| D4 | **Loan-pair.** Exact amount to a person then back from a person within 45 days proposes cho vay / thu nợ. Propose-only. |

## 17. Related

- `research/category-tree.html` — the design note, the full tree explorer, the
  measurement run this spec summarises.
- `taxonomy/taxonomy.json`, `tools/gen-taxonomy.js` — the one source and its
  generator.
- `docs/specs/transaction-review-spec.md` §C — the concept cascade this replaces;
  §F for the dedup rules §6 extends.
- `docs/specs/full-ledger-spec.md` — the kinds, transfer pairs, the money-in
  question.
- `docs/specs/borrowing-lending-spec.md`, `docs/specs/lending-capture-spec.md` —
  loans, repayments, the counterparty balances loan-pair feeds.
- `docs/specs/personal-ledger-spec.md`, `docs/features/personal-ledger.md` — Model
  Y, the denormalised category `personal_labels` now sits beside.
- `docs/ARCHITECTURE.md` — the dedup model (receipt-join, loan-pair rows).
- `docs/features/bank-email-pipeline.md`, `docs/features/direct-mailbox-read.md`
  — the worker this cascade runs in.
