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

> **Status, 2026-09-27 night. ALL SERVER CHANGES REVERTED to the pre-chaining
> baseline (mailbox-sync v67 == the 2e6fd47 code that measured 11m33). Two
> builds regressed and both are backed out.** Timeline, from production logs
> and `mailbox_grants`: the morning build (v65: 45-day slice + chaining +
> reveal) measured 15m41 vs the 11m33 baseline; the evening build (v66:
> work-budget + one-get + chaining, UI reverted) measured 14m08. Root cause of
> BOTH regressions, confirmed by `read_tally` + edge logs + the grant table:
> the Gmail rate limit is **per-mailbox, not per-grant**, and this mailbox had
> **two active grants** (a test grant plus a leftover the reset never deleted)
> each self-pacing to 4,500 units/min → combined 9,000 vs the ~6,000 real
> ceiling → sustained 403s. Any 403 sets `rateLimited`, which by design stops
> the chain — so chaining could not fire precisely during a contended fresh
> backfill, and the runs fell back to the 2-minute cron cadence. Chaining plus
> 3× larger slices added quota pressure that destabilised a system already
> near its floor; the genuine one-get win (halves the get cost of the ~800
> format-read transactions) was swamped. **Everything below is PARKED.** The
> real levers, in order, and each to be shipped alone with a before/after
> measurement: (1) never let two grants backfill one mailbox concurrently
> [+ fix the reset flow that orphans grants]; (2) pace or suspend the statement
> lane during an active backfill (it 403-storms unpaced today); (3) re-introduce
> one-get on its own; (4) only then reconsider chaining, and only for a SOLE
> backfill that provably owns the quota. `0153` column stays applied, unused.
> **Part 3 (§16–§19) is the resolution record**: the full cause analysis with
> code anchors, the quota arithmetic that bounds what any fix can achieve, and
> the measured ladder those four levers belong to.

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

## 2b. PARKED 2026-09-27 — First light releases the hold; a 3-day band stays back

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

## 2d. PARKED 2026-09-27 — Progress the person can track

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
| F15 | 2026-09-27: the first build regressed (15m41s vs 11m33s) because the run budget counted pacing sleep as work; chained links slept off their budget. The budget now measures worked time; `WALL_STOP_MS` 140s backstops the platform's 150s kill. |
| F16 | One `?format=full` get per message. The metadata-then-full pass doubled quota on kept mail for bandwidth that never mattered server-side. Junk settles on its single get. |
| F17 | `BACKFILL_STAGE_MAX` 180 → 600: a memory bound, not a completion promise — the cursor makes an unfinished slice free to resume. |
| F18 | First light, the deepening reveal, the 3-day band and the client ETA are PARKED per the founder's call after the UT re-run: no UI change rides a pipeline fix again. The 0153 column stays, unused, reserved. |

## 15. Related

- `research/UT/UT-onboarding-report.html` — problems 01 and 02, evidence and acceptance.
- `docs/specs/activation-journey-spec.md` — §5c, the decision this amends.
- `docs/features/direct-mailbox-read.md` — pipeline, cursor, hold semantics.
- `docs/specs/transaction-review-spec.md` — the surface this hands off to.

---

# Part 3 — Resolution (2026-09-27)

The record of why problem 01 exists, what bounds any fix, and the ladder out.
Written after the two reverted builds, from an independent re-verification of
every claim against the code at the reverted baseline and the live database
(read-only), 2026-09-27. Rungs R1–R4 are the four levers the Status block
names, here with their mechanism, prediction and rollback; R5 needs the
founder's un-park call and nothing below assumes it.

## 16. The arithmetic that bounds everything

The 26/09 tally for the UT mailbox: ~1,200 mails judged — 598 rejected as
junk at the header (20 units each), 597 kept and read head-then-body (40
units each), listing ~12 pages (5 units each).

```
598 × 20  =  11,960 units      (buying "no")
597 × 40  =  23,880 units      (buying transactions)
listing   ≈      60 units
          ≈  36,000 units  ÷ 4,500/min  ≈  8.0 minutes of pure quota time
after one-get (kept mail 40 → 20):  ≈ 24,000 units  ≈ 5.3 minutes
at the true ~6,000 ceiling:                          ≈ 4.0 minutes
```

