# Duplicate flagging in the email review queue: 20 flaws, 80 options, one plan

Status: design review, 2026-09-16. Not a spec yet; nothing here is built.
Companion to `effortless-transaction-logging-spec.md` §7, §18, §19 and
`transaction-review-spec.md` §F. Code under review:
`src/js-ui/57-csv-import-review.js` (`bucketCsvCandidates`, the seven client
tiers), `src/js-ui/56-csv-import-ui.js` (chips, `csvDupWhy`, tick policy),
`src/js-data/72-txn-review.js` (row meta, retirement), `src/js-data/76-quick-review.js`,
`supabase/functions/_shared/mailbox/dedup.mjs` + `db.mjs` (server flag),
`pipeline/bank-email-pipeline.gs` (forwarding twin).

## Constraints every option is judged against

| Constraint | What it means for dedup |
|---|---|
| Privacy promise | The database never learns an amount, merchant, or reference. Any new clear column must be workflow metadata or a keyed fingerprint that leaks equality classes only. Nothing new leaves the device or the Edge worker. |
| Scalable, reusable | One engine serves the email queue, CSV import, quick review and the hand-typed bulk sheet. No per-bank special cases in the client. |
| Performance | Client work is O(n) over a 1000-row page with amount-bucketed maps. Server work is one indexed query per staged row, at insert time only. |
| No LLM spend | Zero new model calls. Every option that asks a model is listed and rejected. |
| Accuracy | A false flag must cost nothing (the row stays ticked). A missed duplicate must be rarer than today. |

## The policy lever behind most false positives

Today every flag, however weak, unticks the row (`csvReview.dup` → `_skipImport = true`,
56-csv-import-ui.js ~line 591). That makes every false positive cost a tap and a
doubt. The single most valuable change is a **three-tier verdict with a tick policy**:

| Tier | Meaning | Chip | Ticked by default |
|---|---|---|---|
| sure | a fact: same message id, same keyed reference, same instant + same reference | đã nhập trước đó / trùng email | no |
| likely | strong evidence: exact amount + merchant + ≤1 day, cross-source pair, family twin | có thể trùng | no |
| weak | a guess: amount-only ledger match, near-miss, habitual amount | gần trùng | **yes** |

Most options below say "weak tier" as shorthand for "flag, chip, keep ticked".

---

# Part A: false positives

## FP1. Ledger match is merchant-blind (amount within 1đ, ±3 days, any merchant)

**A. Require a merchant/description signal.** Exact amount + merchant key match (the
near-miss `_csvNameKey` rule) = likely; exact amount with no merchant agreement = weak.
Pros: local, tiny change, reuses existing helper. Cons: hand-logged notes rarely
contain the bank's merchant string ("ăn trưa" vs "HIGHLANDS"), so many true matches
drop to weak.

**B. Amount-frequency dampening.** Count how often this exact amount appears in the
family's last 90 days; ≥3 occurrences marks it habitual and any amount-only match
becomes weak (or a ±1-day window instead of ±3). Pros: data-driven, cheap (one map
built with the ledger index), catches 50.000đ coffee and round transfers precisely.
Cons: a heuristic; a family that pays the same rent twice in a week is misjudged
(rare).

**C. Provenance-aware matching.** Ledger rows carry `source` and, for email imports,
the tombstone message id. Email-vs-email exact matches are decided by message id
(sure or nothing); only manual/CSV rows fall to amount matching. Pros: turns part of
the guess into a fact using data already stored. Cons: does nothing for the manual
rows that cause most of the noise.

**D. Evidence scoring engine.** Replace first-match-wins with additive evidence per
candidate: amount exact, day distance, merchant agreement, kind agreement, instrument
agreement, same member, source, time proximity; thresholds map to sure/likely/weak.
Pros: one reusable engine for every surface, fixes the "five reasons in one chip"
problem, tunable without restructuring. Cons: the largest change; needs a fixture set
to tune thresholds.

**Recommendation: D as the framework, with B as one of its scorers and C's message-id
fact as the sure tier.** Amount-only matches become weak and stay ticked.

## FP2. Matches against other members' spending

**A. Same-member only.** Match a candidate only against rows logged by the same member
or as Shared. Pros: simple. Cons: a spouse who logs the other's purchase (common) is
no longer caught; families that log everything as Shared lose nothing but gain nothing.

**B. Instrument-aware.** Family rows carry `instrument` since 0131 and personal rows an
account; when both sides know the instrument, require agreement. Pros: precise, uses
the account-setup data. Cons: manual rows often have no instrument, so it rarely fires.

**C. Member as a score term.** Same member +, Shared 0, different member −; combined
with merchant agreement a different-member row can still reach likely. Pros: fits D,
no coverage loss. Cons: none material.

