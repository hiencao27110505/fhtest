# The notification learns what you bought

A Shopee order for swimming goggles and a swim cap reaches the queue as
"Mua sắm mạnh tay ghê, cân lại tháng này nha!". At that same moment the pipeline
is holding the receipt for that order: two items, both named, both already filed
under sport. The notification says shopping because the voice was chosen from a
bank line that knows only a merchant and a figure, and nothing ever told it about
the basket.

Since 2026-09-29 merchant receipts are read, itemised and categorised. This spec
spends that knowledge on the one surface the person sees without opening the app.

> **Status, 2026-09-30. Phase 1 LIVE.** Deployed the same day:
> `mailbox-sync` **v75**, `push-send` **v24**, client SW **v603**. Grown out of
> `research/notify-items-copy.html` proposal P3 and a design interview the same
> day. What landed: ten item pools and three basket shapes in
> `taxonomy/notify-lines.json` (generated into both runtimes), the run-scoped pair
> index in `worker.mjs`, the `receipt_read` kind end to end, and the three tallies
> of §12. SW **v603**. No migration. Tests: `pipeline/receipt-pairing.test.js` (17)
> and the extended `tools/notify-lines.test.js` (40). §7 still stands: the same-run
> premise has not been observed in production, so the feature is live but unproven
> until one real order goes through. Phase 2 is the device half and is deliberately
> a later release.

> **How this relates to its siblings.** `receipt-enrichment-spec.md` owns receipts,
> items and the branch rule; nothing about item categorisation changes here.
> `effortless-transaction-logging-spec.md` owns the pipeline this hooks into.
> `docs/features/web-push.md` owns the payload contract, which this spec extends by
> exactly one enum field and one kind. `habit-streak-spec.md` owns the digest whose
> on-device composition phase 2 copies.

---

# Part 1 — Behaviour

## 1. Summary

- **One purchase, one push, sharper.** When the bank alert and the merchant receipt
  are understood together, the ordinary capture notification simply says something
  truer. It is not a second notification and not a new kind.
- **A late receipt gets its own quiet line, and claims nothing.** When the receipt
  turns up in a later run, the app may say it read a receipt. It may not say which
  purchase, because at that point it cannot know.
- **The line stays a friend, not a receipt printer.** Same one-face-emoji title,
  same nine words, same absence of digits and amounts. Only the sentence gets more
  specific.
- **Nothing about the item leaves the device sealed or unsealed.** The payload
  carries the same tiny enum it does today, widened by one coarse field. No item
  name, no amount, no node code.
- **Counting your past is phase 2.** "Third sports purchase this month" needs your
  ledger, which the server cannot read. It ships separately.

## 2. The two moments

| | Together | Late |
|---|---|---|
| When | Bank mail and receipt understood in the same pipeline run | Receipt arrives in a later run |
| Evidence | Exact paid total, card tail, same run | The receipt alone |
| Push | The ordinary capture push, with an item-aware line | A separate line with its own tag |
| May it name the purchase | Yes, by implication: it is that purchase's push | No |
| Replaces anything | No | No, it stands beside |

The boundary is **knowledge, not the clock**. If the pipeline understood both facts
at once, it may speak as one. If it did not, it may not pretend it did. A one-hour
cap sits on top of that as a sanity bound, so an unusually slow run cannot merge two
things the person experienced as unrelated.

**Never replace.** A later push does not rewrite an earlier one by reusing its tag.
Silently rewriting something a person may already have read is worse than a second
line, and the two lines are about different things anyway.

## 3. What the together line says

The basket earns the voice in one of two ways, checked in this order.

**By what it is.** Every item already carries a category node. When the basket
agrees, it names a coarse **item pool**: clothes, tech, kids, hobby, fitness,
beauty, pets, fresh food, medical, watching. Ten, and a pool never a leaf, because
a pool is the same class of claim the merchant pools in today's payload already
make.

The pools are named by the tree's own category codes rather than by keywords, so
the basket is read from where it is already filed. One of them names a depth-3
code deliberately: sport gear files under books-and-hobby in the tree, so
`fitness` claims `sportsgear` directly and a swim order reads as sport while a
book order still reads as hobby.

**By its shape.** When the basket does not agree on anything, its structure still
says something real and carries no content at all: one item swallowing the order,
a dozen items at once, a voucher covering much of it.

```
😌  Đồ bơi mới, hồ bơi đang chờ đó!
😋  Đồ bếp mới về, cuối tuần nấu gì đây!
😏  Sắm đồ tập rồi, giờ tới phần đi tập!
😳  Một món ăn hết cả giỏ hàng!
😆  Một lượt mua cả chục món luôn!
😏  Voucher gánh gần nửa đơn, khéo thật!
```

When neither fires, the existing line stands unchanged. That is the designed
default, not a failure: most purchases will never have a receipt.

## 4. What the late line says

