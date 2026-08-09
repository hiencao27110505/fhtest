# Saving Goals

## Problem & Why

A family wants to save toward something specific — a trip, a gadget, a wedding gift — funded out of money the family has already set aside, not out of a fresh line of credit or a new budget category. This is deliberately a different mental model from monthly budget tracking (`docs/features/budget.md`): budgets constrain *this month's* spend against categories; a saving goal accumulates toward a *target amount* over an unbounded time horizon, drawing from a shared savings pool the family tops up whenever it likes.

A goal is sometimes tied to a real-world occasion the family is also planning or remembering (a trip, a birthday) and sometimes not (an emergency fund, "new laptop" with no date attached). Conflating "the money" and "the moment" into one required object forced every goal to carry a target amount even when the underlying thing was moneyless (a free picnic), and forced every memory-worthy occasion to declare a savings target even when there wasn't one. `saving_goals` (money, lives in Thu Chi) and `events` (moments, lives in Khoảnh Khắc — see `docs/features/memories.md`) are two independent tables now, linked only optionally via `occasion_id`.

A goal can also arrive as a family proposal rather than a unilateral write — any member can suggest a goal, and the rest of the family reviews it before it's treated as "aligned," reusing the same requests/review mechanism used for expenses and occasions (`docs/features/social-alignment.md`).

## Architecture & How It Works

### The goal/occasion split (0019–0021)

This is the foundational schema decision the rest of the feature sits on. It happened in three additive, non-breaking stages:

- **`supabase/migrations/0019_occasions_optional_money.sql`** — first made `events.target_amount` nullable (`:18`) and added `events.is_occasion boolean not null default true` (`:28`), so a single `events` row could independently carry a "money facet" (non-null `target_amount`) and a "moment facet" (`is_occasion`). Comment at `:3-14` frames this as two facets of one row, not yet two tables.
- **`supabase/migrations/0020_saving_goals.sql`** — created `saving_goals` as its own first-class table (`:14-32`): `id, family_id, name, emoji, cover, target_amount not null check > 0, target_date, note, occasion_id (nullable FK to events), achieved, sort_order, archived_at`. `occasion_id` is the *entire* link mechanism — a goal optionally points at an occasion row in `events`, and nothing else ties them together (`:6` states this explicitly: "OPTIONAL link"). The migration backfills every pre-existing event that had a target amount into a `saving_goals` row whose `occasion_id` points back at the source event (`:62-69`), and re-attributes existing `event_fundings` rows to the new `goal_id` column added onto that table (`:37-41`, `:71-74`).
- **`supabase/migrations/0021_funding_goal_or_event.sql`** — made `event_fundings.event_id` nullable and added a check constraint requiring at least one of `event_id`/`goal_id` to be set (`:8-12`), so a pure goal with no occasion (no `event_id`) can have its own funding rows.

Net result: a "goal" is money (`saving_goals.target_amount`, always `> 0`), an "occasion" is a moment (`events`, target amount now optional again post-0019), and `occasion_id` is the sole, optional bridge. `event_fundings` is the shared ledger of contributions and can point at a `goal_id`, an `event_id`, or (historically) both.

### Client-side model (hydrate → `window.goals`)

`src/js-data/30-hydrate.js` fetches `saving_goals` and `event_fundings` (via `get_family_snapshot`, `supabase/migrations/0048_snapshot_windowing.sql:98-101` and `:73-76`) and builds `window.goals`/`window.goalOrder` at `30-hydrate.js:307-330`:
- `savedByGoal[goal_id]` is the sum of every `event_fundings` row's `amount` where `goal_id` matches (`:312-318`) — a goal's `saved` figure is *always* derived from funding rows, never stored directly on `saving_goals`.
- A goal backfilled from a photo-expense "mirror event" (an `events` row auto-created behind a photographed expense) is filtered out of the Thu Chi list (`:322-325`) — those aren't real goals, they're an artifact of the expense/memory mirror mechanism.
- The savings pool itself (`window.savings`) is computed independently at `:347-351`: `sum(savings_entries deposits) − sum(savings_entries withdrawals) − sum(event_fundings where source='savings')`, floored at 0. A goal's `saved` and the pool's balance are two separate derivations over the same `event_fundings` table, filtered by `goal_id` vs. `source`.

### "Done" means fully funded, not merely overdue

