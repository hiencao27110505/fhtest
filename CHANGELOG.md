# Changelog

A technical, developer-facing history of FamilyHub — what shipped, roughly when, and why.
This is distinct from the in-app, curated, non-technical **"What's New"** panel
(`src/js-ui/90-release-notes.js`, documented in
[`docs/features/release-notes.md`](docs/features/release-notes.md)), which is written for
families, not engineers.

This file is a **full-history backfill** (the repo's entire life so far: 2026-07-19 →
2026-08-07, 247 commits) grouped into eras rather than commit-by-commit — some eras
genuinely interleave in the raw commit log (CSV import was built across the same days as
encryption and Key Card auth), so entries are grouped by *what shipped*, not strictly by
calendar day. **Newest period first; within a period, entries run chronologically**, since
most eras build on the step before them.

Going forward, add an entry here when a feature area changes meaningfully — see
[`docs/COLLABORATION.md`](docs/COLLABORATION.md) for the convention.

---

## 2026-08-08 – 2026-08-12

### Onboarding becomes a curated 2-step flow (08-12)

The 9-screen wizard (welcome → locale → auth → choice → join/family → budget →
theme → done) collapses into two screens, on the principle "show the product,
defer the setup":

- **Screen 1 — intro + sign-in.** A meadow-scene inline SVG (the home hero's
  nature style: crest, oak, robin, wildflowers — decor tokens from
  `23-house-customizer.css`) replaces the 🏡 emoji everywhere (splash, hero,
  invite preview). Two selling points (E2E-private, auto transaction logging)
  and the Google button on the same screen.
- **Screen 2 — "Your family".** `find_my_invite` renders the pending invite
  (preview card + 6-digit boxes unless `card_only`) above an "or start your
  own" divider and the family-name field. Join and Create both finish straight
  to Home; the Key Card intro still follows create.
- **Locale step deleted** — device-detected (`vi` → VI + VND, else EN + USD);
  budget/members/theme steps deleted — the app owns them (Settings, budget tab).
- **Polish pass:** staggered content entrance (`.st`/`--i`), press-scale springs
  on CTAs, `prefers-reduced-motion` cross-fade fallback for screen slides,
  vibration ticks (button press + a success pattern on entry), `--shadow-card`
  token instead of bespoke double shadows, `:focus-visible` rings, localized
  aria labels on the code input.
- Cleanup: `obOrder` is now `['welcome','start']`; the progress bar, member
  invite rows, role list, budget-proportion table and onboarding theme grid are
  gone from `80-onboard-boot.js`; onboarding i18n keys replaced in both tables.

### First-run home: "Getting started" pair replaces the blank-cover prompt (08-12)

The empty-family Moments section was a single "Your family's story · Add a moment"
card whose illustrated cover **rendered blank on iOS Safari** — the `.occ` art band
is `flex:0 0 128px` with all-absolute children, so flex-basis resolves to 0 and the
band collapses. It's now a **"Getting started" (Bắt đầu)** section with two
side-by-side cards — *Log an expense* (→ `openExpense`) and *Add a moment* (→
`openMomentModal`) — each with a self-contained inline-SVG cover (a receipt + ₫ coin;
a polaroid of a tiny meadow + heart) that carries its own `viewBox`, so it can't
collapse. Shown only for a brand-new family (no photos, no spend); a family that has
logged spend but no photo yet gets the single moment card (`.gs-grid.solo`), never a
blank one. `renderHome` in `22-home.js`, styles in `21-home-today.css`.

### Onboarding follow-ups: multi-invite picker, VND-only, join self-heal (08-12)

Three fixes on top of the 2-step flow:

- **Intro** drops the "FAMILYHUB" eyebrow — the wordmark was redundant over the
  hero + title.
- **"Your family" handles multiple invites.** `find_my_invite()` only ever
  returned the newest row, so a user invited to 2–3 families saw one. New
  `find_my_invites()` (migration `0054`, JSON array, same per-invite shape,
  SECURITY DEFINER + `auth_email()` filter) backs a redesigned screen: a
  selectable radio-list of invite cards with the 6-digit code unfolding under the
  picked passcode-invite, "create a new family" demoted to a ghost button, and a
  single contextual primary CTA (Join in invite mode, Create in create mode) —
  fixing the old two-competing-primaries confusion. Client falls back to the
  singular RPC if the plural one isn't deployed.
