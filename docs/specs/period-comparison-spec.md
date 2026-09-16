# Period comparison — the grey bar behind every bar

The rule set that puts a faint "before" bar behind each bar of the two
cash-flow charts (the family deck on Tài chính gia đình, the personal strip on
Tài chính cá nhân), so that both charts compare a period with the same earlier
period, chosen the same way, and say so the same way.

> **Status, 2026-09-15.** Settled in one grilling session and built the same
> day, big bang, client only. No migration. SW **v531**. One new module,
> `src/js-ui/19-period-compare.js`, holds every date rule; both charts call it.
> Guarded by `tools/period-compare.test.js`.

> **How this relates to its siblings.** `personal-ledger-spec.md` owns the
> personal strip this changes; `personal-activation-spec.md` decides when the
> strip is on screen at all. The family deck has no spec of its own (it
> predates them); this document is the first to write its rules down. The
> guide tile ("Hôm nay còn tiêu được…") and the push alert it drives are
> **out of scope** and unchanged.

---

# Part 1 — Behaviour

## 1. Summary

- **Every bar has a "before".** The family deck already drew grey bars; the
  personal strip had dropped them. Both now draw them, from one rule set.
- **Like for like, one step back.** A day compares with the same weekday last
  week, a buổi with the same buổi of that day, a week with the matching week
  of last month, a month with the previous month (and, as a thin line, the
  same month last year).
- **Grey is the whole earlier period**, even while the current one is still
  running. The guide tile handles "so far"; the bars handle "the whole slot".
- **No grey is not the same as zero grey.** A comparison period that starts
  before the ledger's first row shows no grey bar at all. A covered period
  with nothing spent shows a zero-height grey bar.
- **Red means passed.** On both charts a bar turns red the moment it exceeds
  its grey bar. A zero grey bar never turns a bar red: there is nothing to
  pass.
- **The personal strip gains a Buổi zoom** so the two charts offer the same
  four views: Buổi · Ngày · Tuần · Tháng.

## 2. The four rules

| Bar | Compares with | Covered when |
|---|---|---|
| **Buổi** (Sáng · Trưa · Chiều · Tối of one date) | the same buổi, 7 days earlier | date − 7 ≥ first row |
| **Day** | the same weekday last week (date − 7) | date − 7 ≥ first row |
| **Week** (Mon–Sun, keyed by its Monday) | shift the Monday one calendar month back, then snap to that date's own Monday | that Monday ≥ first row |
| **Month** | the previous month; plus the same month last year as a tick line | `YYYY-MM-01` of each ≥ first row |

Worked examples of the week rule (the one that is not obvious):

| This week's Monday | Shifted one month back | Falls on | Grey = week of |
|---|---|---|---|
| 15 Sep 2026 | 15 Aug 2026 | Saturday | Mon 10 Aug |
| 31 Aug 2026 | 31 Jul 2026 | Friday | Mon 27 Jul |
| 5 Jan 2026 | 5 Dec 2025 | Friday | Mon 1 Dec |
| 30 Mar 2026 | 28 Feb 2026 (clamped) | Saturday | Mon 23 Feb |

Why not "4 weeks back": a person's month has a shape (salary day, rent,
school fees), and a week is read against where it sits in that shape. A week
that starts 1 Sep should be read against the start of August, not against
4 Aug. Why not "the n-th week of last month": a fifth week has no partner,
and the weekdays would not line up. The shift-then-snap rule keeps weekday
alignment and stays within three days of the same point in the pay cycle,
and always has a partner.

The family deck's **Tháng** view keeps its four day-of-month buckets (1–7,
8–14, 15–21, 22–end); each compares with the same bucket of the previous
month. That is a bucket rule, not a week rule, and it already matched.

"First row" is the date of the earliest transaction the ledger holds, over
the whole history, not over what happens to be cached. See §6 for what the
personal strip does while that history is still loading.

## 3. Buổi

Boundaries: Sáng 5:00–10:59 · Trưa 11:00–13:59 · Chiều 14:00–17:59 ·
Tối 18:00–4:59. Spending between 0:00 and 4:59 belongs to **Tối of the same
calendar date**, so a day's four buổi never disagree with that day's Ngày bar
about which date the money left on.

