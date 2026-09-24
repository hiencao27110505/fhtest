# Activation journey — from sign-in to the first money picture

The epic that makes a brand-new solo user recognise the product's value
proposition on day one: *understand your money flowing in and out, zoom in
and zoom out, without typing a single transaction — just connect your
email.* Today every piece of that journey exists (solo entry, OAuth connect,
backfill, bulk review, a partial chart) but the pieces don't add up to a
moment: the value lives behind a modal the person must discover, the chart
counts nothing until they review, the app's shell still assumes a family,
and the one return trigger (push) refuses solo users outright.

> **Status, 2026-09-24. BUILT**, big bang, on `feat/activation-journey`
> (worktree `.worktrees/activation-journey`), designed the same day in a
> grilling session (decision log §12, Q1 to Q31). Client: SW **v575**, four
> commits. Server landing LIVE: migration `0152_personal_push` applied
> (table held 0 rows), `push-send` v23 and `mailbox-sync` v64 deployed, both
> diffed byte-for-byte against `main` first. The branch is NOT pushed —
> waiting for the VPN window; before pushing: fetch, rebase, re-read
> `origin/main`'s `CACHE_NAME`, rebuild.

> **How this relates to its siblings.** `personal-activation-spec.md` owns
> the four states of the Tài chính tab; this spec keeps its state machine
> and changes what state 2 opens into. `transaction-review-spec.md` and the
> review surface in `56-csv-import-ui.js` are promoted here from modal to
> screen. `direct-mailbox-read.md` and `email-reading-v2-spec.md` own the
> pipeline; nothing in the read path changes here. `statement-capture-spec.md`
> is the alternate supply line the sparse state offers.
> `docs/features/onboarding-and-boot.md` owns the 2-step onboarding this
> spec's copy and invite-skip changes land in. `docs/features/web-push.md`
> owns push; §8 here widens it to personal-only users.

---

# Part 1 — Behaviour

## 1. Summary

- **Activation is a moment, not a funnel stage:** the first time the person
  sees a populated cash-flow chart with real categories of their own
  transactions. Prerequisite: email connected and at least ~20 transactions
  read with accurate pre-fills. Success is measured by return: 3–5 distinct
  days in the first 7, sustained over the first 4 weeks. (Measurement
  itself is deferred — no telemetry in this release, Q19.)
- **The solo user is the primary journey** (Q2). A family is an optional
  part of their picture, discovered later, never a gate.
- **The preview is real** (Q3b, Q7): the review screen renders the chart
  and category tree from staged (unreviewed) rows merged with imported
  ones. Unconfirmed rows are visually distinct; importing confirms them in
  place. This deliberately amends "no number that is not real" — the number
  is real, its *confirmation* is pending, and the marking carries that.
- **One surface for first light** (Q18): after OAuth the app opens the new
  review screen in reading mode — progress header with live counts, the
  picture assembling underneath. No silence, no pause, until done (Q5).
- **The shell stops assuming a family** (Q30, Q31): famless users get no
  tabbar at all; Tài chính is the landing for everyone, always, family or
  not.

## 2. Onboarding

- **Welcome copy** (Q17): keeps "truly private" and "effortless" but the
  effortless point is repositioned from a family ledger to the full
  personal finance picture — email reading named as the how. No structural
  change to the 2-step flow; connect stays on the tab (Q10b), never
  auto-pops (a person landing on state 1 sees one card with one CTA — that
  is already unmissable).
- **The forced-invite screen gets a skip** (Q16): a new user with a pending
  invite currently has no way past Join-or-Create. A quiet "Để sau, dùng sổ
  riêng trước" enters the app solo (`fhEnterPersonalOnly`); the invite
  stays claimable from a tracker/guide-style widget at the top of Tài
  chính (same visual family as the setup widget, Q30).

## 3. The famless shell

- **No tabbar while famless** (Q30). Today `fh-nofam` leaves two tabs
  (Tài chính + a Home whose only content is "create a family"). A one-tab
  bar is furniture; the bar is hidden entirely and Tài chính fills the
  viewport.
- **Family creation entries**: a "Gia đình" row in Settings (durable) and a
  quiet card low on the Tài chính screen (discoverable). Both open the
  existing `start` screen with a back arrow (`fhFamilyStart`).
- **Tài chính is always the landing — globally** (Q31a). Every user,
  famless or family, lands on Tài chính on every boot; Home is one tab
  away once a family exists. A per-origin landing rule was rejected as
  invisible complexity.

## 4. Connect: consent inside the flow

Consent content merges into step 1 of the connect sheet (Q28a): one
continuous read → agree → Google, no separate sheet popping between "I
decided to connect" and connecting. Same legal substance, same
`user_consents` versioning, recorded at the step-1 agree. The rule that any
change to what is sent to the model changes the consent text in the same
commit is untouched.

