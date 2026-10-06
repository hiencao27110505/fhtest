# Receipt Providers: adding a store without writing a reader

Google Play mailed a subscription receipt on 2026-10-06 (Google One, 50.000đ,
paid from the MoMo wallet) and the app never saw it. Not because the mail was
hard to read: because adding a receipt sender today is four code changes in
the worker, a hand-written parser, a redeploy, and still only the first mail of
each shape per build gets through when the parser is missing. This spec turns
"a receipt provider" from code into **data**: a registry entry, a fast lane
that goes live without a deploy, a discovery pass that finds the next store
before anyone asks, and (release 2) a recipe the pipeline learns once per mail
shape so no provider ever needs a parser again.

> **Status, 2026-10-06 (evening).** Release 1 is BUILT and tested, not yet
> deployed: migration `0157` written (not applied), `mailbox-sync` not
> redeployed, SW `v615` built. `mailbox-dryrun` IS live from main with the
> `survey`/`peek` modes (RP13). Part 4 fills on deploy. Decisions RP1–RP13
> (§20) came from the design interview of 2026-10-06; the mailbox survey that
> grounded them is §21.

> **Audience & layering.** Part 1 (Behaviour) is for everyone. Part 2 is the
> technical appendix. Part 3 is the build plan, two releases. §20 is the
> decision log; §21 is what the test mailbox actually contains.

> **How this relates to its siblings.** `receipt-enrichment-spec.md` owns what
> a receipt IS once read (the block, the join, the item ladder, the detail
> screen). This spec owns how a sender BECOMES a receipt provider and how its
> mail gets read without a parser. `email-reading-v2-spec.md` owns the reader
> cascade and the template store this reuses. `account-identity-spec.md` owns
> `providers.json`, which this extends. `recurring-charges-spec.md` consumes the
> `period` field this adds. `reading-loop-cost-spec.md` owns the budget that
> discovery spends last.

---

# Part 1 — Behaviour

## 1. Summary

- A receipt provider is a **registry entry**, not code: who sends (domain or
  full address), which subjects are receipts, which reading family it belongs
  to, and the labels its mail uses. The registry already generates the client
  and the worker; it grows a receipt block.
- Two **fast lanes** make a sender live on the next run with no deploy: an
  operator row in `known_provider_domains`, or a member tapping **Thêm** on a
  store the app discovered in their mailbox. Both are global: a store one
  member confirms is read for every consenting mailbox. Mute is personal.
- **Discovery** looks, once per run and last in the model budget, for
  receipt-shaped mail from senders the app does not know, and remembers only
  the sender, the subject shape and a count. Never the body.
- **Consent v7** stops naming stores. It says "the stores and services listed
  in Settings", and Settings renders that list from the registry, so the
  promise is true by construction and stays true as stores are added.
- **Release 1** reads Google Play through a label dictionary on the same
  subscription-invoice family Apple's second layout already uses, adds `tax`
  and `period` to the receipt block, and makes item signatures store-neutral.
- **Release 2** removes the parser requirement: the first model read of a new
  mail shape also yields a **recipe** (label anchors over the text lines), the
  recipe is checked against the model's own answer before it is kept, and every
  later mail of that shape is read by the recipe, on our systems, for free.

## 2. Why this exists

The 2026-10-06 survey of the test mailbox (§21) found receipt mail from
senders the pipeline has never fetched, Google Play among them, and will find
more every month: subscriptions, marketplaces, rides, and bills all arrive as
e-receipts now. Each one hand-wired costs a day and a deploy; each one missed
is a transaction that stays "Google 50.000" instead of "Google One 100 GB,
hàng tháng". The consent copy already promises that a new receipt format is
learned once and then read locally; for providers without a parser that
promise is false today (one read per shape per build, then dropped). This
spec makes it true.

## 3. What the person sees

### 3.1 Settings → Email ngân hàng → Hoá đơn

One section, three parts, list language identical to the accounts list
(`DESIGN.md` list rows: label, trailing value, chevron or switch, hairline
dividers, no cards inside cards).

**Đang đọc.** Every store the pipeline reads for this mailbox, one row each:
store label, a one-line "từ hoá đơn đơn hàng" / "hoá đơn thuê bao" / "hoá đơn
chuyến đi" sub-line taken from the family, and a switch. Stores a member added
carry the sub-line "Do thành viên thêm". The switch is **Tắt cho hộp thư này**:
it mutes the store for this mailbox only and never for anyone else (§6).