- **Join no longer dies on "something went wrong".** The real error was a
  `members_user_id_fkey` violation from a stale JWT (the signed-in user's
  `profiles` row was gone — e.g. after a test-user reset — but the browser kept
  the session), which `_friendly()` didn't recognise. `obJoin` now detects the
  stale-session/FK shape and recovers by signing out for a clean re-auth.
  `joinFinalizeDB` also stopped writing a plaintext `members.name` to an
  encrypted family (it tripped the 0033 enc-text guard): name goes through
  `fhField` when the key is ready, is skipped for a card-join with no key yet, and
  stays plaintext only for non-encrypted families. `color` always rides along.

### Frontend goes VND-only (08-12)

`CUR` now defaults to `'VND'` (`10-nav-model.js`); onboarding no longer detects
or produces a currency, and `create_family` is always called with `p_currency:'VND'`.
The USD branch in the currency helpers (`fmt`/`fmtK`/`curSym`/`curMult`/…) stays
**only** as a render fallback for the two legacy `families.currency='USD'` rows
(hydrate still honors the DB value); nothing user-facing offers USD. Base amounts
are stored currency-agnostic (VND is a ×1000 display multiplier), so this is a
display-default change, not a data migration — full USD removal is deferred.

## 2026-08-01 – 2026-08-07

### PWA hardening, Phases 1–6 (08-07)

A single large commit (`717f9d5`) shipping `PWA-PLAN.md` phases 1–6, SW versions v290–v296:

- **P1** (v290): `navigator.storage.persist()`; opt-in SW-update chip replacing silent mid-session reloads; global error handler.
- **P2** (v291): XSS escape-by-construction sweep — all output funneled through shared `esc()`/`escAttr()` helpers.
- **P3** (v292 + migration `0048_snapshot_windowing.sql`, v293): windowed `get_family_snapshot` (photos/reactions windowed; `null` = full, byte-identical); client-side windowed-merge hydrate with out-of-window full-hydrate escalation; large/encrypted snapshots spill to IndexedDB instead of localStorage; shared-device wipe.
- **P4** (v294): manifest hardening (`id`/`lang`/`dir`/`display_override`/`launch_handler`/shortcuts), `beforeinstallprompt` capture + install sheet + settings row + post-onboarding nudge, SW precaches icon-512/maskable.
- **P5** (v295): deploy-time minification (esbuild, whitespace-only, never identifiers/DCE) — committed `index.html` stays unminified so `npm run check` still holds.
- **P6** (v296 + migration `0049_pin_enc_pair_search_path.sql`): re-enabled pinch-zoom for WCAG 1.4.4 compliance; `color-scheme`/description meta; SW navigation preload; Gemini proxy now JWT-gated + throttled; CI added (parse + build check). Android back-button handling (item 6.4) explicitly deferred pending interactive testing.

Closed out with a user-facing release note for install-to-Home-Screen + performance (`aa28959`, v297).

### Key Card auth era: replacing the 6-digit passcode (08-06)

A single intense day that replaced the passcode as the E2EE "safe key" with a 128-bit Key
Card (Crockford Base32 + checksum, `FH-XXXX` form), landing in four phases plus supporting UX:

- **Phase A — card core, dormant** (`db4f2c6`, migration `0042_family_key_wraps.sql`): `family_key_wraps` supports multiple simultaneous wraps per family (so passcode and card can coexist); card generation/parsing validated across 60k cases. No family has a card wrap yet — fully inert.
- **Card delivery UX**: QR + opaque one-time link as *self-contained* card formats rather than server-side claim pointers (`14e1b46` introduced claim-link machinery via migration `0044_card_claim_links.sql`; same-day product call reversed course — `c1f9bde` dropped the whole claim system, migration `0045_drop_card_claims.sql`, in favor of the URL fragment itself carrying the key). Vendored QR encoder (repo forbids CDN dependencies), print removed, self-backup vs. share actions split.
- **Phase C — owner migration for existing families** (`78ca3ab`): opt-in "Nâng cấp lên thẻ khóa" — re-wraps the same DEK under a card without touching passcode, proven byte-identical across 200 cases; both wraps stay live (true dual-wrap, no lockout risk); unlock prompt auto-routes card families to card entry.
- **Phase B + D — card-born families & passcode retirement** (`9ac0f43`, migrations `0043_family_card_birth.sql`, `0046_whitelist_join_card.sql`, `0047_drop_family_passcode.sql`): new families skip the passcode screen entirely and are born on a card; joining a card family uses Gmail-whitelist-only (no code); an owner can retire the passcode once a live card wrap exists (refused otherwise — never a lockout).
- Follow-on UX: paste-card-at-unlock + recovery copy (`e2756ad`), card link usable while signed out (`97a0889`), one-tap paste + equal-weight Safari QR-handoff CTAs (`5fd6a4f`), app-wide rename from "Key Card" to "mã khóa (mã hóa)" per product/i18n call with no GenAI-tell copy (`fdcfdd8`), general copy/design polish (`4b41758`).
- Release notes named the underlying crypto for user trust — 128-bit key / AES-256 / end-to-end, then the brute-force-infeasibility math instead of a bank comparison (`20cf06e`, `04aeb4a`).

