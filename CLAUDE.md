# FamilyHub — agent working instructions

FamilyHub is a **single-file PWA**: the app ships as one `index.html` (+ `sw.js`, `manifest.json`,
icons, `vendor/`) that Vercel serves statically. The Supabase backend is **live, with real family
data**. As of the Phase-1 modularization, `index.html` is **generated** from concern-split sources
under `src/`. Read this file before editing anything here; the rules below are ordered by how much
damage a violation does.

The two companion docs are the source of truth for their areas. **Point to them; do not restate them.**
- **`BUILD.md`** — the build/edit/commit workflow and why the split is safe.
- **`DESIGN.md`** — all UI/UX rules (tokens, type scale, components, motion, voice, currency, checklist).

---

## 1. `index.html` is generated. Never hand-edit it. (critical)

`node build.js` overwrites `index.html` wholesale from `src/` (`build.js:46`). Any manual edit to
`index.html` is silently lost on the next build and never reaches the source of truth.

**The only workflow:**
```sh
# 1. edit the right file under src/  (see §2 for the map)
npm run build          # = node build.js  → regenerates ./index.html
npm run check          # builds, then fails if index.html drifted from src/  (the only drift guard — no CI)
# 2. commit the src change AND the regenerated index.html together, in ONE commit
```
- `index.html` **is committed** — and Vercel also **rebuilds it from `src/` on deploy** (`npm run build`;
  see §8), so keep both in sync. Never commit a `src/` change without its rebuilt `index.html`, and never
  commit an `index.html` change without the matching `src/` edit.
- The split is **verbatim contiguous slices**, so a rebuild is **byte-identical** until code actually
  changes. Do not reindent, reformat, or add/remove trailing newlines in `src/` files "for tidiness" —
  each file must end with no trailing newline, or the rebuild diffs for no reason.
- **`sw.js`, `manifest.json`, icons, and `vendor/` are NOT generated** — hand-edit them at the repo root.
- `tools/split.js` is a **one-time carve**, not a build step. `npm run split` OVERWRITES all of `src/`
  from `index.html`. Do not run it in normal work.

## 2. Source layout & load order (high)

`src/index.html` is the shell (head, pre-paint resume gate, markup) with three build markers, each
replaced by its directory's files concatenated in **lexical filename order**:

| Marker | Replaced by | Runtime |
|---|---|---|
| `/*@build:css@*/` | `src/css/*.css` (14 files) | the main `<style>` body |
| `//@build:js-ui@` | `src/js-ui/*.js` (12 files) | classic `<script>`, **global scope** |
| `//@build:js-data@` | `src/js-data/*.js` (7 files) | `<script type="module">`, **module scope** |

- Filenames carry a **2-digit numeric prefix**; concatenation is `readdirSync().sort()` (lexical, **not
  numeric**), and that order **is** the CSS cascade / JS execution order. Keep the width consistent: a
  new `100-x.css` would sort *before* `20-x.css`. New code goes in the right file at the right place; a
  new file needs a prefix that sorts it into the correct position. Never reorder files or move top-level
  code between files without preserving order.
- Keep the three markers byte-exact and each present exactly once; they must match `MARKERS` in
  `build.js` (the build throws "marker not found" otherwise). They are valid CSS/JS comments — don't
  "clean them up."

## 3. Runtime scope & load-order invariants (critical)

The classic block and the module block have **different scopes** — this is the easiest thing to get wrong.

- **`src/js-ui/*` → real globals.** A top-level `function foo(){}` here is a window global, which is why
  the **~253 inline `on*=` handlers** (`onclick`/`oninput`/`onchange`) can reach it.
- **`src/js-data/*` → ES module scope.** Top-level `function`/`const` here are **NOT global**. A
  js-data function that must be callable from an inline handler or from js-ui **must** be assigned
  `window.x = ...` (see the `window.fh*` / `window.obJoin` / `window.finishOnboarding` bridges in
  `src/js-data/60-settings-family-ui.js`). A bare `function foo(){}` in js-data wired to `onclick`
  throws `ReferenceError`.
- **Keep inline-handler targets global.** Do not wrap a handler's target in a closure/IIFE/module that
  hides it from global (js-ui) or from `window.*` (js-data).
