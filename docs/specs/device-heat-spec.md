# The list, the queue and the statements stop heating the phone

On 2026-10-10 the phone got hot within a couple of minutes of browsing the
Giao dịch list, the review queue, and the sao kê (bank statement) cards inside
the queue. This is the third heat report in three weeks. The first two were
fixed where they were found: the mailbox reading loop (`reading-loop-cost-spec.md`,
2026-09-26) and the full repaint of the transaction list (CHANGELOG 2026-10-01).
Each fix was right and each shipped blind to the next source. This spec takes
the whole device as the unit: every way the app can burn CPU or GPU while a
person is on any of those three screens, and one coordinated change to all of
them, with a meter so the fourth report is caught by a number before a person
feels it in their hand.

> **Status, 2026-10-10. BUILT the same day**, client only, SW **v625**, no
> migration. Approaches A, B, C, D, F, G (list and photo half) and H below are
> in this release. E (server-side pre-extraction of unlocked statements) is
> deferred and recorded in §11. The "what landed" detail per approach is in §8.

> **How this relates to its siblings.** `reading-loop-cost-spec.md` fixed the
> repetition inside one polling loop; this spec fixes the repetition in the
> data layer that every screen sits on, and the always-on costs under covered
> screens. `transaction-review-spec.md` §"hot phone after a bulk import" put a
> visibility guard on the queue repaint; this spec makes the repaint itself
> conditional on the data having changed. `category-tree-spec.md` §sweep
> describes the mirror ping-pong; this spec makes the sweep converge.

---

# Part 1 — Behaviour

## 1. Summary

- **The cost is repetition and cascading, not one slow algorithm.** One
  focus, one realtime tick, or one local write re-decrypts two ledgers, repaints
  the queue four times, and restarts three background passes that read the
  whole ledger. None of that is new work.
- **Covered screens keep running.** The list is an overlay and the queue is a
  modal. The tab underneath stays mounted, its water gauge animates every frame
  on the main thread, and the Finance card re-renders itself every 4.2 seconds
  for nobody.
- **Opening a statement spins a key 100,000 times on the main thread**, and
  again on every tap, cancel, or wrong password.
- **Nothing here requires a UX change.** Every screen keeps its look and its
  behaviour.
- **One bonus defect found on the way:** the encrypted warm-boot snapshot has
  never been written for a real ledger, because its base64 step throws on
  anything larger than a few tens of kilobytes and the throw is swallowed. Every
  hydrate paid the serialize and encrypt cost for nothing.

## 2. What the person should experience

Nothing new on screen. The same list, queue, and statement flow, on a phone that
stays cool, with a battery that drains in proportion to what they do and not to
how long the app is open.

## 3. Root causes, ranked

Eight candidates were investigated from the source and the specs. Four are the
problem, one sets a constant floor under them, three are medium.

