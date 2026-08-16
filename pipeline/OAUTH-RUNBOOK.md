# Direct mailbox read — runbook

Everything a human has to do that code cannot. The code is written and tested;
what is left needs a browser, a Google account, and a card.

Read `OAUTH-COMPLIANCE-FINDINGS.md` first if you have not — it is why the
sequence below is in this order.

**Nothing here touches the forwarding pipeline.** It keeps running throughout,
and should keep running until direct read has staged rows end to end.

---

## Step 1 — the decisive experiment (do this before anything else)

**Question:** can a *published but unverified* app actually get `gmail.readonly`,
and do its refresh tokens survive past 7 days?

If yes, a 100-user private beta can run with no CASA, no assessment invoice, and
no six-week wait, and everything else can proceed immediately. If no, nothing
ships until verification completes and the whole plan is on a ~6-week clock.

**There is a tool for this — you do not have to click through the OAuth
Playground:**

```sh
# put GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local first
node tools/gmail-oauth-probe.js connect   # one click, prints exactly what Google granted
node tools/gmail-oauth-probe.js check     # run again on day 8 — THE answer
node tools/gmail-oauth-probe.js read      # optional: prove a real bank email parses,
                                          # and eyeball the masking on your own mail
```

`connect` tells you immediately whether consent completes and whether a refresh
token was issued, then prints the exact date to run `check`. Nothing is written
to Supabase, the app, or the forwarding pipeline — the token goes to a
gitignored `.gmail-probe.json` and nowhere else. `read` is read-only and prints
the masked form of a real email, which is the fastest way to confirm with your
own eyes that nothing real would reach the model.

Do it by hand instead if you prefer — the manual steps are below.

1. New Google Cloud project (a throwaway — do **not** use the project that owns
   the production OAuth client).
2. **APIs & Services → Enable APIs → Gmail API → Enable.**
3. **Google Auth Platform → Branding**: app name, support email, developer
   email. Nothing else matters for the test.
4. **Audience → User type: External.** Then press **Publish app** so the status
   reads *In production*. **Do not submit for verification.** This is the whole
   point: published, unverified.
5. **Data access → Add scopes →** paste
   `https://www.googleapis.com/auth/gmail.readonly`. Save.
6. **Clients → Create client → Web application.** Redirect URI:
   `https://developers.google.com/oauthplayground` (the playground is the
   fastest way to complete a real consent round trip).
