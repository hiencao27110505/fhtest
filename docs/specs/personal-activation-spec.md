# Personal tab activation — the first-run states of "Tài Chính"

The epic that makes the personal ledger's tab worth opening before it has
data. A new user used to land on a dashboard rendered with nothing: three 0 ₫
figures, a blank chart, a sync note that never cleared, and six empty sections
each with its own call to action. Now the tab reads what it has and shows one
of four states, each with one job.

> **Status, 2026-09-15.** Designed through eight rounds of mockups
> (`mockups/personal-activation.html`, the "Phương án chốt" row) and BUILT the
> same day, big bang, in the client only. No migration. SW **v525**. Every
> input is data the app already holds; the only stored flag is the widget's
> "Ẩn".

> **How this relates to its siblings.** `personal-ledger-spec.md` is the tab
> this changes. `account-setup-spec.md` (0134) owns the wizard that step 2
> opens. `transaction-review-spec.md` owns the queue that state 2 previews.
> `habit-streak-spec.md` and `investment-spec.md` own the sections whose empty
> states state 3 rewrites.

---

# Part 1 — Behaviour

## 1. Summary

- **Four states, one job each.** Nothing yet → one start card. Mail connected
  and rows waiting → the same card, with the newest row on top of a small deck.
  Rows in the ledger but setup unfinished → a three-step widget above the real
  dashboard, and feature sections whose empty states name something from the
  person's own rows. Everything set → the dashboard as before, no widget.
- **No number that is not real.** States 1 and 2 show no 0 ₫, no chart, no
  section that is empty. The sections come back only when they have data or a
  concrete thing to say.
- **One primary action per screen.** Connect email in state 1, review the queue
  in state 2, the current step in state 3.
- **The card in state 2 is read-only.** Two lines (merchant with its category
  mark, amount; time and account), nothing to change on it. Tapping anywhere on
  it opens the review queue. Categorising and logging stay on the review screen.

## 2. The states

| State | When | What the tab shows |
|---|---|---|
| 1 · Chưa thiết lập | No rows in the ledger, no queue, no mailbox connected | Start card: "Bắt đầu sổ của bạn", CTA "Kết nối email ngân hàng", link "Hoặc ghi tay một khoản". Then "Sau đó bạn sẽ thấy": four quiet rows naming the dimensions the tab will grow. |
| 2 · Đã nối email | No rows in the ledger, but a mailbox is connected or the queue is non-empty | The same card with the queue on it: "N khoản đang chờ bạn duyệt", the newest staged row as the top card of a deck (two blank cards behind), "1 / N · mới nhất trước · Chạm thẻ để mở hàng chờ", CTA "Duyệt N khoản". Two sub-states cover a first read still running (a progress bar) and a dead grant ("Kết nối email cần làm mới"); a connected mailbox with an empty queue offers manual entry first. |
| 3 · Đã có giao dịch | Rows exist, at least one setup step open | The widget "Thiết lập · k / 3" listing only the remaining steps, then the real cash-flow card, then the sections. Streaks and investment, when empty, name a concrete trigger from this month's private rows. |
| 4 · Kích hoạt đủ | All three steps done, or the widget hidden | The dashboard exactly as before this spec. |

## 3. The three steps

1. **Có khoản đầu tiên.** Done as soon as the ledger has any row (the state 3
   precondition), so it always shows as done.
2. **Cài đặt tài khoản, thẻ.** Done when every non-investment account is
   anchored or was skipped in the setup wizard. Its subtitle names up to three
   accounts still waiting. Tapping opens the account-setup wizard for exactly
   those accounts; with no accounts at all it opens the email door, because
   accounts materialize from mail.
3. **Lập ngân sách tháng.** Done when a personal budget exists for the month.
   Tapping opens the budget sheet in personal scope.

"Ẩn" hides the widget for good on this device. The widget also disappears on
its own at 3 / 3.

## 4. Data-driven empty states (state 3)

- **Chuỗi thói quen**, no streak yet: the month's private expense rows are
  grouped by the first word of their note; if the top group has at least three
  rows, the card reads "Grab 9 lần tháng này, 1.480.000 ₫ · Thử 7 ngày không
  Grab?" with one chip that opens the streak picker. Otherwise the section's
  own empty card stands.
- **Đầu tư**, no position yet: rows whose note matches an exchange, gold shop or
  brokerage keyword are counted; if any, the card reads "N khoản có thể là đầu
  tư tháng này" with the sum that would leave spending, and two chips: open the
  first such row, add a position. Otherwise the section's own empty card.