- **Write-through decorators run after their targets.** The 22 decorators in
  `src/js-data/50-writethrough-realtime.js` do `const _origX = window.X; window.X = function(){…}` — they
  must execute *after* `X` is defined (js-ui runs before the js-data module). A new file that wraps a
  global must sort after that global's definition.
- **Boot wiring stays last, and is throw-isolated.** `src/js-ui/80-onboard-boot.js` is the LAST js-ui
  file; its bottom block wires `initSheetDrag` over every `.sheet`/`.modal` and the `#peek` tap/swipe.
  A throw in an earlier top-level boot step silently kills that wiring, so risky boot steps are wrapped
  in `try/catch`. Keep it that way, and keep the wiring after the boot-init calls.
- **Vendored `supabase.js` loads before the module.** The js-data module reads `window.supabase` on its
  first line; keep `<script defer src="vendor/supabase.js">` above the `<script type="module">`.
- **iOS Safari does not fire `click` on a plain `<div>`/`<span>`** — only `<button>`/`<a>`/`cursor:pointer`
  elements (or explicit touch handlers) respond. Make tappable things `<button>`, or give them inline
  `onclick` **and** `cursor:pointer`, or bind `touchstart`/`touchend`. Never rely on a click handler on a
  bare div for mobile. (This caused the photo-peek "can't close" bug.)

## 4. Service worker & caching — `sw.js` (critical)

- **Bump `CACHE_NAME`** (currently `familyhub-v296`) when you change any **precached asset**:
  `vendor/supabase.js`, the two woff2 fonts, `manifest.json`, or the icons. Without a bump, clients keep
  the old cached bytes.
- **Editing `sw.js` itself does NOT need a bump** — it is not in the precache `ASSETS` list; the browser
  updates the SW by its own byte-diff on registration. (Bumping is *a* way to force invalidation, not a
  requirement of editing the SW.)
- **HTML is network-first**, so `index.html` reaches online clients without a bump. The precached
  `./index.html` is only the **offline fallback** and stays stale until the next bump — bump anyway if the
  offline-served HTML must be current.
- **`MEDIA_CACHE` (`familyhub-media-v2`) is intentionally never tied to `CACHE_NAME`** (photos are
  immutable, so it must survive every release). Never fold it into `CACHE_NAME` or bump its `-v2` per
  release. Keep both names in the activate-sweep allowlist; renaming either without updating that filter
  makes the cache self-delete on next activate.
- **Never cache cross-origin** (Supabase REST/RPC, Google). They pass straight to network, always fresh
  (caching them froze API GETs so writes appeared to revert). The **only** cross-origin cache is the media
  path (`/storage/v1/object/public/`), and its check must stay **before** the cross-origin bail-out in the
  fetch router.

## 5. Backend — Supabase (critical)

The project is **live with real family data.** Never run destructive or casual SQL against it.
- **Schema changes are append-only migrations** in `supabase/migrations/` (latest `0049_pin_enc_pair_search_path.sql`;
  next is `0050_*` — but confirm the free number in `AGENT_SYNC.md`, two sessions share this range). Add a new
  numbered file; **never rewrite an already-applied migration.**
- **`get_family_snapshot(p_txn_from date)` is THE hydrate** — one `SECURITY DEFINER` RPC returning the
  whole family as one JSON payload. The client destructures it by exact key/column names, and the legacy
  13-query fallback must select the identical columns. Change both sides together or hydrate breaks
  silently. Keep its grants locked: `SECURITY DEFINER`, `set search_path = public`, execute granted only
  to `authenticated`. **Windowing (0048):** `p_txn_from` NULL = full ledger; non-NULL windows
  `transactions` + `transaction_photos` + `reactions` to `txn_date >= p_txn_from`. The client uses this
  for windowed refreshes and merges the slice onto cached raw baselines (`30-hydrate.js`); NULL must stay
  byte-identical to the full result so old clients / the fallback never break.
- **Media bucket is public-by-URL (0017), a deliberate trade-off.** `family-media` object bytes are
  fetchable by anyone holding the exact `{family_id}/{ts}_{rand}.ext` path (RLS still gates list/insert/
  update/delete, not byte GET). For non-enc families this is unlisted-link privacy; for enc families the
  bytes are AES-GCM `.enc` ciphertext, so the URL reveals nothing. It was flipped from private because
  re-signing every photo on every hydrate defeated browser caching. Don't "fix" it back to private without
  restoring signed-URL caching (SW media cache keyed by pathname, not full URL).
