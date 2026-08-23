# Personal Ledger (double-entry re-architecture)

## Problem & Why

Family finance is a subset of each member's personal finance. To give every user a
full personal picture — resilient to losing any *space* key — each user gets a
PERSONAL container encrypted with their own key, and shared transactions exist as
**two linked rows** (double-entry): a **master** in the personal container and a
**published copy** in the space (family). Losing a space key costs only the shared
view; the personal stats always recover with the personal card alone. Decision
history: chosen over one-stream-with-scopes explicitly to avoid any reliance on
OS-keychain sync for recovery, and to keep the operator (us) unable to read anything.

## Architecture

- **Container:** `families.type` (`family` default | `personal` | `friend` | `trip`).
  A personal ledger is a normal container: single member, own DEK, own Key Card
  (card-born, `enc_state='enc'` from birth), seeded default categories. One per user
  (partial unique index on owner). It never becomes `profiles.family_id`, never
  appears in family pickers (client filters `type==='personal'`).
- **Linkage:** `transactions.link_id` (write-once), `version` (monotonic, trigger
  `_fh_link_guard`), `space_id` (the space a master flows to; null = private),
  `kind` (`expense` | `transfer` — transfer legs also get `transfer_id`,
  `transfer_dir`; UI not built yet).
- **Mirror engine** (`src/js-data/19-personal.js`, `fhPersonalMirror`): for the
  ACTIVE family, adopts my authored (`created_by = my member`) realized rows that
  have no `link_id`: reserve `link_id` on the FAMILY row first (crash-safe), then
  insert the master (re-encrypted to the personal key). Reconcile pass repairs
  reserved-but-missing masters, refreshes stale masters (family `updated_at` newer;
  version bump), and tombstones masters whose family copy was deleted — all bounded
  to the hydrate window (this + last month), idempotent by `link_id`, no cursors.
- **Provisioning** (`fhPersonalBoot`, called post-hydrate): if no personal container
  exists → silent `create_personal_ledger` RPC + card generation client-side; the
  personal card is shown ONCE (`sheet-pcard`) as "the one key you must protect".
  DEK cached in the `fh-keys` IDB store keyed by the personal fid (non-extractable).
  New device → `sheet` unlock with the personal card (`fhPersonalUnlock`).
- **Hydrate:** direct RLS table reads (categories/transactions/incomes windowed),
  no snapshot-RPC change. Decrypt with the personal key only.
- **UI:** 4th tab **Cá nhân** (`#v-personal`, `js-ui/21-personal.js`): cash-flow
  card (income − spend), per-space roll-up derived from masters' `space_id`
  (works with the personal key ALONE — the resilience property made visible),
  my stream (mirrored + private), quick-add private expense/income sheets.
  FAB is hidden on this tab (it adds to the family).

## Rules (locked decisions)

1. Backfill: full historical, background, resumable (window-bounded v1).
2. Personal card = the ONE secret; space cards stay shared + socially recoverable. No escrow, ever.
3. Only transactions are mirrored. Income/goals/budgets are per-container.
4. Core facts (amount/note/category/date) editable by owner only; photos/reactions/
   comments are annotations — anyone in the space, attach to the copy they can see,
   joined by `link_id` at read time, never mirrored.
5. Categories map by name at publish; create-on-miss in the personal container.
6. Conflicts: last-writer-wins by version (+updated_at), owner-only makes this rare.
7. Family tab byte-identical: it never reads the new columns.

## Current state (v369)

- Migration `0071_personal_ledger.sql` applied to production 2026-08-24.
- Phase 1+2 client shipped in one pass: provisioning, personal tab, mirror engine
  (active family, windowed). NOT yet built: transfer UI (`kind='transfer'` legs),
  publish-from-personal-to-space, multi-family mirror sweep, full-history backfill
  beyond the window, annotation join display in the personal stream.

## Related
- `docs/features/encryption.md` — DEK/card machinery this reuses verbatim.
- `docs/features/key-card-auth.md` — card mechanics (`genCard`, wraps).
- `research/jtbd-individual-finance.md` — the strategy this implements.
