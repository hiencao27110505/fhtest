# Collaboration protocol

Rules of engagement for the Claude Code sessions (and the people running them) working
this repo concurrently. This started as an informal convention between two people; it's
written down now because the team is growing past two, and the informal version has
already broken in a way worth learning from — see [Why this exists](#why-this-exists).

## The core tool: `AGENT_SYNC.md`

[`../AGENT_SYNC.md`](../AGENT_SYNC.md) is the shared async handoff log. It's split into
three sections:

- **Open Questions** — a genuine blocker: you need someone else's decision before you can
  proceed. Add a dated entry with who it's from, what you need, and a link to a dedicated
  doc if the discussion is more than a few lines. Whoever answers moves the entry to
  **Resolved** with a one-line outcome, keeping the real discussion in the linked doc.
- **Landed / FYI** — a one-way status broadcast: "I shipped X, here's what changed, here's
  the next free migration number." No answer required — but read entries for areas you're
  about to touch, since they often carry heads-up notes that affect your work (a table
  column that's now nullable, a function that now requires a JWT, etc.).
- **Resolved** — closed Open Questions, one-line outcome + pointer to the full discussion.

This split exists because status broadcasts vastly outnumber genuine questions in
practice, and mixing them meant real questions could sit unanswered, buried under landed-
work notes. If you're unsure which section an entry belongs in, ask: *"does someone need
to act, or just know?"* — act → Open Questions, know → Landed/FYI.

This is **async, not real-time**: push an entry when you have something, and say so
out-of-band (Slack/DM) — the file doesn't notify anyone by itself.

> **Before your first edit, read the MUST-READ ground rules at the top of
> [`../AGENT_SYNC.md`](../AGENT_SYNC.md).** This file is the protocol; that one is the
> hazard list — the failures that happen *even when* the protocol is followed
> (shared singletons with no branch, migration numbers lost while a branch waits,
> silent-failure modes, and what never to touch in someone else's tree).

## Working concurrently: one agent, one worktree

**The rule: never run two agents in the same working directory.** Same repo is fine and
expected. Same *checkout* is not.

This is written down because it happened, on 2026-08-16, and produced four distinct
failures inside a single afternoon:

1. A `git reset --hard origin/main` ran that neither the session nor its human issued.
   A backup branch created seconds later captured the *post-reset* commit, so the
   insurance taken out immediately before a destructive operation silently protected
   nothing. (The commits survived in the reflog, but only by luck.)
2. `pipeline/bank-email-pipeline.gs` was rewritten mid-task by the other session —
   ~95 lines of inbox-retention work appearing in a file the first session had already
   verified as clean and was reasoning about.
3. `package.json`'s `test` script was edited by both sessions within minutes.
4. Both sessions appended to `AGENT_SYNC.md` in the same window.

None of these is a mistake anyone made. They are all the same structural fact: git's
unit of isolation is the worktree, and two writers sharing one have no isolation at
all. Branches do not help, because a branch is a pointer and both agents are moving
files under the same one.

**Use `git worktree`.** Each agent gets its own directory and its own index, sharing
one object store and one history:

```sh
git worktree add ../fh-notifications -b notifications main
git worktree add ../fh-retention     -b retention     main
git worktree list                       # who is where
git worktree remove ../fh-notifications # when done
```

A worktree does **not** get `node_modules`, and three suites need `tweetnacl`, so
`npm test` fails there with `MODULE_NOT_FOUND` until you link the main checkout's
copy (or `npm install` again):

```sh
ln -s ../fhtest/node_modules node_modules
```

Integration then happens through branches and merges, which is the thing git is
actually built to arbitrate.

**If you truly must share a tree** (a human and one agent, say), then: scope every
commit explicitly (`git add <paths>`, never `git add -A` or `git commit -a`), and
re-check `git status` immediately before committing rather than trusting a reading
from earlier in the task. Anything you did not write is not yours to commit, and
sweeping it in misattributes someone else's half-finished work under your message.

### Claim territory before you edit, not after

`AGENT_SYNC.md` already requires announcing a migration number *before* writing the
migration. The same rule earns its keep for files: post the paths you are about to
work in before the first edit. It costs one line and it is the only thing that turns
"we both edited that" into "I saw your claim."

### Remove the collision surface instead of coordinating around it

Two of the four failures above were **structural**, and structure is cheaper to fix
than vigilance:

- **`npm test` no longer lists tests** — `tools/run-tests.js` discovers every
  `pipeline/*.test.js` and `tools/*.test.js`. The old single-line `&&` chain was a
  merge magnet, and losing a test from it does not fail: the suite just quietly stops
  running it. That is not hypothetical — it happened twice, and the second time took
  `review-notify.test.js` with it, the guard for the exact feature being shipped that
  day. A new test is now a new *file*, which git merges cleanly. The runner exits 1 on
  an empty discovery, because a green tick over zero tests would recreate the bug.
- **`index.html` is never hand-merged** — see [`../.gitattributes`](../.gitattributes).
  On a conflict, `npm run resolve` rebuilds it from `src/` and stages it. Correct
  whichever side "won", because `src/` is the truth.

When a coordination rule keeps getting broken, prefer deleting the thing being
coordinated over writing a firmer rule about it.

### Keep the shared log append-friendly

Add new `AGENT_SYNC.md` entries at the **top** of their section. Two agents appending
to the same region conflict; two agents inserting at a known boundary usually do not.
If entries start conflicting anyway, the next step is one file per entry in a
directory — deliberately not done yet, because restructuring a file another session
is actively writing is the same mistake in a new costume.

## Attribution

Sign entries with your name + the feature area you're working on (e.g. "Hien — Key Card
auth"), not a session-relative label like "Hien's session" or "the bank-email pipeline
session." Relative labels only resolve for the two people who were in the conversation
when they were coined — with more than two people reading the file, a new person can't
tell who "the bank-email session" refers to six weeks later. If you're a Claude Code
session, sign with the human you're working for, not "Claude" or an agent ID.

## Migration numbering

**The convention**: before claiming a migration number, check both (a) the actual highest
file in `supabase/migrations/` and (b) the "next free number" most recently stated in
`AGENT_SYNC.md` — they can disagree, and the higher of the two wins. Then announce your
claim in `AGENT_SYNC.md` immediately, before you start writing the migration, not after.

**Why this is written down so explicitly**: this exact convention already existed
informally and broke twice in three weeks:

1. Two branches independently claimed `0043` for unrelated features
   (`0043_family_card_birth.sql` and `0043_csv_transactions_staging.sql`). Both were
   applied to production under their distinct filenames — Postgres/Supabase tracks
   migrations by filename, so this technically "worked," but it means the numeric
   sequence no longer maps 1:1 to a single timeline, which is confusing for anyone
   reading the migrations folder top-to-bottom later.
2. `0044_card_claim_links.sql` was applied to production, then fully reverted
   (`0045_drop_card_claims.sql`) and deleted from the repo tree — so production's
   migration ledger has an `0044` entry with no corresponding file in the current tree.
   A different branch had independently claimed `0044` for an unrelated seed migration,
   and had to renumber twice (`0044` → `0048` → `0050`) as two different collisions
   materialized while it sat unmerged.

Neither incident was a process failure so much as a **race**: the "claim the next number"
rule was correct, but it was being claimed via prose buried inside long status entries,
with no single place to check that was guaranteed current. This doc doesn't introduce new
tooling to close that race (that's an explicit non-goal for this pass — see
[`ARCHITECTURE.md`](ARCHITECTURE.md#known-architectural-debt) for the fuller
incident writeup) — it just makes the existing convention explicit and asks you to check
both sources before claiming, and to announce immediately rather than batching the
announcement into a later "landed" note.

## Keeping docs current

A feature doc that's wrong is worse than no feature doc — it actively misleads the next
session that trusts it. When you land a change significant enough that it changes the
*Problem/Why* or *Architecture/How* of something in [`docs/features/`](features/), or
meaningfully moves something's *Current State* (shipped something that was "proposed,"
found something is unused/broken, resolved an open question), updating that doc's
`## Current State` section is part of being done — not a separate follow-up task.

Same for [`../CHANGELOG.md`](../CHANGELOG.md): a dated entry for the feature area, written
at the same grain as the existing entries (what shipped + why, not a commit-by-commit
transcript), belongs in the same commit or the same session as the work it describes.

If you're not sure whether a change is "significant enough," err toward updating — a
docs diff costs little to review and skip; a stale doc costs someone real time down the
line when it contradicts the code.

## Why this exists

See the full context in [`ARCHITECTURE.md`](ARCHITECTURE.md#known-architectural-debt)
and [`../CHANGELOG.md`](../CHANGELOG.md) — this protocol was written alongside a full pass
of architecture docs and a dev-facing changelog, prompted by the team growing from one
person + one Claude-partner to multiple people each running their own Claude Code
sessions against this repo. The goal is the same "zoom in / zoom out" ability the docs
pass targets: anyone (human or Claude session) should be able to quickly understand what's
being worked on, by whom, and what's actually safe to touch right now.
