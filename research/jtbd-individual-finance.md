# JTBD Research — Individual Finance inside a Family App

**Date:** 2026-08-15
**Framework:** Ulwick Outcome-Driven Innovation (ODI)
**Status:** Draft for team discussion

---

## The interview finding

Across interviews with real users, one pattern kept repeating: **for every member, family finance is only a part of their individual finance.** If the app only covers the family's shared money, each member still needs a second app (MoneyLover, banking app, notes) to manage their personal money.

This is the classic "sub-job trap": we built for the *family's* job, but the person who hires the app is the *individual member*. Their core functional job is:

> **"Manage my personal money so that both my own needs and my family's obligations are met."**

Family finance is one sub-job inside that. As long as Earthy only serves the sub-job, it will always be the second app on the phone — and the app that owns daily capture owns the habit.

---

## JTBD 1 — Capture: "Record where my money goes, whether it's mine or the family's"

The keystone job. Whoever owns the moment of spending owns the user.

**Desired outcomes:**
- Minimize the **time it takes to record a transaction** at the moment of spending.
- Minimize the **number of transactions left unrecorded** by month-end.
- Minimize the **effort required to classify** a transaction as personal vs. family.

**Approaches:**
1. **Unified capture with a personal/family scope toggle** — one entry flow, one habit; the app remembers the last scope per category so classification is usually zero-tap.
2. **Screenshot / statement import** — OCR + dedupe of bank-app screenshots, which is how Vietnamese users actually reconcile.
3. **Fast-entry affordances** — recents, templates, recurring transactions (rent, school fees) that post themselves.
4. **End-of-day sweep** — a gentle nudge listing likely-missed spend ("hôm nay có chi gì thêm không?"), fixing the completeness outcome rather than the speed outcome.

---

## JTBD 2 — Privacy: "Contribute to family transparency without exposing my whole financial life"

The emotional/social job the interviews really point at — and where Earthy has an unfair advantage: per-entry E2EE already exists in the architecture.

**Desired outcomes:**
- Minimize the **likelihood that other members see transactions** the user considers private.
- Increase the **certainty that one's contributions to the family are visible and recognized**.
- Minimize the **effort required to keep two "books"** (today's workaround: two apps).

**Approaches:**
1. **Per-entry visibility scope on top of existing E2EE** — "private" entries encrypted to the member's own key only; structurally impossible for others to read. No competitor tells this story.
2. **Aggregate-only sharing** — family sees "Bố đã góp 3,2tr tháng này," never the line items; transparency of contribution without transparency of consumption.
3. **A first-class personal space (tab)** — same categories and wallets, separate ledger; mental model is "one app, two pockets."
4. **Role-aware privacy defaults** — couples default to shared, teen members default to private, adjustable per family.

---

## JTBD 3 — Fairness: "Ensure shared costs actually get shared"

Between capture and budgeting sits the job that causes the most family friction.

**Desired outcomes:**
- Minimize the **time it takes to determine who owes whom** for shared expenses.
- Increase the **likelihood that money advanced for the family gets reimbursed**.
- Minimize the **number of disagreements about whether contributions are fair**.

**Approaches:**
1. **Payer field + running per-member balance** — the minimal version; every family expense records who fronted it.
2. **Family fund (quỹ chung)** with a contribution plan and top-up reminders — matches how Vietnamese households actually operate more than Splitwise-style splitting does.
3. **Split rules** — equal, income-weighted, or per-category custom (e.g., school fees 50/50, groceries by ratio).
4. **Settle-up flow** — one action that records the transfer and zeroes balances, closing the loop instead of leaving debts ambient.

---

## JTBD 4 — Planning: "Know whether I can afford things — this month and for what's ahead"

**Desired outcomes:**
- Minimize the **time it takes to know month-to-date spend vs. normal**, for both pockets.
- Increase the **likelihood of noticing overspending before month-end**, not after.
- Increase the **likelihood of reaching savings goals** (personal and family).

**Approaches:**
1. **Envelope budgets with soft alerts** — per category, personal and family separately.
2. **Monthly cash-flow summary** — in vs. out with the personal/family split visible, delivered as a digest rather than a dashboard you must remember to visit.
3. **Goals tied to moments** — shared goals (du lịch hè, học phí) and private goals, where hitting a milestone creates a family moment. The one approach nobody else can copy, because no other finance app has a moments layer.
4. **Multi-wallet balances** — cash, bank, e-wallet — so "can I afford this" has an answer, not just "what did I spend."

---

## Recommended sequencing

Don't build all four. Build **JTBD 1 + 2 together as one release** (unified capture with a private, self-encrypted scope). That single change removes the *reason* the second app exists. JTBD 3 and 4 are retention features that only matter once capture lives in Earthy. Fairness (JTBD 3) likely beats budgeting (JTBD 4) for a family app — but that call should come from users, not intuition.

## Next step — opportunity scoring

Before committing, take the ~12 outcome statements above back to interviewees and score each on **importance** and **current satisfaction**, then rank by opportunity score:

> Opportunity = Importance + max(Importance − Satisfaction, 0)

Working hypothesis: the privacy outcomes in JTBD 2 will score as the most underserved — no mainstream app serves "shared transparency + individual privacy" as one product. The scoring should tell us whether capture speed or fairness is the second bet.
