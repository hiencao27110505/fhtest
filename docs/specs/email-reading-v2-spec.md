# Email Reading v2: read the mail once, state every fact the ledger can hold

How FamilyHub reads a bank's, wallet's, broker's or lender's email, redesigned
backward from the ledger. The first reader was built when the ledger held one
kind of row, an expense. The ledger now holds six kinds (expense, income,
transfer, loan, repayment, investment), accounts with balances, cards with
debt, positions with quantities, and a category tree of more than 200 nodes. The reader
still answers the old question. This spec makes it answer the new one: for
every attribute any ledger row can carry, state it when the mail prints it,
say where the statement came from, and leave the decision about what the money
*meant* to the one place that can know, the person's own device.

> **Status, 2026-09-21. DESIGN AGREED, NOTHING BUILT.** Agreed in a grilling
> session the same day (decision log §17, R1 to R18), on top of a code-level
> inventory of the live reader and a read-only measurement of production (§2).
> Landing 0 was largely completed the same evening by a parallel session
> (`ee28e34`: backfill cursor and reader lease back in `main`, `0136` and `0145`
> recorded; next free migration is `0146`). Everything else in this document is
> a plan. Nothing here has been deployed, migrated or pasted.

> **How this relates to its siblings.** `effortless-transaction-logging-spec.md`
> stays the end-to-end document (transports, sealing, dedup, review, runbook);
> its §16 "Extraction" is what this spec replaces, and its Part 3 release log
> gets one entry per landing here. `email-extraction-reference.md` documents
> the tiers and the label-to-field map as they are today and is rewritten after
> landing 3. `category-tree-spec.md` owns the tree and the on-device node
> cascade (its E series, E12 to E18, shipped the same day and is honoured here:
> WHAT outranks WHO, no extra taps, a sealed node is checked against today's
> keywords). `full-ledger-spec.md`, `borrowing-lending-spec.md`,
> `lending-capture-spec.md`, `investment-spec.md`, `account-setup-spec.md` and
> `card-repayment-routing-spec.md` define the attributes this spec works
> backward from. `statement-capture-spec.md` is the sibling lane for statement
> FILES and is not changed here.

---

# Part 1. Behaviour

## 1. Summary

- **Four goals, none sacrificed** (R1): fewer taps at review, fewer model
  calls, more kinds of mail covered, and fewer wrong pre-fills. They are kept
  compatible by design rules (§3), not by ranking.
- **The server states facts and signals; the device decides the kind** (R2).
  A transfer is "the other side is *your* account"; a card repayment is "the
  card is *yours*"; a loan repayment is "the payer *owes you*". The server
  cannot know any of that, because staged rows are sealed and it never sees
  your accounts, debts, positions or lessons. So it reports what the mail
  prints, plus a closed list of signals decidable from the mail alone (§5),
  and the device combines them with what only it knows.
- **One richer payload, version 2** (R4, §4): every attribute a writer accepts
  has a field. Every field records where it came from, and that provenance
  decides where a row is *shown* at review, never whether it imports.
- **The model is paid once per mail format and must teach everything** (R6,
  R7). A template becomes a label map that can carry every v2 field, so the
  91% of mail read locally gets the same rich result as the mail the model
  read. The free Gemini tier and `gemini-3.5-flash-lite` stay.
- **Mail that moves no money is read too** (R5): card due notices, instalment
  reminders and "statement ready" mail update account facts quietly and never
  become review cards.
- **Forwarding stays, as a courier** (R11): the Apps Script routes and hands
  the mail to the same reader direct read uses. One reader, one prompt, one
  sealing implementation, one fingerprint key.
- **Every landing is gated by a scoreboard** on the founder's own year of real
  mail (R16, §13).

## 2. Why: what the reader does today, measured

From the code (`supabase/functions/_shared/mailbox/*`, `main` at `649c4b0`)
and from production, read-only, on 2026-09-21.

**The model is asked for 20 fields and about a third never reach review.**

| Lost | Where | Effect |
|---|---|---|
| `transaction_type` (5 values from the model, 2 from the table reader) | `stage.mjs:132` overwrites it with a value derived from the sender kind | A sealed row only ever says `bank_txn` or `ecommerce_receipt`; the device's "leave the description blank for a person-to-person transfer" rule can never fire for email rows |
| `status` | `worker.mjs` `_toReading` has no `status` key | Always null on direct-read rows |
| `channel` | no server tier sets it | Always null |
| raw `counterparty` | replaced whenever a tidied version exists | The original is gone |
| `balance` | not in the model's schema; a body regex fills it on every tier | Works, by accident of a fallback |
| `node` | never from the reader; a second model call (`classifyMerchant`) supplies it, expense nodes only | 58 income, transfer, loan, repayment and investment nodes are never emitted by the server |

**Templates carry less than the other tiers, and templates are nearly all the
volume.** Over the last 14 days: templates 91.2% of successful reads, the
model 8.6%, the label-table reader 0.2% (5 reads). A stored template holds 5
frozen facts and 7 anchored fields and nothing for `flow`, category, balance
or foreign currency. So most rows reach review with a kind guessed from the
direction and a category guessed from a merchant string.

**The device re-derives from free text what the mail could have stated.**
Card repayment is detected by four separate wording regexes
(`57-csv-import-review.js:779`, `72-txn-review.js:631`, `13-partition.js:198`,
`59-statement-table.js:281`); own-name transfer by three copies of one regex;
salary, refund, bonus, fee, top-up and ATM withdrawal by keyword lists; the
repaid card's digits are mined from memo text. The bank's own `type_code` is
sealed into every row and read by nothing.