**D. Book-scoped.** Personal-destined candidates match only the personal book plus
family rows authored by me. Pros: intuitive. Cons: the destination is editable until
Import, and a family-destined row must still see the spouse's manual entry.

**Recommendation: C, with B applied when both instruments are known.**

## FP3. Date-only banks collapse to midnight; the silent merge and the server's same-instant rule trust it

**A. `time_precision` clear column** (`'second' | 'minute' | 'day'`) set by both
extraction writers from the date transform kind. Merge and the server's same-instant
exception require `'second'` (or `'minute'`). Privacy: reveals only that a bank prints
no clock, a property of the template, not of the transaction. Pros: exact; also fixes
FP4. Cons: migration + `templates.mjs` + `.gs` paste + `stage.mjs`.

**B. Client-only midnight guard.** Treat 00:00:00 UTC-day as "no time" in the merge,
as `fhStagedRowTime` already does. Pros: ships today with no deploy. Cons: the server
still flags; a genuine midnight transaction is misread (rare).

**C. Reference in the merge key.** Key on instant + amount + `reference_number` when
present; without a reference, demote to likely instead of merging. Pros: two copies of
one mail share the reference, two purchases never do. Cons: some shapes carry no
reference.

**D. Drop the silent merge; show a sure chip instead.** Pros: nothing is ever hidden.
Cons: brings back a card per two-transport copy, which the merge was built to remove.

**Recommendation: A + C. Ship B immediately as the interim client fix.**

## FP4. Date-only banks defeat the minute guard in the in-batch key

**A. Reference equality when time is missing.** Without a time, the in-batch key
requires the same `reference_number`; no reference means no in-batch flag. Pros: a
bank reference is unique per transaction, so this converts a guess into a fact. Cons:
shapes without a reference lose in-batch detection (they keep the ledger and
cross-source tiers).

**B. Weak tier when time is missing.** Keep the key, downgrade the verdict. Pros:
trivial. Cons: still a chip on the 44-topup case.

**C. Balance-after as a discriminator.** VCB-style mails print the balance after the
transaction; two different transactions almost never leave the same balance. Pros:
strong signal, already inside the sealed box. Cons: not every shape prints it.

**D. Teach the label table to find a time.** Pros: fixes the root. Cons: many
date-only mails simply have no clock; cannot be relied on.

**Recommendation: A, with C as a second discriminator; B as the fallback verdict.**

## FP5. Kind-blind ledger match (repayments, transfers, loans hunt expenses; family rows all read as expense)

**A. Carry kind on both indexes.** Personal rows already have `kind`; family rows get
it from the hydrate (0076 spine kinds) and the ledger index stops labelling everything
`expense`. Pros: correct data. Cons: touches the hydrate shape.

**B. Hard kind gate.** A candidate only matches rows of its own kind (repay↔cardpay,
xfer↔xfer, loan↔loan, expense↔expense, income↔income). Pros: eliminates the whole
class. Cons: requires A.

**C. Skip ledger matching for non-expense/income kinds.** Pros: one line. Cons: a
re-staged repayment already imported goes unflagged (FN6 territory).

**D. Kind as a score term.** Pros: fits D. Cons: a kind mismatch is not a weak signal,
it is disqualifying; scoring it invites tuning errors.

**Recommendation: A + B, and widen the personal slice to fetch all kinds (see FN6).**

## FP6. Planned and future family rows count as existing

**A. Filter `future`/planned rows out of the ledger index.** One condition. Pros:
correct, free. Cons: none.

**B. Turn it into a feature.** A bank row matching a planned row proposes "khớp với
khoản đã lên kế hoạch" and converts the plan on import instead of flagging. Pros: real
product value. Cons: new UI, new write path.

**C. Weak tier.** Cons: still noise for something that is never a duplicate.

**D. Leave as is.** Rejected.

**Recommendation: A now, B as a follow-up once the engine exists.**

## FP7. Two banks stay flagged (server has no bank clause; client overrules only when both types are known)

**A. `sender_kind` clear column** (`'bank' | 'wallet'`) written from the sender
registry the worker already resolves (`senders.match`, `stage.mjs` gets `senderKind`).
The server rule gains "not both banks"; the client reads it instead of guessing from a
sealed `transaction_type`. Privacy: the domain registry already determines
`source_provider`, which is clear; kind adds nothing new. Pros: exact on both sides,
one indexed column, no page-size dependency. Cons: migration + worker + `.gs`.

**B. Ship a small provider→kind map in the client.** Pros: no migration. Cons: two
lists to keep in sync, and the server still writes the wrong flag.

**C. Drop the server flag entirely; client only.** Pros: one implementation. Cons:
loses the flag that suppresses a duplicate from voicing the push notification, and the
cross-page detection.

