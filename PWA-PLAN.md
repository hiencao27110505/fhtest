# FamilyHub — PWA Hardening: Implementation Plan

Status: **Ph1 ✅ v290 · Ph2 ✅ v291 · Ph3 ✅ v292/v293 (+mig 0048) · Ph4 ✅ v294 · Ph5 ✅ v295 · Ph6 ✅ v296 (+mig 0049) except 6.4 (back button, deferred)**
Owner: Hien · Source: full codebase/DB assessment (2026-08-07). Consolidated tests in `TEST-PLAN.md`.
All P0–P2 plan items shipped except the Android back-button (6.4, deferred for interactive testing) and P3 backlog (Phase 7).
Companion docs: `CLAUDE.md` (conventions), `AGENT_SYNC.md` (session coordination), `DESIGN.md`

Six phases, ordered by risk-reduction per effort. Each phase is independently shippable
and ends with a deploy. Phases 1–2 are safety fixes; 3 is the scalability keystone;
4–6 are product/infra polish.

---

## Phase 0 — conventions every phase inherits

These rules come from `CLAUDE.md` and the build system; violating them breaks the app
in ways that are hard to see locally.

- **Never edit `index.html`** — edit `src/`, run `npm run build`, verify with `npm run check`.
- **Every deploy bumps `CACHE_NAME`** in `sw.js` (`familyhub-vN` → `vN+1`). Build stamps
  the version into the app (`__FH_VERSION__`).
- Source files: no trailing newline (byte-identical rebuild); js-ui = classic/global scope,
  js-data = one module; js-data must bridge via `window.*`; decorators sort **after** targets;
  boot wiring stays last in its file and throw-isolated.
- **Migrations are append-only against live prod with real family data.** Claim the next
  free number in `AGENT_SYNC.md` before writing one (0048 as of 2026-08-06 — re-check).
- After each phase: update `AGENT_SYNC.md` (what changed, new bridges, new migrations),
  and run `/release-notes` if user-facing.
- Testing loop: `node tools/dev-server.js` locally; verify on a real iPhone (installed
  PWA) before push — iOS Safari is the primary target and the least forgiving.

---

## Phase 1 — safety quick wins (1 session)

### 1.1 Request persistent storage

**Why:** outbox (unsynced expenses + photos) and crypto keys live in IndexedDB
(`fh-outbox`, `fh-keys`); browser eviction = silent data loss. Installed PWAs are
usually granted persistence, but only if asked.

**Where:** `src/js-ui/80-onboard-boot.js`, inside the existing `serviceWorker` block
(after successful `register`, ~line 381):

```js
try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
```

Fire-and-forget; no UI. Optionally log `navigator.storage.persisted()` to console for
debugging. **Verify:** DevTools → Application → Storage shows "persistent".

### 1.2 Service-worker update: from silent mid-session reload to opt-in refresh

**Current behavior:** `sw.js:29` `skipWaiting()` + `sw.js:41` `clients.claim()` →
`controllerchange` listener in `80-onboard-boot.js:380` → `location.reload()`, with
`reg.update()` fired on every foreground. A user mid-expense (or mid Key-Card flow)
can have the page reloaded under them.

**Target behavior:** new SW **waits**; a small chip appears ("Bản mới — chạm để cập nhật" /
"New version — tap to update"); tapping (or a safe idle moment) activates it and reloads.

**Changes:**

1. **`sw.js`** — remove `self.skipWaiting()` from `install`; add:
   ```js
   self.addEventListener('message', (e) => {
     if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
   });
   ```
   Keep `clients.claim()` (first install has no predecessor, activates immediately).
   Bump `CACHE_NAME`.

2. **`src/index.html`** — add a static chip `#fh-newver` next to the existing
   `#fh-updating`/`#fh-offline` chips (~line 61–63), hidden by default, with an
   `onclick="fhApplyUpdate()"` button. Style in `src/css/70-onboarding.css` beside the
   `.fh-stale` chip rules.

