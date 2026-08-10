# Budget & Run-Rate

## Problem & Why

A family sets a monthly spending cap and wants one answer, checked in passing throughout the month: *can we still spend?* That is not the same question as "budget vs. actual" — a family that has spent 40% of its budget on day 10 of a 30-day month is not fine and not over, it's *ahead of pace*, and a family that has spent 40% on day 25 is comfortably under. Static budget-vs-actual can't distinguish those cases; it takes a pace/run-rate signal (spend so far, projected against days elapsed vs. days in the month) to answer the actual question without the user doing the math or opening a spreadsheet.

The signal also has to account for money that is already spoken for but not yet spent — an event funded from this month's budget, or a future expense proposal the family has aligned on — otherwise "safe to spend" would overstate what's actually free. `monthReserved()` folds those unrealized set-asides in so the headline number (`safe = budget − spent − reserved`) is the number that actually matters, not just the ledger total.

Per-category budgets exist for the same reason at finer grain (a family can be under overall budget while blowing through "Ăn ngoài"), but they create a bookkeeping problem: named categories rarely sum exactly to the monthly total, categories get renamed and deleted, and any scheme that requires the user to keep a running "leftover" bucket by hand will drift and eventually lose money. The "Others" catch-all category exists to make that arithmetic self-correcting rather than something the user has to maintain — see below.

## Architecture & How It Works

### Data model

Three tables carry the budget (`supabase/migrations/0001_schema.sql:75-122`):

- **`categories`** (`:77-89`) — one row per family category (`name`, `emoji`, `color`, `sort_order`), soft-deleted via `archived_at` rather than hard-deleted. `unique(id, family_id)` makes it a composite-FK target so `category_budgets` and `transactions` can be pinned to the same tenant.
- **`monthly_budgets`** (`:95-105`) — one row per `(family_id, month)`, `budget_total numeric(14,2)`, plus `closed boolean` (the "month is done, no longer accruing" flag that surfaces client-side as `m.done`). `month` is checked to always be truncated to the first of the month.
- **`category_budgets`** (`:110-122`) — one row per `(family_id, month, category_id)`, `amount numeric(14,2) not null check (amount > 0)`. FK's `on delete restrict` to both `monthly_budgets(family_id, month)` and `categories(id, family_id)` — a category or a month-budget can't be deleted out from under an allocation; categories are archived instead (see write-through below).

Both money tables participate in the E2EE `off → dual → enc` lifecycle (`amount`/`budget_total` are covered fields — see `docs/features/encryption.md` "Coverage list"); that doc, not this one, owns the encryption mechanics.

### The client-side model — `M()`

`src/js-ui/10-nav-model.js:44-48` keeps an in-memory `months` map, one entry per calendar month, keyed by a 3-letter month abbreviation:

```js
months[key] = { label, short, done, dim, dom, spent, budget, catSpent: {}, memberSpent: {} }
```

`M()` (`10-nav-model.js:48`) returns `months[selMonth]` — the currently-viewed month's record. `dim`/`dom` are "days in month" / "day of month" (day-of-month is clamped to `dim` for a past month, since there's no "day 31 of a already-closed month" — see hydrate below); `catSpent`/`memberSpent` are running per-category and per-member totals for *realized* spend only. This record is rebuilt wholesale on every hydrate (`src/js-data/30-hydrate.js:219-247`): `monthly_budgets` rows seed `m.budget` and `m.done` (`:231`), then every transaction is walked once, bucketed into the right month by `txn_date`, and — if realized (`status !== 'planned'` and dated `<= now`) — added into `m.spent`, `m.catSpent[catName]`, `m.memberSpent[who]` (`:242-245`). All of `renderBudget()`'s numbers are read straight off this one record; nothing in `20-budget.js` queries Supabase directly.

### `monthReserved()` — the seam to goals, events, and transactions

`monthReserved()` (`10-nav-model.js:85`) is the sum of two independent unrealized-money sources, both defined in the same file:

- `eventsReserved()` (`:56`) — sums `events[k].setAside` for every event that isn't `achievedNow()` yet (an event becomes a "memory" only once its date passes, per `achievedNow()` at `:53`). This is money a family has committed to an occasion/goal but hasn't spent — the events/goals subsystem's concern, not budget's; this doc only consumes the number. See `docs/features/goals.md` for how `setAside` gets populated.
- `futureExpReserved()` (`:84`) — sums standalone future/planned expenses logged in the expense sheet, but *only* once aligned: a future expense with a creator is a proposal until another family member reacts 🥰 (`futureAligned()` / `_entAlignedBy()`, `:79-83`); a legacy future expense with no creator (pre-collaborative-proposal data) reserves unconditionally. See `docs/features/transactions.md` for the proposal/alignment/reaction mechanics themselves.