**D. Extend the type→kind map** so `bill_payment` from a bank sender counts as bank.
Pros: small. Cons: still blind when the type is missing.

**Recommendation: A.**

## FP8. A pipeline flag outlives its partner

**A. `ON DELETE SET NULL` on the existing FK.** `duplicate_of_id` is declared as a
foreign key in 0025 with no delete rule; alter it to `SET NULL`. Pros: zero code, the
database keeps it true forever. Cons: one migration.

**B. Null the pointer inside `resolve_email_transactions`.** Pros: explicit. Cons:
duplicates what A does declaratively.

**C. Client ignores a flag whose partner is not in the fetch.** Cons: page-size false
negatives; the row also loses the flag during the window between promote and delete.

**D. Client re-derives from tombstones and the ledger.** Cons: more work for the same
truth A gives for free.

**Recommendation: A.**

## FP9. Near-miss contains-matching on aggregator merchants

**A. Order/reference digits as identity.** When both memos carry an order id or
reference, different ids mean different purchases and the near-miss is skipped. Pros:
exact for Shopee, Grab, Lazada, whose memos carry ids. Cons: needs the digits to be
parsed; not all memos have them.

**B. Hub list.** Skip near-miss for a short list of aggregator names, or require a key
length ≥ 6. Pros: trivial. Cons: brittle, another list to maintain.

**C. Tighten the gate** (same instrument, same hour). Cons: still fires on two orders
in one evening.

**D. Weak tier only.** Near-miss never unticks. Pros: the false positive costs nothing.
Cons: does not reduce the chip count.

**Recommendation: D as policy plus A as the discriminator.**

## FP10. One person with two logins in one family is flagged on every family-scoped mail

**A. Ask once at connect.** When another grant already reads this address inside the
same family, the connect sheet asks "Hộp thư này là của bạn (tài khoản thứ hai) hay
của người khác?" and stores `same_reader_as` on the grant. Same person: family-scoped
staging is skipped for the second grant (personal only), so no twin exists. Pros:
resolves the ambiguity with the only source that knows. Cons: one more question, one
column.

**B. Refuse a second reader inside the same family.** Pros: no ambiguity. Cons: blocks
the shared-household-inbox case 0138 was built for.

**C. Keep the flag, change the copy** to "tài khoản khác của bạn?". Cons: the
double-booking risk stays and the person answers the same question per row.

**D. First reader wins family scope automatically.** Cons: silently changes what the
second person sees, with no way to tell them why.

**Recommendation: A.**

---

# Part B: false negatives

## FN1. Two emails from the same bank for one transaction (notice + receipt, authorization + settlement)

**A. Keyed reference fingerprint.** `ref_fp = HMAC(DEDUP_FP_KEY, 'v1|provider|reference')`
as a clear column; the server flags same-owner rows with an equal `ref_fp` within 30
days as sure, regardless of provider or timestamp. Privacy: leaks equality classes of
references, which are high-entropy, so strictly less than `dedup_fp` already leaks.
Pros: exact, one indexed query at insert, covers the "biến động số dư" + "biên lai"
pair. Cons: authorization vs settlement often carry different references; both
writers + migration.

**B. Client same-provider rule with a different-shape guard.** Same provider, equal
amount, within 10 minutes, and a different subject shape (or different
`transaction_type`) = likely. Two real topups produce the same shape and stay apart.
Pros: catches what A cannot; no deploy. Cons: needs the subject shape on the client
(it is a template key with no values; can travel inside the box).

**C. Learned notification pairs per bank.** When `ref_fp` matches across two shapes of
one sender, record `pairs_with` on `sender_fingerprints`; later pairs merge as sure
even without a reference. Pros: scales with real mail. Cons: complex; second phase.

**D. Ask the model whether two mails describe one transaction.** Rejected: sends
amounts and names to the model per pair and spends quota.

**Recommendation: A + B; C later.**

## FN2. Quick review runs no client dedup

**A. Reuse the engine.** Extract `fhDupAssess(candidate, ctx)` from the bucketing pass
and run it per quick card; any verdict above none drops the row out of the quick path
into the full queue. Pros: one implementation, same behaviour everywhere. Cons: quick
review must load the ledger index (already cached for the full screen).

**B. Cheap pre-filter.** Show only rows whose amount does not appear in the recent
personal slice within 3 days and that have no same-amount row in the queue. Pros:
light. Cons: a second, weaker rule set to keep in sync.

**C. Restrict quick review to template-parsed rows with a time.** Cons: does not
address duplicates at all, just narrows exposure.

**D. Remove quick review.** Rejected; it is the zero-typing path.

**Recommendation: A.**

## FN3. Foreign-currency pairs never match