3. **`src/js-ui/80-onboard-boot.js`** — rework the registration block (377–386):
   - Track first install: `var hadController = !!navigator.serviceWorker.controller;`
     In `controllerchange`, reload only if `hadController` (avoids a pointless reload
     on first visit); keep the `refreshing` dedupe flag.
   - Detect a waiting worker: on `register` resolve, if `reg.waiting` → `fhUpdateReady(reg)`.
     Also `reg.addEventListener('updatefound')` → `installing.statechange` → when
     `state === 'installed' && navigator.serviceWorker.controller` → `fhUpdateReady(reg)`.
   - `fhUpdateReady(reg)`: stash `reg`, show `#fh-newver`.
   - `fhApplyUpdate()`: `reg.waiting && reg.waiting.postMessage({type:'SKIP_WAITING'})`.
   - **Safe auto-apply:** on `visibilitychange` → `hidden`, if an update is pending and
     it is safe (`window.editingTx == null`, no `.sheet.on`/`.modal.on`, outbox empty —
     add a tiny `window.fhOutboxEmpty()` helper in `40-txn-writes-outbox.js`), apply it
     so the user comes back to the new build without ever seeing the chip.
   - Keep `reg.update()` on load + foreground as-is.

4. **`src/js-data/65-passcode-ui.js` `_fhEncRecover` (49–55)** — this flow *depends* on
   immediate activation (stale build rejected a write; reload self-heals; queued entry
   survives in IDB). After its `reg.update()`, wait briefly then if `reg.waiting`,
   postMessage `SKIP_WAITING` directly — recovery keeps its immediate-reload semantics,
   bypassing the chip.

**Gotcha:** the chip's copy must be bilingual via `L()`/`data-t` like every other string.
**Verify:** deploy vN, open app, deploy vN+1, foreground the app → chip appears, no
reload; tap → reloads into vN+1; repeat with an expense sheet open → no auto-apply
while editing; `_fhEncRecover` path still reloads immediately.

### 1.3 Global error visibility

**Where:** new file `src/js-ui/05-errors.js` (sorts first — catches everything after it):

```js
window.addEventListener('error', function(e){ fhLogErr(e.error || e.message); });
window.addEventListener('unhandledrejection', function(e){ fhLogErr(e.reason); });
```

`fhLogErr`: console + ring buffer on `window.__fhErrs` (last 20, with `__FH_VERSION__`);
show the standard `toast()` only for errors during a user gesture (avoid boot noise).
Optional (later): flush the buffer to a Supabase `client_errors` table (service-role-free:
family-scoped RLS insert-only) — decide when needed; not part of this phase.

**Effort (whole phase):** one session, one deploy, one `CACHE_NAME` bump.

---

## Phase 2 — XSS sweep: escape by construction (1 session)

**Why P0:** decrypted E2EE data lives in the DOM; one stored XSS in a note runs with
the DEK unlocked in every member's session. Escaping today is per-call-site and the
hot paths miss it.

### 2.1 Consolidate the escapers

One canonical pair, defined early in js-ui so both worlds share it:
- Move `esc()`/`escAttr()` (currently `src/js-ui/55-expense-photos-writes.js:383-384`)
  into `src/js-ui/12-format-helpers.js`; assign `window.esc`/`window.escAttr`.
- Delete the duplicates: `_esc` variants in `src/js-data/60-settings-family-ui.js:7`,
  `src/js-data/20-data-helpers.js:126` (quote-only), the local `esc` inside
  `_rebuildWhoChips` (`20-data-helpers.js:126-131`) — js-data uses `window.esc`.
  Keep `_esc` as a thin alias during the sweep if it shortens the diff.

### 2.2 The sweep

Known-raw sites (fix first):

| File | Site | Raw fields |
|---|---|---|
| `src/js-ui/60-transactions.js:37-39` | `txRow()` | `t.note`, `t.cat` |
| `src/js-ui/60-transactions.js:52-54, 66-68` | `resRow()`/`futRow()` | `e.name`, `t.note` |
| `src/js-data/20-data-helpers.js:129-130` | `_rebuildWhoChips` | `m.name` (button text) |
| `src/js-ui/80-onboard-boot.js:95, 205` | `obMemberRowHTML`, `applyFam` hero | `name` in avatar/initials + `familyName` |

