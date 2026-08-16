# Bank-email forwarding — continue-here brief

Written 2026-08-16 at a deliberate stopping point. For a session picking this up
cold with none of the context. Read this, then `pipeline/README.md` (how it
works) and `pipeline/SEALED-STAGING-DESIGN.md` (what the promise is).

**Status: PAUSED, on purpose. It works, it is running, and it is closed to new
users.** Understanding *why* is the first thing, because the obvious first move —
"let more people in" — is the one thing you must not do yet.

---

## 0. Get current before you touch anything

Trang's checkout was left **4+ commits behind** with three loose files, all of
which are redundant with `origin/main`:

```
git -C ~/Desktop/Projects/fhtest fetch origin
git -C ~/Desktop/Projects/fhtest status          # expect: 55-push.js, 0067, bank-email-pipeline.gs
```

- `pipeline/bank-email-pipeline.gs` — byte-identical to origin. Discard.
- `supabase/migrations/0067_mailbox_beta_gate.sql` — identical to origin. Discard.
- `src/js-data/55-push.js` — **older** than origin (missing `expense_bulk` and the
  combined reaction/expense_new/memory_new route). Discard; origin's has
  everything it does and more.

Then `git pull`. Do not merge these forward — you will silently revert routing.

**The OAuth direct-read spike is NOT on `main` — it lives on the branch
`origin/bank-email-oauth`** (tip `2cafc04`, branched off `9c09c23`), and has been
handed to a backend dev. It holds `api/gmail-{connect,callback,sync}.js`,
`pipeline/lib/{gmail,extract,ingest,llm,oauth-state,sealed-box}.js`,
`privacy.html`, `0066_mailbox_oauth.sql`, and its own tests. Those files vanishing
from the working tree was that branch being cleaned up, not work being lost.

Two things follow. **It carries its own copy of `0065_email_transactions_sealed.sql`**
— `main` has one too (from this thread), so check they agree before applying
either. And **that branch predates the beta gate**: it does not have `0067`,
`73-mailbox-gate.js`, or the gated Settings rows. If direct read is ever merged
forward, the gate must survive the merge — it is the thing standing between us
and collecting more mail we cannot yet keep private.