> **Migration-numbering note**: `0043` was independently claimed by both the CSV staging
> table and Key Card's `family_card_birth` (flagged same-day in `3f24543`, left as a known
> double since both were already applied); `0044` (`card_claim_links`) was applied to prod
> then fully reverted via `0045` and deleted from the repo, which is why the unmerged
> seed-migration branch (see Unmerged section below) had to renumber twice, past both
> `0044` and the taken `0048`. Full story: [`docs/COLLABORATION.md`](docs/COLLABORATION.md).

### CSV import: interleaved build-out (08-03 – 08-07)

Built in parallel with the encryption era below, and repeatedly blocked/reshaped by it.
Progression: client-side heuristic column-mapping with a Gemini fallback proxy for
ambiguous files (`b469897`) → first real screen, technical-preview only (`8f09b20`,
migration `0034_csv_format_fingerprints.sql` for cross-family cache of resolved column
shapes) → explicit compatibility doc once `0033`'s trigger-level enforcement confirmed
plaintext CSV promotion would be rejected for encrypted families (`a17fcfd`, `9bc9a3d`) →
design questions resolved and `AGENT_SYNC.md` opened specifically for this (`ddbe088`) →
staging table with `_enc` columns from day one plus a shared masking utility, verified to
produce identical Gemini mapping confidence on masked vs. real data (`1a0d116`, migration
`0043_csv_transactions_staging.sql`) → real review screen: parsing, category
fuzzy-matching, ready/needs-category/possible-duplicate/deferred bucketing, self- and
cross-source dedup, promotion into the live ledger reusing the bulk-logging write path
(`39fef5b`) → bug fixes to the review screen's rendering and a module-boundary bug
(`d4bd279`, `6479932`) → mixed-sign (income vs. expense) rows are no longer a dead end,
just deferred with a path forward (`8d0f748`) → auto-categorize from transaction history +
keyword rules, review leads with the win (`937d498`) → several UX iteration passes: dense
native rows + nav-bar Save (`71f192a`), bottom-sheet pickers + date grouping (`8d44d09`),
first-run "adopt the file's categories" + full row edit sheet (`5cd4a7f`), warm empty-state
picker (`9dba12e`), inline expandable rows + unified attention section + pre-import trust
strip (`2ea07cd`).

