# Direct mailbox read

The second transport for the bank-email pipeline. Forwarding (`pipeline/bank-email-pipeline.gs`)
has the user point Gmail at an alias we own; this one reads the user's **own** mailbox under an
OAuth grant. Everything downstream is unchanged — both transports stage sealed rows into
`email_transactions`, and the same review screen promotes them into the ledger.

> **Status.** Built end to end and tested: connect → read → parse → seal → save → the app opens it.
> `pipeline/direct-flow.test.js` drives the whole path with fake Google and Gemini, real crypto, a
> real bank email, and the actual client opener reading the amount back. **Not yet deployed** — see
> [Going live](#going-live).

```
Settings → Tự động ghi giao dịch
   │
   ├─ consent sheet (bank_email, v4)         ← required before anything is collected
   ├─ GET  mailbox-connect/authorize         → Google's consent screen
   └─ GET  mailbox-connect/callback          → mailbox_grants (token encrypted)
                                                     │
pg_cron */5 ──▶ _mailbox_sync_tick() ──▶ mailbox-sync
                                                     │
        ┌────────────────────────────────────────────┘
        ├─ due grants, oldest poll first
        ├─ refresh token ─▶ Google ─▶ access token
        ├─ messages.list  q=(from:<banks and wallets>) newer_than:2d
        ├─ already staged?  one query for the whole window
        ├─ sender allowlist + DKIM verdict
        ├─ parse:  stored template (no model)  else  Gemini, then learn one
        ├─ identity: grant ─▶ member, family, staging_pub
        ├─ seal ▸ fingerprint ▸ dedup
        ├─ insert  (sealed, pending)
        ├─ push:  "something is waiting", no amount, no merchant
        └─ advance the cursor  ← LAST, and only if the window was handled
```

---

## Why this exists alongside `earthy/`

`earthy/` is the backend team's Gmail pipeline: OAuth on Cloud Run, three Python Cloud Functions,
Gmail push over Pub/Sub, learned parse specs, and a Telegram announcement at the end. It reads real
mailboxes and parses real Vietnamese bank mail correctly. What it does not do is persist:
`transaction-parser/main.py` ends at `# TODO: persist`.

Rather than reach into that pipeline and add a write, this is our own path, on our own stack, with
its own tables and its own lifecycle. Three things made that the right call rather than duplication:

- **Only one Gmail `watch()` may exist per mailbox.** A second `watch()` call silently replaces the
  first one's topic, so two push-based pipelines *cannot* both observe one mailbox — the loser goes
  quiet with no error anywhere. This worker **polls**, which conflicts with nothing, needs no
  Pub/Sub topic, and has no 7-day watch expiry to renew. `OAUTH-DIRECT-READ.md` §3.4 reached the
  same conclusion on simplicity grounds alone.
- **The sealing key never leaves our stack.** Rows must be sealed to `family_keys.staging_pub` by
  whatever holds the plaintext last, and that boundary belongs inside the repo that owns the
  encryption design rather than spanning two teams and two clouds.
- **Ownership is a FamilyHub concept.** `connected_accounts` (0070) answers "which Google account
  did this `auth.users` row link". It cannot answer which *member*, therefore which family,
  therefore which key — the only question that has to be settled before a row may be written.

## Layout

Everything substantive is in `../_shared/mailbox/*.mjs`, so the same bytes the Edge Functions run are
the bytes the Node test runner exercises. The two `index.ts` files are transport only.

| File | What it owns |
|---|---|
| `senders.mjs` | Which senders are read at all, and whether one is a bank or a wallet. Also builds the Gmail query — **the one place that decides we do not fetch the whole mailbox**. |
| `mailtext.mjs` | HTML → text, keeping the line structure the fields sit in. |
| `gmail.mjs` | Access token, `messages.list`, `messages.get`, MIME walk, DKIM verdict. |
| `templates.mjs` | Verbatim copy of the .gs extraction-template slice. Parses a repeat sender with no model at all. |
| `memo.mjs` | Verbatim copy of the .gs memo-tidying slice. |
| `llm.mjs` | Gemini, the shared prompt and schema, the mail as written. |
| `extract.mjs` | Template first, model second, learn a template from the model's answer. |
| `identity.mjs` | Grant → `{memberId, familyId, stagingPub}`, and the five states that HOLD. |
| `sealed-box.mjs` | The seal. Byte-compatible with `pipeline/sealed-box.gs`, real CSPRNG. |
| `dedup.mjs` | `dedup_fp` and the cross-source rule, identical to the forwarding pipeline's. |
| `stage.mjs` | The row that reaches the table: clear/sealed split, seal-or-hold, no `raw_body`. |
| `oauth-state.mjs`, `token-crypto.mjs`, `google-oauth.mjs` | The connect flow's signing, encryption and provider calls. |
| `db.mjs` | Every read and write, in one place, as `service_role`. |
| `worker.mjs` | The run loop. Pure, dependencies injected. |

Every module takes its dependencies as arguments — `nacl`, the CSPRNG, WebCrypto, the database.
That is not ceremony: it is what makes a full end-to-end test possible, and it puts the randomness
source in plain sight in the one file where it decides whether the encryption is real.

## The two rules everything else follows from

**1. The cursor is written LAST, and only if the window was handled.** A crash, a rate-limited
model, a family with no staging key: all of them leave `last_synced_at` where it was, so the next
poll reads the same window again. Advancing first would skip mail *silently*, and silence is this
pipeline's characteristic failure — there is no error page for a transaction that never appeared.
That makes re-reading normal rather than exceptional, which is why `alreadyStaged` is asked once per
window before anything is fetched and why `gmail_message_id` is UNIQUE underneath it.

**2. Seal or hold. There is no third option.** No config flag, no plaintext fallback, no code path
from "could not seal" to a readable insert. A hold costs one wasted poll and heals itself the moment
a family device mints a staging key.

## Going live

Five steps, in this order. Steps 1–3 can be done ahead of time; nothing reads a mailbox until 5.

**1. Apply the migrations.**

```
0084_mailbox_direct_read.sql     mailbox_grants, grant_mailbox_access(), disconnect_my_mailbox()
0085_mailbox_sync_schedule.sql   _mailbox_sync_tick() + the pg_cron job
```

**2. Register the OAuth client.** In the `fhtest` GCP project, on the `FHTest Web` client, add the
callback as an authorized redirect URI — **byte for byte**, Google matches it literally:

```
https://<project-ref>.supabase.co/functions/v1/mailbox-connect/callback
```

`gmail.readonly` is a restricted scope. While the app is in **Testing** publishing status every
tester must be listed under *Test users*, and **refresh tokens expire after 7 days** — a weekly
reconnect is routine here, not an outage. `needs_reauth` is what surfaces it.

**3. Set the secrets.**

```sh
supabase secrets set \
  MAILBOX_TOKEN_KEY="$(openssl rand -base64 32)" \
  MAILBOX_STATE_SECRET="$(openssl rand -base64 32)" \
  MAILBOX_SYNC_SECRET="$(openssl rand -base64 32)" \
  DEDUP_FP_KEY="<COPY from Apps Script Properties>" \
  GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
  GOOGLE_OAUTH_REDIRECT_URI="https://<ref>.supabase.co/functions/v1/mailbox-connect/callback" \
  GEMINI_API_KEY=... \
  APP_ORIGIN="https://fhtest-opal.vercel.app"
```

> **`DEDUP_FP_KEY` is COPIED, never generated here.** The Apps Script self-mints it when its
> property is empty, which is correct while it is the only implementation. A second mint gives the
> two transports two key spaces: every cross-transport fingerprint stops matching, nothing throws,
> and the symptom is a queue that quietly holds both halves of every purchase.
> `pipeline/direct-dedup.test.js` compares both implementations so the *format* cannot drift, but
> only you can make sure it is the same key.

**4. Deploy.** The sync function is invoked by pg_cron with a shared secret, and the connect
function is called by a browser coming back from Google. Neither can present a user JWT:

```sh
supabase functions deploy mailbox-sync    --no-verify-jwt
supabase functions deploy mailbox-connect --no-verify-jwt
```

**5. Point the cron at it**, out of band so neither value is committed:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/mailbox-sync', 'mailbox_sync_url');
select vault.create_secret('<the MAILBOX_SYNC_SECRET from step 3>',              'mailbox_sync_secret');
```

Until both exist, `_mailbox_sync_tick()` returns silently rather than erroring every five minutes.

**Smoke test** without waiting for the schedule:

```sh
curl -X POST "https://<ref>.supabase.co/functions/v1/mailbox-sync" \
     -H "x-sync-secret: <MAILBOX_SYNC_SECRET>"
# → {"polled":1,"modelCalls":1,"results":[{"status":"ok","fetched":3,"staged":1,...}]}
```

## Reading a run

Every mailbox reports a status, and the ordinary ones are not errors:

| status | means | what to do |
|---|---|---|
| `ok` | polled and staged | nothing |
| `held` + `reason` | see below | usually nothing; it heals itself |
| `needs_reauth` | Google rejected the refresh token | the app prompts; a weekly event in Testing status |
| `token_unreadable` | `MAILBOX_TOKEN_KEY` changed or the row is corrupt | the user reconnects |
| `error` | something unexpected | the cursor did not move; read `detail` |

Hold reasons: `no_staging_pub` (the family has never unlocked a device — the commonest one, and it
clears itself), `no_member` / `member_archived` / `member_moved` (ownership changed since connect),
`needs_reauth`.

**A held mailbox stages nothing and advances nothing**, so it costs one poll and loses no mail.

## What is deliberately not built

- **`transaction_type` is inferred from the sender**, bank or not, and the person corrects it at
  review. Nothing in a bank notice states it.
- **Internal transfers still double-count.** Two mails, opposite directions, one movement of money.
  Every dedup rule here matches on *sameness*; a transfer pair is defined by *oppositeness*. The fix
  is designed and client-side by necessity — see `docs/features/personal-ledger.md`.
- **Sender-auth enforcement is off by default** (`SENDER_AUTH_ENFORCE=true` turns it on). The
  verdict is recorded on every row first, because some banks legitimately sign with an ESP domain
  and a check that can reject real transactions should earn enforcement on observed data.

## Reading order

`pipeline/SEALED-STAGING-DESIGN.md` for the construction, `docs/features/bank-email-pipeline.md` for
the pipeline this one joins, `pipeline/OAUTH-DIRECT-READ.md` for why direct read was worth reversing
the original decision for.