**Gợi ý.** Senders discovery found in this mailbox that are not yet read:
store name as the mail signs it, "N email · gần nhất 3 thg 10", the model's
one-line reading of what the mail is ("Hoá đơn đơn hàng"), and a **Thêm**
button. Tapping it shows one sheet:

> **Đọc hoá đơn từ Tiki?**
> Tụi mình sẽ đọc email hoá đơn từ Tiki trong hộp thư này và của các thành
> viên khác đã đồng ý, chỉ để gắn chi tiết món hàng vào giao dịch đã ghi.
> Không bao giờ tự tạo giao dịch. Địa chỉ và số điện thoại không được đọc.
> [Thêm Tiki]  [Để sau]

After **Thêm**, the store moves to Đang đọc on the spot and is read on the
next run. If the sender is one discovery never surfaced, there is no way to
type it (§6).

**Đề xuất cửa hàng.** One plain row at the bottom: "Thiếu cửa hàng nào? Gửi
đề xuất" opening the existing feedback sheet with the subject pre-filled.
Discovery is expected to make this rare.

Copy rules: no store list in prose, store names only as rows; no "AI" in
section copy (the consent sheet already says it once); sentences under
fifteen words where they can be.

### 3.2 On a transaction

Nothing new in release 1 beyond what `receipt-enrichment-spec.md` §3 already
shows. A Google Play receipt attaches like an Apple one: "Google One · 100 GB"
as the description, one item row with its pill, and the math line
"45.000 + thuế 5.000 = 50.000" (§12). `period` surfaces through
`recurring-charges-spec.md`, not here.

## 4. Consent v7

The v6 text names seven stores. v7 names none:

> **vi.** Tụi mình đọc email hoá đơn từ các cửa hàng và dịch vụ trong danh sách
> ở Cài đặt, chỉ để gắn chi tiết món hàng vào giao dịch đã ghi từ email ngân
> hàng, không bao giờ tự tạo giao dịch mới. Danh sách này có thể dài thêm khi
> một thành viên thêm cửa hàng, và bạn tắt được từng cửa hàng cho hộp thư của
> mình. Để biết nên thêm cửa hàng nào, tụi mình cũng nhìn tiêu đề và người gửi
> của email trông giống hoá đơn từ cửa hàng chưa có trong danh sách; nội dung
> email đó không được lưu. Lần đầu gặp một mẫu hoá đơn, email đó được gửi cho
> AI của Google một lần để học cách đọc; các email sau cùng mẫu được đọc tại
> hệ thống. Địa chỉ và số điện thoại trong email không bao giờ được đọc hay lưu.
>
> **en.** We read receipt emails from the stores and services listed in
> Settings, only to attach item details to transactions already captured from
> bank email, never to create a transaction by themselves. That list can grow
> when a member adds a store, and you can switch any store off for your own
> mailbox. To learn which stores to add, we also look at the subject and sender
> of emails that look like receipts from stores not yet listed; their contents
> are not kept. The first time we meet a new receipt format, that one email is
> sent to Google's AI once to learn how to read it; later emails in the same
> format are read on our own systems. Addresses and phone numbers in those
> emails are never read or stored.