**Attributes the email path never fills although the ledger has a place for
them:** the counterpart account of a transfer, a loan's due date, an
investment's quantity and symbol, `label_id`, counterparty on income, transfer
and investment rows, and the email's clock time on five kinds (transfer, card
payment, loan, repayment, investment), whose import specs omit `time` although
`fhPersonalAddMany` accepts it.

**Broker and lender mail is already fetched and misread.** `senders.mjs`
already queries 11 securities and investing senders (SSI, VPS, TCBS, VNDIRECT,
DNSE, HSC, MBS, Mirae Asset, VCBS, Finhay, Infina) and 5 consumer-finance and
pay-later senders (FE Credit, Home Credit, HD SAISON, Kredivo, Fundiin),
inside the `WALLETS` group. Their mail is staged as a plain
`ecommerce_receipt` expense.

**The free tier is workable in steady state and breaks in bursts.** 753 model
calls from 09-07 to 09-21; 23.1% rate-limited, every one of them inside the
connect and backfill days (09-15 to 09-19); zero on 09-20 and 09-21. 334 of
the 753 calls were merchant classification, not extraction.

**Twelve formats pay the model on every mail.** The largest drain is VIB
credit-card notices, refused by the template learner as "foreign currency" 50
times; the same refusal fires on a domestic QR bill and on train tickets, so
it reads as a false positive. Four more are MoMo ticket subjects that embed
the cinema or airline name, so each venue becomes its own format.

**Direction frozen per format is unsafe.** HSBC's "Biến động số dư" notice
carries both directions under one subject and is frozen as credit. MoMo's
catch-all "Giao dịch thành công" is frozen as debit and `subscription`. The
label-table reader cannot read money coming in at all:
`direction = negative ? 'debit' : (refund ? 'credit' : 'debit')`
(`labeltable.mjs:587`), and `parseAmountCell` recognises a leading `-` and
never a `+`.

**Learning loops that have never run:** `learned_labels` (0 rows despite 43
sightings each of several VIB labels), `model_budget` and `model_pause` (0
rows; the only two inserts rolled back; nothing in code reads them),
`coverage_candidates` (0 rows). `classify_merchant_batch` has failed on every
call (4 of 4, HTTP 400).

**Two consent gaps and one privacy leak** are in §11.

## 3. The four goals, and the rules that keep them from colliding (R1)

| Pair that pulls apart | Rule |
|---|---|
| Fewer taps vs correctness | Every field records its source: `printed` in the mail, read by a `template`, judged by the `model`, or guessed by a `heuristic`. Review pre-selects from any source. The source decides where the row is shown: rows resting on printed facts go to the ready list; rows resting on a judgment or a guess go to "Cần bạn xem". A field that cannot be stated stays null. This extends an existing rule: confidence decides where a row shows, never whether it imports. |
| Fewer model calls vs taps and coverage | The model is paid once per mail format, never once per mail, and whatever it read on that one call must carry into the stored template so every later mail of the format is read as richly, locally. |
| Coverage vs correctness | A newly covered kind only ever proposes a pre-selection. A sender class that reports the same money twice (a merchant receipt plus the bank debit) joins the existing row and never stages a second one. |
| Coverage vs model calls | Each new sender class arrives with hand-written formats for its main mail, shipped as seeds, so first contact costs no model call. Precedent: `0140_statement_shapes_seed`. |

Two product rules set elsewhere bind this work and are repeated so they are
not rediscovered:

- **No extra taps** (`category-tree-spec.md` E14). Pre-select from the data;
  when the data runs out, rest on the deepest level that is known. Nothing in
  this spec adds a prompt. "The missing half" of a proposed kind (§9) is an
  unset row on the review card, not a question put to the person.
- **WHAT outranks WHO** (E14a). A tier that is vaguer than existing ones goes
  below them. Measure displacement of prior answers, not only depth reached.

## 4. What a reading carries: payload v2 (R4)

Everything is nullable. Everything stays inside the sealed box; the only new
clear column is `row_kind` (§6). "New" means no server tier emits it today.

| Group | Fields |
|---|---|
| Money | `amount`, `currency`, `direction`, `status` |
| Money, new | `fee_amount` (a printed fee becomes its own small expense row, per `full-ledger-spec.md` §3.4), `tax_amount` |
| Time | `occurred_at` |
| Time, new | `time_precision`: `second`, `minute` or `day`. Replaces the "UTC midnight means day only" guess and the minute recovered from a note suffix (`58-dedup-engine.js:150`) |
| Foreign currency | `fx_amount`, `fx_currency` |
| Foreign currency, new | `fx_rate`, only as printed |
| The person's instrument | `account_tail`, `account_kind`, `balance_after` |
| The person's instrument, new | `available_limit` (cards), `holder_name` (what own-name detection needs) |
| The other side | `counterparty` (raw, always kept), `counterparty_display` |
| The other side, new | `counterparty_account_tail`, `counterparty_bank`, `counterparty_kind`: `person`, `merchant`, `bank`, `wallet`, `self`, `unknown` |
| Card repayment | `card_tail` |
| Words | `memo`, `memo_display`, `type_code`, `reference_number` |
| Words, newly filled | `channel`: `QR`, `POS`, `ATM`, `online`, `transfer` |
| Meaning | `signal` (§5); `node`, for any kind; `category_hint` kept so old clients keep working (`category-tree-spec.md` C5) |
| Investment block, new | `symbol`, `side`, `quantity`, `unit_price`, `order_id` |
| Loan block, new | `contract_tail`, `installment_no`, `installment_count`, `due_date`, `principal`, `interest`, `remaining_balance` |
| Notice block, new | `statement_date`, `due_date`, `min_payment`, `closing_debt` |
| Bill block, new (wave 2) | `biller`, `customer_code`, `period` |
| Receipt block, new (wave 2) | `service_type`, `order_id`, `paid_with_tail`, `line_items[]` (names only) |
| Provenance, new | `v: 2`; `src`, a per-field map of `printed`, `template`, `model`, `heuristic`; `sender_kind`: `bank`, `wallet`, `gateway`, `broker`, `lender`, `biller`, `receipt`. `_transport` and `_sender_auth` unchanged |

