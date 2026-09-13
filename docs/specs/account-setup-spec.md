# Account Setup — a balance you typed, or one derived from it

The epic that makes the "Nợ & cho vay" numbers trustworthy for a fresh
mailbox-connected user. Capture materializes accounts from a lookback window of
email, and a window cannot know the balance carried in from before it — so on
day one a card showed a huge debt (or a green "Đang dư"), a debit account showed
up as a card, and the Tôi nợ / Được nợ rings were wrong in both directions. The
rule this spec installs: **an account shows a number only after the person has
typed one.**

> **Status, 2026-09-13.** Designed in a grilling interview (decision log §12)
> and BUILT the same day, big bang: migration **0134** applied live, app
> **v514**. Cards joined the anchor model, the bento gates un-anchored accounts,
> the post-import setup wizard, the family-scope card gap closed, the push offer
> moved to the first home visit. The card reconcile-by-adjustment path is
> deliberately kept until the wizard proves itself (Q16).

> **How this relates to its siblings.** `full-ledger-spec.md` (0109) gave
> non-card accounts an anchor and a drift detector; this spec extends the anchor
> to cards and puts a setup step in front of every number.
> `borrowing-lending-spec.md` (0105) created `personal_accounts` and the
> instrument classifier this rides on. `card-repayment-routing-spec.md` names
> the card a payment pays off. `effortless-transaction-logging-spec.md` is how
> a bank email becomes a row; its §19.4 promote step is where the wizard fires.

---

# Part 1 — Behaviour

## 1. Summary

- **The problem is the window.** Connect a mailbox, read 30/60/90/365 days, import
  the queue: every account appears with a number derived from those days alone.
  A card's outstanding ignores the balance carried in from before the window; a
  statement payment dated before the window's first purchase has nothing to
  subtract from, so the card flips to "Đang dư" and inflates "Được nợ"; a VN
  debit card printing a 16-digit PAN can be mis-kinded as a credit card.
- **The rule.** An account shows a number only after the person has anchored it.
  Until then its tile shows a dash and one line, "Chạm để thiết lập", and it is
  excluded from the Tôi nợ / Được nợ totals.
- **One number per kind, one screen per account.** Right after the first import
  from the queue, a short wizard walks the accounts that import touched: confirm
  the kind, type the number the bank app shows, "Để sau" if not now. Cards ask
  for "dư nợ hiện tại" (total outstanding), bank and e-wallet for "số dư hiện
  tại", cash for "đang có bao nhiêu tiền mặt".
- **Cards join the anchor model.** The card's number is the anchor plus purchases
  minus payments since, exactly like a deposit's balance, stored as a negative
  asset so one derivation serves every kind. Rows before the anchor are absorbed
  by it, which is what makes the pre-window payment problem disappear.
- **The family-scope gap is closed.** A family expense paid with the author's
  card now reaches that card's outstanding through every door: review promote,
  the one-row quick sheet, the family expense sheet's "Trả bằng gì?" chips, and
  an editable "Nguồn tiền" row on the family detail for the author.
- **The push offer moved.** It no longer fires after an import (that moment now
  belongs to the wizard); it fires once on the first home visit.

## 2. What the person sees

### 2.1 The bento, before setup

Every captured account renders as a tile with its name, a muted dash, and
"Chạm để thiết lập" in brand ink. Nothing else — no window-derived number, no
"ước tính". The hero rings are hidden entirely while nothing verified
contributes (two empty rings over a row of to-do tiles read as broken); once
something does, they show, with one quiet footnote: "Chưa gồm N tài khoản chưa
thiết lập".

### 2.2 The wizard

Fires about half a second after the review screen closes on an import, only from
the full queue (never the one-row quick sheet, Q32), only for accounts the import
touched that still have no anchor and no "Để sau". One `_fhModal` per account:

- Title "Xác nhận số dư · 2/4"; progress dots at the top of the body.
- On the first screen, one line of why: *"Email chỉ kể được vài tháng gần đây.
  Nhập số đang thấy trong app ngân hàng để tụi mình tính đúng từ đây."*
- The account name, editable, prefilled from the provider canon ("VIB ••1234").
- Kind chips (thẻ tín dụng · tài khoản ngân hàng · ví điện tử · tiền mặt),
  prefilled from the classifier; a cash account shows none.
- One large numeric field whose label follows the kind.
- For a card, "Thêm chi tiết thẻ" unfolds hạn mức · ngày chốt · ngày đến hạn.
- One line under the number: *"Mốc này đã gồm mọi giao dịch trước lúc đặt.
  Khoản ghi sau đó cộng trừ tiếp lên nó."*
- Primary "Xong" ("Hoàn tất" on the last screen); a quiet "Để sau" per account.
  The modal's Cancel closes the whole wizard; nothing is written, the tiles keep
  their CTA, and the next import asks again.

Order: cards, then bank accounts, e-wallets, cash last (Q20).

### 2.3 After setup

The tile shows the number. A card reads "Đang nợ X" (red) or "Đang dư" if the
anchor went negative the other way; a bank account reads its balance. The card
detail is unchanged: reconcile-by-adjustment ("Cập nhật dư nợ thực tế") still
books a dated "Điều chỉnh dư nợ" line on top of the anchor, and "Cài đặt thẻ"
still edits the kind and card fields. A skipped account keeps "Chạm để thiết
lập" indefinitely; the tile opens the same wizard for that one account.

### 2.4 Family expenses and your card

- **At review**, a row filed to Gia đình still names the instrument the mail
  came from; the import tags the author's private copy of that expense with the
  card, so the card's outstanding is right even for a household that files
  everything to the family.
- **In the family expense sheet**, "Trả bằng gì?" now appears in family scope
  too, whenever the author's personal ledger is unlocked. The family sees the
  same source line an email import writes ("VIB · tín dụng ••4512"); which card
  it is stays in the author's ledger.
- **On the family detail**, the author's "Nguồn tiền" row is editable; everyone
  else sees the read-only source line as before.

## 3. Why these choices (the causes, and what each got)

| Cause of a wrong number | What this spec does |
|---|---|
| Balance carried in from before the window | The anchor |
| Statement payment before the window's first purchase | The anchor (rows before the anchor day are absorbed) |
| Debit account classified as a credit card | Inline kind confirm in the wizard |
| A bank's old "Số dư" arguing with a fresh anchor | Anchor clears the captured balance; drift ignores anything older than the anchor day |
| Card purchases filed to the family never reached the card | The family-scope tag through every door |
| One-legged transfers inflating spending stats | **Out of scope** (balances only; stats hygiene is its own item) |
| The same instrument materialized twice | **Out of scope** (account dedup is its own item) |

---

# Part 2 — Technical Appendix

## 4. When the wizard fires

`_fhPromoteStagedRun` (`72-txn-review.js`) collects **touched accounts**:

- every personal spec's `accountId` (expense, income, transfer legs, loan,
  repayment, investment);
- every family-scoped candidate's resolved instrument (`tc._pAcct`, §6);
- `window._fhQueueNewAccts` — ids the queue session's eager materialization
  created (snapshot of `P.accounts` before the census loop; anything not in it
  afterwards is new), so an instrument whose rows were left unticked still
  counts as touched.

After retirement and the badge refresh, `fhAcctSetupAfterImport(touchedIds)` is
scheduled 650 ms out (the review modal closes first; a modal over a modal is a
mess). It filters through `fhPersonalAccountSetupNeeded(ids)` — non-investment,
`anchorK == null`, no `setupSkippedAt`, sorted by kind rank — and opens
`fhAcctSetupWizard` with `{intro: true}` when anything remains. The quick sheet
(`76-quick-review.js`) never calls either.

## 5. Data model and derivation

### 5.1 Migration 0134

