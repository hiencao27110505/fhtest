# FamilyHub — Architecture

This is the zoom-out doc. It explains what FamilyHub is, how the pieces fit together, and
the patterns that repeat across features so they don't need re-explaining in every
`docs/features/*.md`. For "how does feature X work and why does it exist," go to that
feature's doc in `docs/features/` — this doc stays at the system level.

Audience: engineers and Claude Code sessions working in this repo. If you're about to
touch a specific feature, read its `docs/features/*.md` first; come back here when you
need the cross-feature picture.

---

## What FamilyHub is

FamilyHub is a Vietnamese-first family finance + memories PWA: shared budget/goals/
transaction tracking, a photo memory timeline, and lightweight social layers (reactions,
proposal/approval on shared spending) for a family that wants their financial data
genuinely private from everyone, including the people who run the app.

## Tech stack & deployment

FamilyHub ships as a **single-file PWA** — `index.html` (+ `sw.js`, `manifest.json`,
icons, `vendor/`) served statically. `index.html` is **generated** from concern-split
sources under `src/` via `node build.js`. The build mechanics, source layout, load-order
rules, and runtime-scope invariants (classic-script global scope vs. ES-module scope) are
covered in full in `../CLAUDE.md` (§§1–4) and `../BUILD.md` — **do not restate them here**,
they're safety-critical rules, read them directly.

Backend is Supabase (Postgres + RPCs + Edge Functions + Realtime). Deploy is Vercel,
triggered on push to `main` (`vercel.json` re-runs `npm run build` at deploy time).

## Data flow: boot → hydrate → write → sync

1. **Boot**: a pre-paint gate in `src/index.html`, then either a warm-start from a cached
   snapshot (`fhRestoreSnapshot()`) or a cold hydrate. Full detail:
   [`docs/features/onboarding-and-boot.md`](features/onboarding-and-boot.md).
2. **Hydrate**: one RPC, `get_family_snapshot()`, returns the whole family's data in one
   payload (`src/js-data/30-hydrate.js`) — budgets, goals, transactions, events/memories,
   reactions, request_reviews, all in one round trip. This is *the* read path; there is no
   per-feature fetch.
3. **Write**: every mutation goes through `src/js-data/50-writethrough-realtime.js` —
   optimistic local update, then a Supabase write, with Realtime channel subscriptions
   pushing other devices' writes back in. Writes made while offline queue in
   `src/js-data/40-txn-writes-outbox.js` and flush on reconnect.
4. **Encryption sits underneath all of this**, not beside it: `fhField()`/`fhRead()`
   (`src/js-data/15-crypto.js`) are the write/read shape every table-touching function
   above calls through — see the Security model section below.

## Security model

Secret (Key Card, or a legacy passcode for families mid-migration) → PBKDF2+HKDF →
`K_wrap` (unwraps the DEK) / `K_auth` (legacy passcode door proof) → a 256-bit DEK → every
field value and photo is AES-256-GCM encrypted, envelope `b64(iv‖ct)`. Enforcement is
**database-side**, not just client courtesy: Postgres triggers reject any plaintext-only
write once a family has left the `off` state.

- Full key hierarchy, the `off → dual → enc` migration state machine, coverage-sweep
  mechanics, and honest caveats (no AAD/positional-integrity binding — proposed, not
  built): [`docs/features/encryption.md`](features/encryption.md).
- The auth layer that unlocks the above (why Key Card replaced the 6-digit passcode, the
  multi-wrap data model that lets both coexist during migration):
  [`docs/features/key-card-auth.md`](features/key-card-auth.md).

**Rule of thumb when touching any write path**: if it writes a value a family member
typed or a photo they took, it should go through `fhField()`/`fhEncBytes()` or an
equivalent already-encryption-aware helper — never a raw `.insert()`/`.update()` on a
covered table. Check the target table against `_ENC_TABLES` in
`src/js-data/66-enc-ui.js` if unsure.

## Feature map

