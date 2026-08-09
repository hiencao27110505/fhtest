# Release Notes ("What's New")

## Problem & Why

FamilyHub deploys many times a day from several contributors. The raw commit/deploy history (`git log`, or the curated developer-facing [`../../CHANGELOG.md`](../../CHANGELOG.md)) is a developer artifact — timestamps and commit subjects a non-technical family member has no reason to read and no way to interpret.

The in-app "What's new" panel is a second, hand-curated log aimed at that family, not at developers. An entry exists only when someone judges a change worth telling them about — most commits (fixes, refactors, perf, internal plumbing) never become an entry. Copy is bilingual (VI with full diacritics, EN plain) and written in a warm, plain-language, problem-then-solution voice ("what wasn't working" → "what changed"), explicitly not commit-message tone. See the authoring rules and banned-phrase list in `.claude/skills/release-notes/SKILL.md`.

## Architecture & How It Works

Everything lives in `src/js-ui/90-release-notes.js`.

- **Data**: `RELEASES` (`:45-205`), an array of `{ id, date, time, ver, icon, vi:{t,problem,sol}, en:{t,problem,sol} }`, newest entry first (shape documented at `:18-24`). `icon` is a key into the `ICO` map of inline SVG path fragments (`:28-43`), shared across VI/EN. `ver` is the SW build (`sw.js` `CACHE_NAME`) the change shipped in.
- **Render**: `fhRenderWhatsNew()` (`:231-247`) builds one row per entry into `#whatsnew-list`, picking `vi`/`en` via `isVi()` and formatting `date · time · ver` via `fhReleaseMeta()` (`:222-229`). `openWhatsNew()` (`:249-256`) renders and opens `#modal-whatsnew` (`src/index.html:753`).
- **Read-state**: a single localStorage key, `fh-seen-release` (`FH_SEEN_RELEASE`, `:207`), stores the `id` of the last-seen entry. `fhLatestReleaseId()` (`:209`) is just `RELEASES[0].id`. `fhHasUnseenRelease()` (`:211`) compares seen vs. latest. `fhMarkReleasesSeen()` (`:212`) writes the latest id and calls `fhReleaseBadge()` (`:215-218`), which toggles two dot elements: the Settings gear icon (`src/index.html:86`, `#wn-dot-gear`) and the "What's new" row (`src/index.html:746`, `#wn-dot-row`). Opening the panel counts as "seen" immediately (`:255`), even if dismissed by tapping the scrim rather than reading to the end.
- **Auto-surface**: the `fhReleaseBoot` IIFE (`:261-274`) runs on load, sets the badge state, and — only if the user is already onboarded (`fh-onboarded==='1'`) and has an unseen release — waits 900ms, rechecks unseen-ness (it may have been marked seen elsewhere in the meantime), and bails if any `.modal.on`/`.sheet.on` is already open, so it never interrupts something the user is mid-way through. Only then does it call `openWhatsNew()`.
- **New-user exemption**: a brand-new user must not see the entire historical backlog on first launch. `obInit()`'s onboarding-complete step sets `fh-onboarded` and, in the same breath, calls `fhMarkReleasesSeen()` directly (`src/js-ui/80-onboard-boot.js:224-225`) — so by the time `fhReleaseBoot` checks, there is nothing unseen yet.
- **Version stamping**: `build.js` (`:69-75`) reads `CACHE_NAME` out of `sw.js`, extracts `vNNN`, and substitutes it for the `__FH_VERSION__` token in the built `index.html` — this is both the "you're on version vNNN" footer and the value that should be used as a new entry's `ver`.

## Current State

Mechanically simple and complete — array in, localStorage flag out, no backend, no sync, no migrations. The only ongoing work is content: adding one curated entry per shippable user-facing change. This repo has a dedicated `release-notes` Claude Code skill (`.claude/skills/release-notes/SKILL.md`) for exactly that — new entries should go through it rather than hand-editing `RELEASES` ad hoc, since it also owns the copywriting rules, the SW version bump, and dedupe-by-feature against existing entries.

## Related

- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- `.claude/skills/release-notes/SKILL.md` — the maintenance workflow for this file's data.
- `DESIGN.md` ("What's New" section) — the Apple HIG-style visual spec the panel follows.
- Tip for other feature docs: `RELEASES[]` in `src/js-ui/90-release-notes.js` is a useful secondary source of historical rationale. Its entries already narrate, in plain problem/solution form, changes to encryption (`2026-08-03-passcode`, `2026-08-03-vault`, `2026-08-04-vault-photos`, `2026-08-06-family-code`), key-card auth (`2026-08-06-family-code`), reactions (`2026-08-01-reactions`), requests/upcoming (`2026-08-01-future`), and the house customizer (`2026-08-01-house`). Worth checking when writing or dating those docs, not acted on here.
