# Earthy — Bank Email to Ledger Row

**An in-depth review of the transaction-capture feature**

Prepared 30 August 2026 · against `main` @ `53e826d` · `mailbox-sync` v24 · migrations through `0103`

Written for three readers at once. The **product manager** should be able to read Parts 1, 2, 6 and 7 and know what the feature promises, what it currently delivers, and what is worth funding. The **technical lead** should be able to read Parts 3, 4 and 5 and know how every byte moves and where the design load is carried. The **engineering lead** should be able to read Parts 6, 7 and 8 and plan the next three sprints from them.

Where this document states a number, that number was measured today against the live project unless it says otherwise. Where it states a judgement, it says so.

---

## Part 0 — The one-page summary

Earthy reads a household's bank notification emails and turns them into reviewable ledger rows, so that keeping a family budget does not require typing in every purchase.

The feature works. 702 transactions are staged and waiting in the review queue, spanning 28 December 2025 to today, across four providers. Two mailboxes are connected. The security design is genuinely good: rows are sealed to a family public key that the server never holds, and there is no code path from "could not seal" to a readable insert.

**Three things are wrong, and they are ranked by what they cost.**

**One.** The pipeline performed **43,592 message reads today to produce 8 transactions.** 42,679 of those reads were of mail it had already decided, on a previous run, was not a transaction. It re-reads them because it only remembers messages it *staged* — the ones it rejected are forgotten between runs and fetched from Gmail again, every minute, forever. This is the dominant cost in the system and it is invisible in every dashboard because the rejections are correct.

**Two.** One mailbox's first read has been running for **29 consecutive minutes without progress** and cannot finish. Any single message that makes the extraction model throw — a safety filter, an oversized body, a malformed response — holds the whole mailbox's cursor in place. There is no give-up counter and no failure row: the message is retried every minute, indefinitely, and leaves no trace anyone can triage.

**Three.** The system is meant to learn a cheap local template per email shape and stop calling the model. It has learned **3 templates for 16 transaction shapes.** The other 13 pay for a model call on every mail, forever.

None of these three is a bug in a single line. Each is a structural gap: **the pipeline has no memory of a negative decision, no bound on retrying a poisoned message, and no visibility into why learning fails.** Part 7 proposes fixes in cost order.

---

## Part 1 — What the feature is, in plain language

### 1.1 The job

A Vietnamese household's spending already generates a perfect written record: the bank emails a notice for every card tap and every transfer, within seconds. The household does not lack data. It lacks the data *in one place, in a form they can reason about*.

Earthy's answer is to read those emails and pre-fill the ledger. The person's job changes from **typing in every transaction** to **glancing at a row and saying what it was for**.

### 1.2 The part deliberately left to a human

Every row is reviewed. Nothing is auto-imported. This is a product decision, not a maturity gap, and the code says why:

> *The machine can get amount, date and counterparty right, but it cannot know that "NGUYEN THU TRANG chuyen tien" was lunch with your mum. The description is the reason this screen exists, so pre-filling it is help, not a substitute.*

The machine contributes the tedious facts — how much, when, to whom, which account. The human contributes the only fact that makes a ledger useful: **what it was for**. That division is the feature's spine, and every technical decision downstream inherits it.

### 1.3 What the person actually experiences

1. They connect a mailbox, choosing how far back to read (up to a year).
2. Earthy reads their bank mail — and only their bank mail — and stages what it finds.
3. Their phone buzzes **once** when the history is ready. Not once per transaction.
4. They open a review queue: rows grouped by merchant, with categories suggested from their own history and likely duplicates flagged.
5. They fix descriptions, set categories, and import. The rows become ledger transactions.

### 1.4 What the person is promised about privacy

Three promises, all currently kept by the code:

- **Only bank mail is read.** The Gmail grant is `gmail.readonly`, which technically covers the whole mailbox. Google publishes no narrower scope. So the restraint is self-imposed: the query names specific bank and wallet senders, in one reviewable file, and never carries an unbounded term. This is a promise Earthy makes, not one Google enforces — and the code is honest that a user cannot verify it from the consent screen.
- **The server cannot read the transactions.** Amounts, counterparties and account numbers are encrypted to a key that only the family's own devices hold.
- **The original email is not kept.** Not sealed, not truncated — never written. The mail stays in the user's own mailbox, which is a better archive in the one way that matters: they can delete it.

### 1.5 Where the feature stands commercially

Onboarding is **allowlist-gated** (migration `0067`). Two mailboxes are connected. This is a beta with real family data, not a launched product, and the gate is deliberate — reopening it is blocked on a forwarder-identity fix and on Vietnam's personal data law.

---

## Part 2 — Four ways in, one ledger

Mail can reach the ledger by four routes. They converge at one table and share one learned cache, which is the single most important architectural fact in the system.