- **RLS uses the initplan form.** Every family-scoped policy keys on `family_id = (select auth_family_id())`.
  Any new policy in a new migration MUST wrap auth helpers as `(select auth_family_id())` / `(select
  auth.uid())` / `(select auth_email())`, never bare calls — 0022 rewrote all existing policies to that
  form and a single bare-call policy loses the perf gain.

## 6. Product, i18n & copy (high)

- **Bilingual Vietnamese (default) + English, WITH FULL DIACRITICS.** Never strip diacritics. Every
  user-visible string localizes both languages in sync: static markup via `data-t`/`data-tp` (English
  fallback auto-captured; add the Vietnamese to `I18N.vi`), dynamic JS strings via `L('vi','en')`. Changing
  copy on one side only is a defect.
- **Never format dates/money by hand.** Dates go through the LANG-gated helpers
  `moFull`/`moAbbr`/`fmtDayMon`/`fmtMonYear`/`fmtDateLong`/`fmtWeekdayDay` (Vietnamese puts day before
  month: `Tháng N` / `Thg N` / `Thứ ...`). Money goes through `fmt`/`fmtK`/`amtToInput`/`parseAmtBase`/
  `amtPlaceholder`/`snapAmtInput` (VND stored in units of 1,000đ, `curMult()===1000`; money inputs use
  `inputmode="numeric"`, never `type="number"`).
- **Copy reads human.** No em-dashes, no genAI-tell / consultant-ese phrasing in user-visible strings or
  Vietnamese narrative. Warm, concise, second person. (The user removed these deliberately.)
- **No `alert()`/`confirm()`/`prompt()`.** Surface errors via `toast(_friendly(e))`; report success only
  from the completion handler *after* the write lands. Wrap Supabase writes in `_w()` (write-through /
  offline outbox), and escape user-authored text with `esc()`/`escAttr()` before it enters HTML or an
  `onclick`.

## 7. Design (high)

**`DESIGN.md` is the single source of truth — follow it, don't invent patterns.** The load-bearing rules:
44×44 minimum touch targets; real `<button>` elements for CTAs (bottom-anchored primary; destructive is
low-prominence with arm-then-confirm); type hierarchy from the scale; **semantic color tokens only** (no
raw hex, so all five themes apply); and **no colored fills** on info/quote cards, table headers, or stat
blocks (borders + a single left-accent per view instead).

## 8. Deploy & commits

- **Deploy** = `git push origin main` → Vercel runs `npm run build` (`node build.js`, which regenerates
  `index.html` from `src/`) and serves the **repo root** (remote `github.com/hiencao27110505/fhtest.git`,
  branch `main`, no `.github/`). Because `package.json` has a `build` script, Vercel auto-runs it; `vercel.json`
  sets `"outputDirectory": "."` so it serves the root — **without that, Vercel looks for a `public/` dir and
  the deploy fails.** Do not remove `vercel.json` or the `build` script without adjusting the other.
- **Commit and push only when the user explicitly asks.** When you do commit a code change, include the
  rebuilt `index.html` (§1) and, if a precached asset changed, the `sw.js` bump (§4).

---

### Pointers (don't restate — read these when relevant)
| Topic | Where |
|---|---|
| Build/edit/commit workflow + why byte-identical is safe | `BUILD.md` |
| All UI/UX rules (tokens, type, components, voice, currency, checklist) | `DESIGN.md` |
| Marker replacement + concat order | `build.js` |
| One-time carve (line-range manifest, tiling/byte asserts) | `tools/split.js` |
| Service-worker cache logic + `CACHE_NAME` | `sw.js` |
| Schema/RLS/RPC (append-only) + the hydrate RPC | `supabase/migrations/` (latest `0049_pin_enc_pair_search_path.sql`) |
| i18n helpers (`I18N.vi`, `L`, date helpers) | `src/js-ui/70-theme-i18n.js`, `src/js-ui/12-format-helpers.js` |
| Write wrapper `_w()` + `_friendly()` error mapping | `src/js-data/20-data-helpers.js`, `40-txn-writes-outbox.js` |
