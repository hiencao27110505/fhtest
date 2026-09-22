# Category Tree — one closed tree per kind, the person's labels on top

Every captured transaction lands on a real node of a system-owned tree, chosen by
the machine, without a model call per row. The person never sees that tree at
capture: they see their own labels, which are a **partition** of the tree. Budgets,
"Tiền đi đâu" and the review screen keep working exactly as today on day one; what
changes underneath is that "Khác" stops being where software puts things it could
not read.

> **Status, 2026-09-21 — SHIPPED, then corrected on a real ledger.** Spec agreed
> after the grilling of 2026-09-19/20 (decision log §16) and measured on two real
> mailboxes (§12). Migration **0144** is applied; the worker cascade, the on-device
> backfill, both pickers, the breakdown and the filters are live (SW **v564**;
> `mailbox-sync` v54; `merchant-concepts` **v3**, the first build that carries
> `taxonomy.mjs`). Two days of use on the founder's own ledger then overturned
> several first-build decisions; those are recorded as the **E series** in §16 and
> the sections they touch are amended in place, each marked *(E_n)*. Where this
> document and the E series disagree, the E series is what runs.
> **Designed but NOT built:** tier 1 shape statics and tier 5 rhythm (§3.2), the
> four-step layer selector (two shipped), the non-blocking regroup card (C3), the
> gap-word consent (Q11), fetching merchant-receipt mail for receipt-join (D3), the
> loan-pair card (D4), promotion of corrections to the registry (Q8). Rollback at
> any point is a display flag (C8), never a schema revert — and since E2 that flag
> restores the old totals too.

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

#### 3.2.1 The cascade as it actually runs *(E1, E2, E8)*

The table above is the design. What shipped, in order, strongest first:

| Where | Order |
|---|---|
| **Worker** (`classify.mjs` `enrichCategory`, and `conceptsForMerchants` behind the `merchant-concepts` function for statements) | the extractor's own node → a synced user correction (`merchant_corrections`) → **tree keywords** (`keywordNode`, free) → the merchant cache (`merchant_concepts`, node when present; a row of nulls is "asked, unknowable" and is never re-asked) → **one** model call. The node menu rides the PROMPT, never `responseSchema`: a 182-value enum is a hard HTTP 400 from Gemini's OpenAPI subset, and `validNode()` is the gate. Concept and pool are then DERIVED from the node (`conceptOf`/`poolOf`), so the three cannot disagree |
| **Review, on device** (`57-csv-import-review.js`, `nodeSource`) | `pipeline` (the sealed `raw_extracted.node`) → `history` (a ledger row with the same wording) → `learned` (`fhLessonNode`) → `keyword` (`fhNodeGuess`: lesson → tree keywords → label claims → person-to-person shape) → `concept` (the legacy 8-concept lifted to the tree GROUP that carries it, never to a leaf) → `label` (`fhNodeFromClaims`) |
| **Backfill, on device** (`28-tree-backfill.js`) | **transfer shape first** (`fhTransferShape`), then `fhNodeGuess`, then the label's coarse node. Evidence outranks the label (E1) |

Tiers 1 (shape statics) and 5 (rhythm) are not built. Statement rows take the
worker path through `merchant-concepts`, which since v3 returns `nodes` beside
`concepts`; the device seals it into the same `raw_extracted.node` an email row
carries (E8). The Python parser on Cloud Run passes a node through `ingest.mjs`
but assigns none (`parser/taxonomy.py` is generated and imported by nothing).

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
- **Measured on the founder's September, 2026-09-20 *(E2)*.** 11.0tr sat at
  "Chưa rõ". Decrypted, it was 7.09tr of transfers between the person's own
  accounts and ~1.08tr of card repayments (the bank's confirmation mail names the
  BANK as counterparty and carries no memo), 2.60tr person-to-person, one gift,
  and noise. So ~8.2tr was **known and mis-kinded, not unknown**. Those rows now
  take their true TRANSFER node (`bankbank`, `cardpay`, `wallet`, `cashout`,
  `savings`) even though the ledger holds them as `kind='expense'`, and leave
  every spending total (§4, E2). After that the residue was ~1.3%.
