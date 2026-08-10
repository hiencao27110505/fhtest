# House Customizer

## Problem & Why

Decorative, not core to money-tracking: a shared, whimsical home-screen personalization layer where the family picks a house style, a tree species, and (optionally) a pet, all rendered as generative SVG art on the live home scene. It's one shared configuration per family (like `weather`), not per-member.

The framing ties the tree to the family's shared savings — "the tree grows with your shared savings pool." As detailed below, this is *mostly* thematic copy, but one part of it (tree size) is a real computed link to goal-savings progress — see Architecture.

## Architecture & How It Works

### Data model is trivial; the file size is not the business logic

`families.house` is a single `jsonb` column, default `'{}'` (`supabase/migrations/0026_house_customization.sql:14-15`): `{ "house": text, "tree": text, "pet": text|null }`. No normalized table, no per-member rows. Three closed enums, client-validated against `HOUSE_KEYS` (`src/js-ui/23-house-customizer.js:545-549`):
- `house` ∈ `cottage | modern | tile | brick` (4)
- `tree` ∈ `oak | cherry | pine | willow | kumquat` (5)
- `pet` ∈ `dog | cat | rabbit | bird | duck | null` (6, `null` = no pet)

`src/js-ui/23-house-customizer.js` is 786 lines, but roughly lines 1–514 (~65%) are hand-authored inline-SVG generators for 5 trees × 5 pets × 4 sky-phase time-of-day states (`day`/`dawn`/`dusk`/`night`), ported verbatim from `mockups/house-customizer.html` (repo root — the original design mockup). `svgOak`/`svgCherry`/`svgPine`/`svgWillow`/`svgKumquat` (`:55-149`) and `svgDog`/`svgCat`/`svgRabbit`/`svgBird`/`svgDuck` (`:164-513`) each return a raw SVG string via string concatenation — no templating framework — mapped through `TREEFN`/`PETFN` dicts (`:516-518`). Shared helpers (`P()` dimming for phase, `rimArc` dusk backlight, `dew` dawn droplets, `bird()` a perching-bird dawn easter egg, `zz()` sleeping bubbles) are pure string builders local to the file. The only inputs to any of this are `kind` and `phase` — both closed enums — so despite the line count, none of it carries business logic.

### Config store and persistence

- `houseCfg()` (`:551-558`) reads `window.FAM.house`, validates each part via `_houseValid()` (`:550`), and defaults to `cottage`/`oak`/no-pet on anything missing or invalid.
- `pickHouse(part, value)` (`:560-569`) writes the optimistic local echo into `window.FAM.house`, then calls `window.setFamilyHouse()` (defined in `src/js-data/50-writethrough-realtime.js:307-319`) to persist, repaints via `window.renderHome()`, and refreshes the open toolbox sheet.
- `window.setFamilyHouse()` calls the `set_family_house` RPC (security-definer) and debounce-reloads via `_syncSoon()` — same fire-and-persist shape as `saveWeather` in the same file.
- `set_family_house(p_house jsonb)` (`0026_house_customization.sql:18-38`) normalizes to only the three known keys via `jsonb_build_object` + `jsonb_strip_nulls`, so an unset pet stays *absent* rather than a `"null"` string. It does not itself enforce the enum allowlists — that validation is client-side only (`HOUSE_KEYS`); a bad value written some other way would just fail `_houseValid()` and fall back to the default at render time, not corrupt anything else.
- Surfaced through the existing hydrate snapshot: `get_family_snapshot`'s family sub-select adds `house` alongside `name, currency, default_language` (`0026:64`) — one extra column, no new top-level snapshot section.
- Realtime: `families` was added to the `supabase_realtime` publication (`0026:135-143`) so a house change propagates live to other members' clients, the same mechanism used for other shared-family-row fields.

### App integration: house shell, toolbox, and the one real data link

`buildHouseShell(kind, phase, winsInner, act)` (`:526-540`) composes the house shell — roof variant (modern flue / tile ridge / brick chimney), wall, and per-kind extras (slat / eave+lantern / attic) — and injects the app's real door + member windows (`winsInner`) plus chimney smoke when `act` is true. Its single call site is `renderScene()` in `src/js-ui/22-home.js:150-153`, which is where this module gets wired into the live home screen; `act` is computed there too (`22-home.js:104-110`, true if the family logged anything — memory, mood, weather — today).

`openHouseToolbox()` (`:658-663`) opens a 3-segment bottom sheet ("Chăm chút tổ ấm") reusing the app's `.sheet`/`#scrim` scaffolding. `_HOUSE_CAT` (`:583-593`) is the picker catalog per segment; `_houseThumb()` (`:601-609`) renders each option's thumbnail using the same `buildHouseShell`/`TREEFN`/`PETFN` builders at the current sky phase, so the picker preview matches exactly what the home screen shows.

**Tap delight — `pokePet()`/`pokeTree()` (`:720-773`)**, wired to `onclick` on `.sc-pet`/`.sc-tree` in `renderScene()`, is UX polish, not data-bearing: `pokePet()` shows a species speech bubble (or `"Zzz…"` at night) plus a heart-burst; `pokeTree()` spawns falling leaf/needle particles and, every 5th tap, a whisper — `"Cây lớn lên cùng quỹ chung của nhà mình" / "The tree grows with your shared savings"` (`:767`). That whisper is hardcoded copy: **`pokeTree()` and `houseCfg()` never read `window.goals` or any savings/balance value** — confirmed by grep, no savings/goal/amount identifiers appear anywhere in `23-house-customizer.js` outside that one string literal and a UI subtitle.

The one place the "grows with savings" idea *is* functionally real is outside this file: `renderScene()` in `22-home.js:112-115` computes `grow = tt > 0 ? (0.7 + 0.42 * (ts / tt)) : 0.62` from `window.goals`/`window.goalOrder` (summed target/saved across all saving goals), then applies it as `transform:scale(grow)` on `.sc-tree` (`22-home.js:148`). So the tree's rendered *size* does scale with real aggregate goal-savings progress — but that computation lives in the home-screen renderer, not in the customizer module. `23-house-customizer.js` only supplies which species to draw and at what sky phase; it has no opinion on scale.

## Current State

Complete and in production, no known gaps:
- Full 4-house × 5-tree × 5-pet × 4-phase SVG catalog shipped.
- Shared per-family config store, RPC-persisted, hydrated via the standard snapshot, propagated live via realtime.
- Toolbox picker with live-matching thumbnails.
- Tap-delight (`pokePet`/`pokeTree`) shipped, including the goal-progress-driven tree scale in `renderScene()`.

No proposed/unshipped work tracked for this feature.

## Related

- `../ARCHITECTURE.md` — the hydrate/write-through pattern (`get_family_snapshot`, `window.setFamilyHouse()`-style setters, `_syncSoon()`, realtime publication) this feature follows without reintroducing.
