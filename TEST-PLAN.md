# FamilyHub — PWA Hardening Test Plan

On-device verification for the PWA hardening work (`PWA-PLAN.md`). Test on a **real
iPhone (installed PWA)** as the primary target, plus Android Chrome / desktop where
noted. Tick items as you verify. Builds are staged in the repo but deploy is manual
(push to `main`); migration `0048` is already applied to live prod.

Legend: ⬜ not verified · ✅ verified · ⚠️ issue found

---

## Phase 1 — safety quick wins (build v290)

**1.1 Persistent storage**
- ⬜ DevTools → Application → Storage shows the origin as **"persistent"** after opening the app.

**1.2 Service-worker update (silent reload → opt-in refresh)**
- ⬜ Deploy vN, open the app, deploy vN+1, then foreground the app → the **"New version — tap to update" / "Có bản mới — chạm để cập nhật"** chip appears at the bottom, and the page does **not** reload on its own.
- ⬜ Tap the chip → the app reloads into the new build.
- ⬜ Repeat with an expense sheet open (mid-edit) → the app does **not** silently swap while editing.
- ⬜ Background the app with a pending update and nothing in flight → it applies quietly, and you return to the new build with no chip.
- ⬜ First-ever install (fresh browser profile) → no spurious reload.
- ⬜ enc-recovery still self-heals: on an `enc_required` rejection the app updates + reloads immediately (not gated behind the chip).

**1.3 Global error visibility**
- ⬜ Trigger a benign error right after a tap → a toast appears; `window.__fhErrs` holds the last errors (build-stamped) in the console.
- ⬜ Boot the app normally → no spurious error toasts at startup (only gesture-adjacent errors toast).

---

## Phase 2 — XSS escape-by-construction (build v291)

Create records containing canary payloads and confirm they render as **literal text**
everywhere (never execute). Canaries:
`<img src=x onerror="document.title='xss'">` and `"><svg onload=alert(1)>`

- ⬜ **Expense note** with a canary → renders literally in: the transaction row, the activity list, the expense detail overlay, the home feed, and the post-save toast. `document.title` unchanged.
- ⬜ **Category name** with a canary → literal in txn rows, category chips, filter chip, budget screen, over-budget toast.
- ⬜ **Member name** with a canary → literal in avatars/initials, "who paid" chips, hero, settings, reactions, gallery peek, request toasts.
- ⬜ **Family name** with a canary → literal in the hero and settings header.
- ⬜ **Event / goal name** and **memory caption** with a canary → literal in rows, detail, home cards.
- ⬜ **CSV import**: a row whose description contains a canary → literal in the import preview.
- ⬜ **Encrypted family:** repeat the note + member-name canaries on an enc family → after decrypt they still render literally (same escaped paths).

---

## Phase 3 — windowed hydrate + IndexedDB snapshot (builds v292, v293; migration 0048)

**3.1 Windowed hydrate (v292)**
- ⬜ Log a few expenses → they appear and month totals are correct (windowed post-write path).
- ⬜ Background/foreground the app repeatedly → data stays correct; the snapshot payload on refreshes is **smaller** than the first (full) load (check the network tab: `get_family_snapshot` response size).
- ⬜ Edit and delete a **current-month** transaction → reflects correctly.
- ⬜ Edit and delete a **~3-month-old** transaction → reflects correctly (exercises full-hydrate escalation).
- ⬜ React to a **recent** expense and to an **old** one → both persist after sync.
- ⬜ From a **second device**, edit an old-month transaction → the first device converges (realtime escalation), at worst within ~5 min (staleness cap).
- ⬜ **Encrypted family:** drill into an old month → amounts/notes still decrypt (served from the retained baseline).
- ⬜ Offline → log an expense → back online → outbox flushes and totals reconcile.

**3.2 Snapshot → IndexedDB spill (v293)**
- ⬜ **Small family (common):** reopen the installed app → still opens straight onto real data with **no splash** (localStorage sync path preserved).
- ⬜ **Encrypted family:** reopen → brief splash → data appears after unlock/decrypt. In DevTools → Application: `fh-snap` (localStorage) is **absent**, `fh-snap-idb` marker present, and an `fh-snap` **IndexedDB** database exists.
- ⬜ **Sign out on a shared device** → both the `fh-snap-idb` marker **and** the `fh-snap` IndexedDB database are gone (no family data left behind).
- ⬜ Log several expenses rapidly → no errors; snapshot reflects the latest state within a few seconds (2.5s save throttle).
- ⬜ **Leave family / reset** → snapshot fully wiped (localStorage + IndexedDB).