**Ninety seconds for a full 365-day read of this mailbox is arithmetically
unreachable.** The wall is Gmail's per-mailbox allowance, not the pipeline.
Every pipeline rung below buys stability and minutes; only making the first
picture not require the whole window (§2's slice) can buy the moment. This is
why both 27/09 builds were doomed even without their contention bug: they
optimised the schedule of a spend whose total the quota fixes.

## 17. Ten causes, assessed

Each verified 2026-09-27 against the reverted baseline and production data;
none taken from documentation alone.

| # | Cause | Position in the why-chain | Verdict, evidence |
|---|---|---|---|
| C1 | **The quota wall.** ~36k units of mail against ~6k units/min per mailbox | why no speed-only fix reaches 90 s | CONFIRMED · §16; unit prices `worker.mjs:287-294`; read_tally 26/09 |
| C2 | **Two live readers split one allowance.** The pacing ledger `_units` is a per-run local; each reader honestly caps at 4,500 → combined 9,000 on a ~6,000 ceiling → sustained 403s | why both 27/09 builds regressed | CONFIRMED · `worker.mjs:478-493`; live today: `trang.nguyen.wh@gmail.com` carries two active grants (logins `gichisreading@`, 09-05, and its own, 09-23) |
| C3 | **The lease enforces per-grant, not per-mailbox.** `take_mailbox_lease(p_grant) … where id = p_grant`; the migration is titled "one reader per mailbox" but keys on grant id. 0137/0138 later allowed many grants per email; nobody re-keyed the lease | why C2 is possible at all — the "second of something" hazard from `AGENT_SYNC.md` §3, verbatim | CONFIRMED · `0145:28-42` |
| C4 | **Unpaced side lanes spend the same allowance invisibly.** The statement lane lists, gets and pulls attachments through raw `ctx.fetch`; `pacedFetch` covers only the four transaction-loop sites, so the lane's spend never enters the ledger it competes with. The 1,500-unit reserve for push/probes is a hope, not a throttle | why 403s persist even under a "working" pacer | CONFIRMED · `statement.mjs:198,210,256` vs `worker.mjs:688,825,829,1174` |
| C5 | **Reset deletes by login, not by mailbox.** `reset.sql:111` sweeps grants of the target auth user; a grant on the same Gmail from another login survives every reset | why the real cause hid through two builds and poisoned every measurement | CONFIRMED · the 15/09 grant on the UT mailbox is still in the table |
| C6 | **The junk tax.** Gmail filters by sender domain only; banks send marketing and OTP from those domains. 598 of 1,200 mails were bought at 20 units each just to be rejected — the junk memory keys on (sender, subject shape) and must buy the header to consult itself. About a third of the whole budget buys "no" | why this mailbox costs 36k units | CONFIRMED · `worker.mjs:539-541, 1084-1090`; tally 26/09 |
| C7 | **Head-then-body double get.** Kept mail pays 2 × 20 units for a metadata pass whose bandwidth saving never mattered server-side. One-get (F16) is right; it died only because it rode a bundle that regressed for C2 | why kept mail costs 40, not 20 | CONFIRMED · `worker.mjs:825,829` in the baseline |
| C8 | **Minute quantization.** A capped run stops itself and waits for the `* * * * *` lane (0097); 10–12 slices → ~10 idle minutes on top of the quota floor. Chaining attacks exactly this — but any 403 sets `rateLimited`, which correctly breaks the chain, so under C2+C4 contention the chain died precisely when it was needed | why 8 quota-minutes became 11½–20 wall-minutes; why chaining "failed" without being wrong | CONFIRMED · `0097:95`; `worker.mjs:1028` |
| C9 | **Cold-start economics are the real first-user case.** The 25/09 UT run paid 8 model calls and 852 `format_seed` passes (19–20 min); the 11m33 benchmark ran warm. Every benchmark since is warm; every actual activation is cold | why our numbers systematically understate the wait this spec exists to fix | CONFIRMED · the report's own 25/09 vs 26/09 tallies |
| C10 | **Two client causes turn minutes into "crashed".** (a) `fhBackfillHolds` gates the whole screen until `backfilled_at`, though only dedup and import need completeness — 195 opened rows sat invisible from minute four; a write-constraint applied to a view. (b) The only moving number derives days-read from the oldest pending row, which can move at most once per run — every inter-run gap is a flat line, matching the observed 45–55 s freezes | why 12 minutes was experienced as three crashes | CONFIRMED · `72-txn-review.js:1213-1215, 257-265`; `_atxFrontier` / `_atxDaysRead` |

Ruled out, for the record: the model as bottleneck (0 calls on the warm run);
the five-minute lane (0097's minute lane exists and ran); function cold starts
and fetch bandwidth (the run is quota-bound, not IO-bound).

The shape of the whole: one immovable constraint (C1), two contention defects
(C3, C4) that made honest self-pacing a lie, one process defect (C5) that hid
them, two cost inefficiencies (C6, C7), one scheduling inefficiency (C8), one
measurement bias (C9), and two perception defects (C10) that converted minutes
into "crashed". The 27/09 builds optimised C8 while C2–C4 were active —
optimisation downstream of the actual bottleneck.

## 18. The ladder

One rung per landing. Each rung ships alone, is measured before and after on
the same mailbox, and is reverted alone if its prediction misses. Order:
stabilise the quota, then cheapen the read, then remove idle, and only then
move the moment.

| Rung | Change | Prediction (measured, or the rung reverts) | Notes |
|---|---|---|---|
| **R0** | Measurement hygiene: the reset flow sweeps or reports same-mailbox grants across logins; any timing run is refused while `mailbox_grants` holds >1 grant for the mailbox | none — R0 is what makes the other predictions attributable | closes C5. Also decide the live `trang.nguyen.wh` duplicate pair — real contention today, not test residue |
| **R1** | Lease keyed to the mailbox: take/renew/release by `lower(btrim(email))` (a small `mailbox_leases` table, or equivalent), so readers of one mailbox take turns. Grants keep their own queues and cursors — 0137/0138's two-readers feature survives; only simultaneity goes | zero `gmail_rate_limited` holds during a sole backfill; duration ≈ 11m33 unchanged | closes C3, and with it C2. A shared mailbox's second backfill now queues behind the first — acceptable, and unavoidable given a per-user allowance |
| **R2** | The statement lane joins the budget: hand it `pacedFetch`, and hold the lane off while `backfilled_at is null` (its per-message memory means it loses nothing by waiting) | no lane-attributed 403s in the run logs; duration unchanged | closes C4's known half; push/watch/probe spend stays inside the 1,500-unit reserve and is re-examined only if 403s persist |
| **R3** | One-get re-landed alone (F15/F16 stand: work-budget semantics, `?format=full` once, junk settles on its single get) | 11m33 → **≈ 7.5–8 min**, zero 403s | closes C7. This is the rung the 14m08 build buried |
| **R4** | Chaining (§2c as specced: lease-gated, budget and pacing window travel in the chain body, `rateLimited` still breaks the chain) — only after R1–R3 have each held their prediction | → **≈ 5.5–6 min**, no flat minutes between slices | closes C8. This is the floor (§16); speed work stops here |
| **R5a** | *(un-park, founder's call)* Progress measures work (F6, §2d's headline half): found-count and amount as the moving numbers, day-count demoted. Client-only, ships alone | no "frozen" verdict in a re-run UT at unchanged speed; no interval > 5 s without on-screen change | closes C10(b) independently of everything above |
| **R5b** | *(un-park, founder's call)* The 45-day first slice + `first_slice_at` hold-release (§2, §2b; 0153 is already applied and waiting) | first light **≤ ~2 min** (≈ 200 mails ≈ 4–6k units), the year still delivered behind it; the 90 s criterion becomes reachable | closes C10(a) by geometry, not by blanket; §2b's 3-day band keeps the dup constraint honest |
| **R5c** | *(optional, last)* Live assembly during the slice (§3) | the §7 criteria in full | only worth its complexity if R5a+R5b still miss the 90 s mark |

## 19. How each rung is measured

- **Cold, not warm (C9).** Acceptance runs use a mailbox the reader has never
  seen: junk memory empty, no learned formats, model calls live. A warm re-run
  may be recorded alongside, never instead.
- **Sole reader, verified (C5).** Before the stopwatch starts:
  `select count(*) from mailbox_grants where lower(btrim(email)) = <mailbox>`
  must be 1, and the run's summary must show zero `gmail_rate_limited`.
- **One number per rung.** connected_at → backfilled_at from `mailbox_grants`,
  plus the 403 count from the logs for the window. A rung that moves neither
  in the predicted direction is reverted the same day, alone.
- **No UI change rides a pipeline rung** (F18 stands). R5a–R5c each ride
  nothing and carry nothing.
- The shared-singleton rules apply to every rung: migration numbers claimed at
  apply time, `mailbox-sync` diffed against the live version before deploy,
  `CACHE_NAME` read from `origin/main` before any client build.