**A. VND-equivalent comparison with a fee band.** When currencies differ, convert the
foreign side with the FX table and accept a match within the issuer fee band (0–5%),
plus merchant or same-day agreement; verdict likely. Pros: uses what the FX feature
already ships. Cons: a wide band; needs the merchant term to stay accurate.

**B. Second server fingerprint on the bank-printed converted VND** (`converted` field
from the label table). Pros: exact when the bank prints it. Cons: only some banks do;
another column.

**C. Match on reference or card tail + day instead of amount.** Cons: the wallet
receipt and the bank debit rarely share either.

**D. Merchant + same day only.** Cons: too loose alone.

**Recommendation: A, with D's merchant term as a required signal.**

## FN4. Rows that exit early are never cross-source priors

**A. Two-pass bucketing.** Pass 1 builds indexes (by amount bucket, by instant, by
identity) over every candidate and computes evidence per row; pass 2 assigns buckets
and verdicts. Every row is visible to every rule regardless of its own fate. Pros:
structural fix and the foundation for the scoring engine; O(n). Cons: a refactor of
`bucketCsvCandidates`.

**B. Push to `priors` before each early return.** Pros: five-line patch. Cons: fragile,
and rows merged away still vanish from the comparison.

**C. Pairwise cross-source over the whole list up front.** Pros: complete. Cons: needs
the same indexes as A to stay O(n); half of A without the benefit.

**D. Server-only cross-source.** Rejected: the server cannot read kinds.

**Recommendation: A.**

## FN5. Amount drift beyond 1đ; near-miss too narrow

**A. Tolerance bands by pair type.** Wallet-vs-bank: +fee up to 1.5% or 5.000đ.
Manual-vs-bank: rounding to the nearest 1.000/10.000đ or 2% relative. Both weak.
Pros: models the real causes of drift. Cons: more weak chips; must stay ticked.

**B. Relax the merchant requirement when time is tight** (same hour, any merchant).
Pros: catches "ăn trưa" vs "HIGHLANDS". Cons: same-hour same-amount coincidences.

**C. Learn from decisions.** Record local "Vẫn nhập"/skip answers keyed by pair shape
to raise or lower future verdicts. Pros: adapts per family. Cons: sparse data, slow.

**D. Reference digits.** Only helps email-vs-email.

**Recommendation: A + B as scorers in the engine, always weak.**

## FN6. The ledger index is incomplete (personal slice kinds, cache fallback, windowed family)

**A. Fetch what the check needs.** Personal slice fetches all kinds with `kind`;
family index fetches a date-bounded slice for the dedup horizon when the hydrate is
windowed. Pros: correct. Cons: one more query per review open, bounded by the
backfill horizon.

**B. Rely on tombstones for email-sourced rows.** Already true; covers only email.

**C. Local imported-amounts index.** At promote time write (amount, date, kind, book)
to IndexedDB; the engine consults it first. Pros: fast, exact for this device, survives
any cache window. Cons: per-device; another store to prune.

**D. Server-side blind index on ledger rows.** Rejected: leaks equality classes over
the whole ledger, which the privacy promise does not allow.

**Recommendation: A + C.**

## FN7. Personal-only users get no server flag

**A. Owner scoping.** `stagedCandidates` and `findDuplicate` fall back to
`owner_user_id` when `member_id` is null. Pros: three lines, indexed. Cons: none.

**B. Skip server dedup for them.** Status quo. Rejected.

**C. Client-only.** Loses the notification-voice suppression.

**D. Give personal-only users a member row.** Far larger change for no gain here.

**Recommendation: A.**

## FN8. Transfers between family members

**A. Flipped-fingerprint lookup at insert.** The worker holds plaintext at insert, so
it computes `HMAC(amount|opposite direction|currency)` and queries the family's other
members' rows within ±1 day; a hit sets `transfer_pair_id` (a flag, never an action).
Each side's review then proposes "chuyển khoản trong nhà?" with kind xfer. Privacy: the
server learns only that two family rows share an amount in opposite directions, the
same class of leak `dedup_fp` already accepts. Pros: no RLS change, no plaintext, one
query. Cons: migration + worker; both sides must import for the pair to book cleanly.

**B. Post-import ledger pairing.** After both legs are in the family ledger, propose
merging them into a transfer. Pros: no pipeline change. Cons: only for family-scoped
imports; the double-count lives until both are in.

**C. Widen RLS so family members can read each other's family-scoped pending rows.**
Pros: the client could pair with full evidence. Cons: breaks "even the fact of a
pending transaction is theirs"; rejected.

**D. Defer.** The architecture doc already records this as debt.

**Recommendation: A, then B for rows that were imported before A ships.**

## FN9. The forwarding script is the weaker twin

**A. Port the same-instant exception, owner scoping and any new columns to `.gs`.**
Pros: parity today. Cons: a hand paste per change, forever; the parity risk this doc
keeps finding.

