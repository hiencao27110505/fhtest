# mailbox-sync — direct mailbox read

The second transport for the bank-email pipeline. Forwarding (`pipeline/bank-email-pipeline.gs`)
has the user point Gmail at an alias we own; this one reads the user's **own** mailbox under an
OAuth grant. Everything downstream is unchanged — both transports stage sealed rows into
`email_transactions`, and the same review screen promotes them into the ledger.

> **Status.** The staging spine is built and tested (`pipeline/direct-*.test.js`, 114 assertions).
> The Gmail transport, the OAuth callback and the worker entry point are **not built yet** —
> see [What is left](#what-is-left).

---

## Why this exists alongside `earthy/`

`earthy/` is the backend team's Gmail pipeline: OAuth on Cloud Run, three Python Cloud Functions,
Gmail push over Pub/Sub, learned parse specs, and a Telegram announcement at the end. It reads
real mailboxes and parses real Vietnamese bank mail correctly. What it does not do is persist:
`transaction-parser/main.py` ends at `# TODO: persist`.

Rather than reach into that pipeline and add a write, this is our own path, on our own stack,
with its own tables and its own lifecycle. The two run side by side without either having to know
the other exists. Three things made that the right call rather than a duplication:

- **Only one Gmail `watch()` may exist per mailbox.** A second `watch()` call silently replaces the
  first one's topic. Two push-based pipelines therefore *cannot* both observe one mailbox — the
  last to register wins and the other goes quiet with no error anywhere. This worker **polls**
  instead, which conflicts with nothing. `OAUTH-DIRECT-READ.md` §3.4 reached the same conclusion on
  simplicity grounds alone.
- **The sealing key never leaves our stack.** Rows have to be sealed to `family_keys.staging_pub`
  by whatever holds the plaintext last. Doing that here keeps the plaintext boundary inside the
  repo that owns the encryption design, rather than spanning two teams and two clouds.
- **Ownership is a FamilyHub concept.** `connected_accounts` (0070) answers "which Google account
  did this `auth.users` row link". It cannot answer which *member*, and therefore which family, and
  therefore which key — which is the only question that has to be settled before a row may be
  written at all.

## The shape

```
pg_cron ──▶ net.http_post ──▶ mailbox-sync
                                 │
                                 ├─ mailbox_grants: due mailboxes (0084)
                                 ├─ refresh token ──▶ Google ──▶ access token
                                 ├─ messages.list q=from:(bank domains) since cursor
                                 ├─ parse (mask ▸ extract ▸ validate)
                                 ├─ identity.mjs   grant ──▶ member, family, staging_pub
                                 ├─ stage.mjs      seal ▸ fingerprint ▸ dedup
                                 └─ email_transactions   (sealed, pending)
                                          │
                                          ▼
                                    the review screen, unchanged
```

## What is built

| File | What it owns |
|---|---|
| `lib/sealed-box.mjs` | The seal. Byte-compatible with `pipeline/sealed-box.gs`, with a real CSPRNG instead of the Apps Script HMAC-counter DRBG. |
| `lib/identity.mjs` | Grant → `{memberId, familyId, stagingPub}`, and the five states that are a HOLD rather than an error. |
| `lib/dedup.mjs` | `dedup_fp` and the cross-source rule, byte-identical to the forwarding pipeline so the two transports dedup against each other. |
| `lib/stage.mjs` | The row that reaches the table: clear vs sealed split, seal-or-hold, `raw_body` never stored. |

Every module takes its dependencies as arguments — `nacl`, the CSPRNG, WebCrypto, the database.
That is not ceremony: it is what lets the Node test runner exercise the same bytes Deno will run,
and it puts the randomness source in plain sight in the one file where it decides whether the
encryption is real.

## What is left

1. **Gmail transport** — token refresh, `messages.list` with the sender query, `messages.get`,
   HTML→text. The cursor lives in `mailbox_grants.history_id` and is advanced **last**, after the
   window's rows are staged, so a crash replays rather than skips.
2. **OAuth callback** — exchange the code with `access_type=offline` and `prompt=consent`, take the
   address from Google's profile call (never from `login_hint`), encrypt the refresh token, and call
   `grant_mailbox_access()`.
3. **Extraction** — masking, then our own extraction templates, then the model. Masking is
   unconditional and gets *more* important here, not less: this transport touches mail the user
   never hand-picked.
4. **DKIM** — `Authentication-Results` is on the message Gmail hands over. Under forwarding a
   phishing mail had to be forwarded to us first; here it is read straight out of the inbox it
   landed in. `OAUTH-DIRECT-READ.md` §4.3.
5. **The worker entry point + the pg_cron schedule.**
6. **Notification** — `push-send` with kind `txn_review`. It carries no amount and no merchant, and
   `review-notify.test.js` asserts that no copy variant can.
7. **Backfill on first connect** — `backfilled_at` in 0084 exists for it. This is the real product
   upside of direct read: "here is your last six months" rather than "we start from now".

## Configuration

| Secret | Why |
|---|---|
| `DEDUP_FP_KEY` | **Copied from Apps Script Properties, never minted here.** Two independent mints produce two key spaces and cross-transport dedup stops working with nothing anywhere throwing. It stays out of Supabase either way — that split is what stops a database dump being run against a VND dictionary. |
| `MAILBOX_TOKEN_KEY` | Encrypts `refresh_token_enc` before it reaches Postgres. A refresh token is standing read access to a whole mailbox. |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | The `FHTest Web` client in the `fhtest` project. The client that issues a code must be the one that exchanges it. |

## Reading order

`pipeline/SEALED-STAGING-DESIGN.md` for the construction and its recorded consequences,
`docs/features/bank-email-pipeline.md` for the pipeline this one joins,
`pipeline/OAUTH-DIRECT-READ.md` for why direct read was worth reversing the original decision for.