Then audit every `innerHTML`/`insertAdjacentHTML` producer (≈92 sites) against a
simple rule: **any interpolated value that originates from user input (names, notes,
captions, category names, family name, event/goal names, CSV cells) goes through
`esc()` in text position and `escAttr()` in attribute position.** Static/system
strings (emoji constants, `L()` literals, numbers through `fmt()`) are exempt.
Sweep order: js-ui files 20→90, then js-data UI builders (`60-settings-family-ui.js`,
`64-...`, `66-enc-ui.js`, `67-card-ui.js`, `65-passcode-ui.js` join previews).

**Gotcha:** double-escaping — some call sites already escape; grep for `esc(` before
adding. Initials via `inits()` are derived from names → escape at interpolation, not
inside `inits()`.

### 2.3 Verification

Create a test expense/category/member on a dev family with the canary strings:
`<img src=x onerror="document.title='xss'">` and `"><svg onload=alert(1)>` in note,
category name, member name, family name, goal name, memory caption, CSV import cells.
Confirm: renders as literal text everywhere (rows, detail overlays, home feed,
chips, month lists, push-tap navigation targets), `document.title` untouched.
Also re-test with an **encrypted** family (fields decrypt then render through the
same paths).

**Effort:** one focused session. No migration, one deploy + SW bump.

---

## Phase 3 — hydrate windowing + snapshot to IndexedDB (the keystone, 2–3 sessions)

**Problem:** `get_family_snapshot` serializes the **full family history** every time,
and the client re-hydrates after every write (700 ms debounce in `_syncSoon`,
`20-data-helpers.js:111`), on every realtime tick, and on every foreground. Payload
grows without bound; `fh-snap` (localStorage, ~5 MB quota) will eventually fail to
store it. The windowing hook (`p_txn_from`) exists but is dead (`30-hydrate.js:32`
always passes `null`).

**Design principle:** for enc families the server cannot aggregate (amounts are
ciphertext), so old-month totals must come from rows the client already has.
Therefore: **keep the full model client-side; make the *frequent* refreshes windowed
and merge them into it.** Full fetches become rare (no snapshot / integrity resync).

### 3.1 Session A — windowed refresh with merge (client + migration)

**Migration `00XX_snapshot_windowing.sql`** (claim number in AGENT_SYNC; redefine
`get_family_snapshot` — 10th redefinition, pattern established by 0042):
- `p_txn_from` continues to window `transactions` (already implemented).
- Additionally window the txn-anchored aggregates when `p_txn_from is not null`:
  `transaction_photos`, `reactions`, and `request_reviews where entity_type='expense'`
  join to the windowed transaction set (goal/occasion reviews stay unwindowed — small).
  `events`, `event_memories`, `saving_goals`, `monthly_budgets`, `category_budgets`,
  `members`, `categories`, `key_wraps` stay full — they are small and the model
  needs them whole. `savings_entries`/`incomes` already ship as aggregates.
- `p_txn_from = null` keeps today's exact behavior (backward compatible: old clients
  and the 17-query fallback are untouched).

**Client (`src/js-data/30-hydrate.js`):**
- `loadFamilyData(opts)` gains a mode: **full** (no in-memory model yet, i.e.
  `!window.DB._hydrated`) vs **refresh** (`p_txn_from` = first day of the month two
  months back).
- Refresh merge: rebuild small collections wholesale (members, categories, budgets,
  events, goals, enc, key_wraps — same code as today); for `txns`: drop in-memory rows
  with `txn_date >= window_start` and splice in the fresh ones; same join-key merge for
  photos/reactions/expense-reviews. Older rows persist untouched → month totals,
  history and the months model stay correct with zero server aggregation.
- Factor the decrypt-in-place block (`30-hydrate.js:97-115`) into `_decryptRows(kind, rows)`
  so the merge path reuses it.
- **Out-of-window invalidation:** realtime `postgres_changes` payloads carry the row.
  In `50-writethrough-realtime.js`, if a `transactions` event's `txn_date` (new *or*
  old record) predates the window → schedule a **full** hydrate instead of a refresh.
  Same rule on the refresh path if a local edit targets an old row (`editTxn` knows the
  date). This closes the "remote edit to an old month" hole.