| | Route | Runs on | Status | How mail is obtained |
|---|---|---|---|---|
| **A** | **Forwarding** | Google Apps Script, 1-min trigger | Live | The user sets Gmail to auto-forward to a tagged alias; the script reads that shared inbox |
| **B** | **Direct read (poll)** | Supabase Edge Function, 5-min cron | Live | OAuth grant on the user's own mailbox; Gmail `messages.list` + `get` |
| **C** | **Direct read (push)** | Same function, `/push` route | Live | Gmail watch fires a Pub/Sub notification; that one mailbox is read immediately |
| **D** | **Ingest bridge** | Same function, `/ingest` route | Built, unused | An external Cloud Run parser hands over a *reading* it already made |

### 2.1 Why more than one route exists

Route A came first because it needs no OAuth review: the user configures forwarding themselves. Its costs are structural. Identity is inferred from an address tag the sender partly controls. It runs on Apps Script, which has no cryptographic random number generator — so the seal implementation there carries roughly seventy hand-written lines of HMAC counter-DRBG that exist purely to work around that absence.

Route B is where the product is going. Identity is *proven*: mail is fetched from a mailbox Earthy holds a grant for, so there is no routing table, no alias lookup, and no unroutable-mail limbo. The runtime has a real CSPRNG, so seventy lines of substitute randomness are deleted rather than ported. And it can read **history** — the first connect reaches back as far as the person chose, which forwarding structurally cannot do.

Route C exists for one reason: a notification that arrives *with* the bank's email rather than up to five minutes later.

Route D exists because a separate Python parser was built and stops at `# TODO: persist`. The bridge is that line's other end. It deliberately does not port the seal — a third byte-compatible implementation of the encryption, and a second dedup-key mint, would break cross-route duplicate detection *silently*.

### 2.2 Where they converge

All four write to `email_transactions` and all four read and write one shared `sender_fingerprints` cache, keyed on `(sender_address, subject_template)`.

That sharing is load-bearing and easy to break. A template learned from a Vietcombank mail that arrived by forwarding is applied to a Vietcombank mail that arrives by direct read. This makes the two transports behave *identically* on the same bank rather than merely similarly. It requires that both implementations normalise a subject to the same string and compute a duplicate fingerprint from the same bytes. The code is emphatic about this:

> *A fingerprint computed even slightly differently here matches nothing there, and the failure is silent — duplicates simply stop being caught, which reads exactly like there being none.*

Parity is held by a test (`pipeline/direct-dedup.test.js`), not by the type system. **This is the most fragile seam in the feature.**

### 2.3 The sequence, end to end (route B)

```
pg_cron (*/5, and */1 for unfinished first reads)
  └─> POST /mailbox-sync           x-sync-secret compared in full, never short-circuited
        │
        ├─ dueGrants()             which mailboxes are ready to poll
        │
        └─ for each grant (3 concurrent):
             │
             ├─ resolveDestination()      ── BEFORE any mail is fetched.
             │    member alive? family alive? member still in this family?
             │    staging public key exists?
             │    any "no" is a HOLD: nothing fetched, cursor untouched
             │
             ├─ decryptToken()            AES-GCM unwrap of the refresh token
             ├─ accessToken()             Google OAuth refresh
             │
             ├─ inboxQuery(days, domains) (from:bank OR from:wallet ...) newer_than:Nd
             │    never a to: term, never unbounded
             │
             ├─ listMessageIds()          ids only, max 500 poll / max 2000 first read
             ├─ alreadyStaged(ids)        ONE query, chunked at 150 ids
             │    ── consults email_transactions AND resolved_email_messages
             │    ── does NOT consult any record of rejected mail  <── see Finding 1
             │
             └─ for each chunk of 20, fetch ahead one chunk, then in strict order:
                  ├─ senders.match()      is this sender on the list at all?
                  ├─ DKIM verdict         recorded on the row; enforced by config
                  ├─ readTransaction()    the three-tier ladder — Part 3
                  ├─ buildStagedRow()     ── PLAINTEXT ENDS HERE
                  │    dedup fingerprint, then seal to the family public key
                  └─ insertStaged()       unique on gmail_message_id
             │
             ├─ markSynced()              ONLY if nothing held and nothing queued
             └─ notify()                  once per run; once per first read
```

**The order of the last two steps is the whole design.** The cursor is written last and only when the window was fully handled. A crash, a rate-limited model, a family that has not yet minted a staging key — all leave `last_synced_at` where it was, so the next poll reads the same window again. Advancing first would skip mail silently, and **silence is this pipeline's characteristic failure**: there is no error page for a transaction that never appeared.

The cost of that choice is that re-reading is *normal* rather than exceptional. Which is exactly why Finding 1 below is so expensive.

---

## Part 3 — The extraction ladder

Reading a transaction out of an email is done in three tiers, cheapest first. This is the core intellectual property of the feature.

### Tier 0 — the cached rejection (~0.01 ms, no network)

Before anything else: has this `(sender, subject shape)` already been judged not-a-transaction? If so, stop. This is most of what a real mailbox contains.

There is also a **sender-wide** verdict for senders that have produced many distinct junk shapes and *never once* a transaction. Marketing mail has a new subject every time, so the per-shape cache never helps; the sentinel is what stops each new subject buying a fresh model call.