---

## Phase 4 — install experience + manifest (build v294)

- ⬜ **Android / desktop Chrome (not installed):** Settings → the **"Add to Home Screen"** row appears → tapping fires the native install prompt; completing it shows the toast and hides the row.
- ⬜ **Fresh onboarding (installable):** the one-time install sheet appears ~1.2s after reaching home; dismiss it → it never reappears.
- ⬜ **iOS Safari (tab):** the Settings row appears → the sheet shows the Share → "Add to Home Screen" instructions (no fake prompt).
- ⬜ **Installed / standalone:** the Settings row is hidden and no nudge fires.
- ⬜ Long-press the installed icon → the two shortcuts ("Ghi chi tiêu", "Hoạt động") appear and open the correct screen on cold start.
- ⬜ Lighthouse → installability audits pass; manifest shows `id`, `shortcuts`, maskable icon.
- ⬜ (Known gap) A shortcut tapped while the app is already open only focuses it — cold-start shortcut taps work.

---

## Phase 5 — deploy-time minification (build v295)

Minification runs ONLY on Vercel (`npm run build:deploy`); the committed `index.html`
stays unminified. Risk area: the ~90 inline `on*=` handlers call globals **by name**, so
the deploy bundle must behave identically. (Automated guard already passed: all inline-
handler names survive, both regions parse, `__FH_VERSION__` intact.)
- ⬜ Deploy to a **Vercel preview** and do a full smoke pass on the minified bundle: onboard, log an expense, attach a photo, requests/activity, open every Settings row, encryption unlock, tap a push notification, house customizer. Every button works (no by-name handler broke).
- ⬜ Confirm the minified deploy behaves identically to the unminified local build (no visual or behavioral diffs).
- ⬜ Cold-open on an older phone → noticeably faster first paint / less parse jank (raw 1022 KB → 759 KB, brotli ~234 KB → ~157 KB).
- ⬜ After committing: `npm run check` passes (committed `index.html` is byte-identical to a fresh `npm run build`, i.e. unminified).
- ⬜ `node_modules` is gitignored (not committed); Vercel `npm install` pulls esbuild on deploy.

## Phase 6 — platform correctness & hardening (build v296; migration 0049)

**6.1 Zoom / a11y**
- ⬜ Pinch-to-zoom now works across the app (was disabled).
- ⬜ Double-tapping a control does **not** zoom (touch-action:manipulation).
- ⬜ No layout breakage from the viewport change; tapping small fields on iOS may briefly zoom on focus (acceptable trade-off for a11y).

**6.2 color-scheme**
- ⬜ With the OS in **dark mode**, the app still renders in its light design and form controls aren't auto-darkened/mangled.

**6.3 SW navigation preload**
- ⬜ Cold navigation still works and feels at least as fast; the app still loads **offline** (cache fallback intact). No blank/broken document on reopen.

**6.5 DB hardening (migration 0049)**
- ⬜ Supabase → Advisors → Security: the `_fh_enc_pair` "mutable search_path" WARN is gone.
- ⬜ Encryption still enforced end-to-end on an **enc / dual** family: a money write without ciphertext is still rejected, scrub/coverage still works (0049 only pinned the helper's search_path; behavior unchanged).

**6.6 Gemini proxy gate**
- ⬜ Signed-in CSV import that needs the AI fallback still works (JWT attached automatically).
- ⬜ An unauthenticated POST to `/api/csv-column-mapping` returns **401**.
- ⬜ Hammering it as one user returns **429** after ~12 calls/min (best-effort throttle).

**6.7 CI**
- ⬜ Push / open a PR → the **CI** GitHub Action runs and passes (`npm run parse` + `npm run check`).
- ⬜ Introduce a deliberate syntax error in a `src/` file → CI fails (guard works); then revert.

**6.4 Android back button — DEFERRED**
- Not implemented this round. Needs per-layer `history` handling + interactive device testing; deferred to a focused session so it can be verified live. Today, hardware Back on Android exits the app from inside an overlay/sheet (unchanged behavior).