Rules of the contract:

- **`reference_number` still has no ledger column, on purpose.** It serves
  dedup and does not belong on a ledger row.
- **Receipts annotate, never create.** A receipt joins an existing row by
  (day, amount). Grab receipts carry home addresses: extract service type,
  total, time, paid-with and booking id only. Never an address.
- **The mapping is the wire.** Any field added to the reading must be added to
  `_toReading` (`worker.mjs`) and `normaliseReading` (`ingest.mjs`) in the same
  change, or every row seals without it for good, because a box is never
  amended (`card-repayment-routing-spec.md` §7.4). Landing 3 replaces the two
  hand-written mappers with one shared field list both import.
- **The device reads v1 and v2 indefinitely** (R14). `v` absent means v1.

## 5. Signals: what the mail itself can say (R3)

A closed list. Each is decidable from the mail alone and each maps to an
existing taxonomy node, so no new vocabulary is needed. Direction is a
separate field, so one signal covers both ways. When the mail does not say,
the signal is null; it never falls back to "probably a purchase".

| Signal | Evidence in the mail | Node | What the device proposes |
|---|---|---|---|
| `purchase` | merchant or POS row | expense, by merchant | Chi tiêu |
| `bill_payment` | "thanh toán hóa đơn", a biller row | expense (utilities and the like) | Chi tiêu |
| `fee` | "phí thường niên", "phí SMS", "phí quản lý" | expense (fees) | Chi tiêu |
| `p2p` | the counterparty is a person | none | Chi tiêu or Thu nhập; the lending pass may override |
| `own_transfer` | the printed holder name equals the counterparty name | `bankbank` | Chuyển khoản nội bộ |
| `card_repayment` | "thanh toán thẻ tín dụng", "dư nợ thẻ", and no merchant named | `cardpay` | Trả nợ thẻ, card pre-selected when `card_tail` is one the person owns |
| `wallet_move` | a top-up or withdrawal between a bank and a wallet | `wallet` | transfer, when the person owns that wallet |
| `cash_move` | ATM withdrawal, cash deposit | `cashout`, `cashin` | pair with Tiền mặt |
| `savings_move` | "mở / tất toán tiền gửi", "chứng chỉ tiền gửi" | `savings`, `termdeposit` | transfer or Đầu tư |
| `broker_funding` | cash into or out of a securities account | `investfund` | transfer |
| `fx_exchange` | a currency purchase | `fx` | transfer |
| `securities_trade` | "khớp lệnh mua / bán" | `stock`, `fund`, `bond` | Đầu tư or Bán đầu tư |
| `yield` | dividend, coupon, savings interest, "nhận lợi nhuận" | `dividend`, `savinterest` | Thu nhập |
| `salary` | payroll wording from an employer counterparty | `wage` | Thu nhập: Lương |
| `refund` | "hoàn tiền", a reversal, cashback | `purchaserefund`, `cashback` | Thu nhập: Hoàn tiền |
| `loan_disbursement` | "giải ngân" | `bankloan`, `consumerfinance`, `bnpl` | Đi vay |
| `installment` | "trả góp kỳ n", an instalment debit | `repayment:pay` | Trả nợ |
| Notices: `card_due`, `installment_due`, `statement_ready` | no money moved | none | account facts only (§6) |

Two constraints carried from shipped work:

- **A card number in the mail is not proof of a repayment**
  (`category-tree-spec.md` E7). `card_repayment` requires that the mail names
  no merchant: no memo or counterparty at all, or the issuer as counterparty.
- **Seller payments are structural, not verbal** (E12, E13). A
  virtual-account prefix (`99MM…`, `ZLP`, `PAYOO`, `MS0xP/T`, `VQRQ`,
  `PHATLOC`), a legal-entity account name or a POS-generated memo marks a
  payment to a seller with near certainty, and zero overlap with social memos
  on two real mailboxes. These marks set `counterparty_kind: merchant`. They
  answer WHO, so by E14a they never displace a WHAT answer.

This list replaces the three-value `flow`, the five-value `transaction_type`
staging discards, and nine of the fifteen free-text regex families on the
device.

## 6. Mail that moves no money (R5)

Card due notices, instalment reminders and "your statement is ready" mail are
in scope and are not transactions: `dedup_fp` hashes amount and direction, and
the review queue has nothing to import.

- Same table (`email_transactions`), same sealed box, same opener, same
  retirement RPC.
- One new **clear** column, `row_kind`: `txn` or `notice`. It must be clear
  because the review badge is a head-only count and must not count notices.
  It reveals that a person received a financial notice and nothing about its
  content. Per the rule in `dedup-flaws-review.md` C4, this is recorded in the
  umbrella spec's "metadata is not sealed" entry as a deliberate trade.