```sql
alter table public.personal_accounts
  add column if not exists setup_skipped_at timestamptz;
```

Plaintext timing key, the 0105 rule. Read into `P.accounts[].setupSkippedAt`;
written through `fhPersonalAccountUpdate({setupSkipped: true|false})`.

### 5.2 Cards on the anchor model

- `fhPersonalBalance` drops its `credit_card` guard. Contributions are unchanged:
  expense −amt, income +amt, transfer ±amt (sign inside the ciphertext), loan
  −amt, repayment +amt, investment ±amt. For a card the anchor is stored as
  `−(dư nợ hiện tại)`, so a purchase deepens the (negative) balance, a payment
  or a reconcile adjustment raises it, and outstanding = −balance.
- `fhPersonalDebts` per card: `bal = anchorK != null ? fhPersonalBalance(id) :
  null`; `verified = bal != null`; `outstanding = verified ? −bal : spend − paid`.
  The window sum survives only for the reconcile modal's copy on an unverified
  card. `owe`/`owed` sum verified cards only. The result gains `unverified`:
  the count of non-investment accounts with no anchor (skipped ones included —
  they are still "chưa thiết lập").
- `fhPersonalAccountUpdate` gains `anchorK` (writes `anchor_balance_enc`,
  `anchor_at = now`, and nulls `ext_balance_*`) so the wizard's name/kind/card
  fields and the anchor are one write and one hydrate per account.

### 5.3 The anchor supersedes bank numbers

- `fhPersonalAnchorSet` and the `anchorK` path both null `ext_balance_enc` /
  `ext_balance_date`.
- `fhPersonalDrift` returns null when `extDate < localDate(anchorAt)`.
- `fhPersonalExtBalanceSet` refuses a day earlier than the anchor day.
- Cards still never receive a captured "Số dư" (`_recBal` bails on
  `credit_card`): card mail prints available limit or statement figures, not
  a balance-after.

## 6. The family-scope tag — one master, written by the family writer

The family ledger has no accounts (0131's `instrument` is a display string). The
author's **mirror master** does. The mirror engine cannot know the account, so
the writer that creates the family row creates the tagged master too, the way
publishing a private row already does:

1. **Resolve + reserve.** Promote: for each family-scoped candidate with a
   confident instrument (`fhStagedAcct`) and a ready personal ledger,
   `fhPersonalAccountEnsure` → `c._pAcct`, `c._link = randomUUID()`. Quick sheet:
   the same for its one row into `_fhImportAcct` / `_fhImportLink`. Manual family
   log: the write-through decorator reads the "Trả bằng gì?" chip
   (`_famAcctPick`), mints the link, and sets `nt.inst` to the account's display
   string (`fhAccountInstString`: "VIB · tín dụng ••4512", or the account name
   for a name-identity account).
2. **Carry.** `csvPromote` → `bulkRows[].pAcct/link` → `submitBulk` sets
   `_fhImportAcct` / `_fhImportLink` per row → the decorator puts `nt.pAcct` /
   `nt.linkId` on the local txn.
3. **Write.** `_dbInsertTxn` resolves `'cash'` to the Tiền mặt account, inserts
   the family row with `link_id` pre-set (the write-once trigger allows the
   initial set), then `fhPersonalInsertMaster(linkId, fid, date, amt, note,
   cat, emoji, time, accountId)`. Offline: the family row is queued with its
   `link_id`; the master is not written; the mirror engine's reconcile pass
   inserts a tag-less master later (the "missing master" repair) and the person
   can tag it by hand.
4. **Edit.** `fhPersonalMasterSetAccount(id, accountId)` updates `account_id`
   on a row `where link_id is not null` — the one field the personal side owns
   on a machine-owned row. The family detail (`61-expense-detail.js`) resolves
   the author's master once per open (`link_id` is not in the snapshot: one
   select, then a `P.txns` lookup; masters outside the loaded window fall back
   to the read-only line), renders "Nguồn tiền" as an editable row for the
   author, and on pick writes the master tag immediately plus the family row's
   `instrument` string.

