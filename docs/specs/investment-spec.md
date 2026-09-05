# Investment — the "Đầu tư" bento

The epic that gives the personal ledger an **asset side**. Today the ledger
knows flows (income/expense), internal moves (transfer pairs), and what you
owe (counterparty balances). It cannot answer *"how much have I put into
crypto, and am I up or down?"* — and worse, the bank transfer that funds an
OTC crypto buy is captured as a bogus **expense**, polluting the month. This
epic models one new primitive — **a position** — and one new row meaning —
`kind='investment'` — so that money moved into an asset is neither spending
nor invisible: it is tracked, valued, and shown in its own bento.

> **Status, 2026-09-06.** Spec agreed after design interview (decision log
> §16); build is **big bang** (one release, migration **0123** — locked
> decision I11; 0122 was claimed mid-build by the sibling lending-capture
> epic). Migration 0123 is applied live; the client build is in progress —
> the standalone module (`24-investment-ui.js`, `42-investment.css`) is
> written, the shared-file integrations (review doors, stats lines, regen
> sweep, bento mount) land alongside the lending-capture epic's release.

> **How this relates to its siblings.** `borrowing-lending-spec.md` built the
> counterparty-balance bento ("Nợ & cho vay") and the one-leg draw-down
> pattern (card payments); this spec reuses that exact pattern for positions
> — a position is to a buy what a card is to a payment, an account whose
> balance is **derived** from the rows that touch it. `full-ledger-spec.md`
> built transfer pairs, anchored balances and the review Kind controls this
> spec extends; its T11/T12 discipline ("one kind = one meaning"; cards stay
> out of the transfer picker) is inherited: positions stay out of the
> transfer picker too. `personal-ledger-spec.md` (Model Y) is still the
> storage philosophy: investments are **personal, always** — encrypted under
> the personal key, `space_id = NULL`, invisible to every family. Read those
> three first.

---

# Part 1 — Behaviour

## 1. Summary

- **The original itch.** The user invests in cryptocurrency. Buying is a bank
  transfer to an OTC seller — a third party — so capture logs it as an
  expense and the month's stats miscount real investing as consumption. It is
  not consumption: the money changed *shape* (cash → asset), not owner-value.
- **A buy is one leg, not a pair.** A transfer pair is for moves between your
  own cash-like accounts. A position is not cash: it must not appear in the
  transfer picker, must not drift-detect against bank emails, and its value
  is not its cost. So a buy is a single `kind='investment'` row — it debits
  the funding account and *accrues to* a position, exactly like a card
  payment draws down a card (locked decision I1). The OTC seller is a memo,
  never a tracked counterparty.
- **A position is an account** — `personal_accounts.kind='investment'` — with
  an asset identity (symbol + unit, encrypted) and a **derived** VND balance:
  Σ buys − Σ sells, the *net-invested* number (I7). It can go negative:
  "đã rút hơn vốn" is house money, not an error.
- **Ambition: portfolio value, not just cost.** Rows optionally carry an
  encrypted **quantity** (0.0025 BTC · 2 chỉ vàng · 100 CP); the position
  knows its holding; a **client-side price** (public API where one exists,
  manual entry always) turns holding into "giá trị hiện tại" and lãi/lỗ
  (I2, I4). A position with no quantity or no price degrades gracefully to
  its cost basis — labelled, never guessed.
- **Stats see the money leave, not as spending.** A buy is excluded from
  expense totals and category breakdowns but surfaces as its own line —
  "Đầu tư tháng này" — so the daily guide knows the cash is gone (I6). Sells
  mirror it: "Rút đầu tư", visible but never thu nhập (I8).
- **Captured, not typed.** The review screen's debit Kind control gains
  **Đầu tư** (with a position picker); the credit control gains a fourth
  answer, **Bán đầu tư**. A seller you once classified as Đầu tư → BTC
  pre-selects that classification on every future capture — remembered
  encrypted, personal-side, always overridable (I9).
- **The past is repairable.** The personal edit sheet gains a one-way
  expense → investment conversion on private rows, so the months of
  miscounted OTC transfers can be healed row by row (I10).

## 2. What is a position — and what is not