The safety argument is entirely in one clause: `txn === 0`. A sender that has **ever** produced a transaction is never blanketed, however much noise it also sends. Banks legitimately send both from one address, and silently ignoring such a sender would lose real money with nothing recording it. The count (6 shapes) is a second, weaker guard so a sender is not written off on two promotional emails.

### Tier 1 — the stored template (~0.01 ms, no network)

A per-shape regex template, derived once and reused forever. Two details carry disproportionate weight:

**A template is kept only if it reproduces the model's own output on the very body it came from.** A plausible-looking template that does not actually work would serve wrong figures to every later mail from that sender *and to the other transport as well*. When derivation fails, `null` is stored: the sender is confirmed as a transaction source, and the next mail tries the model again.

**The mail's own status row outranks the template.** Several stored templates froze "status: success" at derivation time, so a *declined* transaction off the same shape would have staged as real spending. The status check runs before the template's answer is accepted.

### Tier 1.5 — the label-table reader (~0.10 ms, no network)

Every Vietnamese bank transaction notice seen so far renders as a two-column label/value table off a small bilingual vocabulary: `Số tiền / Amount`, `Điểm giao dịch`, `Ngày, giờ giao dịch / Trans. Date, Time`. This tier parses that structure directly. **No learning phase, no model call, and a bank never seen before works on its first mail.**

Its confidence gate is the safety argument: it returns nothing unless the mail yields an amount *and* a transaction timestamp *and* a counterparty. Marketing mail does not carry an amount row and a transaction-timestamp row in table form; a mail that does is a transaction notice by construction.

Two bugs fixed here on 29–30 August are worth recording as a class, because both were *plausible text in the right position*:

- **The English twin.** Vietcombank writes one cell as `Sử dụng tại` followed by its English twin `At`. Every block tag becomes a newline, so the twin lands exactly where the value should be, and every card row's merchant read **"At"** instead of AEON MALL. The fix names the twins explicitly and skips them by exact match — never by a heuristic like "short and alphabetic", which would eat "AEON" and "Circle K" too.
- **The footer.** The bank's sign-off contains *"các điểm giao dịch của Vietcombank (trong giờ hành chính)"*, which contains the merchant label. The fix adds three guards: a maximum label length, a maximum start position, and a list of prose markers.

The general lesson for anyone extending this tier: **the failure mode is not "no match", it is "a confident match on the wrong text."**

### Tier 2 — the model (measured 1,540 ms, network, costs money, data leaves)

Gemini `3.5-flash-lite`, reached only for a shape with no template. **The mail is sent as written** — real amounts, names, account and reference numbers. Masking was removed on 25 August and consent replaced it; the consent sheet states that a first-time bank's mail goes to an AI service to be read, and the consent version was bumped so prior agreement does not count.

> **If you change what is sent here, change the consent sheet in the same commit.**

On success the answer is used, a template is derived, and the labels the mail used — *labels only, never values* — are logged as a dictionary gap so the table tier's vocabulary can grow from real misses. That miss log is the only training data this pipeline collects.

A model failure is a **throw, not a verdict.** "Rate-limited" and "this is a newsletter" are different events, and collapsing them would either retry a newsletter forever or permanently drop a transaction because a free-tier quota reset four minutes later. This distinction is correct, and Finding 2 is about what the throw then does.

---

## Part 4 — The security model

### 4.1 Sealed staging

`stage.mjs` is the boundary the whole feature stands on: everything before it holds plaintext, everything after it holds ciphertext and routing metadata. **The worker that can read a family's mail can never read back the row it produced.**

Ephemeral-static X25519 with XSalsa20-Poly1305 (TweetNaCl). A fresh ephemeral keypair per row; the secret half is destroyed immediately after sealing. The only remaining route to the plaintext runs through the family private key, which never leaves a family device.

**What stays readable, and why each one must:**

| Column | Why it cannot be sealed |
|---|---|
| `gmail_message_id` | the idempotency key — queried *before* anything is decrypted |
| `member_id` | ownership; the row-level security policy keys on it |
| `source_provider` | duplicate detection compares bank names *fuzzily*; a hash matches only exactly |
| `occurred_at` | duplicate detection queries a date **range** |
| `dedup_fp` | the keyed equality token that replaces the sealed amount |
| `duplicate_of_id`, `review_status` | workflow state, not content |

Everything else rides inside the box: amount, currency, direction, counterparty, reference number, transaction type, and the whole raw extraction blob.

A database `CHECK` constraint makes the half-sealed state **unwritable** — either all four envelope columns are null, or all four are set *and* every sensitive column is null. A bug that wrote both would be refused by Postgres rather than quietly stored.

### 4.2 Seal-or-hold is absolute

There is no argument, no configuration flag, and no code path from "could not seal" to a readable insert. A failure to seal throws; the caller leaves the cursor where it is; the message is read again next poll. Route A makes the same bargain by leaving the thread labelled `txn/inbox`.

### 4.3 The dedup fingerprint