**B. Route forwarding through `/mailbox-sync/ingest`.** The Apps Script routes,
classifies and extracts as today but posts a reading to `/ingest` instead of sealing
and inserting itself. One seal, one `DEDUP_FP_KEY`, one dedup, and every future fix
reaches forwarding for free. Holds are safe: the mail stays in the shared inbox and
the script retries next minute. Pros: kills a whole class of divergence. Cons: the
script needs the sync secret; the ingest contract must accept its extraction shape
(`normaliseReading` already exists for transport C).

**C. Rely on the client merge.** Cons: only same-second copies.

**D. Deprecate forwarding.** Cons: the only path for non-Gmail mailboxes.

**Recommendation: B, with A as the stopgap paste until B lands.**

## FN10. Income pairs and identity-less rows skip most tiers

**A. Run cross-source for credits, credit-vs-credit only.** Pros: symmetric with the
debit rule. Cons: salary plus refund coincidences; keep likely, not sure.

**B. Identity fallback chain.** description → counterparty → reference → account
tail + instant. Pros: no row is ever unkeyed. Cons: the tail + instant key is weak;
verdict weak.

**C. Include income in near-miss.** Cons: income is rarely rounded by hand.

**D. Skip.** Rejected.

**Recommendation: A + B.**

---

# The plan these add up to

**One engine, three tiers, tick policy.** A shared `dedup-engine` (js-ui, global) with
two-pass evidence scoring over indexed candidates and the ledger index, returning
`{tier, reasons[], evidence}` per row. Every surface (email queue, CSV import, quick
review, bulk sheet) calls it; chips and `csvDupWhy` render from `reasons`. Weak stays
ticked.

**Server flags stay cheap and blind.** New clear columns are all metadata or keyed
fingerprints: `time_precision`, `sender_kind`, `ref_fp`, `transfer_pair_id`;
`duplicate_of_id` gets `ON DELETE SET NULL`; owner scoping for personal-only users.
No plaintext, no model calls, one indexed query per staged row.

**Phases**

| Phase | Deploy surface | Items |
|---|---|---|
| 1. Client only, no migration | app build + sw bump | FP1 policy (weak stays ticked), FP3-B midnight guard, FP5, FP6, FP9-D, FN2, FN4, FN5, FN6, FN10 |
| 2. Migration 0139+ and `mailbox-sync` | DB + Edge + `.gs` paste | FP3-A `time_precision`, FP4, FP7 `sender_kind`, FP8 FK rule, FN1-A `ref_fp`, FN7 owner scope |
| 3. Structural | Edge + Apps Script + connect UI | FP10 connect question, FN1-C learned pairs, FN3 FX pairing, FN8 flipped fingerprint, FN9 forwarding via `/ingest` |

Phase 1 removes most of the visible noise and closes the quick-review hole with no
shared-singleton risk. Phase 2 needs the AGENT_SYNC migration claim and a coordinated
worker deploy (the backfill-cursor patch must be rebased first). Phase 3 is where the
remaining structural gaps close, one at a time.

**Test fixtures to build before tuning:** date-only VCB pair, same-day topup pair,
MB debit + MoMo receipt, Shopee 45.000/45.500, hand-rounded 467.000/467.290, USD
receipt + VND debit, planned rent + bank rent, spouse-logged dinner, two-login family
twin, notice + receipt same bank.

---

# Part C: the architecture, the flow, and the implementation

Verified against the live database on 2026-09-16: 111 pending rows, 0 flagged,
0 re-staged, 0 with a null member, 0 at midnight. The FK
`email_transactions_duplicate_of_id_fkey` has delete rule NO ACTION. Indexes on
`email_transactions`: `dedup_fp` (partial), `gmail_message_id`, `member_id`
(pending), `occurred_at`, `owner_user_id + review_status`, the owner+message
unique key, and `pending_review (occurred_at) where duplicate_of_id is null`.

## C1. How it is built today

```
insert time (Edge worker / Apps Script, plaintext in hand)
  dedup_fp = HMAC(amount|direction|currency)         clear column
  findDuplicate: familyMessageTwin → stagedCandidates → provider loop
  duplicate_of_id = earliest unflagged match           clear pointer, one row
  resolved_before = tombstone older than connected_at  clear boolean (backfill only)

open time (client, ciphertext opened locally)
  fetch ≤1000 pending rows + tombstone flags
  build ledger index from window.txns + personal slice
  bucketCsvCandidates: merge → resolved_before → deferred → in-batch → ledger
                       → near-miss → pipeline flag → cross-source
  flags collapse to one of three chips; any flag unticks the row

decision time
  tick / untick / ✕ → local retired set → resolve_email_transactions → tombstone + DELETE
  the pair itself is never recorded anywhere
```