| # | Cause | Verdict |
|---|---|---|
| 1 | **Hydrate cascade.** `loadFamilyData` runs on focus, visibilitychange, realtime, every local write, every `online` event, and a forced full refresh when the last full one is older than 5 minutes. It decrypts the family ledger with no cache, then calls `fhPersonalBoot`, which clears the personal decrypt cache and hydrates. The mirror then hydrates again unconditionally. Each personal hydrate flips state twice, and each flip repaints the Personal tab and, with the queue open, the whole queue. Then recurrence (760 days), the receipt join (every receipt re-unsealed, 365-day slice rebuilt cold) and the tree sweep re-run. | **Key, the multiplier** |
| 2 | **Queue open burst.** Up to 1000 staged rows, each a pure-JS X25519 unseal with the staging private key AES-unwrapped again per row; up to 1000 statement rows decrypted in sequence; the 365-day match slice fetched and decrypted; a quadratic lending pass; the lessons blob pushed whether or not it changed. Nothing cached across opens. | **Key** |
| 3 | **Queue render model.** One `innerHTML` rebuild of the whole review from about 112 call sites, including every expand and collapse. The "Đã có trong sổ" section is uncapped and that is where statement rows land. Per render: receipt offers cost cards × queue, the booked-ledger aggregate runs three to four times, transfer proposals are credits × debits, and a body-wide MutationObserver rescans the new DOM for photos. | **Key for browsing statement rows** |
| 4 | **Statement unlock.** ECMA-376 agile decryption awaits a separate WebCrypto digest 100,000 times in sequence, allocates two 4 MiB buffers and two million-entry arrays per attempt, parses the container twice, and repeats all of it on every open. | **Key for statement files** |
| 5 | **The tab under the cover keeps running.** `.overlay` hides with a transform, `.modal.fh-screen` with opacity, so the Personal or Finance tab stays `display:block` beneath. Its water gauge animates three SVG children forever (not composited in WebKit). The Finance auto-rotate timer cannot see the cover and re-renders the cash-flow card every 4.2 s with about 13 passes over the ledger and a localStorage read per row. The tab bar keeps a 20 px backdrop blur. | **Key, the floor** |
| 6 | **List growth.** Rows append and never recycle; the hidden overlay keeps them. Photo tiles decrypt the full 1600 px image eagerly per chunk, with a 150-entry LRU that thrashes. Every selection tap re-emits all shown rows. `_pBuildTxnCtx` is quadratic. | Medium |
| 7 | **Sweeps that never converge.** The tree backfill re-filters the whole ledger with an NFD deburr per row for every 12-row slice and keeps its progress on row objects that every hydrate replaces. Bulk patches and the mirror's link update are not stamped as local writes, so they echo back through realtime and restart cause 1 on every device in the family. | Medium to high |
| 8 | **Platform weight.** About 3 MB of inline JS parsed on each cold start; the badge counts pending rows by fetching 1000 sealed rows, twice per resume; a full Personal render fires a session call and a families RPC. | Medium |

The listing itself is no longer a cause. The harness opens 80 rows of a
1000-row personal ledger in about 30 ms. Its earlier fix holds.

## 4. What changes, in order of leverage

**A. The hydrate becomes idempotent.** Decrypting the same ciphertext twice is
a cache hit. The family ledger gets the ciphertext-keyed cache the personal
ledger already had; the personal cache is cleared only when the key, the user,
or the family changes; the mirror re-hydrates only when it wrote something;
every client write to a realtime-subscribed table stamps the local-write
window; a background refresh that lands identical data repaints nothing; the
match and stats slices survive a hydrate whose rows did not change; and the
snapshot's base64 is chunked so the warm boot exists.

**B. The queue patches instead of rebuilding.** The render computes a signature
of everything the markup depends on and returns early when nothing changed.
Expand, collapse and the two-tap remove patch one card. Every section is capped
with the same reveal window the dated list already had, while counts and bulk
actions still cover every row. Aggregates are computed once per render or once
per build. The lending pass is indexed.

**C. A statement unlocks once, off the main thread.** The spin runs as a tight
synchronous hash loop (SHA-1/256/512 in JS, verified against WebCrypto) inside
a Blob-URL worker, with the main thread doing only the container and XML parse.
The container is parsed once and sized to its streams. A verified unlock is
kept for the session by file hash and persisted sealed under the personal DEK,
so cancel, re-open, backlog and a second device session never spin again for
the same file.

**D. What is covered is paused.** Any open overlay or full-screen modal marks
`body.fh-covered`. Under that flag the tab beneath pauses its animations and
drops the tab-bar blur, and the Finance rotate timer holds. Closed sheets pause
their own spinners. The four always-on pulses that ignored reduced motion now
honour it. Standing `will-change` is removed.

**F. Sweeps converge.** The tree backfill keeps its marks by row id across
hydrates, walks a wanted list computed once per ledger generation, and marks a
scope done when the walk ends. Recurrence and the receipt ledger pass are
gated on a signature of their input rows. Lessons push only when the blob
changed. Staged rows unseal once into a shared cache; the pending count is a
HEAD request.

**G (list and photo half).** Photos decrypt when their tile nears the viewport,
four at a time, and the LRU never revokes a URL still on screen. The closed
overlay empties its rows. A selection tap patches one row. Day cards use
`content-visibility:auto`.

