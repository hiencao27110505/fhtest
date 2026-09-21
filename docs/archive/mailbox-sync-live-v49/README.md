# mailbox-sync as it ran in production on 2026-09-19 (v49 + statement capture = v50)

**Why this folder exists.** Between 2026-09-15 and 2026-09-20 the live `mailbox-sync`
Edge Function carried work that was never committed: it was written in one session's
scratch space and deployed straight to production. On 2026-09-20 the category-tree
deploys (v52 onward) were built from `main` and overwrote it. This is the only
surviving copy, rescued into git on 2026-09-21 so it cannot be lost a second time.
It is an ARCHIVE: nothing imports it, nothing deploys it.

Source: `supabase functions download mailbox-sync` of live v49, byte for byte, with
the statement-capture delta (`patches/`) applied on top. `deploy.sh.txt` is the script
that shipped it as v50.

## What is in here that `main` does not have

| Work | Files | Why it was built (measured) |
|---|---|---|
| **Backfill position** (`mailbox_grants.backfill_before`, migration 0136) | `worker.mjs`, `db.mjs` | A backfill re-listed the newest mail on every run. Promo mail is settled on headers and recorded nowhere, so 400+ promos held the slots forever: a real 365-day connect stopped at 333 days. |
| **Reader lease** (`reader_lease_until/_id`, labelled 0145 in the code) | `worker.mjs`, `db.mjs` | Three triggers (connect kick, minute lane, five-minute poll) could read one mailbox at once. Gmail's allowance is per user, so they spent the same 6,000 units twice: 41 Gmail 403s in six hours on 2026-09-15. |
| **Run budget** (`RUN_BUDGET_MS = 100000`) | `worker.mjs` | A free-plan function is killed at 150 s and loses uncommitted work; a run that stops itself resumes exactly where it left off. |
| **Learned sender skips in the Gmail query** (`SKIP_MAX`, `db.skipSenders`) | `senders.mjs`, `db.mjs`, `worker.mjs` | A skip in the query is the only free skip: the mail is never listed, so it never costs a 20-unit fetch. |
| **A shape learned mid-run reaches the next message** (`_warmThrough`) | `extract.mjs` | 162 Gemini calls for 25 shapes on the 15/09 read, against a 20-per-minute free-tier wall. |
| **A month in the subject is not a new shape** (`legacySubjectTemplate`) | `extract.mjs` | Every statement sender relearned itself every month; the legacy key is read-only so no cached shape is paid for twice. |

## What `main` has that this copy does NOT (do not port backwards)

- `ingest.mjs` / `stage.mjs`: the `status` / `flow` fields and the `incomplete_status` rejection.
- `extract.mjs`: a salutation read as the merchant collapses to `null` (`merchant === ''`).
- Everything since 2026-09-19: the category tree (`taxonomy.mjs`, `classify.mjs`, `llm.mjs`, node sealing in `stage.mjs`).
- Comments here say `(0136)` for the multi-reader work that `main` renumbered to `(0137)`.

## Database state this code expects, already LIVE but not in `supabase/migrations/`

`mailbox_grants.backfill_before`, `backfill_started_at`, `backfill_requested_at`,
`backfill_moved_at`, `reader_lease_until`, `reader_lease_id`, and the RPCs the lease
calls. Re-landing the code means writing these down as migrations too.

Lesson recorded in AGENT_SYNC and the spec: before ANY Edge Function deploy, diff
`get_edge_function` against `main`. A note that says "do not deploy from main" does not
stop a session that never reads it.