## C2. Issues that hurt accuracy

1. **Three implementations of one rule, kept equal by convention.** `dedup.mjs`,
   `bank-email-pipeline.gs` and `csvStagedCrossSourceDup` each restate the rule; the
   `.gs` copy already lacks the same-instant exception, the family twin and owner
   scoping, and `canonicalProvider` differs on đ. Parity tests pin the fingerprint
   format, nothing pins the loop.
2. **Detection is split by time, not by evidence.** The server decides once, at insert,
   with metadata only; the client decides every open with everything. The server's
   verdict is persisted and the client's is not, so the weaker verdict is the durable
   one and the stronger one is recomputed from scratch each time.
3. **First-match-wins with side effects.** `bucketCsvCandidates` mixes detection, tick
   policy and bucket assignment in one 200-line loop; `return` inside a branch decides
   both the verdict and whether the row is visible to later rules (`priors`). It cannot
   be unit-tested per rule, and quick review could not reuse it, so it bypassed it.
4. **A pointer is the wrong shape for a verdict.** `duplicate_of_id` names exactly one
   partner, always the earliest unflagged root; a third copy points at the same root,
   and the root itself is never flagged. The client only sees the flag on the later
   row; the root sits ticked in ready.
5. **Decisions are thrown away.** "Vẫn nhập" and "Bỏ qua" live in `csvReview.dup[].resolved`
   for the life of one sheet. Re-opening re-asks. Nothing records that two sources
   described one purchase, so a later CSV or manual entry cannot be matched to the
   merged event (the spec's open question about auth-vs-settlement dedup is this gap).
6. **Idempotency, certainty and suspicion are three mechanisms.** Tombstones answer
   "finished?", `resolved_before` answers "finished in a past life?", `duplicate_of_id`
   answers "same purchase?". Three tables/columns, three code paths, three flags on
   the client that collapse into one chip and one sentence.
7. **`occurred_at` carries no precision.** A midnight value means "no clock" for
   date-only banks and "00:00:00" for everyone else; every rule that trusts the instant
   (merge, server same-instant, in-batch minute) is blind to the difference.
8. **The ledger index is a UI array.** `window.txns` is built for rendering: no kind,
   planned rows included, dates as local-midnight, possibly windowed; the personal
   slice fetches two kinds. The dedup engine inherits every one of those choices.
9. **Unit and time-zone conversions sit inside the matcher.** `amtD = amt × curMult()`
   is a third conversion site next to `parseAmtBase` and `csvBaseAmt`; the ±3-day
   window is measured from a candidate's timestamp to a ledger row's local midnight,
   so it is asymmetric by up to a day.

## C3. Issues that hurt scalability and performance

1. **Retiring a flagged pair can fail outright (latent defect).** The FK on
   `duplicate_of_id` is NO ACTION. `resolve_email_transactions` deletes the rows in
   `p_ids`; if a still-pending row points at one of them, Postgres raises 23503, the
   whole plpgsql call rolls back including the tombstone insert, and the client shows
   "Đã lưu, nhưng chưa xoá được bản nháp". The local retired set hides the row on this
   device only; every other device and the badge count keep it. It has not fired yet
   only because no pending row is flagged today. Fix: `ON DELETE SET NULL` (also FP8).
2. **N+1 server calls per staged row.** `findDuplicate` costs one REST call
   (`stagedCandidates`) plus, for family rows, two more (`members` list, twin lookup)
   per message. A 400-row backfill chunk spends up to 1,200 HTTP round trips on
   dedup alone, uncached, inside the same run that is racing Gmail's rate limit.
   Fix: warm the family member list once per run; batch candidate lookups per chunk
   the way `warmFingerprints` already batches template lookups.
3. **The candidate index does not match the query.** `stagedCandidates` filters on
   `member_id + dedup_fp + occurred_at`; the only fingerprint index is `(dedup_fp)`
   alone. Selective enough today; a composite `(member_id, dedup_fp, occurred_at)`
   partial index is the correct shape once volume grows.
4. **Client matching is O(n × m).** `existingTxns.find` runs per candidate over the
   whole ledger index; near-miss does the same. At 1,000 candidates × a few thousand
   ledger rows that is millions of comparisons per open on a phone. Fix: bucket the
   ledger index by amount (and by day) once; every rule becomes a map lookup.
5. **The personal slice is decrypted on every open.** 365 days of personal rows are
   fetched and opened to build the match index, then discarded with the sheet.
   Fix: cache the decrypted slice for the session, invalidated by the write path.
6. **Quick review is a second, weaker pipeline.** It re-implements fetch, open and
   retire, and skips detection. Every fix to the engine has to be ported by hand or
   is silently missing there.
7. **The forwarding transport cannot receive fixes without a paste.** Every dedup
   improvement is a manual Apps Script deploy with no CI, and the run log's version
   line is the only proof it took. Routing forwarding through `/ingest` retires the
   whole class.

## C4. Issues that touch the privacy promise

1. **`dedup_fp` is only as private as one key held in two companies.** Amounts are
   low-entropy, so the HMAC key is the entire protection for the equality classes
   stored in the clear. The key lives in Apps Script Properties and Edge secrets;
   either leaking, or the `.gs` self-minting a second one, is silent. Rotation is not
   designed: rotating the key orphans every stored fingerprint. Worth recording a
   rotation procedure (recompute is impossible on sealed rows; accept a dedup gap for
   the ±3-day window).
2. **Clear metadata already tells a story.** `occurred_at`, `source_provider`,
   `dedup_fp` equality and `duplicate_of_id` together reveal "two rows from MB and
   MoMo with the same amount on Tuesday". Accepted in §24 of the umbrella spec; every
   new clear column in this review (`time_precision`, `sender_kind`, `ref_fp`,
   `transfer_pair_id`) must be added to that recorded trade, not slipped in.
3. **The family twin crosses members by design.** A flag on member B's row reveals
   that member A also holds this message. Within a family-scoped row that is
   acceptable (the family key can open it anyway), but the check must never extend to
   personal-scoped rows, which `findDuplicate` currently guards with one `if`.
4. **`familyMessageTwin` lists every member of the family**, archived ones included,
   and matches their rows. An archived member's pending rows should not be evidence
   against a current member's.
5. **The client's dedup state is plaintext in memory and in localStorage.** The
   retired set holds ids only (fine). Any future "remembered decision" store (FN5-C,
   C2-5) must be encrypted like learned category corrections are, or hold ids only.
6. **Cross-queue pairing must stay blind.** The right shape for FN8 is a flipped
   fingerprint computed at insert, when the worker holds the plaintext anyway. Widening
   RLS so members can read each other's pending rows would break "even the fact of a
   pending transaction is theirs" and is rejected.

## C5. Target architecture in one paragraph

Two layers with a clean contract. **Server: blind hints.** At insert, with plaintext
in hand once, write keyed fingerprints and metadata only (`dedup_fp`, `ref_fp`,
`time_precision`, `sender_kind`), run one batched, indexed candidate query per chunk,
and record hints as nullable pointers with `ON DELETE SET NULL`. Never a verdict,
never an action. **Client: one engine, full evidence.** A pure function
`dedupAssess(candidates, ledgerIndex, hints) → verdicts` in its own js-ui file, two
passes over amount-bucketed indexes, additive evidence, three tiers, decisions
returned as data. The review screen, CSV import, quick review and the bulk sheet call
it and render from its `reasons`. Tick policy lives in one place: weak stays ticked.
Decisions that matter (a confirmed cross-source pair) are written to the ledger row's
provenance on import, so the same purchase arriving a third time matches a fact, not
a guess.

---

# Part D: measured on one real account (2026-09-16)

Method: the owner exported their opened review queue and both ledgers from the app
(keys never left the device), and the current client logic was replayed in Node
against them. Every flag was then labelled by hand from the paired evidence.
Row-level detail lives outside the repo. Aggregates only here.

**The data.** 105 pending rows (all personal scope, three providers), a family ledger
of 202 rows (157 hand-typed or statement-imported, 45 from email, 3 members) and a
personal book of 771 rows (700 email imports plus 72 mirrors of family rows, no
hand-typed rows). All pending rows carry a time; none are date-only.

**What the queue actually was.** 78 of the 105 rows were purchases already booked in
the family ledger, either imported from email in a previous connection (45, with no
tombstone under this owner, so no "đã nhập trước đó" badge) or typed or
statement-imported by hand (the rest). Only 23 rows were genuinely new.

**Current logic, against hand labels** (2 ambiguous rows excluded):

| | flagged | not flagged |
|---|---|---|
| really a duplicate | 76 | 2 |
| really new | 10 | 15 |

Precision 88%, recall 97%. Every flag showed the same "lặp lại" chip and unticked the
row, so the 10 false flags cost a tap and a doubt each, and the 76 true ones gave no
more confidence than the false ones.

**The 10 false flags, by cause.** 5 were another member's hand-typed row of the same
amount within 3 days (FP2). 4 were the owner's own hand-typed row of the same round
amount on a different day (FP1). 1 was a self-transfer between the owner's own
accounts matched to a shared rent entry (FP5). Four further flags had the right verdict
but named the wrong ledger row as evidence, because the first amount match wins.

**The 2 misses.** A card-side posting notice 3.5 days after the account-side notice of
the same purchase (FN1, plus the 3-day window). A refund that the earlier import had
filed as an expense, so the income candidate hunted income rows only (kind gate cuts
both ways).

**Not present in this account:** date-only midnight rows (FP3, FP4), pipeline flags
(the server flagged nothing; all 6 same-fingerprint pairs were same-bank), multi-reader
twins (FP10), foreign currency (FN3), personal-only scoping (FN7).

**The proposed engine on the same rows.** Rules: kind gate; same calendar day; exact
amount plus merchant-token overlap or same minute is *sure*; rounded amount under
1.000đ plus merchant overlap is *sure*; exact amount, same day, no text agreement is
*likely* when the ledger row is the owner's, *weak* when another member's; exact amount
within 3.5 days for a card posting against an earlier email row is *likely*; family
mirrors collapsed out of the personal index; one ledger row claimable once.

| tier | rows | really duplicate | really new |
|---|---|---|---|
| sure | 70 | 70 | 0 |
| likely | 7 | 6 | 1 |
| weak | 1 | 0 | 1 |
| none | 27 | 2 | 25 |

So on this account a fact-grade verdict is reachable for 70 of 78 true duplicates with
zero false certainties, 7 rows still need a person, and 2 remain missed (one needs
in-queue pairing of the two notices of one purchase, one needs a kind-conflict rule).
The single biggest remaining lever is the certainty tier: 45 of the 70 would have been
message-id facts had tombstones been written by the earlier connection's imports.
Why they were not is an open question for the promote path of that period.

**Two data findings outside dedup.** Family rows imported from email in that period
carry the import run's clock as their transaction time rather than the bank's (many
share one of four times of day), which defeats any same-minute rule against them. And
one hand-typed pair of identical rows exists in the family ledger itself.

---

# Part E: the proposal (after the real-data assessment)

**Product rule.** A row is either *known to be booked already* or it is not. Two
user-facing states, nothing in between:

- **Đã có trong sổ** (sure): set aside, unticked, with the twin row shown: which book,
  who logged it, when. One tap imports anyway.
- **Có thể trùng** (likely): in "Cần bạn xem", unticked, with the twin shown. The
  person decides.
- Everything else shows no chip and stays ticked. Amount-only matches no longer flag.

On the measured account this turns 86 identical "lặp lại" chips into 70 sure (all
correct), 7 asks (6 correct), and 0 false chips; the 10 false positives disappear.

**Phase 1, client only, no migration.**

1. `src/js-ui/58-dedup-engine.js` (global scope): pure `fhDedupAssess(candidates,
   ledgerIndex)` → `{tier, twin, why}` per row. Two passes over amount-bucketed maps;
   one ledger row claimable once; in-queue pairing of two notices of one purchase (same
   provider, same amount, ≤3.5 days, different shape or card posting) as likely.
2. `fhLedgerIndex()`: family rows with real kind, author, instrument, planned rows
   excluded; personal slice fetches all kinds and `link_id`; mirrors collapsed; cached
   per session, invalidated by the write path.
3. `bucketCsvCandidates` keeps richest-copy merge, `resolved_before` and in-batch (with
   reference equality when there is no time) and calls the engine for everything else.
4. Chips, tick policy and `csvDupWhy` render from the engine's `why`; evidence names the
   best twin, not the first amount match.
5. Kind gate: transfer, xfer, repayment and loan candidates never match spend rows; an
   income candidate whose long text equals an expense row's note with the same amount
   and day is likely with a kind-conflict message.
6. Quick review calls the engine; any tier drops the row to the full queue.
7. Synthetic fixtures for every shape found in the real set; no real data in the repo.

**Phase 2, migration 0139+ and `mailbox-sync`.**

8. `ON DELETE SET NULL` on `duplicate_of_id` (latent retirement failure).
9. `sender_kind` clear column; owner scoping in `findDuplicate`; `ref_fp` keyed reference
   fingerprint (23 of 105 rows carried a reference; every VIB row did).
10. Find why the Aug 31 to Sep 14 promotes wrote no tombstones; make the promote path
    assert tombstones = deletions and log loudly on mismatch.
11. Fix family email imports stamping the import run's clock as `occurred_time`.

**Phase 3.** Forwarding through `/ingest`; the connect-time question for a second login;
flipped fingerprint for family transfers; FX pairing.

**Not doing.** No model calls, no new plaintext columns, no RLS widening.

**Status 2026-09-16 (evening).** Phase 1 is built: `src/js-ui/58-dedup-engine.js`, the
review screen, quick review, the personal slice, and the tests (`tools/dedup-engine.test.js`,
38 cases). Replayed on the same real export: 70 sure (70 correct), 9 likely (8 correct),
0 false chips, 0 misses (the refund's kind conflict is a *likely*; the posting notice
pairs through the bank-named counterparty rule). Phase 2 and 3 not started.
