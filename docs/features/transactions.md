# Transactions & Expenses

## Problem & Why

Every family feature in FamilyHub — budget pacing, category/member breakdowns, memories, alignment — ultimately reduces to one question: *who spent what, on what, and when.* Transactions are that ledger: a flat, filterable, searchable record of spending that every other subsystem reads from or writes into.

Two things make this harder than "insert a row":

1. **Not all money is spent yet.** A family wants to log an expense that hasn't happened — a plane ticket booked for next month, a bill due Friday — without it silently eating into this month's budget the moment it's typed in. That money needs to exist somewhere visible (so the family doesn't double-plan around it) without moving `spent` until it's real.
2. **A future expense someone else typed in shouldn't just become real unilaterally.** If one partner logs "$800 - new couch, next Tuesday," the other partner should get a chance to see and agree to it before it counts as a commitment. That's a lightweight, asynchronous review — not an approval workflow, just a shared "yes, we both know about this."

Transactions & Expenses is the subsystem that stores the ledger, renders it (as a flat list, grouped by month, filtered by category/member, or drilled into from Budget), and owns the single write path — `addExpense()` — that every entry point (the expense sheet, bulk CSV import, receipt-photo capture) ultimately calls.

## Architecture & How It Works

### The in-memory ledger: `txns`

`src/js-ui/60-transactions.js:5` declares `var txns=[]`, a flat array of transaction objects, hydrated from the `transactions` table (see `src/js-data/30-hydrate.js:71`) and kept in sync by the write-through/realtime layer (`src/js-data/50-writethrough-realtime.js`). Each row carries `id` (local, `t<seq>`), `_dbId` (server UUID once persisted), `cat` (category name — a string, not an id, in this in-memory shape), `who`/`by`, `amt`, `date`/`_d`, `month`, and flags: `future` (planned), `photos`, `reviews`.

On load, an IIFE (`60-transactions.js:7-17`) re-derives the current month's `catSpent`, `memberSpent`, and `spent` totals by summing over realized (`!t.future`) transactions in `curMonthKey()` — the aggregates are never trusted as independently-stored truth, they're recomputed from the ledger so nothing can drift out of reconciliation. `addExpense()` then updates those same aggregates incrementally on every realized write (see below) rather than re-summing the whole array each time.

Sort order is newest-first everywhere, via `txNewestFirst()` (`60-transactions.js:25`), which sorts on the real parsed date `t._d` (falling back to `Infinity` for a just-added row with no `_d` yet, so it floats to the top until the next hydrate stamps it). The comment at `60-transactions.js:21-24` documents that this replaced an earlier `txDay()` that sorted by day-of-month only — so "Jun 30" incorrectly beat "Jul 5". That fixed bug, still described in the comment years after the fact, is one of the signals this subsystem has been through real production churn (see Current State).

### `txRow()` — one row, three unrealized-money sources merged

`renderTxns()` (`60-transactions.js:70`) is the shared render path behind the Activity feed, the Recent Transactions home-screen preview, and the full transactions drill-in (`openTxns()`). It merges three fundamentally different "money not yet fully spent" sources into one visual list, each with its own row renderer:

- **`resRow()`** (`60-transactions.js:50`) — an *event set-aside*: money reserved from this month's budget toward a savings goal/event (`events[k].setAside`). Tapping it opens the event, not the expense detail.
- **`futRow()`** (`60-transactions.js:56`) — a *standalone future expense*: a `txns` row with `future:true`. Tapping it opens the same read-first expense detail (`openExpenseDetail`) a realized row would — the detail screen is what differentiates "review this" from "edit this" (see `61-expense-detail.js` below).
- **`txRow()`** (`60-transactions.js:29`) — a *realized spend*: money already counted against the budget.

`renderTxns()` decides which of these to show based on the active filter (`txFilter`): filtering by the synthetic categories `'Events'` or `'Future expenses'` shows only that bucket; any other filter or no filter shows realized transactions (optionally the unfiltered preview also prepends events + future rows ahead of the first 8 realized ones, `60-transactions.js:83`). The full list — search, category chips, sort toggle — lives behind `openTxns()` / `renderTxnScreen()` (`60-transactions.js:97-141`), which groups by month when sorted by date.

### `addExpense()` — the core write path, three branches