## 5. The review screen

The staged-email review surface is promoted from `#csv-import-modal` (a
sheet-layer modal outside the nav model) to a real screen (Q7): a `view`
section, pushed from Tài chính with a back arrow, the landing pad for the
state-2 CTA, the queue widget, and notification taps (Q14a). It is a
workflow surface, not a tab.

### 5a. The chart, completed

- The existing pannable strip (`csvSumHTML`) stays chi-only (Q23) and keeps
  its two-layer vocabulary (Q22) with one change of meaning: **solid = đã
  vào sổ (imported personal-ledger rows in the period), grey = chưa duyệt
  (staged rows)**. On first run everything is grey (pure preview); after
  the first import it firms up; on a return visit with five new rows the
  five sit grey on top of a solid month (Q13b) — the screen keeps telling
  the whole story, not a rump chart of orphans.
- **Thu and chi both appear as stat boxes** above the strip (Q23): tiền
  vào, tiền ra for the visible window, staged+imported, with the
  unconfirmed share named in a sub-line. The bars stay chi-only like every
  other strip in the app.
- Bar tap keeps its job: scroll to that day's rows.

### 5b. The category tree

A real expandable tree, **expanded by default** (Q20b): top-level
categories with their children visible, proportional amounts,
staged+imported merged with the unconfirmed share marked in the same
grey/solid language. Tapping a node filters the row list below — that
filter is the "zoom in" of this release (Q15a); period-compare machinery
stays on the dashboard.

### 5c. Reading mode (first light)

When a first read (or any backfill) is running, the screen opens in
reading mode: a progress header ("Đang đọc N ngày email… M khoản") that
re-polls, with the chart, tree and rows re-rendering live as rows stage.
The existing backfill-progress branch in `fhEmailTxnCta` is kept, not
retired (Q18 — "add, not retire"); the screen is where the connect flow
now lands.

### 5d. Sparse yield

No warning copy, no blame-the-bank message (Q27b). The chart shows
whatever exists; when the yield is low the screen offers the alternate
supply lines as cards: **statement-file import first** (the remedy — it
feeds the same review rows), manual entry second (Q27d).

### 5e. Import unchanged

Import stays the confirmation act (Q8a): everything arrives ticked, one
"Nhập N" makes it real, the chart is a door into the rows. Bulk category,
quick-select, duplicate tiers, deferred groups — all as they are.

## 6. The state-2 card is a door

With the preview living on the review screen, the Tài chính state-2 card
stops duplicating it (Q24): the deck stays as the visual, the copy becomes
"N khoản đang chờ · Xem bức tranh của bạn", and the whole card opens the
screen.

## 7. Quick review is not activation

The one-row sheet is untouched (Q21): it serves the returning-user moment
(one new row, three seconds, done). Notification taps land on the review
screen; quick review keeps its own auto-pop rules.

## 8. Push for personal-only users (the one server landing)

`fhPushEnable` refuses without a family ("Hãy mở một gia đình trước",
`55-push.js:70`) and `push_subscriptions` requires `family_id + member_id`
— so the entire target cohort has **no destination for the pipeline's
"something is waiting" push**. Q29a: fixed in this release as its own
declared landing — subscriptions become user-scoped (family optional),
`push-send` learns the personal destination, the offer copy stops assuming
a family. This is the only server touch; it follows the shared-singleton
rules (migration number claimed at apply time, `push-send` diffed against
`main` before deploy).

## 9. Deliberately deferred

Telemetry (`first_chart_seen`, Q19), retention mechanisms beyond the push
fix (Q12b), auto-confirm/auto-import of staged rows (wait for reader-v2
precision data, Q8), reader accuracy itself (rides the email-reading-v2
epic independently, Q9b), period-compare parity on the review screen
(Q15).

---

# Part 2 — Technical appendix

## 10. Where it lives