> **Open as of end of period**: `AGENT_SYNC.md` records an unresolved design question dated
> 2026-08-07 from the bank-email side — *"who encrypts `email_transactions`, and when?"* —
> since that pipeline's staging rows are written by an unattended server-side script that
> can never hold the family DEK (unlike CSV import's client-side writer). Three options are
> on the table (coverage-job pattern, asymmetric envelope, transient-buffer TTL); no
> decision had landed on `main` by `aa28959`. (A proposed answer exists only on the
> unmerged `bank-email-pipeline-code` branch — see Unmerged section below.) Detail:
> [`docs/features/bank-email-pipeline.md`](docs/features/bank-email-pipeline.md#current-state).

Note: `csv_transactions` (the staging table from `0043` above) ended up schema-only —
promotion bypasses it entirely, reusing the bulk-expense write path directly. Detail:
[`docs/features/csv-import.md`](docs/features/csv-import.md#current-state).

### Demo-data cleanup, localization & detail-screen consistency (08-04)

Removed hardcoded demo personas/data (fake Emma/James event contributions, "Good evening,
Emma" flash, fabricated founder note) and localized roughly 40 previously-hardcoded UI
strings, adding a per-member Language switcher (`ff8b1df`, bundled with the in-progress
goal-detail feature and migration `0037_archive_goal.sql`). Detail screens
(goal/occasion/expense) were brought to consistency — semantic success color instead of
brand pink, full family-review block parity across all three proposal types, VND-rounding
preview on amount edit (`2d65fee`); a routing bug sent goal-row taps to the fund modal
instead of goal detail (`e8f0f60`). App-wide, disabled/greyed submit buttons were replaced
with always-live CTAs that flag the specific missing field on tap — shake, danger border,
toast, `aria-invalid` — extended from the bulk-logging pattern to every form in the app
(`3b5811a`). A demo-mode bug where signed-out requests could flash into a real user's
ledger was fixed (`cc6cfd0`).

### Web Push notifications (08-04)

Lock-screen push for reactions, requests and moods, opt-in per device via Settings →
Notifications, fanned out through a new `push-send` Edge Function with server-side-only
VAPID keys (`5c9cb24`, migration `0036_push_subscriptions.sql`). Payloads deliberately
carry only actor + kind + emoji, never titles or amounts. `fb9c3d8` (Push v2) added
nav-context so tapping a notification lands on the actual item, and rewrote copy to a
locked table (text-message-style titles, bright/rough mood split, quoting the reviewer's
exact words for request responses). `d3646ac` trimmed mood-push copy to a single
weather-style line, dropping the redundant actor name and CTA. Detail:
[`docs/features/web-push.md`](docs/features/web-push.md).

### Bulk expense logging (08-03)

A dense, single-day iteration arc: N collapsible draft rows in one modal for logging
several expenses at once (`7ff4037`), followed by roughly 20 same-day refinement commits —
category guessing (bilingual, non-English-account fix), comma-delimited note parsing
(moved from on-keystroke to on-blur/Save to stop mid-type interference), auto-save drafts
with a discard guard, shake/red-border validation on incomplete cards, and a card layout
rebuild (note ↔ amount ↔ category on clean separate rows). Export was reworked twice —
first JSON→Excel-friendly copy, then a real multi-tab `.xlsx` (`ccbcf3a`, `a075373`) — with
the Excel-copy CTA temporarily hidden inside the encryption sheet context (`b88b707`).
Detail: [`docs/features/expense-capture.md`](docs/features/expense-capture.md).

### Encryption era: passcode-based E2EE for family finances (08-03 – 08-04)

Family data went from plaintext to end-to-end encrypted in four escalating steps, each one
closing the gap the previous step left open:

1. **Opt-in E2EE** (`9153dea`, migration `0030`): joining becomes two-factor (Google
   whitelist + a 6-digit family passcode that never leaves the device). PBKDF2+HKDF splits
   the passcode into K_auth (server-verified, throttled) and K_wrap (unwraps a random
   256-bit family DEK); amounts/notes/goal names encrypt client-side as AES-GCM. Staged
   rollout: off → dual → enc, with export, verify-before-upload, and an owner-only scrub
   as the sole destructive step.
2. **Default-on for new families** (`6359af7`, migration `0032`): new families are born at
   `enc_state = 'enc'` with a mandatory passcode step in onboarding — nothing to migrate,
   ciphertext from the first write. Realtime pushes the passcode change to every device so
   locked members get a state-aware unlock prompt automatically.
3. **Database-enforced encryption** (`7cd78c3`, migration `0033`): BEFORE INSERT/UPDATE
   triggers on all 8 money tables now reject any plaintext write once `enc_state != 'off'`,
   closing the loophole where a stale client build could still write plaintext. Companion
   self-recovery (`e371f2a`) queues rejected writes into the offline outbox and
   auto-triggers an SW update + re-sync + passcode prompt so a stale device heals itself
   instead of losing the user's entry.
4. **Encryption made permanent** (`b2f69f8`): with no way left to create uncovered
   plaintext rows, "decrypt back" and the "finish encrypting" user concept are removed —
   `enc` is now a terminal state. Lock widget promoted to a real design-system component
   per `442f989`; copy pass to strip AI-tell phrasing from all encryption strings
   (`f05bd16`).
5. **Beyond money** (`9aa39b2`, migrations `0038`/`0039`, plus `0040`/`0041` cleanup): the
   encryption promise extends to everything a family types or uploads — event captions,
   category/member names (`_enc` columns with a one-way valve trigger), and photo bytes
   (client-side AES-GCM `.enc` objects, decrypted at render into memory-only object URLs).
   Device-at-rest coverage: warm-boot snapshot, expense drafts, offline-queued photos all
   encrypt with the cached DEK. An EXIF/GPS leak in the upload path was closed as part of
   this pass. `0041` fixed a production bug where the pre-E2EE mime allowlist rejected
   `.enc` photo uploads outright.

Full architecture: [`docs/features/encryption.md`](docs/features/encryption.md).

> Migrations `0033` (enc enforcement) and `0034` (CSV fingerprint cache) briefly collided
> on the same number across two branches — resolved same-day in `9bc9a3d`.

### Home surfaces: Memories, Requests, house customizer (08-01 – 08-03)

Small-scope polish across the social/home layer, mostly landing before the encryption work
took over. Memories (Khoảnh Khắc) started reflecting reactions left on photo-expenses —
album collages, the detail overlay, and per-member timeline rows all read from the same
reacted transaction. Requests got a real Home entry point for the requester's own pending
proposals. Families also gained a shared "Chăm chút tổ ấm" customizer — 4 house styles × 5
tree species × 5 pets, each with dawn/day/dusk/night states, synced per-family over
realtime (migration `0026_house_customization`).

- Memories: reaction bar + per-member reaction rows in album/timeline/detail views (`f544cc4`).
- Requests: Home widget lists every pending proposal across expenses/goals/occasions, actionable-first (`ba8285f`); full migration DDL recorded in-repo (`f793c38`, `0024_requests.sql`).
- House customizer: bespoke SVG house/tree/pet assets, no emoji, `families.house` jsonb + `set_family_house()` (`ad7c35d`, `0026_house_customization.sql`); DESIGN.md compliance fixes (`e9c8d22`, `6e99225`, `785f4ca`); measured yard composition (`a9018dd`).
- Sắp tới cards: switched to real photo/illustration (no emoji), then fixed non-rendering on iOS Safari (`76321e3`, `ee82575`); Sắp tới now lists every upcoming item, not just the nearest (`32aadd9`); Khoảnh khắc filters to memories that have actually happened (`51c01a6`).
- Removed the "Rủ nhau đi chơi" homescreen card; Budget tile now shows reserved amount (`723bac2`).
- One-time backfill recorded for mirror-events dropped by a partial-index/upsert bug since migration `0015` (`5319139`) — see the mirror-event bridge note in [`docs/features/memories.md`](docs/features/memories.md).

### In-app "What's New" release notes (08-01)

Introduced the user-facing changelog panel (this file's counterpart) and its authoring
workflow. First cut used colored tiles/badges; redesigned same-day to the native Apple HIG
"What's New" pattern — tinted line glyphs, problem→fix prose, single accent color
(`5280d7b`, `2bbecde`, `ee91438`). A dedicated `release-notes` skill was added to keep
future notes on-voice and GenAI-tell-free (`aee5bd2`, `880e828`, `b453953`).

### Bank-email ingestion pipeline — schema only (08-01)

Landed the additive DB schema for the bank/transaction-email ingestion pipeline (not yet
wired to any client UI): `email_transactions`, `parse_failures`, `sender_fingerprints`,
`mailbox_connections`, `known_provider_domains`, migration `0025_bank_email_pipeline.sql`,
all service-role-only RLS. Two same-day follow-ups shifted the categorization model from
automated keyword rules to human-reviewed, cached-by-sender-fingerprint categorization
(`7fb8b4e`, corrected in `4bf9e19` after realizing one sender can span many real
categories — category must stay per-transaction, not per-sender), and stored resolved
`member_id` on ingestion so a future review UI can route rows to the right person
(`f4a043c`, `0026`→`0027`/`0028` after a migration-number collision with house
customization, resolved in `1a0d98e`). Full picture (including what's still unmerged):
[`docs/features/bank-email-pipeline.md`](docs/features/bank-email-pipeline.md).

---

## Unmerged / in progress (not on `main`)

None of this is deployed. Two branches hold work from 2026-08-06 – 08-07 that never merged
as of the last commit on `main` (`aa28959`):

### `origin/bank-email-pipeline-code` (2 commits)

- **`1868ed2`** — Versioned the actual Apps Script pipeline source
  (`pipeline/bank-email-pipeline.gs`, 794 lines) plus `pipeline/extraction.md` and a
  README, moving it out of a local Downloads folder into the repo for the first time.
  Includes the masking layer (LLM never sees real data — reversible shape-preserving token
  substitution) and local extraction templates so repeat senders skip the LLM call
  entirely. Deploy is still manual paste-into-editor; `clasp` CLI wiring flagged as a TODO.
- **`0949f36`** — Proposes an answer to the open `email_transactions` encryption-ownership
  question (see the CSV import era above): the "asymmetric envelope" option is framed as
  effectively free since sealed-box writes are pure JS with no backend dependency — the
  real blocking dependency is a decrypt-capable review UI. Also flags that server-side
  dedup breaks once amounts are encrypted (must move client-side) and that `raw_body`
  should be deleted at promotion/rejection regardless of which option wins. **This has not
  been merged to `main` or acted on** — the open question there is still unresolved.

### `origin/bank-email-known-providers-seed` (3 commits)

- **`6b8f404`** — Seeds `known_provider_domains` with 11 major Vietnamese bank sender
  domains, intended to drive the pipeline's onboarding bank-picker UI. Idempotent
  (`ON CONFLICT DO NOTHING`).
- **`8234dda`**, **`533f8d6`** — Two rounds of migration renumbering as `main` kept taking
  the free slot out from under this branch: `0044` (taken by the now-reverted
  `card_claim_links`) → `0048` (then taken by `snapshot_windowing`) → `0050`, the first
  number still free relative to `main` as of `aa28959`. Still unmerged, still at
  `0050_known_provider_domains_seed.sql`.

---

## 2026-07-19 – 2026-07-31

### Bootstrap: single-file PWA (07-19 AM)

The repo starts as an uploaded, already-functional single-file prototype, then gets a fast
run of on-device fixes once it's actually opened on a phone.

- Initial upload + deploy of the FamilyHub PWA (`index.html` + service worker + manifest + icons, installable/offline-capable).
- iOS viewport/shell fixes (`position:fixed;inset:0`, text-size-adjust) to stop letterboxing and mis-scaling in standalone mode.
- First pass at expense photos → Memories, drag-to-dismiss bottom sheets, an Apple Photos–style photo grid/mosaic, and the expense create/edit sheet becoming a full-screen modal.

### Memories polish + onboarding redesign kicks off (07-19 PM)

Continued photo/memory refinement alongside the start of a proper onboarding flow,
redesigned mid-stream to Apple HIG standards.

- Memories: date-grouped sections, dynamic collage layouts by photo count, multi-photo picker, category CRUD with rename cascade, editable future/reserved expenses.
- Onboarding flow built (welcome → sign-in → create/join family → profile → family setup → done) then immediately redesigned: HIG-consistent screens, a theme step, richer invite roles.
- Real current date wired in (`TODAY = new Date()`, guarded to July 2026) replacing a hardcoded demo date; `DESIGN.md` introduced.

### Real Google auth + first backend wiring (07-19 late)

The onboarding UI stops being a mock and starts talking to a live Supabase project.

- Real `signInWithOAuth` against the fhtest project; migrations `0001`–`0005` (schema, views, functions/triggers, RLS/storage, security hardening) committed as the applied baseline.
- Switch to Google Identity Services ID-token flow (`signInWithIdToken`) — the redirect flow breaks out of an installed iOS PWA into Safari and loses the session, so GIS becomes the in-app path with redirect kept as desktop fallback.
- Create-family wired to a real `create_family` RPC + inserts; invite-code join flow added (`0006`).

### Data layer + multi-family (07-20 early)

The app moves from mock arrays to a real hydrate/write-through data layer, with support
for belonging to more than one family.

- Multi-family picker: list/switch families on login and in Settings (`0007`: `my_families`/`switch_family`).
- `loadFamilyData()` hydrates members/categories/budgets/transactions/events/fundings/savings/memories from Supabase; write-through mutations on every create/edit/delete path; realtime channel reload on family-row changes (`0008`).
- Adversarial review pass fixed 17 findings (date pinning, wrong-data chips, funding leaks, error surfacing).
- "Always-real": auto-load the active family on every boot instead of only after a picker tap, mock arrays emptied, income ledger + soft-delete + `set_savings` RPCs added (`0010`).
- New feature UIs (manage family/members, saved-for-events, income), deferred photo persistence to Storage, budget fetch-on-open + auto-split, PWA self-update on `controllerchange`.

### Money/photo hardening sprint + first HIG pass (07-20 day)

A concentrated bug-fix run on real production data, capped by an app-wide compliance audit.

- `set_savings` enum-cast 400 fixed (`0011`); a service-worker bug caching cross-origin GETs was silently reverting writes after every reload (fixed by never cache-first-ing cross-origin requests).
- Photo compression before upload (≤1600px, JPEG @0.82) + storage/mime caps (`0012`); event soft-delete with full funding reversal via `archive_event` (`0013`).
- Budget sheet VND scale bug (values were round-tripping at 1/1000th), persistent category deletes, a permanent "Others" catch-all absorbing unallocated budget.
- Warm-start work: skip the sign-in flash for returning users, then a localStorage snapshot cache so the app opens on cached data instead of a splash.
- A full HIG compliance pass removed all 10 `alert()`/`confirm()`/`prompt()` calls, hardcoded MoMo-pink leftovers, and 23 unchecked Supabase writes that silently swallowed RLS-denial errors.

### Invite hardening + photo pipeline maturity (07-20 late)

Closes out day one with a security fix on invites and a real photo storage/caching pipeline.

- Single live invite code per family, explicitly rotatable via `regenerate_invite()` (`0014`) — previously every open of the invite sheet minted a new 14-day-valid code with no expiry (6 were live in production).
- `events.source_txn_id` links a photo-expense to its mirror event so re-hydrates stop spawning duplicate events + duplicate budget reservations (`0015`, `0016`; one production expense had triple-billed itself).
- Storage bucket flipped public for stable URLs instead of re-signing on every hydrate (`0017`); service worker caches photos as CORS (not opaque) responses to avoid Chromium's opaque-cache padding and stale-error caching.
- Photo "peek" (tap to lift out, delete lives inside), per-photo delete, EXIF capture-date extraction + bulk-assign-photos-to-expenses-by-day (`0018`).

### Home/Memories consolidation + 3-tab IA revamp (07-24, 07-26)

After a few days' gap, the four-tab structure collapses into three, and Home/Memories get
unified around one memory model.

- Memories unified: expense photos shown directly, mirror events hidden from the Events list; Home gets a memories feed + a celebratory "fully funded" state for events.
- IA restructure from Home/Spending/Events/Memories to **Nhà · Thu Chi · Khoảnh Khắc** — Events+Memories merge into Khoảnh Khắc (segmented: Dự định · Kỉ niệm · Album), Thu Chi absorbs savings/goals/income; adds `events.target_amount` nullable + `is_occasion` flag (`0019`) so an occasion can exist without money.

### Perf big bang + Khoảnh Khắc HIG redesign (07-27)

A dedicated performance pass lands the same day as a full HIG redesign of the new Khoảnh
Khắc tab.

- Migrations `0020`/`0021` (saving-goals split: `saving_goals` + optional occasion link, funding-points-at-goal-or-occasion) retroactively tracked to match what was already live.
- "Perf big bang" R1–R9: vendored `supabase-js` UMD + self-hosted fonts (drop the esm.sh/Google Fonts waterfall), `get_family_snapshot()` single-RPC hydrate replacing 13 queries, echo-suppression of own writes on realtime, dirty-check renders, an IndexedDB offline outbox for expenses logged while offline (`0022`: RPC + RLS-initplan/index hardening).
- Khoảnh Khắc rebuilt around a calendar-hero with one continuous scroll, gapless photo collage, and a full Vietnamese localization pass (~250 dynamic strings + 58 `data-t` bindings via an `L('vi','en')` helper).
- Several follow-on iOS-specific fixes chasing a stubborn "tap/swipe doesn't dismiss the photo peek" bug, eventually traced to a render error upstream silently killing gesture wiring.

### Modularization (src/ + build.js) + Khoảnh Khắc timeline unification (07-28)

`index.html` stops being hand-edited directly — this is where the `BUILD.md` era begins.

- `index.html` split into `src/` (14 CSS, 12 js-ui, 7 js-data files) reconstituted byte-for-byte by `node build.js`; `tools/split.js` did the one-time carve, `package.json` gained `build`/`split`/`check` scripts, `BUILD.md` documents the edit-src → build → commit workflow. Zero runtime change in this commit.
- A same-day Vercel deploy break (package.json's `build` script made Vercel look for a `public/` output dir) fixed via `vercel.json` pinning `outputDirectory` to `.` — every deploy since modularization had silently been failing until this landed.
- Khoảnh Khắc continues consolidating: upcoming occasions render as "memory-in-waiting" nodes on the same timeline as past memories, photo-expenses become memory nodes grouped by day, and the timeline + photo album finally unify into one item-level memory view.

### Tài Chính hero redesign + design-token reconciliation (07-29 AM)

The finance tab gets a from-scratch hero visualization, then the whole app is pulled onto
the same restrained design language.

- Allocation-ring hero (inner ring = spending composition, outer = budget/pace) replaces the old stat-card, then redesigned again same day to a single restrained ring + swipeable daily-spend chart.
- An 11-finding design audit tokenizes what the hero had invented ad hoc (`--ring-ok/pace/over`, `--surface`, `--fill-neutral`, `--chev`, shadow tokens) and raises the whole app's display weight from 800→700 and mutes transaction amounts, matching the hero's restraint.

### Bilingual/i18n overhaul + tab consistency (07-29)

A structural fix to language switching, which had been leaking English/Vietnamese on
nearly every screen.

- Root cause: `applyLang()` only localized ~40 wired nodes and fell back to raw captured literals rather than `EN_DEFAULT`; fixed, then 161 hardcoded strings wired via `data-t`/`data-tp`/`data-ta` across every tab and modal, dictionary made complete in both languages.
- Follow-up terminology unification pass (danh mục vs hạng mục, khoản chi, kỷ not kỉ, etc.) plus a cross-tab consistency reconciliation between Tài Chính and Khoảnh Khắc (CTA language, data-number coloring, shadow values, first-card alignment).

### Home emotional-feed redesign + habit-loop hooks (07-29)

Home is rebuilt from a data mirror of the other two tabs into a distinct, feeling-first
surface, then deliberately instrumented with retention hooks.

- `renderHome()` rewritten around a single daily centerpiece (nearest occasion, or a resurfaced memory, or a warm invite) plus a "money, felt" mood read (🌿/⚡/🍂) computed from budget pace — the old `ov-card` mirror dashboard removed outright.
- Two waves of Hooked-model habit-loop hooks added under an explicit "facilitator ethic, no streaks/guilt" constraint: byline attribution + on-this-day + look-ahead (Wave 1), then welcome-back digest + one-time savings-milestone celebration + family avatar stacks + a gentle empty-feed nudge (Wave 2).

### Emotional weather feature (07-30 early)

A new shared, realtime family-mood feature lands on Home.

- "Bầu trời của nhà": each member sets a mood, gated behind reciprocity (share yours to see others'), synced live across devices via a realtime subscription.
- Weather FX: one-shot animated reactions (aura pop, card-wide weather like rain/storm/sun, a name pill) when a mood changes, with a persisted seen-map so a change made while you were away replays once on next open; respects `prefers-reduced-motion`.

### Home redesign churn: "Hôm nay" → colored hero → living house → HIG widget grid (07-30)

The single most volatile day for Home — four distinct visual directions shipped and mostly
superseded within hours.

- Rebuilt as a flat, tab-consistent "Hôm nay" with a data-driven recommendation engine that rotates interaction form by day — then course-corrected same day back to a colored gradient hero with big photo-led widgets, judged more emotionally warm.
- A 6-dimension Apple HIG audit fixed 12 violations (touch targets, WCAG contrast, motion gating); iPhone-specific overflow and empty-photo-card bugs fixed.
- A "living house" concept shipped: each member is a lit window keyed to their mood, a tree grows with savings, memories hang as clothesline polaroids — extended to a full paper-canvas interior — then walked back same day to a standard Apple-grade widget grid (4 glanceable tiles) while keeping the house hero.

### Home widget-tile refinement + occasion covers + timeline merge (07-31)

The month closes with a minimalism pass converging the Home widget grid and illustrated
content on one consistent visual template.

- Widget tiles iterate through several anatomies (drawn accessories → one hero value + footer only) to stop the grid from reading as visually noisy on real data.
- Illustrated occasion covers (travel/party/outing scenes) added, then redrawn to fix a Safari-specific rendering bug (huge-spread box-shadow fills flooding solid on iPhone) and stripped of motion entirely for stability.
- Final commit of the period merges upcoming plans and past memories into one single day-grouped, date-descending timeline rail (renamed "Timeline"), closing out the Khoảnh Khắc/Home memory-model unification arc that ran through most of the month.
