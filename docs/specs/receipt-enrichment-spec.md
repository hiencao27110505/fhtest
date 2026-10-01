# Receipt Enrichment — what the money actually bought

A bank email says *"681.700đ Tại Shopee"*. The Shopee email in the same mailbox
says *what that was*: swimming goggles and a cherry-print swim cap, sold by
olanevietnam, 841.700đ before a 160.000đ voucher. This feature reads the
merchant's own e-receipt (Shopee, Grab, Apple, Tiki, Lazada, ShopeeFood, Foody)
and **attaches it to the bank/wallet transaction the person already has** — line
items, seller, the voucher math, and a sharper category — so a ledger row stops
being "spent at Shopee" and becomes "bought swim gear".

> **Status, 2026-09-30.** Live: L1–L5 (2026-09-29, 0154, mailbox-sync v70–v73,
> SW ≤ v598) and **Phase 2 — the item-category signature ladder** (0155,
> SW v600). Part 4 is the landing record. This is Wave 2 of email reading v2 as reserved by
> `email-reading-v2-spec.md` R12 and the `RECEIPT_DOMAINS` contract in
> `senders.mjs` — the receipt block, the sender registry entries and the
> "annotate, never create" rule all pre-exist this spec; this document turns
> that outline into a full design and adds the storage, join, category and
> presentation layers.

> **Amendment, 2026-10-01 — statement rows and the Grab reading (§21).**
> A real run showed a MoMo statement's Grab rows sitting in the queue with no
> receipt although both Grab e-receipts were staged. §21 records the three
> causes and the design that answers them (RC20–RC24): statement rows are join
> targets, Grab is read one level richer (still address-free), and a clock
> breaks same-amount ties. §3.3, §9, §10.2, §11 and §14 are amended in place.

> **Audience & layering.** Part 1 (Behaviour) is for everyone — product,
> design, QA. Part 2 (Technical Appendix) is for engineers. Part 3 is the
> implementation plan (landings, in order). The decision log (§18) records
> every choice made in the design interview so none is re-litigated silently.

> **How this relates to its siblings.** `effortless-transaction-logging-spec.md`
> owns the capture chain a receipt rides in on; `email-reading-v2-spec.md` owns
> the reader and the payload contract this extends; `transaction-review-spec.md`
> owns the screen where the join first shows; `personal-ledger-spec.md` owns the
> spine the receipt blob lands on. This spec owns exactly one new thing: the
> life of a merchant receipt from mailbox to attached detail.

---

# Part 1 — Behaviour

## 1. Summary

- Merchant e-receipts from **seven senders** — Shopee, ShopeeFood, Grab, Foody,
  Apple, Tiki, Lazada (`RECEIPT_DOMAINS`, already registered) — are fetched,
  read, sealed and staged like bank mail, but as a new row kind: **`receipt`**.
  A receipt is never a review card, never counts in the pending badge, and
  **never becomes a transaction** — the bank or wallet already reported the
  money moving; the receipt only explains it.
- On the device, each receipt **joins** the transaction it describes — a staged
  row in the review queue, or an already-imported row in the personal ledger —
  by paid amount + date, with the card tail as confirming evidence. Joined, it
  contributes: structured **line items** (name · qty · unit price · per-line
  discount · variant), the **seller**, the honest **voucher math**
  (tổng tiền − voucher = đã trả), the **order id**, and a **per-item category**.
- Category sharpens when the basket agrees: every item's category node is
  resolved locally, and the transaction takes the **deepest common ancestor**
  of the item nodes — a basket of rau, bún and thịt files as *Đi chợ/siêu thị*;
  a mixed basket climbs to a shallower-but-honest node; a hopelessly mixed one
  falls back to today's merchant guess. The description pre-fills the same way:
  one item → its name; an agreeing basket → a short summary; a mixed one →
  "Shopee · 2 món".
- A receipt that matches nothing is **quietly retired after 14 days**. No
  fallback card, no notification — a receipt with no captured payment describes
  money this ledger never saw (COD, an unconnected card), and inventing a
  transaction from it is the double-count this design exists to avoid.
- The receipt structure is **source-agnostic**: `source: 'email'` today, and
  the same blob is the landing zone for a future **OCR door** — photographing a
  paper receipt (an AEON till receipt) and attaching it to a txn by hand.
- Reading merchant mail is a real widening of what FamilyHub reads, so it ships
  behind a **consent bump (v6)** that names it plainly — receipts *and* bills
  in one ask, though biller extraction itself is a later build.

## 2. Why this exists

- Capture today answers *that* you spent and *where*, rarely *on what*. "Chi
  cho gì?" — the field the whole review screen exists for — is the one thing
  the bank mail cannot say. The merchant's own receipt says it, it is already
  sitting in the same mailbox, and it costs the person nothing.
- Category quality has a ceiling at the merchant tier: "Tại Shopee" can only
  ever be generic shopping. Item names break that ceiling — goggles are thể
  thao, rau is đi chợ — and per-item nodes are the raw material every future
  insight cut (brand loyalty, basket composition, subscription creep) will
  want. Capturing them now, encrypted, costs one column.
- The double-report problem is already solved *defensively* (the dedup engine
  flags a merchant receipt against its bank twin). This feature turns the same
  pairing from a suspicion to be dismissed into value to be kept.

## 3. What the person sees

### 3.1 The Shopee purchase (the canonical walk-through)

1. 26/09, 13:09 — the person pays a Shopee order by card. Three emails arrive
   over the next days: VIB's debit notice ("681,700 VND … Tại Shopee"),
   Shopee's payment confirmation (items, prices, voucher, "Số tiền thanh toán:
   ₫681.700 · 13:09:20"), and later Shopee's delivery confirmation (same order,
   same details).
2. The VIB row stages and appears in "Duyệt giao dịch" as today. The two
   Shopee mails stage invisibly as one receipt (the delivery mail collapses
   into the payment mail by order id — richest copy wins).
3. When the queue opens, the receipt has already joined the VIB card. The card
   now reads: description pre-filled "Kính bơi Olane +1 món" (machine-filled,
   editable), category *Thể thao* instead of generic shopping, and a small
   **🧾 2 sản phẩm** hint.
4. After import, the transaction's detail screen carries a **"Hoá đơn"**
   section: seller (olanevietnam), each item with qty × price, and the math —
   Tổng tiền 841.700đ · Voucher −160.000đ · **Đã trả 681.700đ** · đơn
   #2609262Y4DUK5U.

### 3.2 The Apple rental

VIB reports "49,000 VND … Tại APPLE.COM/BILL"; Apple's receipt says *The Long
Walk · Movie Rental · 49.000đ*, billed to MasterCard ••4751. The join is
confirmed by the matching card tail. The row's description pre-fills "The Long
Walk", and the honest answer to "what was that 49k at Apple?" is now on the
row forever. Apple-specific texture (content type, device) stays inside the
item name — no per-merchant schema.

### 3.3 What a receipt never does

- It never creates a review card or a transaction. A Shopee order paid by COD
  or by a card whose bank never emails produces a receipt that matches nothing;
  after 14 days it is retired unseen. (Named consequence, accepted: enrichment
  only reaches money the ledger already captured.)
- It never carries an address or a phone number — Grab receipts in particular
  contain home addresses, so Grab is read **at order level only**: service
  type, the service's printed name ("Car 6 chỗ ngồi"), total, fare, promo,
  GrabCoins redeemed, time, paid-with tail and booking id. No line items, no
  pickup or drop-off, per the standing rule in `email-reading-v2-spec.md` §4
  (widened by RC21, 2026-10-01: a product name and a points figure are not an
  address, and the reader takes the name only from above the trip block).
- It never overwrites a human's words. A note the person edited is theirs; the
  pre-fill applies only where the note would otherwise be the generic
  merchant fallback, and retroactive enrichment never touches the note at all.

### 3.4 Where the detail shows

