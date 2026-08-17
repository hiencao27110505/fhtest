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
    └── helloworld/
        ├── pyproject.toml      # this function's own deps
        ├── requirements.txt    # GENERATED — do not hand-edit
        └── main.py
```

## Getting started

```sh
make install           # create .venv with every function + dev tools
make list              # list the functions in the workspace
make run FN=helloworld # run locally on :8080 with hot reload
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
| Test / lint | `make test` · `make lint` · `make fmt` |
| Deploy | `make deploy FN=send-email` |
| Read logs | `make logs FN=send-email` |

## Deploying

The target project is `fhtest-502915`, set as `GCP_PROJECT` in the Makefile.
Override it per invocation with `make deploy FN=x GCP_PROJECT=other-project`;
every gcloud call passes `--project` explicitly, so your local
`gcloud config set project` never decides where a deploy lands.

```sh
make preflight              # auth / project / billing / APIs
make enable-apis            # one-time, needs billing on first
make deploy FN=helloworld   # freeze + preflight + deploy, prints the URL
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

The local Python version (`.python-version` = 3.12) matches
`runtime = python312`. Keep the two in sync — a mismatch is the classic source
of "works locally, fails on GCP".
