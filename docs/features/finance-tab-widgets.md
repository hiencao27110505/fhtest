# Finance tab — widget inventory

The Finance tab ("Tài Chính") is the view `#v-spending` in [src/index.html](../../src/index.html)
(the codebase still refers to it internally as `spending`). It is one flat vertical scroll.
The old overview / breakdown / activity segments are now just `segTo()` scroll anchors
([src/js-ui/10-nav-model.js](../../src/js-ui/10-nav-model.js)): `overview → top`,
`breakdown → #cat-budget-rows`, `activity → #tx-rows`.

Most render logic lives in [src/js-ui/20-budget.js](../../src/js-ui/20-budget.js); goals, trend,
requests, and transaction rows live in sibling files noted per widget. Styling is mainly in
[src/css/40-spending-tabs.css](../../src/css/40-spending-tabs.css) and
[src/css/30-budget-calendar.css](../../src/css/30-budget-calendar.css).

## Widgets in scroll order (top → bottom)

| # | Widget (VN / EN) | What it shows / does | Key components | Anchor · Renderer |
|---|---|---|---|---|
| 1 | **Header — Tài Chính** | Sticky child-header: title, subtitle, active-month picker | `.ch-title` + `.ch-sub`; month pill `#sp-month` → opens `sheet-month` (month list) | `.child-hdr` · static + `buildMonthChoices()` / `selectMonth()` |
| 2 | **Thiết lập ngân sách (first-run setup)** | Empty-state nudge shown only when no monthly budget exists yet | `.fin-setup-card` button (icon `.fsc-ic`, title `.fsc-t`, subtitle `.fsc-s`, chevron) → `sheet-budget` | `#fin-setup` · `renderBudget()` |
| 3 | **Widget A — Dòng tiền (Cash flow)** | Focal card: "Còn lại tháng này" (income − spent) + in/out + week-over-week + CTA nav rows | Big number `#cf-left` (`.neg` when negative); In tile `#cf-in`→`fhIncome()`; Out tile `#cf-out`→`segTo('activity')`; week bar-chart `#cf-wow`; status note `#cf-note` (`ok`/`over`/`flat`, ▲/▼); CTA rows: **Set up budget**→`sheet-budget`, **View expenses**→`openTxns()`, **Expense proposals** (badged, pending>0) `#cf-req-cta`→`openRequests()`, bank-email review `#cf-email-cta`→`fhEmailTxnCta()` | `.cf-card` · `renderCashflow()` / `renderRequestsCta()` / `renderCashflowEmailCta()` |
| 4 | **Widget B — Tích lũy (Savings)** | Savings-pot total, goal list, saving momentum | Header + add-goal `＋`→`openGoal()`; total btn `#til-total`→`fhSavings()` + label `#sav-lab` (To go / Due soon / Done); goal rows `#goals-list` (emoji, name, `saved/target`, overdue tag, meter) → `openGoalDetail()`; completed collapse into `.goal-done-row`; momentum spark `#til-spark` (only when saved>0); empty-state `#goals-empty` / "Create your first goal" CTA | `#goal-card` · `renderGoals()` ([35-goals.js](../../src/js-ui/35-goals.js)) |
| 5 | **Giao dịch gần đây (Recent transactions)** | The month's expense/activity feed, filterable. Header flips to "Activity" when future items exist | Section header `#tx-head` + **See all**→`openTxns()`; hidden photo input `#pa-file`→`paIngest()`; filter chip `#act-filter` (✕ `clearFilter()`); rows `#tx-rows` — `txRow` (realized) → `openExpenseDetail`, `resRow` (event set-aside) → `openEvent`, `futRow` (future expense) → `openExpenseDetail`; three empty states | `#tx-rows` · `renderTxns()` ([60-transactions.js](../../src/js-ui/60-transactions.js)) |
| 6 | **Phòng khách (Family activity)** | Collaborative reactions/comments feed; hidden until reactions exist | Count badge `#rx-wall-count`; wall `#rx-wall` | `#rx-wall-sec` · `renderRxWall()` ([62-reactions.js](../../src/js-ui/62-reactions.js)) |
| 7 | **Xu hướng 6 tháng (6-month trend)** | Spending-vs-budget trend chart; hidden until there is real history | Chart `#trend-chart` (`.tr-col` w/ value, bar `over`/`cur`, dashed budget line; tap → `selectMonth`); month labels `#trend-labels`; dashed-budget legend | `#trend-sec` · `renderTrend()` ([10-nav-model.js](../../src/js-ui/10-nav-model.js)) |
| 8 | **Suggest footer** | "Ideas or gripes?" feedback CTA | 💛 button → `sheet-suggest` | `.suggest-foot` · static |

## Off-canvas elements reached from this tab

| Element | Role | Anchor · Renderer |
|---|---|---|
| **Global add FAB** | Primary "Log an expense" entry (`openExpense()`) via `sheet-add` | `.fab` (shell) |
| **Đề xuất chi tiêu (proposals hub)** | Full incoming/mine request lanes, opened by Widget A's badged CTA | `#requests-overlay` · `openRequests()` / `renderRequests()` ([64-requests.js](../../src/js-ui/64-requests.js)) |
| **Chi tiêu theo danh mục (category breakdown)** | Category spend vs budget — moved out of the flat scroll into the transactions overlay | `#fh-legend` · `renderFinanceHero()` + `#cat-budget-rows` · `renderCatBudget()` |
| **Spend-by-member** | Stacked bar + legend by payer → `openCat('mem',…)` | `#member-split` · `renderMembers()` (legacy/overlay mount) |
| **Category / member detail** | Drill-in detail screen | `#cat-overlay` · `openCat()` |
| **Budget setup sheet** | Monthly total, category rows, auto-split, over-budget note, locked "Others" row | `#sheet-budget` · `fillBudgetSheet` / `setBudget` / `addCatRow` |

## Notes

- **2026-08-22** — the standalone "Waiting for the family" pending-proposals widget (`#fin-requests`)
  was removed from the Finance tab. Its function is now a **badged CTA row inside Widget A**
  ("Expense proposals" · `#cf-req-cta`, count = `reqPendingAll().length`, hidden when zero) that
  opens the same `#requests-overlay`. The full inline widget still appears on the **Home** tab
  via `requestsWidgetHTML()`.
- `renderBudget()` still writes to a batch of **dead** legacy DOM ids from the old ring-based hero
  (`b-safe`, `bfill`, `bmark`, `bres`, `hero-month`, `snap-in/out/pool`, `sav-hero`, …) that no
  longer exist in `#v-spending`; they no-op safely but are prune candidates.
