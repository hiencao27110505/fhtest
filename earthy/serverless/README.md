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
└── functions/
    ├── gmail-transaction-ingest/
    │   ├── pyproject.toml      # this function's own deps
    │   ├── requirements.txt    # GENERATED — do not hand-edit
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

### Running it before Gmail auth exists

`_gmail_client()` returns `None` when `GMAIL_CREDENTIALS` is unset, so the
function logs the notification and acks instead of failing. That keeps the
topic drained while the OAuth side is still pending.

Still to wire up:

- **Gmail watch**: grant `pubsub.publisher` on the topic to
  `gmail-api-push@system.gserviceaccount.com`, then call `users.watch()`.
  A watch **expires after 7 days** and has to be renewed — usually a small
  scheduled job.
- **Checkpoint store**: `_read_checkpoint` / `_write_checkpoint` raise
  `NotImplementedError`. Until they are implemented, `CHECKPOINT_ENABLED`
  stays unset and each run only looks at the notification's own historyId,
  which drops messages that arrive between invocations.

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