Sealing makes `amount` null, so an `amount = X` query matches nothing — forever, and silently, which is how it once shipped. A keyed hash replaces it.

The key is **configuration on the direct-read side, never self-minted.** Apps Script self-mints on first use, which is right for the only implementation there is and wrong for the second: two independent mints produce two key spaces, every fingerprint stops matching across transports, and nothing anywhere throws.

The key stays out of Supabase entirely. That is the point of it — a database attacker holding fingerprints cannot run a dictionary of round Vietnamese-dong amounts against them, and low-entropy amounts are exactly what made an unkeyed hash unshippable.

Provider is deliberately **not** in the hashed message, because bank names need fuzzy matching and hashing would fragment on spelling.

### 4.4 Identity, and why every check is a hold

`grant_mailbox_access()` already refused to store a grant whose user had no member row in a real family. It can stop being valid afterwards: a member is archived, a family is archived, the member moves, the family never minted a staging keypair. None of those are errors. They are **states**, and every one is a hold.

Each prevents a specific silent failure — a row whose member is dead is visible to nobody forever, and staging it accumulates data that can never be surfaced *or deleted* by the person it describes.

A hold is cheap and self-healing: the cursor does not advance, and the moment the family unlocks a device and mints a key, the mail stages correctly with nothing to re-fetch.

### 4.5 Two honest weak points

**`gmail.readonly` is broader than the promise.** The restraint that keeps Earthy to bank mail is a sender list in Earthy's own source, not a boundary Google enforces. This is disclosed internally; whether it is adequately disclosed to users is a product and legal question, not a technical one.

**Route A infers identity from an address tag.** This is the known reason onboarding is still gated.

---

## Part 5 — Where the hour goes

Measured per message, and the tiers differ by five orders of magnitude.

| Step | Cost | Notes |
|---|---:|---|
| Gmail `messages.get` | ~1,300 ms | pure I/O, 20 lanes concurrent → ~65 ms effective |
| Tier 0 cached rejection | ~0.01 ms | in the warm map |
| Tier 1 stored template | ~0.01 ms | local regex |
| Tier 1.5 label table | ~0.10 ms | local parse |
| **Tier 2 model call** | **~1,540 ms** | **network, serial, budgeted at 40 per mailbox** |
| Seal + insert | ~24 ms | one round trip |

**The shape of the arithmetic:** a message read by cache or template costs about 24 ms of database time on top of its share of a parallel fetch. A message that needs the model costs 1,540 ms and cannot be parallelised, because the budget is spent in sequence.

So a run's wall clock is roughly:

```
   (messages / 20 lanes) x 1,300 ms      the fetch, parallel
 + (model-needing messages) x 1,540 ms   the model, serial
 + (staged rows) x 24 ms                 the writes
```

A 228-message first read with a warm cache: ~15 s of fetching, ~5 s of writes, no model. **Under half a minute.** The same read with nothing cached: ~15 s of fetching plus 40 model calls at 1.54 s = ~62 s, hits the per-mailbox budget, and holds — which is correct behaviour, and finishes on the next tick.

### 5.1 Why the numbers are what they are

Every cap was raised on 29 August against a measured budget rather than caution:

| Constant | Was | Now | The reasoning |
|---|---:|---:|---|
| `MAX_MESSAGES_PER_GRANT` | 40 | **120** | 40 was sized when a catch-up was rare; the window auto-widens after an outage, so 40 turned one outage into three runs |
| `MAX_MODEL_CALLS_PER_GRANT` | 10 | **40** | and became **per-mailbox**. Shared, the first mailbox drained the pool and the rest got nothing — the opposite of what the ceiling was for |
| `BACKFILL_STAGE_MAX` | 150 | **400** | a real 90-day history measured 228 messages; at 150 that was two runs and therefore two notifications |
| `FETCH_CONCURRENCY` | 6 | **20** | Gmail allows ~250 quota units/sec and `messages.get` costs 5 → ~50 req/sec. Six lanes used 9% of that while fetching was 65% of a run's wall clock |
| `LIST_MAX_PER_RUN` | 500 | 500 | unchanged — listing is ids only and stops early |
| `BACKFILL_LIST_MAX` | 2000 | 2000 | unchanged — sized against ~66 transactions/month over 12 months |

**Why listing and staging have separate caps** is the subtlest of these and worth preserving. Gmail returns newest-first, and a staged message *still matches the query*, so it keeps its slot on the first page forever. If a run listed only as many as it could stage, "there is more" would be indistinguishable from "there is nothing" — and a run that cannot tell the difference marks itself finished and strands the rest. **Past the listing cap, the oldest mail is not slow to arrive; it is unreachable.**

**Why the poll is every 5 minutes** and not faster: it is not the latency path. Route C (Gmail push) is, and it fires the moment the bank's mail lands. The 5-minute poll is the safety net for a missed or expired watch. Making it 1 minute would multiply the cost in Finding 1 fivefold and improve nothing a user can perceive.

### 5.2 What a failure costs