- The device opens a notice and updates account facts quietly: `due_day`,
  minimum payment, and the card's closing debt as a drift check. It shows as
  one quiet line on the account tile ("Đến hạn 25/09 · tối thiểu
  1.200.000đ"). Never a review card, never a push.

## 7. Which mail is read (R12, R18)

| Class | Fetched today | This spec |
|---|---|---|
| Banks, wallets, gateways | yes | wave 1 |
| Brokers and investing apps | yes, misfiled under `WALLETS`, staged as expenses | wave 1: own `sender_kind`, the investment block |
| Consumer finance and pay-later | yes, same | wave 1: own `sender_kind`, the loan block |
| Card due and statement notices | yes, from bank senders | wave 1: the notice block |
| Merchant receipts (Grab, ShopeeFood, Shopee, Foody, Apple, Tiki, Lazada) | matched in code, deliberately left out of the Gmail query | wave 2, under consent v6 |
| Utilities, telcos, insurers | not in the registry | wave 2, same consent bump |
| Crypto exchanges | no | dropped for now (decision) |

Wave 1 needs no consent change. Wave 2 asks once, for receipts and bills
together.

**The sender gate (R18).** The Gmail query is `from:<bank domain>`, which also
matches any employee of that bank. On 2026-09-16 one backfill read the private
mailboxes of about 26 bank staff (relationship managers, loan officers); all
50 of those mails went to the model, and their hand-written subjects, with
names and phone numbers typed with spaces or dots, were cached in plaintext.
From landing 1:

- A person-shaped address at a bank's domain (a `firstname.lastname` local
  part with no role word such as `info`, `noreply`, `ebanking`, `cardcenter`)
  is never sent to the model and never cached. The free local tiers still run
  on it, so a real notice from an odd address is still read.
- The Apps Script stops caching a fingerprint under a free-mail forwarder's
  address (a person who hand-forwards one receipt from their own Gmail).

## 8. How a mail is read

### 8.1 The cascade

1. **Junk cache.** Unchanged in purpose: a header-only decision, before the
   body is fetched, keyed `(sender, subject shape)`. The subject normaliser
   gains a phone rule and a masked-token rule, and a subject that still looks
   dirty after normalising is stored as a hash: an exact-match cache never
   needs readable text.
2. **Known format.** A stored label map (§8.2) applied by the structural
   reader. Local, free, carries every v2 field.
3. **Legacy template.** The existing v4 regex templates, as a fallback tier
   until the format table covers their shapes. No logic-version bump: a bump
   re-derives every format through the model at once, which is what stalled
   backfills on 2026-09-02. When a v4 template matches but lacks v2 fields,
   the structural reader upgrades it on that same mail with no model call
   (the upgrade-on-hit pattern from the card-repayment work).
4. **Structural reader on an unknown format.** Reads the mail's HTML table as
   a table (not as flattened lines) over the shared label vocabulary, behind
   the same confidence gate as today (amount, a timestamp, and a counterpart
   or memo). On success it writes the format it just read, so the walk is paid
   once per format.
5. **The model.** Only when 1 to 4 cannot answer, within the rules of §10.
   Its answer cites the label it read each field from, which makes writing the
   format a lookup instead of a regex derivation. The format is still proven
   by replaying it on the same mail: no proof, no format.
6. **The signal detector** (§8.4) runs after any tier.

A hold is still a throw, never an outcome. "Not a transaction", "unreadable"
and "could not ask" stay three different things.

### 8.2 What a format is (R6)

- **Key:** `(provider, label-set signature)`. The signature is a hash of the
  ordered labels found in the mail's table. Subject noise stops mattering
  (MoMo's venue names), sender-address variants stop mattering (VIB sends one
  format from `info@myvib.vib.com.vn` and `myvib.info@vib.com.vn`), and a
  credit variant with different labels is its own format automatically.