- **A row placed at a group is not unknown either *(E3)*.** "We know it is Nhà ở,
  not which kind" is a correct answer (Q2). It is shown under the group's OWN
  name, styled like any other row, and it opens the rows it is made of. It is
  never labelled "chưa rõ".

## 4. What the person does

- **Refine and correct — one picker *(E9, supersedes Q3's "siblings first")*.**
  "Tiêu vào gì" opens ONE OUTLINE OF THE WHOLE TREE, in the tree's own order,
  every time: the branch holding the current node is opened and scrolled to,
  **never hoisted**, so the hand learns where things are. Depth is a left inset.
  A chevron opens or folds a branch; tapping a NAME chooses it at any level, so a
  group and a leaf are both one tap. Search FILTERS the outline and keeps each
  hit's ancestors. "Chưa rõ" is its own row at the foot and the only way to the
  root. The same component (`fhNodeOutlineHTML`) draws the detail sheet and the
  review card's row sheet. The first build's list (siblings, parent, parent's
  siblings, every root, flat) showed three depths in one typography and offered
  no way DOWN at all: a node's children were never listed. A correction is
  learned per person (`fhLessonLearnNode`).
- **Assign in bulk *(E5)*.** In select mode the verb "Tiêu vào gì" files every
  selected expense at one node, scoped to the group the selection came from, and
  teaches a lesson per row so the same wording files itself from then on.
- **Regroup (Q13).** Move nodes between their own labels in the budget sheet.
  The sheet asks **"Áp dụng cho N khoản cũ?"**, default yes; closed months are
  excluded. Budgets and totals follow the labels; the tree does not move.
- **Rename, split, hide (Q1).** Labels are the person's; nodes are not. A label
  can be split by handing some of its claims to a new label.
- **File as Chưa rõ.** The only way a row reaches the root.
- **See the tree (Q15) *(E3, E4)*.** Breakdown surfaces gain a layer selector.
  It shipped with **two** stops, **Danh mục của tôi · Tiêu vào gì**, not the four
  designed: the tree view is itself an expandable group → category → leaf list,
  so the depth steps were redundant. Tapping a row in "Tiêu vào gì" **selects and
  opens** it, and narrows the transaction list, the bar chart and the breakdown's
  own highlight together (one variable, `fhNodeSel`; tap again to clear; a
  "Đang xem: X · Xem tất cả" bar says a filter is on). The transaction list has a
  matching **"Tiêu vào gì"** filter chip. Rows the tree knows are NOT spending sit
  in their own section, **"Không tính là chi tiêu"**, below the spending and
  outside the total the bars are drawn against. Budgets attach to labels only.
- **The review card leads with the tree *(E6)*.** The chip on a queued card shows
  the node ("Chuyển cho người khác", "Cà phê") and falls back to the label; both
  remain on the expanded card.
- **Report gaps (Q11).** Note words no tier recognised can be sent as bare words
  (never amounts, never notes) after an explicit opt-in, so the tree file grows
  from real gaps.

## 5. Backward compatibility, as the person experiences it

| | Rule |
|---|---|
| C1 | Nothing visible changes on day one except the layer selector. Labels, budgets, review defaults: identical. **Totals are the exception since E2**: a row whose node is a transfer leaves "Ra", the chart, the category stats and the family month totals, because it never was spending. `fh-tree=off` restores the old totals along with everything else |
| C2 | Old rows are backfilled on device from note and counterparty, **evidence first** (E1): the words outrank the label, which answers only when the words say nothing. A backfill never changes a label |
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
- Layer selector, as shipped: **Danh mục của tôi · Tiêu vào gì** (the four-step
  Nhãn · Nhóm · Danh mục · Chi tiết was not built).
- Detail row and picker title: **"Tiêu vào gì"** (income: **"Tiền từ đâu"**).
  Picker hint: **"Bấm tên để chọn, bấm mũi tên để mở. Thay đổi chờ tới khi bấm Lưu."**
- Not-spending section: **"Không tính là chi tiêu"**, with **"Tiền chuyển giữa các
  tài khoản của bạn, hoặc trả nợ thẻ. Vẫn nằm trong sổ vì ngân hàng báo về như một
  khoản chi."** The card repayment's dent in Còn lại: **"💳 Trả nợ thẻ: −X"**.
- Filter bar: **"Đang xem: X"** · **"Xem tất cả"**.
- A group's own rows carry the group's name, nothing else. "Chưa rõ chi tiết",
  "chưa rõ món" and a row count were all tried and rejected (E3).
- The catch-all label is STORED as the literal `"Others"` (`CAT_FALLBACK`) and
  translated only for display (**"Khác"**); every surface must go through
  `isFallbackCat` / `csvCatLabel` or a Vietnamese screen shows an English word.
- "Chọn rõ hơn" (refine hint) was not built.
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
`fhNodeDepth` (3 leaf · 2 · 1 · 0 for the coverage metric). Added after the first
build: `fhTransferShape(text)` and `fhLooksSelfTransfer` (E2: the same name on
both sides of "chuyen tien den" → `bankbank`; repayment wording or an issuer-only
counterparty → `cardpay`; top-up → `wallet`; ATM → `cashout`; savings) ·
`fhLooksPersonToPerson` · **`fhCountsAsSpending(node)`** (E2: THE one question
every spending total asks; no node = spending; respects `fhTreeOn`) ·
`fhXferCashOut(node)` (only `cardpay` dents Còn lại) · the selection,
`window.fhNodeSel` with `fhNodeSelMatch` / `fhNodeSelLabel` / `fhNodeSelCode`
(E4: `null` = all, `code` = that node and its descendants, `'=code'` = that node
and NOT its children, `'_none'` = rows with no usable node).
`fhNodeCorrections` was removed with the flat picker it fed (E9).

### 10.3 `src/js-data/28-tree-backfill.js` (new)

Runs after hydrate, idle-scheduled, resumable from a local cursor, both ledgers:

1. **Evidence first (E1, supersedes D2).** A row that needs a node (none, or one
   still resting on a depth-1 group) asks, in order: `fhTransferShape` (was this
   ever spending?), then `fhNodeGuess` on the note, then the label's coarse node.
   The first build let the label veto the keyword, which recorded every past
   mis-filing as fact ("QR2CK3U3TT SUPERSPORTS" under Ăn uống).
2. Writes are surgical: `fhTxnSetNode` / `fhPersonalSetNode`, node only; the
   label column is never touched (C2). `fhTxnSetNode` stamps
   `DB._lastLocalWrite` before AND after the write, or realtime reads the
   sweep's own echo as remote, re-hydrates, and the hydrate tail restarts the sweep.
3. **The slice contract (E10).** `_tbfSlice` returns `{n, more}`. `n:0, more:false`
   means "walked the whole ledger" and is the ONLY thing that may mark a scope
   done; "this batch needed no writes" is `more:true`; the session cap (400
   writes), a hidden tab, a locked ledger or a refused write are `n:-1` and never
   mark done. A bare `0` for both once ended the sweep permanently at the first
   twelve unresolvable rows.
4. **Mirror rows are not this sweep's (E10).** A personal row with `spaceId` or
   `linkId` takes its node from `fhPersonalMirror`; writing one here starts a
   rewrite → version bump → full `fhPersonalHydrate` ping-pong (a hot device and
   a stuck "Đang đồng bộ…").
5. **The cursor is versioned and moves with the rules (E10).**
   `fh-tree-bf:v<N>:fam:<fid>` / `:per:<uid>`, currently **v6**. A device that
   finished a pass never looks again, so ANY change to what a row resolves to
   (`fhNodeGuess`, `fhTransferShape`, the keywords, `_tbfWants`) ships with a
   cursor bump or it changes nothing on existing devices. Once per page load
   (`_tbfStarted`); never while `document.hidden`.

### 10.4 `src/js-ui/63-tree-ui.js` (new)

The two-stop layer selector; `fhTreeBreakdownHTML` (group → category → leaf on
the app's own `.fh-lrow`, a group's own rows under the group's name (E3), the
"Không tính là chi tiêu" section (E2)); `fhTreeTap` / `fhTreeTapExact` (E4);
**`fhNodeOutlineHTML`** with `fhNodeOutlineSeed` and `fhNodeOutlineReveal`, the
one picker both surfaces draw (E9); the claims sheet ("Gồm: …") with "Áp dụng cho
N khoản cũ?". All gated by `fhTreeOn()`. Not built: the regroup card (C3), the
gap-word consent (Q11).
**Never `scrollIntoView`, here or anywhere in the app (E11).** It scrolls every
scrollable ancestor, and `html`, `body` and `.phone` are `overflow:hidden` —
finger-proof, not script-proof — so it drags the whole app and nothing scrolls
it back. Set the container's own `scrollTop`/`scrollLeft` from two
`getBoundingClientRect` deltas. `tools/tree-cascade.test.js` bans the call.

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
| `20-budget.js` | Budget rows unchanged (labels only, Q15); the regroup entry point; `_fhLegendWrap` hosts the layer selector; the day chart, buổi map and range guide ask `fhCountsAsSpending` (E2) |
| `30-hydrate.js` | `m.spent` / `m.catSpent` / `memberSpent` skip rows that are not spending (E2); calls the family backfill in its tail |
| `21-personal.js` | Every personal sum asks `fhCountsAsSpending`: "Ra" and all stats downstream of `txM`, the month picker, the chart, the range guide. `xferCash` keeps a card repayment's dent in Còn lại, said aloud like the loan and investment dents. The chart narrows to `fhNodeSel`; the pre-window history is cached as RAW rows (`_persOldRows`), because a cached aggregate was invalidated by every selection and refetched per tap (E2, E4) |
| `60-transactions.js` | Personal row shapes carry `node` (without it every node filter matched nothing); `TXV.node`, the "Tiêu vào gì" chip and sheet, `setTxnNode`; the bulk verb `txnBulkNodePick` with a scoped picker (E4, E5). The label legend skips not-spending rows so both layers add up to the same money |
| `56-csv-import-ui.js` | The card chip leads with the node (`csvCatChipText`), `csvCatLabel` translates the catch-all (E6); the row sheet draws the shared outline, its open/fold and search state at FILE scope because the sheet is rebuilt on every render (E9). Helpers called from several renderers live at file scope: nesting two of them inside one renderer once stopped the queue from opening |
| `72-txn-review.js` | `fhStagedNode`; `_specNode` on the commit specs; **`fhCardPayShaped` no longer trusts `card_masked` alone (E7)** |
| `77-statement-capture.js`, `supabase/functions/merchant-concepts/` | The function returns `nodes` beside `concepts`; the device validates each code against its own tree and seals `raw_extracted.node` (E8) |

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
- **The Python parser assigns no node.** `ingest.mjs` passes one through, and
  `parser/taxonomy.py` is generated, but nothing on that path calls it.
- **Mis-kinded rows are named, not converted.** A self-transfer stored as an
  expense now reads as a transfer and leaves the totals (E2), but its `kind` is
  still `expense`. Conversion is per row (`fhPersonalConvertToTransfer`, from the
  detail screen); a bulk "these were never spending" conversion is not built.
- **A queue can only be emptied by hand or by lessons.** Group-level rows shrink
  through the bulk verb (E5). The free signals that would place them earlier
  (rhythm: same payee, same amount, monthly; the paying instrument) are tier 5,
  unbuilt; nor is a per-merchant-string model pass over historical rows.
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
| Q3 | **Corrections allowed** and learned. ~~Siblings first, full tree behind search~~ — the presentation is superseded by **E9**. |
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
| D2 | ~~Backfill refinement only when the keyword node's root equals the label's implied root.~~ **Superseded by E1**: it contradicted Q14 and froze every past mis-filing in place. |
| D3 | **Receipt-join.** A merchant receipt email enriches the matched bank/wallet row's node (exact amount, ±2 days) and is retired, never imported. |
| D4 | **Loan-pair.** Exact amount to a person then back from a person within 45 days proposes cho vay / thu nợ. Propose-only. |

### 16.1 The E series — decided on a real ledger, 2026-09-20/21

Each came from the founder using the build on their own data. Where an E entry
contradicts an earlier one, the E entry runs.

| # | Decision | What forced it |
|---|---|---|
| E1 | **Evidence before the label, in the backfill too.** Supersedes D2; this is Q14 applied. | "SUPERSPORTS" filed under Ăn uống because the old label vetoed the keyword |
| E2 | **Money that moved is not money that was spent.** A row whose words say transfer takes its TRANSFER node though stored as an expense; it is shown under "Không tính là chi tiêu"; and **one predicate, `fhCountsAsSpending`, is asked by every spending total** in both ledgers. A card repayment still dents Còn lại (`fhXferCashOut`), mirroring the loan and investment dents; moves between the person's own accounts, top-ups, ATM and savings do not. The kill switch restores the old totals. | 11tr of "Chưa rõ" that was 8.2tr of self-transfers and card repayments; then a header reading 27.2tr over a breakdown summing to ~18tr |
| E3 | **A row placed at a group is shown as that group.** Own name, ordinary styling, no count, still opens its rows. Only the top-level "Chưa rõ" keeps the muted look. | "Chưa rõ chi tiết" inside every category described the gap in our knowledge, not the money |
| E4 | **Tapping a category filters.** Selects and opens it; list, chart and breakdown follow one variable; a visible bar and a filter chip carry the state. Replaces a hidden `TXV.noNode` that narrowed the list with nothing saying so and was never cleared. | — |
| E5 | **Bulk assign, and it teaches.** | A 2.1tr group-level bucket that could only be fixed a row at a time |
| E6 | **The review card leads with the node; the catch-all is translated on every surface.** | "Others", in English, on a transfer to another person |
| E7 | **A card number in the mail is not proof of a repayment.** `card_masked` counts only when the mail names no merchant: no memo/counterparty at all, or the issuer as counterparty. Two extractors fill the field and disagree: `llm.mjs` sets it only on a repayment, `labeltable.mjs` matches any "số thẻ" line, which every card PURCHASE alert prints. And `memo_display` can be an EMPTY STRING while the merchant sits in `counterparty` (Vietcombank's card template), so the fallback chain is `a \|\| b \|\| c`, never `a != null ? a : …`. Verified on 204 real mails: 20 repayments, all the VIB confirmation; 0 merchants. | APPLE.COM/BILL, CO.OP MART and WAYNESCOFFEE queued as "Trả nợ thẻ" |
| E8 | **Statements get the same node the email path gets.** `merchant-concepts` returns `nodes`; the device seals `raw_extracted.node`. | The statement lane had been classifying into the 8 legacy concepts on a pre-tree build |
| E9 | **The picker is one outline of the tree, in the tree's own order, nothing hoisted.** One component for both surfaces. Supersedes Q3's presentation. Chosen from four working prototypes (`mockups/node-picker-options.html`, option 3), with the founder's amendment that the selected branch must not be prioritised. | A flat list with three depths in one typography and no way down |
| E10 | **The sweep's contract.** `{n, more}`; only an exhausted walk marks a scope done; mirror rows belong to the mirror; **the cursor version moves with every rule change**. | Three deploys in a row that changed nothing on the founder's device, then a hot phone |
| E11 | **No `scrollIntoView` in this app.** | It dragged the whole app upward: a permanent gap under the tab bar, and a blank detail screen |
| E12 | **Two questions, asked separately: WHO was paid, then WHAT was bought.** `fhSellerSignal` reads only marks a payment system leaves — a virtual-account prefix (`99MM…`, `MS00T…`, `VQRQ…`, `PHATLOC…`), a legal-entity account name, a memo a till printed (`66527 N9GDR`, `TT HD BH00120`). It runs after keywords and before `p2p`. An unknown prefix is not a mark: a missing rule makes the answer shallower, never wrong. | 143 of 273 yearly transfers in one mailbox and 56 of 158 in a second (another bank, rules untouched) were payments to sellers filed as "Chuyển cho người khác"; none of them carried a person-to-person note. `research/category-patterns.html` |
| E13 | **A new expense root, `purchase` "Thanh toán cho người bán"**, with `bizpay` (legal entities) and `seller` moved in from under `p2p`. Paying a seller is not a transfer between people. Machine-assignable, counts as spending, and deliberately not `manual`: it states something known (a purchase), unlike `xunfiled`. | The founder: a company whose name says nothing "should belong to a category that means buying/paying in generic, not transferring p2p" |
| E14 | **No extra taps. Pre-select from the data; when it runs out, rest on the deepest level that is known.** Supersedes the "ask once" prompts proposed in the research. Grab (rides AND food, no shared parent) rests on `purchase`; its rule lives in the client, NOT in the shared keywords, because on the worker a keyword would replace the legacy "Transport" concept the flat labels still use. | The founder, 2026-09-21 |
| E14a | **WHAT outranks WHO, in every lane (corrects E12 and E14, one day later).** The who-was-paid tier shipped INSIDE `fhNodeGuess`, which the review calls at tier 4, ahead of the server's concept hint (tier 5) and the person's label (tier 6). So "paid to a seller" answered before two tiers that knew what was bought. Now: `fhNodeGuess({whatOnly})` → a person (`p2p`, where it always was) → hint → label → `fhWhoNode` last; the sweep is words → `p2p` → the row's label → seller nodes. The Grab brand rule is deleted: no brand rules in the who-tier, ever. Cursor v8 re-files what v7 moved. | The founder: every Grab card in the queue read "Thanh toán cho người bán". Measured on 693 rows: 31 had a who-node displace a real category (29 Grab from "Đi lại", a supermarket from "Đi chợ & siêu thị", a clothes shop from "Quần áo & phụ kiện"); after the fix 0, with the unfiled count unchanged (93 → 26) |
| E14b | **The ledger is evidence only when it says WHAT (`fhNodeIsEvidence`), and the sweep repairs what a who-node displaced FIRST.** The review's history tier (step 2) copied a logged row's node onto any new row with the same words, ahead of the hint and the label, with no check on what that node was. After E14a fixed the rules, every new Grab card still read "Thanh toán cho người bán" because the v565 sweep had already written it onto the logged Grab rows. Now a who-node, or a node the row's own label contradicts, is never history; and rows a who-node displaced are re-filed in the first slice on launch, not in idle time. Cursor v9. `tools/review-history-evidence.test.js` replays the real card through the real review. | The founder's screenshot, 2026-09-22: label "Đi lại", node "Thanh toán cho người bán", on a MoMo statement row |
| E15 | **Codes before words in the statement lane.** `fhStructNode`: MCC (ISO 18245) and MoMo's receiving-service id set the BRANCH; a keyword may go deeper inside it, never sideways; a fee line's words beat the MCC it inherited from the purchase. MCC used to reach only the eight legacy concepts, the service id nothing. | VIB's card statement and MoMo's statement both carry them on every row |
| E16 | **A sealed node is checked against today's keywords (`fhPipeNodeOk`).** The worker seals nodes from ITS copy of the keyword list, which only changes on redeploy, and `mailbox-sync` cannot be redeployed from `main`. A node resting on a retired keyword is dropped in the queue; in the ledger only the entries marked safe are re-filed ("tien nha" is not: some of those rows are rent and their owner confirmed it). | Five live false positives: "gui tien **nha**" as rent, DZINE **Food** as software, a fund a person named "…Claude" as software, "Phí **quản lý** giao dịch" as a building fee, "pizza" as fast food for a sit-down restaurant |
| E17 | **The same payee, whatever was typed this time.** A second history tier keyed on the payee head of the ledger note, answered only when at least two past rows agree unanimously; who-was-paid nodes do not vote. | A monthly rent whose memo changes every month would otherwise lose its node when E16 retired the keyword that was right by luck |
| E18 | **Money sent to a P2P exchange desk is `investfund`, not spending.** A bare 20-digit memo, or "<sender> chuyen tien <6 digits>" with an amount nobody rounds to. A transfer-kind node on purpose: it flows through the existing not-spending machinery with no kind change. | 11 transfers, 545tr, confirmed by their owner |

**Two rules about tests, learned the same way.** A test that matches a line of
source pins whatever that line does, bugs included (one asserted
`if (re.card_masked) return true;` and held E7's bug in place). And a test that
slices helpers out of a file and runs them alone manufactures the scope the real
file may not have (one passed while the queue could not open). Run the real
function, loaded from the whole file, on the real shapes.

## 17. Related

- `research/category-tree.html` — the design note, the full tree explorer, the
  measurement run this spec summarises.
- `research/categorization-flows.html` — the old and new cascades side by side,
  from the email to the ledger.
- `mockups/node-picker-options.html` — four working picker prototypes on the real
  tree; option 3 shipped (E9).
- `tools/tree-cascade.test.js` — 170 checks; the E series is pinned here.
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
