# Web Push

## Problem & Why

FamilyHub's realtime layer (Supabase channel subscriptions, `src/js-data/50-writethrough-realtime.js`) only delivers while a family member has the app open in a tab or foregrounded PWA. A reaction dropped on an expense, a new future-expense/goal/occasion request, or a shared mood is invisible to everyone else the moment they close the app. For a family-coordination product where the whole point is "know what your family is doing without asking," that gap defeats the feature the moment the app isn't the active window.

Web Push closes it: a lock-screen notification that fires even when FamilyHub is fully closed, so social signals reach people "in their pocket" instead of only in-session. It deliberately covers a narrow slice of events — reactions, mood/weather shares, and request lifecycle (new + response) — the same social writes that already render as in-app cards/toasts. It is a nudge, not a data channel: the payload never carries amounts or titles (see Architecture), so it cannot become a second path for money data to leave the client unencrypted.

## Architecture & How It Works

### Three pieces

1. **Client subscription lifecycle** — `src/js-data/55-push.js`. Owns permission state, the `PushManager` subscription, and the `push_subscriptions` row for this device.
2. **Fan-out** — `supabase/functions/push-send/index.ts`. A Supabase Edge Function that takes a fire-and-forget `kind` + opaque ids from the client, resolves the caller's family server-side, builds localized copy, and sends VAPID-signed Web Push to every other opted-in device in the family.
3. **Delivery + tap routing** — `sw.js:158-186` (service worker `push` and `notificationclick` handlers) plus `_fhNavGo`/`fhNavTo` back in `55-push.js:144-179`.

### State machine and the iOS install-first constraint

`window.fhPushState()` (`src/js-data/55-push.js:41-46`) returns one of `unsupported | ios-install | denied | on | off`. The `ios-install` state exists because Apple restricts Web Push delivery on iOS to a PWA that has been added to the Home Screen (Safari 16.4+); a page open in a plain Safari tab cannot receive push at all, regardless of permission state. `_pushIOSNeedsInstall()` (`55-push.js:13-17`) detects iOS + not-`standalone` and routes the Settings sheet (`fhPushSheet`, `55-push.js:92-114`) to an install-hint message instead of a permission toggle — asking for permission in that state would either no-op or throw, and would teach the user the feature doesn't work when it's actually just not installed yet.

`fhPushEnable()` (`55-push.js:47-67`) requests `Notification.requestPermission()` **before** any `await` on `serviceWorker.ready` — the comment at line 51 flags why: iOS drops the active user-gesture context after the first await, so permission must be the very first thing requested inside the click handler or the prompt silently fails.

### `_pushSaveSub`: upsert-on-endpoint

`_pushSaveSub()` (`55-push.js:29-39`) upserts into `push_subscriptions` with `onConflict: 'endpoint'` (also enforced at the DB level — `endpoint` is `unique`, `supabase/migrations/0036_push_subscriptions.sql:21`). The endpoint is a property of the *device's* push subscription, not of the family, so re-subscribing while a different family is active re-points the same row's `family_id`/`member_id` rather than creating a duplicate. This is also why `fhPushResync()` (`55-push.js:83-90`) exists: it's called once per app session from the hydrate path (`src/js-data/30-hydrate.js:377`) to silently re-save the current subscription, so a device that already granted permission stays pointed at whichever family it wakes up in — without re-prompting for permission.

### `window.fhNotify(kind, data)` — the single fan-out entry point

Every social write that should trigger a push calls this one function (`55-push.js:119-136`); nothing else invokes the edge function directly. Known call sites:

- `src/js-ui/64-requests.js:257` — `request_response` (a reviewer approves/rejects/comments on a request)
- `src/js-data/70-goals-income-onboard-ui.js:13` — `request_new` for a newly created goal
- `src/js-data/50-writethrough-realtime.js:12` — `request_new` for a future-dated expense
- `src/js-data/50-writethrough-realtime.js:167` — `request_new` for a future occasion
- `src/js-data/50-writethrough-realtime.js:298` — `weather` (mood/weather share)
- `src/js-data/50-writethrough-realtime.js:339` — `reaction` (emoji reaction on an expense)

`fhNotify` is deliberately fire-and-forget: `sb.functions.invoke('push-send', {...}).catch(() => {})` (line 134) swallows all errors so a push failure can never surface as a failure of the write it follows. It has one piece of client-side throttling: a 12-second per-`kind` cooldown (`_pushLastSent`, lines 118/123) so a rapid re-tap on the same reaction (which upserts the same row rather than creating a new one) doesn't re-buzz every device on every tap.

### The E2EE `actorName` workaround

For encrypted families (`fhEncState() === 'enc'`), `members.name` is ciphertext server-side — the edge function has no way to resolve "who did this" from the DB alone. `fhNotify` handles this at line 130-133: the sending device includes its own display name as `body.actorName` (client already holds it decrypted). The edge function (`push-send/index.ts:142-144`) only accepts this client-supplied name when the DB-side `actor.name` is null — a plaintext family's server-derived name always wins and can't be spoofed by a client claiming a different `actorName`. This is a narrow, intentional crossing of the E2EE plaintext boundary: only a first name, only for push copy, only when the server has no other way to know it. See `docs/features/encryption.md` for the boundary this sits inside.

### Copy and privacy shape