Gating (RP3): a grant on v6 keeps exactly today's behaviour, the seven named
senders with their curated subjects. Discovery, member-added stores, registry
entries added after v6, and the receipt-derived recurrence mark all require
v7. `RECEIPT_CONSENT_V` stays 6 for the seven; a new `RECEIPT_REGISTRY_V = 7`
gates everything this spec adds. `FH_CONSENT_V` becomes 7 with a change entry
written as the change ("the list now lives in Settings; a member can add a
store; we look at subjects to suggest stores").

## 5. What discovery is and is not

Discovery is a **header pass**. For a v7 grant, after the real reads, the
worker lists mail in the window whose subject matches a short generic list
("hoá đơn", "hóa đơn", "đơn hàng", "receipt", "invoice", "order", "biên lai",
"thanh toán thành công") and whose sender is not a bank, wallet, registered
receipt sender, muted store, personal mailbox or already-known candidate. It
fetches **metadata only** for at most ten of them and records, per sender
and subject template, a count and a last-seen date. The model is asked once
per new (sender, template) pair, from whatever budget the run has left, for a
one-line verdict: receipt / bill / campaign / other, and a store name as the
mail signs it. Campaign and other are remembered so they are never asked
again. Receipt and bill appear under Gợi ý.

It is not a reader: no body is fetched, nothing is staged, nothing joins.
It is not automatic: nothing becomes a provider without a tap or an operator
row (RP5). It is not private per user: a candidate is global knowledge about a
sender, never about a person, which is why only the sender, the template and
counts are stored.

## 6. Safety rules

1. **Nothing is read from a sender nobody chose.** The registry, an operator
   row, or a member's tap on a discovered sender are the only three doors.
   There is no field to type an address into.
2. **Refused senders.** Personal mailbox domains (`FREE_MAIL`), any domain
   `match` already knows as a bank or wallet, and any address `isPersonSender`
   flags, can never be added as receipt senders, by anyone.
3. **A member's add is global; a member's remove is personal.** Mute writes a
   per-mailbox row; only an operator sets `active = false` on the global row.
4. **Subject gate always.** A sender added from discovery is fetched only with
   the subject templates discovery observed for it. No bare domain ever enters
   the query (the firehose rule in `senders.mjs`).
5. **Discovery stores no content.** Sender address, subject template, counts,
   dates, the model's one-word verdict and store name. A body is fetched by
   discovery exactly never.
6. **Receipts still never create transactions.** Every rule in
   `receipt-enrichment-spec.md` §6 holds for a provider added by any lane.
7. **A recipe never outranks arithmetic.** A recipe's reading is accepted only
   when the paid figure is positive and the block's math balances (§14).

## 7. Status and current limits

- Release 1 ships Google Play as the only new hand-dictionaried provider.
  Tiki and Lazada remain model-only and capped until release 2 (RP12).
- Discovery sees only the subjects in its generic list. A store whose receipts
  say none of those words is found by nobody until someone proposes it.
- `known_provider_domains` is read once per run; a member's add is live on the
  next run, not the current one.
- A grant on v6 sees none of this until its owner re-consents.

---

# Part 2 — Technical Appendix

## 8. Architecture in one view

```
taxonomy/providers.json  ──gen-providers──►  09-providers.js (client)  ──► Settings list, consent "listed in Settings"
        │ receipt block                       providers.mjs (worker)   ──► senders.match / inboxQuery / family + labels
        │
known_provider_domains (+kind, subjects, family, added_by)  ──► db.providerDomains() ──► unioned into match + query each run
receipt_sender_mutes (grant_id, sender)                      ──► subtracted from THIS grant's query
receipt_candidates (sender, template, verdict, counts)       ──► Settings › Gợi ý ; worker skips known candidates

worker run (v7 grant):  banks/wallets ─► registered receipts ─► [discovery: ≤10 metadata, model last] 
receipt read:  family dictionary ─► stored recipe (R2) ─► model (one per shape per build) ─► recipe born (R2)
```

## 9. The registry: `providers.json` receipt block

An entry with `kind: 'receipt'` gains:

```json
{ "key": "googleplay", "label": "Google Play", "kind": "receipt",
  "names": [], "bins": [], "codes": [],
  "receipt": {
    "senders":  ["googleplay-noreply@google.com"],
    "subjects": ["\"Google Play Order Receipt\""],
    "family":   "subscription_invoice",
    "labels":   { "order_id": ["Order number"], "order_date": ["Order date"],
                  "items_head": ["Item"], "tax": ["Tax"], "total": ["Total"],
                  "payment": ["Payment method"], "period": ["/month", "/year"] }
  } }
```

Rules, enforced by `gen-providers.js` (a registry that breaks them silently
reads the wrong mail):

- `senders[]` entries are a bare domain (`grab.com`, matched with the dot
  boundary rule) or a full address (`googleplay-noreply@google.com`, matched
  exactly). A full address is required when the domain also carries unrelated
  mail; the generator refuses a bare domain in `FREE_MAIL` or one `BANKS`/
  `WALLETS` already own.
- `subjects[]` is non-empty: the cost gate is not optional (`senders.mjs`
  RECEIPT_SUBJECTS note).
- `family` is one of `marketplace_order | subscription_invoice | service_receipt
  | model_only`. `labels` is required unless `model_only`.
- The seven live providers move into this block unchanged (their domains and
  subjects as today), so `RECEIPTS` and `RECEIPT_SUBJECTS` in `senders.mjs`
  become generated views of the registry rather than hand lists. Behaviour for
  a v6 grant is byte-identical: the generated map is the same map.

`senders.match(from, extra)` gains an address-level compare for registry
receipt senders and for `extra` rows whose `domain_or_address` contains `@`,
before the domain walk.

## 10. Fast lanes: operator row and member add

`known_provider_domains` (0025, seeded 0050) gains, migration `0157`:

| Column | Notes |
|---|---|
| `kind text not null default 'bank'` | `bank \| wallet \| receipt`; existing rows stay `bank` (today they are unioned as banks) |
| `subjects text[]` | the subject gate for a receipt row; required when `kind = 'receipt'` (CHECK) |
| `family text` | §11 family or `model_only` |
| `added_by uuid` | the member who tapped Thêm; null for operator rows |
| `candidate_id uuid` | the `receipt_candidates` row it was promoted from |

`db.providerDomains()` returns the receipt rows too; `inboxQuery` ORs each
in as `(from:<sender> subject:(<templates>))` exactly like registry receipts;
`match` returns `{ provider: provider_name, kind: 'receipt', family }`.

**Member add** is one RPC, `receipt_sender_add(candidate_id)`, SECURITY
DEFINER: it re-checks the refusal rules (§6.2) server-side, copies sender,
observed templates, store name and verdict from the candidate into a
`known_provider_domains` row with `kind='receipt'`, `family='model_only'`,
`added_by = auth.uid()`, and marks the candidate `promoted`. Idempotent on
sender. There is no RPC that takes an address.

**Mute** is a per-grant table `receipt_sender_mutes (grant_id, sender,
created_at)`, owner RLS; the worker subtracts a grant's mutes from its query.
Un-mute deletes the row.

## 11. Families and label dictionaries

Three reading families cover every receipt seen so far (§21):

| Family | Shape | Readers |
|---|---|---|
| `marketplace_order` | item table with qty and unit price, voucher lines, shipping, a paid total | `readShopeeReceipt` today; Tiki/Lazada later by recipe |
| `subscription_invoice` | one or few items, a vendor line, tax or VAT line, a total, a payment method, often a period | `readAppleReceipt` layout B today; Google Play in release 1 |
| `service_receipt` | fare or order total, promo, points, no items | `readGrabReceipt` today |

Release 1 adds `readSubscriptionInvoice(text, labels)`: a line-stream walk
over `mailtext` output parameterised by the label dictionary, reading a label
on the value's own line ("Total: 50.000 ₫/month") or on the line before it
("Payment method:" / "MoMo e-wallet: •••• 1217"), since §21 found both.
Apple KEEPS its own reader for now (two layouts, storefront sections) and
folds in when its dictionary covers both; the registry still carries its
labels so the fold is a data change. `readReceiptMail` picks a provider's own
reader first, else the registry family for the mail's From
(`senders.receiptEntryFor`), else the model. The walk:

1. `order_id`: the line after any `labels.order_id` line.
2. `occurred_at`: the line after `labels.order_date`, parsed with the existing
   date reader; a "GMT+7" suffix is honoured.
3. Items: lines between the `labels.items_head` row and the first `labels.tax`
   or `labels.total` line, grouped as text lines followed by a price line;
   a parenthesised "(by Vendor)" tail becomes the vendor; "Auto-renewing
   subscription" and similar `labels.renewal` lines become `variant`, and set
   `period` when a `/month` or `/year` suffix is on the price.
4. `tax`: the money after `labels.tax`. `paid`: the money after `labels.total`.
   `items_total` = sum of item prices when every item has one, else null.
5. `paid_with_tail`: the last four digits on the line after `labels.payment`.
6. Signature per item (§13): `sub|<vendor>|<product>` when `period` or a
   renewal line is present, else `store|<storefront>|<kind>`.

Apple's two layouts keep their current tests; a Google Play fixture (real
structure, PII scrubbed, repo is public) joins `receipt-reader.test.js`.

