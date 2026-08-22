# Earthy — serverless (GCP Cloud Functions)

A **uv workspace**: one `.venv` shared by every function, with each function
declaring its own dependencies in its own `pyproject.toml`. The Python
counterpart to the pnpm workspace in `apps/`.

```text
serverless/
├── pyproject.toml          # workspace root + dev tools (pytest, ruff)
├── uv.lock                 # one lockfile for every function
├── .venv/                  # the single shared venv (git-ignored)
├── Makefile
├── shared/                 # modules used by more than one function
│   ├── accounts.py         # per-user tokens + cursor (the DB seam)
│   └── gmail_auth.py       # refresh token -> Gmail client
└── functions/
    ├── gmail-transaction-ingest/
    │   ├── pyproject.toml      # own deps + [tool.earthy] shared = [...]
    │   ├── requirements.txt    # GENERATED — do not hand-edit
    │   ├── accounts.py         # GENERATED copy — edit shared/, not this
    │   ├── gmail_auth.py       # GENERATED copy — edit shared/, not this
    │   ├── senders.py
    │   └── main.py
    └── transaction-parser/
        ├── pyproject.toml
        ├── requirements.txt
        ├── parsing.py
        └── main.py
```

## Getting started

```sh
make install    # create .venv with every function + dev tools
make list       # list the functions in the workspace
make run FN=transaction-parser   # run locally on :8080 with hot reload
```

The repo-root `.vscode/settings.json` already points the Python extension at
`earthy/serverless/.venv/bin/python`, so one interpreter covers every function.
If your editor still resolves imports against the system Python, reload the
window, or pick that interpreter manually once.

## Everyday workflow

| Task | Command |
| --- | --- |
| New function | `make new FN=send-email` |
| Add a dependency | `make add FN=send-email PKG="httpx>=0.27"` |
| Run locally | `make run FN=send-email` (port: `PORT=9000`) |
| Send a test event | `make emit FN=send-email` (Pub/Sub functions) |
| Test / lint | `make test` · `make lint` · `make fmt` |
| Deploy | `make deploy FN=send-email` |
| Read logs | `make logs FN=send-email` |

## Deploying

The target project is `fhtest-502915`, set as `GCP_PROJECT` in the Makefile.
Override it per invocation with `make deploy FN=x GCP_PROJECT=other-project`;
every gcloud call passes `--project` explicitly, so your local
`gcloud config set project` never decides where a deploy lands.

```sh
make preflight     # auth / project / billing / APIs
make enable-apis   # one-time, needs billing on first
make deploy FN=gmail-transaction-ingest   # freeze + preflight + deploy
```

`make deploy` runs `freeze` and `preflight` first, so a stale
`requirements.txt` or a missing API stops the deploy before gcloud is called.

### First-time project setup

A brand-new project needs two things before the first deploy:

1. **Billing enabled.** Gen2 functions run on Cloud Run and build on Cloud
   Build, both of which require it. Link an account at
   `console.cloud.google.com/billing/linkedaccount?project=fhtest-502915`.
2. **APIs enabled** — `make enable-apis` turns on Cloud Functions, Cloud Run,
   Cloud Build, Artifact Registry, Logging, and Eventarc. Billing must be on
   first, or enabling is refused.

`make preflight` reports which of these is missing and exits non-zero, so it is
safe to run at any time.

### Letting Gmail publish into the watch topic

`make grant-gmail-push` — done once per project, and already applied to
`fhtest-502915`. `make check-gmail-push` verifies it.

This is the one grant that makes the whole pipeline possible, and it is worth
understanding rather than copying. `users.watch()` is called with **the end
user's** OAuth token, which authorizes reading *their mailbox* and confers no
access to your GCP project at all. The `topicName` you pass is a destination
string, not a permission claim.

The publishing is done by **Gmail itself**, under Google's own identity
`gmail-api-push@system.gserviceaccount.com`, which reaches your topic only
because you granted it `roles/pubsub.publisher` ahead of time. So there are two
separate authorizations — user → Gmail, and Gmail → your topic — and this
binding is the only thing connecting them. The end user needs no GCP account,
no permission, and no awareness that this project exists.

The grant is on the **topic**, not the project: Pub/Sub IAM is per-resource, and
a project-wide grant to a Google system account would be needlessly broad.
`transaction-detected` deliberately does not carry it — nothing outside this
project publishes there.

Verified details, including what Google does *not* document, are in
[`research/gmail-push-pubsub-oauth.md`](../../research/gmail-push-pubsub-oauth.md).

## Sharing code between functions

Cloud Functions deploys **one directory**, so a module two functions both
import has to physically exist inside each of them. Google's guidance is to
[vendor local dependencies next to `main.py`][local-deps] rather than reach
outside the source directory, and that is what happens here — mechanically.