**Verify:** network tab — post-write refresh payload shrinks to the window; edit a
6-month-old txn from a second device → first device converges (full hydrate path);
enc family: old month drill-in still decrypts; `npm run check` clean.

### 3.2 Session B — `fh-snap` moves to IndexedDB

**Why:** localStorage quota cliff + synchronous main-thread JSON of a growing model.

- New tiny IDB helper in `src/js-data/17-snap-restore.js` (db `fh-snap`, store `snap`,
  single key). Keep the **localStorage marker** `fh-snap-has='1'` so the pre-paint gate
  (`src/index.html:20-42`, synchronous) can still decide splash-vs-warm without IDB.
- `fhSaveSnapshot` (`80-onboard-boot.js:262`) → hands data to `window.fhSnapStore`
  (module) which now always writes IDB (enc envelope for enc families, plaintext
  otherwise) + sets the marker.
- Restore goes **async for everyone** — the enc path (`__fhSnapEnc` →
  `17-snap-restore.js` → `fhApplySnapshot`) already does exactly this; route the
  plaintext path through it too. `fhApplySnapshot` (`80-onboard-boot.js:294`) is
  already the shared applier; it re-runs `applyFam/applyLang/renders` after apply.
- Migration path: on boot, if legacy localStorage `fh-snap` exists → apply it once,
  write it to IDB, delete the localStorage key.
- TTL/versioning (`FH_SNAP_V`, 14-day TTL) carry over unchanged; bump `FH_SNAP_V`→3
  since the storage moved.

**Gotcha:** the 10 s watchdog (`__fhResumeWatch`) must also cover "IDB open hangs" —
the async restore races it; a failed restore must fall back to splash + full hydrate
(return false path already does).

**Verify:** warm boot still paints instantly (marker + async apply lands within a
frame or two); airplane-mode cold open shows cached data; legacy snapshot migrates;
enc family warm boot still requires no network before paint.

### 3.3 Session C (optional now, planned): lazy old-month drill-in

Only needed once families outgrow even a windowed-refresh + snapshot model, or to
shrink the *rare* full hydrate too: fetch a specific old month's rows on demand via
direct RLS selects (`transactions` by `family_id + txn_date` range — index
`transactions_family_date_idx` serves it), decrypt via `_decryptRows`, splice into the
model. UI hook: month picker selection outside the loaded range. Defer until metrics
(payload size in `fhLogErr` breadcrumbs) say it matters.

---

## Phase 4 — install experience + manifest (1 session)

### 4.1 `manifest.json`

Add:
```json
"id": "familyhub",
"lang": "vi",
"dir": "ltr",
"display_override": ["standalone"],
"launch_handler": { "client_mode": "navigate-existing" },
"shortcuts": [
  { "name": "Ghi chi tiêu", "short_name": "Chi tiêu", "url": "./#sheet-expense",
    "icons": [{ "src": "icon-192-shortcut-expense.png", "sizes": "192x192" }] },
  { "name": "Yêu cầu", "short_name": "Yêu cầu", "url": "./#activity",
    "icons": [{ "src": "icon-192-shortcut-requests.png", "sizes": "192x192" }] }
]
```
- Shortcut URLs ride the existing boot hash router (`80-onboard-boot.js:352-363`);
  confirm the exact `#sheet-*` id for the expense sheet before wiring.
- Shortcut icons optional — can ship without `icons` first.
- `screenshots` (rich Android install sheet): take 2–3 framed portrait screenshots,
  add later — nice-to-have, don't block.
- **`start_url` and `scope` stay `"."`** — changing them re-identifies the installed app.

### 4.2 Install prompt UX

New file `src/js-ui/85-install.js`:
- Capture: `window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__fhBip = e; ... })`.
- Surface an install card at a *earned* moment — after onboarding `done` screen, and in
  Settings ("Cài đặt lên màn hình chính") — never a boot-time popup. Card calls
  `__fhBip.prompt()`; listen for `appinstalled` to hide + toast.