| In the bento (a position) | Not a position, and why |
|---|---|
| Crypto (BTC, ETH, VNDC…) | **Sổ tiết kiệm** — cash-like, no price, no quantity; it is a `deposit` account with an anchored balance, already supported (I5) |
| Vàng (SJC, nhẫn — chỉ/lượng) | **Cho vay** — a receivable against a person; that is the borrowing ledger's job |
| Chứng khoán (cổ phiếu) | **Card/e-wallet balances** — instruments, not assets |
| Chứng chỉ quỹ (CCQ) | |

One general primitive, seeded for crypto but multi-asset from birth (I3):
the position's name and symbol carry the specifics; nothing in the schema is
crypto-shaped. Each position belongs to an **asset class**
(`crypto · gold · stock · fund · other`) — it drives the unit label, the
price-fetch route, and the bento grouping, nothing else.

## 3. The one-leg model — walk-throughs

### 3.1 Buying: the OTC transfer (the original itch)

You transfer 20.000.000đ from VIB to an OTC seller; they credit you
0.0025 BTC off-app. The VIB debit alert is captured. At review the card is
classified **Đầu tư** → position "Bitcoin" (created on the spot the first
time), quantity 0.0025 typed in (optional — the email never knows it). One
row commits:

| account_id | kind | amount | position_account_id | quantity |
|---|---|---|---|---|
| VIB | investment | −20.000.000 | Bitcoin | 0.0025 |

- VIB's anchored balance falls by 20tr — correct, the cash is gone.
- Bitcoin's net-invested rises to 20tr; holding rises to 0.0025 BTC.
- Monthly expenses: **untouched.** "Đầu tư tháng này: 20tr" appears instead.
- The seller's name stays in the note — a memo, not a counterparty (I1).

### 3.2 Selling

You sell 0.001 BTC; 25.000.000đ lands in VCB. The credit alert is captured;
at review the fourth answer **Bán đầu tư** → Bitcoin, quantity 0.001. One
row: VCB +25tr, `kind='investment'`, position Bitcoin, quantity −0.001.

- VCB balance +25tr; Bitcoin net-invested falls to −5tr → the position shows
  "đã rút hơn vốn 5tr" (house money); holding falls to 0.0015 BTC.
- Monthly income: **untouched.** "Rút đầu tư: 25tr" appears instead.
- **No gain row is ever booked.** Realized + unrealized lãi/lỗ are derived
  for display; the ledger keeps one row per real đồng that moved (I7).
  Sign convention: a buy is money **out** of the funding account
  (amount < 0, quantity > 0); a sell is money **in** (amount > 0,
  quantity < 0) — position math just sums the negatives of the amounts.

### 3.3 Dividends / cổ tức / staking rewards

Real money arriving that sells nothing: a normal `kind='income'` row,
category **Lãi đầu tư**, tagged to the receiving account. The position is
untouched — no machinery needed (I7).

### 3.4 Manual entry

The bento's position detail (and its "＋" affordance) offers **Mua thêm /
Bán bớt** sheets: funding/receiving account picker (non-card accounts +
Tiền mặt), amount, optional quantity, date, note. Cash buys (mua vàng ở
tiệm) are just a buy funded from Tiền mặt.

## 4. What changes for stats

| Money event | Expense totals | Income totals | Cash-flow card | Account balance |
|---|---|---|---|---|
| Buy 20tr | — | — | "Đầu tư tháng này +20tr" line | funding −20tr |
| Sell 25tr | — | — | "Rút đầu tư 25tr" line | receiving +25tr |
| Cổ tức 1tr | — | +1tr (Lãi đầu tư) | normal income | receiving +1tr |

The "Còn lại" headline number keeps its meaning — income − expense — but the
two investment lines sit right under it so "can I afford things" reads the
whole truth: the 20tr is not spent, and it is also not available (I6, I8).
Category breakdowns ("Tiền đi đâu", budget bars) never see investment rows.

## 5. Portfolio value & lãi/lỗ

### 5.1 The derivation ladder

Per position, best-available rung, each honestly labelled:

1. **Giá trị hiện tại** = holding × latest price — when both quantity and a
   price exist. Lãi/lỗ = value − net-invested (and %, colored green/red).
2. **Cost basis only** — quantity or price missing → the position displays
   its net-invested number, marked "theo giá vốn".
3. **House money** — net-invested < 0 → "đã rút hơn vốn X".

The bento headline is the **best-effort total** (I12): priced positions at
value, unpriced at cost, with "một phần theo giá vốn" when mixed; the
headline lãi/lỗ computes over priced positions only. Per-row staleness shows
when a price is old ("giá 2 ngày trước").

