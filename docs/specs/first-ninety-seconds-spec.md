# The first ninety seconds — show the picture while it reads, not after

A brand-new user grants mailbox access and then waits. Today that wait is about
twenty minutes for a 365-day window, and for most of it the progress bar does
not move. Measured in a UT session on 2026-09-26: the counter held at `24/365`
for 45 seconds and at `47/365` for 55 more. The participant concluded the app
had frozen three separate times, the phone warmed, and they eventually left the
device and came back to find it done.

The freeze is not a bug in the bar. The bar is honest about what it measures —
it just measures the wrong thing. This spec makes the wait short, makes the
progress reflect work rather than a cursor position, and puts the money picture
on screen **while** the read runs instead of after it.

> **Status, 2026-09-27. SERVER HALF + REVEAL BUILT** (§2, §2b, §8b, §9b):
> 45-day first slice, slice chaining with carried pacing and model budget,
> migration `0153_first_slice`, phase `deepening` on the client, queue hold
> released at first light with the 3-day dup-unsafe band filtered. The
> PROGRESSIVE TREE (§3, problem 02's fix) is NOT built yet — during a first
> slice the screen still shows progress only; the picture appears at slice
> completion (~60-120s) instead of at 100% (~8-12 min). Duration analysis that
> sized all of this: the 5 Whys block in the UT report, verified against code
> and production on 27/09. Free-tier limits assessed the same day: Gmail's
> measured ~6,000 units/user/min (self-cap 4,500) is the binding constraint;
> a full year is quota-bound at ~8 minutes whatever the code does.

> **How this relates to its siblings.** `activation-journey-spec.md` §5c is what
> this spec amends: its revision of 2026-09-24 made reading mode progress-only
> and explicitly rejected assembling the picture live, citing heavy re-renders
> and half-true numbers. §9 below argues the first cost is avoidable and the
> second is already solved by decisions Q3b and Q13b in that same document,
> which permit staged rows in the chart and tree with an unconfirmed marking.
> Everything else in that spec stands. `direct-mailbox-read.md` owns the
> pipeline; §8 changes the first window's size and the chaining, and nothing
> about how a window is read, sealed or deduplicated. `email-reading-v2-spec.md`
> owns reader accuracy and is untouched.

---

# Part 1 — Behaviour

## 1. Summary

- **Two changes, one moment.** The first read gets short (§2) and the picture
  gets progressive (§3). Either alone fails the acceptance criterion: a fast
  read that still shows nothing, or a live tree that takes twenty minutes.
- **The window the person chose is still the window they get.** Someone who
  picks 365 days still receives 365 days. They stop having to watch it arrive.
- **The progress bar must measure work, not a cursor.** Today the client infers
  "days read" from the `occurred_at` of the **oldest pending staged row**. That
  number only moves when a run stages something older than anything already
  staged, so the entire gap between runs is a flat line. The observed 45-to-55
  second freezes are almost exactly the one-minute backfill lane interval.
- **Live rendering costs unsealing, not re-rendering.** Rows are sealed
  per-person, so the device must open each one before it can be categorised.
  That work already happens — it is deferred into a single blocking pass, seen
  as "Đang mở khoá 741/806". Spreading it across the read moves work that
  already exists and deletes the blocking screen.
- **No number on screen is ever fake.** Only rows actually unsealed are counted.

## 2. The first read is short; history deepens behind it

`mailbox_grants.backfill_days` (migration `0093`, default 90, clamped 1 to 365)
is set once by `grant_mailbox_access` and read by the worker. This spec splits
what that number means into two phases:

- **The first slice** — a fixed short window, proposed at **45 days**, read by
  the connect kick. Sized so a typical Vietnamese mailbox clears the activation
  threshold of roughly 20 transactions several times over; the mailbox in the UT
  produced 61 transactions in its first 24 days.
- **The remainder** — from the end of the first slice back to the chosen window,
  read afterwards at the ordinary pace with nobody watching.

The person is told this once, plainly, on the reading screen: recent months are
ready now, the rest is still arriving. No second progress bar, no second waiting
state. The deepening reports on the email card like any other background
arrival.

**Why 45 and not 30.** Thirty days can miss a whole monthly cycle — a salary, a
card statement, a rent payment — and a picture missing its largest recurring
item reads as wrong rather than partial. Forty-five days guarantees at least one
of every monthly event wherever it falls in the calendar.

## 2b. First light releases the hold; a 3-day band stays back

When the first slice completes the grant gets `first_slice_at` (0153) and the
client's phase becomes **`deepening`**: the queue hold (`fhBackfillHolds`)
releases and the review screen opens on the slice while history keeps arriving
behind it.

The duplicate constraint that justified the hold is honoured more precisely
instead of more broadly. Dedup pairs live within ±3 days, so a staged row can
only be missing a twin if it sits within 3 days of the frontier. While
deepening, the review fetch therefore excludes rows with `occurred_at` inside
`frontier + 3 days` — everything older than that band has every possible twin
already staged and is exactly as dup-safe as a finished read. The band shrinks
to nothing when `backfilled_at` lands. A one-line note on the review screen
says the tail is still arriving.

## 2c. Slices chain; the minute lane becomes the fallback

A capped backfill run no longer returns to the once-a-minute lane. When it
ends with work remaining (`hitLimit || moreQueued`, or a first slice just
completed), it re-POSTs its own grant to `mailbox-sync` via
`EdgeRuntime.waitUntil` — the connect kick's own mechanism — and the next
slice starts in seconds. Two things travel in the chain body, because a fresh
invocation must not mean a fresh allowance:

- **the Gmail pacing window** (`unitsAt`, `unitsSpent`): back-to-back links
  share one 4,500-units-per-minute budget, so chaining removes idle time
  without raising per-minute spend by one unit;
- **the remaining model budget**: a cold mailbox must spend its chain on Gmail
  work, not on bouncing off Gemini's per-minute wall.

A depth counter caps runaway chains; the minute lane stays untouched as the
crash fallback, and the 0145 lease keeps a chain link and a lane tick out of
the same mailbox.

## 2d. Progress the person can track

While reading or deepening, the surfaces show numbers that actually move: the
found count (already live via the v587 delta loop), the frontier date, and an
**ETA derived client-side** from the frontier's observed rate — no server
column, no estimate the server has to promise. The deepening state names
itself on the email card ("đang đọc tiếp về trước · còn ~N phút") instead of
pretending to still be the first read.

## 3. The picture assembles while it reads

The screen keeps two states; the first stops being empty of content. While the
read runs:

- Rows are unsealed **in batches as they arrive**, not all at once at the end.
- The category tree and the chart are recomputed from what has been unsealed so
  far, at most once every few seconds.
- The "vừa tìm thấy" feed carries an **amount and a merchant** per row, not only
  a provider and a date. This also closes the feed half of report problem 16.
- The blocking unlock pass at the end disappears, because by the time the read
  ends almost everything is already open.

**The numbers must not jitter.** Recompute on a timer, never per row. Sort
categories by amount, but once a category has appeared hold its position for the
rest of the read, so the list grows downward instead of reshuffling.

## 4. The progress bar measures work

Replace the inferred day-count as the primary readout. The honest live signals
during a first read are the ones that move continuously:

- transactions found so far (already polled),
- amount accounted for so far (new, and the most meaningful),
- the date frontier, kept as a secondary line rather than the headline.

The day-count may stay as supporting text. It must not be the only moving part,
because between runs it cannot move at all.

## 5. What the screen shows, moment by moment

| Moment | On screen |
|---|---|
| 0s, back from Google | Progress header, first slice named, empty tree frame with its heading |
| ~5s, first rows sealed | Feed shows arrivals with amounts; tree shows its first categories |
| 5 to 90s | Tree fills, bars appear, totals climb, feed keeps moving |
| First slice done | Flips to the full review surface: toolbox, stats, tree, rows, import CTA |
| After | A quiet line says older months are still arriving; the email card agrees |

## 6. Deliberately unchanged

- How a window is read, parsed, sealed, deduplicated or staged.
- Import as the single confirmation act.
- The five hold reasons, and the rule that the cursor moves last and only on a
  finished window.
- The queue hold during backfill (§9 explains why it must survive).

## 7. Acceptance

Verbatim from the UT report, so implementation and adjudication cannot drift:

- From tapping **Cho phép đọc email** to a category tree showing real amounts:
  **under 90 seconds**, window set to 365 days.
- No interval longer than **5 seconds** in which the screen changes nothing.
- Before the read ends, at least **three categories with real amounts** on
  screen, with values seen to increase.
- The blocking unlock spinner does not appear.
- **Does not count as passed if** met by hiding the day counter, by silently
  narrowing the window, or by rendering placeholder, estimated or skeleton
  numbers. Only unsealed rows count.

Stopwatch on a screen recording, one run, 365-day window.

---

# Part 2 — Technical appendix

## 8. The read loop as it stands

Facts this spec builds on, verified in the source:

| Thing | Value | Where |
|---|---|---|
| Rows staged per backfill run | `BACKFILL_STAGE_MAX` = **180** | `_shared/mailbox/worker.mjs` |
| Run self-stop | `RUN_BUDGET_MS` = **100 s** | same |
| Messages listed per backfill run | `BACKFILL_LIST_MAX` = **2000** | same |
| Model calls per grant | `MAX_MODEL_CALLS_PER_GRANT` = **40** | same |
| Fetch lanes | `FETCH_CONCURRENCY` = **20** | same |
| Backfill cursor | `mailbox_grants.backfill_before`, moved by `advanceBackfill` | `0136` |
| Backfill lane | `_mailbox_backfill_tick()`, **every minute** while any grant has `backfilled_at is null` | `0097` |
| Ordinary lane | `_mailbox_sync_tick()`, every 5 minutes | `0088` |
| Reader lease | `take_mailbox_lease` / `renew_mailbox_lease` / `release_mailbox_lease`, TTL 90 s | `0145` |
| Connect kick | `POST /mailbox-sync {grant:<id>}` → `runOne` → `grantById` | `mailbox-connect/index.ts` |

So the backfill is **not** waiting on the five-minute lane — `0097` already
added a one-minute fast lane that switches itself off when the last backfill
completes. The one-minute gap is what the user experiences as a freeze.

**The progress readout.** The client reads no progress column. `_atxFrontier`
selects the oldest `review_status='pending'` row by `occurred_at asc limit 1`,
floors it in `localStorage` so a missed poll cannot rewind the bar, and
`_atxDaysRead` converts it to a day count against `backfill_days`. `backfill_before`,
`backfill_started_at`, `backfill_requested_at` and `backfill_moved_at` are not
granted to the browser and are not read by any client select.

## 9. Why the original rejection does not hold, and what it got right

§5c rejected live assembly for two reasons.

**Re-render cost — avoidable.** The chart builder is already partial-set
tolerant: with `merged=true` it unions the staged and booked day keys, so a
queue covering part of the window renders honest empty slots rather than
collapsing its axis. The cost only appears if recomputation is per row, which
§3 forbids.

**Half-true numbers — already decided, and correctly.** Q3b and Q13b permit
staged rows in the chart and tree with the unconfirmed marking. A provisional
number is allowed; a fabricated one is not.

**But the rejection was protecting something real, and it must survive.** The
queue is held during backfill (`fhBackfillHolds`) because `csvBuildReview`'s
duplicate bucketing and quick-select counts are only correct against a complete
row set. That is true and is not changed here. The distinction this spec draws:

> Rendering the **chart and the category tree** from a partial set is safe.
> Building the **review surface** — duplicate tiers, quick-select counts,
> the import CTA — from a partial set is not.

So progressive rendering must go through a display-only path that does not build
or mutate the `csvReview` global. The tree builder currently reads that global
via `_clwCollect`, so it needs a variant that takes an explicit row list.

## 10. Where it lives

| File | What changes |
|---|---|
| `supabase/functions/_shared/mailbox/worker.mjs` | first-slice window; chain the next run on slice completion instead of returning to the lane |
| `supabase/functions/mailbox-sync/index.ts` | connect kick reads the first slice |
| `supabase/migrations/NNNN_first_slice.sql` | first-slice bookkeeping on `mailbox_grants`; number claimed at apply time |
| `src/js-data/72-txn-review.js` | `_rvwReadingScreen` renders tree + chart; batch unseal during the read; keep `fhBackfillHolds` gating the review surface |
| `src/js-ui/56-csv-import-ui.js` | `_clwCollect` variant taking an explicit row list; throttled recompute; stable category order |
| `src/js-data/74-autotxn-ui.js` | progress state carries amount-accounted; feed rows carry amount and merchant |
| `src/js-ui/20-budget.js`, `src/js-ui/21-personal.js` | email-card copy for the deepening state |

## 11. Progressive unseal

`fhReadStagedRow` is called in a strictly serial loop today, one `await` per
row, with `i % 20 === 0` gating only the label update and the paint yield. There
is no batching and no parallelism — twenty sequential `nacl.box.open` calls per
frame. Two changes:

- Unseal only what is **new since the last tick**, appending to an in-memory set.
- Open rows in small concurrent batches rather than strictly one at a time.

Invariants:

- **Never recompute per row.** A dense mailbox stages in bursts; per-row
  recompute is exactly the cost §5c was right to fear.
- **A row that fails to open is counted and skipped**, never rendered as a zero
  or as "Khác". A key mismatch must not become a category.

## 12. Failure modes

| Case | Behaviour |
|---|---|
| First slice yields nothing | Screen does not wait out the remainder; it flips and offers statement import and manual entry per the sparse-yield rules |
| A chained run fails mid-slice | Cursor has not moved; the one-minute lane picks it up as today; the screen keeps what it unsealed |
| Person leaves the screen | Unchanged: read continues server-side, email card reports it |
| Remainder never completes | The chosen window is not reached; the email card must say so, never present a partial year as complete |
| Personal ledger locked | Nothing can be unsealed, so no tree. Counters only — today's behaviour, and correct |
| Backfill stalls | `stalled_runs` crosses `STALL_NOTIFY_AFTER` (12) and the client's `ATX_STALL_OPENS_AT` (12) releases the queue hold. These two constants are coupled with no shared config and must move together |

## 13. Working rules

- Migration number claimed at apply time, never held.
- `mailbox-sync` diffed against the live deployed version before any deploy.
- Service worker `CACHE_NAME` read from `origin/main` immediately before the
  final build.
- Chaining relies on the `0145` reader lease. Without the lease a chained run
  and a lane tick can enter the same mailbox; with it, chaining is the operation
  the lane already performs, only sooner.

## 14. Decision log

| # | Decision |
|---|---|
| F1 | The first read is a short fixed slice; the chosen window is delivered by deepening behind it. |
| F2 | 45 days, not 30, so at least one full monthly cycle is always included. |
| F3 | The picture assembles during the read. Reverses `activation-journey-spec` §5c's revision of 2026-09-24. |
| F4 | The cost that decision cited is re-render; the real cost is unseal, and that work already happens in a blocking pass. Spreading it removes the pass. |
| F5 | Chart and tree may render from a partial set. The review surface may not — the queue hold stays. |
| F6 | The progress headline becomes transactions found and amount accounted. The day count stays as secondary text because between runs it cannot move. |
| F7 | Recompute on a timer, never per row; hold category order stable within a read. |
| F8 | Only unsealed rows are counted. No estimates, no skeletons, no placeholders. |
| F9 | Chaining depends on the existing reader lease; without it this change is unsafe. |
| F10 | The chain carries the Gmail pacing window and the model budget in its body. A fresh invocation is never a fresh allowance: per-minute spend stays at 4,500 units regardless of how many links run back to back. |
| F11 | First light is `first_slice_at` (0153), a nullable timestamp set once. A widen/reconnect that clears `backfilled_at` does not clear it — the picture already exists. |
| F12 | The hold releases at first light, and the dup constraint is honoured by geometry instead of by blanket: rows within `frontier + 3 days` stay out of the review fetch while deepening, because only they can still be missing a twin. |
| F13 | Parallel slice fan-out is rejected: the Gmail budget is per user, so parallel slices split the same 4,500 units for no throughput. Chaining removes idle minutes; nothing removes quota minutes. |
| F14 | The ETA is client-derived from the frontier's observed rate. The server promises no schedule. |

## 15. Related

- `research/UT/UT-onboarding-report.html` — problems 01 and 02, evidence and acceptance.
- `docs/specs/activation-journey-spec.md` — §5c, the decision this amends.
- `docs/features/direct-mailbox-read.md` — pipeline, cursor, hold semantics.
- `docs/specs/transaction-review-spec.md` — the surface this hands off to.