- iOS (`no beforeinstallprompt`): reuse and extend the A2HS explainer currently buried
  in the push sheet (`55-push.js:99-101`) into a small shared sheet: Share → "Thêm vào
  MH chính", with the reminder that notifications require install. Gate all of it on
  `!matchMedia('(display-mode: standalone)').matches && !navigator.standalone`.

### 4.3 SW precache completeness

Add `./icon-512.png`, `./icon-maskable.png` to `ASSETS` in `sw.js` (manifest references
them; an offline install-banner render should not 404). Bump `CACHE_NAME`.

**Verify:** Android Chrome shows the custom card → native prompt → installed → card
gone; shortcuts appear on long-press; `navigate-existing` focuses the open window
instead of spawning a second; iOS sheet renders correctly; Lighthouse PWA pass.

---

## Phase 5 — build minification (1 session)

**Constraint 1:** inline `on*=` handlers (~250) call js-ui globals **by name** →
identifier renaming would break every button. Minify **whitespace + syntax only** for
JS; never `--minify-identifiers`.
**Constraint 2:** `npm run check` (byte-identical committed artifact) is the repo's
only correctness guard — keep the committed `index.html` unminified; minify **only at
deploy**.

**Changes (`build.js` + `package.json` + `vercel.json`):**
- Add `esbuild` as the first and only devDependency.
- `build.js`: accept `--deploy`; in deploy mode run each region through esbuild's
  transform API — css: `{ loader:'css', minify:true }`; js-ui and js-data:
  `{ minifyWhitespace:true, minifySyntax:true, minifyIdentifiers:false }`
  (js-data with `format` unset — it is already one module block; do not wrap).
  Comments in code are dev-facing; stripping them at deploy is the point.
- `package.json`: `"build:deploy": "node build.js --deploy"`.
- `vercel.json`: `{ "outputDirectory": ".", "buildCommand": "npm run build:deploy" }` —
  local `npm run build`/`check` stay unminified and byte-identical.

**Gotchas:** `minifySyntax` may fold `var` patterns — the js-ui region is ES5-style
globals, which esbuild handles, but **verify the deployed bundle exercises every
inline handler** (smoke-tap through all tabs/sheets on the Vercel preview before
promoting). ASI edge cases: the concatenator joins files with `\n`; esbuild re-emits
safely since it parses the whole region.

**Verify:** Vercel preview deploy → full manual smoke pass (onboard, expense, photo,
requests, settings, enc unlock, push tap) + `wc -c` comparison. Expect roughly
960 KB → ~500–550 KB raw (identifiers kept), brotli ~180–200 KB, and a visibly faster
cold parse on an older phone.

---

## Phase 6 — platform correctness & hardening (1–2 sessions, items independent)

### 6.1 Accessibility: re-enable zoom
`src/index.html:5`: drop `maximum-scale=1.0, user-scalable=no`. Prevent iOS input
auto-zoom instead: ensure every `input/select/textarea` computes to ≥16 px
(audit `src/css/*.css`; add a base rule), and add `touch-action: manipulation` on
`body` to kill double-tap zoom on controls. Test drag-to-dismiss sheets afterward —
gesture handlers must not fight pinch-zoom.

### 6.2 Color-scheme sanity (not a full dark theme)
Head: `<meta name="color-scheme" content="light">` (blocks UA force-darkening) and a
second `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e2a24">`
(pick from the theme palette). Full dark theme = separate project on top of the
existing `t-*` theme system; explicitly out of scope here.

### 6.3 Navigation preload
`sw.js` activate: `e.waitUntil(... self.registration.navigationPreload?.enable())`;
navigate handler: use `await e.preloadResponse` before `fetch(req)`. Saves SW-boot
latency on cold navigations. Bump `CACHE_NAME`.

