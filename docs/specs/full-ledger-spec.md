# Full Ledger — internal transfers, income & balances

The epic that turns the personal ledger from an expense tracker into a **full
ledger** — every đồng that moves through the user's accounts has a row, every
account has a balance, and moving money between your own accounts stops
counting as spending or earning. Working name for this direction: **Earthy**
(concept only — no UI rename in this epic). The explicit ambition: replace
MoneyLover.

> **Status, 2026-09-02.** Spec agreed after design interview; build is
> **big-bang** (one release, no phases — locked decision B1). BUILT same day:
> migration **0109 applied live** (income folded onto the spine, anchor/drift
> columns), app `v447` — unified hydrate + writers (`19-personal.js`), transfer
> pairs (`fhPersonalAddTransferPair`, edit/delete atomic), anchored balances +
> drift (`fhPersonalBalance`/`fhPersonalDrift`), review 3-way Kind control +
> propose-only matcher (`56/57-csv-import*`), promote branches incl. family
> income routing (`72-txn-review.js`), accounts/balance UI + "Chuyển giữa tài
> khoản" (`23-debts-ui.js`), `balance` body-scan fallback in `extract.mjs`.
> The staged pipeline already carried `raw_extracted.balance` (label-table
> tier), so drift detection works on today's captured mail. §10's "why are
> credit emails invisible" question remains open until real credit mail flows.

> **How this relates to its siblings.** `borrowing-lending-spec.md` gave the
> ledger a balance *sheet* against counterparties (cards, people, groups) and
> shipped `personal_accounts`, `kind='transfer'`, and the plumbed-but-unused
> `transfer_group_id`. This spec closes that spec's two named gaps — the "§24
> internal-transfers double-count" and "settle-up transfer-leg auto-matching"
> deferred item — and goes further: it makes **income** first-class and gives
> non-card accounts a **balance**. `effortless-transaction-logging-spec.md` is
> still how a bank email becomes a row; `personal-ledger-spec.md` (Model Y) is
> still the storage philosophy. Read those first.

---

# Part 1 — Behaviour

## 1. Summary