- **Body:** a label map ("the row labelled *Tên người hưởng* is
  `counterparty`", "*Số dư* is `balance_after`", "*Phí (bao gồm VAT)* is
  `fee_amount`"), number and date parse modes, the facts that are properties
  of the format (`sender_kind`, `account_kind`, `currency`), and the format's
  `signal` when the subject or the labels themselves state it.
- **Direction is read from each mail**, from a printed sign or a debit/credit
  label. It is frozen in a format only when a label itself states it ("Số
  tiền ghi nợ"). No evidence means null, and a null direction goes to the next
  tier.
- **Regex anchors survive only for prose-shaped mail** (SMS-style one-liners).
- **Seeds.** `source = seed`, hand-written, shipped in a migration. The
  learner never overwrites a seed: when a seed stops matching it writes a
  sibling format and leaves the seed in place.
- **Home:** a new table, not more columns on `sender_fingerprints`, which
  stays the junk cache and the legacy template store.

### 8.3 The prompt (R8)

A shared core plus one block per sender class. `senders.mjs` already knows the
class before the call, once the `WALLETS` group is split into wallet, gateway,
broker and lender. A small model reads a short, relevant prompt better than a
universal one, and a shorter prompt spends less of a free quota.

The core, as agreed (rules marked NEW answer a finding in §2):

```
You read ONE email that a Vietnamese bank, e-wallet, broker or lender sent to
its customer, and report what it states. Vietnamese, English, or both.

mail_kind: exactly one of
  transaction  the mail reports money that moved, or a card that was charged
  notice       a financial notice with no movement: payment due, statement
               ready, instalment reminder
  other        anything else: marketing, OTP, login alert, survey.
               Set every other field to null.

RULES
1. Report only what the mail prints. Null always beats a guess. Never compute,
   convert, translate, shorten or tidy a value.
2. NEW. For every field you fill from a labelled row, write that label EXACTLY
   as printed into `labels` under the same key (labels.amount = "Số tiền giao
   dịch"). If the value came from a sentence, write "~". These labels teach a
   local reader this format so later mails never reach you: a wrong label is
   worse than "~".
3. amount: the figure that actually moved, as a positive number with no
   separators. Not the balance, not a fee, not a limit, not a promotional or
   cashback figure. amount_raw: the same figure copied character for character.
4. NEW. direction: debit when money left the customer's account or card,
   credit when it arrived. Accept only printed evidence: a sign (+ or -), a
   label ("ghi nợ" / "ghi có", "tiền ra" / "tiền vào"), or the mail's own
   wording ("bạn đã chuyển", "bạn vừa nhận"). No evidence: null.
5. occurred_at: ISO 8601 with an offset (+07:00 when none is printed).
   occurred_at_raw: copied verbatim. NEW. time_precision: second, minute or day.
6. currency, fx_amount, fx_currency: as today. NEW. fx_rate only if printed.
7. NEW. Two sides. account_tail, account_kind, balance_after, available_limit
   and holder_name describe the CUSTOMER'S own instrument. counterparty,
   counterparty_account_tail, counterparty_bank and counterparty_kind describe
   the other side. holder_name is the customer's own name where the mail
   prints it (the greeting, the remitter on a debit, the beneficiary on a
   credit). counterparty_kind: person, merchant, bank, wallet, self or
   unknown. Answer self only when the printed counterparty name equals
   holder_name letter for letter, ignoring case and accents.
8. counterparty and memo: copied in full, verbatim, never paraphrased, never
   judged for meaning.
9. NEW. fee_amount only when printed as its own figure. status as printed.
10. card_tail: as today (the card being paid down, never the funding account).
```

- **Bank and wallet block:** the §5 signal list with one-line definitions; the
  existing tie-break (when unsure between a transfer-type signal and
  `purchase` or `p2p`, answer `purchase` or `p2p`: a hidden expense is worse
  than a visible wrong one); the node menu limited to expense, income and
  transfer codes.
- **Broker block:** the investment fields and nodes. **Lender block:** the
  loan fields. Biller and receipt blocks arrive with wave 2.
- **Rules carried over unchanged:** never guess; the model never computes a
  conversion; "a wrongly claimed credit card invents a debt".
- **Unchanged behaviour:** the model reports a failed, declined, cancelled or
  pending status and the worker drops that mail, as today.
- **A mail carrying several transactions** (a broker's daily order summary)
  answers `mail_kind: transaction` with `multi: true` and nothing else. The
  worker parks it and the scoreboard counts it, so the real volume is known
  before anything is built. If the volume is real, the natural home is the
  statement lane, which already turns one message into N rows. The email
  idempotency key is not widened.
- **Consent coupling stands:** any change to what is sent to the model changes
  the consent sheet in the same commit (`llm.mjs`, `75-consent-ui.js`).

### 8.4 Signals and nodes on mail the model never sees (R9)

91% of rows come from a local tier, which carries no judgment.

- A format's signal is frozen in the format only when the subject or the
  labels state it (VIB's "Thanh toán thẻ tín dụng VIB thành công" is always a
  card repayment).
- For every other format, **one deterministic server module** reads
  `type_code`, the transaction-kind row, the memo and the two-sides fields. It
  is where the four device copies of the card-repayment wording, the three
  copies of the own-name check, the salary, refund and fee keyword lists, and
  the seller marks of E12 all move to.
- Rules induced by the model were considered and rejected: unreviewable
  regexes written by a small model are the correctness risk this design rules
  out.
- On model-read mail the detector also runs as a cross-check. If it disagrees
  with the model, the signal is null and the row goes to "Cần bạn xem".
- A signal maps to a node by table lookup. Merchant nodes keep the existing
  registry and keyword path (`classify.mjs` `enrichCategory`).
- **The worker's keyword copy lags the device's between deploys**
  (`category-tree-spec.md` E16). The device keeps checking a sealed node
  against today's keywords (`fhPipeNodeOk`); the same check extends to a
  sealed `signal`.

## 9. From a signal to a pre-selected kind, on the device (R10)

First match wins:

1. The person's explicit pick, or a lesson learned from one.
2. A signal plus a matching thing the person owns: `card_repayment` with a
   `card_tail` they own; `own_transfer` or `wallet_move` with a
   `counterparty_account_tail` they own, which pre-fills the counterpart
   account (never pre-filled today); `securities_trade` with a symbol matching
   a position.
3. A signal alone: the kind is proposed and the missing half rests as an unset
   row on the card ("Vào tài khoản nào?" showing "Chưa rõ"). It is not a
   prompt (E14).
4. The lending pass: a counterparty who owes the person or whom they owe. Its
   veto rules are unchanged (`lending-capture-spec.md` Q15).
5. Direction alone: Chi tiêu or Thu nhập.

Placement follows §3: a pre-selection resting on a printed fact goes to the
ready list; one resting on the model's judgment goes to "Cần bạn xem".

The old free-text regexes stay as a fallback for v1 payloads only. Each is
deleted once the scoreboard shows its signal at parity on the test set.

## 10. Living on the free tier (R7)

The model is a scarce resource shared by every user and by four features.

1. **One call, not two, for model-read mail.** Category and node come from the
   extraction answer. Template-read mail with an unknown merchant goes through
   the batch classifier at lowest priority (its HTTP 400 is a landing-1 fix).
2. **Priority when quota is short:** extraction of a new format, then
   statement verdicts, then merchant classification. A missing category costs
   one tap; a missing transaction costs trust.
3. **Respect the daily wall.** The code already tells a per-minute 429 from a
   per-day one and nothing uses it. On a per-day 429 all model calls pause
   until the Pacific-time reset, recorded in `model_pause`.
4. **Park the mail, do not hold the mailbox.** Today one model-needing mail
   with no quota holds the whole mailbox and freezes its cursor. Instead, that
   one message's id is remembered, the rest of the window finishes, and a slow
   lane works the parked list as quota returns. Nothing is lost, because the
   id is remembered. **This is a deliberate change to "the cursor moves last,
   and only on a finished window"** (umbrella spec §9) and was approved as
   such. Before designing the table, read `mailbox_message_attempts`, which is
   live and unrecorded in the repo and may already hold part of this.
5. **Seeded formats** for the top banks and wallets by volume in the test set,
   so a new person's first 90-day read costs close to zero model calls. On the
   free tier this moves "model calls per 100 rows" more than any other change.

The goal is measured as **model calls per 100 staged rows in steady state,
target under 2**, with first contact reported separately.

## 11. Consent and privacy

**The promise, kept (R13).** Consent v4 says a new format is sent to Google's
AI "một lần" and that "những email sau cùng mẫu không được gửi đi nữa". Two
things break it today, and one leak sits beside them:

| Gap | Fix | Landing |
|---|---|---|
| Twelve formats pay the model on every mail | Fix the false foreign-currency refusal and the venue-name subjects; then a hard cap: one model read per format per reader version. A format that still cannot produce a template is parked and goes on the seed backlog for a hand-written map. A retry is allowed only when the reader's code has changed, not when a new mail arrives. | 1 |
| The merchant classifier sends `counterparty + memo` from later mails, which can carry a person's name | Send the merchant name only, never the memo, and never call it when the counterparty is a person. This is the promise consent v5 already makes for statement rows. | 1 |
| Bank staff mailboxes read, sent to the model and cached (§7) | The sender gate | 1 |

"Once per format per reader version" is stated in plain words in consent v6,
which arrives with wave 2 anyway.

**The scrub.** Plaintext already in production, previewed read-only on
2026-09-21 (the row-level preview stays on the founder's machine, outside the
repo):

| Item | Rows | Action |
|---|---|---|
| Person-shaped senders at bank domains, `sender_fingerprints` | 50 | delete |
| A family member's Gmail stored as "sender" | 2 | delete |
| Masked account token inside a subject | 2 | rewrite in place, with the identical rule added to both normalisers, so cache hits survive and no mail is re-sent |
| Year-only digit runs | 36 | leave; not personal, only cache fragmentation |
| `extract_miss_labels` (a person's name, salutations, disclaimer fragments, mask characters, merchant and city values) | 101 | delete all; nothing reads the table, and the 43 genuine labels are saved in the preview |

**Order matters:** the sender gate deploys before the delete, or the next poll
re-sends the same staff mail to the model and recreates the rows. The label
harvester's loop bug (after accepting a label line it tests the next line,
that label's *value*, as another label) is fixed in the same landing.

**Known and accepted for now:** the same account holder's full name sits in a
comment in `labeltable.mjs` and in migration `0115`, and therefore in git
history of a public repo. Decision 2026-09-21: handled later; the product is
in alpha with teammates.

**Forwarding as a courier changes where forwarded plaintext travels:** it
passes through a Supabase Edge function in transit, as direct-read mail
already does; today it is read only inside Google. Nothing in the consent text
contradicts this. The umbrella spec's trust-model table (§3) gets one line
updated.

## 12. Old rows and old mail (R14)

- **Decided rows** (imported or dismissed) are never re-staged.
- **Pending rows** are re-read under v2 per mailbox: delete and re-stage. They
  carry no tombstone, so this is safe, and it is small (33 pending rows across
  all users on 2026-09-21).
- **Already-imported rows with a wrong direction:** no ledger is ever
  rewritten automatically. The device runs a one-time check listing imported
  expenses whose stored counterparty reads as a remitter, under "Có thể là
  tiền vào", with a one-tap flip using the existing convert-kind writers.

## 13. The scoreboard (R16)

Four co-equal goals need four numbers, or the last one argued for wins.

| Goal | Number |
|---|---|
| Fewer taps | share of rows importable with zero edits; average edits per row |
| Fewer model calls | model calls per 100 staged rows, first contact and steady state separately |
| Coverage | share of transaction-bearing mail that stages with the right kind proposed, by kind |
| Correctness | share of pre-selected attributes a human did not change; wrong-direction and wrong-kind rows, which must be zero |

Per E14a, every change also reports **displacement**: how many prior correct
answers it replaced.

- **Test set:** the founder's own mailbox, 365 days (broker, lender and salary
  mail is monthly or rarer; 90 days holds too few), every sender in the
  registry plus the receipt domains. Pulled by a local script to a git-ignored
  folder beside `research/statements/`. The repo is public and Vercel serves
  its root: real mail never enters it. Tests in the repo use synthetic
  fixtures only.
- **Already on disk:** `research/statements/dryrun-hien-p1..p8.json`, 775
  parsed mails without raw bodies, from the category-pattern research.
- **Labels** are drafted by matching each mail to the founder's existing
  ledger rows (answers a human already confirmed); only disagreements and
  unmatched mail are reviewed by hand.
- **Harness:** local, calling the extraction modules directly. No Edge
  function, nothing staged, production caches untouched, model calls off by
  default with a small explicit allowance when the prompt itself is evaluated.
  `mailbox-dryrun` is not used for scoring until it is truly dry: today it
  writes fingerprints, tallies, miss labels and merchant concepts to the live
  tables.
- **Needs:** a one-time local Gmail authorisation (`tools/gmail-oauth-probe.js`;
  no credential file exists locally). A local read through its own token does
  not reconnect or re-mint the app's grant.
- **An open fact the test set will settle:** why credit mail is scarce (2
  credits in 775 rows). The direction bug is real but the table reader is 0.2%
  of reads, so it cannot be the cause. The likeliest explanation is upstream:
  the banks that were read mostly do not email money coming in.

## 14. Landings and rollout (R15, R17)

| Landing | Contents | Migrations | Deploys |
|---|---|---|---|
| 0 | Cursor, lease and `0136`/`0145` back in `main`: **done** (`ee28e34`). Remaining: `mailbox-dryrun` committed (it is deployed at v7 and untracked) and made truly dry; confirm what is live against `main`. | none | `mailbox-dryrun` |
| 1 | The fixes that need no redesign (§15), the two consent fixes and the sender gate (§11), the scrub once its statements are approved. | one data fix: strip frozen `direction` from templates whose format carries both directions; the scrub | `mailbox-sync`, client |
| 2 | Contract v2 (§4) and a device that reads both payload versions. | none | client only |
| 3 | Structural reader, format table with seeds, parking, quota pause wiring, the signal detector, the prompt, `row_kind`, the reader version column, one shared field list for both mappers, forwarding as a courier. | three: formats and seeds; parked messages and pause wiring; `row_kind` and reader version | `mailbox-sync`; one Apps Script paste |
| 4 | Pre-selection from signals (§9). The old regexes retire as parity is shown. | none | client only |
| 5 | Consent v6, receipts and bills. | one or two | `mailbox-sync`, client |

**Rollout of the reader (R15):** a per-mailbox reader version, a plain
workflow column on `mailbox_grants`, default 1. The two founders' mailboxes go
to 2 first. The scoreboard gates the code; two clean weeks of real queues gate
the rollout to everyone; then the v1 cascade is deleted in the following
commit. To contain the cost of two paths, the v1 cascade is frozen the day v2
lands and gets no fixes except security.

**Working rules for this epic:**

- Its own git worktree (`.worktrees/email-reading-v2`, branch
  `feat/email-reading-v2`), per `COLLABORATION.md`.
- Migration numbers are claimed in `AGENT_SYNC.md` when each landing starts,
  never in a block: a number is claimed when it is applied, and a held number
  is a lost number. Next free on 2026-09-21: `0146`.
- A territory entry is posted under **Open** before the first code edit.
- **Before any Edge Function deploy, diff `get_edge_function` against `main`**
  (the rule `ee28e34` paid for).
- Extraction changes that still exist in the Apps Script twin are mirrored
  there until landing 3 retires its reader, and a paste bumps
  `PIPELINE_VERSION`.
- Every landing appends an entry to the umbrella spec's Part 3, in the same
  commit as its deploy.

---

# Part 2. Technical appendix

## 15. Landing 1: the fixes that need no redesign

| # | Fix | Where |
|---|---|---|
| 1 | Money coming in: read a `+` sign and credit wording ("ghi có", "nhận tiền", "tiền vào", "số tiền nhận", a remitter row with no beneficiary row); when neither direction is evidenced return null so the mail goes to the next tier | `labeltable.mjs:587`, `parseAmountCell` |
| 2 | `status` and the reader's `transaction_type` reach the sealed row | `worker.mjs` `_toReading`, `stage.mjs:132` |
| 3 | The email's time is kept on transfer, card payment, loan, repayment and investment | `72-txn-review.js:1361-1419, 1490-1496` |
| 4 | A family-scoped row keeps its reviewed node at promote | `56-csv-import-ui.js:3575-3588`, `50-sheets-expense-capture.js:603` |
| 5 | Statement classifications fee, refund and salary survive the hand-off | `77-statement-capture.js:98, 121` |
| 6 | The false "foreign currency" refusal on VIB card mail, a domestic QR bill and train tickets | `templates.mjs` `_readsForeignCurrency` |
| 7 | MoMo ticket subjects stop fragmenting by venue name | `normalizeSubjectTemplate`, both twins |
| 8 | `classify_merchant_batch` HTTP 400 | `classify.mjs:337-400` |
| 9 | The model budget ledger records nothing | `model_budget`, `model_pause`, migration `0116` |
| 10 | The consent fixes, the sender gate, the subject hygiene rules, the label harvester's loop bug, HTML entities decoded before matching | §11; `senders.mjs`, `extract.mjs`, `labeltable.mjs` `unknownLabels` and `_isValueShaped`, `mailtext.mjs` |
| 11 | `mailbox-dryrun` committed and made dry | `supabase/functions/mailbox-dryrun/` |

Smaller defects found in the same inventory, for the same landing where they
are cheap: a dead branch in self-transfer detection (`_isSelfTransfer(party)`
runs before `party` is assigned, `57-csv-import-review.js:826` and `:840`);
quick review tests `flow === 'in'`, which never matches (`76-quick-review.js:361`);
`QR.inst` is never set, so `transactions.instrument` is always null for family
quick-review rows (`76:578`); in `fhResolveRepaidCard` the memo-digit match
returns before the single-card default (`72-txn-review.js:721, 724`); the Apps
Script normaliser lacks the two month rules.

## 16. Open questions

- **Why credit mail is scarce.** Settled by the 365-day pull (§13).
- **The parked-message table.** Whether `mailbox_message_attempts` (live,
  unrecorded) already covers part of it. Dump it from the catalog first.
- **`tax_amount` and `unit_price`.** Kept; the two fields to cut first if the
  contract needs trimming.
- **Multi-transaction mail.** Counted in wave 1, built only if the volume is
  real.
- **The repo's visibility.** Deferred by decision; see §11.
- **Auto-commit of any proposed kind.** Out of scope; propose-only stands
  until precision is measured.

## 17. Decision log

Grilling session, 2026-09-21.

| # | Decision |
|---|---|
| R1 | Four co-equal goals: fewer taps, fewer model calls, coverage, correctness. Kept compatible by the four rules of §3, not by ranking. |
| R2 | The server states printed facts and mail-intrinsic signals. The device decides the kind. |
| R3 | A closed list of 17 signals and 3 notice types, each mapped to an existing taxonomy node. Replaces `flow`, the discarded `transaction_type`, and most device-side free-text regexes. |
| R4 | Payload v2: the field list of §4, all nullable, all sealed, with per-field provenance, a version, and `sender_kind`. The device reads v1 and v2 indefinitely. |
| R5 | Mail that moves no money: same sealed table, one new clear column `row_kind`; notices update account facts quietly and never become review cards. |
| R6 | A template is a label map keyed `(provider, label-set signature)` in a new table. Regex anchors only for prose mail. The HTML table is read as a table. Direction is read per mail and frozen only when a label states it. No logic-version bump; v4 templates upgrade on use. Seeds are never overwritten. The junk cache stays keyed `(sender, subject shape)`. |
| R7 | The free tier and `gemini-3.5-flash-lite` stay. Category from the extraction call on model-read mail; priority extraction, then statement verdicts, then merchant classification; a per-day 429 pauses until the Pacific reset; a model-needing mail is parked by id instead of holding the mailbox (a deliberate change to "cursor moves last"); hand-seeded formats. |
| R8 | The prompt is a shared core plus one block per sender class. The model cites the printed label per field. `mail_kind` is `transaction`, `notice` or `other`. Multi-transaction mail is flagged, parked and counted. |
| R9 | Signals on mail the model never sees come from one shared server-side detector, which also cross-checks the model; disagreement gives null. Model-induced rules rejected. |
| R10 | Device precedence from signal to kind: explicit pick or lesson; signal plus an owned match; signal alone; the lending pass; direction alone. |
| R11 | Forwarding stays, as a courier: route, junk-check, post raw HTML to `/ingest`. The Apps Script's own prompt, template code, sealing and key mint retire. |
| R12 | Wave 1, no consent change: banks, wallets, brokers, consumer-finance lenders, card due notices. Wave 2, one consent v6: merchant receipts and bills. Crypto exchanges dropped for now. |
| R13 | The once-per-format promise is kept and the code is made to honour it: one model read per format per reader version; the merchant classifier sends the merchant name only and never for a person. |
| R14 | Decided rows never re-staged; pending rows re-read per mailbox; imported wrong-direction rows surfaced by a one-time device check with a one-tap flip, no automatic rewrite. |
| R15 | Rollout by a per-mailbox reader version: the founders first, two clean weeks, then everyone, then the v1 path deleted in the following commit. Chosen over everyone-at-once, an Edge-secret allowlist, shadow mode, and a device-only gate, because the riskiest new code is the reader and only a per-mailbox version protects the other users from a reader regression at a cost six users can carry. |
| R16 | A four-number scoreboard on the founder's own 365-day mail, local and git-ignored, labels drafted from the ledger; it gates every landing and reports displacement. |
| R17 | One spec (this one), six landings, migration numbers claimed per landing, its own worktree, a territory entry before the first edit; the umbrella spec, the extraction reference and `CLAUDE.md` corrected alongside. |
| R18 | The sender gate: a person-shaped address at a bank's domain is never sent to the model and never cached; the Apps Script stops caching under a free-mail forwarder's address. Added to R13 after the scrub preview. |

## 18. Related documents

- `docs/specs/effortless-transaction-logging-spec.md`: the end-to-end chain;
  §16 is superseded here; Part 3 is the release log.
- `docs/specs/email-extraction-reference.md`: today's tiers and label map;
  rewritten after landing 3.
- `docs/specs/category-tree-spec.md`: the tree, the device cascade, the E
  series.
- `docs/specs/transaction-review-spec.md`, `docs/specs/dedup-flaws-review.md`:
  the review surface and the dedup engine that consume the payload.
- `docs/specs/full-ledger-spec.md`, `borrowing-lending-spec.md`,
  `lending-capture-spec.md`, `investment-spec.md`, `account-setup-spec.md`,
  `card-repayment-routing-spec.md`: the attributes worked backward from.
- `docs/specs/statement-capture-spec.md`: the sibling lane, unchanged.
- `docs/archive/mailbox-sync-live-v49/README.md`, `AGENT_SYNC.md` (2026-09-21):
  what was re-landed and the deploy rule it produced.
- `docs/PDPL-COMPLIANCE.md`: consent and erasure obligations.
- `research/category-patterns.html` (untracked): the seller-versus-person
  signal research this spec's `counterparty_kind` rests on.