7. In the [OAuth Playground](https://developers.google.com/oauthplayground):
   gear icon → *Use your own OAuth credentials* → paste the client id/secret.
   Select the `gmail.readonly` scope → **Authorize APIs**, using a Google
   account that is **not** listed as a test user.

**Record what happens at consent:**

- ✅ *"Google hasn't verified this app"* → **Advanced** → **Go to (unsafe)** →
  consent completes → **the path exists.** Note it, this is the good outcome.
- ❌ Blocked outright, or the scope is stripped from the grant → **the path does
  not exist**, and a private beta needs verification first. Say so immediately;
  it changes the schedule, not the design.

8. Exchange for tokens in the playground and **save the refresh token
   somewhere safe.**
9. **Set a calendar reminder for 8 days from now.** Then hit *Refresh access
   token* with that refresh token.
   - Still works → the 7-day expiry really is Testing-only. **Beta is on.**
   - `invalid_grant` → the expiry follows unverified status too, and only
     verification unblocks a beta.

Write both results into `OAUTH-COMPLIANCE-FINDINGS.md` §2, replacing the
`[UNVERIFIED]` marker. That paragraph is the single most load-bearing unknown
in this project.

## Step 2 — submit for verification early (free, do it in parallel)

The real risk is **Appropriate Access**, not money (findings §4). Google limits
Gmail scopes to four named use cases and ours is only *adjacent* to the fourth.
Verification is free and separate from the paid assessment, so find out whether
Google accepts the framing **before** commissioning anything.

- Frame the app as case 4: *"uses information from emails to provide reporting
  or monitoring services for the benefit of users"* — the same clause that
  covers package tracking and flight itineraries.
- Have ready: a demo video showing consent → a bank email → the staged row →
  the human review step; a privacy policy page containing the Limited Use
  disclosure; the homepage; the scope justification.
- The justification should say plainly that only mail from user-selected bank
  senders is fetched, that it is done by a query restriction enforced in code
  (`pipeline/lib/gmail.js`), and that no human at FamilyHub reads message
  content.

**Do not pay for a CASA assessment until verification says yes.** AL1 is ~$540
and annual; there is no reason to spend it against an unknown answer.

## Step 3 — sealed staging (built; needs migration 0063 applied)

This was going to be the blocker. It is not: the browser open side shipped in
v325 on 2026-08-13, and the Node seal side for this path is now written and
pinned to the same published test vector as the other two implementations
(`node pipeline/sealed-box-node.test.js`).

**Direct read seals by default.** A staged row carries `{sealed, eph_pub,
nonce, enc_v}` and no readable amount, counterparty, memo or body — only
`occurred_at` and `source_provider` stay clear, so a locked device can still
render the row. That is what makes *"FamilyHub cannot read your mail"* a true
sentence rather than an aspiration.

What it needs:

- **Apply `0063_email_transactions_sealed.sql`** — the sealed columns plus the
  NOT NULL relaxations. The review screen has branched on `row.sealed` since it
  was built; the columns simply never existed.
- **A family with no staging keypair HOLDS.** The message is deferred, not
  written as plaintext (option (a), agreed 2026-08-09). Self-healing: every
  family provisions on its next app open as of v325.
- `STAGING_SEAL=false` reverts to plaintext rows. Debugging only — it stores
  readable bank data.
- `STAGING_STORE_RAW_BODY=false` keeps no message body at all, sealed or not.

Server-side dedup dies with sealing (you cannot query `amount=eq.X` against
ciphertext, and a blind index over VND amounts is dictionary-attackable). The
cross-source dedup in `lib/ingest.js` still runs against any plaintext-era rows
and quietly finds nothing among sealed ones — **dedup belongs in the review
step now**, which is where it works better anyway. Flagged, not yet moved.

## Step 4 — environment

Set in the Vercel project (Settings → Environment Variables). All server-side;
none of these ever reaches the browser.

| Variable | What | Notes |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client id | from the Clients screen |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret | |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<app>/api/gmail-callback` | must match the client config exactly, including scheme and trailing path |
| `OAUTH_STATE_SECRET` | ≥32 random chars | signs the OAuth state; rotating it invalidates in-flight consents only |
| `MAILBOX_TOKEN_KEY` | `k1:<base64 32 bytes>` | **generate with `node pipeline/lib/token-crypto.js keygen`** |
| `SUPABASE_URL` | project URL | |
| `SUPABASE_ANON_KEY` | publishable key | used only to verify a caller's token |
| `SUPABASE_SERVICE_ROLE_KEY` | service role | **new secret in this environment** — the sync worker writes staging rows |
| `GEMINI_API_KEY` | already set for CSV import | reused |
| `APP_URL` | `https://<app>/` | where the callback redirects back to |
| `CRON_SECRET` | random | Vercel sends it as a bearer token on scheduled runs |
| `SENDER_AUTH_ENFORCE` | `true` to block non-DKIM mail | leave unset at first; watch recorded verdicts, then enforce |
| `STAGING_STORE_RAW_BODY` | `false` to store no bodies | see step 3 |
| `STAGING_SEAL` | `false` reverts to plaintext staging | debugging only — stores readable bank data |
| `STAGING_PUB_PINS` | `<familyId>:<fingerprint>,…` | optional trust-on-first-use pin for family staging keys, held in a different trust domain from Supabase (step 3) |

**`MAILBOX_TOKEN_KEY` must never be stored in Supabase, in the repo, or
anywhere the database credentials can reach.** The whole protection for stored
refresh tokens is that the key and the ciphertext live in different systems
(`pipeline/lib/token-crypto.js`).

## Step 5 — apply the migration

`supabase/migrations/0062_mailbox_oauth.sql` then `0063_email_transactions_sealed.sql`, via the Supabase MCP so the ledger
stays accurate (see AGENT_SYNC on ledger drift). Additive: new nullable columns
on `mailbox_connections`, one `NOT NULL` drop on `forwarding_alias`, an
`ingest_source` column on `email_transactions`, and two RPCs. The Apps Script
does not read or write any of it.

Next free migration number after both: **0064**.

## Step 6 — schedule the sync

Not committed to `vercel.json` deliberately: cron frequency is plan-dependent
(Hobby allows far less than Pro), and a schedule the plan rejects fails the
deploy. Add when you know the plan:

```json
{
  "outputDirectory": ".",
  "buildCommand": "npm run build:deploy",
  "crons": [{ "path": "/api/gmail-sync", "schedule": "*/15 * * * *" }]
}
```

Until then, trigger it by hand:

```sh
curl -X POST https://<app>/api/gmail-sync -H "Authorization: Bearer $CRON_SECRET"
```

## Step 6b — the one gap that blocks a real beta

**There is no way to dismiss a staged row.** `resolve_email_transactions` (0060)
deletes rows after a successful promote, and that is the only caller. A row the
user never approves — a duplicate, a non-transaction, a transfer they don't want
in the ledger — stays pending forever, holding its body.

For one test mailbox that is untidy. For 100 beta users it is three problems at
once:

- the review queue only ever grows, so it stops being reviewable;
- retention becomes unbounded, which the privacy policy cannot honestly
  describe (there is a matching TODO in `privacy.html`);
- direct read makes it worse than forwarding did — we now fetch mail the user
  never hand-picked, so "they ignored it" is the common case, not the rare one.

The fix is small: a dismiss action calling the same RPC, which already deletes
and is already scoped to the caller's own rows. It is deliberately **not** done
here — the review screen is the one piece proven against real staged rows, and
it is not worth breaking on the last lap. Do it before inviting anyone.

## Step 7 — the spike, end to end

1. `POST /api/gmail-connect` with `{ memberId }` and your Supabase access token
   → open the returned `url`, consent.
2. Land back on `#mailbox-connected`.
3. Check the row: `mailbox_connections` should have `connection_source='oauth'`,
   `oauth_status='active'`, an `oauth_email`, and an `oauth_refresh_enc` that
   starts `v1.k1.` — **if that column is readable as a token, stop everything.**
4. Trigger a sync (step 6).
5. Expect a row in `email_transactions` with `ingest_source='oauth'`,
   `review_status='pending'`, and a populated `raw_extracted.memo`.
6. Open the review screen. It already works — it has been used against real
   staged rows from the forwarding pipeline, and reads the same table.

**Success is one staged row a human can approve.** Not an imported transaction:
nothing auto-imports, by design.

---

## What to watch once it runs

| Symptom | Meaning | Action |
|---|---|---|
| `oauth_status='needs_reconnect'` | user revoked, or the 7-day Testing clock | prompt a reconnect — normal, not an error |
| `reason: 'no_provider_domains'` | `known_provider_domains` is empty or inactive | seed it (migration 0050); sync deliberately reads **nothing** rather than everything |
| Lots of `llmCalls` per run | templates are not sticking | check `sender_fingerprints.extraction_regex`; a v3 template from the forwarding side is used but never overwritten, by design |
| `deferred` results | per-run LLM ceiling hit | expected on first backfill; next run continues |
| `parse_failures` climbing | sender changed its email format | the template self-invalidates and re-derives; investigate if it repeats |

## The privacy sentence

Ship this alongside the connect button; it is the honest version, and it is only
fully true once step 3 lands.

> Google chỉ có một quyền đọc thư duy nhất, và nó bao trùm toàn bộ hộp thư của
> bạn — không có quyền nào hẹp hơn. FamilyHub chỉ tải về email từ những ngân
> hàng bạn chọn, và chỉ những email đó mới rời khỏi hộp thư của bạn. Nội dung
> được mã hoá bằng khoá của gia đình ngay khi lấy về, nên chỉ nhà bạn đọc được —
> FamilyHub cũng không đọc được. Bạn gỡ quyền bất cứ lúc nào trong tài khoản
> Google.

The second sentence is a self-imposed restraint, not a boundary the user can
verify. That is why it is paired with revocation, which they can. The restraint
itself is enforced in `pipeline/lib/gmail.js` (`buildProviderQuery` /
`assertRestrictedQuery`) and covered by `pipeline/gmail-parse.test.js` — if a
future change widens the read, those tests fail.