Which clock time decides the buổi, in order:

1. the transaction's own `occurred_time` when it has one;
2. otherwise the time it was logged, **only if it was logged on the same
   calendar day** as the spend;
3. otherwise the row has no buổi. It stays in the day's total and out of the
   four bars.

Rule 3 replaces the old "unknown → the current buổi", which piled every email
and CSV import into whatever buổi the person happened to open the app in.
Because of it, the four bars of a day may add up to less than the day's
total. The difference is said, not hidden:

- **Personal strip:** the tap label of any buổi of that day adds
  `chưa rõ giờ: 300k`.
- **Family deck:** one quiet line under the Buổi view, `300k hôm nay chưa rõ
  giờ`, shown only when the amount is non-zero.

## 4. Upcoming slots

Slots later in the current period show as grey-only bars (the coloured bar is
absent, not zero), so the person sees what the same slot cost last time
before it arrives:

| Zoom | Grey-only bars reach |
|---|---|
| Buổi | the rest of today |
| Ngày | Sunday of this week |
| Tuần | the last week that starts in this month |
| Tháng | nothing ahead |

The family deck already did this; the personal strip now does too, in the
current-month scope and in Toàn thời gian (whose day/week range ends today).
An older month has no upcoming slots.

## 5. What the person sees

**Scale.** Grey bars and the last-year tick count toward the bar scale on
both charts. On the personal strip the "tallest bar in view" rescale counts
them too, so a tall grey last week is never clipped.

**Colour.** Green under, red over (`cur > prev` with `prev > 0`). In Tháng
zoom "over" is measured against the previous month, not the tick.

**The readout (personal only).** Until 2026-09-16 a tapped bar raised a
floating two-line card over the strip. It collided with the bar labels and the
strip's top edge clipped it, so the figure moved into the chart's header
(`.pch-s`, `persChartHTML`) where it always has a line of its own:

```
Chi tiêu                                    [ Ngày ⌄ ]
T4, 16/9 · 828.000 ₫ · T4 9/9: 1,6tr
```

It speaks for the tapped bar; with nothing tapped, for the live slot (today /
this week / this month); failing that, for the last slot that has happened. A
future slot shows `—`. The comparison half is the same `cmpLabel` the old card
carried, unchanged per zoom:

| Zoom | Comparison text |
|---|---|
| Buổi | `T2 8/9 trưa: 90k` (+ ` · chưa rõ giờ: 300k` when there is any) |
| Ngày | `T2 8/9: 90k` |
| Tuần | `tuần 11/8: 900k` |
| Tháng | `T8: 900k · T9/25: 1,1tr` (the year part only when covered) |

An uncovered comparison reads `chưa có dữ liệu` in place of the amount. A
tapped bar also keeps its own `fmtK` figure on screen (`.pst-val.pin`); every
other bar's figure rides the tallest-in-view rule. The family deck has no
readout and stays that way: its three views each carry one comparison and the
dots row already names the period.

**Choosing the zoom (personal only).** The four-up segmented row is gone. The
header's right side is a menu button naming the current zoom, and it opens the
`sheet-pzoom` sheet where each period states what it compares against
(`persCmpName`) — the same sentence the legend under the strip carries, so the
grey bar is never an unexplained shape. Buổi is omitted from the sheet in
Toàn thời gian, as the segmented row omitted it.

**Buổi zoom on the personal strip.** Columns about 22px wide, four to a day,
a wider gap between days, the date shown once under each group. The current
buổi's column sits on a faint surface tint. Bars within a day are always
Sáng→Tối, so they carry no per-bar labels. The zoom covers the selected month
only; the Buổi button is not offered in Toàn thời gian, and a remembered Buổi
pick falls back to Tháng there.

## 6. Data

**Family.** Every comparison reads `window.txns` by calendar date
(`t._d`), never by the family month key. That key is a bare month name with
no year (`'Sep'`), so `t.month === 'Aug'` matches every August the ledger
holds and January's comparison with December would read the wrong year.
The family hydrate already carries the full history, so nothing loads.