| File | What changes |
|---|---|
| `src/index.html` | `#csv-import-modal` content moves into a new `<section class="view" id="v-review">`; tabbar hidden under `.fh-nofam`; welcome copy; invite-skip link; family card on Tài chính |
| `src/js-ui/10-nav-model.js` | `go('review')` render hook; back handling; famless funnel updated (review allowed, family tabs still funnel) |
| `src/js-ui/56-csv-import-ui.js` | screen render (was modal), stat boxes, category tree (`csvCatTreeHTML`), merged staged+imported series in `csvSumBuckets`, sparse-state supply cards |
| `src/js-ui/57-csv-import-review.js` | node totals for the tree; category filter of the row list |
| `src/js-data/72-txn-review.js` | `fhTxnReviewSheet` opens the screen; reading-mode poll loop; connect flow lands here |
| `src/js-data/74-autotxn-ui.js` | consent merged into connect step 1; post-OAuth landing |
| `src/js-data/75-consent-ui.js` | consent content rendered inside step 1 (recording unchanged) |
| `src/js-ui/21-personal.js` | state-2 card copy/door; invite widget; family card section |
| `src/js-data/10-client-auth.js` | landing → `go('personal')` everywhere; invite-skip path |
| `src/js-data/65-passcode-ui.js` | "Để sau" on the start screen when reached with a pending invite |
| `src/js-ui/80-onboard-boot.js` | welcome copy; boot landing → personal; warm-boot landing |
| `src/js-data/55-push.js` | subscribe without a family; copy |
| `supabase/migrations/NNNN_personal_push.sql` | `push_subscriptions.family_id/member_id` nullable + user scope; RLS; claimed at apply |
| `supabase/functions/push-send/` | personal destination (owner_user_id) |
| `src/css/*` | `.view` styling for the review screen (replacing modal positioning); tree + stat boxes; famless tabbar |

## 11. Working rules

- Worktree `.worktrees/activation-journey`, branch `feat/activation-journey`.
- Territory entry in `AGENT_SYNC.md` before the first code edit — this work
  overlaps the email-reading-v2 claim on `72-txn-review.js`,
  `56-csv-import-ui.js`, `57-csv-import-review.js`, `76-quick-review.js`
  (read-only there), and says so.
- Migration number claimed when applied, never held.
- `push-send` diffed against `main` (`get_edge_function`) before deploy.
- SW `CACHE_NAME` read from `origin/main` immediately before the final
  build + push; no push until the VPN window opens.

## 12. Decision log

Grilling session, 2026-09-23/24.

| # | Decision |
|---|---|
| Q1 | Activation = first populated cash-flow chart + accurate categories; prerequisite email connected + ≥20 rows read accurately; success = 3–5 return days in week 1, sustained 4 weeks. |
| Q2 | Solo user is the primary journey; family optional. |
| Q3 | (b) Provisional chart from unreviewed rows; the category tree renders too. |
| Q4 | All surfaces in scope. |
| Q5 | No silence, no pause until done. |
| Q6 | Telemetry minimal, `first_chart_seen` only — then Q19 deferred it entirely from release 1. |
| Q7 | (a) The preview lives in the review surface, which is promoted from modal to a real screen. |
| Q8 | (a) Import stays the confirmation act; unconfirmed rows visually distinct; chart is the door into review. |
| Q9 | (b) Ship on today's reader quality; accuracy rides the v2 epic. |
| Q10 | (b) Connect stays on the tab; welcome sells it; state 1 unmissable; no auto-pop. |
| Q11 | Both: live build AND a progress indicator. |
| Q12 | (b) Retention mechanisms out of scope (except the push defect, Q29). |
| Q13 | (b) Chart counts staged + imported together, unconfirmed marked. |
| Q14 | (a) Pushed sub-screen of Tài chính; notification landing pad. |
| Q15 | (a) Look + category-tap filters rows; no period machinery. |
| Q16 | Invite screen gets a solo skip. |
| Q17 | Welcome keeps truly-private/effortless, repositioned from family ledger to full finance picture. |
| Q18 | Reading mode is added; the existing progress branch is not retired. |
| Q19 | Telemetry deferred entirely. |
| Q20 | (b) Real expandable category tree, expanded by default. |
| Q21 | Quick review untouched; serves returns, not activation. |
| Q22 | Grey/solid two-layer chart language kept as is. |
| Q23 | Chart stays chi-only; thu and chi appear in stat boxes. |
| Q24 | State-2 card is purely a door to the screen. |
| Q25→Q27 | Sparse yield: (b)+(d) — no warning copy; offer statement import first, manual second. |
| Q26 | Client-only big bang + declared server landing for push; own worktree; AGENT_SYNC territory. |
| Q28 | (a) Consent merges into connect step 1. |
| Q29 | (a) Personal push fixed in this release as its own landing. |
| Q30 | Famless: no tabbar; family entry in Settings + quiet card on Tài chính; invite as tracker-style widget on Tài chính. |
| Q31 | (a) Tài chính is the landing globally, for every user. |

## 13. Related

- `docs/specs/personal-activation-spec.md` — the four tab states.
- `docs/specs/transaction-review-spec.md` — the review engine.
- `docs/features/direct-mailbox-read.md`, `docs/specs/email-reading-v2-spec.md` — the pipeline.
- `docs/specs/statement-capture-spec.md` — the alternate supply line.
- `docs/features/onboarding-and-boot.md`, `docs/features/key-card-auth.md` — onboarding.
- `docs/features/web-push.md` — push.