**H. A meter and a harness.** `fhHeat` counts decrypts, digests, fetches,
render ticks, long tasks and running animations at near-zero cost, and the
boot harness gains queue and statement scenarios with acceptance bars.

## 5. Acceptance

Measured by the harness (`tools/boot-harness/*-perf.js`) and by `fhHeat` in
the console on a phone:

- **Queue idle, 4 seconds:** 0 fetches, 0 decrypts, at most 1 render tick.
- **One background hydrate with identical data, queue open:** 0 queue
  repaints, 0 decrypts of rows already in cache, at most 1 Personal-tab render.
- **Second queue open in a session, rows unchanged:** 0 unseals.
- **Statement re-open (same file, same session):** no download, no spin, under
  50 ms to the grid. First unlock: main thread free (long-task total under
  100 ms) while the worker spins.
- **List or queue open over a tab:** 0 running animations in the covered tab
  (`document.getAnimations()` filtered to the tab subtree), 0 cash-flow
  renders per minute.
- **Any single ledger refresh:** at most 1 family decrypt pass of changed rows
  only, at most 1 personal hydrate, at most 1 recurrence run, and only if the
  input signature changed.
- **Snapshot:** an encrypted family of 1000 rows warm-boots from IndexedDB.
- **Inherited from the reading-loop spec:** at most 6 requests per minute in
  steady state, zero while hidden.
- **Does not count as passed if** achieved by removing a surface, freezing a
  live number, or skipping a repaint the data actually required.

## 6. Hazards and failure modes

| Case | Behaviour |
|---|---|
| Decrypt cache across a key change (rotation, dual to enc, family switch) | The cache is cleared wherever the DEK or personal key is set or dropped; a wrong-key read is never cached. Verified by test. |
| Render signature misses a state field | The screen shows stale state for one interaction. Mitigation: the signature fields are listed in a comment beside the function, every mutating path is audited, and the harness asserts that each mutation type changes the signature. |
| Paused animation under a cover | A one-shot entrance paused mid-way resumes when uncovered. Acceptable; nothing user-facing depends on it finishing while hidden. |
| Worker unavailable or throws | The same maths runs synchronously on the main thread. Slower, never wrong. `bad_password` is surfaced identically. |
| Persisted unlock cache | Sealed under the personal DEK, capped at 20 statements, evicted on commit or delete, skipped when the personal safe is locked. Plaintext never touches disk. |
| Tree sweep marks a scope done with unresolvable rows | Those rows sit in the skip set; the cursor version bump (v15) re-walks everyone once. |
| HEAD count disagrees with the row fetch | Fall back to the fetch on error only; same filters as the fetch. |
| Signature says "unchanged" but a derived field changed server-side | Signatures include `updated_at`; a server-side change always bumps it. |

---

# Part 2 — Technical appendix

## 7. Budget before the change

From the source audit of 2026-10-10 and the harness. Rows are "inferred" where
no measurement exists; the on-device confirmation is in §9.

| Event | Work before |
|---|---|
| One family refresh (focus, realtime, write) | 1 uncached family decrypt pass (rows × 4 fields); 2 personal hydrates, the first with an emptied cache (rows × 7 fields plus all-time debt rows × 6); 4 `renderPersonal`; 4 `renderCsvReview` if the queue is open; 2 recurrence runs over 760 days; 1 receipt ledger pass re-unsealing every receipt and rebuilding the 365-day slice; 1 snapshot stringify + encrypt that is then discarded; about 20 to 30 network requests |
| Queue open, 1000 staged rows | 1000 X25519 unseals plus 1000 AES unwraps of the same private key; up to 1000 statement-row decrypts in sequence; all receipts re-unsealed; 365-day slice decrypted (about 6 values per row); lending pass up to ~1M comparisons; one lessons push |
| One expand or collapse in the queue | Full `innerHTML` rebuild; booked-ledger aggregate ×3 to 4; credits × debits transfer pass; cards × queue receipt lookups; body-wide photo sweep of the new DOM |
| Locked statement open | Download, NaCl open, SHA-256, 2 container parses with 16 MiB of zero-fill, 100,000 awaited digests (about 1.1 s on a laptop, inferred several seconds on a phone), repeated per tap |
| Under the list or queue, per second | 60 main-thread repaints of the water gauge; 1 cash-flow render every 4.2 s with ~13 passes over the ledger and a localStorage read per row; tab-bar re-blur per frame |
| Resume from background | 2 fetches of up to 1000 sealed rows to count them; session + `my_families` + `find_my_invites` RPCs per Personal render |