**Personal.** Two sources are merged by date: the 2-month cache (`P.txns`)
for dates on or after its window start, the full-history slice for anything
older. The full slice now also fetches `occurred_time_enc` and `created_at`,
decrypting the time only for rows that have one, so Buổi works for any month.

While the slice has not landed, a comparison whose period starts before the
cache window is **unknown**: no grey bar, no red, the label reads `chưa có
dữ liệu`, and the strip kicks the slice fetch. When it lands the strip
re-renders and the greys appear; nothing waits on it. The last derived
old-history map is kept while the slice is being re-fetched after a write,
so old greys do not blink on every new row.

## 7. Acceptance cases

| Case | Expected |
|---|---|
| Today is Thu 1 Jan 2026, Ngày zoom | 1 Jan compares with Thu 25 Dec 2025; the label reads `T5 25/12: …`. |
| Tháng zoom, bar Jan 2026 | Grey = Dec 2025. Tick = Jan 2025 only if the ledger has rows on or before 1 Jan 2025. |
| Tuần zoom, week of Mon 29 Sep 2026 (a fifth week) | Shift → 29 Aug (Sat) → grey = week of Mon 24 Aug. Never empty. |
| Ledger's first row is 20 Aug 2026; Ngày zoom on 25 Aug | 25 Aug vs 18 Aug: **no** grey bar (18 Aug < 20 Aug). 27 Aug vs 20 Aug: grey bar, possibly zero height. |
| Row at 01:30 on 12 Sep with `occurred_time` | Counts in **Tối of 12 Sep**, not Sáng, not 11 Sep. |
| Row on 12 Sep with no time, logged 13 Sep 09:00 (email backfill) | No buổi. Ngày bar includes it; the Buổi tap label shows `chưa rõ giờ`. |
| Row on 12 Sep with no time, logged 12 Sep 09:00 | Sáng. |
| Aug 2026 exists, Sep 2025 does not, bar Sep 2026 | Grey = Aug. No tick. |
| Sep 2025 exists, Aug 2026 has zero spend but is covered | Grey = zero height. Tick at Sep 2025's value. Bar never turns red (grey is zero). |
| Buổi zoom, 14:30 now | Sáng and Trưa have coloured + grey bars; Chiều has coloured (so far) + grey; Tối grey only. Chiều's column is tinted. |
| Slice not loaded, Tuần zoom, first week of Sep (Mon 31 Aug → week of 27 Jul) | Grey absent, label `chưa có dữ liệu`; slice fetch kicked; grey appears on the re-render. |
| Family Buổi view, Wed 16 Sep | Grey = Wed 9 Sep's buổi, not Tue 15 Sep. |

---

# Part 2 — Implementation notes

- `src/js-ui/19-period-compare.js` — pure date functions, no data access:
  `fhBuoiIdx`, `fhBuoiOf`, `fhCmpDay`, `fhCmpWeek`, `fhCmpMonth`,
  `fhCovered`, `fhMondayOf`, `fhDateStr`, `fhAddDays`, `fhWdShort`.
- `src/js-ui/20-budget.js` — the three live-month views (`cfRenderDay`,
  `cfRenderWeek`, `cfRenderMonth`) now read one date-keyed map
  (`cfDayMap`) and share one column renderer (`cfColsHTML`). The classic
  past-month view (`cfWeekData` + `cfWeekChartHTML` + `cfWowNote`) is
  untouched.
- `src/js-ui/21-personal.js` — `persCmpData` builds the merged map;
  `persSeries` attaches `prev`, `ly`, `fut`, `cmpLabel`, `untimed` to each
  bar; `persStripHTML` draws `.pst-p` (grey), `.pst-y` (tick), `.pst-b.over`;
  `persStripLabelSync` scales all three; Buổi zoom renders `.pst-g` groups.
- `src/js-data/19-personal.js` — the stats slice selects
  `occurred_time_enc, created_at`, rows carry `time` and `ts`.
- `src/css/40-spending-tabs.css` — `.pst-p`, `.pst-y`, `.pst-b.over`,
  `.pst.buoi`, `.pst-g`, `.pst-c.now`, the two-line `.pst-pin`.