| Failure | Time cost | Recovery |
|---|---|---|
| Model rate-limited | mailbox holds for this run | next tick, no loss |
| Model throws on one message | **the mailbox never advances** | **none — see Finding 2** |
| Token unreadable | run ends immediately | user must reconnect |
| No staging key | nothing fetched at all | self-heals on next unlock |
| Database unreachable at `alreadyStaged` | run throws before any fetch | correct — failing open would double-stage everything |

---

## Part 6 — Production reality, measured today

All figures from the live project at **06:35 UTC on 30 August 2026**.

### 6.1 The queue

- **702 rows** staged and pending
- Spanning **28 Dec 2025 to 30 Aug 2026**
- By provider: VIB 411, MB Bank 218, Vietcombank 71, MoMo 2
- Two members: 484 rows and 218 rows
- `parse_failures`: **3 rows**, all from 15 August, all infrastructure errors

Note that imported rows are *deleted* from this table on promotion, so "702 pending, 0 imported" does not mean nothing has been imported — it means nothing is currently mid-review.

### 6.2 The two mailboxes

| | `trang.nguyen.wh` | `hiencao27110505` |
|---|---|---|
| Window chosen | 90 days | **365 days** |
| First read finished | yes, 29 Aug 11:44 | **never** |
| Cursor (`last_synced_at`) | 30 Aug 06:34 | **null — never advanced** |
| Consecutive stalled runs | — | **29** |
| Stalled since | — | 06:05 UTC today |

### 6.3 The read tally — the headline number

| Day | Total reads | **Real transactions** | Cached rejections | Declined-status | Model calls |
|---|---:|---:|---:|---:|---:|
| 28 Aug | 280 | **274** | 6 | 0 | 1 |
| 29 Aug | 39,168 | **1,005** | 37,697 | 452 | 496 |
| 30 Aug | 43,592 | **8** | **42,679** | 905 | 7 |

Read the last row carefully. **43,592 message reads produced 8 transactions.** Ninety-eight per cent of the work was re-reading mail the system had already, correctly, rejected on a previous run.

At roughly 68 rejections per run and one run per minute, that is ~43,000 redundant Gmail fetches and ~43,000 telemetry writes per day, for one mailbox.

### 6.4 The learning cache

- 106 fingerprint rows across 19 senders
- 90 cached rejections, 2 sender-wide sentinels — **this half works well**
- **16 transaction shapes, of which only 3 have a stored template**

The 13 shapes with no template, each of which pays for a model call on every mail:

```
vcbdigibank@info.vietcombank.com.vn   Biên lai chuyển tiền qua tài khoản
vcbdigibank@info.vietcombank.com.vn   Biên lai thanh toán
loyalty@info.vietcombank.com.vn       THÔNG BÁO HOÀN TIỀN THẺ VCB DIGICARD
info@myvib.vib.com.vn                 Thanh toán hóa đơn QR thành công
info@myvib.vib.com.vn                 Chuyển tiền đến tài khoản VIB thành công
info@myvib.vib.com.vn                 Thanh toán thẻ tín dụng VIB thành công
info@myvib.vib.com.vn                 Thông báo giao dịch đổi quà tiền mặt
info@myvib.vib.com.vn                 Chuyển tiền nhanh đến tài khoản ngân hàng nội địa thành công
info@card.vib.com.vn                  Thông báo giao dịch thẻ tín dụng
no-reply@momo.vn                      Xác nhận đặt vé CGV Hoàng Văn Thụ thành công ...
no-reply@momo.vn                      Xác nhận đặt vé CGV Vivo City thành công ...
hiencao27110505@gmail.com             Biên lai chuyển tiền qua tài khoản
j2team.tranminhquang@gmail.com        Biên lai chuyển tiền qua tài khoản
```

**VIB accounts for 6 of the 13** and is the largest provider in the queue by row count. It is the single highest-value target for the label-table dictionary.

Two of the thirteen are Gmail addresses, not banks — these are *forwarded* receipts, where the subject survived normalisation but the sender is a person. They will never converge, because each forwarder is a new sender.

The MoMo pair shows a normalisation gap: `Xác nhận đặt vé CGV Hoàng Văn Thụ` and `Xác nhận đặt vé CGV Vivo City` are one shape with a cinema name embedded. Subject normalisation strips numbers and dates but not proper nouns, so each venue mints its own cache row and its own model call.

---

## Part 7 — Findings

Ranked by cost. Each states the evidence, the mechanism, and a recommendation.

---

### Finding 1 — The pipeline has no memory of a negative decision

**Severity: high. This is the dominant cost in the system.**

**Evidence.** 42,679 of 43,592 reads today were cached rejections. `parse_failures` holds 3 rows.

**Mechanism.** `alreadyStaged()` consults two tables: `email_transactions` (rows staged) and `resolved_email_messages` (rows the person has dealt with). Neither records a message the pipeline *rejected*.

A message the extractor decides is not a transaction is skipped, and nothing anywhere remembers that. So on the next run it is listed again, **fetched from Gmail again** — a full network round trip — parsed again, and rejected again against the same cached verdict. Every minute. Forever.