### 5.2 Where prices come from (I4)

- **Client-side only.** The device fetches public prices; no server
  component ever fetches, stores, or sees a price. The privacy cost is
  bounded and named: the API provider's logs learn that some IP asked for
  BTC — *which* assets, never how much, never who.
- **Crypto**: a free public API (no key), fetched on bento open + manual
  pull-to-refresh, cached locally with a timestamp.
- **Vàng / chứng khoán / CCQ**: best-effort in v1 — where no workable free
  endpoint exists, the price is **manual**: the position sheet has "Cập nhật
  giá" and remembers the entry + its date.
- **Manual always wins**: a hand-entered price overrides the fetched one
  until refreshed deliberately. Offline shows the cached price + staleness
  label; a position never renders a value it cannot date.

## 6. The surface — the "Đầu tư" bento

Lives on the **Tài Chính tab** as a sibling of "Nợ & cho vay" (I13) — same
visual system, same zoom-out → zoom-in grammar.

### 6.1 Zoom out — the bento card

```
ĐẦU TƯ
Giá trị hiện tại  128,4tr   ▲ +8,4tr (+7,0%)
──────────────────────────────────────────
Crypto
  Bitcoin        0.0015 BTC   61,2tr  ▲ +12%  ›
  VNDC           …            24,0tr  · giá vốn ›
Vàng
  Vàng nhẫn      2 chỉ        43,2tr  ▼ −2%   ›
──────────────────────────────────────────
Đầu tư tháng này 20tr · Rút 25tr
```

Grouped by asset class; every row taps through. A position at rung 2 shows
"· giá vốn" instead of a delta. Empty state: one line + "＋ Vị thế đầu tư".

### 6.2 Zoom in — a position

Header: name · symbol · holding · giá trị hiện tại (or giá vốn) · lãi/lỗ ·
giá + staleness + refresh. Body: the buy/sell timeline (each row: date,
amount, quantity, funding account, note), net-invested, average cost when
quantity is known. Actions: **Mua thêm · Bán bớt · Cập nhật giá · Sửa vị
thế** (rename, symbol, unit, class, archive).

### 6.3 Cross-link

The cash-flow card's investment lines (§4) tap through to the bento — the
same pattern as "Tiền đi đâu"'s balance line into the debts bento.

## 7. The review doors (I9)

- **Debit Kind control** gains **Đầu tư**: Chi tiêu ↔ Trả nợ thẻ ↔ Đầu tư.
  Choosing it asks which position (picker + "＋ Vị thế mới" on the spot —
  positions never auto-materialize; an OTC email names a person, not an
  asset) and offers an optional quantity field.
- **Credit Kind control** gains a fourth answer: Thu nhập · Chuyển khoản nội
  bộ · Thu nợ · **Bán đầu tư** (position picker + optional quantity).
- **Counterparty memory.** Committing an investment classification remembers
  the row's counterparty → position mapping (encrypted, personal-side). A
  future captured row matching that counterparty pre-selects "Đầu tư ·
  Bitcoin?" — pre-selection only, never auto-commit, one tap to override.
  Same trust posture as the thu-nợ heuristic and the transfer matcher:
  propose, don't decide.

## 8. Repairing the past (I10)

The personal edit sheet, on a **private expense row**, gains a conversion:
"Chuyển thành khoản đầu tư" → position picker + optional quantity → the row
becomes `kind='investment'` in place, keeping its id, date, account, amount,
note and photos. Its month's expense total drops and "Đầu tư tháng này"
rises — the miscount heals. One way (investment → expense is delete +
re-log), private rows only, no bulk-select in v1. No automated cleanup —
forward-only, per the full-ledger precedent.

## 9. Privacy & posture

- **Investments are personal, always.** Position accounts and investment
  rows live in the personal tables, personal-DEK E2EE, `space_id = NULL`,
  never mirrored, never visible to any family — a portfolio is exactly the
  kind of money the personal ledger exists to keep private.
- Symbols, quantities, prices, and counterparty memories are **ciphertext**
  like every personal value; only routing/timing keys stay plaintext, per
  the 0105 rule.
- Price fetches are the one outbound call — device-side, public data,
  fail-quiet, never proxied through the backend (I4).