`shared/` holds the single copy you edit. Each function declares what it needs:

```toml
[tool.earthy]
shared = ["accounts.py", "gmail_auth.py"]
```

`make sync-shared` copies those files in, stamped with a `# GENERATED` header.
`run`, `test` and `deploy` all depend on the sync, so a stale copy cannot reach
GCP.

The copies are committed, so a diff touching a shared module shows the same
change once in `shared/` and once per function. Re-run `make sync-shared` and
commit the result together with the `shared/` edit — reviewing the copies is
not the point, keeping them in step is.

A copied file lands beside `main.py` as a **top-level module** — `accounts.py`
is imported as `import accounts`. A shared name must therefore not collide with
a file a function owns; `sync-shared` refuses to overwrite anything without the
generated header rather than clobbering it.

**Symlinks do not work here.** `gcloud` packages the source as a tar that
preserves links instead of following them, so the link would dangle inside the
container. This was tested, not assumed.

[local-deps]: https://docs.cloud.google.com/run/docs/runtimes/python-dependencies

## `requirements.txt` is generated

GCP does not accept a venv. It reads `requirements.txt` from the function's
source directory and installs from that. `uv export` generates the file **from
that function's own `pyproject.toml`**, so it carries only that function's
dependencies plus their transitives — never another function's dependencies,
and never the workspace dev tools.

- **Do not hand-edit it.** `make add` and `make deploy` re-run `make freeze`.
- After editing `dependencies` by hand, run `make freeze FN=<name>`.
- **Commit `requirements.txt`** — it is what GCP reads at build time.

### Why this file is longer than the one in Google's docs

Google's quickstart lists direct dependencies only, and pip resolves the
transitives at deploy time. The file here pins **every** transitive, so the set
of packages installed into the container is the same either way. What differs
is who chooses the versions of those transitives.

Pinning everything makes deploys reproducible: the same commit deployed today
and three months from now produces the same bytes, and the local environment
matches GCP. Without pinning, a new Werkzeug or Jinja2 release can break a
working function with no change on your side.

It is also why transitives should not be pinned by hand. The quickstart lists
`MarkupSafe==2.1.3`, but Flask 3.1.3 requires `markupsafe>=2.1.1` and the
resolver picks `3.0.3`. Declare what you import, and let `uv export` do the
rest.

### The shared-venv pitfall

Because every function shares one `.venv`, code can `import` a package it never
**declared** — one another function pulled in — and still run locally, then
fail on GCP where that package is absent. `uv export` catches most of this: an
undeclared package never reaches `requirements.txt`, so the deploy fails
outright instead of breaking silently. The rule: **if you import it, `make add`
it.**

## The Gmail transaction pipeline

```text
Gmail watch() → [topic: gmail-events]
                      ↓
          gmail-transaction-ingest          once per notification
          history.list → messages.get → match sender
                      ↓
          [topic: transaction-detected]     once per transaction
                      ↓
          transaction-parser                once per transaction
          strip html → read amount/direction/balance
```

Gmail push carries **no mail content** — only `{emailAddress, historyId}` —
and `watch()` filters by label, not by sender. So identifying a bank email
requires fetching it first; there is no cheaper pre-filter stage to split out.

The split above is therefore drawn where the unit of work changes, from
*mailbox* to *transaction*. Ingest owns the Gmail checkpoint and nothing else;
the parser never has to know Gmail exists, and re-deploying it for a new bank
template does not touch the ingest side.

Ingest fetches each message with `format="full"` and publishes the body along
with the event, so `transaction-parser` needs no Gmail credentials and no
Gmail scope. It can be exercised with a static payload.

Both stages stop at logging; nothing is persisted yet.

The volatile logic lives in one file per stage, and neither `main.py` should
need to change to support a new bank:

- `gmail-transaction-ingest/senders.py` — known bank and wallet domains.
  Matching is on the sender domain, not the display name, and subdomains
  count (`mail.momo.vn` matches `momo.vn`) while lookalikes do not
  (`momo.vn.evil.com` is rejected).
- `transaction-parser/parsing.py` — amount, direction and balance patterns.
  The balance is matched separately and skipped **by span, not by value**, so
  a transfer that happens to equal the balance still parses.

An email whose template is not recognised is logged as `INCOMPLETE` and acked,
not retried — an unknown layout is a gap to fill, not a transient failure.

### Per-user credentials

The pipeline is multi-user. A notification names a mailbox, so ingest looks up
*that user's* refresh token rather than reading one set of credentials from the
environment:

```text
notification.emailAddress
        ↓
accounts.AccountStore.get(email)   → refresh_token + history_id
        ↓
gmail_auth.build_client(token)     → Gmail client acting as that user
```

`accounts.py` defines the seam. `AccountStore` is a Protocol with two methods,
and `default_store()` decides which implementation a deployment gets — swap its
body for the Postgres-backed store and nothing else changes.

`InMemoryStore` is the stand-in: seeded from `GMAIL_ACCOUNTS`, a JSON object of
`{email: refresh_token}`. State dies with the instance, so a saved `historyId`
does not survive a cold start. It is enough to exercise the pipeline, not to
run it.

What the real store must honour:

- **Encrypt refresh tokens at rest.** One grants unlimited read access to
  someone's mail, forever, until revoked. `_Account.__repr__` is overridden so
  a token cannot reach a log line or a traceback.
- **Advance `historyId` only after the window is handled.** `main` writes it
  last; a mid-loop crash then replays that window instead of skipping it.
- **`gmail.readonly` only** — the scope lives in `accounts.SCOPES` and is
  asserted by a test, because widening it widens the blast radius of a leak.

The app's OAuth client id and secret are per-application, not per-user, and
come from `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. On GCP feed
those from Secret Manager (`--set-secrets`), not plain env vars: a function's
environment is visible in the console and in `gcloud functions describe`.

### Refresh tokens die every 7 days while the app is in Testing

Google expires refresh tokens after 7 days for any app whose OAuth consent
screen is **external** and whose publishing status is **Testing**, and Gmail
scopes are never in the exempt set. A user also loses their token by revoking
access or changing their Google password.

None of these are transient, so the pipeline treats them as a state, not an
error: `gmail_auth.build_client` raises `TokenRejected`, both functions mark
the mailbox with `mark_needs_reauth()` and **ack**. Retrying would redeliver
the message until the topic's retention ran out, and a dead token cannot be
revived without the user.

`list_connected()` then skips those mailboxes, so the daily renewal does not
spend calls on them, and `gmail-watch-renew` reports `needs_reauth` separately
from `failed` — a weekly wave of re-consents is routine here, not an outage.
The app is expected to read that state and prompt the affected users.

This ceases to be a weekly event once the app reaches **In production** status,
which requires OAuth verification and a CASA security assessment. See
[`research/gmail-push-pubsub-oauth.md`](../../research/gmail-push-pubsub-oauth.md)
for the verified details.

Still to wire up:

- **The Postgres store** — replace `default_store()`.
- **The OAuth callback** in the app: exchange the code with
  `access_type=offline` and `prompt=consent`, or Google returns an access token
  with no refresh token. The refresh token is shown **once**, at first grant.
- **Gmail watch**: call `users.watch()` per connected mailbox — deploy
  `gmail-watch-renew` and let Cloud Scheduler drive it daily. A watch
  **expires after 7 days** and must be renewed, or the pipeline goes quiet
  with no error. (The Pub/Sub grant it depends on is already in place; see
  below.)
- **Verification**: `gmail.readonly` is a restricted scope. Beyond 100 test
  users, Google requires app verification and a third-party security
  assessment — start that early, it is measured in weeks.

## Deploy configuration

Each function declares its GCP parameters in its `pyproject.toml`, and the
Makefile reads them from there, so `make deploy` needs no command-line flags:

```toml
[tool.earthy.gcf]
entry-point = "hello_get"
trigger = "http"
region = "asia-southeast1"
runtime = "python312"
allow-unauthenticated = true
```

### Pub/Sub-triggered functions

Set `trigger = "pubsub"` and name the topic. `allow-unauthenticated` does not
apply — Pub/Sub functions are never publicly invocable; Eventarc invokes them
through a service account.

```toml
[tool.earthy.gcf]
entry-point = "main"
trigger = "pubsub"
topic = "gmail-events"
region = "asia-southeast1"
runtime = "python312"
```

`make deploy` creates the topic if it does not exist, passes
`--trigger-topic`, and refuses to run if `trigger = "pubsub"` has no `topic`.
The handler takes a CloudEvent rather than a request:

```python
@functions_framework.cloud_event
def main(cloud_event): ...
```

Test one locally with two shells — `make run FN=<name>` in the first, then
`make emit FN=<name>` in the second. Override the payload with
`DATA='{"...":"..."}'`.

**Delivery is at-least-once**, so a handler must be safe to run twice on the
same message. Raising re-queues the message: raise only on transient failures,
because a permanent error would redeliver until the topic's retention expires.
Malformed payloads should be logged and acked, not raised.

The local Python version (`.python-version` = 3.12) matches
`runtime = python312`. Keep the two in sync — a mismatch is the classic source
of "works locally, fails on GCP".