Harness, listing, 1000 rows, before this change: open 30 ms, 80 rows, 6854
nodes; idle 4 s task 14 ms. The list is not the problem.

**After (2026-10-10, same harness, stub backend):** queue idle 4 s: 0 requests,
0 decrypts, 0 render calls, 0 running animations. One background hydrate with the
queue open: 0 queue repaints, 0 Personal repaints (before: 4 and 4). Statement
unlock: 0 main-thread digests, main-thread task 5 ms, worker wall ~270 ms (SHA-512,
spin 100000); Node bench of the spin alone 1017 ms awaited vs 228 ms sync for
SHA-1, 1003 vs 345 for SHA-512. List open unchanged at 29 ms.

## 8. Where it lives

| Approach | Files | What landed |
|---|---|---|
| A | `src/js-data/15-crypto.js`, `30-hydrate.js`, `19-personal.js`, `40-txn-writes-outbox.js`, `50-writethrough-realtime.js`, `20-data-helpers.js`, `22-spaces.js`, `23-debts-ui.js`, `27-streaks.js` | ciphertext-keyed family decrypt cache cleared with the DEK; personal cache cleared only on key/user/family change; `fhPersonalSig()`; `_setState` paints only on a changed signature; mirror hydrates only after a write; all family writes stamp the local-write window; one shared hydrate timer; space RPCs once a minute; chunked base64; streaks read through the personal cache |
| B | `src/js-ui/56-csv-import-ui.js`, `57-csv-import-review.js` | `csvReviewSigCompute` + early return; per-card patch for expand, collapse, remove-arm; reveal window on every section; booked-ledger, transfer-proposal and account memos; indexed lending pass; merchant table deburred once; regex cache |
| C | `src/js-data/41-xlsx-decrypt.js`, `42-xlsx-parse.js`, `77-statement-capture.js`, `src/js-ui/59-statement-table.js` | sync SHA-1/256/384/512 spin in a Blob-URL worker with main-thread fallback; container parsed once, sized by FAT walk; unlock cache by file hash (memory + `fh-stmt` IDB sealed under the personal DEK, cap 20); statement-row decrypt cache, 50-wide batches; dismiss-arm and provider chips patch in place |
| D, G | `src/css/*`, `src/js-ui/10-nav-model.js`, `20-budget.js`, `60-transactions.js`, `src/js-data/57-photo-enc.js` | `body.fh-covered` from one class observer; paused animations and no tab-bar blur under covers; rotate timer holds; closed sheets/overlays and the idle upload pill pause; reduced-motion on the stragglers; `will-change` removed; one-pass cash-flow scan; lazy photo decrypt (IntersectionObserver, 4 wide, on-screen-safe LRU of 300); list empties on close, selection patches in place, linear `_pBuildTxnCtx`, `content-visibility` on day cards |
| F | `src/js-data/72-txn-review.js`, `18-staging-keys.js`, `24-lessons.js`, `28-tree-backfill.js`, `29-recur.js`, `76-quick-review.js`, `74-autotxn-ui.js`, `src/js-ui/78-receipt-join.js` | shared unseal cache + one key unwrap per open; HEAD count for the badge; receipt rows indexed, opened receipts cached, ledger pass gated on input signature and deferred while the queue is on screen (runs once when it closes); lessons push only when changed (+ recur lessons merge fix); tree marks by id across hydrates, cursor v15; recurrence gated on input hash; quick-review picks patch in place |
| H | `src/js-ui/07-heat-meter.js`, `tools/boot-harness/queue-perf.js`, `statement-perf.js`, `tools/heat-*.test.js` | always-on `fhHeat`; queue and statement harness scenarios with acceptance bars; render entry points tick, paints tick separately (`:paint`) |