- **Nothing auto-imports and nothing auto-classifies.** Every captured row
  still passes the human gate; memory pre-selects, the person commits.

---

# Part 2 — Technical Appendix

## 10. Data model — migration 0123 (applied live 2026-09-06)

Obeys the 0105 rule: values are personal-DEK ciphertext, routing/timing keys
plaintext. Amounts and prices in base units (thousands of VND); signs live
inside the ciphertext.

### 10.1 The spine

- `personal_transactions.kind` check widens to
  `('expense','income','transfer','loan','repayment','investment')`.
- New columns: `position_account_id uuid → personal_accounts (on delete set
  null)`, `quantity_enc text` (signed decimal string, up to 8 dp).
- Partial index `ptx_owner_position_idx (owner_user_id, position_account_id)
  where position_account_id is not null`.
- **Sign convention:** buy = amount −X · quantity +q; sell = amount +X ·
  quantity −q. Net-invested = Σ(−amount); holding = Σ quantity.

### 10.2 Positions on `personal_accounts`

- `kind` check widens to `(…,'investment')`. A position has no
  provider/tail — its name is its identity (the manual-account pattern,
  `human_verified = true` at birth). Never anchored: its balance is derived.
- New columns: `asset_symbol_enc` · `asset_unit_enc` · `asset_class_enc`
  (crypto|gold|stock|fund|other) · `manual_price_enc` (VND-thousands per
  unit) · `manual_price_at timestamptz` (plaintext staleness key). The
  operator learns a user *has* an investment account (kind is plaintext, as
  everywhere) — never which asset or how much.

### 10.3 `personal_review_memory`

`id · owner_user_id · key_enc · position_account_id (cascade) · created_at ·
updated_at`; RLS one policy all verbs, `owner_user_id = (select auth.uid())`.
`key_enc` is the ciphertext of the normalized counterparty key; matching is
client-side after decryption, and dedup is client-side too (no unique
constraint is possible on ciphertext — fresh IV per write). Kept **separate**
from the sibling epic's `personal_lessons` blob deliberately: two in-flight
epics defining one blob's JSON format concurrently is how formats collide.
Folding this table into the lessons blob is a candidate future cleanup.

## 11. The module — `src/js-data/24-investment-ui.js`