`monthReserved()` is called from `renderBudget()` (`20-budget.js:5`, guarded to `0` once the month is `done` — a closed month has nothing left to reserve against) and independently from the home-screen hero, event/gallery "safe to spend" copy, and the toast shown right after logging an event expense (`22-home.js:364`, `65-events-gallery-peek.js:271,309`, `60-transactions.js:228`) — all of those recompute the same formula rather than reading a shared cached value, so they can drift only if the underlying `M()`/`events`/`txns` state itself is stale.

The practical effect: budget doesn't just answer "what have we spent," it answers "what have we spent plus what have we already promised," which is the number a family actually needs before deciding whether a new purchase is safe.

### The "Others" catch-all — a design invariant, not a default category

`CAT_FALLBACK = 'Others'` (`20-budget.js:205`) is not an ordinary category a user happened to create. Three invariants are enforced in code, not by convention:

1. **It always exists.** `ensureFallbackCat()` (`:208-214`) pushes it onto `catOrder` (and seeds `catStyle`/`catBudget` entries) if it isn't already present, and is called both at hydrate time (`30-hydrate.js:199`) and every time the budget sheet is opened or saved (`syncFallbackBudget()`, `fillBudgetSheet()`, `setBudget()`).
2. **It can't be deleted or renamed away.** `catRowHTML()` renders its row locked (`lock=isFallbackCat(name)`, `:216`): the name input is `readonly`, and the delete button is replaced with an inert lock icon (`:227-229`). `setBudget()` additionally forces the name back to `CAT_FALLBACK` even if the (readonly, but defense-in-depth) input somehow carried something else: `if(isFallbackCat(orig)) name=CAT_FALLBACK;` (`:352`).
3. **Its budget amount is *derived*, never hand-entered.** `fallbackShare(total, budget, order)` (`:234-237`) computes `max(0, total − sum(every other category's budget))`. The catch-all's row in the sheet is `readonly` for the same reason categories are locked (`:221-226`), and gets recomputed live as the user edits other rows (`syncFallbackRow()`, `:244-260`, wired to every other row's `oninput`/`onblur`). `syncFallbackBudget()` (`:239-242`) does the same recompute for the non-sheet (already-saved) state, called at the top of every `renderBudget()` (`:3`) so the catch-all is never stale even outside the edit sheet.

Why this matters: categories in this app are edited by name, and `setBudget()` cascades renames into `txns[].cat` and every month's `catSpent` (`:360-363`), and archives removed categories server-side rather than hard-deleting them (`window.__catDeletes`, consumed by the write-through in `_dbSaveBudget()`, `src/js-data/50-writethrough-realtime.js:248-256`). If the catch-all's amount were just another hand-typed number, a rename or delete elsewhere in the category list would leave money unaccounted for — either double-counted or silently dropped from the total. Deriving it as a remainder makes "total minus everything named" hold as an invariant regardless of how the named categories churn: rename `"Ăn ngoài"` to `"Ăn uống"` and its budget follows the rename; delete a category and its budget amount flows back into `Others` automatically on the next `fallbackShare()` recompute, rather than vanishing.