| Feature | Doc | One-line |
|---|---|---|
| Encryption (E2EE) | [`encryption.md`](features/encryption.md) | Key hierarchy, off/dual/enc state machine, DB-enforced |
| Key Card auth | [`key-card-auth.md`](features/key-card-auth.md) | 128-bit card replacing the 6-digit passcode as the "safe" secret |
| CSV import | [`csv-import.md`](features/csv-import.md) | Spreadsheet → auto-mapped, masked, reviewed, promoted via the normal expense-write path |
| Bank-email pipeline | [`bank-email-pipeline.md`](features/bank-email-pipeline.md) | Forwarded bank emails → extracted transactions. **Live end to end for allowlisted members** (pipeline `v2026-08-17-d`, sealed staging on, review UI shipped). |
| Budget & run-rate | [`budget.md`](features/budget.md) | Monthly budget vs. actual + pace signal, "Others" catch-all invariant |
| Saving goals | [`goals.md`](features/goals.md) | Save toward a thing, funded from a shared pool, optional link to a Memories occasion |
| Transactions & expenses | [`transactions.md`](features/transactions.md) | The core ledger; realized vs. planned (proposal) status |
| Expense capture | [`expense-capture.md`](features/expense-capture.md) | Bulk NL entry, encrypted drafts, EXIF-based receipt-photo dating |
| Memories | [`memories.md`](features/memories.md) | Unified photo timeline/calendar/album across events and expense photos |
| Social alignment | [`social-alignment.md`](features/social-alignment.md) | Reactions (emotional, realized txns) vs. Requests (approval, proposals) — same 5 emoji, two systems |
| House customizer | [`house-customizer.md`](features/house-customizer.md) | Decorative home-screen personalization |
| Web push | [`web-push.md`](features/web-push.md) | Closed-app notifications; single `fhNotify()` fan-out point |
| Release notes | [`release-notes.md`](features/release-notes.md) | In-app curated "What's New," distinct from `../CHANGELOG.md` |
| Onboarding & boot | [`onboarding-and-boot.md`](features/onboarding-and-boot.md) | First-run family setup + app-boot orchestration — where budget schema and the first DEK/Key Card get created |

## Cross-cutting patterns

These repeat across multiple features. Documented once here; feature docs link back
instead of re-explaining.

**Shared entity-review pattern.** A saving goal, a future (planned) transaction, and a
future occasion are all "proposals" until another family member signs off.
`_entNorm(type, obj, ref)` and `_entAligned`/`_entAlignedBy`/`_entCreatorId`
(`src/js-ui/10-nav-model.js`) normalize all three into one shape and one alignment check
— only a 🥰 review from someone *other than the creator* aligns a proposal. Used
identically by [`goals.md`](features/goals.md), [`transactions.md`](features/transactions.md),
and the Requests half of [`social-alignment.md`](features/social-alignment.md).

**Reactions vs. Requests.** Same 5 emoji (😱🤨😂🥰😤), two different systems: Reactions
are a free-form social response to *realized* transactions only; Requests re-label the
same emoji as consent language for *proposals* across all three entity types above. See
[`social-alignment.md`](features/social-alignment.md) for the full contrast.

**The mirror-event bridge.** `syncExpenseEvent()` (`src/js-ui/40-memories.js`) mirrors any
photographed expense into a shadow `events` row so it can surface in an Events list. This
predates a later change: Memories now reads expense photos directly off
`transactions`/`transaction_photos` rather than relying on the mirror (a 2026-08 migration
comment confirms the mirror-based read path had a silent-failure history and "the app
itself no longer depends on this for display"). The bridge still exists and still writes —
treat it as semi-legacy plumbing, not the source of truth. Full story:
[`memories.md`](features/memories.md), [`expense-capture.md`](features/expense-capture.md).

**`fhNotify()` fan-out.** Every social write (a reaction, a new request, a goal proposal)
calls `window.fhNotify(kind, data)` (`src/js-data/55-push.js`) — the single entry point
into web push. If you add a new kind of family-visible event and want it to notify closed
devices, this is the function to call, not a new push-sending path. Detail:
[`web-push.md`](features/web-push.md).

**Build system & runtime scope.** Covered in `../CLAUDE.md` and `../BUILD.md` — not
repeated here.

## Known architectural debt

Surfaced during this docs pass — not fixes, just visibility so nobody rediscovers these
from scratch:

- **Bank-email pipeline: unresolved who-encrypts-staging-rows question.** The pipeline's
  writer (an unattended Apps Script) can never hold the family DEK, so `_enc` columns
  alone don't answer who fills them. Three options on the table, unresolved as of the
  last `../AGENT_SYNC.md` entry. Detail: [`bank-email-pipeline.md`](features/bank-email-pipeline.md#current-state).
- **Mirror-event bridge fragility**, described above — two representations of the same
  data (mirror event vs. raw transaction photos) need to stay consistent by convention,
  not by a single source of truth.
- **Unused staging table.** `csv_transactions` (migration `0043`) is fully built —
  `_enc` columns, RLS, enc-guard trigger — but has zero references in `src/`. CSV import
  bypasses it entirely via the normal bulk-expense-write path. Detail:
  [`csv-import.md`](features/csv-import.md#current-state).
- **Migration numbering has broken twice.** Duplicate `0043` (two unrelated files share
  the number), `0044` applied to production then deleted from the repo tree, and a
  `0048 → 0050` renumber still stranded on an unmerged branch. Root cause and the
  collaboration convention meant to prevent it: [`COLLABORATION.md`](COLLABORATION.md).