`src/js-ui/35-goals.js:1-4`:
```js
function achievedGoal(g){ return !!(g && (g.achieved || (g.target>0 && g.saved>=g.target))); }
```
A goal is `achievedGoal()`-true only if `g.achieved` (a stored override) or `g.saved >= g.target`. A goal whose `target_date` has passed while still underfunded is *overdue*, not done — `renderGoals()` renders that state as a separate red "quá hạn/overdue" badge (`35-goals.js:30`, `36-goal-detail.js:64`) rather than treating the goal as achieved. This deliberately diverges from `events`' own `v_event_status` view (`supabase/migrations/0002_views.sql:23-28`), where `achieved` is `stored flag OR target_date < today` — that "achieved-by-date" semantics is specific to occasions/events, not goals. `renderGoals()` (`35-goals.js:5-41`) uses `achievedGoal()` to split goals into "active" (drives the savings-pool progress bar and the "due soon" badge, `:6-21`) vs. fully-funded (still listed, sorted after active ones, so nothing a user created disappears — `:22-26`).

### Fund, edit, delete (`src/js-data/70-goals-income-onboard-ui.js`)

- **`fhCreateGoal`** (`:3-23`) inserts a `saving_goals` row via `fhField('name', ...)` / `fhField('target_amount', ...)` (encryption-aware — see below), fires a `request_new` notification so other devices get nudged to review the new proposal (`:12-13`), and if an initial amount was given, inserts a matching `event_fundings` row with `source: 'savings'` (`:14-16`) — every goal, even a brand-new one, is funded exclusively through `event_fundings`.
- **`fhFundGoal(goalId, amount)`** (`:25-36`) is the "add money" action: one more `event_fundings` insert with `source: 'savings'`, drawing from the pool. There is no server-side check that the pool can cover it — the client clamps the amount to `window.savings` before calling (`src/js-ui/35-goals.js:80-82`); the view-layer note in `0002_views.sql:99-101` ("no guard stops savings-source fundings over-drawing the pool... fine for a small trusted family") applies here too.
- **`fhEditGoal`** (`:40-76`) updates `name`/`target_amount`/`target_date` in place; it never touches `event_fundings`, so editing a target amount does not retroactively refund or re-request money.
- **`fhDeleteGoal` / `fhConfirmDeleteGoal`** (`:79-116`) is an arm-then-confirm soft-delete that calls the **`archive_goal`** RPC (`supabase/migrations/0037_archive_goal.sql`). This is a **full reversal**, not just a delete:
  ```sql
  delete from event_fundings where goal_id = p_goal_id and family_id = v_family;
  update saving_goals set archived_at = now() where id = p_goal_id and family_id = v_family;
  ```
  Deleting every `event_fundings` row for the goal (rather than just archiving the goal and leaving fundings in place) means:
  - **Savings-sourced money returns to the pool** — because the pool balance (`30-hydrate.js:347-351`) subtracts `source='savings'` fundings, removing those rows increases `window.savings` on the next hydrate with no separate refund step needed.
  - **Budget-sourced money is backed off that month's spend** — `v_month_spent` (`0002_views.sql:31-47`) sums budget-source `event_fundings` for *achieved* events/goals as realized spend; removing the funding row removes it from that month's total, which can rewrite a past month's totals. The migration's own comment (`0037_archive_goal.sql:6-8`) calls this out as a deliberate choice: "chosen over stranding the money in a goal the user can no longer see."
  - The goal row itself is soft-deleted (`archived_at`), consistent with events/members/categories — recoverable in the database, invisible in the app (the snapshot query filters `archived_at is null`, e.g. `0048_snapshot_windowing.sql:101`).
  - `fhDeleteGoal`'s confirm sheet names the exact consequence to the user before they commit (`70-goals-income-onboard-ui.js:83-91`: "`<saved>` will go back to your savings" vs. "nothing has been put toward this goal yet").

  `src/js-ui/36-goal-detail.js` mirrors `61-expense-detail.js` as a read-first detail screen (module comment `:1-10`): opening a goal row shows the goal large, its progress meter, a meta list (target/saved/still-to-save/date/occasion link), and — only when the goal has a `creatorId` (i.e., it came in as a proposal, not a unilateral write) — a review block. That block (`_gldReviewBlock`, `:25-39`) is built on the exact same primitives the requests feature uses for expenses (`_entNorm`, `_entAligned`, plus `_reqName`/`_reqReactLabel` from `64-requests.js`): `_entNorm('goal', g, id)` (`:46`) normalizes the goal into the shared review-item shape, `_entAligned(item)` determines whether at least one other family member has reacted with 🥰, and the same "waiting for one family member to agree" / "aligned" banner and per-reviewer reaction rows render for a goal proposal as for an expense or occasion proposal. This shared pattern (`_entNorm`/`_entAligned`) is documented once in `../ARCHITECTURE.md` rather than re-explained per feature — see that doc for the full mechanics; this file only notes that goals are one of its three consumers (expenses, goals, occasions).

### `fhSavings()` — the encryption-aware branch