| Surface | What shows |
|---|---|
| Review card (queue) | "🧾 N sản phẩm · <seller>" hint on the collapsed card; the expanded card's description and category arrive pre-filled from the receipt |
| Review card, order-level receipt (Grab) | hint "Hoá đơn Grab"; the Hoá đơn block shows the service name and the math, each deduction on its own figure: Tổng 47.000đ · Khuyến mãi −4.000đ · GrabCoins −32.000đ · **Đã trả 11.000đ**. Description pre-fills "Grab · Car 6 chỗ ngồi" (RC24) |
| Transaction lists (Cá nhân tab, Giao dịch cá nhân, Xem chi tiêu) | a small 🧾 marker on rows that carry a receipt; the note text does the informational work — no item snippets in list rows |
| Transaction detail (`openPersonalTxDetail`) | the full **Hoá đơn** section: seller · #order · one row per item — name, the figure right-aligned and tabular, and the item's **category as a tappable pill** (neutral fill, the review card's `.scv-cat` language; a soft "Chọn loại" when none) over the merchant's own words · the honest math (tổng tiền − voucher (− phí ship) = đã trả), printed only where it says something the hero amount does not. Tapping the pill opens the standard tree picker; the pick saves at once and is learned per person by the item's signature (§20.4). Money through `fmt()`; SVG glyph, never an emoji (DESIGN §6.1, §2.6). |

## 4. Category and description — the rules

**Who owns the transaction's category.** The bank-side cascade — merchant,
MCC, history, lessons — which exists for every row. A receipt exists for a
minority of rows and its items are the weaker signal, so **items never vote
the transaction's node** (RC16–RC19; the deepest-common-ancestor vote of
the first design was removed on 2026-09-29). Re-filing the transaction is the
person's act, through the same category row as always.

**What an item's own category may do.** Refine, within the branch: an item
node is kept when it *is* the transaction's node or sits under it, and
dropped otherwise — a swim cap sharpens *Mua sắm* to *Đồ thể thao*; "Sách"
can never appear under a purchase filed as Streaming. A transaction with no
node has no branch to contradict. The one exception is a person's own pick
on the item (§20.4), which stands wherever they put it.

**Where an item's category comes from** — the signature ladder, §20: the
tree's keywords → the learned type/slot table → one model call per unseen
signature → nothing. On the device: the person's lesson for that signature →
what the worker sealed → the keywords (for blobs written before Phase 2).

| Basket | Transaction node | Description pre-fill |
|---|---|---|
| 1 item | unchanged (bank-side cascade) | the item name ("The Long Walk") |
| N items, all one item-category | unchanged | short summary ("Kính bơi Olane +1 món") |
| N items, mixed | unchanged | "<Seller> · N món" ("Shopee · 2 món") — generic, never clueless |
| Items unparseable (order-level only) | unchanged | cascade unchanged |
| Order-level with a service name (Grab) | unchanged | "<Provider> · <service name>" ("Grab · Car 6 chỗ ngồi") |

- Pre-filled descriptions are machine-marked like every cascade guess, apply
  only where the note would otherwise be the generic merchant fallback, and
  never touch a note on retroactive enrichment (RC13).
- "The generic merchant fallback" includes a note that only repeats the
  merchant's own name: a statement row whose memo is "GRAB" has been told
  nothing by anyone, so "Grab · Car 6 chỗ ngồi" may replace it (RC24). A memo
  with any other word in it is a person's or a bank's sentence and stands.
- The description's "agreeing basket" test uses the items' own categories,
  so it inherits every rule above.

## 5. Privacy and consent

- **Consent v6 gates everything.** The current consent (v5) covers bank,
  wallet and statement mail. Reading merchant receipts is materially new —
  what a person *buys* is more intimate than where they bank — so the consent
  copy is rewritten to say it plainly: FamilyHub will read order/receipt mail
  from named merchants; a first-of-its-kind format is read by an AI service,
  item names and amounts included; repeat formats are read locally. The same
  copy names utility/telco **bills** so the later biller build needs no v7.
  Existing grants re-affirm on next open, exactly as v4→v5 did.
- **No addresses, ever.** The extraction contract already rules it
  (`contract.mjs`: receipt keys "NEVER an address"); the prompt's receipt
  block repeats it; a test asserts no address-shaped string survives into a
  sealed receipt payload. Delivery addresses and phone numbers in Shopee/Grab
  mail are read past, never extracted.
- **Sealed like everything else.** Receipt rows travel in the same sealed box
  to the same staging keys; the database sees routing metadata only. On the
  spine, the receipt blob is one more `_enc` column under the personal DEK —
  the operator holds ciphertext.
- **The item classifier sees names only.** The `merchant-concepts` backstop
  (§11) receives bare item name strings — no price, no qty, no seller, no
  amounts — the same minimal-payload posture that service already has for
  merchant names.
- **Notifications carry nothing**, unchanged — receipt rows never notify at
  all (they are not pending work).

## 6. Safety rules

- **A receipt annotates; it never creates.** No code path from an unmatched
  receipt to a review card or a ledger row. (Locked at design; the unmatched
  count is tallied so the decision can be revisited with data — §16.)
- **Mis-attachment is worse than no attachment.** The join requires an exact
  paid-amount match; ambiguity (two candidate transactions, no tail to
  decide) attaches nothing. Same bias as the dedup engine: a missed
  enrichment costs nothing, a wrong one lies on a ledger row.
- **The bank's amount is the truth.** A receipt never changes a transaction's
  amount, date or direction — items + voucher explain the paid figure, they
  never override it.
- **Fail-closed on decrypt.** An unreadable `receipt_enc` renders as "chi
  tiết không đọc được", never blocks the transaction, never counts as
  anything.
- **Human words win.** Pre-fill only into an otherwise-generic note; never on
  retroactive enrichment; never over an edit.

## 7. Status and current limits

- **Not built.** Everything in this document is design.
- **Named gaps, accepted for v1:**
  - A purchase filed to **Gia đình** has no private personal row, and family
    rows are out of scope — its receipt has nowhere to land and is retired.
    (Family-row enrichment is a future follow-up with its own ownership
    questions.)
  - Receipts enrich **private personal rows** retroactively; mirror rows are
    machine-owned and excluded.
  - Grab: order-level only (address rule).
  - Billers (EVN, telcos, water): consent copy covers them; extraction is a
    separate later build.
  - OCR paper receipts: the blob is shaped for it (`source: 'ocr'`); the
    camera door itself is a future feature.
  - Split-categorization (one purchase → N category legs) is explicitly out:
    it breaks the bank-amount-is-truth anchor and the stats model. One txn,
    one node, DCA when mixed.

---

# Part 2 — Technical Appendix

## 8. Architecture in one view

```
Gmail ──(query + per-sender subject filters)──▶ mailbox-sync worker
                                                   │  read (formats/model, §10)
                                                   │  seal (receipt block, §9)
                                                   ▼
                                     email_transactions  row_kind='receipt'
                                                   │
              device opens (per staging_scope) ────┤
                                                   ▼
                              78-receipt-join.js  (new)
                    collapse by order_id ─ richest copy wins
                                                   │
              ┌────────────── join by (paid, ±1d, direction, tail) ───────────┐
              ▼                                                               ▼
   staged txn candidate (queue)                          committed private personal row
   → enrich candidate: items, node (DCA),                → write receipt_enc, set 🧾
     description, 🧾 hint                                  (note/category untouched)
              │                                                               │
              └──────────── receipt row retired (tombstone → delete) ─────────┘
                         unmatched after RECEIPT_GRACE_DAYS=14 → retired quietly
```

**Module map (new + touched):**

