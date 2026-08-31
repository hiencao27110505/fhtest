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

### Cá nhân tab layout (top → bottom)

Rendered by `renderPersonal()` in `src/js-ui/21-personal.js` into `#pers-body`
(shell in `src/index.html`, `#v-personal`) — one flat `innerHTML` render, no
per-widget re-render. When state is locked/loading/error the whole body is
replaced by a lock card / note instead.

JTBD numbers refer to the four jobs in `research/jtbd-individual-finance.md`
(1 Capture · 2 Privacy · 3 Fairness · 4 Planning); outcomes are Ulwick-style,
from the user's POV.

| # | Widget / section | What it is | JTBD & desired outcome (user POV) |
|---|---|---|---|
| 1 | Header (`.child-hdr`) | Static title "Cá nhân" + "Sổ riêng của bạn. Gia đình không xem được." | **JTBD 2 Privacy** — increase my certainty that entries here are structurally invisible to other members. |
| 2 | Cash-flow card (`.cf-card`) | Focal card, same visual system as the family Finance tab: | **JTBD 4 Planning** — minimize the time it takes to answer "can I still afford things this month?" (the one nagging folk-model question). |
| 2.1 | — Còn lại | "Còn lại tháng này · cá nhân" + big number (income − spend, red if negative). | **JTBD 4** — minimize the time it takes to know my month-to-date position in one glance, no math. |
| 2.2 | — Vào / Ra tiles | "Vào" opens the income sheet (scope personal); "Ra" scrolls to the tx list. | **JTBD 4** — minimize the time to see what came in vs went out; **JTBD 1 Capture** — minimize the effort to record income from where I see it. |
| 2.3 | — Period chart (`#pcf-wow`) | Swipeable Day / Week / Month bars: today-vs-yesterday by buổi · this-vs-last week Mon–Sun · 4 weeks this-vs-last month. | **JTBD 4** — increase the likelihood I notice overspending vs my own normal *before* month-end, at day/week/month grain. |
| 2.4 | — Sync note (`#pcf-note`) | "Đang đồng bộ…" until the mirror has run; empty after. | **JTBD 2** — minimize the effort of keeping two books: increase my certainty that family spend is already counted here (no double entry, no second app). |
| 2.5 | — Daily guide (`#pcf-daily`) | "Còn tiêu được" per period, self-correcting from remaining month budget; failing month blocks day/week wins. | **JTBD 4** — increase the likelihood I reach month-end within budget by knowing today's safe-to-spend number ("tiêu được an tâm"). |
| 2.6 | — Period dots (`#pcf-dots`) | 3 dots to indicate/select the period. | **JTBD 4** — minimize the effort to switch time horizon (support for 2.3). |
| 2.7 | — Action list (`.cf-cta`) | ① Ngân sách cá nhân (shared per-category budget sheet) · ② Xem chi tiêu · ③ Ghi giao dịch (expense modal pre-scoped personal) · ④ Khoản thu chi từ email (+ staged-count badge). | **JTBD 1** — minimize time to record at the moment of spending (③) and minimize transactions left unrecorded by month-end (④ email import); **JTBD 4** — minimize effort to set/check limits (①②). |
| 3 | Tiền đi đâu tháng này (`.psp-card` per space, `#pers-cats`) | One card per space, categories nested inside it (v437 — replaced the old "Các nhóm của tôi" roll-up + separate "Chi theo danh mục" card, which were two unlinked cuts of the same money). Family card = an Apple-Wallet-style **gradient pass** (`.psp-pass`, `--grad-hero` so it tracks the theme; white text + faint shadow for cross-theme legibility): real name (`FAM.familyName` — `P.fams` was never populated, so it used to say just "Nhóm"), "N ảnh mới" subtitle, amount + "bạn đã góp", and a horizontal strip of the family's newest photos with a "+N" overflow chip (photos + subtitle both from `buildMemRecords`, active family only). Below the pass: that space's own category rows. Riêng tư is deliberately **not** a pass — it stays a quiet white `.psp-h` header (lock chip + amount) with its own categories. "Ngân sách" link moved to the section header; the inline spent-vs-budget bar was retired (pacing lives in the daily guide, detail in the budget sheet). | **JTBD 2** — increase the certainty that my contributions to the family are visible and recognized (named place + its moments), private spend stays its own quiet card; **JTBD 4** — see *where* and *on what* in one glance per space; **JTBD 3** (seed) — what I've advanced toward each circle. |
| 4 | Giao dịch của bạn (`#pers-tx`) | Latest 30 txns (emoji · note/cat · date · space or "riêng tư" · −amount). `_unreadable` rows render as locked placeholders and a warning note above the list says they're excluded from totals. | **JTBD 1** — increase my certainty that every khoản is recorded and classified right (personal vs which group); increase my trust that totals are honest (unreadable rows declared, never silently counted as 0). |

## Locked decisions
1. Person is root; personal = own tables + own key. `families.type` stays only for
   real shared spaces (`family`|`friend`|`trip`); `personal` is retired.
2. Personal card = the one secret to protect; space keys shared + socially
   recoverable. **No key escrow, ever.**
3. Ciphertext-only personal tables (E2EE by construction).
4. Double-entry mirror for family→personal; personal-only rows never leave.
5. Family tables + family tab untouched.

## Current state (v438)
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