`isFallbackCat()` (`:206`) — a case-insensitive, trimmed compare against `CAT_FALLBACK` — is also how the rest of the codebase (`renderCatBudget()`, `renderFinanceHero()`, `30-hydrate.js`'s category-resolution fallback for orphaned transactions at `:238-239`) recognizes the catch-all without relying on object identity, since it's rebuilt fresh on every hydrate.

### Auto-split (`suggestBudgetSplit`) and the "don't wipe hand-tuned categories" invariant

`suggestBudgetSplit()` (`:324-340`) fills in categories the user hasn't set by hand, using best-practice weights (`CATW`, `:297`) normalized over only the *untouched* rows, after subtracting whatever's already claimed by touched rows from the pool. A row becomes "touched" (`markCatTouched()`, `:303`, wired to every category amount input's `oninput`) the moment a user edits it directly, or if it arrives from the DB with a nonzero saved amount (`catRowHTML()`, `:223`: `data-touched="1"` when `budget` is truthy). The comment at `:298-302` documents the bug this fixes: editing the monthly total used to re-run the split over *every* category on each keystroke, silently overwriting amounts the user had just hand-tuned, with no undo. Touched-row tracking is the fix — the split pool only ever spends what untouched rows haven't already claimed.

### Rendering fan-out

`renderBudget()` (`:2-52`) is the entry point for the Budget tab: it recomputes the catch-all (`syncFallbackBudget()`), reads `M()`, computes `pctSpent`/`pctPace`/`safe`, and drives the hero progress bar, the "safe to spend" copy (with a same-pace-vs-over-pace/over-budget status split), the reserved-money striped segment, and the historical trend chart (`renderTrend()`, `10-nav-model.js:117-136`). It ends by calling `renderCatBudget()` (per-category rows with their own over-budget/over-pace status and a future-reserved stripe, `:134-164`) and `renderFinanceHero()` (the single allocation ring + daily-spend bar chart + category legend used on the home screen, `:56-131`).

`renderAll()` (`:186`) is the app's central re-render fan-out: `renderBudget() + renderMembers()` plus optional calls into `renderReqMounts()` (collaborative request badges) and `renderHome()`, each individually try/caught so a missing optional renderer never breaks the budget refresh. It's called after nearly every state-mutating action in the app — `setBudget()` (`:370`), `selectMonth()` (`:199`), logging or editing a transaction (`50-sheets-expense-capture.js:688`, `55-expense-photos-writes.js:327,352`, `60-transactions.js:146,222,236,255`), funding/archiving an event (`65-events-gallery-peek.js:318`), reacting to a request (`64-requests.js:262`), settings changes (`60-settings-family-ui.js:340`), and boot/hydrate/snapshot-restore (`80-onboard-boot.js:206,340`, `30-hydrate.js:362`, `17-snap-restore.js:105`). There is no finer-grained dirty-tracking — any write that could plausibly move a number re-runs the whole budget+members(+home) render pass.

### Write-through

`setBudget()` itself (`20-budget.js:341-371`) only mutates in-memory state (`M().budget`, `catOrder`/`catStyle`/`catBudget`, plus `window.__catRenames`/`window.__catDeletes` for the write-through layer to consume) and calls `renderAll()` — it does not talk to Supabase directly. `src/js-data/50-writethrough-realtime.js:272-273` wraps it: `window.setBudget = function(){ ...; _origSetBudget.apply(...); _dbSaveBudget(); }`. `_dbSaveBudget()` (`:236-271`) then, in order: applies queued category renames as `categories.update` (keeping `DB.catByName` in sync so later lookups resolve), archives queued deletions (`category_budgets.delete` + `categories.update({archived_at})`), upserts `monthly_budgets` (routed through `fhField('budget_total', ...)` so the encrypted-field envelope is respected, with `0` as the explicit NOT-NULL placeholder when the plaintext column is scrubbed — see `docs/features/encryption.md`), then upserts or deletes each `category_budgets` row depending on whether its derived/entered amount is `> 0`. This is the general FamilyHub write-through pattern (optimistic local mutation → `renderAll()` → async persist) — see `../ARCHITECTURE.md` for the pattern's shape outside budget specifically.

## Current State

Production-complete; no known gaps. The code shows real iteration rather than a first pass:
- The touched-row/auto-split logic (`suggestBudgetSplit`, `markCatTouched`) exists specifically because an earlier version silently wiped hand-tuned category amounts on every keystroke of the total field (comment at `20-budget.js:298-302`).
- Category delete is arm-then-confirm (`armCatDelete()`, `:307-323`, tap once to arm + red state, tap again within 3s to actually remove) rather than a single tap, to avoid an accidental delete of a category with real budget history.
- Both money fields (`monthly_budgets.budget_total`, `category_budgets.amount`) are already wired into the E2EE coverage list and the `enc`-state-aware write path (`fhField`/`fhRead`), not bolted on after the fact.
- Reserved-money accounting (`monthReserved()`) already accounts for the alignment/proposal semantics of collaborative future expenses (`futureAligned()`), not just a flat sum of everything marked "future."

## Related

- `../ARCHITECTURE.md` — the shared `M()` per-month model concept and the general hydrate → optimistic-mutate → write-through pattern used across the app, not just budget.
- `docs/features/goals.md` — owns `events[k].setAside` and how event/goal funding gets set aside from a month's budget; `eventsReserved()` here only consumes that number.
- `docs/features/transactions.md` — owns future/planned expense creation, the proposal/reaction/alignment mechanics (`_entReviews`, `futureAligned`), and how realized transactions roll up into `M().spent`/`catSpent`/`memberSpent` at hydrate time; `futureExpReserved()` and the `catSpent`/`memberSpent` aggregates here only consume that data.
- `docs/features/encryption.md` — the `off → dual → enc` lifecycle and coverage list that `monthly_budgets.budget_total` and `category_budgets.amount` participate in.