## 9. Verification

1. `node tools/run-tests.js`: every `tools/heat-*.test.js` and `xlsx-*.test.js`
   green, plus the existing suite (two pre-existing failures unrelated to this
   work: `pipeline/direct-persist-contract.test.js`,
   `tools/label-fallback-root.test.js`).
2. `node build.js && node tools/boot-harness/txnlist-perf.js 1000` and
   `queue-perf.js`: numbers against §5.
3. On the phone, Safari Web Inspector → Timelines, 60 seconds each: queue open
   and idle; list open over Cá nhân; one locked statement tap. Read `fhHeat.report()`
   in the console at the end of each. Record in CHANGELOG with the release.
4. Energy: the Timelines "CPU" lane should sit near zero while idle on all
   three screens. Battery delta is corroboration, not a criterion (H7 of the
   reading-loop spec still applies).

## 10. Decision log

| # | Decision |
|---|---|
| K1 | Heat is treated as one device budget across screens, not per screen. Three per-screen fixes in three weeks each missed the next source. |
| K2 | Remove repetition before optimising work: cache by ciphertext, gate by input signature, patch by element. No algorithm was made cleverer where a cache made it unnecessary. |
| K3 | The hydrate is the multiplier and is fixed first; everything downstream (recurrence, receipt join, sweep) is gated on its own input signature so a hydrate that changes nothing costs nothing past the fetch. |
| K4 | Covered tabs are paused, not unmounted. Unmounting would lose scroll and state the person returns to; `animation-play-state` costs nothing and keeps state. |
| K5 | The statement spin moves to a synchronous JS hash in a worker rather than batching WebCrypto. 100,000 round trips to WebCrypto is the cost; the hash itself is milliseconds. |
| K6 | An unlocked statement is cached sealed under the personal DEK, by file hash, capped at 20. The password protects the bank's copy; our copy is already under E2EE. |
| K7 | The chunked base64 ships in this batch even though it is a correctness fix, because it removes a full serialize-and-encrypt per hydrate and restores warm boot for encrypted families. |
| K8 | Server-side pre-extraction (E) is deferred: the files that spin are the locked ones, which the server cannot open, and after C the unlocked ones are cheap. Recorded in §11. |
| K9 | Thumbnails at upload are deferred: the lazy decrypt and the on-screen-safe LRU remove the thrash; a thumbnail variant needs a backfill of existing photos and its own spec. |
| K10 | The meter is always on. The cost is integer increments; the benefit is that the next regression is a number in a harness run, not a warm phone in a UT session. |
| K11 | The tree-backfill cursor is bumped to v15 with the done semantics change, per the standing rule that a change to what the sweep decides is a cursor bump. |
| K12 | No change to the reading-loop cadence (5 s / 15 s / 30 s). It was measured and accepted on 2026-09-26; this spec only lets it share the unseal cache. |

## 11. Not built, deferred

- **E. Server-side pre-extraction of unlocked statements.** The worker already
  holds the plaintext bytes before sealing and could emit rows. Deferred per K8.
- **Thumbnail variant at upload** (G, second half). Per K9.
- **Bundle weight.** About 3 MB of inline JS per cold start, no bytecode cache
  for inline scripts. A separate build-step spec; out of scope here.
- **Realtime fan-out across devices.** With stamps on every client write the
  echo is gone, but one member's genuine write still reloads every other
  device. A per-row realtime merge instead of a reload is the next step after
  this spec's signatures make "nothing changed" cheap to detect.

## 12. Related

- `docs/specs/reading-loop-cost-spec.md`: the first heat spec, same method.
- `docs/specs/transaction-review-spec.md`: the hidden-modal repaint guard.
- `docs/specs/category-tree-spec.md`: the sweep and its cursor.
- `docs/specs/statement-capture-spec.md` §unlock: the agile decryption and the
  measured 1.1 s laptop spin.
- `tools/boot-harness/README.md`: harness scenarios and acceptance bars.