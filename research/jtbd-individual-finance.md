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

## The recommended model, explained

The model is three separate answers to three separate questions. The pocket model tries to answer all three with one structure — containers inside containers — which is why it strains.

1. **What IS a transaction?** (data model)
2. **Where do I GO in the app?** (navigation)
3. **What do I SEE first?** (the Finance tab)

### 1. Data: a transaction is one row with two independent dimensions

Every transaction records:

- **Source** — which of *my* wallets the money physically left (cash, VCB, MoMo). Always personal. Money only ever moves between real accounts owned by real individuals.
- **Scope** — who the spending *belongs to*: `personal`, `gia đình`, or `Đà Lạt 3/2026`. A label, not a place.

Key property: **one purchase = one row, never two.** When Minh pays 1.2M for a family dinner, there is no "family transaction" plus a "personal transaction." There is one row: source = Minh's VCB account, scope = gia đình. That single row simultaneously means "1.2M left Minh's money this month" *and* "the family spent 1.2M on ăn uống" *and* "Minh has advanced 1.2M toward shared costs." Three meanings, one fact. The pocket model forces a choice of *which container the transaction lives in* — and whichever is picked, the other views go stale or need syncing.

E2EE falls out naturally: **scope = encryption audience.** Personal scope → encrypted to the member's own key. Family scope → family key. A trip space gets its own key when created. The privacy model and the data model are the same field.

### 2. Navigation: scopes that involve other people appear as spaces

A scope with members is presented as a **space** — and a space looks and behaves like a group chat: it has people, a timeline of activity (expenses *and* moments, interleaved), its own fairness math, and its own settings.

- **Personal** — your private space: your stream, filtered to scope = personal.
- **Gia đình** — permanent space. Today's FamilyHub, unchanged in spirit: moments, expenses, the family fund.
- **Đà Lạt 3/2026** — a temporary space with friends. Same anatomy as the family space, but with a lifecycle: created for an occasion, alive while the occasion lives, and after settle-up it **archives** — the debts zero out, and what remains is the photos, the moments, the record of the trip. It literally turns into a memory.

Crucially, a space doesn't *contain* transactions the way a folder contains files. A space is a **shared lens** over the members' streams: it shows every transaction whose scope points to it. The Gmail-labels idea wearing a group-chat costume — users get the social "this is our place" feeling, while underneath nothing is duplicated or moved.

### 3. The Finance tab: my money on top, my obligations below, never mixed

```
MY MONEY                          ← real, spendable
  Wallets: Cash 850k · VCB 12.4M · MoMo 1.1M
  Tháng này: chi 8.2M / thường lệ 7.5M

MY CIRCLES                        ← derived, not spendable
  Gia đình        bạn đã góp 3.2M tháng này
  Đà Lạt 3/2026   nhóm nợ bạn 400k        [Settle up]
  Quỹ team        đến hạn góp 200k
```

The top block answers JTBD 4 ("can I afford this?") with **real balances only**. The bottom block shows each circle with its **derived number** — contributed, owed — visually and semantically separated from money. Tapping a circle opens its space. The user never wonders "is this number cash or an IOU?" because the layout itself is the answer. That ambiguity is Splitwise's biggest usability wound, and the pocket model would import it.

### End-to-end scenario

Minh is on the Đà Lạt trip and pays 2M for the villa deposit:

1. **Capture (JTBD 1):** quick-add, 2M. The scope selector suggests "Đà Lạt 3/2026" because Minh is in that space's active window. One extra tap at most. Source defaults to his usual wallet.
2. **Privacy (JTBD 2):** that evening he buys a gift for his partner — scope = personal. Same stream, encrypted to his key alone. Trip friends and family structurally cannot see it. One app, one habit, two audiences.
3. **Fairness (JTBD 3):** in the Đà Lạt space the villa expense shows "Minh đã ứng 2M"; the space's balance updates for all five members. After the trip: settle-up, two transfers recorded, balances zero, space archives into a memory with its photos.
4. **Planning (JTBD 4):** Minh's Finance tab shows the full 2M in his month's outflow immediately (it is his real cash until reimbursed), and "nhóm nợ bạn 1.6M" as a derived line — the "can I afford things" picture stays honest mid-trip.

### Why this beats the pocket model

- **No double entry** — a shared expense is one row seen through many lenses, not a copy in each pocket.
- **No money/IOU confusion** — real balances and derived obligations never share a container or a visual block.
- **Friend finance gets a lifecycle** — occasions open and close; labels are cheap to create and archive, containers aren't.
- **Family stays special** — the one permanent space with the deepest moments history, not one pocket among peers.
- **E2EE for free** — scope and encryption audience are the same concept, already supported per-entry by the architecture.

---

# Part 3 — The user's finance mental model (what a complete picture contains)

Before deciding what to build, it's worth mapping how an ordinary person (mass-market, Vietnamese context) actually holds their finances in their head — because Part 1's four jobs all serve *that* picture, and if we miss parts of it, Earthy stays the second app.