| File | Owns |
|---|---|
| `_shared/mailbox/senders.mjs` | `RECEIPT_DOMAINS` joins `inboxQuery` **with per-sender subject filters** (§10.1) — the standing contract in its own comment block |
| `_shared/mailbox/contract.mjs` | the extended receipt block (§9); nullable adds, no `PAYLOAD_V` bump |
| `_shared/mailbox/formats.mjs`, `htmltable.mjs`, `llm.mjs` | receipt formats: order-level labels + the repeated item-block reader (§10.2); model prompt gains the receipt sender-class block |
| `_shared/mailbox/stage.mjs`, `worker.mjs`, `ingest.mjs` | `row_kind='receipt'`; both mappers carry the new keys (the mapping is the wire) |
| `src/js-ui/78-receipt-join.js` (new) | open receipt rows, collapse by order id, the join, attach, retire, grace |
| `_shared/mailbox/item-category.mjs` (new, Phase 2) | the signature ladder: keywords → `item_signatures` → one batched model call → null; seals `items[].node`/`.sig` (§20.3) |
| `_shared/mailbox/db.mjs` | `itemSignaturesGet` / `itemSignaturePut` for `item_signatures` (0155) |
| `tools/gen-taxonomy.js` → `11-taxonomy.js` + `taxonomy.mjs` | `itemSignature()` — the head-noun extractor, ONE source for client and worker |
| `src/js-data/24-lessons.js` | `fhLessonItemNode` / `fhLessonLearnItemNode` / `fhLessonForgetItemNode` — per-user, encrypted, keyed `item\|<sig>` |
| `src/js-ui/63-tree-ui.js` | `fhNodePickOpen(cur, kind, onPick, sub)` — the subtitle override for an immediate-save pick |
| `src/js-ui/61-expense-detail.js` | the Hoá đơn section; the item pill → picker → blob rewrite + lesson (`pexdRcItemPick/Picked`) |
| `src/js-ui/57-csv-import-review.js`, `56-csv-import-ui.js` | candidate enrichment: description/category pre-fill, 🧾 hint |
| `src/js-data/19-personal.js` | `receipt_enc` on writers + hydrate + regen sweep (`fhPersonalRegen`, `19-personal.js:1570`) |
| `src/js-ui/21-personal.js`, `60-transactions.js` | 🧾 list markers; the detail screen's Hoá đơn section |
| `src/js-data/75-consent-ui.js` | `FH_CONSENT_V` 5 → 6, copy rewrite |
| `supabase/functions/merchant-concepts` | unchanged API (`POST {merchants:[…]}`), reused for item names |

## 9. The payload — extending the receipt block

`contract.mjs` currently reserves
`receipt: { service_type, order_id, paid_with_tail, line_items }`. It becomes:

```js
{ key: 'receipt', type: 'obj', since: 2, keys: [
  'service_type',    // ride | food | goods | digital | subscription — coarse, cross-merchant
  'order_id',        // "#2609262Y4DUK5U" / booking id / Apple order id
  'seller',          // "olanevietnam" — the sub-merchant, when the platform names one
  'items',           // [{ name, qty, unit_price, line_discount, variant, node, sig }] — or null (Grab: always null)
                     //   node/sig (Phase 2, §20): the ladder's PROPOSAL and the signature it was learned under
  'items_total',     // 841700 — the pre-discount sum the mail prints
  'discount',        // 160000 — voucher/discount total
  'shipping_fee',    // 0
  'paid',            // 681700 — THE JOIN KEY; the amount that hit the instrument
  'paid_with_tail',  // "4751" — confirming evidence for the join
  'service_label',   // "Car 6 chỗ ngồi" — the service's own printed name (RC21); never a place
  'points_discount', // 32000 — loyalty points redeemed as money (GrabCoins); separate from `discount`
] }
```

Rules:

- Nullable additions only — `PAYLOAD_V` stays 2 (a key changes meaning to
  bump, and none does; `line_items` → structured `items` is a rename **in
  prose only**: the stored key is new, `line_items` is never emitted, and no
  production row ever carried it).
- The honest math is `items_total − discount − points_discount (+ shipping_fee)
  = paid`. `discount` stays vouchers/promos only, so a row written before
  `points_discount` existed still reads as it always did.
- `time_precision` on a receipt row says whether `occurred_at` carries a clock.
  A Grab mail prints only the day; when the mail's own send time falls on that
  same Vietnamese calendar day the row takes it, at `minute` precision, with
  `src.occurred_at = 'heuristic'` (RC22). The e-receipt is sent as the trip
  ends, which is when the wallet is charged. A send time on another day is
  ignored and the row stays day-only.
- **Both mappers in the same change** (`_toReading` in `worker.mjs`,
  `normaliseReading` in `ingest.mjs`) — a box is never amended.
- Item `node` is **not** sealed — classification is a device judgement over
  owned lessons and the family's tree, so it is computed and stored on-device
  (§11), not in the pipeline.
- No address-shaped key exists to fill; the prompt's receipt block forbids
  extraction of addresses/phones and a test asserts it (§15).

**Clear columns:** one change — `email_transactions.row_kind` gains
`'receipt'` (`CHECK (row_kind in ('txn','notice','receipt'))`), and
`mailbox_read_status()` keeps excluding non-`'txn'` rows from pending counts
(already the notice behaviour; the receipt rides the same exclusion).
`raw_extracted.txn_source = 'receipt'` is stamped as `senders.mjs` already
promises. Everything else — `gmail_message_id`, `occurred_at`, `dedup_fp`,
scope, envelope — is unchanged; the 0068 CHECK is untouched.

## 10. Capture

### 10.1 The query — filtered, or the budget dies

