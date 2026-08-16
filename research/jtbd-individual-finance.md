# JTBD Research — Individual & Group Finance in Earthy

**Date:** 2026-08-15, updated 2026-08-16
**Framework:** Ulwick Outcome-Driven Innovation (ODI)
**Status:** Draft for team discussion

---

## Finding 1 — Family finance is a subset of individual finance

Across interviews with real users, one pattern kept repeating: **for every member, family finance is only a part of their individual finance.** If the app only covers the family's shared money, each member still needs a second app (MoneyLover, banking app, notes) to manage their personal money.

This is the classic "sub-job trap": we built for the *family's* job, but the person who hires the app is the *individual member*. Their core functional job is:

> **"Manage my personal money so that both my own needs and my family's obligations are met."**

Family finance is one sub-job inside that. As long as Earthy only serves the sub-job, it will always be the second app on the phone — and the app that owns daily capture owns the habit.

## Finding 2 — Financial circles extend beyond the family

A second pattern: users also have financial engagement with **friend groups, teammates, and colleagues** — trip funds, shared dinners, group gifts, team funds, hụi rounds. "Complete" means covering these circles too.

Key observation about their nature: family finance is **continuous**; friend/colleague finance is mostly **episodic** — it belongs to an occasion (a trip, an event, a round) with a beginning and an end. People name the *occasion* ("chuyến Đà Lạt"), not a permanent group account. Any structure we choose must respect that difference in lifespan.

---

# Part 1 — The four JTBDs (individual finance)

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

## JTBD 3 — Fairness: "Ensure shared costs actually get shared"

Between capture and budgeting sits the job that causes the most family friction. Finding 2 widens this job: fairness math is the *primary* job in friend/colleague circles.

**Desired outcomes:**
- Minimize the **time it takes to determine who owes whom** for shared expenses.
- Increase the **likelihood that money advanced for the group gets reimbursed**.
- Minimize the **number of disagreements about whether contributions are fair**.

**Approaches:**
1. **Payer field + running per-member balance** — the minimal version; every shared expense records who fronted it.
2. **Group fund (quỹ chung)** with a contribution plan and top-up reminders — matches how Vietnamese households and teams actually operate more than Splitwise-style splitting does.
3. **Split rules** — equal, income-weighted, or per-category custom (e.g., school fees 50/50, groceries by ratio).
4. **Settle-up flow** — one action that records the transfer and zeroes balances, closing the loop instead of leaving debts ambient.

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

# Part 2 — Mental model: how should the structure feel?

## The proposed model: "Finance tab → main pocket → sub-pockets"

Proposal on the table: open a "Finance" tab showing the main pocket (serving the 4 JTBDs), containing sub-pockets — personal pocket, family pockets, friend pockets…

**What's natural in it:** the individual at the top. That is exactly what Finding 1 says — the person is the superset, the groups are contexts. A Finance tab that opens on *my* full picture is the correct center of gravity.

**What's not natural: "pocket" as the organizing container.**

1. **A pocket implies money sitting inside it.** But a "family pocket" or "friend pocket" mostly doesn't hold money — it holds *arrangements*: who paid, who owes, what we're saving for. The actual money sits in my bank account, my cash, my e-wallet. A number shown on a "friend pocket" is ambiguous: real money, or a net IOU balance? This is the exact confusion Splitwise users report, and it worsens when pockets of both kinds sit side by side as siblings.
2. **Friend finance isn't a persistent container** (Finding 2). A permanent "friend pocket" doesn't match how people think — they think in occasions, not ongoing pockets.
3. **Product-identity risk:** an umbrella Finance tab where "family" is just one sub-pocket demotes the emotional core of Earthy to a peer of "colleagues."

## Four alternative models

### Model 1 — Me + Circles (relationship-centric, hub-and-spoke)
The Finance tab *is* my personal ledger and net position — the full picture. Family, trip groups, and colleague funds are **circles I'm a member of**, not containers inside my money. Each circle is a shared ledger with its own fairness math; my tab shows "across all circles, people owe me 400k / I owe 1.2M" as a *derived* line, clearly separate from real balances. This is the pocket model with one correction: **money and obligations never share a container.**

### Model 2 — One stream + scopes (capture-first, like Gmail labels)
There is only one transaction diary. Every entry gets a scope — personal, family, "Đà Lạt 3/2026" — and every "pocket" is just a filtered view of the same stream. Nothing lives in two places, capture is a single habit (strongest possible fit for JTBD 1), and creating a new group costs nothing: it's a label, not a place. Weakness: shared visibility per scope needs explaining, since a view doesn't *feel* like a place you invite people to.

### Model 3 — Spaces (context-first, like group chats)
Each social unit is a space — Gia đình, Bạn ĐH, Team — and each space contains both its **moments and its money**. "Personal" is simply your private space. Deeply natural in Vietnam: people already run their social-financial life through Zalo groups; this formalizes an existing habit. It is also the only model where finance and Earthy's moments layer live in the same container — our unfair advantage. Cost: the full-picture view (JTBD 4) becomes a cross-space aggregation that must be built deliberately, not the default screen.

### Model 4 — Jars by purpose (goal-centric, "quỹ" thinking)
Organize by what money is *for* — chi tiêu hằng ngày, hóa đơn, quỹ du lịch, quỹ học phí — and attach people to jars (a jar shared with family, a jar shared with trip friends). Matches the Vietnamese "quỹ chung" instinct and is the strongest model for planning and saving. But weak for fairness (split/settle doesn't map to jars) and capture-classification gets harder — treat it as a layer, not the skeleton.

## Recommendation — hybrid of 2 + 3, viewed through 1

- **Data model = one stream with scopes** (Model 2): capture stays one habit; nothing is double-entered.
- **Navigation model = spaces** (Model 3): matches Zalo-group habits; moments and money share a home.
- **Finance tab presented hub-and-spoke** (Model 1): my real balances and cash flow on top, my circles below, with "net owed across circles" as its own clearly-labeled derived line.
- **Friend spaces are event-scoped and archivable** — a trip space closes after settle-up. The family space is permanent. This lifespan difference is the deepest structural truth the interviews surfaced.

---

# Next steps

1. **Opportunity scoring (Part 1).** Take the ~12 outcome statements back to interviewees; score importance and current satisfaction; rank by:
   > Opportunity = Importance + max(Importance − Satisfaction, 0)
   Working hypothesis: the privacy outcomes in JTBD 2 score as most underserved — no mainstream app serves "shared transparency + individual privacy" as one product.
2. **Language check (Part 2).** Re-read transcripts: when people described money with friends, did they name the *group* or the *occasion*? That word choice is the naturalness test for pocket-vs-space.
3. **Concept test (Part 2).** Two clickable IAs — pocket model vs. spaces model — 30 minutes with 5 users, before committing to the restructure.
