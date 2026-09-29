# Receipt Enrichment — what the money actually bought

A bank email says *"681.700đ Tại Shopee"*. The Shopee email in the same mailbox
says *what that was*: swimming goggles and a cherry-print swim cap, sold by
olanevietnam, 841.700đ before a 160.000đ voucher. This feature reads the
merchant's own e-receipt (Shopee, Grab, Apple, Tiki, Lazada, ShopeeFood, Foody)
and **attaches it to the bank/wallet transaction the person already has** — line
items, seller, the voucher math, and a sharper category — so a ledger row stops
being "spent at Shopee" and becomes "bought swim gear".

> **Status, 2026-09-29.** Designed (design interview with the founder) and
> **built the same day — L1 through L5 coded, tested and building; NOT yet
> deployed** (migration 0154 unapplied, `mailbox-sync` not redeployed, client
> not pushed). See Part 4 for the landing record and the deploy order. This is Wave 2 of email reading v2 as reserved by
> `email-reading-v2-spec.md` R12 and the `RECEIPT_DOMAINS` contract in
> `senders.mjs` — the receipt block, the sender registry entries and the
> "annotate, never create" rule all pre-exist this spec; this document turns
> that outline into a full design and adds the storage, join, category and
> presentation layers.

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
  contain home addresses, so Grab is read **minimally**: service type, total,
  time, paid-with tail and booking id only, no line items, per the standing
  rule in `email-reading-v2-spec.md` §4.
- It never overwrites a human's words. A note the person edited is theirs; the
  pre-fill applies only where the note would otherwise be the generic
  merchant fallback, and retroactive enrichment never touches the note at all.

### 3.4 Where the detail shows

| Surface | What shows |
|---|---|
| Review card (queue) | "🧾 N sản phẩm · <seller>" hint on the collapsed card; the expanded card's description and category arrive pre-filled from the receipt |
| Transaction lists (Cá nhân tab, Giao dịch cá nhân, Xem chi tiêu) | a small 🧾 marker on rows that carry a receipt; the note text does the informational work — no item snippets in list rows |
| Transaction detail (`openPersonalTxDetail`) | the full **Hoá đơn** section: seller · items (qty × unit price, per-line discount) · items total · voucher/discount · shipping fee · **paid** · order id · source (email/OCR) |

## 4. Category and description — the rules

Every item name is resolved to a taxonomy node on-device (§11). Then:

| Basket | Transaction node | Description pre-fill |
|---|---|---|
| 1 item | the item's node | the item name ("The Long Walk") |
| N items, all one node | that node | short summary ("Kính bơi Olane +1 món") |
| N items, mixed nodes | **deepest common ancestor** of the item nodes; if the DCA is the tree root (meaningless), the cascade's merchant tier decides as today | "<Seller> · N món" ("Shopee · 2 món") — generic, never clueless |
| Items unparseable (order-level fields only) | cascade unchanged | cascade unchanged |

- Items whose node cannot be resolved abstain from the DCA vote (`node: null`).
- The receipt's category enters the cascade as a **high-confidence tier**
  (below an explicit human pick and a learned lesson, above the merchant
  tier) — a guess is still never final, and a human pick is still the only
  thing learned from.
- Pre-filled values are machine-marked, exactly like every other cascade
  guess: confidence decides where a row *shows*, never whether it imports.

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
  'items',           // [{ name, qty, unit_price, line_discount, variant }] — or null (Grab: always null)
  'items_total',     // 841700 — the pre-discount sum the mail prints
  'discount',        // 160000 — voucher/discount total
  'shipping_fee',    // 0
  'paid',            // 681700 — THE JOIN KEY; the amount that hit the instrument
  'paid_with_tail',  // "4751" — confirming evidence for the join
] }
```

Rules:

- Nullable additions only — `PAYLOAD_V` stays 2 (a key changes meaning to
  bump, and none does; `line_items` → structured `items` is a rename **in
  prose only**: the stored key is new, `line_items` is never emitted, and no
  production row ever carried it).
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
ambiguity: two surviving candidates and no tail to decide → attach nothing
priority: queue candidate beats ledger row (enrich before import when possible)
one-to-one: a receipt attaches to at most one txn; a txn takes at most one receipt
```

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

### 11.1 Item classification

Per item name, first hit wins:

1. On-device tiers: learned lessons → merchant/brand table → keyword
   (`guessCat`-class, deburred, over the item name — not the memo).
2. Backstop: unresolved names batched to `merchant-concepts`
   (`POST {merchants:[names…]}` — names only, no prices/qty/seller), answers
   cached in the shared concept cache exactly like merchant names.
3. Still unresolved → `node: null`, abstains from the DCA vote.

**DCA:** walk each resolved node's `parent` chain in `taxonomy.json`
(`{code, parent, depth}`), intersect; take the deepest shared node. DCA at a
kind root → meaningless → merchant tier decides. Deterministic, no tuning;
dominance-by-value stays a possible later layer, decided on §16's numbers.

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
               "variant": null, "node": "sports" } ],
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
| Tail on both sides disagrees | veto — never attached, even with amount+day equal |
| Item blocks unparseable | order-level receipt (`items: null`): join + voucher math work, no per-item detail |
| `receipt_enc` undecryptable | "chi tiết không đọc được" in the detail; txn unaffected |
| Receipt row unreadable (wrong scope key, tamper) | surfaced in the standard unreadable count; never joins |
| Campaign mail slips the subject filter | junk-cached once per shape, as any mail; never reaches a card |
| Txn filed to Gia đình | no private personal row exists → receipt retires unmatched (named v1 gap) |
| Person edits note/category after queue pre-fill | their value wins; receipt detail remains attached and visible |
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
| Extended: `review-notify.test.js` | receipt staging produces zero notifications |

## 16. Telemetry

`read_tally` gains stages: `receipt_staged`, `receipt_junk`,
`receipt_items_ok`, `receipt_items_degraded`, `receipt_joined_queue`,
`receipt_joined_ledger`, `receipt_unmatched_retired`, `receipt_ambiguous`.
Two numbers drive the two deferred decisions:

- `receipt_unmatched_retired` high → revisit "never create" (RC2's data
  clause).
- mixed-basket DCA outcomes (client-side count) → decide dominance-by-value
  (RC9's data clause).

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
