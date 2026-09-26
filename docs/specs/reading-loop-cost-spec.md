# The reading loop stops burning the phone

During a 365-day backfill the device gets warm and the battery drops. In the UT
session of 2026-09-26 the participant raised it twice, ninety seconds apart, and
the second time it drove them off the screen: "điện thoại thì thấy nóng nóng lên
nữa rồi. Thôi ra ngoài thử." Battery went from 31% to 24% across 20m43s.

None of that heat comes from reading the mail. It comes from a client loop that,
over those twenty minutes, issues roughly **a thousand network requests**,
performs about **900 decryptions of the same three rows**, and rebuilds the
entire Tài chính tab about **300 times**. Almost none of that work is new work.

> **Status, 2026-09-26. BUILT the same day**, client only, SW **v587**. What
> landed: the id-keyed open cache and per-batch key pool (H2), the delta drain
> as the one recurring request with the grant asked on quiet drains (H2), the
> extend-not-replace watcher with a 30-minute ceiling (H3) — which also fixes
> the silent 3-minute progress freeze for established users — the parked timer
> and visible-only reconcile (H4), the in-place `persProgressPatch` (H5), the
> standing `will-change` removal (H8), and the console meter
> (`fhReadLoopStats`). Cadence landed as 5s eager / 15s watched / 30s badge:
> steady state is 4 to 6 requests a minute against the acceptance bar of 6,
> with one honest exception — the first ~20 seconds after a connect run
> eagerly while the kick's rows land, which is cost proportional to work.
> Behavioural coverage: `tools/autotxn-connected-live.test.js` (rewritten to
> the new contract, 40 checks); shape guards: `tools/reading-loop.test.js`.
> One real bug was found by the rewrite and fixed before ship: the baseline
> count used to race the connect kick — rows landing between an empty-queue
> count and the first seed sat below the cursor, uncounted for the whole
> read; the baseline is now taken on the seed tick, after the seed.

> **How this relates to its siblings.** `first-ninety-seconds-spec.md` shortens
> the read and makes the picture progressive; it reduces how long this loop runs
> but changes none of its per-tick cost, which is why this is a separate spec. A
> 90-second read on today's loop is still wasteful, and the two compose: heat
> causes thermal throttling, throttling slows unsealing and rendering, and that
> makes the wait this loop is reporting on feel worse. `activation-journey-spec.md`
> owns the surfaces involved. `docs/features/web-push.md` matters to §4, because
> backing off the poll increases reliance on push.

---

# Part 1 — Behaviour

## 1. Summary

- **The cost is repetition, not work.** Four separate places redo something
  already done, every four seconds, for twenty minutes.
- **A self-feeding loop keeps it alive.** The tab re-arms the watcher every 30
  seconds; each re-arm builds a *new* watcher that discards accumulated state,
  so the most expensive branch is forced to run at least twice a minute whether
  or not anything changed. It also means the watcher's own 3-minute lifetime
  never actually expires.
- **Backgrounding does not stop it.** The visibility check wraps only the body
  of a tick, not the timer, so the loop keeps waking while hidden — and the
  end-of-window reconcile, which can fetch up to a thousand sealed rows, has no
  visibility check at all.
- **Nothing here requires a UX change.** The screen can look and behave exactly
  as it does and cost a fraction as much.
- **One asymmetry to fix while here:** the re-arm only exists for new users. An
  established user reconnecting gets no re-arm, so their progress display
  silently freezes after three minutes.

## 2. What the person should experience

Nothing new. The same progress, the same feed, the same live counts, on a phone
that does not get warm and a battery that drains in proportion to a twenty
minute read rather than to a video call.

## 3. What changes, in order of leverage

1. **Cache what does not change.** The connection row is re-fetched every four
   seconds to read four columns that change once per backfill. Hold it for the
   duration and re-fetch only on a signal that it may have changed.
2. **Unseal each row once.** The "vừa tìm thấy" feed re-decrypts the same three
   newest rows on every tick, with no id-keyed cache. Keep an opened-row map.
3. **Unwrap the private key once per tick, not once per row.** Three AES-GCM
   unwraps where one would do, none memoized across ticks.
4. **Patch numbers instead of rebuilding the tab.** The email card already
   string-diffs before writing and is cheap. The personal tab is a full
   `innerHTML` rebuild whose only memo key is a string containing the ticking
   numbers, so the memo can never hit while a read is running.
5. **Extend the watcher instead of replacing it** (§5).
6. **Stop the timer when hidden, and back off as the read lengthens** (§4).

## 4. Backing off, and what it costs

Cadence today is 1.5s for the first 20 seconds, then 4s, forever in practice.
Proposed: keep the eager phase, then step out to 10s and 30s as the read passes
a few minutes, resetting to eager when the person returns to the screen.

The real cost of backing off is **latency to "it's done"**. That is acceptable
only because the pipeline already sends a push when rows stage — but report
problem 13 found that people cannot locate the notification toggle and do not
know what they will receive. **Do not land an aggressive backoff before that is
fixed**, or the read will finish and nobody will be told.

## 5. The re-arm loop

The tab re-arms on a 30-second throttle. Re-arming increments a sequence number,
which retires the previous watcher and starts a fresh one with a null state
cache and a zeroed count. Three consequences:

- The expensive branch (frontier + feed + three unseals) fires unconditionally
  on the first tick of every new watcher, at least twice a minute.
- If the pending count happens to be zero, the fresh watcher re-enters the
  **1.5-second** eager cadence for another 20 seconds.
- The old watcher dies before reaching its end-of-window reconcile, so that path
  is usually skipped — which is why the 3-minute lifetime is effectively
  infinite for new users and hard-stops for everyone else.

Re-arm should **extend the deadline of the running watcher**, preserving its
state, with an absolute ceiling so a watcher cannot live forever.

## 6. Acceptance

From the UT report, problem 06:

- During a full read, at most **6 network requests per minute**, down from 45 to
  60 today.
- Each staged row is decrypted **at most once**.
- **No full-tab rebuild** occurs while reading.
- **Zero network requests** while the app is backgrounded.
- **Does not count as passed if** achieved by removing the progress display or
  by letting the screen go static. Problems 01 and 02 must pass at the same
  time.

Measured by engineering verification: request and decryption counts from the
browser's network tooling over one full read. Battery delta is recorded for
corroboration but is not the criterion, because screen recording itself draws
power.

---

# Part 2 — Technical appendix

## 7. Measured budget, as it stands

Steady state: foreground, personal tab, rows landing, 4-second cadence, about 15
ticks per minute.

| Resource | Per minute | Per 20 min |
|---|---|---|
| Unconditional HTTP (connection row + pending count) | 30, or 60 if the column fallback trips | 600 to 1200 |
| Conditional HTTP (frontier + feed) | up to 30 | up to 600 |
| `nacl.box.open`, pure JS | up to 45 | ~900, on the same ~3 rows |
| AES-GCM private-key unwraps | up to 45 | ~900 |
| Full personal-tab `innerHTML` swaps | up to 15 | ~300 |
| Established-user extra (`getSession`, `my_families`, `find_my_invites`) | up to 45 requests | up to 900 |

Plus 4 to 6 infinitely animating dots, and three elements holding
`will-change: transform, opacity, filter` for the whole session rather than for
the half-second transition that needed it — three promoted compositor layers
held for twenty minutes.

There is **no Wake Lock** anywhere in the app, so this is CPU and radio, not a
held screen.

## 8. Where it lives

| File | What changes |
|---|---|
| `src/js-data/74-autotxn-ui.js` | `_atxLiveWatch` cadence and backoff; real `visibilitychange` handling; cache the connection row; id-keyed cache for opened feed rows; unwrap the key once per tick |
| `src/js-ui/21-personal.js` | re-arm extends rather than replaces; during reading, patch progress numbers instead of calling the full tab render |
| `src/js-ui/20-budget.js` | unchanged (already diffs before writing) — listed so nobody "fixes" it |
| `src/css/74-mailbox.css` | drop persistent `will-change`; reduce always-on pulsing dots |

## 9. Cache invalidation, the one real hazard

Holding the connection row means a `needs_reauth` transition could be missed,
which would leave the screen claiming a read is in progress after Google has
revoked the token. Mitigations, in order of preference:

- Re-fetch on any tick where the pending count has not moved for N consecutive
  ticks — the exact condition that suggests something is wrong anyway.
- Re-fetch on return to foreground.
- Keep an absolute ceiling (say 60 seconds) on how long the cached row is
  trusted, which is still fifteen times fewer requests than today.

## 10. Failure modes

| Case | Behaviour |
|---|---|
| Backoff is in effect when the read finishes | Person learns late unless push works. Gated on problem 13 |
| Watcher extended past its ceiling | Absolute cap ends it; the tab re-arms on next render as today |
| Feed cache grows unbounded | Cap it at the few dozen rows the feed can ever show; it is a display cache, not storage |
| Connection row cached through a reauth | §9; worst case is a stale "reading" label, not data loss |
| Established user's progress freezes at 3 minutes | Fixed by §5; today this is silent and affects exactly the reconnect path |

## 11. Decision log

| # | Decision |
|---|---|
| H1 | Heat is a separate P0 from the long wait. Shortening the read shrinks exposure but changes no per-tick cost. |
| H2 | Remove repetition first: cache the connection row, cache opened rows by id, unwrap the key once per tick. Highest leverage, lowest risk, no UX change. |
| H3 | Re-arm extends the running watcher instead of replacing it, with an absolute ceiling. |
| H4 | The visibility guard moves from the tick body to the timer itself. |
| H5 | During reading, patch the progress numbers; do not call the full tab render. |
| H6 | Aggressive backoff is gated on problem 13 (notifications), because it trades poll latency for push reliance. |
| H7 | Battery delta is corroboration, not a criterion; screen recording confounds it. |
| H8 | Persistent `will-change` is removed. It is small next to the rest and is still three compositor layers held for twenty minutes. |

## 12. Related

- `research/UT/UT-onboarding-report.html` — problem 06, and problems 01 and 02 for the surrounding moment.
- `docs/specs/first-ninety-seconds-spec.md` — shortens the window this loop runs for.
- `docs/features/web-push.md` — the dependency created by backing off the poll.
