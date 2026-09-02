# Borrowing & Lending — the counterparty-balance epic

The epic that gives FamilyHub a **balance sheet** on top of the cash-flow it
already has. Today the ledger only knows *flows* (money in / money out over a
month); it cannot answer *"how much do I owe, and who owes me, right now."*
This epic adds that missing dimension — the user's "zoom out" — by modelling one
primitive: **a running balance against a named counterparty**, where a credit
card issuer, a friend, and a group are all just parties you owe or who owe you.

> **Status, 2026-09-02.** v1 SHIPPED to production (app `v442`+`v443`, migrations
> 0105 / 0106a / 0106b / 0107 applied live, `mailbox-sync` v26→v27). Built: the
> personal debt layer (accounts, loan/repayment/transfer kinds, derived balances
> — `19-personal.js`), friend/trip spaces with splits + settle-ups
> (`22-spaces.js`, the 0106 substrate), the Nợ & cho vay bento + three zoom-ins
> + sheets (`23-debts-ui.js`, `41-debts.css`, `#debt-overlay`), the expense-modal
> instrument picker, the pipeline instrument classifier (`account_kind`, filled
> by a per-read heuristic on both transports), and the review screen's account
> chips + transfer matrix + promote threading. Deferred within v1: statement-due
> parsing, settle-up transfer-leg auto-matching ("khớp với…" —
> `transfer_group_id` is plumbed but unused), review-chip → fingerprint
> `human_verified` write-back, daily-guide card heads-up.
>
> **v443 refinements.** Card payments render as normal (checkable) review cards,
> not the set-aside grey zone; a promoted card payment tags the CARD it pays off
> (its own payment-received alert, or the sole credit card), not the sending
> bank; the card detail splits Chi tiêu / Thanh toán; "Ghi thanh toán thẻ" lists
> in-review card-payment candidates to assign to a specific card.
>
> **Known issue (2026-09-02).** The *auto-capture* half is throttled by the
> Gemini free-tier quota (HTTP 429) — mail whose shape needs a model read is
> held until quota returns (see `effortless-transaction-logging-spec.md` §24 +
> Part 3 v27). This does NOT affect the ledger itself: cards, 1:1 IOUs, groups,
> splits and settle-ups all work from manual entry with no model call. NB: the
> ELV bump to 5 that shipped with v26 was reverted in v27 — `account_kind` is
> heuristic-filled and needs no version bump.

> **How this relates to its siblings.** `effortless-transaction-logging-spec.md`
> is how a bank email becomes a ledger row; this spec is what a *subset* of those
> rows (credit-card purchases, transfers, settle-ups) additionally *mean* for a
> balance. `personal-ledger.md` (Model Y) is the storage philosophy this obeys:
> **the person is the root, a liability is always personal, a space is a shared
> container.** Read those two first.

---

# Part 1 — Behaviour

## 1. Summary

- A **credit card is borrowing.** Every swipe is a micro-loan from the bank;
  paying the statement repays it. Mechanically that is the same shape as lending
  a friend 500k and getting it back: a balance against a counterparty that one
  event opens and a later event closes.
- So the epic models **one primitive — a counterparty balance** — and the bank,
  a friend, and a group are all counterparties. Summing them gives the "zoom
  out": *what I owe* vs *what I'm owed*, right now.
- The single asymmetry that is the whole design: **the settlement leg is always
  a transfer, never income/expense. The opening leg differs** — a card purchase
  opens a debt *and* is a categorized expense; a loan opens a debt and is *not*.