The fingerprint cache is doing its job: it saves the *model call*. What it cannot save is the *fetch*, because the decision needs the message body, and the body needs the round trip.

**Why it has been invisible.** Every one of those 42,679 reads is *correct*. No error, no failure row, no alert. The telemetry counts it as a cache hit, which reads as success. The cost only appears if you compare the tally's numerator against its denominator, which nothing does.

**Cost.** Per mailbox per day: ~43,000 Gmail `messages.get` calls (~215,000 quota units), ~43,000 telemetry round trips, and the function wall clock to process them. It scales linearly with connected mailboxes and with the width of the backfill window. **At fifty mailboxes this is a rate-limit incident, not an inefficiency.**

**Recommendation.** Give the pipeline a memory of rejection. A `rejected_email_messages` table holding `(grant_id, gmail_message_id, decided_at)` and nothing else — no sender, no subject, no content, so it adds no privacy surface — consulted in the same pass as `alreadyStaged`. Expire rows older than the widest backfill window.

Expected effect: **43,592 reads/day to under 100.** This is the highest-leverage change available and it is roughly a day of work.

A cheaper interim: pass negative sender terms into the Gmail query for senders that hold a sender-wide sentinel, so the mail is never listed. This helps marketing mail only, not per-shape rejections, but it is an hour's work.

---

### Finding 2 — One poisoned message stalls a mailbox permanently

**Severity: high. Currently affecting one of two mailboxes.**

**Evidence.** `hiencao27110505`: `backfilled_at` null, `last_synced_at` **null — the cursor has never advanced since the mailbox was connected**, 29 consecutive no-progress runs, stalled since 06:05 UTC. 484 rows staged, so the read is *working*; it simply cannot finish.

**Mechanism.** `llm.extract()` throws `LlmUnavailable` on any HTTP error, any non-JSON response, and on "no candidates" — which is what a safety filter returns. The worker treats the throw as a hold: `hitLimit = true`, cursor stays put, retry next tick.

That is right for a transient failure and wrong for a permanent one. A message the model refuses *every time* — an oversized body, a safety trigger, a malformed attachment — holds the cursor forever. There is no attempt counter, no dead-letter path, and no `parse_failures` row, because the throw bypasses the code that records failures.

The result is a mailbox that reads correctly, stages correctly, and never advances. Because the first read never completes, migration `0097`'s fast lane keeps it on a **one-minute** cadence, which is what multiplies Finding 1 by five.

**Confidence, stated plainly.** The stall itself is directly observed. The *mechanism* is inferred: a stall requires either a hold or a queue overflow, and the run is processing roughly 68 fresh messages against a ceiling of 400, so overflow is unlikely and a hold is the remaining explanation. The inference was not confirmed against a live run, because doing so needs the function's shared secret. **Before building the fix, confirm it** by logging `summary.held` and `summary.queued` for one run — that distinguishes the two causes in a single tick, and the recommended fix is correct only for the first.

**The design gap, precisely.** The code distinguishes "transient" from "verdict" — correctly and deliberately. It does not distinguish **transient from permanent**. Only two of the three cases have a home.

**Recommendation.** Add a per-message attempt counter. After N consecutive throws on the same `gmail_message_id` (5 is reasonable), write a `parse_failures` row with the reason and **treat that message as decided** so the window can close. The mail stays in the user's mailbox and the row is triageable. Losing one unreadable message is much cheaper than never finishing a backfill — and today it costs both.

This is also the correct fix for the stall notification: the 0101 counter tells someone the backfill is stuck, but nothing *unsticks* it. **A notification is a symptom report, not a remedy.**

---

### Finding 3 — Template learning is failing where it matters most

**Severity: medium. Ongoing cost in money and latency.**

**Evidence.** 16 transaction shapes, 3 templates. 496 model calls on 29 August produced no new shapes.

**Mechanism.** `deriveExtractionTemplate` keeps a template only if it reproduces the model's own output on the body it came from — a good rule. When derivation fails it stores `null`, and every future mail off that shape calls the model again. There is **no record of why** derivation failed, so the failures cannot be triaged.

**Contributing causes visible in the data:**

- **VIB dominates.** 6 of 13 templateless shapes, and the largest provider in the queue. Something about VIB's markup defeats anchor derivation.
- **Subject normalisation is too shallow.** MoMo's `Xác nhận đặt vé CGV Hoàng Văn Thụ` and `... CGV Vivo City` are one shape. Normalisation strips digits and dates but not embedded proper nouns.
- **Forwarded receipts can never converge.** Two shapes are keyed on personal Gmail addresses. Each forwarder is a new sender, so each mints a fresh row and a fresh model call.

**Recommendation, in order:**

1. **Instrument the failure.** Log *why* derivation failed — which anchor did not hold — alongside the existing miss-labels log. Without this, everything below is guesswork. Half a day.
2. **Extend the label-table dictionary for VIB**, using `extract_miss_labels`. This is the tier that needs no learning phase and works on first sight. Highest value per hour of the three.
3. **Consider keying forwarded receipts on the originating bank** rather than the forwarding human, once forwarder identity is resolved — which is already a prerequisite for reopening onboarding.