`buildCopy()` (`push-send/index.ts:61-95`) builds per-`kind` localized copy (`reaction`, `weather`, `request_new`, `request_response`) styled as a message from that family member, not a system log — e.g. reaction copy is `"{name} {emoji}"` / `"Vừa thả {emoji} cho một khoản chi..."`. Request-response copy quotes the reviewer's exact in-app reaction line via `REVIEW_LINES` (`push-send/index.ts:54-59`), which must stay in sync with `_reqReviewSet()` in `src/js-ui/64-requests.js:27`. The payload sent over the wire (`push-send/index.ts:146-152`) carries `title`, `body`, `tag`, `url`, and `nav` (opaque routing ids) — never a raw amount or expense title, per the comment at `push-send/index.ts:13-14`, so a stolen/observed push payload leaks no financial data even for non-E2EE families.

### Warm/cold tap-routing split

The service worker's `notificationclick` handler (`sw.js:170-186`) checks for an already-open client:
- **Warm path**: an open window exists → `postMessage({type:'fh-nav', nav})` into it, then focus it. The page's listener (`55-push.js:182-186`) forwards `nav` to `window.fhNavTo`.
- **Cold path**: no open window → `clients.openWindow('./#n=' + encodeURIComponent(JSON.stringify(nav)))`. On boot, `55-push.js:188-195` reads `#n=` off `location.hash`, strips it via `history.replaceState` (so a manual reload never replays the jump), and also calls `fhNavTo`.

Both paths converge on `window.fhNavTo` (`55-push.js:171-179`), which polls `window.DB._hydrated` every 300ms for up to 20 seconds before calling `_fhNavGo(nav)`. This wait exists because a cold start (app launched fresh from a notification tap) has no family data loaded yet — `_fhNavGo` needs `window.txns`/`window.goals`/`window.events` populated to resolve `nav.tx`/`nav.eid` to an actual detail screen. Without the wait, a cold tap would race hydrate and either open nothing or crash on undefined lookups.

`_fhNavGo` (`55-push.js:144-169`) routes by `nav.k`/`nav.et`: `weather` → home (moods render on the home "sky"), `reaction` → the matching expense detail (falls back to the spending ledger if the expense is gone), `request_new`/`request_response` → the matching expense/goal/occasion detail by `nav.et` + `nav.eid`, falling back to the requests hub if the entity can't be resolved. This intentionally mirrors `_reqOpenCall` (`src/js-ui/64-requests.js:128`) — the routing table for tapping a request card in-app — so a notification tap lands exactly where the equivalent in-app tap would.

### Data model

`supabase/migrations/0036_push_subscriptions.sql`:
- **`push_subscriptions`** — one row per device: `family_id`, `member_id`, `endpoint` (unique), `p256dh`/`auth` (the two Web Push encryption keys), `ua`. RLS: any family member can `select` family-wide rows (server needs this for fan-out via service role, but note the client itself never queries this table for read purposes — see the comment at line 58-59); insert/update/delete restricted to rows matching the caller's own `member_id`. Foreign key `(member_id, family_id)` references `members(id, family_id)`, so a row can't outlive its member or point cross-family. Not added to `supabase_realtime` and not part of `get_family_snapshot` — no client ever needs to observe another device's subscription.
- **`push_config`** — a flat `k`/`v` table holding the VAPID key pair (`vapid_jwk`, `vapid_subject`). RLS enabled with all grants revoked from `anon`/`authenticated`/`public` (migration line 68) — only the service-role edge function can read it. Per the migration's header comment (lines 8-11), the actual key values are inserted directly against the live DB, never committed in a migration file, specifically so the private key never lands in git history.

### Edge function request flow

`push-send/index.ts` (`Deno.serve`, lines 97-171): authenticates the caller's JWT, resolves `family_id` from `profiles`, resolves the caller's own `member_id`/`name` from `members` (server-derived — the client's `kind`/`emoji`/`tx`/`eid`/`target` are trusted, but `family_id`/actor identity are not), looks up every other opted-in device in that family (`neq('member_id', actor.id)`, optionally narrowed to a single `target` member for `request_response`), and sends each one a VAPID-signed message via `jsr:@negrel/webpush`. Endpoints that come back `404`/`410` (`err.isGone()`, lines 161-166) are treated as uninstalled/revoked devices and pruned from `push_subscriptions` in the same request — so a stale endpoint self-heals on the next social write instead of accumulating forever or requiring a cron sweep.

## Current State

Production. `push-send/index.ts` line 1 labels itself "v2: emotional copy + tap routing," which implies a plainer v1 (likely generic copy, no `nav`/tap-routing, no per-`kind` REVIEW_LINES) existed before — no v1 code or migration is present in this repo, so that history isn't independently recoverable from source, only from the comment. Migration `0036_push_subscriptions.sql` was applied to production (fhtest) via Supabase MCP on 2026-08-04, and the E2EE `actorName` fallback assumes migration `0038` (encrypted `members.name`) is also live. Settings entry point: `src/index.html:745` (`Notifications` row → `fhPushSheet()`).

No push events beyond the four `KINDS` (`reaction`, `weather`, `request_new`, `request_response`) exist today — extending push to a new social-write type means adding both a `fhNotify()` call site and a `buildCopy()` branch, and keeping `REVIEW_LINES` in sync with `_reqReviewSet()` if the new kind reuses the review-emoji vocabulary.

## Related

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — system-level zoom-out
- [docs/features/social-alignment.md](social-alignment.md) — reactions and requests, the primary callers of `fhNotify`
- [docs/features/goals.md](goals.md) — goal creation also notifies via `fhNotify('request_new', ...)`
- [docs/features/encryption.md](encryption.md) — the E2EE plaintext boundary that `actorName` narrowly crosses