- **Liabilities are personal, always** — even when they finance a family
  expense. A card belongs to a person; a family can never be the borrower. So
  the borrowing ledger lives entirely in the user's personal tables, under the
  personal key. Family tables stay untouched (`personal-ledger.md` locked
  decision #5 survives).
- **Shared splits are different from personal debt.** A friends split is
  multi-party — everyone must see the same who-owes-whom — so it lives in the
  *space*, under the shared space key (Splitwise-style), and each person's net
  position mirrors down into their personal picture. Storage splits; the *view*
  unifies.
- Most of it is **captured, not typed.** The email pipeline already sees the
  card purchase, the statement payment, and (often) the friend's bank transfer.
  The wedge over Splitwise: nobody else can read the group's bank mail; we can.

## 2. Two things wearing one name

"Borrowing/lending" hides two structurally different problems. Keeping them
distinct is the whole discipline of this epic.

| | **Personal liability / asset** | **Shared-space split** |
|---|---|---|
| Example | Credit-card debt; "tôi cho thằng em mượn 2tr" | Friends dinner one person fronts; trip costs |
| Parties | Single-party — only *you* track it | Multi-party — everyone sees the same balance |
| Storage | Your **personal** tables, personal key | The **space**, shared space key |
| Counterparty | A bank, or a name you type | Members of the space |
| Truth | Yours alone | Shared, one source of truth |

They unify **at the view layer**: your personal "Nợ & cho vay" screen shows one
list — `Sacombank −4.82tr`, `Nhóm Đà Lạt +1.5tr`, `Thằng em +2tr` — even though
the rows are stored in different places. That is pure Model Y: person is root,
the space is a shared container, the personal view aggregates across. The
existing **family→personal mirror** is the exact mechanism that carries a space
balance down into the personal view.

## 3. The one rule that makes it coherent

> **Settlement is a transfer. Opening a debt may or may not also be an expense.**

| Event | Opening leg | Settlement leg |
|---|---|---|
| Card purchase (phở 50k) | Expense `Ăn uống 50k` **and** card debt +50k | — |
| Statement payment (3M from bank) | — | Transfer bank −3M, card debt −3M. **Not** a new expense. |
| Lend a friend 2M | Receivable +2M. **Not** an expense (no consumption). | — |
| Friend repays 2M | — | Transfer. **Not** income. |
| Split dinner 900k, you paid | Your *share* 300k is your expense; the other 600k is a **receivable** | Friends' repayments are transfers that draw the receivable down |

The mistakes this rule prevents:
- Counting the statement payment as a 3M expense (double-count — the swipes were
  already counted).
- Counting a loan out as an expense, or a repayment in as income (a loan is a
  change in the *shape* of your net worth, not consumption or earning).
- Counting the full 900k you fronted as *your* spend (only your 300k share is;
  the rest is owed back).

## 4. The credit-card walk-through (your case)

You buy a 500k family dinner on your Sacombank credit card and file it to the
**family** ledger. One real-world event splits across scopes:

| Leg | Where it lives | Scope | Counts as |
|---|---|---|---|
| **Expense** "Ăn uống 500k" | family `transactions` (+ its personal mirror master) | shared — family sees it, budget-counted | a family expense — **exactly as today** |
| **Financing** +500k owed to Sacombank | personal counterparty ledger, `space_id = NULL` | private — family never sees it | a debt increment, **not** an expense |
| **Statement payment** 3M from bank | personal ledger, a **transfer** | private | **neither** income nor expense |

The family sees a normal shared dinner and nothing else — never the card, never
your Sacombank balance. You privately see *"I owe Sacombank X — of which 500k
was the family dinner I fronted."* When the statement clears, nothing
double-counts, because the payment is a transfer. The only new wiring is a
**link from the financing leg back to the expense row**, so "how did I pay for
this" is answerable and the card balance knows which purchases built it — and
the pipeline already captures `account_masked`/`account_tail`, so it knows the
card without you typing.

## 5. The friends-split walk-through

Space **Nhóm Đà Lạt** = {An, Bình, Chi}. Dinner 900k, An pays, split equally.

**In the space (shared, everyone sees the same under the space key):**

| Member | Paid | Share (consumed) | Net |
|---|---|---|---|
| An | 900k | 300k | **+600k** (được nợ) |
| Bình | 0 | 300k | **−300k** (nợ An) |
| Chi | 0 | 300k | **−300k** (nợ An) |

Simplified: *Bình → An 300k · Chi → An 300k.*

**Mirrored into each person's personal view:**
- **An**: personal *spend* +300k (his share, **not** 900k) + a **receivable
  +600k**.
- **Bình / Chi**: personal *spend* +300k + a **payable −300k**.

**Settle-up is just a transfer.** When Bình pays An 300k, it flows through the
normal capture → review path: Bình's outgoing (or An's incoming) email is
captured and, in the bulk review modal, reclassified as *"trả nợ nhóm"* — a
directed member→member transfer recorded **in the space** (so it moves *both*
balances). No bespoke "mark as paid" button; it's the same `kind='transfer'`
primitive as a card payment, with a person as the counterparty instead of an
account. Cash settles have no email and stay manual.

**Reconciliation (both mailboxes see the same transfer):** Bình's outgoing and
An's incoming are the *same* settle-up. The rule: **whoever reviews first
authors the shared settle-up; the second person's leg finds it already in the
space and shows "khớp với khoản Bình đã trả" → reconcile, don't re-log.** This
is the cross-mailbox version of the §24 internal-transfer double-count, resolved
as a one-tap confirm at review rather than silent magic.

## 6. The surface — "zoom out" and "zoom in"

