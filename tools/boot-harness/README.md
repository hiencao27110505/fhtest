# Boot harness — the Cá nhân landing-tab feedback loop

The repro + regression loop for the 2026-09-06 "slow open / frozen on
'Đang chuẩn bị sổ cá nhân…'" fix (CHANGELOG 2026-09-06,
`docs/specs/personal-ledger-spec.md` §13/§17).

It serves the **real built `index.html`** locally, swaps `vendor/supabase.js`
for a stub with per-call latency and stall injection, seeds a personal DEK
(and, for `warm`, an encrypted snapshot) in the `fh-keys` IndexedDB, then
measures what the landing tab actually does. No credentials, no network,
deterministic.

```
node build.js                      # harness drives the BUILT app — rebuild first
node tools/boot-harness/harness.js <scenario>
```

| Scenario | Injects | GREEN means |
|---|---|---|
| `timing` | 300ms per call, healthy | ready ≤ 1500ms (boot not re-serialized) |
| `freeze` | `personal_transactions` never resolves | ready or error-with-retry ≤ 15s (watchdog + unlatch alive) |
| `freeze-early` | `my_families` never resolves | personal tab still reaches ready (boot stays independent) |
| `warm` | snapshot seeded, ALL personal reads hung | real UI painted ≤ 2s AND still intact after the 12s watchdog |

`DBG=1` prints the first 3s of state polls. Exit code 0 = GREEN.

Puppeteer is borrowed from the moneylover project's `node_modules` if not
installed here. The stub logs every supabase call with timestamps — the printed
waterfall is also the tool for spotting any future re-serialization of boot.

---

## Heat loops — `queue-perf.js`, `statement-perf.js` and the `fhHeat` meter

The 2026-10 "phone heats up" work (approach H, instrument and gate). Two more
loops in the same shape as `txnlist-perf.js`, and an always-on meter in the app
so the numbers below are a console call rather than a devtools afternoon.

```
node build.js
node tools/boot-harness/queue-perf.js [rows=300] [--direct]   # review queue, staged mode
node tools/boot-harness/statement-perf.js [file.xlsx password] # locked-statement unlock
node tools/heat-meter.test.js                                   # the meter itself (vm, no browser)
```

### `window.fhHeat` (src/js-ui/07-heat-meter.js)

File 07 of the classic block: it runs before the module that does all the crypto,
wraps `crypto.subtle.{decrypt,encrypt,digest,deriveBits,importKey}` on the
instance, `window.fetch` (counted by URL class: rest / rpc / storage / auth /
realtime / functions / other, plus how many went out while `document.hidden`),
`nacl.box.open` / `nacl.secretbox.open` (armed at DOMContentLoaded, tweetnacl is a
deferred vendor), and a `longtask` PerformanceObserver. Every hot wrapper is one
integer increment and a pass-through `apply`; nothing allocates. Each setup step
is its own try/catch, so a missing API loses one counter, never the boot.

| Call | What |
|---|---|
| `fhHeat.tick('renderCsvReview')` | count a named event; call sites use `window.fhHeat && fhHeat.tick('x')` |
| `fhHeat.snapshot()` | plain object: counters, `ticks`, running `animations` (sampled now), `domNodes`, what is `armed` |
| `fhHeat.reset()` | zero everything, restart the clock |
| `fhHeat.rates()` / `fhHeat.window()` | per-minute rates since reset |
| `await fhHeat.window(10000)` | per-minute rates over the NEXT 10 s only |
| `fhHeat.report()` | `console.table` of totals + per-minute + ticks |
| `fhHeat.deep(true)` | also count DOM nodes added (MutationObserver; off by default, costs) |
| `fhHeat.diff(a, b)` | b minus a for two snapshots |

In the field: open the queue, `fhHeat.reset()`, wait a minute, `fhHeat.report()`.
`fetches` should sit under the spec's 6/min, `decrypts` and `unseals` at 0,
`ticks.renderCsvReview` at 0.

### What `queue-perf.js` does

Boots the built app on the stub, serves the stub plus a small patch that lets the
page hand rows back through the stub's own `email_transactions` builder (the stub
file itself is untouched), injects N staged rows **unsealed** (`sealed: null`, the
plaintext-era shape `fhReadStagedRow` passes through — the stub holds no staging
key, so production adds one NaCl `unseal` per row on top of what is printed), and
runs the REAL open path (`fhTxnReviewSheet` → fetch → unlock loop → `fhStmtLoad` →
receipt join → `csvBuildReview` → `renderCsvReview` → `openSheet`). Then, one JSON
line per step: `open`, `expand`, `collapse`, `filter`, `idle4s`, `hydrate` (one
real `fhPersonalHydrate()` with the queue on screen). `--direct` skips the open
path and builds the queue from rows placed in `window._fhStagedRows`, for when the
open is gated (a reading-phase screen).

Since the meter's `tick()` has no call sites until the integrator adds them, the
harness installs the same one-liners as wrappers around the globals
(`TICK_SHIMS`): the tick names it prints are the names to use.

### Headless gotchas (read before trusting a number)