Fully self-contained (js-data module scope, the `23-debts-ui.js` pattern):
reads state via `fhPersonalData()`, encrypts via `FHCrypto.encVal(P.key,…)`,
writes via `window.sb`, funnels every write through `fhPersonalHydrate()`.
The zoom-in overlay `#invest-overlay` is **built lazily from JS** (clone of
`#debt-overlay`'s shell) so `index.html` needs no edit.

### 11.1 Derivation — `fhInvPositions()`

Pure function over `P.accounts` (kind='investment') × `P.debts`
(kind='investment', all-time — the debt query's `kind.neq.expense` filter
already carries investment rows). Per position: `netK = Σ(−amt)`,
`qty = Σ qty` (+ `qtyPartial` when some rows lack quantity → holding shows
"≈"), price = **freshest of** the row's manual price and the device cache,
`valueK = holding × priceK` when both exist, the §5.1 ladder picks
`displayK`, `plK = valueK − netK`. Headline totals: priced at value,
unpriced at cost, `mixed` flag, `plK` over priced only (I12). Unreadable
amounts are counted per position and excluded — never 0đ.

### 11.2 Price layer

- Cache: `localStorage['fh-invprice:<uid>']` = `{sym: {k, at}}` — fetched
  prices never leave the device, never touch the server (I4).
- Fetch: CoinGecko `simple/price?vs_currencies=vnd` for crypto positions'
  symbols (small id map + lowercase-symbol fallback), throttled to one call
  per 2 min unless forced, fail-quiet (`console.warn`), re-renders bento +
  open overlay on success. No CSP blocks it; the SW passes cross-origin
  fetches straight through untouched.
- Manual price: `fhInvManualPriceSet` stores `manual_price_enc` +
  `manual_price_at` on the position row (the `ext_balance_enc` pattern —
  encrypted, syncs across the owner's devices). Freshest-timestamp-wins
  implements "manual is authoritative until refreshed deliberately".

### 11.3 Writers

- `fhInvPositionCreate(name, symbol, unit, klass)` / `fhInvPositionUpdate`
  (incl. `archive`) / `fhInvManualPriceSet`.
- `fhInvAdd({dir, amtK, positionId, accountId, qty, note, dateIso, source})`
  — one row, signs applied per §10.1.
- `fhInvRowUpdate` re-signs from the row's stored direction; delete reuses
  `fhPersonalDeleteExpense` (photo sweep + `link_id is null` guard hold for
  any private row).
- Memory: `fhInvMemorySave(raw, positionId)` / `fhInvMemoryMatch(raw)` —
  key normalization mirrors `csvPatternKey` (deburr, lowercase,
  letters-only; digits stripped on purpose — the same OTC seller arrives
  with a different transfer ref every time).

### 11.4 Surfaces

`persInvestSection()` renders `#pers-invest-wrap` (section-h + hero tile +
per-position tiles, odd-tile-wide rule, `dbt-` classes from `41-debts.css`
plus `42-investment.css` accents); `persInvestAfterRender()` triggers the
throttled price refresh. `openInvPosition()` is the zoom-in (hero ladder ·
Mua thêm / Bán bớt · Cập nhật giá · Sửa vị thế · row timeline → row sheet).
All sheets ride `_fhModal`; archive and row-delete are arm-then-confirm.

## 12. Shared-file integration points (land with the release)

1. **`19-personal.js` hydrate** — DONE: both spine selects gain
   `position_account_id, quantity_enc`; accounts select gains the five 0123
   columns; `P.txns`/`P.debts` rows carry `positionId`/`qty`; `P.memory`
   hydrates from `personal_review_memory` (fail-quiet).
2. **`19-personal.js` `fhPersonalBalance`** — the kind set
   `{expense,income,transfer}` gains `investment` (signed, `+= amt`, like a
   transfer leg) so a buy draws the funding account's anchored balance down.
3. **`19-personal.js` `fhPersonalRegen`** — the sweep list gains
   `personal_transactions.quantity_enc`, `personal_accounts.asset_symbol_enc
   / asset_unit_enc / asset_class_enc / manual_price_enc`, and
   `personal_review_memory.key_enc` (the comment at the sweep warns exactly
   this).
4. **Review doors** — `56-csv-import-ui.js`: debit control gains `Đầu tư`
   (flag `_invest`, position picker `c._investPosId`, create-on-the-spot via
   `fhInvNewPositionSheet`, optional qty `c._investQty`); credit control
   gains `Bán đầu tư` (`_divest`, same picker). `csvRowKindCur` order:
   `_xfer → _repay → _invest/_divest → cardpay → income → expense`.
   `57-csv-import-review.js` pre-selection: `fhInvMemoryMatch(counterparty)`
   hit → pre-flag `_invest` (debit) / `_divest` (credit) with the matched
   position — pre-selection only, never auto-commit.
   `72-txn-review.js` promote gains one branch: spec `kind:'investment'`
   with `amt` signed per §10.1, `positionId`, `qty`, `accountId` from the
   instrument ensure; commit also calls `fhInvMemorySave`.
   `fhPersonalAddMany` gains `position_account_id`/`quantity_enc` columns.
5. **`21-personal.js`** — mount `persInvestSection()` +
   `persInvestAfterRender()` beside the debts bento (line ~220/377); add the
   two cash-flow lines from `fhInvMonthFlows()` (tap → bento); fix the
   out-of-window slice path (`buildPMonthChoices` line ~73) that lumps
   non-income kinds into "out" — filter to `kind==='expense'`.
6. **Edit-sheet conversion** — the `fhPersonalConvertToLoan` pattern from
   the lending epic, one shelf over: `fhPersonalConvertToInvestment(id,
   positionId, qty)` flips a private expense row in place (kind, position,
   negative-signed amount, category dropped), plus the reverse
   `…InvestmentToExpense`. Surfaced as a row in the edit accordion for
   private expense rows.

## 13. Stats behaviour (verified against the render code)

`renderPersonal`'s totals sum only `kind==='expense'` (out) and incomes
(inc) — `kind='investment'` rows are excluded from "Còn lại", category
breakdowns, budget bars, and the daily guide **by construction**, exactly
like transfer/loan/repayment. The two visible lines (I6/I8) are additive
UI, not a filter change. The one real fix is the all-time slice path (§12.5).

## 14. Risks & open questions

- **Concurrent epic in one tree.** The lending-capture epic (0122) is
  mid-build in the same working tree and the same files; both epics must
  ship in one coordinated release with both migrations applied. 0123 is
  applied; 0122 is not yet.
- **CoinGecko variance.** Symbol→id mapping is a small hand map; unmapped
  symbols quietly fall back to manual pricing. Vàng/CK/CCQ have no fetch
  route in v1 — manual price is the designed path, not a degradation.
- **Quantity honesty.** Mixed rows (some with qty, some without) make the
  holding approximate — shown with "≈", and value math still runs. The
  alternative (refusing to value) punishes the common OTC case where the
  email never carries quantity.
- **Archived positions hide their rows.** Hydrate excludes archived
  accounts, so an archived position's rows vanish from the bento (by
  design) but still count in month flows. Un-archive is not built (v1:
  archive is one-way; the DB row survives).
- **False memory matches.** Letters-only normalization can collide two
  different sellers with similar names — the cost is a wrong *pre-selection*
  one tap from fixed, never a wrong commit.

## 15. Scope

**In (one release, big bang — I11):** migration 0123 (applied) · the
standalone module (positions, prices, memory, bento, zoom-in, sheets) ·
hydrate + balance + regen extensions · review doors + memory pre-selection ·
cash-flow lines + slice fix · expense→investment conversion.

**Out (named, so they're decisions not omissions):** server-side price
sync · realized-gain accounting rows · multi-currency display (its own
future epic) · investments in any family/space view · bulk historical
conversion · quantity extraction from emails · price alerts/notifications ·
un-archive UI · vàng/CK price APIs (manual is the v1 path) · folding
`personal_review_memory` into `personal_lessons` (future cleanup).

## 16. Decision log

From the design interview, 2026-09-05.

| # | Decision |
|---|---|
| I1 | One-leg `kind='investment'` rows against position accounts (card-payment pattern, not transfer pairs). Positions stay out of the transfer picker. OTC seller is a memo, never a counterparty. |
| I2 | Ambitious scope: live portfolio value + lãi/lỗ. Optional encrypted `quantity` per row; encrypted asset identity + unit per position; graceful cost-basis degradation. |
| I3 | Multi-asset from birth: one `investment` account kind; classes crypto · gold · stock · fund · other. |
| I4 | Prices are client-side only: public API where workable (crypto), manual always available and authoritative, cached locally, never server-side. |
| I5 | Sổ tiết kiệm stays a deposit account; positions are for priced assets. |
| I6 | Buys excluded from expense totals/categories; shown as "Đầu tư tháng này" line. |
| I7 | Net-invested model: position balance = Σ buys − Σ sells, may go negative ("đã rút hơn vốn"). Lãi/lỗ derived for display only — no phantom gain rows. Cổ tức = ordinary income, category "Lãi đầu tư". |
| I8 | Sell proceeds excluded from income totals; shown as "Rút đầu tư" line. |
| I9 | Review doors: debit "Đầu tư", credit "Bán đầu tư", position create-on-the-spot, encrypted counterparty→position memory that pre-selects and never auto-commits. |
| I10 | Historical repair: one-way expense→investment conversion in the personal edit sheet (private rows, id/date/account preserved). No bulk, no automated cleanup. |
| I11 | Big bang — one release, migration 0123 (renumbered from 0122, claimed by the sibling lending epic); price layer cleanly degradable so a flaky API can never block. |
| I12 | Mixed-freshness headline: best-effort total, unpriced at cost ("một phần theo giá vốn"), per-row staleness, lãi/lỗ over priced positions only. |
| I13 | Surface: a new "Đầu tư" bento on Tài Chính, sibling of "Nợ & cho vay"; zoom-out card → position zoom-in; personal E2EE, `space_id=NULL` always. |

**Named out of scope (decisions, not omissions):** server-side price sync ·
realized-gain accounting rows · multi-currency display (its own future epic)
· investments in any family/space view · bulk historical conversion ·
quantity extraction from emails · price alerts/notifications.

## 17. Related

- `docs/specs/borrowing-lending-spec.md` — the one-leg draw-down pattern and
  the bento grammar this reuses.
- `docs/specs/full-ledger-spec.md` — the spine, accounts, anchored balances,
  Kind controls; T11/T12 inherited.
- `docs/specs/personal-ledger-spec.md` — Model Y, E2EE construction, regen.
- `docs/specs/transaction-review-spec.md` — the review surface the new doors
  live in.