Lives as a new section on the **Tài Chính tab** (`renderPersonal()` →
`#pers-body`), placed **between the cash-flow card and "Tiền đi đâu"** — a
different time semantic: the cash-flow card is *flow this month*; this is
*balances right now* (a stock).

### 6.1 Zoom out — the "Nợ & cho vay" card

Two totals, **not** one collapsed net (a card bill and a friend IOU are
different animals):

```
NỢ & CHO VAY
Tôi nợ  7.120.000đ (red)        Được nợ / cho vay  3.500.000đ (green)
──────────────────────────────────────────────
Thẻ & khoản vay
  Sacombank Visa · tín dụng      −4.82tr  ›   [đến hạn 15/09]
  Anh Long (đã cho mượn)         −2.00tr  ›
Bạn bè & nhóm
  Nhóm Đà Lạt                    +1.50tr  ›
  Thằng em                       +2.00tr  ›
  Bình · nhóm Ăn chơi            −0.30tr  ›
```

Institutional (cards/loans) and social (people/groups) grouped separately,
because people *think* about "my card bill" and "settling with Bình"
differently. Every row taps through.

### 6.2 Zoom in — three flavors

**① A card** — outstanding, hạn mức còn lại, statement due date + amount (if a
statement email was captured); the purchases that built the balance this cycle
(re-cut from expenses you already have in your categories) plus payments that
drew it down; the line *"trong đó Xđ là chi tiêu gia đình bạn ứng thẻ."*

**② A person** — net with them; the relationship timeline (loan, each
repayment, each split); which space it came from (or "riêng tư" for a 1:1 IOU);
actions: record settle-up (= log a transfer) · nhắc trả.