## 12. Contract additions: `tax` and `period`

`contract.mjs` receipt block gains two nullable keys:

```
'tax',      // 5000 — a separate tax or VAT line the mail prints; null when prices are inclusive
'period',   // 'month' | 'year' | 'week' | null — the billing period a subscription receipt states
```

`PAYLOAD_V` stays 2 (nullable additions). The honest math becomes
`items_total − discount − points_discount + shipping_fee + tax = paid`, and
the card shows the tax term only when it is non-zero. Both mappers
(`_toReading`, `normaliseReading`) and the `_block` whitelist change in the
same commit. `period` is the input `recurring-charges-spec.md` RR1 reads.

## 13. Signatures become store-neutral

`item-category.mjs` keys (RP8):

| Key | Meaning | Example |
|---|---|---|
| `hn\|<head noun>` | marketplace goods, unchanged | `hn\|kinh boi` |
| `sub\|<vendor>\|<product>` | any subscription from any store | `sub\|google\|google one`, `sub\|youtube\|youtube premium`, `sub\|duolingo\|duolingo plus` |
| `store\|<storefront>\|<kind>` | one-off store content | `store\|apple tv\|movie rental`, `store\|google play\|app` |

`apple|<store>|<kind>` and `apple|vendor|<v>` are not emitted any more.
`CATEGORY_LOGIC_VERSION` bumps to 2, so the seven existing rows retire by
version mismatch on their next sighting. The prompt's examples change with
the keys. `sub|…` is asked of the model: Duolingo is `courses`, Strava is
`fitness`, Google One is `streaming` ("Streaming & thuê bao số"); the leaf is
the fallback when the model answers null, never the default. The structural
gate (goods never under `fitness`) applies to `hn|` keys only, as now.