There is a standing recommendation from earlier work to bump `EXTRACTION_LOGIC_VERSION`, which self-invalidates the cache and forces clean re-derivation. **Now is the cheap moment** — only 3 templates would be discarded. After Finding 3 is fixed and templates accumulate, it stops being cheap.

---

### Finding 4 — A comment promises a fallback the code does not perform

**Severity: low. Cost only, never correctness.**

**Evidence.** `extract.mjs` reads `if (!fp && !warm) fp = await db.fingerprint(...)`, directly beneath a comment stating *"A miss falls through to the query."* It does not: if a warm map is present at all, a miss never queries. The `catch` around the warm-map load carries the same false promise — *"fall back to per-message lookups"*.

**Mechanism.** If the batched fingerprint query throws for one chunk after an earlier chunk succeeded, that chunk's senders are absent from the map, every lookup misses, and **every message escalates to a model call.**

It fails toward the model, never toward wrong data, so this is a cost bug and not a correctness bug. It is also mine, introduced on 29 August.

**Recommendation.** One line, using the `__loaded` sentinel already being written: fall through to the per-message query when the sender is absent from the loaded set, rather than when the map is empty.

---

### Finding 5 — Route parity rests on a single test

**Severity: medium as a risk, zero as a current defect.**

Routes A and B must produce byte-identical subject normalisation and duplicate fingerprints. They are two implementations in two languages on two runtimes, held together by `pipeline/direct-dedup.test.js`.

**The failure mode is silent.** Duplicates stop being caught, which is indistinguishable from a week with no duplicates. Compounding this: CI currently runs only `npm run parse`; `npm test` and `npm run check` are commented out, so **the parity test does not run automatically.**

**Recommendation.** Re-enable `npm test` in CI. This is configuration, not engineering, and it is the cheapest risk reduction available anywhere in this document.

---

### Finding 6 — Notification correctness has been the recurring defect

**Severity: low now, but worth a structural note.**

Three regressions in three days, all in one code path:

1. Suppressing per-run notices during a first read made a *stuck* backfill silent.
2. The fix for that (`0101`) used a **level** test — `stalledRuns >= threshold` — which is true on the crossing run and every run after. With the one-minute fast lane, that was sixty notifications an hour. The feature built to stop ten buzzes an hour was sending six times more.
3. Fixed 30 August by comparing against the count the run *started* with, so it fires once per stall. Verified live: `stalled_runs` has reached 29 with one notification sent.

**The lesson is structural, not about any of the three bugs.** The notification decision depends on four interacting states — *backfilling*, *stalled*, *finished*, *ordinary poll* — and it has been reasoned about one state at a time. Every regression came from a case that was not in view when the change was made.

**Recommendation.** Before this path is touched again, write the state table: four states against the notify/suppress decision, with the reasoning for each cell, as a test fixture. It is an hour, and it would have caught all three.

---

## Part 8 — What to do, in order

| # | Change | Effort | Effect |
|---|---|---|---|
| **1** | Remember rejected messages (`rejected_email_messages`) | ~1 day | **43,592 reads/day to under 100.** Removes the dominant cost |
| **2** | Per-message attempt counter, dead-letter after N throws | ~half day | Unsticks the stalled mailbox; ends the 1-min fast-lane loop |
| **3** | Re-enable `npm test` in CI | ~1 hour | Restores the only guard on cross-route parity |
| **4** | Warm-map fallback one-liner (Finding 4) | ~10 min | Removes a silent model-call escalation |
| **5** | Log *why* template derivation failed | ~half day | Makes Finding 3 diagnosable instead of speculative |
| **6** | Extend label-table dictionary for VIB | ~1 day | Attacks 6 of 13 templateless shapes and the largest provider |
| **7** | Bump `EXTRACTION_LOGIC_VERSION` | ~10 min | Cheap **now** (3 templates); expensive later |
| **8** | Notification state table as a test fixture | ~1 hour | Prevents a fourth regression in the same path |

Items 1 and 2 together address both the cost and the stall, and they interact: fixing 2 alone drops the mailbox from a one-minute to a five-minute cadence, which reduces the cost in Finding 1 fivefold without fixing it.

### If the feature were being restructured

Three observations for anyone considering more than repair:

**The pipeline is a queue that pretends to be a cursor.** Nearly every hard bug in this document traces to a single design choice: state is one `last_synced_at` timestamp per mailbox, and a message is either before it or after it. That is why one poisoned message stalls everything, why rejections cannot be remembered without a new table, and why "there is more" has to be inferred from a listing cap. A per-message state machine — *seen, decided, staged, resolved* — makes every one of these findings either impossible or trivial. It is a significant rewrite of `worker.mjs` and nothing else.