**③ A space** — your net in it, then the **group balance sheet** (every
member's +/−, shared truth); simplified pairwise; the shared expenses and how
each split; settle-up actions.

### 6.3 Cross-links (so it doesn't feel bolted on)

- The existing per-space spending card ("Tiền đi đâu") gets one balance line —
  *"bạn được nợ 1.5tr ở nhóm này ›"* — into flavor ③.
- The cash-flow **daily guide** gets a heads-up — *"sắp phải trả thẻ ~4.8tr"* —
  so "can I afford things" knows about the looming bill. (Debt itself stays
  **out** of "Còn lại": card purchases already count there as spend; the payment
  is a transfer, correctly invisible to the monthly flow.)

### 6.4 Which jobs this serves

Not a fifth JTBD — it *completes* two existing ones (see
`research/jtbd-individual-finance.md`): **JTBD 4 Planning** — "can I still
afford things" now includes what I owe; **JTBD 3 Fairness** — who owes whom in
groups.

## 7. Privacy & trust posture

- **Liabilities and 1:1 IOUs are personal E2EE** — personal tables, personal
  key, ciphertext-only, like every other personal row.
- **Space balances are shared E2EE** — under the space key all members already
  hold. A non-member can read nothing (no key).
- **Settle-ups are unilateral / trust-based** (Splitwise-style): either member
  can author a settle-up that moves the shared balance; no dual-confirm. It's a
  friends ledger, not escrow — requiring both to confirm would strand balances
  when one person never opens the app.
- **Nothing auto-imports** — settle-ups, card payments, and transfers all pass
  through the human gate at review, same as every captured row (§9 of the
  capture spec).
- **Never invent a debt.** When the instrument is ambiguous, default to
  deposit/expense — a phantom card debt corrupts "what you owe" forever and
  waits for a payment that never reconciles (§10.2).

---

# Part 2 — Technical Appendix

## 8. The instrument classifier — credit vs debit vs e-wallet

The borrowing logic hinges on correctly labelling each captured row's
*instrument*. Both transports already share one extraction cascade and one
`sender_fingerprints` cache (capture spec §5), so this is added **once** and
both forwarding and direct-read inherit it.

### 8.1 Instrument is a template property, learned once

A given `(sender_address, subject_template)` is almost always **one product** —
"Sacombank credit-card alerts" is a different fingerprint from "Sacombank số-dư
alerts." So the instrument is derived at first-mail derivation and **frozen in
the template `static` block**, exactly like `source_provider` and `direction`
already are (capture spec §16.2). Add one static field:

```
static.account_kind ∈ { credit_card | deposit | ewallet }
```

Steady-state cost: zero (cached per shape).

### 8.2 The VN signals, most reliable first

| Signal | Verdict |
|---|---|
| "Hạn mức khả dụng" / "dư nợ" in the body | **credit_card** (deposit accounts have no credit limit) |
| "Số dư" (balance after txn) | **deposit** |
| Sender is MoMo / ZaloPay / ShopeePay | **ewallet** |
| Subject "giao dịch **thẻ tín dụng**" vs "biến động **số dư tài khoản**" | card vs deposit |
| Masked-id shape (16-digit card vs TK number), `type_code` (GD thẻ / CK / TT / NẠP) | tiebreakers |

### 8.3 Ledger meaning = instrument × direction

`direction` (money in/out) is already extracted. Cross it with `account_kind`:

| Instrument | Money out | Money in |
|---|---|---|
| **credit_card** | Expense + debt +X | Transfer — draws debt down (payment received / refund) |
| **deposit** | Expense (cash out now, no debt) | Income |
| **ewallet** | Expense from ví | Top-up (transfer) / income |

The three cells that are **transfers wearing an expense/income costume** are the
crux, detected by **memo + counterparty matching against the user's own
accounts**:

- bank **out**, memo `TT THẺ` / `THANH TOAN SAO KE` → card payment (transfer)
- bank **out**, memo `NẠP MOMO` → wallet top-up (transfer)
- card/bank **in** that is a friend repayment → settle-up (transfer)

This is the existing §24 "internal transfers double-count" gap, now doing real
work: *if the counterparty is one of your own accounts, it's a transfer.*

### 8.4 Ambiguous-instrument default

When a terse mail carries neither "hạn mức" nor "số dư": **default
deposit/expense, flag low-confidence, keep the review chip editable.** Bias:
never invent a debt you're unsure of. A phantom credit-card debt inflates "what
you owe" forever; a missed debt just means one statement payment needs manual
classing — the lesser evil, matching the pipeline's "don't hide/fabricate
money" posture.

## 9. The review screen

- Every card gets an **account chip** — `Sacombank Visa · tín dụng · ••1234` /
  `VCB · TK · ••4821` / `MoMo`. Derived, no typing.
- **Purchases** render exactly as today — expense + category.
- **Card payments / top-ups / settle-ups** auto-sort into the existing "Tụi
  mình để riêng" bucket, pre-marked as **transfers** (reversibly) — the
  generalization of today's "card payments" bucket (capture spec §4.4).
- The chip is **editable**; correcting `account_kind` once sets `human_verified`
  on the fingerprint and fixes every future mail of that shape, for both flows.
- Friend settle-ups reclassified here write the directed transfer into the
  **space**; a captured leg that matches an already-authored settle-up shows
  "khớp với…" and reconciles (§5).

## 10. Proposed data model

> Design-level, not final DDL. Obeys Model Y: personal in personal tables under
> the personal key; shared in the space under the space key. Next free migration
> is **0081** (`personal-ledger.md`).

### 10.1 Personal side (liabilities, assets, accounts) — owner-scoped, ciphertext-only

- **`personal_accounts`** — one row per instrument the user holds.
  `owner_user_id`, `kind` (credit_card | deposit | ewallet | cash),
  `name_enc`, `tail`, `source_provider`, `human_verified`. **Auto-materializes**
  from captured `account_tail` (Q15); a default "Tiền mặt" absorbs manual/cash.
  RLS `owner_user_id = auth.uid()`.
- **`personal_transactions`** gains: `account_id` (which instrument),
  `kind` (`expense` | `income` | `transfer` | `loan` | `repayment`),
  `counterparty_enc` (a person's name for a 1:1 IOU), and for transfers a
  `transfer_group_id` pairing the two legs (the `kind='transfer'` two-leg
  pairing already flagged schema-ready in `personal-ledger.md`).
- **Balances are derived, not stored** (Q5): a card's outstanding =
  Σ(expenses on that account) − Σ(payments to it); a person's balance =
  Σ(loans + fronted shares) − Σ(repayments). One row per real event; no
  double-entry liability rows.
- **1:1 IOU with a non-member** (Q13) is exactly this: a name-only
  `counterparty_enc` on a personal `loan`/`repayment` row — one-sided, no shared
  truth, literally the credit-card mechanism with a person's name instead of a
  bank.

### 10.2 Shared side (space splits + settle-ups) — under the space key

- **`space_expense_shares`** — per shared expense: the payer, the split rule
  (`equal` | `exact` in v1), and each member's share. Encrypted under the space
  DEK. This is the first shared-space feature beyond plain expenses; it extends
  space tables (legitimate — it's shared state, not personal leaking into
  family).
- **`space_settle_ups`** — directed member→member transfers (payer, payee,
  amount, occurred_at), the events that draw group balances down. Authored
  unilaterally (§7).
- **Group balance** = derived from `{shared expenses + their shares} −
  {settle-ups}`, per member. Everyone computes the same from shared rows.
- **Mirror into personal**: each member's *net position in the space* flows into
  their personal counterparty view via the existing mirror engine
  (`fhPersonalMirror`, `19-personal.js`) — a receivable/payable against the
  space, alongside personal card/loan balances.

## 11. Scope

**In v1:**
- Credit cards as counterparty balances (auto-classified, derived balance).
- Card payments auto-captured as transfers (Q8a).
- Personal 1:1 IOUs (name-only counterparty, one-sided) (Q13).
- Space splits — **equal + exact-amount** only (Q9), **members-only** (Q7).
- Settle-ups as directed transfers through the review modal; first-leg authors,
  second-leg reconciles (Q8b, Q10); manual cash settles.
- The "Nợ & cho vay" card + three zoom-in flavors + two cross-links (§6).
- Manual entry first-class via the existing expense modal — account picker +
  "chia nhóm" toggle (Q14).
- Accounts auto-materialize from capture, editable (Q15).

**Deferred:**
- Amortizing loans (trả góp / mortgage — interest schedules, principal/interest
  split) — a heavier beast email capture can't reconstruct (Q2).
- Ghost / non-member participants in splits (Q7).
- Percentage / share-weighted splits ("I had the lobster") (Q9).
- Auto cross-mailbox settle-up matching (surfaced-for-confirm only in v1) (Q10).
- Foreign currency (ledger has no currency column — capture spec §24).
- Explicit double-entry liability rows (Q5).

## 12. Risks & open questions

- **Internal-transfer detection reliability.** The whole model leans on
  correctly spotting card payments / top-ups / settle-ups as transfers via memo
  + own-account matching. Terse bank memos are the failure mode; mitigated by
  the review chip being editable and the "never invent a debt" default (§8.4).
- **Cross-mailbox settle-up dedup** is the §24 problem doubled across two
  people's mailboxes; v1 surfaces the candidate at review rather than
  auto-reconciling (Q10).
- **Statement-due parsing** ("đến hạn 15/09 · X đ") depends on capturing the
  monthly statement email, a distinct shape from per-transaction alerts —
  learnable but unverified.
- **Space-table extension vs locked decision #5.** #5 protects *family* tables
  from *personal* changes; the split model extends *space* tables for a *shared*
  feature — consistent in spirit, but it is the first such extension and should
  be reviewed as one.
- **Friend/trip spaces are a prerequisite** and currently unbuilt.

## 13. Decision log

Every settled decision from the design interview, for traceability.

| # | Decision |
|---|---|
| Q1 | One primitive — a counterparty balance; bank and person are both parties. Unify at the view layer. |
| Q2 | Scope: credit cards + peer/space IOUs. Defer amortizing loans. |
| Q3/Q6 | Liabilities are personal, always; family tables untouched; payer's overpayment is a receivable, not spend. |
| Q4 | People/space receivables **are** in v1 (via spaces); 1:1 cash-front deferred beyond the IOU record. |
| Q5 | Card balance **derived** (payment-method attribute + SUM), not double-entry rows. |
| Q7 | Splits are members-only in v1; ghost participants deferred. |
| Q8a | Card payment auto-applied from captured mail (transfer). |
| Q8b | Friend settle-up = directed member→member transfer via the review modal; manual cash. |
| Q9 | Split rules: equal + exact-amount. |
| Q10 | Cross-mailbox settle-up: assisted match at review; first leg authors, second reconciles. |
| Q11 | Settle-ups unilateral / trust-based (no dual-confirm). |
| Q12 | Surface = a card in the Tài Chính tab; debt out of "Còn lại"; daily-guide heads-up for looming payments. |
| Q13 | Allow one-sided personal IOU (name-only counterparty). |
| Q14 | Manual entry first-class via the existing expense modal (account picker + "chia nhóm"). |
| Q15 | Accounts auto-materialize from capture, editable; default "Tiền mặt". |
| Q16 | Ambiguous instrument → default deposit/expense (never invent a debt). |
| Q17 | `account_kind` learned in template static, correctable at review (`human_verified`); no setup step. |
| Q18 | Zoom-out shows two totals (Tôi nợ / Được nợ), grouped institutional vs social. |
| Q19 | Card zoom-in shows line items (purchases re-cut by card). |

## 14. Related

- `docs/specs/effortless-transaction-logging-spec.md` — the capture pipeline
  this rides on (classifier §16, transports §5, internal-transfer gap §24).
- `docs/features/personal-ledger.md` — Model Y storage philosophy, the mirror
  engine, `kind='transfer'` schema-readiness, locked decisions.
- `research/jtbd-individual-finance.md` — JTBD 3 Fairness, JTBD 4 Planning.
- `docs/features/encryption.md`, `docs/features/key-card-auth.md` — the crypto
  personal + space E2EE reuse.