## 14. The recipe engine (release 2)

**Where.** `sender_fingerprints.extraction_regex`, the column transaction
templates already use as JSON, keyed by the same (sender address, subject
template). A receipt fingerprint carries `{ v: 1, kind: 'receipt', recipe }`.
Lifecycle, hygiene sweeps and the per-build cap are the ones templates have.

**Birth (RP10, Q32b).** The model is never asked to write rules. On the first
model read of a shape, `recipe.mjs` takes the model's values and the mail's
line stream and, for each scalar value, finds the line that holds it and the
nearest preceding label-shaped line (short, ends with `:` or is Title Case, no
digits); for the items array, finds the lines holding each item's name and
price and the two labels that bracket the run. The recipe is kept only if
replaying it on the same lines reproduces every value the model gave
(self-check). Otherwise the fingerprint records `recipe: null` and the mail is
staged from the model's values as today.

**Primitives.** Four, by design small:

```
{ field: 'paid',     anchor: /^Total:?$/i,        take: 'next', parse: 'money' }
{ field: 'order_id', anchor: /^Order number:?$/i, take: 'next', parse: 'text' }
{ field: 'occurred_at', anchor: /^Order date:?$/i, take: 'next', parse: 'date' }
{ field: 'items', between: [/^Item$/i, /^(Tax|Total):?$/i], row: { text: '1..3', price: 'last' } }
```

`take` is `next` or `same` (value on the label's own line after the colon).
Anchors are matched on the trimmed line, case-folded, diacritics-folded.

**Use.** A later mail of the shape runs the recipe first. The reading is
accepted when `paid > 0` and `items_total − discount − points_discount +
shipping_fee + tax` is within ±1 of `paid` whenever at least two of those
terms are present. Otherwise the mail falls to the model under the normal
per-shape cap, and the fingerprint's `recipe_fail` counter increments. Two
consecutive failures replace the recipe with the next successful birth; a
build change (`model_read_build`) relearns once, like templates.

**What it does not do.** It never reads a field the block does not list
(`_block` prunes anyway); it never invents an item from a line without a
price; it never runs on a `model_only` family's first mail (that one is the
birth).

## 15. Taxonomy changes

Bare `google` and `apple` leave `streaming.kw` (RP9). `google one`,
`youtube premium`, `icloud`, `apple.com/bill`, `apple com bill` stay. A MoMo
row that says only "Google" lands on no leaf until its receipt joins and the
item decides; the merchant-concepts tier still gives it a concept. Taxonomy
`version` bumps to 4 and the sweep cursor `fh-tree-bf` to its next value, so
rows already filed by the bare word are re-read.

## 16. Telemetry (`read_tally` stages)

| Stage | Meaning |
|---|---|
| `receipt_capped` | a receipt mail dropped by the per-shape model cap (release 1 has a number to beat) |
| `discovery_listed` / `discovery_meta` | ids listed, metadata fetched |
| `discovery_asked` / `discovery_receipt` / `discovery_campaign` | model verdicts |
| `recipe_born` / `recipe_hit` / `recipe_fail` / `recipe_relearn` | release 2 |

And one count in the Settings sheet for operators: candidates by verdict, from
`receipt_candidates`.

## 17. Failure modes

| Failure | Behaviour |
|---|---|
| Registry entry with a bare domain that also sends campaigns | generator refuses when the domain is in FREE_MAIL/BANKS/WALLETS; otherwise the subject gate is the defence, as today |
| Member adds a sender that is really a bank | RPC refuses (§6.2); UI never offered it because discovery excludes matched senders |
| Discovery hits Gmail quota | metadata fetch retries three times with backoff; the pass ends early and tallies `discovery_quota`; nothing else in the run is affected because discovery runs last |
| A recipe reads the wrong number | arithmetic check fails, mail goes to the model, `recipe_fail` increments; two in a row and the recipe is replaced |
| A label dictionary drifts (Google renames "Order number") | the family reader returns null, the mail goes to the model under the cap; release 2 learns a recipe for the new shape |
| Grant on v6 | nothing new runs; the seven providers behave exactly as before |

## 18. Tests