## The folk model, not the accountant's model

In the ordinary person's head there is no balance sheet. There is one nagging question — **"how much can I actually spend right now without getting into trouble?"** — and a set of mental shelves arranged around it. People do **not** chunk money by merchant category (food / transport / shopping — that is an app imposition). They chunk it by **purpose and how free it is**, and each shelf carries a *feeling*, not just a figure (bills = dread, savings = pride, debt = pressure, daily spend = guilt, vàng = safety). The folk model is emotional before it is numerical.

## First pass — parts by time-horizon

- **Money now (the pocket)** — "còn nhiêu đây": cash + bank + e-wallet blurred into one spendable pool.
- **Money in motion this month (the flow)** — what's coming in (income, felt as a rhythm/event), what's already promised out (bills, trả góp — spent in spirit the moment earned), and what leaks daily (ăn uống, cà phê — the fuzzy, uncounted part).
- **Money parked (the shelves)** — purposeful savings (a jar with a name: cưới, xe, du lịch), the just-in-case buffer (phòng thân), and stored wealth (vàng, đất, sổ tiết kiệm, đầu tư — a "don't touch" shelf).
- **Money between people (the social ledger)** — owed and owing (nợ, mượn, "trả sau", hụi), and "ours not mine" (quỹ gia đình, tiền chung nhóm).

## Second pass — the parts we almost missed

These share a trait: they are irregular, socially tangled, or only *half* real — which is exactly why people keep them in their head or a Notes app, and why a first enumeration skips them.