The mirror engine is untouched: its refresh never wrote `account_id`, its adopt
step only claims rows with `link_id is null`, and a pre-set `link_id` with an
existing master is a no-op. Existing masters stay untagged (forward-only, Q29).

## 7. The push offer

`fhPushFirstVisitOffer` (`55-push.js`): once per member (`fh-push-nudged:<mid>`),
honours the old `fh-mbx-push-nudged:<mid>`; only when push state is `'off'`;
delayed 2.6 s and skipped (key NOT set) if another sheet holds the scrim — the
install nudge fires at the same moment on installable browsers, so the offer
waits for the next launch. Called from the hydrate tail and from
`finishOnboarding`; a call mid-onboarding returns without arming so the
`finishOnboarding` call can run. The sheet's `'off'` copy now names captured
transactions alongside family activity. `_mbxPushOfferOnce` is removed.

## 8. Surfaces touched

| File | Change |
|---|---|
| `supabase/migrations/0134_account_setup_skipped.sql` | `setup_skipped_at` |
| `src/js-data/19-personal.js` | hydrate select + `setupSkippedAt`; `fhPersonalAccountUpdate` (`setupSkipped`, `anchorK`); `fhPersonalDebts` (verified, unverified); `fhPersonalBalance` (cards); drift / anchor / ext-balance rules; `fhPersonalAccountSetupNeeded`; `_insertMaster(accountId)`, `fhPersonalInsertMaster`, `fhPersonalMasterSetAccount` |
| `src/js-data/23-debts-ui.js` | setup tile, hero gate + footnote, card detail/reconcile on anchored outstanding, the wizard (`fhAcctSetupAfterImport`, `fhAcctSetupWizard`, `fhWizLater`, `fhWizKindSync`, `fhWizMore`) |
| `src/css/41-debts.css` | `.dbt-setup`, `.dbt-hero-foot`, `.wz-*` |
| `src/js-data/72-txn-review.js` | `_fhQueueNewAccts`, family-row tag + link, touched accounts → wizard; push offer call removed |
| `src/js-data/76-quick-review.js` | family write carries the tag |
| `src/js-ui/56-csv-import-ui.js`, `src/js-ui/50-sheets-expense-capture.js` | `pAcct`/`link` through `csvPromote` → `submitBulk`; chips in family scope |
| `src/js-data/50-writethrough-realtime.js` | `_famAcctPick`, `fhAccountInstString`, `nt.pAcct` / `nt.linkId` |
| `src/js-data/40-txn-writes-outbox.js` | `link_id` on the family row + the tagged master insert |
| `src/js-ui/61-expense-detail.js` | author-editable "Nguồn tiền" on the family detail |
| `src/js-data/55-push.js`, `30-hydrate.js`, `src/js-ui/80-onboard-boot.js`, `src/js-data/71-mailbox-ui.js` | the first-visit offer; old offer removed |
| `tools/account-setup.test.js` | source-shape guard |

## 9. Failure modes

| Scenario | Behaviour |
|---|---|
| Person cancels the wizard mid-way | Nothing written for the remaining accounts; tiles keep the CTA; the next import asks again |
| "Để sau" on an account | `setup_skipped_at` set; never re-asked at import; tile CTA stands |
| Kind flipped card → bank in the wizard | Card fields hidden, label follows, anchor stored positive |
| Anchor set, then an older mail's "Số dư" is imported | Ignored (pre-anchor day), no false drift |
| A family row's master insert fails (offline, race) | Mirror engine inserts a tag-less master; author tags it from the family detail |
| Author's master outside the loaded window | Family detail keeps the read-only source line |
| Personal ledger locked | No chips in family scope, no tag, no wizard — as before |
| Install nudge and push offer collide on first visit | Push offer stays silent, key unset, tries next launch |