Every receipt domain is also a marketing firehose (`shopee.vn` sends "Flash
sale 9.9" from a sibling address). Fetching them bare would spend the staging
cap and model budget on campaigns. So `inboxQuery` gains the receipt domains
**with a per-sender subject filter**, maintained beside the domain registry:

| Sender | Subject terms (initial; verified against real mail at build) |
|---|---|
| shopee.vn | "Đơn hàng" + ("thanh toán" OR "đã được giao"/"xác nhận") |
| apple.com | "receipt from Apple" / "Hóa đơn" |
| grab.com | "Grab E-Receipt" |
| shopeefood.vn / foody.vn | order-confirmation phrasing |
| tiki.vn / lazada.vn | order-confirmation phrasing |

The filter is a **fetch-cost gate, not a correctness gate**: a receipt that
slips past wording changes still hits the junk cache / classifier tiers like
any mail; a campaign that matches the filter is classified junk once and
cached. Filter misses surface in the coverage/tally numbers (§16), not as
user-visible failures. Forwarded receipts (transport A) already match
`senders.match` today and follow the same path.

### 10.2 Reading a receipt — the item-block problem

Order-level fields (order id, totals, paid, tail, seller) are label/value rows
the existing tiers already handle (`htmltable.mjs`, label maps). **Line items
are the new capability**: a variable-length *repeated block* ("1. <name> /
Số lượng: 1 / Giá: ₫607.700", next block…), which fixed-anchor templates
cannot express. So receipt formats gain a **repeating-group reader**:

- A receipt format (in `mail_formats`, keyed provider + label-set signature,
  as today) may declare an `item_block`: the block's boundary pattern and the
  per-item field labels. `apply()` walks the block N times.
- The model is called **once per format** to learn the block shape (the
  standing economics: first-of-a-kind only); seeds for Shopee and Apple are
  hand-written like the VIB seeds were, so the two highest-volume senders
  cost zero model calls from day one.
- **Degradation is order-level, never nothing:** if the item blocks fail to
  parse, the receipt still seals with order-level fields (`items: null`) —
  the join and the voucher math still work; only per-item detail is lost.
  A format that can't even yield `paid` is `unreadable`, as today.
- Grab formats **never declare an item block** (address rule) — structural,
  not prompt-dependent.
- **What the Grab reader takes (RC21).** Numbers under their labels: Total
  Paid, Fare, Promo, GrabCoins (in the Breakdown only; the "Points earned"
  block further down also says GrabCoins and is past the stop line). One
  string: the service name, read **only from the header zone** (above "Picked
  up on" / "Booking ID") and only when it is shaped like a product name: at
  most 40 characters, no comma, slash, arrow or digit-led token, no street
  word, and carrying a service word (car, bike, chỗ, food…). Anything else is
  null. Every other field is a number under its own label, so a pickup or
  drop-off line has no path into a field. A label the model returns passes
  the same shape test.

### 10.3 Staging and lifecycle

- Sealed to the grant's `default_scope` key like any mail; `row_kind='receipt'`.
- Never notifies, never counts as pending, never appears in review buckets
  (the dedup engine and `bucketCsvCandidates` skip non-`'txn'` rows).
- Idempotent on `gmail_message_id`; tombstoned on retirement like every row.
- **Retirement triggers:** (a) joined — its content landed on a txn; (b)
  unmatched and older than `RECEIPT_GRACE_DAYS = 14` (delivery mails and
  statement-captured card rows arrive late; 14 days mirrors the forwarding
  routing grace); (c) collapsed — a same-`order_id` sibling won the
  richest-copy merge. All three are device-initiated, local-first
  (retired-set before server delete), through `resolve_email_transactions`.

## 11. The join engine (`78-receipt-join.js`, new)

Runs when the review queue opens and after each personal hydrate; pure client.

**Step 0 — collapse.** Open all readable receipt rows (per `staging_scope`,
both keys available on-device), group by `(provider, order_id)`; richest copy
wins (most items > has seller > has tail), the rest retire.

**Step 1 — candidates.** For each receipt, gather transactions to match:
staged `'txn'` candidates in the open queue, plus the personal ledger slice
(`fhPersonalMatchSlice` — already a 365-day amount/date index built for
dedup) filtered to **private rows** (`link_id IS NULL`; mirror rows are
machine-owned and excluded).

**Step 2 — the rule.**

```
match(receipt, txn):
  txn.direction/kind is an expense-side debit
  AND txn.amount == receipt.paid            -- exact, in đồng (normalise units: ledger rows are base units — the §19.5 hazard)
  AND |txn.date − receipt.date| ≤ 1 day
  tail evidence, when both sides have one:
    tails equal   → confirms (wins any tie)
    tails differ  → VETO (not a match)
  clock evidence, when the receipt and candidates carry one (RC23):
    exactly ONE surviving candidate within 30 minutes → it wins the tie
    never a veto, never used when a tail already decided
ambiguity: two surviving candidates and neither tail nor clock decides → attach nothing
priority: queue candidate beats ledger row (enrich before import when possible)
one-to-one: a receipt attaches to at most one txn; a txn takes at most one receipt
```

**Which rows are candidates (RC20).** Every opened row in the queue, whichever
door it came through: a sealed email row and a parsed **statement row**
(`fhStmtAsStaged`) are the same shape by contract, and the join reads the
fields that shape guarantees at the top of the row (`amount`, `direction`,
`occurred_at`), falling back to `raw_extracted` only for the tail. A statement
row whose `occurred_at` is the day-only spelling (`T00:00:00Z`) has no clock and
takes no part in the clock tie-break. On the ledger side the clock is the
row's `occurred_time`, and agreement within 30 minutes also waives the 2-day
young-receipt wait: that wait stands in for evidence the pass cannot see, and
a matching minute is that evidence.

**Step 3 — attach.**

- *Queue candidate:* set the candidate's receipt payload; recompute item nodes
  (§11.1), DCA category and description per §4 (respecting the cascade order —
  an existing human/learned value is never displaced); render the 🧾 hint.
  On import, the promote path writes `receipt_enc` with the row (§12) and the
  receipt row retires in the same batch bookkeeping.
- *Committed private personal row:* write `receipt_enc` onto the row
  (`fhPersonalUpdateExpense`-class write, owner-filtered `link_id IS NULL`);
  set nothing else — note and category are untouched retroactively. Retire
  the receipt row after the write confirms.

### 11.1 Item categories on the device

The worker resolves item categories at read time (§20.3) and seals them as
proposals. The device decides what is shown, in this order, per item:

1. **The person's own lesson** for the item's signature (`fhLessonItemNode`,
   keyed `item|<sig>`; for a blob written before Phase 2 the signature is
   recomputed from the name with `FH_TAX.itemSignature`).
2. **The sealed node**, if the tree knows it.
3. **The tree's keywords** (`FH_TAX.keywordNode`), for older blobs.

Then the branch constraint (§4): an item node outside the transaction's
branch is dropped — except a lesson-resolved item, which a person placed.
Nothing here calls anyone; the `merchant-concepts` call of the first design
is gone (RC16). Items never write the transaction's node.

## 12. Storage — `receipt_enc` on the spine

Migration (next free number — verify against `origin/main` at build time, the
sequence has collisions):

```sql
alter table public.personal_transactions
  add column if not exists receipt_enc text;   -- personal-DEK ciphertext, JSON blob
alter table public.email_transactions
  drop constraint if exists email_transactions_row_kind_known,
  add  constraint email_transactions_row_kind_known
       check (row_kind in ('txn','notice','receipt'));
```

Blob shape (encrypted as one value via `encVal`, decrypted lazily —
**hydrate never decrypts it**; only the detail screen and the join engine do):

```json
{ "v": 1, "source": "email",            // 'email' | 'ocr' (future door)
  "provider": "Shopee", "seller": "olanevietnam", "order_id": "2609262Y4DUK5U",
  "service_type": "goods",
  "items": [ { "name": "Swimming Goggles OLANE 503M …", "qty": 1,
               "unit_price": 607700, "line_discount": 0,
               "variant": null, "node": "sportsgear", "sig": "hn|swimming goggles" } ],
  "items_total": 841700, "discount": 160000, "shipping_fee": 0,
  "paid": 681700, "paid_with_tail": "4751" }
```

**Why a blob, not a child table** (decision RC7): E2EE voids the child table's
entire value — item fields would be ciphertext the server can never filter,
index or aggregate; client-side analytics decrypt fewer ciphertexts from one
blob than from N×M field columns; the blob rides the existing single-row
atomic writers and offline semantics, adds one field to the regen sweep
instead of a whole new table pass, and creates no new RLS surface. If
item-level ever becomes first-class on the spine, a client-side sweep can
explode blobs into a table — the JSON loses nothing waiting.

Spine integration:

- `fhPersonalRegen` re-encryption sweep gains `receipt_enc`.
- Fail-closed: `_DEC_FAILED` on `receipt_enc` → detail shows "chi tiết không
  đọc được"; the transaction itself is unaffected (amount is not in the blob).
- The 🧾 list marker reads column presence (`receipt_enc IS NOT NULL`), no
  decrypt needed for lists.
- Family `transactions` gets **no** receipt column in v1 (family rows out of
  scope).

## 13. Consent v6

- `FH_CONSENT_V` 5 → 6 in `75-consent-ui.js`; the worker checks the version
  server-side before fetching receipt domains for a grant (the v5/statement
  precedent: a consent constant the pipeline enforces, not just the client).
  A grant on v5 keeps its current behaviour — banks and wallets only — until
  the person re-affirms; receipts simply don't fetch for them.
- Copy states: which merchants; that first-of-a-kind formats go to the AI
  service with item names and amounts; that repeat formats are read locally;
  that addresses are never extracted; and that utility/telco bills fall under
  the same consent (so the biller build needs no v7).

## 14. Failure modes

| Scenario | Behaviour |
|---|---|
| Receipt arrives, bank mail never does (COD, unconnected card, bank with no alerts) | no match → retired quietly after 14 days; counted in the tally |
| Bank row imported before the receipt arrives (delivery mail days later) | ledger-side join → `receipt_enc` written retroactively; note/category untouched |
| Two same-amount txns on the day, receipt has no tail | attach nothing (ambiguity rule); receipt waits — a later hydrate may disambiguate (one candidate imported/removed) before grace expires |
| Two rides at the same fare on one day, paid by wallet (no tail) | each receipt carries the mail's send time; the statement rows carry theirs; each receipt takes the one row within 30 minutes of it. Receipts read before 2026-10-01 are day-only and still attach nothing here |
| Transaction came from a statement file, not a bank mail | joins in the queue like any row (RC20) |
| Tail on both sides disagrees | veto — never attached, even with amount+day equal |
| Item blocks unparseable | order-level receipt (`items: null`): join + voucher math work, no per-item detail |
| `receipt_enc` undecryptable | "chi tiết không đọc được" in the detail; txn unaffected |
| Receipt row unreadable (wrong scope key, tamper) | surfaced in the standard unreadable count; never joins |
| Campaign mail slips the subject filter | junk-cached once per shape, as any mail; never reaches a card |
| Txn filed to Gia đình | no private personal row exists → receipt retires unmatched (named v1 gap) |
| Person edits note/category after queue pre-fill | their value wins; receipt detail remains attached and visible |
| Item type the keywords do not know, model unreachable | item carries no category; nothing cached, so the next run asks (§20.3) |
| Model answers a venue/class for a goods signature | refused: not applied, not cached (structural gate, RC18) |
| Person picks an item category outside the transaction's branch | stands — a human pick is the one exception to the branch rule (RC19) |
| Same order, third notification mail after join | collapses by order id against the tombstoned twins' ids? No — it stages fresh, matches a txn that already **has** a receipt → one-to-one rule refuses, grace-retires. Harmless |

## 15. Testing

Following the house pattern (`tools/run-tests.js`, real functions extracted by
name, fixtures from real mail):

| Suite (new) | Proves |
|---|---|
| `receipt-contract.test.js` | block keys accepted by `fieldAccepts`; both mappers carry every key; **no address-shaped value survives into a sealed receipt** (fixture: real Shopee mail with full address + phone) |
| `receipt-formats.test.js` | Shopee + Apple seeds parse the three real fixtures (2-item Shopee, 1-item Apple, delivery twin) with zero model calls; item-block degradation to order-level |
| `receipt-join.test.js` | the §11.2 rule: exact-paid match, ±1 day, tail confirm/veto, ambiguity → nothing, one-to-one, queue-beats-ledger, units normalisation (base vs đồng) |
| `receipt-collapse.test.js` | order-id collapse, richest wins; third-mail-after-join case |
| `receipt-category.test.js` | item tiers + DCA (unanimous / mixed-climbs / root-falls-back / null-abstains); description rules incl. never-clobber |
| `receipt-lifecycle.test.js` | row_kind exclusion from pending counts, buckets and notify; grace retirement; local-first retire |
| `item-category.test.js` (Phase 2) | signatures per source; ladder order; keyword hit teaches the table and names siblings; cached null is an answer, stale logic version is not; one batched call carries signatures not titles; nothing cached when the model is unreachable or unbudgeted; structural gate refuses venue/class for goods; menu is expense-only |
| Extended: `receipt-join.test.js` | lesson → sealed → keywords; a lesson survives the branch constraint; pre-Phase-2 blobs fall to keywords (runs the REAL generated tree in its sandbox) |
| Extended: `receipt-reader.test.js` | Apple items carry `apple\|<store>\|<kind>` (the storefront names every item in its section) and `apple\|vendor\|<vendor>` |
| Extended: `receipt-join.test.js` (RC20, RC23) | a row built by the REAL `fhStmtAsStaged` joins; clock tie-break picks the one row within 30 minutes, two within 30 minutes attach nothing, a clock never vetoes a lone candidate; ledger clock agreement waives the young wait |
| Extended: `receipt-reader.test.js` (RC21, RC22) | the real 2026-10-01 Grab layout: service name, GrabCoins from the Breakdown and not from "Points earned", math balances; a street line in the header zone is refused; send time adopted only on the same VN day |
| Extended: `review-notify.test.js` | receipt staging produces zero notifications |

## 16. Telemetry

`read_tally` gains stages: `receipt_staged`, `receipt_junk`, `item_sig_asked`, `item_sig_resolved`,
`receipt_items_ok`, `receipt_items_degraded`, `receipt_joined_queue`,
`receipt_joined_ledger`, `receipt_unmatched_retired`, `receipt_ambiguous`.
Two numbers drive the two deferred decisions:

- `receipt_unmatched_retired` high → revisit "never create" (RC2's data
  clause).
- `item_sig_asked` / `item_sig_resolved` (Phase 2) — asked should fall toward
  zero within days as `item_signatures` fills; if it does not, the head-noun
  extractor is minting one-off keys.

## 17. Security invariants

1. A receipt row is sealed like every staged row; the database reads routing
   metadata only; `row_kind` is a clear workflow column, accepted trade as
   with `'notice'`.
2. No address or phone number is ever extracted, sealed, or stored —
   contract, prompt, and test all enforce it independently.
3. `receipt_enc` is personal-DEK ciphertext on an owner-locked table; it
   joins the regen sweep and the fail-closed decrypt rules; unreadable is
   surfaced, never zero/hidden.
4. The join runs entirely on-device; no server-side process can correlate a
   receipt to a transaction (amounts are sealed/encrypted on both sides).
5. A receipt can never create, delete, or change the amount/date/direction of
   any transaction; its writes are additive detail on rows the owner already
   holds, always filtered `link_id IS NULL` on the ledger side.
6. The item classifier backstop receives item name strings only.
7. Nothing here notifies; the pending badge is receipt-blind.
8. `item_signatures` (0155) holds **type words and slots only** — never a
   product title, never anything per-person; the device never reads it (it
   reads the node sealed into the item). The model is sent a signature, the
   provider and service type — never a title, an amount or a person.
9. A person's item pick is stored per user, encrypted, in the lessons blob —
   it never enters the shared table.

---

# Part 3 — Implementation plan

Landings in dependency order; each is shippable and inert without the next
(the standing pattern: capture without join stages invisible rows; join
without surfaces still writes detail for later).

| # | Landing | Contains | Deploys |
|---|---|---|---|
| **L1** | **Contract + schema + consent** | extended receipt block in `contract.mjs` + both mappers; migration (`row_kind` CHECK + `receipt_enc`); `mailbox_read_status()` re-check; consent v6 copy + client constant + worker-side version gate. *Inert: nothing fetches receipts yet.* | migration; `mailbox-sync`; client |
| **L2** | **Capture + reading** | `inboxQuery` gains `RECEIPT_DOMAINS` + per-sender subject filters; repeating-group item-block support in the format reader; hand-written Shopee + Apple format seeds (migration, like the VIB seeds); model prompt receipt block (no addresses; Grab minimal); `stage.mjs` stamps `row_kind='receipt'`/`txn_source`; tally stages. Verify against the scoreboard corpus before deploy. *Receipts now stage, invisibly.* | `mailbox-sync`; seed migration |
| **L3** | **The join** | `78-receipt-join.js`: open, collapse, match (queue + ledger slice), attach, retire, grace; queue-candidate enrichment fields; promote path writes `receipt_enc`; retroactive ledger write. *Detail lands on rows; no UI yet beyond data.* | client (SW bump) |
| **L4** | **Category + description** | item classification (local tiers + `merchant-concepts` batch, cached); DCA over `taxonomy.json`; cascade tier insertion; description rules (single / unanimous / "Seller · N món"; never-clobber). | client; (no `merchant-concepts` change) |
| **L5** | **Surfaces** | review-card 🧾 hint; list markers; the detail screen's Hoá đơn section with the voucher math; unreadable-blob state. | client |
| **L6** | **Measure + tune** | read the tally after 2–4 weeks of real mail: unmatched rate (RC2), mixed-basket rate (RC9), subject-filter misses; add Tiki/Lazada/ShopeeFood/Foody/Grab format seeds from observed formats (they launch on the model-once path until then). | — |

Cross-cutting rules for the build: every landing updates this spec's release
notes in the same commit (the effortless-spec contract); Edge deploys follow
`AGENT_SYNC.md` singleton announcements; migration numbers verified against
`origin/main` before applying; the `.gs` twin needs **no paste** for L1–L5
(forwarded receipts already match `senders.match`, and the join is
client-side — only the item-block reader would eventually be mirrored if
forwarding users need items, which is deferred).

## 18. Decision log

From the design interview, 2026-09-29.

| # | Decision |
|---|---|
| RC1 | Built as email-reading-v2 **Wave 2**, on its standing rules: consent v6 (receipts + bills in one copy; biller extraction later), no addresses ever, Grab order-level only. |
| RC2 | **Annotate, never create — strictly.** Unmatched receipts retire quietly after 14 days; no fallback card. `receipt_unmatched_retired` is tallied so the decision can be revisited with data. |
| RC3 | Line items are **structured** (`name, qty, unit_price, line_discount, variant`) plus order-level `seller, items_total, discount, shipping_fee, paid, paid_with_tail` — not names-only. No per-merchant schemas (Apple's texture folds into the item name / `service_type`). |
| RC4 | Scope: all **7 registered receipt domains** this wave. Billers named in consent, built later. |
| RC5 | Receipt detail **feeds the category cascade** (high-confidence tier below human/learned); one category per txn; split-categorization rejected. |
| RC6 | Retroactive enrichment: **queue + committed private personal rows**. Family rows and mirrors excluded (named gap). |
| RC7 | Storage: **`receipt_enc` blob** on `personal_transactions`, not a child table — E2EE voids server-side structure; single-row atomicity; one regen field; client-side explode-to-table stays open. |
| RC8 | **Every item carries its own `node`** in the blob, resolved on-device, for later item-level insight. |
| RC9 | Mixed baskets: txn node = **deepest common ancestor** of item nodes; DCA at root → merchant tier. Dominance-by-value deferred to data. |
| RC10 | Join rule: exact **paid** amount + direction + **±1 day**; card tail confirms/vetoes; ambiguity attaches nothing; one-to-one; queue beats ledger. `order_id` is receipt-side identity only. |
| RC11 | Lifecycle: `row_kind='receipt'` (notice pattern) — invisible to review, badge and notify; `RECEIPT_GRACE_DAYS = 14`; order-id collapse, richest wins. |
| RC12 | Surfaces: 🧾 hint on review cards, 🧾 marker on all txn list rows, full Hoá đơn section on the txn detail. No item snippets in list rows. |
| RC13 | Description pre-fill: single item → name; unanimous basket → summary; mixed → "Seller · N món". Machine-marked; never over a human edit; never on retroactive writes. |
| RC14 | The blob is **source-agnostic** (`source: 'email' \| 'ocr'`) — the future OCR paper-receipt door (AEON till receipts) lands in the same structure; camera flow out of scope here. |
| RC15 | Item classification: local tiers first, `merchant-concepts` batch backstop (names only), cached; unresolved abstains. Model never classifies items per-mail. |
| RC16 | *(supersedes RC15, 2026-09-30)* Items are categorised by a **signature ladder** on the worker at read time: tree keywords → learned `item_signatures` (type word / Apple slot / Apple vendor) → one batched model call per unseen signature → null. `merchant-concepts` is never asked about products. |
| RC17 | Signatures must be **determinate by construction**: head noun for marketplace goods, storefront+content-type or vendor for Apple, none for Grab (deterministic). A seller and `app store|subscription` are rejected as keys. A coarse-but-honest node is a valid terminal. |
| RC18 | **Guards, not a replay:** a signature the keywords can read is never asked and names every sibling; a model answer must be an expense code and a goods signature may never resolve to a venue/class; nulls are cached; `CATEGORY_LOGIC_VERSION` on every row, a bump re-learns. |
| RC19 | Device precedence: **person's lesson (by signature) → sealed node → keywords**, then the RC9 branch constraint. Tapping an item's pill opens the standard tree picker; the pick rewrites the blob and is learned per user, encrypted, by signature. A human pick is the only thing allowed outside the transaction's branch. |

| RC20 | *(2026-10-01)* **A statement row is a join target like any queue row.** The join reads the row shape both doors share (top-level `amount`/`direction`), `fhStmtAsStaged` mirrors `amount`/`currency` into `raw_extracted` so the two shapes stop differing, and a test feeds the join a row the real statement shaper built. |
| RC21 | **Grab is read at order level, one step richer:** `service_label` and `points_discount` join the block. Still no items, no pickup/drop-off. The label is taken only from the header zone and only when product-name-shaped; every other field is a number. Consent stays **v6**: its copy already names order mail from these merchants, and nothing address-like is added. |
| RC22 | **A day-only receipt may take the mail's send time** when it falls on the same Vietnamese day (`minute` precision, `src.occurred_at: 'heuristic'`). Grab only for now: it is the one sender that prints no clock and sends at the moment of charge. |
| RC23 | **A clock breaks a tie, and only a tie.** Exactly one candidate within 30 minutes wins when amount and day leave several and no tail decides. Never a veto, never widens the amount/day rule. On the ledger side the same agreement waives the 2-day young-receipt wait. |
| RC24 | **An order-level receipt still answers "chi cho gì":** "<Provider> · <service name>". It may replace a note that is empty, a bank's generic phrase, or only the merchant's own name; any other note stands. Never on retroactive writes (RC13 unchanged). |

## 20. Item categorisation — the signature ladder (Phase 2)

### 20.1 The problem the first cut had

Item categories came from `merchant-concepts`: a **merchant** classifier
("what kind of business is HIGHLANDS COFFEE") fed **product** names, with
every answer cached in a table shared by all users. "The Long Walk" is a famous
novel, so it answered `books` for a film rental; `bơi` in the merchant keyword
list means a *pool*, so a swim cap landed on a sports *venue*; and each wrong
answer was permanent, global, and a personal shopping list in a shop-name
table. Phase 0 (`7b0d642`) stopped all of it: items are categorised on the
device from the tree's own keywords, never vote the transaction's node, and
may only refine within its branch. Phase 1 (`c04cc7b`) gave sports gear a
real leaf. What remains is the gap: a product the keyword list has never
heard of gets no category, forever.

### 20.2 The template idea, applied to categories

The email reader pays for a mail format **once** and replays it free because
formats are few and repeat. A per-product cache can never do that — products
are unbounded and mostly seen once. The repeating, learnable thing is not the
product but the **slot it sits in**:

| Source | Signature (the cache key) | Why it converges |
|---|---|---|
| Shopee / Tiki / Lazada / ShopeeFood / Foody | `hn|<head noun>` — the product *type* phrase, e.g. `hn|mu boi`, `hn|noi chien` | Vietnamese (and Shopee-English) titles are **head-initial**: the type word leads, brand/model/colour trail. A few hundred type words cover most consumer shopping, and every swim cap ever sold is "mũ bơi". |
| Apple purchase receipt (layout A) | `apple|<storefront>|<content type>` — `apple|apple tv|movie rental` | the kind is fixed by the slot; only the title varies |
| Apple subscription invoice (layout B) | `apple|vendor|<vendor>` — `apple|vendor|youtube` | one vendor sells one kind of thing, and it recurs monthly — the most repeating purchase there is |
| Grab | none — a Grab receipt carries no items (address rule, §5), so there is nothing to categorise below the transaction | — |

**Not a signature, on purpose:** a marketplace *seller* (unbounded, no naming
convention, bought from once) and the coarse `app store | subscription`
(spans Giải trí and Giáo dục — Duolingo and YouTube share it). The rule: a
signature is valid only when its members share a category, and the
granularity that satisfies that differs per provider. A coarse-but-honest
node is a legitimate terminal, never a failure: the ladder descends only
when the evidence justifies it.

### 20.3 The ladder (worker, at read time — `item-category.mjs`)

1. **Tree keywords** — `keywordNode(name)`: deterministic, free.
2. **Learned signature** — `item_signatures` table, keyed as above. A row is an
   answer, a null row is "asked, unknowable" (never re-asked on this logic
   version).
3. **The model, once per unseen signature** — one batched call per run,
   spent from the same `classifyBudget` merchant classification uses. The
   prompt labels *product types and digital purchase kinds*, is handed the
   signature (never the full title), the provider and `service_type` as
   context, and the expense menu; it is told a physical product is a THING and
   never a place or service node.
4. **Nothing** — the item carries no category. Null always beats a guess.

The resolved node and the signature are sealed into the item
(`items[].node`, `items[].sig`). What the shared table ever holds is a type
word or a slot — the privacy story is the same class of data as merchant
names, and narrower than what the reader already sends the model for a
first-of-format receipt.

**What keeps a learned answer honest.** A learned email template is kept
only if replaying it reproduces the model's own answer. Categories have no
replayable artefact, so the guards are structural rather than a replay:
a signature the tree's keywords can read is **never asked** — the keyword
reading is authoritative and free, and every item under that signature
inherits it directly (a signature *is* a type; one reading names all); a
model answer must be a machine-fileable expense code, and a goods signature
(`hn|…`) may never resolve to a venue or class — the exact failure the
merchant classifier produced; an unknowable is cached as null so it is asked
once, not per mail; and `CATEGORY_LOGIC_VERSION` rides every row, so a bump
re-learns everything under a better prompt. A refused answer is neither
cached nor applied.

### 20.4 On the device — precedence and the correction loop

`78-receipt-join` resolves each item as: **the person's own lesson for that
signature → the sealed node → the tree keywords** (the last for blobs written
before Phase 2), then applies Phase 0's branch constraint unchanged. Items
still never vote the transaction's category.

Correction closes the loop at both levels. Re-filing the *transaction* drops
every item outside the new branch automatically. On the detail screen, the
item's category pill is the affordance: tap → the same tree picker every
other category row opens → the blob is rewritten and the choice is learned
**per user, encrypted, keyed by the item's signature** in the lessons store —
the next "mũ bơi" from any shop lands where this person said, with no call to
anyone. The person's pick outranks the sealed node and the tree; it is the
one thing that may place an item outside the transaction's branch.

### 20.5 What is deliberately out

- Runtime dispersion tracking (a signature that drifts over time): keys are
  chosen to be determinate and null is cached; revisit with data.
- Head-noun extraction for titles that lead with promo junk beyond the
  stripped set (`[Mã…]`, `Combo`, `Set`, quantities): those fall to the model
  or to null, never to a wrong answer.

## 21. Statement rows and the Grab reading (2026-10-01)

### 21.1 What was seen

01/10/2026: two Grab rides paid from MoMo (11.000đ at 12:23, 40.000đ at
13:34). Both e-receipts were staged within minutes (`row_kind='receipt'`,
personal scope, pending). The MoMo statement was opened the same afternoon and
its two GRAB rows reached "Duyệt giao dịch" with no Hoá đơn, no hint, and the
description "GRAB".

### 21.2 Causes

1. **The join could not see a statement row's amount.** It compared
   `receipt.paid` with `raw_extracted.amount`. A sealed email row has that
   field (the opener flattens the payload into `raw_extracted`); a statement
   row is built on the device and carried `amount` at the top level only. The
   comparison was against `undefined` for every statement row of every
   merchant. The join test built its queue row by hand in the email shape, so
   it could not fail. (RC20)
2. **The only path left was the retroactive one**, which waits 2 days for a
   young receipt and never pre-fills a note. (RC23)
3. **Grab's reading was too thin to show anything once joined**, and its math
   was wrong for a ride paid partly in GrabCoins: fare 47.000, promo 4.000,
   paid 11.000 — the 32.000 in points was never read. The service name was
   not read at all. (RC21, RC24)
4. **Latent:** Grab receipts are day-only and a wallet payment has no card
   tail, so two rides at one fare on one day could never be told apart. (RC22,
   RC23)

### 21.3 What changes, by layer

| Layer | Change |
|---|---|
| Contract (`contract.mjs`, model schema in `llm.mjs`) | receipt block gains `service_label`, `points_discount`; nullable, `PAYLOAD_V` stays 2 |
| Reader (`receipt-reader.mjs`) | Grab: header-zone service name, GrabCoins from the Breakdown; a day-only reading adopts the mail's send time on the same VN day |
| Statement shaper (`77-statement-capture.js`) | `raw_extracted.amount` / `.currency` mirrored, so both doors produce one shape |
| Join (`78-receipt-join.js`) | reads the shared top-level fields; clock tie-break in queue and ledger; clock agreement waives the young wait; order-level description |
| Review (`72-txn-review.js`, `56-csv-import-ui.js`) | merchant-name-only note counts as generic; the Hoá đơn block prints the service name and each deduction |
| Detail (`61-expense-detail.js`) | same block on the imported row |

### 21.4 What does not change

Annotate-never-create, exact paid amount, ±1 day, tail confirm/veto,
one-to-one, queue-before-ledger, no items for Grab, no address anywhere,
consent v6, nothing notifies. A receipt staged before this build keeps its
old reading: it now joins (cause 1 is device-side), but shows no service name
or GrabCoins until its mail is re-read (the §Part 4 recovery recipe of
2026-09-29).

## 19. Related documents

- `docs/specs/email-reading-v2-spec.md` — the reader, the contract, Wave 2's
  reservation (R12), the receipt-block outline this spec fills in.
- `docs/specs/effortless-transaction-logging-spec.md` — the capture chain,
  staging, sealing, retirement machinery receipts reuse.
- `docs/specs/transaction-review-spec.md` — the review screen the join
  surfaces in.
- `docs/specs/personal-ledger-spec.md` — the spine, keys, regen sweep.
- `docs/specs/category-tree-spec.md` + `taxonomy/taxonomy.json` — the node
  tree the DCA walks.
- `dedup-flaws-review.md` — the engine whose ledger index and
  mis-attachment bias the join borrows.
- `_shared/mailbox/senders.mjs` — the `RECEIPT_DOMAINS` contract (query
  filters) this spec honours.

---

# Part 4 — Release notes

### 2026-10-01 — statement rows join, Grab reads one level richer, a clock breaks ties · no migration · mailbox-sync v76 DEPLOYED · client pushed (e1708cb, SW v606)

- **For product:** a transaction that came from a "sao kê" file now gets its
  merchant receipt in the queue, exactly like one that came from a bank mail.
  A Grab ride shows what it was ("Grab · Car 6 chỗ ngồi") and math that adds
  up, GrabCoins included. Two rides at the same fare on one day are told
  apart by the minute.
- **Under the hood:** §21. RC20–RC24.
- **Spec sections updated:** §3.3, §3.4, §4, §9, §10.2, §11, §14, §15, §18,
  §21 (new); `statement-capture-spec.md` §8.2 note.
- **Deploy record:** live `mailbox-sync` v75 was downloaded and was identical
  to `main` before the deploy. The three Grab receipts staged under the old
  reader were deleted (pending rows, no tombstones) and the grant's
  `last_synced_at` set back 8 days; the 08:30 UTC tick re-staged all three
  with a clock (05:23Z and 06:34Z for the two rides of 01/10, matching the
  statement's 12:23 and 13:34) and restored the cursor.
- **Watch for:** the service name and GrabCoins are inside the sealed box, so
  they are confirmed only by opening the queue on a device. The model schema
  digest changed (two new receipt keys).

### 2026-09-30 — Phase 2: the item-category signature ladder · migration 0155 APPLIED · mailbox-sync redeployed · SW v600

- **For product:** a receipt item's category is now learned **once per
  type** and replayed free — "mũ bơi" from any shop, "Apple TV · Movie
  Rental", the YouTube subscription every month — instead of asking a
  merchant classifier per product and caching everyone's shopping list. On
  the transaction's detail screen the item's category pill is now a real
  control: tap it, pick from the same tree every category row uses, and the
  pick is saved at once **and remembered for the same kind of item next
  time**. An item whose kind nobody can name simply shows "Chọn loại".
- **Under the hood:** `item-category.mjs` (new) on the worker — keywords →
  `item_signatures` (0155; keys are type words `hn|mu boi` and Apple slots
  `apple|apple tv|movie rental` / `apple|vendor|youtube`; never a title,
  never per user) → one batched model call per unseen signature from the
  merchant classifier's own budget → null. A keyword-readable signature is
  never asked and names its siblings; a goods signature may never resolve
  to a venue/class; nulls cached; `CATEGORY_LOGIC_VERSION` on every row.
  `TAX.itemSignature()` (head-noun extractor) generated into both the
  client and the worker from one source (`gen-taxonomy.js`). Readers seal
  `items[].sig` (Apple: a section's storefront names every item under it).
  Contract: items gain `node`, `sig`. Device: `fhLessonItemNode` family in
  `24-lessons.js` (encrypted, keyed `item|<sig>`); `78-receipt-join`
  precedence lesson → sealed → keywords, a lesson survives the branch
  constraint; `fhNodePickOpen` gains a subtitle override so an immediate
  save never claims "waits for Save". Tests: `pipeline/item-category`
  (new), join/reader/contract pins. 142 suites green.
- **Spec sections updated:** §20 (new), decision log RC16–RC19 (RC15
  superseded), §20.2 Grab row (no items to categorise).
- **Watch for:** `read_tally` stages `item_sig_asked` / `item_sig_resolved`
  — asked should fall toward zero within days as the table fills; if it
  does not, the head-noun extractor is producing one-off keys. A detail
  screen opened before v600 shows the old inline pill until reload.

### 2026-09-29 (afternoon → evening) — the first real run, and what it exposed · mailbox-sync v71 → v73 · SW v591 → v598 · no migration

Four deploys in one afternoon, each fixing something the previous one's live
run showed; consolidated here because they are one story.

- **For product:** on the first real mailbox every receipt joined but showed
  no items. Fixed in three steps, then the detail screen and the review card
  were rebuilt to the app's own language, then item categories were made
  honest.
- **Under the hood:**
  1. *v71 — the line shape* (`e73808c`, `cf85e82`). `mailtext` puts every table
     cell on its own line, so a label's value is the NEXT line; the readers
     had assumed same-line labels and matched nothing — every receipt fell to
     the model, order-level only. Shopee's DELIVERY mail (the only one the
     subject filter fetched) puts "1." in its own cell; the PAYMENT mail
     ("Xác nhận thanh toán thành công") was never fetched at all. Readers
     rewritten to scan label→next line and both ordinal shapes; Shopee filter
     gains "thanh toán"; `fhPersonalSetReceipt(…, {upgrade:true})` lets a
     richer blob replace a poorer one (never over items, never over
     unreadable), and the join's 2-day young-receipt wait is skipped for an
     upgrade. Recovery recipe: delete stale receipt rows + their tombstones,
     nudge `mailbox_grants.last_synced_at` back (`POLL_DAYS` is 2).
  2. *v72 — Apple has two layouts* (`c9316f0`). "Your **invoice** from Apple."
     (11 of 19 in the corpus) uses labelled headers, the vendor as the section
     line, NO `TOTAL` label and symbol-first prices — unreadable and never
     fetched. One walk now covers both; the storefront names every item in
     its section; Apple filter gains "invoice from Apple". Grab's "Total Paid"
     sits above the figure (a bare `^TOTAL` read the word "Paid"); fare/promo
     now ride as the math, numbers only. Verified on the whole corpus: Apple
     19/19, Shopee 3/3, Grab 1/1, zero address leaks. Per-item categories
     rendered for the first time.
  3. *UI language pass* (`70df93c`, SW v596). Money through `fmt()`/`csvFmt`
     (§6.1 forbids hand formatting); SVG glyph for the 🧾 (§2.6 forbids emoji
     as icons); category as the neutral `.scv-cat` pill, brand colour
     withdrawn from content; row scale 15/500 name, 13 muted meta, tabular
     figure; device names ("Hien's MacBook Pro") dropped at render.
  4. *v73 — Phase 1 then Phase 0* (`c04cc7b`, `7b0d642`, SW v598). Tree: the
     sport subtree restructured (category-tree-spec §13.1, S1–S6) — the
     `boi` keyword was filing "Bồi dưỡng nghiệp vụ" as sport, live. Items:
     classified on the device from the tree's keywords (the
     `merchant-concepts` POST — a merchant classifier answering a product
     question, caching product titles for everyone — removed), items never
     vote the transaction's node (DCA removed), items refine within the
     transaction's branch only (§4). `mailbox-sync` v73 and
     `merchant-concepts` v9 redeployed for the new tree; one stale
     `merchant_concepts` row (`sports`) cleared.
- **Spec sections updated:** §4 rewritten, §11.1 rewritten, §3.4, §7, §14,
  §20.1; `category-tree-spec.md` §10.1, §13.1, §16.3; `email-reading-v2-spec`
  §4 receipt row.
- **Watch for:** rows imported under v70 keep their poor blob until a
  receipt re-stages and upgrades it; the 30-day re-read covered Aug 30 →
  now, older subscription receipts (Oct 2025 →) are readable but unfetched.
  The orphan grant `a4b5b845` still halves this mailbox's Gmail quota.

### 2026-09-29 — L1–L5 built in one session · migration 0154 WRITTEN (not applied) · mailbox-sync change NOT deployed · client SW v590 built (not pushed)

- **For product:** everything in Parts 1–3 except the go-live: receipts read
  (hand-written Shopee/Apple readers + Grab minimal + model fallback with the
  receipt prompt block), staged invisibly, joined on-device (queue + retroactive
  ledger), category via item nodes + DCA, description pre-fill, 🧾 hints on
  review cards and list rows, the Hoá đơn detail section, consent v6 copy.
- **Under the hood:** contract receipt block + `_block`/`_item` array pruning
  (`stage.mjs`); `receipt-reader.mjs` (new) routed from `readTransaction`;
  `RECEIPT_SUBJECTS` + consent-gated `inboxQuery({receipts})`; worker stages
  `row_kind='receipt'` (no fingerprint, never counted/notified, own tally
  stages `receipt_read`/`receipt_llm`/`receipt_staged`); `0154` =
  `personal_transactions.receipt_enc` + row_kind CHECK gains 'receipt';
  client: `78-receipt-join.js` (new), `fhPersonalSetReceipt`/`GetReceipt`,
  `receipt_enc` in the regen sweep + hydrate presence flag, promote carries
  `spec.receipt` + retires joined receipts with the batch, review fetch filter
  `row_kind.eq.txn`, `FH_CONSENT_V = 6`. Tests: `pipeline/receipt-contract`,
  `pipeline/receipt-reader`, `tools/receipt-join` (+4 existing pins updated:
  gemini-schema digest, notice-rows filter, consent-gate v6 texts,
  statement-lane version-coverage).
- **Spec sections updated:** status block; §10.2 (the format-table item-block
  design simplified to hand-written per-provider readers + the model-once path
  for the unseeded four — the `mail_formats` repeating-group learner is
  deferred to L6 with the seeds).
- **Deploy order (watch for):** ⚠️ 1) apply `0154` FIRST — the client's hydrate
  now selects `receipt_enc` and fails on a pre-0154 database; 2) deploy
  `mailbox-sync` (diff live vs main first, per AGENT_SYNC); 3) push the client
  (SW v590). Receipts only fetch for grants whose bank_email consent ≥ 6, so
  the worker change is inert until people re-affirm on the new client.
  Deliberately NOT built: `mail_formats` item-block learning (L6),
  Tiki/Lazada/ShopeeFood/Foody deterministic readers (L6, model-once until
  then), family-row enrichment, OCR door.