- **Nợ & cho vay** keeps its existing behaviour: the un-anchored account tiles
  from 0134 are already the trigger.

## 5. The sync note

"Đang đồng bộ các khoản bạn đã ghi cho gia đình…" now clears when there is
nothing to sync: at once when the account has no family (nothing authored
there can exist), and after the mirror's five retries when the family key
never warms up. Before, both cases left the note on the card forever.

## 6. Copy

Vietnamese only, like the rest of the tab. No dashes, no arrows, no slogan
lines. The privacy line that used to sit under the start card is gone; the
"Riêng tư" card and the per-row labels carry that promise once rows exist.

---

# Part 2 — Technical appendix

## 7. Where it lives

| File | What |
|---|---|
| `src/js-ui/21-personal.js` | `persActivation` (state), `persActCard` (states 1–2), `persWillSeeHTML`, `persSetupSteps` / `persSetupWidgetHTML` / `persStepTap` / `persSetupHide` (state 3 widget), `persStreakDriven` / `persInvestDriven` (data-driven empties), `_persCommit` (shared paint). `renderPersonal` branches right after the stats slice is resolved. |
| `src/js-data/76-quick-review.js` | `fhStagedPeek(forCount)` / `fhStagedPeekCached()`: the newest pending personal staged row, fetched and unsealed with the same helpers as the quick sheet, cached a minute and keyed on the badge count. Never throws; a locked ledger or an unopenable row returns the count alone. |
| `src/js-data/27-streaks.js` | `fhStreakDefsCount()`: null until loaded, else the count. |
| `src/js-data/19-personal.js` | The mirror flips `mirrorRan` when there is nothing to mirror (§5). |
| `src/css/40-spending-tabs.css` | `.pact-*` (cards, chips), `.pq-*` (deck), `.psu-*` (widget). Tokens only. |
| `tools/personal-activation.test.js` | Source-shape guard. |

## 8. State derivation

```
hasTx  = P.txns.length || P.debts.length || P.unreadable || statsSlice.rows.length || P.txnsOld.length
queue  = fhStagedCount
mailOn = forwarding alias OR oauth grant   (probed once a minute, cached)
state  = !hasTx ? ((queue || mailOn) ? 2 : 1)
       : (every step done || hidden) ? 4 : 3
```

In states 1 and 2 the tab also kicks the full-history stats slice once, so a
person whose only rows are older than the two-month cache still lands in
state 3 as soon as it returns.

## 9. Failure modes

| Scenario | Behaviour |
|---|---|
| Mailbox probe fails or is slow | State 1 until it answers; a later answer re-renders. Never blocks. |
| Personal ledger locked while a queue exists | The peek returns the count only; the deck shows a blank top card, the CTA still opens the queue (which handles the lock). |
| Staged row cannot be opened (key mismatch) | Same blank top card; nothing wrong is shown. |
| Badge count changes after a promote | The peek is keyed on the count and re-fetches; a stale card cannot survive a promote. |
| Person hides the widget | Stored per user on the device; the sections still render their own empties. |
| Streak or investment engine not loaded yet | The driven empty falls back to the section's own markup. |

## 10. Decision log

From the mockup rounds, 2026-09-15.

| # | Decision |
|---|---|
| P1 | State 1 is option 01 of the eight: one card, one CTA, a "sau đó bạn sẽ thấy" list. |
| P2 | State 2 keeps that card and puts the queue inside it as a deck (option B1), with the two-line read-only card E7 on top. No separate "mới nhất" section. |
| P3 | State 3 is option 02's three-step widget, remaining steps only, above the real dashboard; each empty section names a trigger from real rows. |
| P4 | State 4 has no widget; a "3 / 3 done" card was tried and dropped. |
| P5 | Step 2 is named "Cài đặt tài khoản, thẻ", not "Chốt số dư". |
| P6 | The privacy footer is dropped from the guidance cards. |
| P7 | Nothing on the state 2 card is actionable except opening the queue. |

## 11. Related

- `docs/specs/personal-ledger-spec.md`, `docs/features/personal-ledger.md`
- `docs/specs/account-setup-spec.md` (the wizard step 2 opens)
- `docs/specs/transaction-review-spec.md` (the queue state 2 previews)
- `mockups/personal-activation.html` (all rounds, chosen row first)