### 6.4 Android back button + overlays
Overlays/sheets don't participate in history → hardware back exits the app from deep
UI. In the shared open/close helpers (`openSheet/closeSheet`, overlay `open*` fns in
`10-nav-model.js` / `50-sheets-expense-capture.js`): on open, `history.pushState({fh:1},'')`;
on `popstate`, close the topmost layer (reuse the existing close routing); closing via
UI pops its own state (`history.back()` guarded by a flag to avoid loops). Also set
`history.scrollRestoration='manual'` (the app manages scroll in `go()`).
This is the fiddliest item in Phase 6 — implement behind a small state module, test
matrix: back at home (exits), back with sheet open (closes sheet), back with overlay
over sheet (closes overlay), rapid open-close.

### 6.5 Database hardening — migration `00XX_policy_hardening.sql`
- Rewrite `members_update` (`0010:151-154`) and the three `push_subscriptions` write
  policies (`0036:46-56`) with initplan-wrapped subqueries:
  `member_id in (select id from members where user_id = (select auth.uid()))` — same
  treatment 0022 gave everything else.
- `csv_format_fingerprints` (0034): drop the open `insert ... with check (true)`
  policy; route inserts through a small `security definer` RPC
  (`save_csv_fingerprint`) that enforces payload size (< 8 KB) and upserts on the
  fingerprint key. SELECT stays open (by design). Client change in
  `src/js-data/44-csv-parse.js`/`45-csv-import.js` where the insert happens.
- Run `mcp get_advisors` after applying; fix anything new.

### 6.6 Gemini proxy throttle
`api/csv-column-mapping.js`: require the caller's Supabase JWT (verify with a fetch to
`auth/v1/user` or JWKS check) + a naive in-memory per-IP counter (Vercel functions are
per-instance, so this is best-effort — the JWT requirement is the real gate).

### 6.7 CI
GitHub Action on push/PR: `npm ci || npm i` → `npm run check` (byte-identical build) +
`npx esbuild src/js-*/**.js --bundle=false` parse check (catches syntax errors in any
module before Vercel does). ESLint optional later; keep the gate minimal so it never
gets ignored.

### 6.8 Docs debt (30 min, do alongside)
- `CLAUDE.md`: fix stale version (`v166`→current) and migration high-water mark;
  document the public-bucket trade-off decision (unlisted-link privacy; `.enc` for
  enc families) in `DESIGN.md`.
- `<meta name="description">` in `src/index.html` head.

---

## Phase 7 — backlog (not scheduled)

- **Background Sync API** for the outbox (Chromium): `sync` event flushes after the
  app closes. Progressive enhancement over the `online`-listener flush.
- **Badging API**: `navigator.setAppBadge(pendingRequests)` — set on hydrate, clear
  on requests view.
- **View Transitions API** for `go()` and overlay opens, feature-detected.
- **Full dark theme** on the `t-*` system + `prefers-color-scheme` default.
- **`share_target`** (share a receipt screenshot into FamilyHub → expense sheet with
  photo attached). Requires a fetch-event handler for POST shares in the SW.
- **`screenshots`** in manifest for the rich install sheet.
- **Client error table** (flush the Phase-1.3 ring buffer to Supabase).
- **Bank-email pipeline enc lane**: land parsed rows in `csv_transactions` staging
  (already enc-aware, 0043) instead of `transactions`, so `_fh_enc_guard` stops
  rejecting service-role inserts (known issue, 0035 note).

---

## Sequence & effort summary

| Phase | What | Effort | Deploy artifacts |
|---|---|---|---|
| 1 | storage.persist + update chip + error handler | 1 session | src, sw.js bump |
| 2 | XSS escape-by-construction sweep | 1 session | src, sw.js bump |
| 3 | Windowed hydrate + IDB snapshot | 2–3 sessions | migration + src, sw.js bumps |
| 4 | Install UX + manifest | 1 session | manifest, src, sw.js bump |
| 5 | Deploy-time minification | 1 session | build.js, vercel.json |
| 6 | Zoom/dark-meta/nav-preload/back-button/DB+API hardening/CI | 1–2 sessions | migration, src, api, CI |

Rollback story: every phase is a normal Vercel deploy (revert = redeploy previous
commit + SW bump); migrations follow the repo's append-only + paired-revert pattern
(0031/0035 precedent) — the Phase 3 migration keeps `p_txn_from = null` semantics
identical, so old clients never break mid-rollout.