**Route A should be retired, not maintained.** It carries seventy lines of substitute randomness, an inferred-identity weakness that is currently blocking onboarding, and a second implementation of two constructions that must stay byte-identical to the first. Route B does everything it does, better, with proven identity. The remaining question is migration, not capability.

**Tier 1.5 is the strategic asset, and it is under-invested.** The label-table reader needs no learning phase, sends nothing anywhere, costs a tenth of a millisecond, and works on a bank it has never seen. Every mail it reads is a model call never made and a privacy exposure never incurred. Of the three tiers it is the only one that gets *better* with a modest, purely local investment — a wider dictionary — and today it read **zero** messages while the model read seven. **Growing that dictionary is the highest-return engineering in this feature.**

---

## Appendix A — File map

| Concern | File |
|---|---|
| Orchestration, caps, cursor, notification | `supabase/functions/_shared/mailbox/worker.mjs` (758 lines) |
| Three-tier extraction ladder | `supabase/functions/_shared/mailbox/extract.mjs` |
| Label-table reader + vocabulary | `supabase/functions/_shared/mailbox/labeltable.mjs` |
| Template derive/apply, logic version | `supabase/functions/_shared/mailbox/templates.mjs` |
| Model call, prompt, schema | `supabase/functions/_shared/mailbox/llm.mjs` |
| Seal boundary, what stays clear | `supabase/functions/_shared/mailbox/stage.mjs` |
| Encryption | `supabase/functions/_shared/mailbox/sealed-box.mjs` |
| Duplicate detection (must match `.gs`) | `supabase/functions/_shared/mailbox/dedup.mjs` |
| Ownership + hold reasons | `supabase/functions/_shared/mailbox/identity.mjs` |
| Sender allow-list, Gmail query | `supabase/functions/_shared/mailbox/senders.mjs` |
| Database access | `supabase/functions/_shared/mailbox/db.mjs` |
| HTTP transport, secret check | `supabase/functions/mailbox-sync/index.ts` |
| External-parser bridge | `supabase/functions/_shared/mailbox/ingest.mjs` |
| **Route A, entire** | `pipeline/bank-email-pipeline.gs` (2,063 lines) |
| Route A seal side | `pipeline/sealed-box.gs` |
| Client: open a sealed row | `src/js-data/18-staging-keys.js` |
| Client: review queue | `src/js-data/72-txn-review.js` (826 lines) |
| Client: connect a mailbox | `src/js-data/71-mailbox-ui.js` |
| Client: consent copy | `src/js-data/75-consent-ui.js` |

## Appendix B — Migrations

`0025` pipeline · `0028` member routing · `0051` family staging keys · `0058` review access · `0060` resolve/delete · `0065` sealed columns · `0067` beta gate · `0068` sealing hardening · `0071` parse templates · `0087` direct read · `0088` cron schedule · `0089` Gmail watch · `0090` resolved-message tombstones · `0091` personal staging key · `0092` personal-only mailboxes · `0093` chosen backfill window · `0097` backfill fast lane · `0098` re-backfill on widen · `0099` fingerprint hygiene + read tally · `0101` stall counter · `0103` one grant per mailbox

Next free number: **0104** — confirm against `AGENT_SYNC.md`; two sessions share this range.

## Appendix C — Operating constants

```
POLL_DAYS                   2      floor; widens automatically after an outage
BACKFILL_DAYS              90      default; user may choose up to 365
MAX_MESSAGES_PER_GRANT    120      staged per ordinary poll
MAX_MODEL_CALLS_PER_GRANT  40      per mailbox, not per run
BACKFILL_STAGE_MAX        400      staged per first-read run
LIST_MAX_PER_RUN          500      ids listed, ordinary poll
BACKFILL_LIST_MAX        2000      ids listed, first read
FETCH_CONCURRENCY          20      Gmail round trips in flight
GRANT_CONCURRENCY           3      mailboxes worked at once
STALL_NOTIFY_AFTER         12      no-progress runs before speaking once
SENDER_JUNK_THRESHOLD       6      junk shapes before a sender-wide verdict
DEDUPE_WINDOW_DAYS          3      either side, for cross-source duplicates
RENEW_WITHIN_SECONDS   2 days      Gmail watch renewal lead time
TXN_REVIEW_PAGE          1000      rows one open of the queue fetches
```

## Appendix D — How to verify these findings

```sql
-- Finding 1: the ratio that matters
select day, stage, n from read_tally order by day desc;
--   compare (template + llm + table) against junk_cache

-- Finding 2: a mailbox that cannot finish
select email, backfilled_at, last_synced_at, stalled_runs, first_stalled_at
  from mailbox_grants;
--   last_synced_at null with rows staged = stalled

-- Finding 3: shapes that never learned
select sender_address, subject_template from sender_fingerprints
 where is_transaction_source and extraction_regex is null;

-- Queue health
select review_status, count(*) from email_transactions group by 1;
```

---

*Compiled 30 August 2026 against `main` @ `53e826d`. Production figures read live at 06:35 UTC. Findings 4 and 6 concern code introduced by this reviewer on 29 and 30 August, and are reported on the same basis as the rest.*