- `pipeline/gen-providers.test.js`: receipt block rules (address vs domain,
  refused domains, non-empty subjects, family set); generated `RECEIPTS`/
  `RECEIPT_SUBJECTS` equal the hand lists for the seven.
- `pipeline/sender-gate.test.js`: address-level match; a `known_provider_domains`
  receipt row joins the query with its templates; a mute removes it for that
  grant only.
- `pipeline/receipt-reader.test.js`: Google Play fixture (both the renewal
  mail and, when one exists in the mailbox, a one-off order), `tax`, `period`,
  `paid_with_tail`, `sub|google|google one`.
- `pipeline/receipt-contract.test.js`: `tax` and `period` sealed, unknown keys
  still pruned.
- `pipeline/item-category.test.js`: `sub|`/`store|` keys, logic version 2,
  the structural gate still only on `hn|`.
- `pipeline/discovery.test.js`: exclusions, the ten-mail cap, budget-last,
  nothing but headers stored, verdict caching.
- `pipeline/recipe.test.js` (release 2): birth from values, self-check refusal,
  arithmetic gate, relearn after two failures.
- `pipeline/consent-gate.test.js`: v6 grant sees no discovery, no added store.

## 19. Security invariants

1. No code path accepts a typed sender address from a client.
2. Discovery never calls `getMessage`; only `getMessageMetadata`. A test wraps
   the Gmail module and asserts it.
3. `receipt_candidates` holds no `user_id` and no body text.
4. A receipt row from any lane carries `row_kind = 'receipt'` and never a
   `dedup_fp`; it cannot become a transaction (receipt-enrichment §17).
5. A recipe is derived from a mail the person's consent already sent to the
   model; it adds no new disclosure.
6. Registry generation is deterministic; the Settings list and the worker
   query are built from the same JSON in the same build.

---

# Part 3 — Implementation plan

## Release 1 (Google Play, registry, lanes, discovery, signatures)

| # | Landing | Files |
|---|---|---|
| L1 | Registry receipt block + generator rules; `senders.mjs` reads the generated maps; address-level match | `taxonomy/providers.json`, `tools/gen-providers.js`, `senders.mjs`, tests |
| L2 | `0157`: `known_provider_domains` columns, `receipt_sender_mutes`, `receipt_candidates`, `receipt_sender_add` RPC | migration, `db.mjs` |
| L3 | Subscription-invoice family reader with label dictionaries; Google Play dictionary; `tax`/`period` in contract, mappers, readers, card math | `receipt-reader.mjs`, `contract.mjs`, `stage.mjs`, `worker.mjs`, `ingest.mjs`, `56-csv-import-ui.js`, `61-expense-detail.js` |
| L4 | Store-neutral signatures, logic version 2, prompt | `item-category.mjs`, tests |
| L5 | Discovery pass in the worker, budget-last, tallies | `worker.mjs`, `discovery.mjs` (new), `gmail.mjs` unchanged |
| L6 | Consent v7 copy and gates | `75-consent-ui.js`, `senders.mjs` (`RECEIPT_REGISTRY_V`), `consent-gate.test.js` |
| L7 | Settings › Hoá đơn (Đang đọc, Gợi ý, Đề xuất) | `71-mailbox-ui.js` or sibling, CSS, copy review |
| L8 | Taxonomy v4: bare brand words out; cursor bump | `taxonomy.json`, `gen-taxonomy`, cursor |
| L9 | Deploy: `0157` applied, `mailbox-sync`, `mailbox-dryrun`, SW bump; Part 4 entry | AGENT_SYNC claims first |

## Release 2 (recipes)

| # | Landing |
|---|---|
| R1 | `recipe.mjs`: birth from values, self-check, four primitives |
| R2 | `readReceiptMail` order: family dictionary → recipe → model → birth |
| R3 | Arithmetic gate, failure counter, relearn, build change |
| R4 | Tallies; Tiki and Lazada observed to leave `receipt_capped` |

---

## 20. Decision log

From the design interview, 2026-10-06.