Background for that path: `pipeline/OAUTH-DIRECT-READ.md` and
`OAUTH-COMPLIANCE-FINDINGS.md` (CASA re-priced at ~$540/yr; the live risk is
Google's Appropriate Access approval, not cost).

**`package.json` merge hazard:** two sessions edited the `test` script line.
Union the lists, never take one whole — `tools/mailbox-gate.test.js` is the one
that proves the gate is fail-closed, and it drops out silently if you take the
wrong side.

---

## 1. What this is, in one paragraph

A user sets a Gmail filter forwarding their bank's mail to a shared inbox with a
`+tag` unique to them. A Google Apps Script (`pipeline/bank-email-pipeline.gs`,
1-minute trigger) searches that inbox, checks the sender is really the bank
(DKIM + `known_provider_domains`), masks every real value, sends the masked text
to Gemini for extraction, unmasks the result, routes it to a member via the
`+tag` → `mailbox_connections` → `members.family_id`, and writes a **staged**
row. A human then reviews every row in the app before it becomes a real expense.
Nothing is ever auto-imported.

Two invariants that are not negotiable and are easy to break by accident:

1. **Masking before any LLM call.** No real amounts, names, account numbers,
   references or emails reach Gemini, ever. `maskForSharing` / `unmaskExtraction`.
2. **Every row is human-reviewed.** The machine gets amount and date right but
   cannot know that *"NGUYEN THU TRANG chuyen tien"* was lunch with your mum.

---

## 2. Why it is paused — read before reopening

We tell users nobody but their family can read their data. **On this path that
is not true yet**, in two specific ways:

- **Staged rows are written in plaintext.** `0065` adds the sealed columns and
  `72-txn-review.js` has branched on `row.sealed` since it was written — but the
  columns have never existed and `sealForFamily()` has never been called.
- **The shared inbox is a permanent plaintext archive.** The pipeline labels mail
  and never deletes it. Every bank email anyone has ever forwarded is still
  sitting in a mailbox an operator can read.

Collecting a stranger's bank mail under a promise we are not keeping is the part
that cannot be undone later. So `0067_mailbox_beta_gate` (**APPLIED to prod**)
stops new mailboxes being issued: `get_or_create_mailbox_alias` raises
`mailbox_not_in_beta` unless the caller is in `mailbox_beta_access`, and both
Settings rows hide behind `can_use_mailbox()` (`73-mailbox-gate.js`).

**It revokes nobody.** Routing reads `mailbox_connections`, not the allowlist, so
the four existing connections keep flowing — and all four were seeded into the
allowlist, **including at least one person who is not a founder**. Their mail is
still being ingested in plaintext right now.

> **Undecided, and it is a product call, not a schema one:** grandfather those
> four, or pause them. Pausing means
> `delete from mailbox_connections where forwarding_alias = '<tag>';` — routing
> then holds their mail unprocessed (`ROUTING_GRACE_DAYS = 14`) and nothing new
> enters the DB. **Tell them first**: their forwarding rule keeps sending mail to
> an inbox that no longer routes it, which is worse than an honest "we've paused
> this while we finish encryption."

---

## 3. What to do next, in the order that actually reduces risk

Not the order that is most interesting. This order.

1. **Apply `0065_email_transactions_sealed.sql`** (written, committed, **NOT
   applied**). Additive and safe: new columns are nullable, and it drops NOT NULL
   on amount/currency/direction/raw_body/raw_extracted so a sealed row can leave
   them empty. There is a CHECK making half-sealed rows impossible — ciphertext
   written *and* plaintext amount left behind is the failure that would make the
   whole thing pointless, silently.

2. **Wire `sealForFamily()` into the pipeline and stop writing `raw_body` clear.**
   `pipeline/sealed-box.gs` is the seal side and is already tested against a
   published vector shared with the browser implementation. Put it behind a
   Script Property so it lands switched off and gets flipped deliberately.
   - **Known consequence, flagged not fixed:** server-side dedup dies with
     sealing, because `findDuplicate()` queries `amount=eq.X`. Decide what
     replaces it *before* switching on, not after.

3. **Inbox retention — delete forwarded mail after staging.** This is the single
   biggest reduction available and nothing blocks it. It turns the mailbox from
   an archive back into a transit point. It is also the likely fix for the
   **Supabase free-tier bandwidth overage** already hit: the probable driver is
   `raw_body` storing full email HTML at roughly 20KB/message, which
   `SEALED-STAGING-DESIGN.md` §7 says should be deleted at promotion anyway.

4. **`supabase functions deploy push-send`** — still returning **HTTP 401**, and
   it is the only thing blocking review notifications. The Apps Script side
   (`notifyStagedReviews`, `queueReviewNotice`) and the client tap route
   (`nav.k === 'txn_review'` in `55-push.js`) are both on main and working; the
   notification simply never sends. Trang's Supabase account lacks the org
   privileges to authorize the MCP connector, so this needs her partner
   (`hiencao27110505`) or a role change. The dashboard's Edge Functions section
   may be a way in.

Only after 1–3 is reopening the beta an honest thing to do.

---

## 4. Landmines

Things that have already cost time. Each of these was learned the hard way.

**Deployment is hand-paste.** `bank-email-pipeline.gs` is copied into the Apps
Script editor by a human. There is no deploy step and no way to tell from the
repo what is live. `PIPELINE_VERSION` (currently `'2026-08-15-a'`) is logged
every run and is **the only reliable signal that your paste took**. Bump it with
every change and check the log before debugging anything else — twice, a "bug"
was simply old code still running.

**Gmail search semantics are not what you would guess.** Auto-forwarding
**preserves the original `To:` header** (the user's own address), so `to:<alias>`
does *not* match auto-forwarded mail. A hand-forward *does* put the alias in
`To:`. That asymmetry is why `buildInboxQuery()` carries both `to:<alias>` terms
and a `(from:<bank domains>) newer_than:7d` term. `pipeline/README.md` §"Gmail's
actual behaviour" documents this; trust it over intuition.

**`To:` is typed text and can name anyone.** It is not proof of anything. The
`+tag` exists precisely because the routing key must be something an attacker has
to *obtain*, not merely *know*.

**Sender dispatch is by sender, not by label.** An earlier fix made hand-forwards
visible and then fed them to the forwarding-confirmation handler. `checkSenderAuthenticity`
now detects `senderAddr === ownerAddr && !fwd` → `forward_mode` /
`forwarder:'manual'`. Do not "simplify" this back.

**DKIM proves a domain signed it, not that it is really the bank.** A lookalike
domain signs perfectly for itself. `known_provider_domains` (migration 0050) is
the actual allowlist.

**`EXTRACTION_LOGIC_VERSION` is a self-invalidator.** Currently `4`. Version 3
silently dropped the `memo` field from derived templates — the field carrying
*why* money moved. If you change what a template extracts, bump it, or old
templates keep producing the old shape forever.

**Message-level idempotency exists now** (`isAlreadyStaged(gmailMessageId)`), so
reprocessing a thread is cheap. The `-label:txn/processed` exclusion in the query
was a workaround from before that existed and can probably be loosened —
**worth doing**, because a thread whose later messages arrive after the label is
applied currently has its new messages hidden forever.

---

## 5. File map

| Thing | Where |
|---|---|
| The pipeline itself | `pipeline/bank-email-pipeline.gs` (hand-pasted) |
| How it works, and Gmail's real behaviour | `pipeline/README.md` |
| The privacy promise, precisely stated | `pipeline/SEALED-STAGING-DESIGN.md` |
| Gemini prompt + output schema | `pipeline/extraction.md` |
| Seal side (Apps Script) | `pipeline/sealed-box.gs` |
| Open side (browser) | `src/js-data/18-staging-keys.js` |
| Review screen | `src/js-data/72-txn-review.js` |
| Mailbox connect UI | `src/js-data/71-mailbox-ui.js` |
| Menu gate (fail-closed) | `src/js-data/73-mailbox-gate.js` |
| Push tap route | `src/js-data/55-push.js` (`nav.k === 'txn_review'`) |
| Notification sender | `supabase/functions/push-send/index.ts` |
| Cross-session channel | `AGENT_SYNC.md` |

**Tests** (`npm test`, all executable, no mocks of the code under test — real
functions are extracted from the `.gs` by name so they fail if the source
changes): `sender-auth`, `forwarding-confirm`, `extraction-template`,
`memo-tidy`, `review-notify`, `resilience`, `sealed-box`,
`client-reference-staging-keys`, `bulk-promote`, `mailbox-gate`.

`memo-tidy.test.js` is worth reading before touching extraction: every string in
it is verbatim from a real bank email, and the case that matters is the memo that
*looks* like prose and says nothing. Those must come back empty, because a
pre-filled wrong answer is worse than a blank field.

### Migration numbers

| Number | What | State |
|---|---|---|
| `0065_email_transactions_sealed` | sealed columns | on `main` **and** on `bank-email-oauth`, **NOT applied** |
| `0066_mailbox_oauth` | OAuth direct read | on `bank-email-oauth` only, **NOT applied** |
| `0067_mailbox_beta_gate` | allowlist | on `main`, **APPLIED + ledgered** |

**Next free is `0068`.** Verify with
`git ls-tree origin/main supabase/migrations/` rather than trusting this table —
this range has collided five times. Ledger applied migrations by hand:
`insert into supabase_migrations.schema_migrations (version, name) values (...)
on conflict do nothing;`

---

## 6. Open questions nobody has answered

These are genuinely unknown, not just unwritten. Two are cheap to settle and
would change what you do.

1. **`select forwarding_alias, personal_email, verified from mailbox_connections;`**
   — asked several times, never run. If `personal_email` is null (suspected),
   then the forwarder-identity check passes for **any** sender, which is a real
   hole in the auth story. Run this first.

2. **Trang's own forwarding points at the bare inbox, not her `+tag`**, so her
   transactions never route. Unfixed. It also means she is not dogfooding the
   path she thinks she is.

3. **Yesterday's VCB thread `19ffec739d98cad5`** (REVI 75,000 / AEON 576,820)
   probably has the same hidden-later-message hole described in §4. Worth
   confirming once the label exclusion is loosened.

4. **Vietnam PDPL (Law 91/2025/QH15)** — transaction history is sensitive
   personal data; a DPIA is filed with A05 within 60 days. This applies to the
   product as it already exists, not only to future work. Nobody has started it.

---

## 7. Coordination

Two Claude sessions share this repo, plus a human partner (`hiencao27110505`)
who owns **encryption and auth**. Cross-session decisions go in `AGENT_SYNC.md` —
dated entry under **Open**, moved to **Resolved** by whoever answers. Read it
first; the 2026-08-16 entry is the most recent state and supersedes the
2026-08-14 one's migration numbering, which is stale.

Nothing here is currently blocked on the partner except `push-send` (§3.4).