```
😌  Vừa đọc xong một hoá đơn của bạn!
🙂  Đọc được hoá đơn rồi, biết bạn mua gì!
```

It names no merchant, no amount, and no transaction, because the server genuinely
does not know which purchase the receipt belongs to. Tapping opens the review
queue, where the device does the real join and the person sees the answer.

The late line fires at most once per run, only when the person already has rows
waiting, and never during a first read. **It also stays silent on any run that
already sent a transaction notification.** The pipeline's standing rule is one
push per mailbox per run, and a second buzz in the same minute would spend the
person's attention on the quieter of the two things that happened. On the run
where only a receipt arrived, which is the whole late case, there is nothing to
compete with.

## 5. Copy rules, unchanged

Everything the per-purchase voice already obeys: the title is exactly one face
emoji, the body is plain text ending in an exclamation mark, at most nine words, no
emoji inside the body, no digits, and never a word about the queue.

**Number words are allowed where digits are not.** "cả chục món" is a count a person
would say out loud; "12 món" is a bank alert. This matters more in phase 2, where
counts are the whole point.

**The face stays.** An item line pulls hard toward an object emoji, goggles or a
cup. The face is the app reacting to you, and trading it for the object turns a
friend into a receipt printer.

## 6. Scope

Personal ledger only. Receipts attach to private personal rows, and a purchase filed
to the family has no private row to annotate, so it can never be enriched. This is a
property of `receipt-enrichment-spec.md` §7, not a choice made here.

Grab is excluded by construction: its reader never emits items, because its mail
carries home addresses.

## 7. Before building: prove the premise

The whole together path assumes the bank alert and the receipt land in one run. The
evidence for that today is one screenshot, in which a Shopee order was stamped at
13:09:14 and its payment at 13:09:20. The database cannot corroborate it: there has
never been a receipt and bank-twin pair in it, and no Shopee row has ever been
staged, because the payment mail only became reachable on 2026-09-29.

**One real purchase on a connected mailbox settles it.** Record when each mail
arrives and whether one run saw both. If they routinely split across runs, the
together path is worth much less and the late line carries the feature alone.

This costs one order and one day, and everything in §4 can be built while waiting.

---

# Part 2 — Technical appendix

## 8. Why the pairing has to happen inside one run

Two facts from the pipeline decide the whole design.

**The worker forgets on purpose.** `readOne` seals each message as it reads it, and
the only thing that survives the message loop is the copy enum, which drops the
amount deliberately. There is no place today where two messages' plaintexts coexist.

**Across runs the server has almost no evidence.** A staged row's amount is sealed.
The one primitive that survives is the keyed dedup fingerprint over amount,
direction and currency. In the live corpus **28% of rows already share a fingerprint
with another row inside the matching window**, and the card tail that the device
uses as a veto is sealed away from the server. So a cross-run match would attach on
exactly the evidence the device already rejects as insufficient, and
`receipt-enrichment-spec.md` RC10 is explicit that mis-attachment is worse than no
attachment.

Inside one run it is the opposite. The worker holds both plaintexts, including the
paid total and the card tail, so it can apply the same veto the device applies. That
asymmetry is why the together line is allowed to speak and the late line is not.

## 9. The run-scoped pair map

A map beside `copyBest`, run-scoped rather than chunk-scoped, because a pair can
straddle the twenty-message fetch chunks.

```
key    exact paid amount + direction + currency
value  { rowKind, occurredAt, provider, cardTail, itemNodes, basketShape }
```

Both directions must be handled: Gmail lists newest first, so the receipt may be
read before or after its bank mail. A match requires the exact amount and, when both
sides carry one, an agreeing card tail. A disagreeing tail is a veto. Two candidates
is not a match.

The map holds plaintext derived values and dies with the run. It never becomes a
column, and the seal does not move.

**A run can end mid-window** on time budget, message caps or rate limits, so a pair
split by that boundary simply does not match. That is acceptable precisely because
the late line exists and claims nothing.

`receipt.paid` is the join key, confirmed in the reader: for the example order the
items total 841,700, the voucher is 160,000, and the figure the bank debits is
681,700. **Matching on the item sum would never match anything.**

## 10. The payload, widened by one field

`copyMeta` gains one optional field beside `{c, t, d, p}`:

```
ip   item pool   one of a closed list of about a dozen coarse pools
ib   basket      one of: solo (one item dominates), many, voucher
```

Both are validated against their own tables before they leave, the way `p` already
is, so a stale or unknown value can never name a pool that has no lines. Neither may
ever carry a node code, an item name, a count or an amount.

The lines themselves live in `taxonomy/notify-lines.json` and reach both runtimes
through `tools/gen-notify-lines.js`, which already exists. The new cells are subject
to the generator's existing validations: four variants per cell, both languages, no
digits, nine words, one emoji, ends in an exclamation mark.

## 11. The late push