| # | Decision |
|---|---|
| RP1 | **Two releases.** Release 1: registry, Google Play family reader, `tax`/`period`, store-neutral signatures, discovery, Settings list, consent v7. Release 2: the recipe engine. |
| RP2 | **The registry is `providers.json`.** `kind: receipt` entries gain a receipt block (senders as domain or full address, subjects, family, labels). One registry, two generated targets. `match` compares full addresses too. |
| RP3 | **Consent v7 names no stores.** "Listed in Settings", rendered from the registry; one sentence on discovery and member adds. v6 grants keep today's seven; everything new needs v7. |
| RP4 | **Discovery for all v7 users.** Generic subject terms over unknown senders, ten metadata fetches per run, model last in line on the shared budget, stores sender + template + counts + verdict, never a body. |
| RP5 | **Two fast lanes, both global, no deploy.** Operator row in `known_provider_domains`, or a member's Thêm on a discovered sender. Observed templates are the gate. Typed addresses, personal domains, banks and wallets refused. Mute is per mailbox; only an operator deactivates globally. Hand-graduation into the JSON when a sender earns a reader. |
| RP6 | **The per-shape model cap stays** for providers without a reader until release 2; drops tallied as `receipt_capped`. |
| RP7 | **`tax` and `period` join the receipt block**, nullable; `PAYLOAD_V` stays 2. Math: items_total − discount − points_discount + shipping_fee + tax = paid. |
| RP8 | **Store-neutral signatures:** `sub\|vendor\|product` for subscriptions, `store\|storefront\|kind` for one-off content; Apple-only keys retire via `CATEGORY_LOGIC_VERSION = 2`. `sub\|` is asked of the model; the subscriptions leaf is the fallback on null. |
| RP9 | **Bare `google` and `apple` leave the streaming node.** Taxonomy v4, cursor bump. |
| RP10 | **Recipe engine:** stored in `extraction_regex` as JSON per shape per build; born from the model's values by locating them in the line stream (the model never writes rules); kept only if it reproduces those values; used only when paid > 0 and the math balances within ±1; two failures replace it. Four primitives. |
| RP11 | **Settings › Hoá đơn** with Đang đọc (provenance, mute), Gợi ý (count, verdict, Thêm), Đề xuất cửa hàng. House list language, concise copy, no GenAI tells. |
| RP12 | **Release 1 hand-dictionaries Google Play only.** Tiki and Lazada are release 2's first proof. |
| RP13 | **The survey is the method.** Before registering a store, the dry-run function's `survey` mode (headers only, personal senders counted not named) lists who writes to a mailbox; `peek` returns a few mails' text lines for the label dictionary. Both are read-only and secret-gated like the dry run. |

## 21. Mailbox survey, 2026-10-06

Method: `mailbox-dryrun` `mode: "survey"`, 365 days, grant of the test
mailbox, pages of 200 to 400 (1.000 hit the isolate's 150 s wall; Gmail
answered two metadata fetches with a quota 403 across 3.730, retried). Headers
only; personal senders counted, never named. Raw pages live in
`research/statements/survey-hien-p*.json` (local only, gitignored); the
aggregation scripts beside them.

**Size.** 3.730 messages, 184 senders, 32 from personal mailboxes. Banks are
the bulk: VIB card notices 344, VIB transfers 251, Vietcombank card notices
103. Then LinkedIn, GitHub, Teams and newsletters.

**Receipt senders the pipeline reads today**, with the subject shapes seen:

| Sender | Receipts | Shapes |
|---|---|---|
| Apple `no_reply@email.apple.com` | 20 | "Your invoice from Apple." 11 · "Your receipt from Apple." 9 · plus 3 subscription notices (Expiring / Confirmed / Renewal) that carry no charge |
| Shopee `info@mail.shopee.vn` | 8 | "Đơn hàng #… đã giao hàng thành công" 4 · "Xác nhận thanh toán thành công" 4 · plus OTP, returns, newsletter |
| Grab `no-reply@grab.com` | 5 | "Your Grab E-Receipt" 5 · plus account mail |
| MoMo (wallet) | | "Sao kê lịch sử giao dịch" 4, "Xác nhận đặt vé CGV …" 3, "Thiết lập thanh toán thành công cho dịch vụ Google" 1 |

Tiki, Lazada, ShopeeFood, Foody: none in this mailbox.

**Receipt senders the pipeline does NOT read**, found by subject shape:

| Sender | Mails | Shape | Family |
|---|---|---|---|
| Google Play `googleplay-noreply@google.com` | 12 | "Your Google Play Order Receipt from Oct 6, 2026" (monthly, Google One) | subscription_invoice — **release 1** |
| FastSpring `mailer@fastspring.com` | 4 | "…your payment for subscription to "Capture One Pro - Annual Subscription" was successful" | subscription_invoice (a processor sending for many vendors; the vendor is in the subject) |
| Google Payments `payments-noreply@google.com` | 2 | "Google Cloud Platform & APIs: Payment received" | subscription_invoice (one line: amount, card tail, date) |
| Anthropic via Stripe `invoice+statements@mail.anthropic.com` | 1 | "Your receipt from Anthropic, PBC #…" | subscription_invoice (Stripe receipt: one flattened line) |
| Thanh Bưởi bus `info@thanhbuoibus.com.vn` | 1 | "THANH BUOI - Xác nhận thanh toán thành công, Mã vé: …" | service_receipt (ticket; the mail carries phone numbers and a pickup address, which the block has no key for) |
| Mắt Bão e-invoice `hoadon@matbao.in` | 1 | "… Thông báo phát hành Hóa đơn điện tử số …" | bill (a VAT e-invoice issued for the same bus ticket) |
| Ride Plus `online@rideplus.vn` | 2 | "Thông báo xác nhận đơn hàng RD…" / "Xác nhận thanh toán" | marketplace_order (plus two campaigns from the same address) |

