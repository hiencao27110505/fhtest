# Personal Ledger (Model Y — person is the root)

## Problem & Why

Family finance is a subset of each member's personal finance. Every user needs a
complete personal picture that survives losing any *space* key. So the **person is
the root**: personal data lives in the user's own tables under the user's own key,
and a "space" (family, later friends/trips) is a *shared* container the person
optionally directs money to. Personal is **not** a family and **not** a space —
folding it into `families` (the earlier "Model X") made personal masquerade as a
family and leaked into every family metric/picker. Model Y drops that.

Chosen over one-stream-with-scopes for **recovery resilience**: your personal
stats rebuild from your one personal key alone; space keys are shared and
socially recoverable. No reliance on OS-keychain sync; the operator can never
read anything (no escrow).

## Architecture

- **Per-user key** — `personal_keys(user_id, kdf_*, wrapped_dek)`, one row per
  user, card-born (own Key Card), provisioned by the `init_personal_key` RPC.
  The DEK is cached client-side in the `fh-keys` IndexedDB under `'p:'+uid`.
- **Owner-scoped, ciphertext-only tables** — `personal_transactions` and
  `personal_incomes` have **no plaintext columns** (only `*_enc`), so E2EE is by
  construction — there is no `off→dual→enc` lifecycle and no enc-guard trigger to
  maintain. RLS: `owner_user_id = auth.uid()` (owner-only, all verbs).
- **Category is denormalised** on the row (`cat_name_enc` + `cat_emoji`) — no
  personal-category table for now; the personal tab groups by decrypted name.
- **The family `transactions`/`categories`/`incomes` tables are untouched.** This
  is the key safety property of the Model-Y implementation: personal lives
  entirely in its own tables, so the family path carries zero new nullable
  columns, RLS changes, or enc-guard rework.

### Double-entry (mirror), preserved
A transaction the user authored in a family is **mirrored** into
`personal_transactions` as a *master*: `space_id` = the family it flows to,
`link_id` → the family copy. So a family expense shows in the family view *and*
in the person's own view (rebuildable from the personal key alone). Personal-only
(private) rows have `space_id = NULL`.

Mirror engine (`src/js-data/19-personal.js`, `fhPersonalMirror`, active family
only): adopt my authored realized `kind='expense'` rows that have no `link_id` —
**reserve `link_id` on the family row first (crash-safe, `.select()` confirms the
row was won), then insert the master**. Reconcile repairs missing masters,
refreshes stale ones (family `updated_at` newer → version bump), self-heals
duplicate masters, and tombstones masters whose family copy is gone. Idempotent
by `link_id`; window-bounded (this + last month); fired promptly on every family
write via `_syncSoon → fhPersonalMirrorSoon` (debounced), plus on hydrate / tab
open.

### Capture
The shared expense modal has a scope chip group (🔒 Cá nhân / 🏡 Gia đình),
**defaulting to personal** (falls back to family if the personal key isn't ready).
Personal scope → `fhPersonalAddExpense` writes a private `personal_transactions`
row; family scope → the unchanged family path, then the mirror copies it. The
Cá nhân tab's quick-add opens this same modal pre-scoped personal.

## Locked decisions
1. Person is root; personal = own tables + own key. `families.type` stays only for
   real shared spaces (`family`|`friend`|`trip`); `personal` is retired.
2. Personal card = the one secret to protect; space keys shared + socially
   recoverable. **No key escrow, ever.**
3. Ciphertext-only personal tables (E2EE by construction).
4. Double-entry mirror for family→personal; personal-only rows never leave.
5. Family tables + family tab untouched.

## Current state (v376)
- Migrations: `0079_personal_model_y` (tables + RPC + RLS revert + retire Model-X
  surface) applied; `0080_drop_model_x_personal` (purge) run. Model X (`0076`
  `0077`) is superseded/reverted; `0078` founder/leave/switch `type='family'`
  guards stay (correct for friend/trip). (All my personal migrations were
  renumbered 0076–0080 to clear the collision below.)
- Built: provisioning, personal key unlock, Cá nhân tab, mirror, scope-picked
  capture.
- **Not built:** transfers (`kind='transfer'` two-leg pairing — schema-ready),
  publish-from-personal→space, friend/trip spaces, annotation (photo/reaction)
  join into the personal stream, full-history backfill beyond the ~2-month window,
  `data-t` i18n for the personal strings (VN-only for now).

## Migration-number note
My personal migrations originally used `0071–0075`, colliding with the partner's
`0071_email_parse_templates` / `0072_merchant_categories`. **Resolved:** mine were
renumbered to **`0076–0080`** (partner's `0070–0072` left as-is). No live-DB
change — they were already applied via MCP under the old names; the renumber is
repo-file-only so `db push` sees unique numbers. Next free is **0081**.

## Related
- `docs/features/encryption.md` — the DEK/card crypto this reuses.
- `docs/features/key-card-auth.md` — card mechanics.
- `research/jtbd-individual-finance.md` — the strategy this implements.