A new kind, `receipt_read`, with its own tag so it never collapses into a capture
notification. Sent from the receipt branch of the worker, which today returns early
before any notification is considered.

Gates, all required: the person has pending rows, no first read is running, at most
one per run, and the receipt actually parsed into items. A receipt that yielded
nothing readable stays silent, because there is no story to tell.

## 12. Measurement, which does not exist yet

`receipt_unmatched_retired` is cited by `receipt-enrichment-spec.md` §16 as the
evidence for two deferred decisions. **It is not a tally key and never has been**,
and the retire path erases the difference between a receipt that joined, a duplicate
that collapsed, and one that expired unmatched. Of 66 receipts staged, 20 attached
and roughly 44 vanished with no record of why.

This spec adds the counters it needs and the one that was missing:

| Key | Meaning |
|---|---|
| `receipt_paired_inrun` | a receipt and its bank twin met in one run |
| `receipt_late` | a receipt staged with no twin in this run |
| `receipt_unmatched_retired` | the device gave up after the grace window |
| `notify_receipt_read` | a late notice went out |

## 13. Phase 2 — the history line

Counts and firsts from the person's own past: another sports purchase, the third
this month, or the first in a year. The server cannot compute these, because the
ledger is sealed to it.

The shape follows the streak digest exactly. The app, while open, writes a small
pre-decrypted snapshot; the service worker composes from it and refuses a snapshot
older than a day, falling back to the server-chosen line rather than guessing.

Three constraints carry over from the audit, and the middle one is a live bug:

- The worker has no Supabase client and no session, because the auth token lives in
  `localStorage`, which does not exist in a worker. It can only read what the page
  left for it.
- **`fh-streaks` survives sign-out today** with plaintext streak labels in it,
  because the wipe list was never updated when it shipped. This spec fixes that one
  in the same change as it adds its own.
- The new snapshot is wiped on sign-out **and on Key Card regeneration**, since a new
  card re-encrypts every row while a stale snapshot keeps describing them in the
  clear.

The snapshot holds aggregates, not merchant text: node, count, and a last-seen date.

## 14. Failure modes

| Case | Behaviour |
|---|---|
| Receipt unreadable or itemless | No pool, no shape, no late push. The ordinary line stands |
| Basket disagrees | Falls to shape; if shape says nothing, the ordinary line stands |
| Two pair candidates in one run | No pair. Both stay ordinary, the receipt goes late |
| Card tails disagree | Veto. Never a pair |
| Run ends between the two mails | No pair. The late line covers it |
| Grab | Never has items; nothing changes for it |
| Person has no pending rows | The late push is suppressed |
| Generated tables missing a new pool | Validation fails the build, as it does for every other cell |

## 15. Acceptance

- A Shopee order with an agreeing basket produces exactly one push, and its line
  names the basket's pool.
- That push carries no item name, no amount, no node code and no count.
- A receipt arriving in a later run produces a line that names no purchase.
- No purchase ever produces two pushes claiming to be about the same thing.
- A run that ends between the two mails degrades to the ordinary line with no error.
- Every new line passes the existing generator validations unchanged.

## 16. Decision log

| # | Decision |
|---|---|
| I1 | The job is both: a better capture notice when the knowledge is timely, and proof the app read a receipt when it is not. |
| I2 | The boundary is knowledge, not the clock. One run means one push; a later run means a separate line. A one-hour cap bounds a slow run. |
| I3 | The late push stands beside the earlier one and never replaces it by tag. |
| I4 | The late push may not claim which purchase it belongs to. The server has amount alone, and 28% of rows share an amount inside the window. |
| I5 | The payload gains one coarse enum field, never a name, a code, a count or an amount. |
| I6 | The title stays exactly one face emoji. The specificity belongs in the sentence. |
| I7 | Digits stay out; number words are allowed. |
| I8 | Personal only, forced by where receipts can attach. |
| I9 | The history layer is phase 2, since the item line delivers the delight and needs no new capability. |
| I10 | The snapshot holds aggregates, not merchant text, and is wiped on sign-out and on card change. The existing streak snapshot's missing wipe is fixed in the same change. |
| I11 | Build despite today's 2.5% receipt coverage: Shopee e-receipt mail was only enabled days ago, so the figure measures the switch, not the world. |
| I12 | Cross-run fingerprint matching is rejected. It attaches on evidence the device already rejects. |
| I13 | Prove the same-run premise with one real purchase before building the pairing. §4 can be built while waiting. |

## 17. Related

- `docs/specs/receipt-enrichment-spec.md` — items, the branch rule, the grace window
- `docs/specs/effortless-transaction-logging-spec.md` — the pipeline and the seal
- `docs/features/web-push.md` — the payload contract
- `docs/specs/habit-streak-spec.md` — the on-device composition phase 2 copies
- `docs/specs/notification-activation-spec.md` — who is subscribed to hear any of this
- `research/notify-items-copy.html` — the eight proposals this one came from