- **Calendar-shaped, not salary-shaped** — big seasonal lumps (Tết, đầu năm học, bảo hiểm năm, giỗ) that are neither monthly bills nor aspirational savings; and the split between reliable base income (lương cứng) and variable income (thưởng / tăng ca / tay trái), which people budget very differently.
- **Socially entangled** — reciprocal "có đi có lại" money (mừng cưới, phúng điếu, lì xì — a give-now-with-a-memory ledger, not a formal debt); money sent to family / dependents (biếu bố mẹ, lo cho con — duty money, often paid first); and custodian float (ôm hụi, thủ quỹ, cầm giùm — sits in your account but isn't yours).
- **Almost-real** — borrowing capacity used as a cushion ("hết tiền nhưng còn thẻ", trả sau); pending income (invoice chưa trả, lương bị nợ); and semi-liquid things you could sell or pawn (cầm xe, bán đồ).

## The MECE problem — these parts are not a clean partition

The time-horizon groups above are **not MECE**, and neither are the irregular parts a tidy fifth sibling. The reason: the first list secretly mixed two different cuts — "now / this-month / parked" is a **liquidity** axis, while "between people" is an **ownership** axis. Stacking a time axis and an ownership axis as if they were one list guarantees overlap.

A person's finance picture is really a **multi-axis space**; any single part is a *point* located by several independent coordinates:

1. **Liquidity** — trong tay → tháng này → cất giữ → khoá chặt
2. **Freedom** — tự do tiêu ↔ đã có chủ
3. **Ownership** — của mình ↔ của chung ↔ của người khác (giữ hộ) ↔ nợ qua lại
4. **Certainty** — tiền thật ↔ trông chờ ↔ tiềm năng
5. **Timing** — đều đặn ↔ theo mùa ↔ một lần

The irregular parts only *feel* like new categories because they take unusual values on axes 3–5. Proof of non-exclusivity: **tiền giữ hộ** is the same money that reads as "in hand" by liquidity but "someone else's" by ownership — one amount, two groups. **Tiền gửi về nhà** is a committed monthly outflow *and* socially directed at once.

**Resolution:** MECE only exists *within a single axis*. Pick one axis as the **spine** (partition once, no overlap) and demote the rest to **tags**. This is the same reason the "pocket" folder model fails (Part 2): a folder forces one home, but reality needs a part to hold coordinates on several axes at once — which is exactly what "one transaction row with independent facets (source · scope · …)" delivers.

## The master table — a complete individual finance picture

Spine = the **role** the money plays (each part filed once by its primary role); other axes compressed into a coordinates column as tags; the "safe to spend" number kept as a derived footer, not a row.

| Vai trò | Phần | Người ta gọi / nghĩ | Toạ độ (sở hữu · nhịp · độ thật) | Với "tiêu được" | Cảm giác |
|---|---|---|---|---|---|
| **1. Có sẵn** | Tiền trong tay | "Còn nhiêu đây" — mặt + bank + ví gộp | của mình · tức thời · thật | ➕ Nền của phép tính | Trung tính |
| **2. Đã bị trừ trước** | Hoá đơn & chi phí cố định | Nhà, điện nước, internet, thuê bao | của mình · hàng tháng · thật | ➖ Trừ thẳng | Lo, "không được thiếu" |
| | Trả góp / nợ định kỳ | Trả góp xe, thẻ tín dụng, khoản vay | mình → chủ nợ · hàng tháng · thật | ➖ Trừ thẳng | Áp lực |
| | Gửi về nhà / người phụ thuộc | Biếu bố mẹ, lo cho con | của mình · hàng tháng · thật | ➖ Trừ trước tiên | Bổn phận, thương |
| | Khoản lớn theo mùa | Tết, đầu năm học, bảo hiểm, giỗ | của mình · **theo mùa** · thật | ➖ Nên trích trước mỗi tháng | Lo xa, hay hụt |
| **3. Tiêu vào đời sống** | Chi tiêu hằng ngày | Ăn uống, cà phê, chi vặt | của mình · liên tục · thật | ➖ Chính là phần được tiêu (nhưng **mờ**) | Áy náy, rò rỉ |
| | Hiếu hỉ / quan hệ | Mừng cưới, lì xì, phúng điếu, quà | **có đi có lại** · theo dịp · thật | ➖ Bất thường, có nợ ngầm | Nghĩa tình |
| **4. Để dành & tích luỹ** | Tiết kiệm có mục tiêu | Hũ có tên: cưới, xe, du lịch | của mình · để dành · thật | ⏸ Không tính (đã hẹn chỗ) | Tự hào, kỳ vọng |
| | Phòng thân | "Để đó lỡ có chuyện" | của mình · dự trữ · thật | ⏸ Chỉ khi khẩn | An toàn |
| | Tài sản cất giữ | Vàng, đất, sổ tiết kiệm, đầu tư | của mình · dài hạn · thật | ⏸ Khó rút, không tính | An tâm dài hạn |
| **5. Giữa người với người** | Người ta nợ mình | Cho mượn, ứng hộ, phần hụi của mình | mình cho vay · đến hẹn · thật | ➕ khi đòi được (**ẩn số**) | Chờ đợi |
| | Của chung / quỹ | Tiền chung nhà, quỹ nhóm | **của chung** · tuỳ · thật | ⏸ Không tự quyết | Trách nhiệm chung |
| | Tiền giữ hộ | Ôm hụi, thủ quỹ, cầm giùm | **của người khác** · tạm · thật | ⛔ Không phải của mình (dễ nhầm là ➕) | Trách nhiệm |
| **6. Chưa về / nửa thật** | Thu nhập sắp về | Lương — **cứng** vs thưởng/tay trái | của mình · theo kỳ · sắp thật | ➕ khi về (chỉ tính phần cứng) | Mong chờ |
| | Tiền chờ về | Invoice chưa trả, lương bị nợ | của mình · bấp bênh · **trông chờ** | ❔ Ẩn số | Trông đợi / bực |
| | Khả năng vay | Còn thẻ, trả sau, vay được | nợ **tiềm năng** · khi cần · chưa thật | ⚠️ Đệm giả — bản chất là nợ | Yên tâm giả |
| | Bán / cầm được | Cầm xe, bán đồ | mình → thanh khoản · khi bí · tiềm năng | ⚠️ Phương án chót | Lối thoát cuối |

**The number in the middle is derived from the parts, not a part itself:**

> **Tiêu được (an tâm) = (Tiền trong tay + phần lương chắc chắn sắp về) − (hoá đơn cố định + trả góp/nợ + gửi về nhà + phần trích cho khoản theo mùa) − (đã dành cho tiết kiệm & phòng thân)**
> …**loại trừ** tiền giữ hộ và của chung, và **không tựa vào** khả năng vay.

## What this means for Earthy

- **Role 5 (giữa người với người) is the seam to the family/group layer.** "Của chung", "nợ qua lại", "giữ hộ" are exactly the parts the scope + spaces model (Part 2) has to carry — where the individual picture touches the collective one.
- **Roles 2, 3, and 6 are where budgets break** — seasonal lumps and hiếu hỉ because they're irregular, daily spend because it's fuzzy, borrowing capacity because it feels like safety. An app that nails only Roles 1–2 is still the second app.
- **The culturally-specific rows are hypotheses, not findings.** Gửi về nhà, hiếu hỉ, giữ hộ, hụi come from cultural pattern, not from our transcripts — validate against the interviews before treating any as a "needed" part for Earthy's users.

---

# Next steps

1. **Opportunity scoring (Part 1).** Take the ~12 outcome statements back to interviewees; score importance and current satisfaction; rank by:
   > Opportunity = Importance + max(Importance − Satisfaction, 0)
   Working hypothesis: the privacy outcomes in JTBD 2 score as most underserved — no mainstream app serves "shared transparency + individual privacy" as one product.
2. **Language check (Part 2).** Re-read transcripts: when people described money with friends, did they name the *group* or the *occasion*? That word choice is the naturalness test for pocket-vs-space.
3. **Concept test (Part 2).** Two clickable IAs — pocket model vs. spaces model — 30 minutes with 5 users, before committing to the restructure.
4. **Mental-model validation (Part 3).** Check the master table against the transcripts: which of the 17 parts did interviewees actually name, and did any culturally-specific ones (gửi về nhà, hiếu hỉ, giữ hộ, hụi) show up unprompted? Mark each part as confirmed / hypothesis / absent before it drives scope.