- **No frames on a still page.** `requestAnimationFrame` never fires in headless
  Chrome unless something invalidates paint, and `fhTxnReviewSheet`'s unlock loop
  yields through rAF every 20 rows (`_txrYield`). The harness replaces rAF with a
  16 ms timer before the open; without that the open never resolves. Same reason
  idle is **timed** via CDP `TaskDuration`, never frame-counted, and anything
  scroll-driven must be called by hand (see `txnlist-perf.js`).
- **On the stub, requests are stub calls.** The stub never touches `window.fetch`,
  so `fhHeat.fetches` reads 0 by construction; the harness prints `stubCalls`
  (routes started in the window) and the request bar reads those. On a real
  backend `fhHeat.fetches` is the number.
- **The stub's personal rows cannot be decrypted** (`amount_enc: 'AAAAAAAA'`), and
  `_decCache` (19-personal) remembers successes only, so a hydrate on the stub
  re-pays every failed decrypt. The "0 decrypts of cached rows" bar is therefore
  RED on the stub by construction; judge it in the field, or against rows the
  harness encrypted itself (a follow-up).
- **`longTasks` can read 0 while `task` ms is high**: the observer reports only
  tasks over 50 ms, and a hot idle is usually many short ones.
- **The KDF is in a Worker.** 41-xlsx-decrypt runs the agile KDF + AES in a Blob
  Worker, so the main thread's `digests` is 0 by design and `statement-perf.js`
  judges wall ms. Wall ≈ worker CPU ≈ heat, just without blocked taps.
- `document.getAnimations()` needs no frames and is the honest animation count;
  the harness prints each running one as `name@element [hidden-by …]`.

### Acceptance bars (proposed — tune here)

Inherited from `docs/specs/reading-loop-cost-spec.md` §6 and extended to the
queue and the statement path. The harnesses print each as GREEN/RED but do not
fail the run yet; a RED is the point of running them while the fix is in flight.

| # | Bar | Where measured | Why this number |
|---|---|---|---|
| B1 | **Queue idle 4 s: 0 requests** (= 0/min; spec allows 6/min during a full read, 0 when nothing is happening) | `queue-perf idle4s.stubCalls`; field: `fhHeat.fetches` | a still screen has nothing to ask the server |
| B2 | **Queue idle 4 s: 0 decrypts, 0 unseals** | `idle4s.decrypts/unseals` | nothing new arrived, so nothing new to open (spec: each row decrypted at most once) |
| B3 | **Queue idle 4 s: ≤ 1 render tick** across all named renders | `idle4s.ticks` | one stray repaint is a timer edge; two is a loop |
| B4 | **Queue idle 4 s: 0 running animations** | `idle4s.runningAnimations` | an infinite animation on a visible queue is a held compositor layer for the whole session; a finished transition must not report `running` |
| B5 | **One background hydrate with the queue open: ≤ 1 `renderCsvReview` tick** | `hydrate.ticks` | the queue did not change; one repaint (for the Cá nhân chip state) is tolerable, the loading+ready pair is not |
| B6 | **One background hydrate: 0 decrypts of already-cached rows** | `hydrate.decrypts` (field / real rows) | `_decCache` exists for exactly this; a re-hydrate of an unchanged ledger should hit it 100 % |
| B7 | **One background hydrate: ≤ 1 `renderPersonal` tick** | `hydrate.ticks` | today `_setState` paints the tab twice per hydrate (loading, ready) |
| B8 | **Queue open: main-thread task ≤ 200 ms at 300 rows** (scaled linearly) | `open.task` | wall includes RTTs; the main-thread share is what blocks the tap. Measured 118 ms on 2026-10-10 |
| B9 | **Expand / collapse one card ≤ 50 ms each** | `expand.ms`, `collapse.ms` | one card changed; the whole list should not repaint |
| B10 | **Giao dịch list open ≤ 60 ms at 1000 rows** | `txnlist-perf open.openMs` | the progressive list paints 80 rows and appends on scroll |
| B11 | **Statement warm unlock ≤ 50 ms** | `statement-perf decryptWarm.wallMs` | the second unlock of the same file (preview → real parse) should reuse the derived key; today it re-runs the KDF (~250–310 ms) |
| B12 | **Statement unlock: 0 long tasks on the main thread** | `decryptCold.longTasks` | the KDF stays in its Worker |
| B13 | **≤ 6 requests per minute during a full read, 0 while backgrounded** | field: `fhHeat.rates().fetches`, `fhHeat.snapshot().fetchesHidden` | reading-loop-cost-spec §6 |

Baseline on 2026-10-10 (other agents' edits in flight; 300 rows, stub lat 20 ms):
B1 RED (10 `email_transactions` reads in 4 s idle ≈ 150/min), B2 GREEN, B3 GREEN,
B4 RED (13 running: `fhspin2@fu-dot`, `height@pst-p` ×9, `opacity@scrim`,
`opacity@csv-import-modal`, `transform@fh-sheet`), B5 GREEN (1), B6 RED-on-stub
(see gotchas), B7 GREEN (1), B8 GREEN (118 ms), B9 GREEN (36 / 23 ms),
B11 RED (253 ms warm vs 313 cold), B12 GREEN.