- **The original itch.** The user holds several deposit accounts (VIB, VCB, …)
  and moves money between them. Today one leg of that transfer gets captured as
  a bogus expense (credit-side emails don't surface), stats are wrong, and the
  event is unrecordable. The fix grew into the full-ledger direction because
  the user is retiring MoneyLover.
- **A transfer is always a pair.** Two rows — a debit leg and a credit leg —
  each tagged to its own account, sharing one `transfer_group_id`. Cash is an
  account (`kind='cash'`), so an ATM withdrawal is a normal pair: VIB −2tr /
  Tiền mặt +2tr. A pair is atomic: edit syncs both legs, delete removes both.
- **Income becomes a `kind`, not a table.** `personal_incomes` folds into
  `personal_transactions` as `kind='income'` — one spine, one hydrate, one
  enum: `expense · income · transfer · loan · repayment`. A full ledger needs
  income to know *which account it landed in*; a separate table without
  `account_id` cannot say.
- **A credit email is a question with three answers.** Money-in at review
  classifies as **Thu nhập** (income, with category) · **Chuyển khoản nội bộ**
  (transfer leg — pairs up) · **Thu nợ** (repayment received, feeds the
  counterparty balances from `borrowing-lending-spec.md`).
- **Matching proposes, never commits.** When a captured debit and credit look
  like two legs of one transfer, the review screen groups them into one
  "Chuyển khoản nội bộ?" card; the user confirms with one tap. No silent
  auto-pairing in this epic.
- **Balances are anchored, derived, and self-correcting.** Each non-card
  account gets a manual anchor ("Số dư hiện tại"); balance = anchor ± entries
  since. Bank emails that carry "Số dư" become a free drift detector: when the
  bank's number disagrees with the derived one, a quiet badge offers *re-anchor*
  or *add the missing transaction*.
- **Transfers are private, always.** A VIB→VCB shuffle has zero family meaning
  and never mirrors to a space. "Funding the family pot" is a *contribution* —
  a distinct future concept, explicitly out of scope here (locked decision T6).

## 2. What changes for stats

Nothing about the *exclusion rule* is new — `kind='transfer'` was already
invisible to income/expense totals ("Trả nợ là chuyển khoản — không tính là
chi tiêu hay thu nhập"). What changes:

| Before | After |
|---|---|
| VIB→VCB: one leg captured as a bogus **expense** | Two paired `transfer` rows, both stats-invisible |
| Income in `personal_incomes`, no account, day-only | `kind='income'` rows on the spine, account-tagged, categorized |
| Credit emails invisible at review | Credit cards render with a 3-way Kind control |
| No account balances (cards only: outstanding) | Every account: anchor-derived balance + drift badge |

History is **forward-only** (locked decision T2): no automated cleanup of past
double-counted legs. The review Kind control plus the existing edit surface
are enough to reclassify an old bogus expense by hand if it rankles.

## 3. The transfer pair — walk-throughs

### 3.1 Manual: VIB → VCB 5.000.000đ

"Chuyển giữa tài khoản" form: from-account · to-account · amount · date ·
note. One submit writes two rows:

| Leg | account_id | kind | amount (in ciphertext) | transfer_group_id |
|---|---|---|---|---|
| out | VIB | transfer | −5.000.000 | `G` |
| in | VCB | transfer | +5.000.000 | `G` |

Monthly income/expense: untouched. VIB balance −5tr, VCB +5tr.

### 3.2 Captured: both legs arrive by email

VIB debit alert and VCB credit alert both land in review. The matcher sees:
opposite directions · two *different* accounts the user owns · **exact** same
amount (VN internal transfers are fee-free; no tolerance) · `txn_date` within
±1 day. It renders the two candidates as one grouped card — *"Chuyển khoản
nội bộ? VIB → VCB · 5.000.000đ"* — one tap confirms and commits the pair;
expanding lets the user reject (the cards separate back into ordinary
candidates).

False-pair risk (two real same-amount events, round numbers like 500k) is why
the posture is propose-only (locked decision T5); auto-commit can be earned
later with observed precision.

### 3.3 Captured: only one leg has an email

ATM withdrawal (cash has no inbox), a transfer to an account with no
capture feed, or the day one bank's email goes missing. Confirming the lone
leg as "Chuyển khoản nội bộ" asks for the other side's account and
**auto-creates the counterpart row**, so the pair invariant holds. This is
non-optional: a one-legged transfer is exactly how the destination account's
balance silently rots (locked decision T4).

Some banks **never email money-in at all** — so the destination may be an
account capture has never materialized. Two mechanisms close that gap
(follow-up interview, T11):

- **Eager materialization**: the review queue is a *census* of the person's
  instruments — every staged row names the account it moved through. At
  review open, each distinct (kind · provider · tail) is ensured into
  `personal_accounts` (named via `fhProviderName`), so every picker is
  complete the moment it renders. The bento shows the full portfolio;
  unwanted instruments archive away. Cards stay **out** of the transfer
  picker — money into your own card is its own kind (Trả nợ thẻ).
- **"＋ Tài khoản khác"**, demoted to last resort: for the truly silent
  instrument (a bank with no alerts at all, a savings sub-account), name it
  on the spot and a manual `deposit` account is created (name is its
  identity — no provider/tail). The manual transfer sheet offers the same
  on both sides.

### 3.4 Fees

If a transfer ever carries a fee, the fee is its own small `expense` row —
leg amounts are never adjusted to absorb it. Keeps the exact-match rule sound
and the fee visible as real spending.

### 3.5 Legacy single-leg transfers stay

Card payments ("Trả nợ thẻ") and the 0105-era balance-adjustment transfers
remain one-legged, tagged to the card whose *outstanding* they draw down.
They already work, their account's "balance" is a debt not a deposit, and the
pair invariant applies to **deposit/cash/ewallet ↔ deposit/cash/ewallet**
moves. (A card payment's sending-bank side becomes representable now — see
§7.3 — but no migration of old rows.)

## 4. Income, first-class

### 4.1 The 3-way Kind control on a credit card (review)

Money-in candidates render like any card, with a Kind control:

1. **Thu nhập** — commits `kind='income'` with an income category.
2. **Chuyển khoản nội bộ** — a transfer leg (§3.2/§3.3).
3. **Thu nợ** — repayment received; asks which counterparty and writes the
   `repayment` row that draws their balance down (the review-side entry point
   `borrowing-lending-spec.md` §5 wanted).

The pre-selection heuristic: matched pair → transfer; memo matching a known
counterparty name → thu nợ; else thu nhập. Always overridable.

(`72-txn-review.js` already routes `direction='credit'` on a deposit account
to `fhPersonalAddIncome` — so a skeleton of answer 1 exists; this epic makes
the choice explicit and adds 2 and 3. Why the user sees *no* credit cards in
review today is an upstream question — credit-alert email shapes for their
banks likely never derived a template — to be verified during the build, §10.)

### 4.2 Income categories

Same encrypted mechanism as expenses (`cat_name_enc` + `cat_emoji`), with an
income-side default set: **Lương · Thưởng · Hoàn tiền · Khác**. Category is
optional on manual entry, prompted at review.

### 4.3 Where income shows up

- Month cash-flow card: income total now = Σ `kind='income'` for the month
  (was Σ `personal_incomes`). Same number, new source.
- A "Thu nhập theo nhóm" cut becomes possible (categories exist now); v1 of
  this epic ships the category data + a simple list, not a full income
  analytics screen.
- Every income row tagged to an account feeds that account's balance.

## 5. Balances

### 5.1 The anchor model

For every non-card account (`deposit · ewallet · cash`):

```
balance = anchor_balance + Σ signed amounts of rows after the anchor
```

- **Anchor** is set by the user: "Số dư hiện tại" on the account sheet.
  Stored encrypted (`anchor_balance_enc`) with a plaintext `anchor_at`
  timestamp. Re-anchoring just overwrites — the anchor is a statement of
  truth "at this moment", not an event row.
- "After the anchor": rows with `txn_date` after the anchor's calendar day,
  plus same-day rows created after `anchor_at`. (Backdating a row to before
  the anchor deliberately does *not* move the balance — the anchor already
  contained it.)
- **No anchor set** → the account shows "chưa có mốc số dư", never a number.
  A derived balance with no anchor would be confidently wrong, which is worse
  than absent.
- Cards keep their existing *outstanding* derivation untouched.

### 5.2 The drift detector

Most VN bank alert emails state the balance after the transaction ("Số dư:
11.800.000 VND"). The extraction pipeline gains a `balance_after` field
(§7.4). At review-commit of a captured row that carries one, the client
stores it (encrypted) on the account as `ext_balance_enc` + its date.

When the bank's last-known number disagrees with the derived balance, the
account row shows a quiet badge — *"lệch −700k"*. Tapping offers exactly two
resolutions:

1. **Re-anchor to the bank's number** — one tap, drift gone, gap absorbed
   into the anchor (honest: the anchor is *declared* truth).
2. **Add the missing transaction** — opens the entry form pre-filled with the
   gap amount, for when the user knows what the hole is.

Drift is a *state*, not an event — no review cards, no notifications (locked
decision T9). Cash never has emails; cash drift surfaces only when the user
notices and re-anchors — same tap, no special case.

### 5.3 Where balances live in the UI

The accounts area of the "Nợ & cho vay" surface grows into a proper accounts
list: each non-card account shows name · tail · **balance** (or "chưa có mốc
số dư") · drift badge when applicable. Cards keep showing outstanding + due
chip as today. The account detail sheet gains: set/update anchor · account
history (its legs, all kinds) · the drift resolution sheet.

## 6. Privacy & visibility

- Transfer pairs are **always `space_id = NULL`** — never mirrored, no toggle
  (locked decision T6). Balances, anchors, and drift are personal-key E2EE
  like everything else personal.
- The deferred sibling concept, named so it isn't re-litigated: a **space
  contribution** ("Hiển góp 5tr vào quỹ tháng 9") — visible to the family,
  stats-neutral personally, *not* an internal transfer. Future spec.

---

# Part 2 — Technical Appendix

## 7. Data model — migration 0109

### 7.1 The unified spine

```sql
alter table public.personal_transactions
  drop constraint personal_transactions_kind_check,
  add constraint personal_transactions_kind_check
  check (kind in ('expense','income','transfer','loan','repayment'));

insert into public.personal_transactions
  (id, owner_user_id, kind, amount_enc, note_enc, txn_date, created_at)
select id, owner_user_id, 'income', amount_enc, note_enc, income_date, created_at
from public.personal_incomes;

drop table public.personal_incomes;
```

Ciphertexts copy verbatim — same personal DEK, same `encVal` format; no
re-encryption needed. Row ids are reused (both uuid PKs, no cross-references
exist). Client changes land in the same release (big bang): hydrate stops
selecting `personal_incomes`, `fhPersonalRegen`'s re-encryption loop drops its
`personal_incomes` pass, `fhPersonalAddIncome` / delete-income re-target the
spine (gaining `account_id`, `cat_name_enc`, `cat_emoji`,
`occurred_time_enc` — income stops being day-only for free).

### 7.2 Account anchors + drift state

```sql
alter table public.personal_accounts
  add column anchor_balance_enc text,          -- personal-DEK ciphertext
  add column anchor_at timestamptz,            -- plaintext moment of declared truth
  add column ext_balance_enc text,             -- last bank-stated balance, ciphertext
  add column ext_balance_date date;            -- plaintext, for staleness display
```

Plaintext-vs-ciphertext follows the 0105 rule: amounts encrypted, routing/
timing keys plaintext. Both `_enc` fields join the `fhPersonalRegen`
re-encryption sweep.

### 7.3 The transfer pair

No schema change — `transfer_group_id` (0105) finally does its job. Writer
contract:

- `fhPersonalAddTransferPair(amtK, fromAccountId, toAccountId, note, dateIso, source)`
  → one `crypto.randomUUID()` group id, two inserts: out-leg (−amt, from),
  in-leg (+amt, to). Sign lives inside `amount_enc` as everywhere else.
- Confirming a lone captured leg calls the same writer with the captured
  side's real data and the chosen counterpart account; `source` marks the
  synthesized leg as derived-from-pair.
- **Pair integrity, client-enforced**: edit amount → update both rows; delete
  → delete both (confirm sheet names both accounts); a leg whose partner is
  missing at hydrate renders with a repair affordance rather than crashing.
- Legacy one-leg transfers are distinguishable: `transfer_group_id IS NULL`.
  Card-payment writers keep writing them (and *may* pass a group id when the
  sending bank's leg is captured — the card-payment special case folds into
  the general pair model without forcing it).

### 7.4 Pipeline: `balance_after`

`mailbox-sync` extraction gains one field: the post-transaction balance
("Số dư", "Số dư khả dụng", "SD:"), normalized to đồng, carried per-mail (not
template-static — it changes every mail) into the sealed `raw_extracted`.
Absent → null, nothing breaks. This is the only Edge Function change in the
epic; instrument classification, direction, and account tails already exist.

## 8. The matcher

Runs client-side over the open review candidate set (plus rows committed in
the same session), no server involvement:

```
pairable(a, b):
  a.direction ≠ b.direction
  AND account(a) ≠ account(b)             -- both resolved to own accounts
  AND amount(a) == amount(b)              -- exact; VN transfers are fee-free
  AND |txn_date(a) − txn_date(b)| ≤ 1 day
  AND neither is a card-payment candidate -- those keep their existing flow
```

Greedy, newest-first, each candidate in at most one proposal; ambiguity
(two possible partners) → no grouped card, both stay individual with the
Kind control available. The grouped card commits via
`fhPersonalAddTransferPair`, retiring both staged rows.

## 9. Stats & hydrate touchpoints (inventory)

The build must sweep every consumer of `P.incomes`, which ceases to exist:

- `19-personal.js` hydrate (`fhPersonalHydrate`) — one query, `P.txns` gains
  `kind='income'` rows; `P.incomes` becomes a derived view or is removed and
  callers updated.
- `21-personal.js` — month totals (:154-156), month-picker deltas (:66-67),
  daily/weekly charts (expense-only filters stay correct by construction),
  any "Còn lại" math that reads income.
- `23-debts-ui.js` — account rows/detail gain balance + anchor + drift UI;
  card flows untouched.
- `72-txn-review.js` — credit-card rendering, 3-way Kind control, matcher,
  grouped proposal card, `balance_after` capture into account state.
- `fhPersonalRegen` — re-encryption loop: minus `personal_incomes`, plus the
  two new account `_enc` columns.
- Income edit/delete surfaces — re-target the spine.

## 10. Risks & open questions

- **Why are credit emails invisible today?** Staging and promote both handle
  `direction='credit'`, yet the user sees no money-in cards. Most likely the
  credit-alert shapes for their banks never derived templates (possibly the
  Gemini 429 throttle noted in `borrowing-lending-spec.md`). Must be
  diagnosed during the build — the whole income/matching surface depends on
  credit mail flowing.
- **Balance-after extraction variance.** "Số dư" phrasing differs per bank;
  a missed extraction only mutes the drift detector (fail-quiet by design).
- **False pairs.** Exact-amount + ±1-day will occasionally group two real
  events. Mitigated by propose-only + easy reject; measure before ever
  auto-committing.
- **Anchor semantics vs backdating.** The "after the anchor" rule (§5.1) is
  deliberate but subtle; the account sheet should state it in one line of
  copy ("Mốc số dư đã bao gồm mọi giao dịch trước lúc đặt").
- **Big-bang migration.** Dropping `personal_incomes` and shipping all client
  changes in one release means no partial-rollback story; the mitigations are
  the verbatim-ciphertext copy (reversible until `drop table`) and testing
  the migration on a branch DB first.
- **VND-only stands** (locked decision T10) — still no currency column.

## 11. Scope

**In (one release, big bang):**
- Migration 0109 (spine unification + anchors + drift columns).
- Transfer pairs: manual form, lone-leg counterpart creation, pair integrity.
- Matcher + grouped "Chuyển khoản nội bộ?" proposal card.
- 3-way credit classification (Thu nhập / Chuyển khoản nội bộ / Thu nợ).
- Income categories (Lương · Thưởng · Hoàn tiền · Khác) + account tagging.
- Anchored balances for deposit/ewallet/cash + drift badge + two-way
  resolution.
- `balance_after` extraction in mailbox-sync.

**Out (named, so they're decisions not omissions):**
- Auto-commit matching (earn it with precision data).
- Space contributions (future sibling spec).
- Historical double-count cleanup (forward-only; manual reclassify exists).
- Income analytics screen beyond category list.
- Multi-currency.
- UI rename to "Earthy".

## 12. Decision log

From the design interview, 2026-09-02.

| # | Decision |
|---|---|
| T1 | Goal is a **full ledger** (MoneyLover replacement), not stats hygiene only. Working name "Earthy", concept-only — no UI rename (B2). |
| T2 | Pain today: only the debit leg gets captured (credit cards absent from review). History handled **forward-only**. |
| T3 | Per-account balances: **yes**, for deposit/ewallet/cash; cards keep outstanding. |
| T4 | A transfer is **always a pair** sharing `transfer_group_id`, cash included; lone captured legs auto-create their counterpart. Legacy one-leg card payments stay. |
| T5 | Matching is **propose-only**: opposite directions, different own accounts, exact amount, ±1 day → grouped confirm card. |
| T6 | Transfers **always private** (`space_id = NULL`, no toggle). Space funding = a future *contribution* concept, not a mirrored transfer. |
| T7 | Income **unifies into `personal_transactions`** as `kind='income'`; `personal_incomes` migrated and dropped. |
| T8 | Credit email classifies 3 ways: Thu nhập / Chuyển khoản nội bộ / Thu nợ. Income gets categories via the existing encrypted mechanism (Lương · Thưởng · Hoàn tiền · Khác). |
| T9 | Balance truth = **manual anchor** + email `balance_after` as drift detector; drift is a quiet badge with two resolutions (re-anchor / add missing txn), never a review card. |
| T10 | Edge rules blessed: pair delete/edit atomicity · fees as separate expense rows · VND-only · legacy single-leg transfers untouched. |
| T11 | Accounts materialize **eagerly at review open** from the queue's instrument census (not at import) — pickers list accounts only and are always complete. Cards stay out of the transfer picker (one kind = one meaning). "＋ Tài khoản khác" survives as the last-resort escape hatch for instruments with no email footprint at all. |
| T12 | An instrument's **identity is (provider, tail)** — kind is editable metadata, never part of the ensure() match (a kind-keyed match once duplicated a real account). The 16-digit-PAN ⇒ credit-card client heuristic is dead (VN debit cards print full PANs too; a mis-kinded account polluted both pickers); unconfident stays null. The account settings sheet carries a kind switcher (card-only fields follow it) so a wrong guess is one tap from fixed. |
| B1 | Build shape: **big bang** — one spec, one release, no phases. |
| B2 | Branding out of scope. |

## 13. Related

- `docs/specs/borrowing-lending-spec.md` — counterparty balances, `personal_accounts`, the deferred gaps this spec closes.
- `docs/specs/effortless-transaction-logging-spec.md` — the capture pipeline (§24 internal-transfer gap now resolved here).
- `docs/specs/personal-ledger-spec.md` — Model Y storage philosophy.
- `docs/specs/transaction-review-spec.md` — the review surface the Kind control and matcher live in.