`fhSavings()` (`70-goals-income-onboard-ui.js:117-153`) is the "set the pool total" modal (Settings/Finance snapshot "Saved for events"). It is a concrete, small example of how the encryption model (`docs/features/encryption.md`) constrains a specific write path — cite that doc for the model itself; here's how it bites this feature specifically:

- **`enc_state === 'off'`**: calls the `set_savings(p_amount)` RPC (`supabase/migrations/0010_income_savings_members.sql:132-148`), which computes the delta *in SQL* (current balance vs. requested total) and inserts the single adjusting `savings_entries` row server-side.
- **`enc_state !== 'off'` and the key is loaded (`fhKeyReady()`)**: the RPC path is impossible — `amount` on `savings_entries` is ciphertext server-side once `dual`/`enc` is in effect, so Postgres cannot diff "current balance" against "requested total" the way `set_savings` does. Instead the client, which already holds the decrypted pool total in `window.savings` (populated at hydrate via `_decRows`, `30-hydrate.js:116-133`), computes `delta = base - window.savings` itself (`:138`) and writes the adjusting `savings_entries` row directly from JS via `fhField('amount', ...)` / `fhField('note', ...)` (`:142-144`), bypassing `set_savings` entirely. The comment at `:133-136` states the reasoning inline: "`set_savings` computes the pool delta in SQL — impossible once amounts are ciphertext... the client already knows the pool... it writes the adjusting entry itself; the plain RPC stays for unencrypted families."

This is a general shape worth recognizing elsewhere in the codebase: any aggregate-then-diff RPC that works over plaintext amounts needs a client-side equivalent once a family encrypts, because the server can no longer see the numbers well enough to compute deltas.

### Income is a separate, deliberately non-auto-saved ledger

`fhIncome()` / `fhDelIncome()` (`70-goals-income-onboard-ui.js:156-223`) manage the `incomes` table (`0010_income_savings_members.sql:4-26`) — a flat ledger of money coming in, with its own `member_id`, `amount`, `note`, `income_date`. It is intentionally disconnected from the savings pool: the modal's own copy says so explicitly (`:181`, "*Tiền vào của cả nhà, ghi riêng, không tự động để dành* / Money coming in, tracked on its own, never auto-saved"). Nothing in `fhIncome`/`fhDelIncome` touches `savings_entries` or `event_fundings`; `window.monthIncome` (`30-hydrate.js:353-356`) is purely informational on the Thu Chi snapshot and never feeds the reserved/safe-to-spend budget math. Moving money from income into savings is a manual, separate step (topping up the pool via `fhSavings()`, or funding a goal directly).

## Current State

Functionally complete: create/fund/edit/delete goals, savings-pool top-up, and a fully separate income ledger are all shipped and wired to realtime hydrate. Delete is a full reversal (not a stub) — `archive_goal` actually deletes the funding rows and lets the pool/month-spend math recompute naturally rather than leaving orphaned fundings behind. The encryption-aware branch in `fhSavings()` is live for both `dual` and `enc` families, not just planned.

The feature was built as a deliberate multi-stage migration rather than a single cutover, and each stage's own SQL comments narrate the reasoning:
- `0019` → `0020` → `0021` split one "event" object into `saving_goals` (money) + `events` (moments), each stage additive/non-breaking, each documented in-file as "Stage N of the split."
- `0037` (delete-reversal) shipped later, explicitly mirroring the pre-existing `0013_archive_event.sql` pattern for events rather than inventing new semantics.
- Encryption coverage for `saving_goals` (`target_amount`, `name`, `note`) and `event_fundings.amount` came later still via the `0033`/`0038` enforcement triggers and the `_ENC_TABLES` coverage list (`docs/features/encryption.md`), at which point `fhSavings()` grew its client-side-delta branch to keep working under ciphertext.

No further schema work is indicated in the migrations after `0037`/`0038` for this feature specifically — goals-related changes past that point are incidental (indexing, snapshot windowing) rather than behavioral.

## Related

- `../ARCHITECTURE.md` — the shared entity-review pattern (`_entNorm`/`_entAligned`) used identically by goals, transactions, and occasions; documented once there.
- `docs/features/budget.md` — the savings pool total (`window.savings`) surfaces in the Finance hero/Home snapshot (`src/js-ui/20-budget.js:21,58`), alongside monthly budget figures this feature is deliberately distinct from.
- `docs/features/memories.md` — the `events` (occasions) side of the `occasion_id` link; owns the "moment" facet split out of the old combined object in `0019`.
- `docs/features/social-alignment.md` — the requests/review system (`src/js-ui/64-requests.js`) that goal proposals (`creatorId` present) are reviewed through, including alignment thresholds and notification.
- `docs/features/encryption.md` — the `fhField`/`fhRead` and `enc_state` model that `fhSavings()`'s client-side-delta branch exists to work within.
