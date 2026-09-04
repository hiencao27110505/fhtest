# Transaction Review Screen ("Duyệt giao dịch")

The human gate between passively-captured bank-email transactions and the real
ledger. A bank emails you about a purchase, the pipeline extracts and stages it,
and this screen is where a person looks at each row and decides: import it (and
where — the family ledger or their private personal ledger), fix it, set it
aside, or throw it away. Nothing a machine captured reaches a family's financial
history without passing through here.

> **Status, 2026-08-29.** Live. Reachable from both the Family finance widget and
> the Cá nhân (Personal) tab. Sealed staging ON; per-row Family/Personal
> destination routing shipped; on-device duplicate override, category cascade,
> bulk tools, and per-source standing routes all shipped. This document is the
> first written spec for the screen — reconstructed from the live code, not a
> forward-looking design.

> **Update, 2026-09-04 (sw v466).** The card detail was redesigned from a chip
> workbench to a **settings-rows** card (compact label/value rows that open
> picker sheets) — see [§4a](#4a-card-detail-the-settings-rows-redesign-2026-09).
> The collapsed card became **amount-anchored** (the amount is the hero, the raw
> bank memo demoted), and the **amount** is now a top input field above the note
> in the expanded card. Three correctness fixes shipped alongside: VND
> currency-synonym normalization (a "đ"/"VNĐ" row no longer misreads as foreign),
> a blocking (amber) vs optional (grey) split for unfilled rows, and
> self-transfer classification ("X chuyển tiền đến X" → internal transfer, not
> card payment).

> **Audience & layering.** Part 1 (Behaviour) is for everyone — product, design,
> QA, onboarding. Part 2 (Technical Appendix) is for engineers maintaining or
> extending the screen. The [Family vs Personal](#family-vs-personal-at-a-glance)
> table is the one-glance summary of how the two tabs differ.

> **This is not a new screen.** The review queue *is* the CSV-import review
> engine, reused wholesale (`src/js-data/72-txn-review.js:1-19`). It hands the
> engine rows shaped like a parsed CSV and turns on `csvStagedMode`; everything
> downstream — merchant grouping, the category cascade, duplicate detection, the
> promote-to-ledger path — is the same code the "Import from file" flow runs. So
> most of this spec is really a spec of that shared engine, seen through the
> bank-email entry point.

---

## Part 1 — Behaviour

### 1. Problem & Why

FamilyHub had two ways money reached the ledger and both are acts of bookkeeping:
type an expense, or export-and-import a CSV. Bookkeeping is the thing people stop
doing in week three. The bank-email pipeline removes the typing — a forwarded or
directly-read bank email becomes a staged transaction with no user action. But
extraction is LLM-assisted and Vietnamese bank formats vary enough that silently
writing those amounts into a family's history would be reckless.

So the trust posture is the same as CSV import: **automated writers stage, humans
commit.** This screen is that commit step. Its whole reason to exist is one thing
a machine cannot supply — *what the money was for*. A pipeline can get amount,
date and counterparty right and still not know that "NGUYEN THU TRANG chuyen
tien" was lunch with your mum. Pre-filling the description is help, never a
substitute for the human (`src/js-data/72-txn-review.js:16-19`).

Two consequences follow, and both drive the design below:

- **Every row is reviewed; nothing auto-imports.** There is no scheduled job that
  moves a staged row into the ledger. A person taps Import.
- **A missed duplicate costs one tap; a false one hides real money.** The screen
  is deliberately biased toward *showing* a row and letting the person dismiss it,
  over *hiding* a row on a machine's guess. This principle recurs everywhere —
  duplicate handling, retirement, locked rows.

### 2. Where the screen lives (entry points)

The same queue is reachable from two places, with one difference — the default
destination for imported rows.

| | **Family** entry | **Personal** entry |
|---|---|---|
| Surface | Widget A cashflow, "Khoản thu chi từ email" row | Cá nhân tab, same-labelled row in the cf-cta list |
| Renderer | `renderCashflowEmailCta()` (`src/js-ui/20-budget.js:502`) | inline in `renderPersonal()` (`src/js-ui/21-personal.js:108`) |
| Opens with | `fhEmailTxnCta()` — no preset | `fhEmailTxnCta({scope:'personal'})` |
| Effect | queue opens with the remembered default destination | queue opens **pre-scoped to Personal** ("these are mine") |
| Badge | pending count from `window.fhStagedCount` | **same** global count |

Both entries route through one function, `fhEmailTxnCta(preset)`
(`src/js-data/72-txn-review.js:155`), which:

1. Applies the preset scope first (Personal entry → default new rows to the
   personal ledger), silently ignored if the personal ledger is locked.
2. Checks in parallel whether **either** transport is set up — a forwarding alias
   (`fhMailboxState`) **or** an OAuth/direct-read grant (`fhAutoTxnConnection`).
3. If either is set up → opens the review queue (`fhTxnReviewSheet`). If neither
   → opens the setup chooser (Connect Gmail / Forward your email).

Checking *both* transports matters: someone connected by OAuth has no forwarding
alias, and an earlier version that asked only about the alias sent them back to
"paste a filter into Gmail" while their mail was already arriving
(`src/js-data/72-txn-review.js:164-174`).

> **Known copy gap.** The Family CTA is bilingual (VN/EN via `L()`); the
> Personal-tab CTA label is Vietnamese-only. Cosmetic, worth aligning.

> **The badge is global, not per-scope.** Both entries show the same
> `fhStagedCount` — the *total* pending rows for this member — regardless of which
> ledger a row is destined for. The Personal-tab badge does not filter to
> personal-scoped rows. Intended today; noted so it isn't read as a bug.

### 3. Anatomy of the review screen

The screen is a dense list of cards, one per staged transaction, in a single
modal titled **"Duyệt giao dịch" / "Review transactions"**. Tapping a card
unfolds its editor in place (an accordion; one card open at a time). Rows are
organised not by arrival order but by **what they need from you**, top to bottom:

1. **Cần bạn xem ("Needs a look")** — rows that genuinely cannot go in as-is:
   missing a date, missing an amount, or missing a category to file them under.
   These carry an amber accent. Merchant groups needing one category tap live
   here too, collapsed as a single card ("Highlands · 3 items").
2. **Tụi mình để riêng ("Set aside")** — rows *decided for you, reversibly*:
   possible duplicates, and money-in / card-payment rows the ledger won't record
   as spending. Each still offers a one-tap way back in.
3. **Tiền vào ("Money in") / trả nợ thẻ ("card payments")** — a single quiet,
   collapsible line, not a stack of cards. The ledger records expenses only, so
   income and credit-card repayments are summarised and held out, with per-row
   "It's spending, import it" for a misclassification.
4. **Ready list** — everything the screen resolved, grouped by date (newest
   first). No red accent. A guessed category (catch-all fallback or a habit
   pattern) still renders up in "Needs a look" so it gets a glance, even though it
   *would* import — confidence decides where a row shows, never whether it
   imports (`src/js-ui/56-csv-import-ui.js:1080-1093`).

Above the list sits a **tools header** (bulk selection, category, destination,
delete) that appears the moment you start selecting; below the list, the Import
button in the nav is always visible, greyed until at least one row is selected,
and labelled with the live count ("Nhập 12").

### 4. What you can do to a row

Every card can be **ticked** (include in this import — all rows arrive ticked),
**tapped** (unfold the editor), or **removed** (✕, arm-then-confirm).

Inside the editor (the bullets below are the field *semantics*; for the current
staged-card *presentation* — amount as a top input, the rest as rows that open
picker sheets — see [§4a](#4a-card-detail-the-settings-rows-redesign-2026-09)):

- **Chi cho gì? / What for?** — the description. This is the field the whole
  screen exists for. A person-to-person transfer is deliberately left blank rather
  than pre-filled with the recipient's name, because a wrong pre-filled answer
  gets accepted, whereas a blank invites the one thing only the human knows
  (`src/js-data/72-txn-review.js:262-291`).
- **Category** — a tappable chip row, pre-selected with the cascade's best guess
  (see [Category cascade](#c-category-cascade)). Picking one yourself is the only
  signal strong enough to be *learned* from.
- **Số tiền / Amount** and **Khi nào / When** — editable; the date is a real date
  picker.
- **Giờ / Time** — carried from the bank email's real timestamp, shown so it can
  be verified, corrected, or cleared (empty = day-only).
- **Ghi vào đâu? / Where does this go?** — the per-row destination toggle:
  **🏡 Gia đình (Family)** or **🔒 Cá nhân (Personal)**. See §5.
- **Ai trả / Who paid** — a member chip row (family destination only; a private
  row has no member split).

Row-level verbs, and what each means for the queue:

| Action | Meaning | Row's fate in the queue |
|---|---|---|
| Leave ticked + Import | "Yes, file this" | Written to the chosen ledger, then **retired** (deleted server-side) |
| Untick | "Not this time" | **Kept** — still in the queue tomorrow. Not a dismissal |
| ✕ (remove) | "This is not a transaction I want" | **Retired immediately** — gone for good |
| Skip a duplicate ("Bỏ qua") | "Yes, this is the same purchase twice" | Retired |
| Import a duplicate ("Vẫn nhập") | "No, they're different" | Moves into the ready list |
| Pick a category on a group | resolves the whole merchant group | Group's rows move into ready |

The untick-vs-✕ distinction is load-bearing: unticking never hands a row to
retirement, so it survives; the ✕ is the only "never" (`src/js-ui/56-csv-import-ui.js:1282-1292`).

### 4a. Card detail — the settings-rows redesign (2026-09)

The staged card (only `csvStagedMode`; the file-import flow keeps its chip form)
was rebuilt so its height scales with **field count, not option count** — the old
chip workbench ran two screens tall on a card-payment row. Built by
`csvStagedRowsCard` / `csvCollapsedCard` in `src/js-ui/56-csv-import-ui.js`.

**Collapsed card — amount-anchored.** When reviewing a long queue the eye scans
the amount and whether it's classified right; the raw bank memo is noise. So the
collapsed card leads with the **amount** (the hero) beside its category, demotes
the memo to a quiet 2-line line, and carries the fixed context on two thin lines:

- **Top eyebrow:** scope **·** money source (bank · instrument) — "where it lives
  / where it came from", one style.
- **Bottom line:** the datetime led by its weekday (**"Thứ 5, 03/09"**,
  `csvWhenLine`), then the import method inline (Trực tiếp / Chuyển tiếp).
- The **checkbox** sits top-right in both collapsed and expanded states.

**Expanded card — rows + top inputs.** Tapping a card opens it in place:

- **Fixed provenance** (bank · instrument · transport) rides the header's top
  line — non-adjustable, so it's stated once, never as editable rows.
- **Số tiền / Amount** is a **top input field** above the note (FX-aware: a
  no-rate foreign row shows an amber border + "Nhập số tiền ₫" hint; a converted
  row shows a quiet "≈ $111" reference). It blur-flushes through `csvReadEditor`.
- **Ghi chú / description** is a 2-line textarea below the amount.
- Every remaining decision — scope, kind (+ its follow-up: which card / which
  account / who repaid), category, who paid, when — is a **slim label/value row**
  that opens a small **picker sheet** (`#csv-rowsheet`, an overlay inside the
  modal because the global sheet layer sits *under* it). The picked value writes
  straight onto the candidate; the changed row briefly tints.
- **Bottom CTA bar:** 🗑 delete (arm-then-confirm) · **"Áp cho N khoản giống"**
  (copy this row's decisions onto look-alikes — same bank, direction, digit-
  stripped memo) · **"Nhập khoản này"** (import just this one, via a single
  `fhPromoteStaged` borrowing the selection).

**Two "unfilled" states, deliberately different colours.** Amber (`.miss`) is
reserved for **blocking** — the one no-rate foreign amount that gates import.
Everything the row imports fine without (which card, which account, category) is
a neutral grey (`.soft`) "refine later", so a card with nothing wrong shows no
alarming rows.

**Correctness fixes shipped with the redesign:**

- **Currency-synonym normalization** (`fhCurNorm`, `src/js-data/72-txn-review.js`).
  The foreign check compared `r.currency` to `"VND"` by exact string, so a VND row
  labelled "đ"/"VNĐ"/"đồng"/"₫" was flagged foreign, had no rate to estimate, and
  rendered a nonsensical "1.000.000 đ → đ?" that *also gated import*. All
  home-currency synonyms now fold to VND before any compare.
- **Self-transfer classification** (`_isSelfTransfer`,
  `src/js-ui/57-csv-import-review.js`). "X chuyển tiền đến X" (same name both
  sides, after stripping the account-number tail) is a move between the person's
  own accounts, so it defaults to **internal transfer**, not card payment — the
  card asks "to which account", not "which card". Conservative: a name mismatch
  stays a card payment.

### 5. Destination routing — Family vs Personal (the cross-tab heart)

Every reviewed row goes to exactly one of two ledgers, and the difference is
*who else can see it*:

- **🏡 Family** → the shared `transactions` ledger. Everyone in the family sees
  it. (A personal mirror also copies it into your own book, so "family" means
  *both*, not "not mine".)
- **🔒 Personal** → your private personal ledger. The family never sees it, and
  **there is no un-share** — it is private, permanently.

Because the choice is a property of the *transaction*, not the import batch, it
lives **per row**. A lunch with the family and a private coffee can arrive in the
same email and belong in different books
(`src/js-ui/56-csv-import-ui.js:882-892`). Three layers decide a row's destination,
most-specific first:

1. **This row's own choice** (`c._scope`), if the person set it.
2. **A standing per-source route** — e.g. "always send MB Bank rows to personal."
   Set once in the tools header ("Theo nguồn"), remembered across sessions, and
   applied to later arrivals from that bank without re-picking.
3. **The remembered default** (`fh-staged-scope`) — the last destination the
   person chose, or what the entry point pre-set (Personal tab → personal).

**Safety rule:** Personal is never offered, chosen, or remembered when the
personal ledger is locked. A locked ledger always falls back to Family, so a row
can never be stranded in a book that can't be written to
(`src/js-ui/56-csv-import-ui.js:52-73`, `:892-902`). The toggle shows a "unlock on
the Cá nhân tab" note in that state.

The summary line describes the *mix* ("9 khoản vào sổ gia đình · 3 khoản riêng
tư"), checkable at a glance against the cards.

### 6. Bulk tools and standing routes

Because every row arrives ticked, the ticks double as a real selection. A tools
header (`#txh`) appears once selecting starts and offers, over the selection:

- **Select all / none.**
- **One category** across the selection (learned from, exactly like a per-row pick).
- **One destination** across the selection — sets `_scope` on selected rows only,
  and deliberately does **not** move the remembered default, so the rows nobody
  touched keep following it (`src/js-ui/56-csv-import-ui.js:1365-1382`).
- **Delete** the selection — one server call, arm-then-confirm, with the count in
  the label ("Xoá 47 khoản?") because with everything ticked by default "Xoá" and
  "Xoá 47 khoản?" are very different sentences.

**Standing per-source routes ("Theo nguồn").** In the same header you can route a
whole bank at once — "MB Bank → Personal" — and it persists (`fh-source-routes`).
Later rows from that bank default to that ledger with nobody re-picking. This is a
client-side "tự động từ giờ"; sealing to the right key at staging time is a
planned pipeline-level follow-up, deliberately not smuggled in here
(`src/js-ui/56-csv-import-ui.js:1427-1431`).

### 7. Import — what actually happens

Tapping **Nhập N** promotes the ticked rows. Order is deliberate and matters
(`src/js-data/72-txn-review.js:667-803`):

1. Compute the set of rows the person is **finished with** (imported *or* removed)
   — read *before* the ledger write consumes the ready list.
2. Split the ticked rows by destination.
3. **Write personal rows first.** If any personal write fails, stop before the
   family write and before retiring anything — a half-done batch that already
   deleted its staged rows has nothing to retry from.
4. **Write family rows.**
5. **Retire** the finished rows: remember them locally, then ask the server to
   delete them. Deleting only *after* the ledger write succeeds — duplicating a
   transaction is recoverable, losing one is not.

The ledger write itself reuses the ordinary expense-logging machinery, so an
imported bank transaction is encrypted and stored exactly like a hand-typed one.
Details in [the write paths](#e-write-paths).

### 8. Screen states & edge cases

The screen must never let a captured transaction go quietly missing. Its states
reflect that:

- **Empty** — "Chưa có giao dịch mới / Nothing to review." If rows exist but are
  all locked, the copy says so instead.
- **Partly locked** — some rows couldn't be decrypted (a locked device, a stale
  app shell, or real tampering). They are *counted and shown*, never silently
  skipped: a note says "N giao dịch chưa mở khoá được" and tells the person to
  unlock or reload (`src/js-data/72-txn-review.js:513-524`).
- **More behind the page** — the queue fetches up to 1000 rows. If the page comes
  back full, a note says "Đang hiện N giao dịch đầu tiên… mở lại để xem tiếp" —
  the old silent cap that hid the oldest rows is the bug this fixes
  (`src/js-data/72-txn-review.js:532-543`).
- **Key-mismatch freeze** — if a device detects that the family's sealing key on
  the server no longer matches the one it derived, approval is **frozen
  family-wide** until a fresh verify passes. Opening the queue re-shows the
  explanation rather than a dead screen. The family *ledger* is unaffected (it
  uses a different key). See [the alarm](#d-the-key-mismatch-alarm).
- **Offline** — family writes fall through to a durable offline outbox; personal
  writes are online-only, so a personal import effectively requires connectivity
  and will abort the batch if it fails offline.
- **Retire failed** — the ledger write already landed, so the rows are kept hidden
  locally regardless; a toast says "Đã lưu, nhưng chưa xoá được bản nháp trên máy
  chủ." The double-import guard is the local record, not the server delete.

### Family vs Personal at a glance

Everything a reader needs to know about how the two destinations differ.

| Dimension | 🏡 Family | 🔒 Personal |
|---|---|---|
| Who can see it | Whole family (shared ledger + your mirror) | Only you; no un-share |
| Table written | `transactions` | `personal_transactions` (expense) / `personal_incomes` (income) |
| Encryption key | Family session DEK | Per-**user** DEK (household can't derive it) |
| Encryption mode | off / dual / enc lifecycle | ciphertext-only, always |
| Category | FK to family `categories` (created if new) | denormalised name + emoji on the row |
| "Who paid" split | Yes (members) | No — the owner is the row |
| Income rows | Held back entirely (not imported) | Written to `personal_incomes`, day-only, no category |
| Offline | Durable outbox | Online-only |
| Default when ledger locked | Always available | Falls back to Family; never stranded |
| Which staging key opens it | Family staging key | Personal staging key (`staging_scope='personal'`) |
| Can re-route at review | — | Personal row → Family is allowed; Family row → Personal is **not** (a *committed* row can move later in either direction — `cross-ledger-move-spec.md`; the one-way rule here protects unseen sealed data only) |

The last row is the "over-sealing is recoverable, under-sealing is not" rule: a
row sealed as private can be promoted outward to the family later, but a row
sealed as family cannot be pulled back into privacy.

---

## Part 2 — Technical Appendix (engineering)

### A. The reuse architecture

The bank-email queue is not a second screen. `fhTxnReviewSheet`
(`src/js-data/72-txn-review.js:428`) fetches and decrypts staged rows, shapes them
as a synthetic CSV source (`fhStagedAsCsvSource`, `:247`), sets
`window.csvStagedMode = true`, and calls the CSV engine's own `csvBuildReview` /
`renderCsvReview`. In staged mode the engine drops file-only chrome (file picker,
"Start over", category-disclosure notices) and swaps "file" wording for "email".

Module map:

| File | Role |
|---|---|
| `src/js-data/72-txn-review.js` | Fetch staged rows, decrypt, orchestrate open/promote/retire |
| `src/js-ui/57-csv-import-review.js` | Candidate building, category cascade, bucketing, dedup rules |
| `src/js-ui/56-csv-import-ui.js` | Render, inline editors, per-row scope, bulk tools, promote |
| `src/js-data/18-staging-keys.js` | Family staging keypair, sealed-box opener, verify, alarm |
| `src/js-data/19-personal.js` | Personal staging key + personal ledger writes (Model Y) |
| `src/js-data/40-txn-writes-outbox.js` | Family ledger insert + offline outbox |
| `src/js-ui/20-budget.js`, `21-personal.js` | The two CTAs |

The single Save button is a fixed dispatcher — `csvSaveDispatch()` branches on
`csvStagedMode` (`src/js-ui/56-csv-import-ui.js:34`) — so the file-import flow can
never inherit the staged-promote handler (which deletes staged rows).

### B. Data model — `email_transactions`

Staged rows live in `email_transactions`, `review_status = 'pending'`. The
lifecycle is one-directional: **pending → (promote via `addExpense()` OR reject) →
row physically DELETED**. `'approved'`/`'rejected'` exist in the CHECK constraint
but are unreachable; `promoted_transaction_id` is a dead column. There is no
"imported" status — retirement is deletion.

Columns split into three groups:

- **Clear (never sealed)** — needed for routing, RLS, and fuzzy dedup:
  `gmail_message_id` (NOT NULL UNIQUE), `member_id` (ownership/RLS),
  `source_provider` (bank name, needs fuzzy matching a hash can't do),
  `occurred_at`, `dedup_fp`, `duplicate_of_id`, `review_status`, `staging_scope`.
- **Sealed (NULL in row, inside the box)** — `amount`, `currency`, `direction`,
  `counterparty`, `reference_number`, `transaction_type`, `raw_extracted`.
- **Envelope** — `sealed`, `eph_pub`, `nonce`, `enc_v`.
- **Discarded** — `raw_body` (full email HTML) is not stored under sealing, and is
  deliberately *not* selected on fetch even where present: at ~20KB/row it was
  eating the Supabase bandwidth quota (`src/js-data/72-txn-review.js:86-97`).

Fetch: `fhFetchStagedTxns` (`:95`) selects named columns (never `*`) for
`review_status='pending'`, newest first, limited to `TXN_REVIEW_PAGE = 1000`. If
the page is full it runs a separate `count: 'exact', head: true` query for the
true total (badge + "N of M"). RLS (0058) scopes the SELECT to the caller's own
member rows, so an empty result is a real answer, not a permissions bug.

**Relevant migrations (cite by filename — the numeric sequence has documented
collisions; verify against `git ls-tree origin/main supabase/migrations/` before
relying on a number):**

| File | What it does |
|---|---|
| `0058_email_transactions_review_access.sql` | One SELECT-only RLS policy scoping reads to the caller's own member rows. No client UPDATE/INSERT/DELETE — approving is not a client write |
| `0060_email_transactions_resolve.sql` | `resolve_email_transactions(p_ids uuid[])` SECURITY DEFINER — retirement is a hard DELETE, ownership re-checked in-function; rejecting deletes too |
| `0079_personal_model_y.sql` | Model Y: person-as-root. `personal_keys` (per-user), ciphertext-only `personal_transactions` / `personal_incomes`, owner-scoped RLS |
| `0091_personal_staging_key.sql` | Personal staging keypair; `email_transactions.staging_scope` ('family'\|'personal', default 'family'); `mailbox_grants.default_scope` |
| `0090` (`resolved_email_messages`) | Tombstone table: records (member_id, gmail_message_id) **before** the DELETE so a widened backfill can't re-stage already-promoted rows |

> **Retirement is "tombstone-then-delete," not bare DELETE.** 0060 is the DELETE;
> 0090 added the durability tombstone after a real incident (2026-08-26) re-staged
> 42 already-promoted rows when a backfill widened 15→90 days.

### C. Category cascade

`buildCsvCandidates` (`src/js-ui/57-csv-import-review.js:503`) resolves each row's
category through a confidence-ordered cascade; the first hit wins, and *every*
tier only ever yields a category the family actually has (resolved through
`familyCatForConcept`), never an invented one. A guess is never final — it lands
as a tappable default on the review screen.

Order (highest confidence first):

1. **File / pipeline hint** (`catSource:'file'`) — the pipeline populates
   `raw_extracted.category_hint` with one of eight CONCEPTs, resolved to a family
   category and fed in as a fifth synthetic column
   (`src/js-data/72-txn-review.js:242-315`). This is the biggest single reduction
   in manual taps.
2. **History** — same description (or counterparty) previously categorised by a
   human in `window.txns`.
3. **Learned** — on-device corrections, keyed by merchant + amount band
   (`src/js-ui/57-csv-import-review.js:436-485`). Amount-banded because the same
   payee string ("… chuyen tien") covers a 35k coffee and a 7M rent; a lesson at
   one size must not silently relabel the other.
4. **MCC** — the ISO 18245 code on a card statement.
5. **Merchant** — brand/keyword substring match against bank-noise-stripped text.
6. **Keyword** — `guessCat()` on the description (word-boundary matched).
7. **Pattern** — shape of the spending (same small payee ≥3× → dining; same large
   round amount recurring → rent), marked `catSource:'pattern'` and shown as a guess.
8. **Fallback** — the catch-all category, `catSource:'fallback'`, shown up in
   "Needs a look".

Corrections are learned only from an explicit human pick (`catSource:'user'`),
stored locally (encrypted for an enc-committed family), never sent anywhere. A bad
lesson is undone with "quên đi / forget" (`csvLearnForget`).

### D. The key-mismatch alarm

Staged rows are sealed to a public key; the private key that opens them is wrapped
by the family DEK. A malicious operator could swap the server-stored keypair.
Defence (`src/js-data/18-staging-keys.js`):

- **Self-check on every unlock** — `fhStagingVerifyServerKey()` (`:132`)
  re-derives the public key from our unwrapped private key and compares it to the
  server's stored `staging_pub`. An operator who swapped the key cannot produce a
  value derived from a secret they never held.
- **Latch** — on mismatch, `fhStagingAfterUnlock` (`:198`) sets a per-family
  localStorage flag `fh-staging-alarm-<fid>`. It persists across reloads;
  `fhStagingAlarmActive()` reads it.
- **Family-wide by construction** — every device runs the same verify at its own
  unlock, so the frozen state spreads with no server push.
- **Scope of the freeze** — only *approval of staged rows* is frozen
  (`fhTxnReviewSheet` and the promote path both gate on
  `fhStagingAlarmActive()`, `src/js-data/72-txn-review.js:432-435`, `:670-671`).
  The family ledger uses a different key and stays fully usable.
- **Clearing** — only a later `fhStagingVerifyServerKey()` returning true clears
  it, so a legitimate key rotation must arrive through the DEK-authenticated path.
  A network blip is *not* treated as tampering — it doesn't latch, and it clears
  the once-per-session guard so the next unlock retries.

The personal side has the equivalent `fhPersonalStagingVerify()`
(`src/js-data/19-personal.js:193`).

**Sealed-box open** — `fhStagingOpenRow(row, priv)` (`src/js-data/18-staging-keys.js:35`):
`nacl.box.open` (X25519 + XSalsa20-Poly1305). It verifies (a) integrity/auth via
Poly1305, and (b) an identity binding sealed *inside* the box: for a personal row
`payload.owner_user_id === row.owner_user_id`, else `payload.family_id ===
row.family_id`, plus always `payload.gmail_message_id === row.gmail_message_id`.
Both row-side values are injected from the client's **own session** before the
call (`row.family_id = DB.fid`; `row.owner_user_id = fhUser.id`), never trusted
from the server-sent row — otherwise a lying server could satisfy both sides. This
is the anti-relocation guarantee: ciphertext moved onto a different row is caught
at open time. On any failure the row is surfaced as `{_unreadable}`, never
silently dropped.

**Which key** — `staging_scope` on the row selects it
(`src/js-data/72-txn-review.js:209-226`): `'personal'` → `fhPersonalStagingPrivKey()`
(unwrapped by the personal DEK), else → `fhStagingPrivKey()` (unwrapped by the
family DEK). The client can't guess scope — it holds two private keys and a sealed
box gives no hint which fits, so trying both would turn a wrong key into a silent
"unreadable" instead of a clear one.

### E. Write paths

Promotion forks in `fhPromoteStaged` (`src/js-data/72-txn-review.js:667`): ticked
rows with `csvRowScope(c)==='personal'` go to the personal writers; the rest go
through `csvPromote` to the family ledger.

**Family** — `csvPromote(subset)` (`src/js-ui/56-csv-import-ui.js:1984`):

1. Commit any review-invented categories into the real `catOrder`.
2. Pre-resolve each distinct category id once, serially, via `_categoryIdForName`
   — without this, 59 rows race to CREATE the same category and the batch fails.
3. Map each candidate to a bulk-composer row and hand off to `submitBulk({prepared:true})`.
4. `submitBulk` → `addExpense()` per row → the write-through wrapper → `_dbInsertTxn`
   (`src/js-data/40-txn-writes-outbox.js:285`): inserts into `transactions` with
   `family_id`, `category_id`, `member_id`, `txn_date`, `status`, `created_by`,
   plus `amount_enc` / `note_enc` / `occurred_time_enc` via `fhField()` (AES-GCM
   under the family DEK; honours the off/dual/enc mode). Offline → durable
   IndexedDB outbox.

**Personal** — per row in `fhPromoteStaged` (`:700-723`):

- Expense → `fhPersonalAddExpense(base, note, catName, emoji, dateIso, timeStr)`
  (`src/js-data/19-personal.js:272`) → insert into **`personal_transactions`**
  (`kind='expense'`, `space_id=null`, `link_id=null`) with `amount_enc`,
  `note_enc`, `cat_name_enc`, `cat_emoji`, `occurred_time_enc` — all under the
  per-user DEK (`_encP`).
- Income → `fhPersonalAddIncome(base, note, dateIso)` (`:323`) → insert into
  `personal_incomes` (day-only, no category/time columns). This is the one place a
  bank email's incoming money is captured — the family importer holds income back
  entirely.

> **The 1000× ".000" pitfall.** VN bank emails render "45.000"; `parseAmt` strips
> the dot to `45000` (display units), and base storage needs ÷1000 → `45`. The
> **family** path gets this via `parseAmtBase` *inside* `addExpense`; the
> **personal** path must convert explicitly with `csvBaseAmt` in `fhPromoteStaged`
> (`:708`). Passing `c.amount` raw to the personal writer stored 1000× too much.
> Same result, two code paths — a refactor hazard if only one is changed.
> (`curMult()` = 1000 for VND: `src/js-ui/10-nav-model.js:113`.)

`space_id=null` marks a truly private row (a non-null `space_id` is the mirror
mechanism for a family-authored expense shown in the personal book); bank-email
personal rows always leave it null.

### F. Duplicate detection

**The ledger is the sole anchor of truth** (decided 2026-09-03): email-reading
history informs, but what decides whether a card is suspect is comparison
against what is actually in the books. The pipeline computes `duplicate_of_id`,
but that is a **suspicion, not a delete order** — the authority moved to this
screen after 0060 activated a dormant deletion path and made a real 2.000đ
transfer disappear. Flagged rows are shown with *Vẫn nhập* / *Bỏ qua* (file
mode: the "Có thể trùng" section; staged mode: inline, unticked, chip-flagged);
nothing is hidden.

> **The units bug (fixed 2026-09-03).** Ledger rows store amounts in base
> units (đồng ÷ `curMult()`); a candidate's `amount` is raw đồng. The
> against-the-ledger comparison ran on the raw values — |92.5 − 92500| < 1 is
> never true — so that layer had **never fired for VND**, in either book.
> Proven live: two exact SHOPEE repeats (92.500đ / 77.600đ, same day) sat
> ticked in ready. All ledger comparisons now normalise to đồng (`amtD`).

The screen re-runs detection with better evidence (it holds the decrypted
amount, the unsealed `source_provider`, and — crucially — `transaction_type`
the pipeline can't read on sealed rows). Layers, most concrete first:

- **Imported before (certain)** — the server re-staged this exact
  `gmail_message_id` knowing its tombstone predates the current mailbox
  connection (`resolved_before`, 0113). Message-id equality is a fact, not a
  guess: the card wears the strong "đã nhập trước đó" chip. Still one tap,
  never a deletion — only the person knows whether they since removed the row.
- **In-batch** — same description **and** amount **and** day **and** minute → a
  mail staged twice. Time is in the key because two topups to the same person
  for the same amount on the same day are ordinary, not duplicates.
- **Against the ledger** — same amount (in đồng, within 1đ) within 3 days of an
  existing transaction **of the same kind**: expense candidates hunt expenses
  in both books, income candidates hunt income rows (personal book — the
  family table carries no income). The personal side is matched against a
  365-day slice (`fhPersonalMatchSlice`, amounts/notes/cats only, decrypted
  once per session) because a re-staged card can be far older than the
  personal tab's ~2-month cache.
- **Near-miss (weak)** — same canonical merchant + same calendar day + amounts
  under 1.000đ apart that the exact tier didn't catch: the hand-logged rounded
  entry (467.000đ against the bank's 467.290đ — a real pair). Wears the quiet
  "gần trùng" chip and says the gap out loud.
- **Cross-source** — a bank *and* a non-bank reporting one swipe. Two of the
  same bank, or two *different* banks, are never duplicates (each sees only its
  own account); currency must match before amount.
- **Pipeline flag** — kept as a suspicion, but the client *overrules* a
  bank-vs-bank flag it can prove wrong (the pipeline flagged it blind to
  `transaction_type`).

**Visible diligence.** Staged review opens with a check-count line — "Đã đối
chiếu N thẻ với sổ chi tiêu — X có thể trùng" — because an unflagged card
carries an invisible claim ("we checked; looks new") that used to be
indistinguishable from no check at all. When X > 0 the line offers a filter
("Chỉ xem thẻ trùng") that narrows the list to flagged cards, plus select-all /
clear-all over exactly those. An opened flagged card shows its evidence: the
matched ledger row's note/category, amount, date, which book, and who logged it
(`csvDupWhy`) — "is this the same purchase?" is unanswerable from memory.

### G. Retirement bookkeeping

Client-side, per-member localStorage key `fh-staged-retired:<memberId>`
(`src/js-data/72-txn-review.js:59-84`). The pattern is always **local-first**:
record the id as retired, *then* call `resolve_email_transactions`. A failed
server delete still keeps the row out of this device's queue, so it can't
reappear and be imported twice. The set is pruned against what the server actually
returns, so it can't grow unbounded. The "finished with" set is computed by
*exclusion* (`fhStagedIdsForResolved`, `:581`) — everything readable minus
everything still waiting in a bucket — because the ✕ handlers splice a candidate
out of the review state, so a rule built from "what was removed" couldn't see
them. If the review state is unreadable, retire nothing rather than guess.

### H. Key functions index

| Function | File:line | Role |
|---|---|---|
| `fhEmailTxnCta` | `src/js-data/72-txn-review.js:155` | Entry router (setup vs review) |
| `fhTxnReviewSheet` | `src/js-data/72-txn-review.js:428` | Open the queue |
| `fhFetchStagedTxns` | `src/js-data/72-txn-review.js:95` | Fetch pending rows |
| `fhReadStagedRow` | `src/js-data/72-txn-review.js:198` | Decrypt one row |
| `fhStagedAsCsvSource` | `src/js-data/72-txn-review.js:247` | Shape rows for the CSV engine |
| `fhPromoteStaged` | `src/js-data/72-txn-review.js:667` | Import handler (the fork) |
| `fhStagedIdsForResolved` | `src/js-data/72-txn-review.js:581` | Compute retirement set |
| `buildCsvCandidates` | `src/js-ui/57-csv-import-review.js:503` | Row → candidate + category cascade |
| `bucketCsvCandidates` | `src/js-ui/57-csv-import-review.js:814` | Sort into ready/group/dup/deferred |
| `renderCsvReview` | `src/js-ui/56-csv-import-ui.js:931` | Render the screen |
| `csvRowScope` / `csvPickRowScope` | `src/js-ui/56-csv-import-ui.js:892` / `:906` | Per-row destination |
| `csvPromote` | `src/js-ui/56-csv-import-ui.js:1984` | Family ledger write |
| `fhPersonalAddExpense` / `fhPersonalAddIncome` | `src/js-data/19-personal.js:272` / `:323` | Personal ledger writes |
| `fhStagingOpenRow` | `src/js-data/18-staging-keys.js:35` | Sealed-box open |
| `fhStagingAlarmActive` | `src/js-data/18-staging-keys.js:149` | Approval-freeze latch |
| `resolve_email_transactions` | `supabase/migrations/0060_email_transactions_resolve.sql` | Server-side retirement |

---

## Open questions & known gaps

- **Copy inconsistency** — Personal-tab CTA label is VN-only; Family CTA is
  bilingual. Align.
- **Global badge** — both entries show the total pending count, not a per-scope
  count. Confirm intended, or filter the Personal-tab badge.
- **Stale OAuth grant** — a grant needing re-auth still routes to the review sheet
  (the setup check is truthiness-only). Acceptable, but worth a re-auth nudge.
- **`category_hint` documentation drift** — older feature docs say the review
  screen ignores it; the live code consumes it as a `file`-source hint
  (`src/js-data/72-txn-review.js:305`). This spec reflects the live behaviour.
- **Two amount-conversion paths** — family via `parseAmtBase`, personal via
  `csvBaseAmt`. A refactor should unify them.

## Related docs

- `docs/features/bank-email-pipeline.md` — the ingest pipeline (forwarding transport)
- `docs/features/direct-mailbox-read.md` — OAuth/direct-read transport, scope, tombstones
- `docs/features/personal-ledger.md` — Model Y personal ledger
- `docs/features/csv-import.md` — the shared review engine, file entry point
- `docs/features/encryption.md` — the DEK / off-dual-enc lifecycle
- `pipeline/SEALED-STAGING-DESIGN.md` — sealed-box crypto and the "border crossing" principle
