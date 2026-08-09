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