**Peeked shapes** (`mode: "peek"`, text lines as the readers see them):

- Google Play: label and value share a line ("Order number: …", "Total:
  50.000 ₫/month"); the single item row carries its price on the same line
  ("100 GB (Google One) (by Google LLC) 45.000 ₫/month"); a renewal line
  follows; "Payment method:" stands alone and the wallet tail is on the next
  line ("MoMo e-wallet: •••• 1217"). Tax is separate. The date reads "Oct 6,
  2026 1:27:40 PM GMT+7". Every one of the twelve has the same shape.
- FastSpring: a template-rendering bug in the vendor's own mail ("property
  missing for template expression {{display}}"), then "Subscription renews
  every 1 year." and "Next charge: 1/13/27 ($208.71)." USD, so `period` and
  the next date are stated but the amount is foreign (foreign-currency spec).
- Stripe (Anthropic): the whole receipt is one line: "Receipt from Anthropic,
  PBC $5.00 Paid March 10, 2026 … One-time credit purchase Qty 1 $5.00 Total
  $5.00". Readable by a recipe with same-line anchors; USD again.
- Google Payments: "Your payment of ₫763,018 (reference CLOUD … on Mastercard
  • • • • 4751) was applied to Google Cloud Platform & APIs on Jul 1, 2026."
  One sentence; a recipe anchored on "Your payment of" reads it.

**What this changed in the design.**

1. The subject gate for Google Play is one phrase, `"Google Play Order
   Receipt"`: the two other mails from that address are terms-of-service
   notices, and the earlier draft's broad `"Google Play"` term would have
   fetched them.
2. Subscription receipts put label and value on ONE line as often as on two.
   The family reader reads both (`_labelVal`), and the recipe engine's
   `take: same | next` primitive is not optional.
3. Payment processors (FastSpring, Stripe) send for many merchants from one
   address. The registry's `sender` is the processor; the merchant is read
   from the mail; the signature is `sub|<vendor>|<product>` with the vendor
   from the body, never the sender. Discovery's verdict prompt says so.
4. Foreign-currency receipts exist in this mailbox (USD subscriptions). They
   join only when the bank row carries the VND figure; the spec defers them to
   `foreign-currency-emails-spec.md` and release 2 records the gap in a tally.
5. "Subscription" as a discovery term fetches three Apple notices and an
   Exploratory price-change campaign in this mailbox. Four verdict cache rows,
   one model call, then silence: the cost is acceptable for the renewals it
   finds elsewhere.
6. Generic subject terms found every unregistered receipt sender above and no
   bank. "trip" and "order" alone were dropped from the term list after the
   survey: travel newsletters and LinkedIn carry them.

## 22. Related documents

- `receipt-enrichment-spec.md`: the receipt block, join, item ladder, detail.
- `email-reading-v2-spec.md`: reader cascade, template store, `PAYLOAD_V`.
- `account-identity-spec.md`: `providers.json` and the generator.
- `recurring-charges-spec.md`: consumer of `period`.
- `reading-loop-cost-spec.md`: the budget discovery spends last.
- `pipeline/SEALED-STAGING-DESIGN.md`: why nothing here changes the envelope.

---

# Part 4 — Release notes

**2026-10-06 — Release 1 live.** `0157` applied; `mailbox-sync` v77,
`mailbox-dryrun` v17 (survey + peek); SW `v615`; taxonomy v4, sweep cursor
v14; `CATEGORY_LOGIC_VERSION` 2; consent v7. Google Play reads
deterministically by label dictionary; registry receipt block generated into
`senders.mjs`; fast lanes (operator row, member Thêm, per-mailbox mute);
discovery last in the run for v7 grants; Settings › Hoá đơn. Tiki and Lazada
stay model-only until release 2 (`receipt_capped` is the number to beat).
Known gap: USD receipts (FastSpring, Stripe) are not joinable until the
foreign-currency work lands.
