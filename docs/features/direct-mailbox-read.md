# Direct Mailbox Read

The second transport for bank-email capture. Instead of asking someone to set up a
forwarding rule, we read their own mailbox under an OAuth grant they give once.
Everything downstream is shared with [the forwarding pipeline](bank-email-pipeline.md):
both stage sealed rows into `email_transactions`, and one review screen promotes them.

> **Status, 2026-08-26.** **Live in production.** Two mailboxes connected, 90-day
> backfill, Gmail push registered, 5-minute poll running unattended, ~200 transactions
> staged with zero plaintext reaching the database. Migrations `0087`–`0090` applied.
> Not live: the bridge that would let the backend team's Python pipeline feed this one
> (`persist.py`, built and tested, unmerged). See [Current State](#current-state).

---

## Problem & Why

Forwarding works, and it costs the user a setup step they have to perform correctly in
a mail client, plus an alias they must not lose. It also gives us a structural weakness:
identity is resolved from a `+tag` in a `To:` header, and headers are attacker-supplied
text. Anyone who learns an alias can post mail into somebody's queue.

Reading the mailbox directly inverts both. Consent happens once, in the app, on Google's
own screen. And identity stops being inferred: we fetch from a mailbox **we hold a grant
for**, so "whose transaction is this" is answered by the grant rather than by a header.
That is the whole structural upside, and it is why there is no routing table here, no
alias lookup, and no unroutable-mail limbo.

The cost is a restricted OAuth scope, a token to protect, and a self-imposed restraint:
`gmail.readonly` grants the **entire mailbox** — Google publishes nothing narrower — so
the only thing standing between "we read bank mail" and "we read everything" is that our
Gmail query names its senders. That restraint lives in one reviewable file, deliberately.

### Two decisions that shape everything downstream

**1. The seal happens on our side, always.** A staged row is encrypted to the family's
`staging_pub` before it reaches Postgres. The worker that can read a family's mail can
never read the row it wrote. There is no config flag and no plaintext fallback.

**2. The cursor moves last, and only on a finished window.** Every failure mode here is
silent — there is no error page for a transaction that never appeared — so re-reading is
normal and skipping is unrecoverable.

---

## Architecture & How It Works

### 0. Setup, once per member

The Settings row `set-autotxn-row` ships hidden and is revealed only when
`can_use_mailbox()` returns true (`0067`, beta allowlist). Consent is recorded *before*
Google's screen: `user_consents` kind `bank_email`, currently v4 (`0082`). Google's
"Allow" grants API access; the consent sheet is the permission the law asks for.

`mailbox-connect/authorize` verifies the caller's Supabase JWT, mints an **HMAC-signed
state** (`MAILBOX_STATE_SECRET`, 15-minute TTL) and returns the Google URL **as JSON**.
Not a 302: a cross-origin fetch can do nothing useful with a redirect — following it
makes the browser request Google as a fetch, which Google refuses, and `redirect:"manual"`
yields an opaque response whose headers the Fetch Standard strips.

`mailbox-connect/callback` runs `--no-verify-jwt` — a browser returning from Google
carries no session — so it authenticates itself by verifying that signed state. It then
exchanges the code, encrypts the refresh token (AES-256-GCM, `MAILBOX_TOKEN_KEY`,
`v1:<iv>:<ct>`) and calls `grant_mailbox_access()`.

**That RPC is where ownership is decided**, and it is the highest-consequence query in
the feature:

```sql
select m.id, m.family_id from members m join families f on f.id = m.family_id
 where m.user_id = p_user_id and m.is_shared = false and m.archived_at is null
   and f.type = 'family' and f.archived_at is null
 order by m.created_at limit 1;
```

`order by m.created_at` is load-bearing. Since personal ledgers (`0076`+) every user has
**more than one** `members` row, and an unordered `limit 1` is a coin flip that binds a
mailbox to the wrong container. A user with no member row in a real family raises
`no_member_row` and the flow bounces them to a screen that says so — a product state,
not a fault.

Finally the callback registers `users.watch()` if `GMAIL_PUSH_TOPIC` is set. Best effort:
failure costs latency, not transactions.

### 1. Two triggers, one pipeline

| Trigger | Path | Latency | Role |
|---|---|---|---|
| Gmail push | Gmail → Pub/Sub → `POST /mailbox-sync/push?secret=` | seconds | the optimisation |
| pg_cron | `_mailbox_sync_tick()` → `POST /mailbox-sync` | ≤ 5 min | the guarantee |

They do identical work; only the trigger differs. Both are needed because they fail
differently: **a watch lapses after 7 days and Gmail then stops publishing silently** —
no error, no final notification, nothing in any log — so a push-only pipeline looks idle
rather than broken. The poll is what makes that a latency problem instead of missing
transactions.

Overlap is harmless: staged rows are idempotent on `gmail_message_id`, so a push and a
tick landing on the same message cost one lookup.

`/push` **acks anything a retry cannot fix** — a malformed envelope, or a mailbox we hold
no grant for (a watch outlives a disconnect by up to 7 days, so Gmail keeps ringing a
doorbell nobody is behind). Pub/Sub redelivers whatever is not acked, and fighting a
permanent failure that way is how a topic backs up.

### 2. The run, per mailbox

1. **Select due grants** — `needs_reauth = false`, oldest `last_synced_at` first, capped
   at `MAX_GRANTS_PER_RUN` (25).
2. **Resolve identity** → `{memberId, familyId, stagingPub}`. Five states HOLD rather
   than stage (see §4).
3. **Decrypt the refresh token**, exchange for an access token.
4. **Compute the window.** First connect = `BACKFILL_DAYS` (90). Otherwise
   `windowDays(last_synced_at)` = `max(POLL_DAYS, ceil(days_since) + 1)`, so an outage
   *widens* the window instead of skipping it.
5. **List** — `messages.list` with `from:(157 domains) newer_than:Nd`, capped at
   `LIST_MAX_PER_RUN` (500). Deliberately **not** scoped to the inbox label: a bank mail
   auto-filtered into a folder is still a transaction.
6. **Ask what is already done** — one `alreadyStaged(ids, memberId)` call for the whole
   window, unioning `email_transactions` **and** `resolved_email_messages` (§5).
7. **Per fresh message, up to `MAX_MESSAGES_PER_GRANT` (40):**
   fetch → sender match → DKIM verdict → parse → seal → fingerprint → dedup → insert.
8. **Advance the cursor** — `last_synced_at`, plus `backfilled_at` on a first run —
   **only if nothing held and nothing remains queued.**
9. **Notify** if anything staged.

### 3. Parsing: template first, model second

`readTransaction` (`extract.mjs`) is a three-stage cascade keyed on
`(sender_address, subject_template)` in `sender_fingerprints`, where the subject is
normalised to a *shape* so "Giao dịch 1.500.000đ" and "Giao dịch 250.000đ" are one entry.

| Stage | Cost | Outcome |
|---|---|---|
| Cached `is_transaction_source = false` | 1 lookup | skip forever — this is most of a real mailbox |
| Stored `extraction_regex` | local, nothing leaves | parsed |
| Gemini (`gemini-3.5-flash-lite`) | 1 API call, budget-capped | parsed, then a template is **learned** |

A derived template is kept only if it **reproduces the model's own output on the very
body it came from**. `MAX_MODEL_CALLS_PER_RUN` (10) is a hard ceiling; exceeding it
throws, which HOLDS the mailbox rather than half-reading the window.

The mail is sent to the model **as written** — masking was removed 2026-08-25 and
consent replaced it. A model that cannot read `750.000` cannot use a figure's magnitude
as evidence, and magnitude is most of how a balance is told from an amount.

Observed in production: **7 model calls for the first 52 transactions, then 0** — 3
templates learned, 3 senders cached as non-transactional (a monthly VISA statement, two
VIB marketing emails).

### 4. Identity, and the five holds

`resolveDestination` (`identity.mjs`) throws `MailboxHold` for:

| Reason | Meaning | Clears when |
|---|---|---|
| `needs_reauth` | Google rejected the refresh token | user reconnects |
| `no_member` | grant carries no destination, or the member vanished | ownership restored |
| `member_archived` | member archived since connect | — |
| `member_moved` | member's `family_id` ≠ grant's | ownership settled |
| `no_staging_pub` | family never minted a staging keypair | any device unlocks |

Every one is a property of the **mailbox**, not a message, so all five stop the whole
mailbox. A hold costs one wasted poll and loses nothing, because the cursor does not move.

`member_moved` is worth understanding: sealing to a family the member has left produces a
row their current family cannot open and their old family cannot see. The *disagreement*
is the thing to stop on, rather than quietly preferring one side.

### 5. Idempotency: two tables, one question

The question is **"have we finished with this message?"** — which is not the same as
"is it in `email_transactions`?"

Promoting a transaction **deletes** the staged row (`resolve_email_transactions`), which
is correct: it holds a sealed copy of a bank email and there is no reason to keep it. But
that makes the table forget. On an ordinary poll this never surfaces, because the cursor
has moved past. It surfaces the moment anything re-reads an **old** window — a widened
backfill, a cleared `backfilled_at`, an outage long enough for `windowDays` to reach back.

**This happened in production on 2026-08-26**: clearing `backfilled_at` to widen a
15-day backfill to 90 days re-staged 42 transactions already promoted into the ledger.

`resolved_email_messages` (`0090`) is the fix. It stores a member id and a Gmail message
id — **no amount, no merchant, no date, nothing sealed** — only that this mailbox is
finished with this message. `resolve_email_transactions` records it **before** deleting,
so a failed insert rolls back and keeps the row; losing the row while failing to record
it is the one ordering that cannot be recovered from.

The client's own guard cannot cover this: it remembers staged-row **UUIDs**, and a
re-staged message is a new row with a new UUID — and its prune drops any id the server
stops returning.

### 6. Sealing — the writer that cannot read

`buildStagedRow` (`stage.mjs`) is the boundary. Before it, plaintext; after it,
ciphertext and routing metadata.

**Stays clear, and why each must:**

| Column | Why it cannot be sealed |
|---|---|
| `gmail_message_id` | the idempotency key, queried before anything is decrypted |
| `member_id` | ownership; `0058`'s RLS policy keys on it |
| `source_provider` | dedup compares bank names *fuzzily*; a hash matches exactly |
| `occurred_at` | dedup queries a date **range** |
| `dedup_fp` | the equality token that replaces the sealed amount |
| `duplicate_of_id`, `review_status` | workflow state, not content |

Everything else rides inside the box: amount, currency, direction, counterparty,
reference, transaction type, and the whole `raw_extracted` blob.

**Wire format (v1):** `sealed = base64(nacl.box(payloadUtf8, nonce, family_pub, eph_priv))`,
`eph_pub` 32 bytes, `nonce` 24 bytes, `enc_v = 1`. Ephemeral-static X25519 +
XSalsa20-Poly1305; the ephemeral secret is destroyed immediately, so the only remaining
route to the shared secret runs through `family_priv`, which never leaves a family device.

`family_id` and `gmail_message_id` are bound **inside** the box. The client supplies its
own `family_id` when opening, so a mismatch raises `staging_identity_mismatch` — moving
ciphertext between rows is detected rather than silently decrypted onto the wrong
transaction.

**`raw_body` is not stored.** Not sealed, not truncated — absent. It is ~20KB of
ciphertext nothing reads back, and the original mail is still in the user's own mailbox,
which is a better archive in every respect including the one that matters: they can
delete it.

`0068`'s CHECK makes the half-sealed state unwritable — either all four envelope columns
are null, or all four are set **and** every sensitive column is null.

### 7. Dedup — a suspicion, never a deletion

One purchase can generate two emails: the bank says "debit 200.000đ", the wallet says
"receipt 200.000đ". They share **no identifier** — different references, timestamps and
wording. Only an amount. So this is a guess.

`dedup_fp = HMAC-SHA256(DEDUP_FP_KEY, amount|direction|currency)`. Keyed, not a plain
hash: VND amounts are low-entropy and an unkeyed hash is a dictionary away from being
readable. Currency is in the message because comparing bare numbers once read 200 USD as
200 VND.

> **`DEDUP_FP_KEY` is COPIED from Apps Script Properties, never regenerated.** Two mints
> give the two transports two key spaces: every cross-transport fingerprint stops
> matching, nothing throws, and the symptom is a queue quietly holding both halves of
> every purchase. `pipeline/direct-dedup.test.js` pins the *format*; only a human can
> ensure the *key*.

A match requires all of: same fingerprint, same member, within `DEDUPE_WINDOW_DAYS` (±3),
and **different canonical providers**. `canonicalProvider` folds accents and strips noise
words longest-first, so "MB Bank", "MBBank" and "MB" are one bank — comparing raw strings
once called two genuine MB transfers cross-source and deleted one.

Same provider at the **byte-identical instant** is the one exception: that is one email
read by both transports; two real transfers never share an exact timestamp.

The result sets `duplicate_of_id`. Nothing is deleted. A missed duplicate costs one tap;
a false one takes a real transaction out of the queue *and its notification with it*.

### 8. Notification

One push per run per mailbox on the poll path, one per row on `/ingest`. It carries
**"something is waiting"** and nothing else — no amount, no merchant. The payload travels
through a third-party service that must not learn what the sealed row says. A failed
notification never fails a run.

### 9. The client half

`fhTxnReviewSheet` (`72-txn-review.js`) fetches pending rows, opens each with the
family's staging key, and hands them to the **CSV import review engine** — so the whole
category cascade (file → history → learned) applies for free.

The description is chosen deliberately:

```js
var tidied = x.memo_display == null ? x.memo : x.memo_display;
var description = tidied || (isPerson ? '' : (r.counterparty || r.source_provider || ''));
```

`memo_display === ''` is a **verdict** ("this memo says nothing"), not a missing value —
so it must fall through to the counterparty rule. `x.memo_display || x.memo` inverts the
fix, resurrecting bank auto-fill like "NGUYEN THU TRANG chuyen tien" in exactly the case
the tidy rejected. A memo-less p2p transfer is left **blank**: its counterparty answers
*who received it*, not *what for*, and a pre-filled wrong answer gets accepted rather
than corrected.

---

## Data flow

```
bank ──▶ Gmail ──┬─▶ watch ──▶ Pub/Sub ──▶ POST /mailbox-sync/push     seconds
                 │
                 └─  (mail sits in the mailbox; we fetch, never receive)
                                            ▲
      pg_cron ──▶ _mailbox_sync_tick() ─────┘                          ≤ 5 min

  worker
    ├─ mailbox_grants        read  → token, member, family, cursor
    ├─ family_keys           read  → staging_pub
    ├─ Gmail API             read  → messages.list / messages.get
    ├─ email_transactions    read  → alreadyStaged  ─┐ union
    ├─ resolved_email_messages read → alreadyStaged ─┘
    ├─ sender_fingerprints   r/w   → template, or learn one
    ├─ Gemini                write → the mail as written  (only when no template)
    ├─ ══════════ SEAL ══════════   plaintext ends here
    ├─ email_transactions    write → sealed row, review_status='pending'
    ├─ parse_failures        write → unreadable / held  (no plaintext)
    ├─ mailbox_grants        write → last_synced_at, backfilled_at   (LAST)
    └─ push-send             write → "something is waiting"

  phone
    ├─ email_transactions       read   → own rows only (0058 RLS)
    ├─ open with family_priv    local  → never leaves the device
    ├─ transactions             write  → amount_enc, note_enc
    └─ resolve_email_transactions      → tombstone, then delete
```

**What crosses a network boundary, and to whom:**

| Destination | Receives | Notes |
|---|---|---|
| Google (Gmail) | our access token | read-only scope, no write verb exists in the code |
| Google (Gemini) | the mail body, as written | only for an unlearned template; consent covers it |
| Supabase | ciphertext + routing metadata | never an amount or a merchant |
| Web Push | a member id and a count | no transaction content |

---

## Schema

### `mailbox_grants` (`0087`, `watch_expires_at` from `0089`) — 15 columns

The OAuth link, its credential, and its cursor.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | `auth.users` |
| `member_id`, `family_id` | uuid | **the destination**, decided at connect |
| `provider`, `email` | text | `google`, the mailbox address |
| `refresh_token_enc` | bytea | AES-256-GCM, `v1:<iv>:<ct>`, app-side key |
| `scopes` | text | granted scopes; a re-consent can narrow them |
| `needs_reauth` | boolean | Google rejected the token; a weekly event under Testing status |
| `history_id` | text | Gmail cursor (unused by the date-window path) |
| `last_synced_at` | timestamptz | **what `windowDays` measures from** |
| `backfilled_at` | timestamptz | null ⇒ next run is a 90-day backfill |
| `watch_expires_at` | timestamptz | ms → timestamptz; null = no watch, poll only |
| `connected_at`, `updated_at` | timestamptz | |

Unique on `(user_id, provider)`. **`history_id` and `backfilled_at` are deliberately not
touched on conflict** — overwriting a live cursor skips every message between it and now.

### `email_transactions` — 22 columns, shared with forwarding

Clear: `gmail_message_id` (UNIQUE), `member_id`, `source_provider`, `occurred_at`,
`dedup_fp`, `duplicate_of_id`, `review_status`, `promoted_transaction_id`, `created_at`.

Envelope: `sealed`, `eph_pub`, `nonce`, `enc_v` — all four or none (`0068` CHECK).

Must be NULL when sealed: `amount`, `currency`, `direction`, `counterparty`,
`reference_number`, `transaction_type`, `raw_extracted`, `raw_body`.

### `resolved_email_messages` (`0090`) — 3 columns

`(member_id, gmail_message_id)` primary key, `resolved_at`. Nothing else, by design.

### `sender_fingerprints` — the parse cache

`(sender_address, subject_template)` → `is_transaction_source`, `transaction_type`,
`extraction_regex`. **Shared with the forwarding pipeline**: a template learned by one
transport is applied by the other.

### `family_keys.staging_pub` / `staging_priv_enc`

The staging keypair. `staging_pub` is readable by the worker; `staging_priv_enc` is
wrapped by the family DEK and only ever opened on a device.

### Access control

| Object | anon | authenticated | service_role |
|---|---|---|---|
| `mailbox_grants` | — | SELECT **own rows, column-limited** (no `refresh_token_enc`) | full |
| `email_transactions` | — | own rows (`0058`) | full |
| `resolved_email_messages` | — | SELECT own | SELECT/INSERT/DELETE |
| `grant_mailbox_access()` | — | — | EXECUTE |
| `disconnect_my_mailbox()` | — | EXECUTE | — |
| `resolve_email_transactions()` | — | EXECUTE | — |
| `_mailbox_sync_tick()` | — | — | (definer, revoked from all) |

The app reads its own connection status **straight from the table**: `0087` pairs a
select policy with a column-level grant that omits the credential, so the token is not
reachable from a browser even by asking for it.

Every policy uses the initplan form `(select auth.uid())` per `0022`.

---

## Configuration

| Secret | Purpose |
|---|---|
| `MAILBOX_TOKEN_KEY` | AES-256-GCM key for refresh tokens |
| `MAILBOX_STATE_SECRET` | HMAC key for the OAuth state |
| `MAILBOX_SYNC_SECRET` | shared secret for `/`, `/push`, `/ingest` — **must equal the vault's `mailbox_sync_secret`** |
| `DEDUP_FP_KEY` | **copied from Apps Script**, never generated |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | the OAuth client; redirect matched byte-for-byte |
| `GEMINI_API_KEY` | the parse fallback; unset ⇒ unlearned templates are unreadable |
| `APP_ORIGIN` | where the callback bounces back to |
| `GMAIL_PUSH_TOPIC` | **unset ⇒ poll only.** Setting it makes us register a watch |
| `SENDER_AUTH_ENFORCE` | `true` ⇒ reject on DKIM failure. Off by default |

Vault (out of band, never committed): `mailbox_sync_url`, `mailbox_sync_secret`.
`_mailbox_sync_tick()` returns silently until both exist.

> **⚠️ One watch per mailbox, and the last caller wins — silently.** If another system
> watches the same mailbox on a different topic, whoever called `watch()` last receives
> the notifications and the other goes quiet with no error anywhere. Leave
> `GMAIL_PUSH_TOPIC` unset when another pipeline owns the watch.

---

## Failure modes

| Symptom | Cause | Detection |
|---|---|---|
| Queue empty, no error | family has no `staging_pub` | run status `held: no_staging_pub`; `parse_failures` |
| Transactions stop appearing | watch lapsed **and** poll not running | `watch_expires_at` in the past; cron history |
| Every tick 403s | function `MAILBOX_SYNC_SECRET` ≠ vault value | compare hashes; nothing surfaces in the app |
| Duplicates from both transports | `DEDUP_FP_KEY` regenerated | fingerprints stop matching; no error |
| Already-promoted mail returns | pre-`0090` re-read of an old window | fixed; `resolved_email_messages` |
| Mail from a bank never appears | domain absent from `senders.mjs` | **never fetched** — cannot appear as skipped |
| Wrong family's key | `members` lookup without `order by` | `member_moved` hold, or silent mis-seal pre-`0087` |
| Reconnect prompt weekly | 7-day refresh tokens under Testing status | `needs_reauth = true`; expected, not a bug |

The characteristic failure of this pipeline is **silence**. Nearly every fault returns
"no transactions", which is also what an empty mailbox looks like.

---

## Testing

`npm test` — 33 files, discovered not listed.

| File | Proves |
|---|---|
| `direct-flow.test.js` | connect → read → parse → seal → save → **the real client opener reads the amount back** |
| `direct-own-mailbox.test.js` | every Gmail call is `users/me` with *that grant's* token; no `to:`/`+tag`; read-only scope |
| `direct-resolved-messages.test.js` | a promoted message stays gone; member-scoped; throws rather than failing open |
| `direct-ingest.test.js` | the external-reader path: validation, holds recorded, at-least-once delivery |
| `direct-persist-contract.test.js` | real Python `build_payload` → real sealer → real client opener |
| `direct-dedup.test.js` | fingerprint parity with the Apps Script, byte for byte |
| `direct-templates.test.js` | re-slices the `.gs` at test time and runs both copies over one body |
| `direct-sealed-box.test.js` | envelope parity + identity binding |

---

## Current State

**Live:** connect flow, both triggers, the full read → parse → seal → stage path, 157
sender domains, learned templates, dedup, review, promotion, tombstoning, notifications,
watch auto-renewal.

**Not live:**

| Thing | Blocked on |
|---|---|
| `persist.py` bridge | Lives in the backend team's deployment source; built, 445 of their tests green, unmerged on `claude/email-reading-integration-ddwqd2` pending their review. Would give this ledger their parser's validation, wider sender list and auto-categories. |
| `category_hint` consumption | Staged rows carry it; the review screen ignores it. Wiring it would auto-fill categories. |
| Sender-auth enforcement | Verdict recorded on every row; enforcement earns its place on observed data. |
| **A second mailbox** | `mailbox_grants` is `UNIQUE (user_id, provider)`, so connecting another Google account **replaces** the first rather than joining it. Deliberate from when a mailbox could only mean one thing; now the main thing between us and "work mail to the family ledger, personal mail to mine". Widening the index to `(user_id, provider, email)` is most of it — the worker already loops over grants and resolves each independently — plus a list instead of a single status screen. Stated in the UI meanwhile, on the status screen and in the change-address sheet, because "Đổi" replacing a mailbox is not something anyone would guess. |

---

## Open questions

**Internal transfers still double-count.** Two mails, opposite directions, one movement
of money. Every dedup rule here matches on *sameness*; a transfer pair is defined by
*oppositeness*. Blocking detail, shared with the forwarding pipeline: **nothing records
which bank accounts are yours.**

**Provider naming is split.** `source_provider` comes from
`read.extraction.source_provider || sender.provider`, so the *model's* label wins when it
supplies one — producing "MBBank" and "MB" for one bank. `canonicalProvider` absorbs it
at dedup time, but the review screen shows the raw string.

**Auto-routing one mailbox to both ledgers is closer than it looks.** The
DESTINATION is already per-row — `csvRowScope` is evaluated per candidate at
review — so one mailbox can already feed both. What is fixed per-grant is only
which key protects a row *in transit*, and personal-by-default makes that
survivable: a personal-sealed row can be promoted outward, never the reverse.
So the remaining work is a rule engine, not a crypto change. The signals are
already staged (merchant, amount, direction, `category_hint`, `account_masked`),
and the natural shape is the one categories already use — learn from what the
person actually does rather than asking them to configure rules.

**`account_masked` is the strongest routing signal we do not use.** Most
households split by ACCOUNT, not by merchant — "anything on the ...4412 card is
mine" is one rule where merchant rules would be dozens. It is staged on every
row. What is missing is any record of WHICH accounts are yours, which is the
same gap blocking internal-transfer detection, so the two would pay for it
together.

**Metadata is not sealed, and metadata is information.** Row counts and `occurred_at` are
readable by anyone with database access: how many transactions in May, an unusually busy
Tuesday. Not what was bought. `occurred_at` must stay clear because dedup queries a range
— a deliberate trade, recorded here so it stays deliberate.
