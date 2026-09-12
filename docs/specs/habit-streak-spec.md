# Habit Streaks — "Chuỗi thói quen"

User-defined **no-spend streaks**: "7 ngày không Grab", "không ăn ngoài",
counted from the ledger itself. A streak is a claim about days on which a
matching expense did **not** happen — the ledger (plus the bank-email review
queue) is the referee, a stamp card is the face, and a 6AM push delivers
yesterday's verdict.

> **Status, 2026-09-12 (evening).** BUILT — all four phases, in one pass,
> uncommitted. Migrations `0132_habit_streaks` (tables) and
> `0133_streak_digest_schedule` (targets RPC + 6AM cron) are applied to the
> live project; the `streak-digest` Edge Function is deployed (v1, secret in
> vault + push_config); engine + UI live in `src/js-data/27-streaks.js`
> (+ `src/css/43-streaks.css`, sheets in `src/index.html`, hooks in
> `21-personal.js` / `20-budget.js` / `72-txn-review.js`); the SW composes
> the 6AM verdict from the `fh-streaks` IDB snapshot (sw.js, v504).
> Deviations from the plan below: migration numbers are 0132/0133 (0131 was
> taken by a parallel session); transport A (.gs) still stages no category
> hint (B already did — §10.2 turned out half-done already); the 6AM push
> reaches only users holding a member seat with a push subscription
> (personal-only users have no subscription row to ring). UI direction:
> **mockup #6 — stamp card**; push copy: `docs/streak-copy-matrix.html`.

> **Audience & layering.** Part 1 (Behaviour) is for everyone. Part 2
> (Technical Appendix) is for engineers. Part 3 is the phased build plan —
> each phase is independently shippable.

---

# Part 1 — Behaviour

## 1. Summary

- A user creates up to **3 active streaks per ledger context** (3 personal,
  3 per family), each targeting **one merchant OR one category** — never a
  composed rule in v1.
- The streak counts **consecutive calendar days with zero matching expense**.
  It is open-ended: milestones at 7 / 14 / 30 / 100 days, a personal best
  ("kỷ lục"), and a money-kept estimate ("~840k ở lại ví").
- It breaks by **transaction date, always** — a Grab ride imported Thursday
  but dated Tuesday retro-breaks the streak on Tuesday, and the UI says so
  plainly. On break the streak **auto-restarts** the next day. No freezes,
  no free passes: in a money ledger a "forgiveness token" for a real
  transaction is a lie about spending.
- **The review queue counts.** A staged bank-email row (sealed, unreviewed)
  breaks a matching streak the moment it is staged. If the row is later
  removed at review as a duplicate/mistake, the streak silently heals —
  possible because counts are always **derived, never stored**.
- Both ledgers, big-bang: **personal streaks** (private, family can never
  see them) and **family streaks** (a shared, social streak the whole family
  keeps together).
- Every morning at **6:00**, one push delivers yesterday's verdict —
  celebrate or criticize — composed **on the device** (the server cannot
  read streaks, by construction).

## 2. Why this exists

Three jobs at once, decided explicitly:

1. **Self-discipline tooling** — avoidance habits ("bớt Grab", "bớt trà
   sữa") are the money habits budgets don't model: budgets cap, streaks
   abstain.
2. **Retention** — a reason to open the app daily that isn't bookkeeping.
3. **A savings feature in disguise** — the payoff display is *money that
   stayed in the wallet*, not badges. FamilyHub's tone stays plain and
   finance-first; the stamp card gives Duolingo-grade satisfaction without a
   flame in sight.

The feature exists *because* effortless capture exists: with bank emails
flowing in, the ledger is complete enough for "no matching transaction" to
mean something.

## 3. Creating a streak — the consolidated picker

One creation sheet, no "merchant mode vs category mode" fork visible:

- A single searchable list mixing, with type labels on each row:
  - **Mined merchants** — names extracted from the user's own last ~90 days
    of rows (structured `counterparty_enc` where present, else normalized
    note text), so the keyword provably matches how *their* bank spells it
    ("GRAB", "GRAB* A2B", "GRABPAY" all fold to one row: "Grab · thương
    hiệu").
  - **Categories** — the ledger's category list ("Ăn ngoài · danh mục").
  - **A free-keyword row** at the bottom ("theo dõi từ khoá khác…") — the
    user who *just* quit Grab has no recent Grab rows to mine, and that user
    is the target user.
- Picking a row creates a one-rule streak: `{type: merchant|category, key,
  label, emoji, milestone}`. Milestone defaults to 7.
- Cap reached (3 active) → the add affordance explains, offers to archive an
  existing streak.

## 4. Counting rules — precisely

- **Day boundary:** local calendar days (UTC+7 semantics like the rest of
  the ledger — date keys built locally, never `toISOString()`).
- **A day is clean** for a streak when no expense row matching the rule
  carries that `txn_date` — across, for personal streaks: **private rows +
  the user's own mirror rows** (a Grab ride you filed to the family is
  still you taking Grab; counting only private rows creates an evasion
  loophole), expenses only, transfers/incomes/loans never match; for family
  streaks: **all realized family-ledger expenses by any member**. Private
  spending is invisible to a family streak *by design* — a spouse's private
  Grab ride cannot break it, structurally.
- **The queue counts.** Staged `email_transactions` rows (pending review)
  are opened client-side and matched:
  - **Merchant streaks** match on the sealed box's structured
    `counterparty` — exact enough to trust.
  - **Category streaks** match on the **category hint carried in the sealed
    box** (decided: staged rows carry category). A wrong hint can break a
    streak falsely; the fix is reviewing the row — after review the derived
    count heals automatically. This is accepted, stated behaviour.
  - Debit direction only; credits never match.
- **Matching** is the same normalizer everywhere (reuse the
  `csvPatternKey` approach: deburr → lowercase → strip bank noise/gateway
  prefixes → contains-match). Merchant rule: match against
  `counterparty_enc` when the row has one, else the decrypted note.
  Category rule: match against decrypted `cat_name_enc` (personal) /
  category (family).
- **Break day = the matching row's `txn_date`.** The streak restarts
  counting from the day after the break. A retroactive import that lands
  inside the current run rewrites the count — with the honest caption
  ("khoản Grab ngày thứ Ba vừa nhập — chuỗi đã đứt từ hôm đó").
- **Streaks start forward:** day 0 is the creation date; matching rows
  *older* than creation never affect it.
- **Record ("kỷ lục")** = longest run since creation. Cached (encrypted) so
  it survives beyond the decrypt window; conflicts resolve by `max`.
- **Money kept ("~{saved} ở lại ví")** = streak days × the user's average
  *daily* spend on the target over the 60 days before the streak started
  (min 3 matching txns, else the stat is hidden rather than guessed).
- **Unreadable rows** (`_DEC_FAILED`) cannot be matched. They never break a
  streak (fail-open would be lying about a break we can't prove), but while
  any unreadable row overlaps the current run, the card shows the standard
  "chưa đọc được" caveat — uncertainty surfaced, never silent.

## 5. The stamp card — chosen UI (mockup #6)

Per streak, one white card (`--r-card-lg`, card shadow) in a "Chuỗi thói
quen" section:

- **Header row:** emoji + streak label left; a status tag right —
  `tuần 2` (info tint) while running, `đứt hôm qua` (danger tint) after a
  break.
- **The stamps:** one row of **7 slots** for the current week of the run.
  Clean day → `✓` stamp (brand tint). Completed week → the row collapses to
  a leading `★` stamp (brand gradient) and a fresh row begins — "tuần đầu
  trọn vẹn ★". Break day → `×` slot (danger tint), and the card visually
  starts a new card-life the next day. Future days are empty dashed slots.
- **Footer line:** `12 ngày · tuần đầu trọn vẹn ★ · ~840k ở lại ví` — or,
  broken: `Khoản 185k hôm qua xé thẻ — thẻ mới đã bắt đầu.`
- **Tap → detail sheet:** full stamp history (weeks stacked), kỷ lục, total
  money kept, the breaking transaction (tap-through to the row), milestone
  editor, archive (arm-then-confirm, never a big red button).
- **Section placement:** Cá nhân tab, between the cash-flow card and "Các
  nhóm của tôi"; section header carries `＋ Thêm`. Family streaks render the
  same stamp card on the family Finance tab with two additions from mockup
  #8: the member **avatar row** (shared credit) and break copy that names
  the **transaction, never the person**.
- Milestone crossing / new record → in-app celebration moment (confetti on
  open, matching the copy matrix's "mở app nhận pháo giấy").
- Empty state: standard `.mem-empty` — emoji, one line, guide to create.

## 6. Family streaks — the social rules

- **Visibility:** every keyed member sees the family's streaks.
- **Governance:** any member creates; creator or admin deletes/archives.
- **Attribution:** when it breaks, the card and sheet show the breaking
  *transaction* (which already carries the member's name in the ledger —
  no new disclosure), but neither the card headline nor any push ever
  editorializes the person ("Bố phá chuỗi" is banned copy). The ledger
  knows; the banner doesn't point.
- **Push:** all keyed members receive the family digest lines (§7), same
  no-names rule.

## 7. The 6AM verdict push

- **Cadence:** daily at 06:00 ICT, judging **yesterday** — a full day,
  decided at midnight, no intra-day flip-flopping.
- **Server side is a doorbell only.** pg_cron → push-send Edge Function →
  a content-free payload (`{type:'streak_digest'}`) to users owning ≥1
  active streak. The server cannot compose the text: streak rules and
  states are ciphertext to it, and pushes carry no amounts/merchants by
  standing rule.
- **Device side composes.** The service worker holds the cached personal
  DEK (`fh-keys` IDB) and the last derived state; on push it re-derives
  fresh (targeted read + staged-row peek) and picks copy from the matrix.
  Anything unavailable — locked ledger, cold cache — degrades to the
  generic fallback lines (§F of the matrix). Never guess, never show money
  on a locked lock screen.
- **One digest line per morning**, never two streak pushes. Priority when
  multiple events compete: **đứt hôm qua → kỷ lục mới → chạm mốc → ngày
  sạch thường** (always send — quiet-day copy is deliberately short).
  Remaining streaks fold into the tail ("· 2 chuỗi khác vẫn sống").
- **Copy:** `docs/streak-copy-matrix.html` — 4 rotating variants per cell,
  no repeat two days running; tone celebratory/lightly-judging per the
  existing notification voice.

## 8. Privacy and safety rules

- **Personal streak rules are ciphertext** under the personal DEK; family
  streak rules under the family key. The operator can see *that* a user has
  N streak rows (metadata, needed to ring the doorbell), never what they
  target.
- **The family cannot see personal streaks** — same tables-and-key
  separation as the rest of the personal ledger.
- **Counts are derived, never stored.** The only persisted state is the
  rule, the creation date, and the (encrypted, max-resolving) record cache.
  A retroactive import, a healed duplicate, a re-reviewed category — the
  next derivation is simply right. No reconciliation, no drift.
- **Pushes carry nothing**, and a locked device composes only the generic
  fallback.
- **Nothing is auto-created** and archiving is arm-then-confirm.
- **Queue caveat:** while unreviewed staged rows overlap the window, the
  6AM copy may nudge review (§F) — the incentive deliberately points
  *toward* reviewing, never away.

---

# Part 2 — Technical Appendix

## 9. Schema (one migration; next free number at time of writing: 0124)

### `personal_streaks`

| Column | Notes |
|---|---|
| `id` PK | |
| `owner_user_id` → `auth.users`, cascade | RLS anchor, all verbs `= auth.uid()` |
| `rule_enc` | ciphertext JSON `{type:'merchant'\|'category', key, label, emoji, milestone}` under personal DEK |
| `started_on` date | plaintext (windowing key — same exposure class as `txn_date`) |
| `record_enc` | encrypted int cache of best run; client writes `max(old,new)` |
| `archived_at` | soft archive; active = null. Cap 3 enforced client-side |
| `created_at`, `updated_at` | |

Ciphertext-only value columns, no lifecycle — same construction as every
Model-Y table.

### `family_streaks`

Same shape, `family_id`-scoped, value columns via the family `fhField`
convention (respects the family's `enc_state`); RLS = family membership,
`created_by` recorded for governance (delete = creator or admin,
client-enforced like other family affordances).

**No changes to `transactions` or `personal_transactions` schemas.**
`personal_transactions.counterparty_enc` already exists.

## 10. Plumbing prerequisites (Phase 1)

1. **Write `counterparty_enc` on personal expense promote.** In the promote
   path (`72-txn-review.js` → `fhPersonalAddMany` /
   `fhPersonalAddExpense`, `19-personal.js`), carry the staged row's
   structured counterparty into `counterparty_enc` for ordinary expenses
   (today only loan/repayment `who` writes it). Note composition is
   unchanged — the note keeps reading as it does now.
2. **Category hint in the sealed box.** Both live transports already
   compute a category suggestion for the review screen; ensure it travels
   *inside* the sealed payload as a first-class field (`category_hint`) so
   the streak matcher can read it from an unreviewed row. Transports A and
   B change in the same release; absent hint = row simply can't match a
   category streak (never a guess from the client).
3. **Historic rows** have neither structured counterparty nor hints —
   matcher falls back to normalized note text. Stated, accepted.

## 11. Derivation engine — `fhStreakCompute`

Pure function, one module (`src/js-data/27-streaks.js`):

```
inputs:  active rules (decrypted), expense rows since min(started_on)
         (targeted read, fhPersonalMatchSlice-style — up to 365d),
         opened staged rows ({counterparty, category_hint, direction,
         occurred_at}), today (local)
output:  per streak — current run, week-rows for stamps, break info
         (date, amount, txn ref), record, money-kept, uncertainty flags
         (unreadable-overlap, pending-queue count)
```

- Runs after personal/family hydrate, after promote/retire, on tab open;
  debounced like the mirror engine. Result cached in the warm snapshot for
  instant paint; the snapshot is display cache only, never truth.
- Family variant reads family rows via `fhRead` (works in any `enc_state`).
- The staged-row peek reuses the review screen's sealed-box opening
  (`fhPersonalStagingPrivKey` / family staging key) — read-only, no
  review-state side effects.

## 12. Push pipeline

- **Migration:** pg_cron job at `23:00 UTC` (06:00 ICT) calling the
  existing push-send Edge Function with `{type:'streak_digest'}` for
  distinct users owning an active streak row (personal) or membership in a
  family with one (family). Reuses `push_subscriptions` / VAPID config
  as-is.
- **SW (`sw.js`):** new push branch for `streak_digest`: read cached DEK +
  defs from `fh-keys` IDB → targeted fetch (rows since earliest
  `started_on`, staged rows) → `fhStreakCompute` (module shared with the
  app via the build) → pick copy (rotation seed in IDB, no repeat 2 days)
  → `showNotification`. Any failure at any step → generic fallback line.
  Tap routes to the Cá nhân tab (or family Finance tab for a
  family-headline digest).
- Copy strings ship in the bundle (VN primary), sourced from
  `docs/streak-copy-matrix.html`.

## 13. Module map (planned)

| File | Owns |
|---|---|
| `supabase/migrations/0124_habit_streaks` | Both tables + RLS + pg_cron 6AM job |
| `src/js-data/27-streaks.js` | Rules CRUD (enc), miner (merchant list), matcher/normalizer, `fhStreakCompute`, staged peek |
| `src/js-ui/28-streaks-ui.js` | Stamp cards + section, creation picker sheet, detail sheet, celebration |
| `src/js-data/72-txn-review.js` | Phase-1 plumbing: counterparty into promote spec |
| `src/js-data/19-personal.js` | `counterparty_enc` on expense writes; hydrate hook |
| `pipeline/bank-email-pipeline.gs` + `_shared/mailbox/stage.mjs` | `category_hint` into the sealed payload (same release) |
| `sw.js` | `streak_digest` branch + compute + copy rotation (CACHE bump) |
| `src/css/…` | `.stk-` prefixed styles (stamps, tags, card) |

Remember: edit `src/`, run `node build.js`, bump the SW version.

## 14. Failure modes

| Scenario | Behaviour |
|---|---|
| Retroactive import lands inside the run | Next derivation retro-breaks at `txn_date`; card captions the rewrite honestly |
| Staged row breaks a streak, then removed at review | Derivation heals — count restores, no state to unwind |
| Wrong category hint breaks a category streak | Stated behaviour; heals when review assigns the real category |
| Rows unreadable in window | Never counted as a break; caveat shown while overlap exists |
| SW can't decrypt at 6AM (locked, cold) | Generic fallback push, never a guess — see matrix §F |
| Ledger read fails during derivation | Keep last painted state, show retry — never render "streak broken" from an error |
| Two devices update `record_enc` | `max()` merge — the cache can only grow |
| Cap circumvention (4th streak) | Client refuses with archive offer; server cap not enforced in v1 |
| User deletes the matching txn | Next derivation un-breaks — the ledger is the referee, both directions |

## 15. Explicitly out of scope (v1)

- Composed rules (merchant AND category), amount thresholds.
- Forgiveness mechanics of any kind.
- Server-side streak computation (structurally impossible under E2EE).
- Adding a counterparty column to family `transactions`.
- Per-merchant intelligence features (monthly merchant totals,
  recurring-charge detection, price-creep alerts) — **parked as the
  "merchant intelligence" epic**, unlocked by the same Phase-1 plumbing.

---

# Part 3 — Build plan (each phase shippable)

| Phase | Contents | Ships value |
|---|---|---|
| **1 — Plumbing** | `counterparty_enc` on expense promote; `category_hint` in sealed payload (A+B); migration 0124 (tables only) | Structured merchant data starts accumulating immediately — the longer it runs, the better every later phase |
| **2 — Personal streaks** | Miner + picker sheet, matcher, `fhStreakCompute`, stamp cards on Cá nhân tab, detail sheet, celebrations | The core feature, personal-only |
| **3 — Family streaks** | `family_streaks` UI on family Finance tab (stamp card + avatar row), governance, gentle-attribution copy | The social layer |
| **4 — 6AM push** | pg_cron job, SW compose branch, copy rotation, fallbacks | The daily habit loop closes |

Design references: `mockups/streak-options.html` (#6 primary, #8's avatar
row grafted for family), `docs/streak-copy-matrix.html` (all push copy).