## 10. Security and privacy (delta only)

- No new value class leaves the device: `setup_skipped_at` is a timestamp; the
  anchor is personal-DEK ciphertext as before.
- A family row's `link_id` was already writable by the author (publish path);
  the tagged master is an owner-only personal row.
- The family sees the same display-grade instrument string it already sees on
  email-imported rows; which account it maps to lives only in the author's
  ledger.

## 11. Scope

**In (one release):** migration 0134; cards on the anchor model; the gate
(tiles, hero, card detail); the wizard + "Để sau"; anchor-supersedes-bank
rules; the family-scope tag through review, quick sheet, family sheet, family
detail; the push offer's move.

**Out, named:** one-legged transfers in spending stats; duplicate materialized
accounts; investment positions in the gate; backfilling tags on existing
masters; instrumentation beyond people judging whether day one looks right.

## 12. Decision log

From the grilling interview, 2026-09-13.

| # | Decision |
|---|---|
| Q1 | Causes are several: window carry-in, pre-window payment, mis-kinding, one-legged transfers, duplicate accounts, stale bank balance. |
| Q2 | Gate posture A: hide the number, tile says "Chạm để thiết lập"; excluded from totals. |
| Q3 | Inputs per kind, as many as buy accuracy; one required number each. |
| Q4 | Cards join the anchor model. |
| Q5 | Wizard fires right after the first import; tile CTA is the fallback. |
| Q6 | Skippable per account, no nagging beyond the tile. |
| Q7 | Every account needs setup (cash included; investments out per Q9). |
| Q8 | Kind confirm inline, prefilled. |
| Q9 | Field table per kind; investment positions out. |
| Q10 | Card asks for total current outstanding, not statement balance. |
| Q11 | Stats hygiene and account dedup out of scope; stale bank balance fixed here. |
| Q12 | Anchor clears the bank number; drift ignores anything older than the anchor. |
| Q13 | Hero sums verified accounts + footnote "chưa gồm N". |
| Q14 | Wizard, one account per screen, app voice, Apple-grade. |
| Q15 | Fires after any import touching an un-anchored, un-skipped account; skip stored as a column. |
| Q16 | Reconcile-by-adjustment kept until the wizard proves useful. |
| Q17 | Card detail unchanged; adjustments compose on top of the anchor. |
| Q18 | Card anchor stored as a negative asset balance; one derivation. |
| Q19 | Wizard anatomy as built (§2.2). |
| Q20 | Order: cards, bank, e-wallet, cash. |
| Q21 | Push offer moves to the first app visit. |
| Q22 | Family-scope card gap closed, fully. |
| Q23 | Usefulness judged by the people using it, no instrumentation. |
| Q24 | First visit = first home render after onboarding; iOS browser tab defers to the install nudge. |
| Q25 | Existing members get it once on next launch; old answer honoured. |
| Q26 | One generic push sheet copy. |
| Q27 | Three doors: promote, family sheet chips, master editing on the family detail. |
| Q28 | The family writer creates the tagged master; no reparse of display strings. |
| Q29 | Forward-only for existing masters. |
| Q30 | Chips whenever the personal ledger is unlocked, Tiền mặt always present. |
| Q31 | Manual family rows get the same instrument display string. |
| Q32 | Wizard from the full queue only. |
| Q33 | Hero hidden until something contributes. |

## 13. Related

- `docs/specs/full-ledger-spec.md` — anchors, drift, transfer pairs (0109).
- `docs/specs/borrowing-lending-spec.md` — `personal_accounts`, the classifier, reconcile (0105/0108).
- `docs/specs/card-repayment-routing-spec.md` — which card a payment pays off.
- `docs/specs/cross-ledger-move-spec.md` — the publish path this borrows (`link_id` pre-set).
- `docs/specs/effortless-transaction-logging-spec.md` — the queue and promote; Part 3 entry 2026-09-13.
