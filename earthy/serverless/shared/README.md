# shared/

Modules used by more than one function.

Cloud Functions deploys a single directory, so a module two functions both
import has to physically exist inside each one. `make sync-shared` copies the
files listed in a function's `[tool.earthy]` `shared` key into that function's
directory. The copies carry a `# GENERATED` header and are committed alongside
the original.

**Edit here. Never edit a copy** — the next sync overwrites it.

This mirrors Google's guidance for local dependencies: vendor them next to
`main.py` rather than reaching outside the source directory.
<https://docs.cloud.google.com/run/docs/runtimes/python-dependencies>

Symlinks do not work: `gcloud` packages the source as a tar that preserves
links rather than following them, so the link would dangle in the container.

## Names are top-level

A copied file lands beside `main.py`, so `accounts.py` here is imported as
`import accounts`. That means **a name here must not collide with a file
private to a function** — a `shared/senders.py` would shadow
`gmail-transaction-ingest/senders.py`. `make sync-shared` fails on a collision
rather than overwriting.