`addExpense()` (`60-transactions.js:209-267`) is the single function every expense-creation UI funnels into (the expense sheet directly; CSV bulk import via `submitBulk()`'s loop, `50-sheets-expense-capture.js:659-684`, which sets a `BULK_SAVING` flag to suppress the per-row toast/close/nav tail). It branches three ways on the entered category and date:

1. **`cat==='Event'`** (`60-transactions.js:216-231`) — the "Event" category doesn't create a transaction at all. It creates an `events` row directly: if the date is in the past, the event is marked `achieved:true` and `spent` is bumped immediately (money already gone, goes straight to Memories); if the date is future, `setAside` is set to the full amount instead (money reserved, not yet spent) and `spent` is untouched. Photos attached at creation become the event's memories immediately (`ev.memories=exPhotos.map(...)`, `:221`).
2. **Future date, any other category** (`60-transactions.js:232-245`) — a *proposal*, not a spend. A `txns` row is unshifted with `future:true`, `by:<creator id>`, and an empty `reviews:[]` array. Critically, **no budget aggregate is touched** — `months[cur].spent`/`catSpent`/`memberSpent` are left alone. The toast explicitly says so: *"Sent to the family · set aside once someone agrees"* (`:241`). The money only starts counting once the entity-review/alignment flow (below) marks it aligned — that transition is handled elsewhere, not in `addExpense()`.
3. **Past/today date, any other category** (`60-transactions.js:246-266`) — a realized spend. A `txns` row is unshifted (no `future` flag), and `months[cur].spent`, `.catSpent[cat]`, and `.memberSpent[mkey]` are all updated **in place**, synchronously, in the same call — this is the one branch that actually moves the budget needle. If a photo was attached, `syncExpenseEvent(txns[0])` (`:250`) is called to mirror the expense into a linked, `achieved:true` event so it also surfaces in Events/Memories (see Related — memories.md).

All three branches short-circuit their UI tail (toast, closing the sheet, clearing the draft, navigation) behind `if(!BULK_SAVING)` so a CSV import loop can call `addExpense()` N times and let `submitBulk()` handle one summary toast at the end instead of N individual ones.

Persistence is not done by `addExpense()` itself — it's pure in-memory ledger + aggregate math. `src/js-data/50-writethrough-realtime.js:1-25` wraps `window.addExpense` to additionally diff `txns`/`order` before and after the call, insert the new row via `_dbInsertTxn` (`src/js-data/40-txn-writes-outbox.js`), and — if the write created a linked mirror event — insert that too, in that order, waiting for the transaction's real DB id before writing the event's `source_txn_id` so the link is durable across sessions. The general write-through/outbox/hydrate pattern this relies on is documented once in `../ARCHITECTURE.md`, not repeated here.

### `openCat()` — one detail screen, two callers

`openCat(type, val, month)` (`60-transactions.js:145-191`) is a generalized category/member drill-in screen reused by both the Budget screen and the Transactions screen — it's the same function and the same overlay markup (`#cat-overlay`) regardless of which screen the tap originated from. It branches on `type`:

- `type==='mem'` — a member's paid total for the month, with a percent-of-family-total line, backed by `txns.filter(t => !t.future && t.month===selMonth && memMatch(t.who,val))`.
- `val==='Events'` / `val==='Future expenses'` — the two unrealized buckets described above, each with their own row renderer and "reserved for..." framing instead of a spend/budget bar.
- otherwise (a real category) — the full spend-vs-budget treatment: progress bar, pace comparison (`overBud`/`overPace`/`under` computed from `sp/bd` against `m.dom/m.dim`), and a "log another expense into this category" CTA (`logFromCat()`, `:192`) that's only shown when the month is open (`!m.done`) and the category is real (not one of the two synthetic buckets).

Because `openCat()` is shared, a change to its layout, its row-count/unit copy, or its CTA logic affects both Budget's category cards and Transactions' filter chips simultaneously — there's exactly one drill-in implementation, not two screens that happen to look similar.

### Status model: `realized` vs `planned`, and `created_by` vs `member_id`

The schema (`supabase/migrations/0001_schema.sql:129-147`) backs this with:

```sql
create table transactions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id),
  category_id uuid not null,
  member_id   uuid,                                   -- nullable: planned rows have no payer yet
  note        text,
  amount      numeric(14,2) not null check (amount > 0),
  txn_date    date not null,
  status      transaction_status not null default 'realized',   -- enum: 'realized' | 'planned'
  ...
  check (status = 'planned' or member_id is not null),  -- realized rows MUST have a payer
  unique (id, family_id)
);
```

`status` is the server-side counterpart of the client's `future` flag — a realized row must carry a `member_id` (someone paid), while a planned row can have `member_id is null` because nobody has committed to being the payer yet. `member_id` is the **payer** — who the money came from / is attributed to for `memberSpent`.

`0024_requests.sql:13` adds a second, distinct actor: `created_by uuid` — the **requester**, i.e. whoever typed the proposal in. `created_by` is deliberately separate from `member_id` because the two questions are different: "who is proposing this expense" vs "whose spending it counts against once real." In the client's future-expense branch of `addExpense()`, this shows up as `who`/`fwhoStore` (who the money will be attributed to, chosen in the form) versus `by`/`fby` (the creator id, used to determine whose proposal it is and who is *not* allowed to be the one who aligns it — see below).

### Two different "family agrees" systems — do not conflate

`61-expense-detail.js` renders a **reactions** block for realized transactions (`_exdReactions()`, emoji thrown via `throwReaction()`, backed by the `reactions` table and `62-reactions.js`) and a completely different **review** block for future/proposal transactions (`_gldReviewBlock(item)`, backed by `request_reviews` and `64-requests.js`'s `_entNorm`/`_entPending`/`_entAligned` helpers, `0024_requests.sql:20-31`). These are not two views onto the same mechanism:

- **Reactions** (realized txns) are lightweight, non-blocking, many-per-row, purely social — they never change what a transaction *is*.
- **Review/alignment** (future/proposal txns) is a gate: `futurePending(t)` (`src/js-ui/10-nav-model.js:83`) is true until someone *other than the creator* reacts with 🥰 (`_entAlignedBy`, `10-nav-model.js:79`), and until then the proposal shows a `pend`-tagged "waiting for the family" tag (`futRow()`, `60-transactions.js:62-65`) instead of a plain future-date tag.

`61-expense-detail.js:84-100` picks which block to show and what the single bottom CTA means, based on both axes (`isFuture`, and — for future rows — whether the viewer is the creator or someone reviewing someone else's proposal): a realized row gets Update/Delete; my own pending proposal gets Update/Delete too (I can edit or withdraw what I proposed); someone else's pending proposal gets **Review** as the only CTA (`incoming` in `61-expense-detail.js:86,104-106`) and no Delete (`:98` — it isn't mine to delete). The general entity-review pattern (`_entNorm`/`_entAligned`/`_entPending`, shared with goals and occasions) is documented once in `../ARCHITECTURE.md` and in full contrast with reactions in `docs/features/social-alignment.md` — this doc only notes that the two systems exist and differ, not their internals.

### Read-first detail screen (`61-expense-detail.js`)

Every tap on a ledger row — realized, future, from any screen — lands on `openExpenseDetail(id)` rather than jumping straight to an editor. The screen lays out amount/note/category/payer/date large, shows photos if any, then either the reactions block or the review block per the above, and a single bottom CTA (`#exd-cta`) whose label and handler are the only things that change based on ownership + pending state: `Duyệt`/`Review` → `expDetailReview()` → `openReview('expense', id)` (opens the same review picker goals/occasions use); otherwise `Cập nhật`/`Update` → `expDetailEdit()` → `openEditExpense(id)`, the existing edit modal, opened on top. Delete is a low-prominence arm-then-confirm text control at the foot of the scroll (never a CTA-bar button, per the destructive-button convention), hidden entirely for someone else's incoming proposal (`61-expense-detail.js:98-100`). It hands off to the persisting `deleteExpense()` (wrapped in `50-writethrough-realtime.js`) by seeding `editingTx`/`delArmed` and calling it directly (`61-expense-detail.js:161-164`) rather than re-implementing delete.

### Photos: `transaction_photos`

`0001_schema.sql:152-163` gives each transaction 1:N photos via `transaction_photos`, tied by a composite FK on `(transaction_id, family_id)` with `on delete cascade` — deleting a transaction always cleans up its photos with it, and the client's delete path (`40-txn-writes-outbox.js:321-326`) additionally removes the underlying storage objects before the row (and its cascading photo rows) go away.

## Current State

Production-complete; no known gaps. The realized/planned split, the `created_by`/`member_id` distinction, and the shared `openCat()` drill-in are all live and exercised across Budget, Transactions, Requests, and Memories.

The file carries a heavier-than-average trail of comments documenting past bug fixes rather than just current behavior — e.g. the sort-order fix at `60-transactions.js:21-24` (an old day-of-month sort put "Jun 30" ahead of "Jul 5"; replaced with a real-date sort that's still explained inline years later), and the category-rename cascade at `src/js-ui/20-budget.js:361` (`txns.forEach(t => { if(t.cat===pr[0]) t.cat=pr[1]; })`, since `txns` stores category as a display string rather than an id, a rename has to walk and rewrite every existing row or old transactions silently orphan onto a stale category name). That density of "here's the bug this used to have and why the fix looks like this" commentary, rather than a thin or absent comment trail, is itself a signal of a subsystem that has been hardened against real production incidents rather than one that's still early.

## Related

- `../ARCHITECTURE.md` — the write-through/hydrate/outbox model `addExpense()` and `deleteExpense()` are wrapped into (`src/js-data/50-writethrough-realtime.js`, `40-txn-writes-outbox.js`), and the shared entity-review pattern (`_entNorm`/`_entAligned`/`_entPending`) documented once for expenses, goals, and occasions together.
- `docs/features/budget.md` — the consumer of `months[cur].spent`/`catSpent`/`memberSpent`, the aggregates `addExpense()`'s realized branch updates in place and `openCat()`'s category view renders as a pace/progress bar.
- `docs/features/social-alignment.md` — full contrast between the two "family agrees" systems this doc only distinguishes briefly: reactions on realized transactions (`62-reactions.js`) vs. review/alignment on future proposals (`64-requests.js`, `request_reviews`).
- `docs/features/memories.md` — the mirror-event bridge (`syncExpenseEvent()`, `src/js-ui/40-memories.js:107-123`) that turns a photographed realized expense into a linked, achieved `events` row so it surfaces in Events and the Memories photo grid.
- `docs/features/expense-capture.md` — the UI/UX layer (expense sheet, receipt-photo capture, CSV bulk import) that collects the fields and calls `addExpense()`; this doc covers the ledger and write path those entry points feed into, not the capture UI itself.
