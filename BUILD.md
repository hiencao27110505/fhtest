# FamilyHub build (Phase 1 modularization)

The app still ships as **one file, `index.html`** — that's what Vercel serves and what
the service worker precaches. Nothing about the runtime, the deploy, or `sw.js` changed.
What changed is *where you edit*: the ~6,400-line monolith is now assembled from small,
concern-aligned source files under `src/`, and `index.html` is the **generated output**.

## Edit → build → commit

```sh
# 1. edit the relevant file under src/  (see layout below)
# 2. reassemble the single-file app:
npm run build          # = node build.js  → writes ./index.html
# 3. commit BOTH the src change and the regenerated index.html
```

`index.html` is a build artifact but is **committed** (Vercel deploys it directly, there is
no CI build step). Never hand-edit `index.html` — your change would be overwritten by the
next build. Edit `src/` instead.

If you ever do edit `index.html` by hand, `npm run check` will catch it:

```sh
npm run check          # builds, then fails if ./index.html differs from src/
```

## Source layout

`src/index.html` is the shell: `<head>`, the pre-paint resume gate, all markup, and three
build markers. Each marker is replaced at build time by its directory's files concatenated
in **filename order** (numeric prefixes = cascade / execution order):

| Marker in `src/index.html` | Replaced by            | What it is                                  |
| -------------------------- | ---------------------- | ------------------------------------------- |
| `/*@build:css@*/`          | `src/css/*.css`        | the main `<style>` body                     |
| `//@build:js-ui@`          | `src/js-ui/*.js`       | classic `<script>` (global scope, UI layer) |
| `//@build:js-data@`        | `src/js-data/*.js`     | `<script type="module">` (Supabase data)    |

- **`src/css/`** — 14 files, grouped by UI surface (tokens → shell → hero → events →
  budget → memories → sheets → onboarding → settings).
- **`src/js-ui/`** — 12 files, grouped by feature (nav/model → formatting → budget →
  events → goals → memories → sheets/capture → transactions → gallery/peek → theme/i18n →
  onboarding/boot). The bottom file keeps the boot gesture-wiring **last**, unchanged.
- **`src/js-data/`** — 7 files: client/auth → data helpers → hydrate → txn writes+outbox →
  write-through/realtime → settings UI → goals/income/onboarding.

## Why this is safe

The split is **purely textual**: every source file is a verbatim, contiguous slice of the
original file — no code was rewritten, reordered, or reindented. Concatenating the files in
order reproduces `index.html` **byte for byte**. Because the two `<script>` blocks are
reassembled into the same single global scope in the same order, every cross-file reference
(the `onclick=` handlers that need global functions, the `_orig*` write-through decorators
that must run after their targets, the order-sensitive boot IIFEs) resolves exactly as
before. The one-time carve was done by `tools/split.js`, which refuses to write unless each
region's files tile it with no gap or overlap **and** concatenate back to the original bytes.

Verify at any time:

```sh
npm run build && git diff --exit-code -- index.html   # must be a no-op
```
