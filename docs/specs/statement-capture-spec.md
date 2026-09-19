# Statement Capture — from a bank's statement file to the review queue

A bank or e-wallet emails a statement: one spreadsheet, a month (or three) of
transactions, usually locked with a password. This spec covers how that one
email becomes many rows in "Duyệt giao dịch", reviewed and imported exactly like
rows captured from ordinary transaction emails.

> **Status, 2026-09-19.** Design agreed after a design interview (decision log,
> §16) and **built the same day** on branch `feat/statement-capture` (worktree
> `.worktrees/statement-capture`), one release (big bang, decision S22). **Nothing
> **LIVE since 2026-09-19**: client on Vercel (SW v538); migrations `0139`–`0142`
> applied and verified by query; `push-send` v21, `merchant-concepts` v1 and
> `mailbox-sync` v50 deployed, first ticks clean. **Not yet exercised by a real
> person**: capture starts for someone only after they accept consent v5 in the app,
> and no one has. §14 has the deploy record and why `mailbox-sync` must never be
> deployed from `main`.
> §6 lists what is built and what is not, plainly.

> **Audience & layering.** Part 1 (Behaviour) is for everyone. Part 2 (Technical
> Appendix) is for engineers and Claude sessions. §15 records what three real
> statement files look like, because the design leans on those facts.

> **How this relates to its siblings.** `effortless-transaction-logging-spec.md`
> is the capture pipeline this feature plugs into: same mailbox connection, same
> sender list, same sealing, same review queue. `transaction-review-spec.md` owns
> the review screen. `full-ledger-spec.md` owns kinds, transfer pairs and anchored
> balances. `personal-ledger-spec.md` owns the personal key. Read those first;
> this document only describes what is different for a statement.

---

# Part 1 — Behaviour

## 1. Summary

- Everything **after** "rows are in the queue" is unchanged: the review screen,
  the dedup engine, kinds, the Gia đình / Cá nhân choice per row, import, and
  retirement.
- What changes is the front end of the chain, and the password is why. The
  server cannot open a locked file, so **parsing happens on the device, on a tap**,
  not on the server in the background.

| | Transaction email | Statement email |
|---|---|---|
| Who parses | Server, nobody involved | Your device, after one tap (plus a password if the file is locked) |
| Parser | Email reader (template, label-table, model) | The spreadsheet reader and column mapper that file import already uses |
| Who writes the queue rows | Server, sealed to your public key | Your device, encrypted under your personal key |
| Steps | email → rows | email → **locked card** → unlock → rows |
| Push | When rows are queued | When the locked card arrives |

- A statement serves two jobs at once. For a bank that also sends per-transaction
  emails it is a **gap filler** (fees, interest, money-in the bank never emailed);
  most of its rows are already booked and are set aside as "Đã có trong sổ". For a
  wallet or bank that sends **only** statements it is the whole feed.

## 2. Why this exists

- Some sources never email per transaction. MoMo sends a statement on request;
  several banks email money-out but never money-in. For those, the statement is
  the only way the ledger can be complete without typing.
- File import already reads these files, but only if the person finds the email,
  saves the attachment on a phone, opens the app, and picks the file. The mailbox
  connection already sees the email. Asking the person to carry the file across is
  the bookkeeping chore this product exists to remove.

## 3. The journey

### 3.1 Arrival

Statement capture rides the existing Gmail connection. No new Google permission
is needed (`gmail.readonly` already covers attachments). A mail counts as a
statement candidate only when it comes from the **known sender list** and carries
an `.xlsx` or `.csv` attachment. Whether it actually *is* a statement is decided
once per mail format (§9) and remembered for every user.

The server fetches the attachment, **seals it to the person's personal key**, and
stores the sealed file. It then queues one **statement card** and sends one push:
**"Có sao kê mới chờ bạn mở"**. The push names no bank and no amount.

### 3.2 The locked card

The card sits in "Duyệt giao dịch" in its own section, above the transaction
cards. Its title comes from the email, for example **"Sao kê MoMo · 20/06 – 18/09"**;
when the period could not be read the file name stands in. Statements found while
reading mailbox history arrive folded under **"Sao kê cũ"**, newest first, so a
first connect does not open on a wall of backlog. The person decides when each one
expands.

The card has two verbs: **Mở sao kê**, and ✕ (arm-then-confirm, gone for good).

### 3.3 Unlock

One path for every statement:

1. Tap **Mở sao kê**. The device downloads the sealed file and opens the seal with
   the personal key. If the personal ledger is locked on this device, the card says
   to unlock it on the Cá nhân tab first.
2. If the spreadsheet is password-protected, the existing password sheet appears
   ("File này có mật khẩu"). The password is used on the device only. An opt-in
   switch, **"Nhớ mật khẩu cho sao kê {bank} trên máy này"**, keeps it on this
   device, encrypted under the personal key. It is never sent anywhere. An unlocked
   file skips this step entirely.
3. The columns are read and the reading is **proved by arithmetic** (§10). When
   the proof passes, nothing is asked. When it cannot pass (a file with no balance
   column and no totals), the person is shown which column was read as what and
   confirms or backs out. A confirmed reading is remembered per sender and header
   shape on the device, so next month is password-only, or tap-only.
4. A summary line: **"Tìm được 145 giao dịch · 16 mới · 126 đã có trong sổ · 3 thất
   bại đã bỏ qua"**, and the **account** the statement belongs to, read from the file
   and the bank ("Ví điện tử · MoMo ••1217"). The rows are written to the queue in
   one step, the statement card is marked done, and the sealed file is deleted.

### 3.4 The rows

The rows are now ordinary cards in "Duyệt giao dịch", and everything in
`transaction-review-spec.md` applies: tick, untick (keep for later), ✕, edit,
per-row Gia đình / Cá nhân, bulk tools, "Nhập N". Differences worth stating:

- **All kinds are on.** Money-in gets the three-way choice (Thu nhập / Chuyển
  khoản nội bộ / Thu nợ); card repayments are "Trả nợ thẻ". A statement-only
  wallet would otherwise show a wrong "Còn lại" every month.
- **Every row is tagged to the statement's account**, except a wallet payment
  that was funded by a linked bank (§11), which is tagged to that bank's account.
- **Rows already booked are written too**, collapsed under "Đã có trong sổ" with
  "Bỏ qua hết". A guess never deletes a row before a person has seen it
  (`docs/ARCHITECTURE.md`: an exact key may block, a guess may only flag).
- **A row whose amount differs from the booked one** (a foreign card purchase:
  the email carried our estimate, the statement carries the bank's final figure)
  reads "Đã có trong sổ · lệch 3.200đ" with one button, **"Cập nhật theo sao kê"**.
- **A row removed with ✕ stays removed** when the same statement is sent again
  or the next one overlaps it (§12).
- **The statement's balance feeds the balance tools that already exist.** Every
  row carries the running balance the file printed, and importing records the newest
  one per account as the bank-stated balance. An account with no starting number is
  then asked for one by the post-import setup ("Xác nhận số dư"); an account that has
  one shows the drift badge with its two resolutions. There is no separate statement
  prompt. A card statement has no running balance, so a card's closing debt is not
  used yet (§6).

### 3.5 When something is wrong

| Situation | What the person sees |
|---|---|
| Wrong password | "Mật khẩu chưa đúng, thử lại nhé". The card stays. |
| A lock format the device cannot open (legacy `.xls`, 2007-era encryption) | The card stays and says so, with "Chọn file từ máy" as the way out |
| File never opened for 90 days | The sealed file is deleted. The card stays: "File đã hết hạn lưu. Chọn file từ máy để mở." |
| Mapping was wrong and rows are already in the queue | Remove the rows (bulk delete over the selection), then import the file by hand from the device. The sealed copy is gone by design (S13) |
| Offline | The card cannot open. Same as every personal write. |
| Mailbox disconnected or consent withdrawn | Cards and sealed files are deleted with everything else the connection stored |

## 4. Privacy and consent

- **The statement file is always sealed to the personal key**, never the family
  key, whatever the mailbox's default destination is. Real files carry the
  holder's CCCD number, home address, full account number and credit limit (§15).
  Over-sealing is recoverable (any row can still be sent to Gia đình at review);
  under-sealing is not.
- **The parsed rows are encrypted under the personal key** and readable only by
  their owner. Rows keep the masked account tail only. CCCD, address, full account
  number and credit limit never leave the file.
- **This is the first mail content FamilyHub stores.** It is stored sealed, only
  until it is opened, and for 90 days at most. That needs **consent v5**: one added
  sentence. Transaction-email capture continues under v4; statements are captured
  only after v5 is accepted. The v5 sheet appears the next time the person opens
  "Khoản thu chi từ email".
- **The password never leaves the device.** Remembering it is opt-in, per bank,
  on this device only.
- **Models see three things, never the file.** (1) The statement *email body*,
  once per mail format, to decide "statement or not" and read the period. (2) A
  **masked** sample of the table, only when the column heuristics are unsure.
  (3) **Merchant names only**, never people's names, amounts or dates, to suggest
  a category for a merchant nobody has seen before.
- Pushes carry nothing: no bank, no amount, no count.

## 5. Safety rules

- **Nothing auto-imports.** Rows reach a ledger only through "Nhập".
- **Seal or hold.** A statement that cannot be sealed (no personal staging key
  yet) waits for the next run. There is no plaintext fallback.
- **A model limit slows, never loses.** Every model use degrades to a manual step
  or a later retry (§13).
- **Rows and the card change state together.** Writing N rows and marking the card
  done is one database transaction. A dropped connection at row 100 leaves the card
  intact and no partial rows.
- **A transfer needs evidence.** A row is pre-set to "Chuyển khoản nội bộ" only on
  the evidence levels in §11. A holder-name memo alone is never a transfer.
- **A status column is an exact signal.** Rows the bank marks failed are dropped at
  parse and counted in the summary, the same rule the email path applies to
  declined attempts.

## 6. Scope

**Built (one release):** Gmail direct read; `.xlsx` and `.csv`; locked and unlocked
files; the locked card with the "Sao kê cũ" fold; unlock with the opt-in remembered
password; the table reader and the arithmetic proof; rows in the queue with all
kinds; the account tag; the running balance into the drift detector; dedup against
the ledger and against pending emails (`statement_echo`), and the foreign-purchase
correction (`fx_final`, "Cập nhật theo sao kê"); remembered ✕; server-side merchant
categories in one batched call; the one-time history re-scan; consent v5 with a
non-blocking offer; the 90-day sweep; erasure on disconnect.

**Decided but NOT built yet:**
- *The model as a fallback for column reading* (S19's middle step). The vocabulary
  reader handles all three real layouts, so nothing calls the masked-sample mapping
  model yet. A file whose table cannot be found says so and stops.
- *An editable mapping check.* When the proof cannot pass, the person sees which
  columns were read and confirms or backs out; they cannot re-assign a column.
- *"Cập nhật theo sao kê" for a row booked in the family ledger.* The button appears
  only when the booked twin is in the personal book; a family twin shows the
  difference and is edited by hand.
- *A card's closing debt* as a balance check.
- *Changing the statement's account on the summary.* The account is derived (bank,
  tail, and wallet / card / deposit from the file) and shown, not picked. A wrong
  guess is fixed the way it is for email rows: per row at review, or once on the
  account's own settings (its kind switcher).

**Out (named, so they are decisions, not omissions):** forwarding transport (the
card's `bytes_source` field keeps that door open); PDF; legacy `.xls`; `.zip`;
server-side parsing of unlocked files; the card statement's payment due date and
minimum payment; bulk undo of rows already imported to a ledger; a second mailbox
per person; multi-currency storage.

---

# Part 2 — Technical Appendix

## 7. Architecture in one view

```
Gmail ──► mailbox-sync worker ──► is it a statement? (verdict cache → model, once per shape)
                                   │ yes
                                   ▼
                     fetch attachment ─► seal to personal staging_pub
                                   │
             private bucket  ◄─────┴─────►  statement_files row (status pending)  ─► push
                   │                                  │
                   ▼                                  ▼
   device: download ─► open seal ─► (password) ─► parse ─► map ─► prove ─► census
                                                                      │
                                     stage_statement_rows RPC  ◄──────┘   (rows + card done, atomic)
                                                  │
              review queue = email_transactions  ∪  statement_rows   ─►  Nhập  ─►  ledgers
```

Module map (new and touched):

| File | Role |
|---|---|
| `supabase/functions/_shared/mailbox/statement.mjs` (new) | The statement **lane**: its own Gmail listing, consent and key gates, verdict cache, attachment fetch, seal, store, re-scan, sweep |
| `_shared/mailbox/gmail.mjs` | `attachments` on a fetched message; `getAttachment` (bytes, not text) |
| `_shared/mailbox/sealed-box.mjs` | `sealBytes` / `openSealedBytes`: a file sealed as one self-describing blob |
| `_shared/mailbox/db.mjs` | Statement methods appended as one block; the first server-side Storage write |
| `_shared/mailbox/worker.mjs` | Three insertions: run the lane, skip its message ids, sweep once per tick |
| `_shared/mailbox/classify.mjs`, `supabase/functions/merchant-concepts/` (new) | Merchant names → the 8 concepts: corrections, dictionary, shared cache, then ONE batched model call |
| `_shared/mailbox/notify-copy.mjs`, `supabase/functions/push-send/`, `mailbox-sync/index.ts` | `stmt_new`: own wording, own tray tag |
| `src/js-ui/59-statement-table.js` (new) | Finds the table, assigns columns, reads the summary, runs the proof, classifies rows. Pure: unit-tested under Node |
| `src/js-data/77-statement-capture.js` (new) | Cards, download, open the seal, password memory, row shape, fingerprints, write, retire, purge |
| `src/js-data/72-txn-review.js` | Loads statement rows into `_fhStagedRows`; one resolver for a mixed id list; source stamp; badge |
| `src/js-ui/56-csv-import-ui.js`, `57-csv-import-review.js`, `58-dedup-engine.js` | The card section; the statement's own transfer evidence; `statement_echo` and `fx_final` |
| `src/js-data/19-personal.js` | `fhPersonalSetAmount`: the amount only, nothing else touched |
| `src/js-data/75-consent-ui.js` | Consent v5; `fhConsentOffer`, the non-blocking offer |

## 8. Data model — migrations 0139–0141

### 8.1 `statement_files` — one row per captured attachment

Written by `service_role`; read by its owner; state changes through RPCs only.
The row is never deleted on success: it is the statement's own tombstone, so a
re-read of the mailbox can never stage the same attachment twice.

| Column | Notes |
|---|---|
| `id` uuid PK | |
| `owner_user_id` → `auth.users`, cascade | RLS anchor |
| `gmail_message_id` text, `part_index` int | `UNIQUE (owner_user_id, gmail_message_id, part_index)`: one card per attachment |
| `source_provider` text | Canonical bank name, clear (same precedent as `email_transactions`) |
| `received_at` timestamptz | The mail's date, clear: ordering and the "Sao kê cũ" fold |
| `file_ext` text | `xlsx` \| `csv` |
| `byte_size` int | Sealed size; capped at 10 MB |
| `bytes_source` text | `sealed_object` today; leaves room for a transport that fetches on demand |
| `object_path` text | `{owner_user_id}/{id}.sealed` in bucket `statement-files`; null once deleted |
| `meta_sealed`, `meta_eph_pub`, `meta_nonce`, `enc_v` | Sealed JSON: file name, subject, period, account tail, and the **SHA-256 of the plaintext file** |
| `status` text | `pending` → `opened` \| `dismissed` \| `expired`; `rejected` = judged not a statement (no file kept, remembered so the mail is not re-fetched every run) |
| `backfill` boolean | Found by history reading: drives the "Sao kê cũ" fold |
| `created_at`, `opened_at`, `expires_at` | `expires_at = created_at + 90 days` |

The sealed object is self-describing: `eph_pub (32) ‖ nonce (24) ‖ box`, the same
X25519 + XSalsa20-Poly1305 construction as a staged row. Bytes have no field to bind
an identity in, so the binding lives in the sealed **metadata** (owner + message id,
checked by the existing `fhStagingOpenRow`), and the metadata names the file's hash.
The device checks the hash after opening: a blob moved under another card is refused,
not parsed.

### 8.2 `statement_rows` — the parsed rows, written by the device

| Column | Notes |
|---|---|
| `id` uuid PK | Client-minted |
| `owner_user_id` | RLS: owner only, all verbs |
| `statement_id` → `statement_files` | Provenance; stamped onto the ledger row's source on import |
| `row_index` int | `UNIQUE (statement_id, row_index)` |
| `txn_date` date | Clear, like `personal_transactions.txn_date`: ordering and paging |
| `payload_enc` text | One personal-DEK ciphertext of the whole row (amount, direction, time, description, counterparty, reference, balance-after, MCC, funding source, account id, row fingerprint) |
| `created_at` | |

Field encryption, not a sealed box: the writer is the owner's own device and
already holds the key. `email_transactions` stays service-role-only and its
`(owner_user_id, gmail_message_id)` key from `0137` is untouched.

### 8.3 `resolved_statement_rows` — remembered decisions

`(owner_user_id, row_fp)` primary key, `resolved_at`. `row_fp` is opaque to the
server (§12).

### 8.4 RPCs (all `SECURITY DEFINER`, `search_path = public`, `authenticated` only)

| RPC | Semantics |
|---|---|
| `stage_statement_rows(p_statement_id, p_rows jsonb)` | Owner check; `status` must be `pending`; inserts every row and sets `status='opened'`, `opened_at=now()` in one transaction. A second call is a no-op returning the first result. |
| `dismiss_statement_file(p_statement_id)` | `pending` → `dismissed` |
| `resolve_statement_rows(p_ids uuid[], p_fps text[])` | Records the fingerprints **first**, then deletes the rows: the same ordering as `resolve_email_transactions` |
| `purge_my_statements()` | Erasure: drops the caller's parsed rows, dismisses their cards, returns the sealed paths to delete. Called by both disconnect paths before `disconnect_my_mailbox` |
| `statement_sweep_list(p_limit)` / `statement_sweep_done(p_ids)` | `service_role` only. Expires cards past 90 days, drops capture data for owners with no mailbox, lists sealed files for the worker to delete through the Storage API — including, since `0142`, files whose row was deleted outright (`statement_orphan_objects`, fed by a `BEFORE DELETE` trigger, so an account deletion cannot strand a sealed file) |

The device deletes the sealed object right after `stage_statement_rows` returns.
A sweep in the sync tick removes any object whose file row is no longer `pending`,
and expires `pending` rows past `expires_at` (object deleted, row kept as
`expired`).

### 8.5 Other schema

- `statement_shapes (sender_address, shape, is_statement, source)` — the verdict
  cache, **its own table**. It was designed as a column on `sender_fingerprints`;
  that table's junk rows feed `senderTally()` and the sender-wide junk sentinel, and
  a statement verdict must never count as either. Seeded (`0140`) for the three
  formats verified by hand (§15), so those cost zero model calls for anyone. A test
  pins each seed to what `statementShape()` computes, byte for byte.
- `mailbox_grants.stmt_rescan_at timestamptz` — null means the one-time history
  re-scan is still owed.
- Bucket `statement-files`: private. `service_role` writes. The owner may read
  and delete objects under their own `{user_id}/` prefix. Nobody else, ever.

## 9. Detection — the statement lane

Statements ride **their own lane** beside the transaction loop (`statement.mjs`),
not a tier inside it. The reason is mechanical: the transaction loop's header pass
fetches `format=metadata`, which carries no MIME parts, so it cannot see an
attachment at all; and statement mails have almost certainly been cached there as
"not a transaction" already. A lane that lists for itself is untouched by the junk
cache instead of racing it.

1. **Gates, before any Gmail call.** `bank_email` consent ≥ 5 (the first
   server-side read of `user_consents`), then a personal staging key to seal to.
   Neither → nothing is fetched. No key is a hold, never a family-key fallback.
2. **Its own listing.** The same known-sender query plus `has:attachment
   (filename:xlsx OR filename:csv)`. Two days on a normal run; the person's chosen
   look-back window while the one-time re-scan is owed (`stmt_rescan_at` null).
3. **Already decided?** Any `statement_files` row for that message, whatever its
   status. Throws when unreachable, on purpose.
4. **The verdict**, per mail format: `statement_shapes` under `(sender address,
   subject with every digit and non-letter removed)`. Stripping all digits matters:
   VIB's card subject is "SAO KE THE TIN DUNG VIB CASH BACK THANG 09 NAM 2026", and
   the ordinary normaliser (runs of six or more digits, dates) would see a new format
   every month. Unknown → one model call on the **email body**, answering one
   boolean. At most two such calls per run. "Could not ask" (429, transport, no key)
   is **not** "no": the mail is left undecided, with no row, and met again next run.
   A "no" is remembered per message and logged to `parse_failures`, so a wrong one
   is findable.
5. **Capture.** Spreadsheet attachments only (a logo is never fetched), 10 MB
   ceiling, upload first and row second (an object with no row is an orphan the
   sweep removes; a row with no object is a card that cannot open). The period and
   the account tail are read locally from the mail's own words, never the password
   rule (S8).
6. **Hand-off.** The lane returns the message ids it owns and the transaction loop
   skips them. The whole lane is wrapped: a failing lane is reported in the run
   summary and never costs a transaction its run.
7. **Push** for a newly arrived statement; history finds stay quiet.

## 10. Mapping and the proof

Order: remembered mapping for this sender and header signature → heuristics →
the model on a **masked** sample (the existing file-import call) → the proof.

The proof is about the **columns**, not each row. For consecutive rows in time
order, with `amount` signed (or `credit − debit`):

```
balance[i] == balance[i−1] + amount[i]          (running balance present)
Σ debit == stated total debit, Σ credit == stated total credit,
opening + Σ credit − Σ debit == closing         (summary block present)
```

A mapping is **accepted silently when at least 90% of consecutive rows reconcile**,
or when the stated totals reconcile exactly. A wrong mapping reconciles roughly
none. One refinement came out of the real wallet file, where 9 of 141 rows leave the
balance untouched: a **debit after which the balance did not move** counts as
reconciled, because it is a known pattern (paid from a linked bank, §11), not noise.
It only counts once at least 60% of rows reconcile to the đồng, so a constant column
mistaken for the balance cannot "prove" itself. Row order (newest-first or oldest-first) and the sign of the credit column
(VIB's card statement prints credits as negative numbers) are *outputs* of the
proof: both orders and both signs are tried and the one that reconciles wins.

Rows that individually break a proven mapping are information, not errors: in a
wallet statement they are payments funded from somewhere else (§11).

The parser must cope with what real files do: a table header on row 25 under a
merged-cell preamble, sub-header rows inside the table ("Số thẻ/Số tài khoản: …"),
totals rows after the table, two-line bilingual header cells, dates as text.

## 11. Row classification

**Transfer evidence, three levels.**

1. **Both legs found**: opposite directions, two different accounts of yours,
   exact amount, within ±1 day (the `full-ledger-spec.md` §8 rule, unchanged; T5
   stands). One grouped "Chuyển khoản nội bộ?" card, confirmed with one tap.
2. **Structured evidence on one side**: a wallet top-up (the file's funding column
   names a bank, or top-up wording), or a bank memo whose **recipient is the holder**
   ("TRAN THI MAI chuyen tien den TRAN THI MAI - 9988…"). Pre-set to transfer, shown
   in "Cần bạn xem" under "Chuyển giữa tài khoản của bạn?", never in the ready list.
3. **Holder-name memo otherwise**: never a transfer. VIB auto-fills "<holder> chuyen
   tien den <recipient> - <account>" on *every* outgoing transfer. The recipient is
   read out as the counterparty, the row is person-to-person, and "Chi cho gì?" is
   left blank for the one thing only the person knows.

**A statement and a pending email for the same purchase.** Same second: the review's
richest-copy merge collapses them, which works only because a statement row spells
its instant exactly as the database spells a timestamp (`…T01:29:06+00:00`). Seconds
apart, same bank: the dedup engine's `statement_echo` tier flags the later one as
"Có thể trùng" (same calendar day, and within five minutes when both carry a clock).
Two statement rows alike are two purchases, as two emails are.

**A foreign card purchase.** Booked from its email at our estimated VND, and the
import says so in the note (`[20 USD @26,350 +3% est.]`). The statement carries what
the bank charged, far outside the engine's 1.000đ window, so without a rule the
purchase would arrive again as new. `fx_final`: a statement row, against a booked
row that *says* it is an estimate, the same merchant word, within 4.5 days and 6%.
"Cập nhật theo sao kê" sets the booked row's **amount only**
(`fhPersonalSetAmount`; the general expense writer rewrites the whole row and would
blank its note, category and time) and retires the statement row.

**Wallet payment funded by a bank.** A debit row in a wallet statement after which
the wallet balance did not move was paid from a linked bank. It is tagged to the
**funding bank's account** (resolved from the funding column), and it is a likely
twin of the bank's own row. When the two merge, the wallet's merchant name
survives ("EVERY HALF COFFEE ROASTERS" beats "thanh toan MOMO").

**Card statements.** Match on the **transaction date**, never the post date (they
differ on 13 of 15 rows in the sample). The MCC column feeds the existing MCC
category tier. "Thanh toan sao ke the" is a card repayment and pairs with the
debit on the account statement.

**Categories.** The on-device cascade runs first. For a merchant it cannot place,
the device sends the **merchant names only** to the `merchant-concepts` function:
cache first (`merchant_concepts`, `0126`), then one batched model call for the
misses, answers stored for everyone. A counterparty that is a person is never
sent: only rows whose kind is a merchant payment qualify.

## 12. Remembered decisions

`row_fp = base64(HMAC-SHA256(k, canonical))`, where `k` is derived on the device
(HKDF, info `stmt-row-fp-v1`) from the personal staging private key, so the server
sees an opaque token. `canonical` is the bank's own transaction id when the file
has one (MoMo's "Mã giao dịch": an exact key), else
`account tail | date | signed amount | reference-or-description`.

At parse, a row whose fingerprint is already in `resolved_statement_rows` is not
written again. This is the one place a statement row is blocked before a person
sees it, and it is allowed because the key is exact and the person already decided.

## 13. Model budget — a limit slows, never loses

The project runs on the Gemini free tier, which is already the pipeline's
throughput ceiling.

| Use | Bound | When limited |
|---|---|---|
| "Statement or not" | One call per distinct mail format, **across all users**; three formats pre-seeded | The statement waits for the next run |
| History re-scan | Own lane, at most 2 verdict calls per tick, stops at the first 429 | Resumes next tick; transaction mail is never held by it |
| Column mapping | Only when heuristics are unsure; never again once a mapping is remembered | The manual mapping check appears |
| Merchant concepts | Cache first; **one batched call** per statement for the misses | Rows land in "Cần bạn xem" without a category |

## 14. Rollout and deploy order

Everyone on the mailbox allowlist, one release. The order matters because the
database and the Edge Functions are shared singletons (`AGENT_SYNC.md` §1):

1. ✅ Migrations `0139_statement_capture`, `0140_statement_shapes_seed`,
   `0141_statement_shapes_revoke` — applied 2026-09-19 and checked by query (RLS on all
   four tables, owner-only SELECT, RPC grants, private bucket, seeds). `0141` exists
   because that check found Supabase's default grants still on `statement_shapes`.
2. ✅ `push-send` — deployed 2026-09-19. Live v20 was byte-identical to `main`.
3. ✅ `merchant-concepts` v1 (new; `verify_jwt=true`) — deployed 2026-09-19.
4. ✅ `mailbox-sync` **v50** (`--no-verify-jwt`) — deployed 2026-09-19; first scheduled ticks and Gmail pushes returned 200 with no holds. **Never from `main`.** Live is v49 and carries
   a backfill cursor and a reader lease that were never committed (`worker.mjs` +225
   lines against `main`, five other files differ). The deploy tree is
   `.deploy/statement-capture/` in the main checkout: the live v49 source, downloaded
   byte for byte, with only this feature's delta applied (`patches/`, no rejects).
   The pipeline suite gives identical results on the live baseline and on that tree,
   apart from the two new statement tests. `sh .deploy/statement-capture/deploy.sh`
   runs steps 3 and 4.
5. ✅ Client (SW v538), live on merge. Until the worker is deployed and a person
   accepts consent v5, nothing is captured, so the early client is inert.

Tests use **synthetic** files that copy the three real layouts, two of them locked
with a known password (`tools/make-statement-fixtures.py` →
`tools/fixtures/statements/`). Real statements never enter the repo
(`research/statements/` is git-ignored). The table reader was also run against the
three real files on the machine that owns them: all three prove.

| Test | Pins |
|---|---|
| `tools/statement-table.test.js` | The reader and the proof on all three layouts; a wrong reading reconciles nothing |
| `tools/statement-rows.test.js` | A parsed row takes the exact shape of an opened email row; nothing from the preamble rides along |
| `tools/statement-bucketing.test.js` | Statement rows through the REAL bucketing and dedup engine |
| `tools/dedup-fx-final.test.js` | The foreign-purchase tier, and every way it must not fire |
| `pipeline/statement-lane.test.js` | The lane with a fake Gmail and real encryption; the seeds match the code |
| `pipeline/merchant-concepts-batch.test.js` | One model call; a limit is never cached as "unknowable" |
| `tools/consent-gate.test.js` | The v5 change is what someone holding v4 is shown |

## 15. What real statement files look like (2026-09-19)

Three real files, read on the device that owns them. The shipping decrypter
(`41-xlsx-decrypt.js`) opens both locked files: agile encryption, AES-128-CBC,
SHA-1, spin count 100000 (the Apache POI default), about 1.1 s on a laptop.

| | VIB account | VIB credit card | MoMo |
|---|---|---|---|
| Sender · subject | `info@myvib.vib.com.vn` · "Sao kê tài khoản" | `info@card.vib.com.vn` · "SAO KE THE TIN DUNG … THANG 09 NAM 2026" | `no-reply@mservice.com.vn` · "Sao kê lịch sử giao dịch" |
| Locked | No | Yes | Yes |
| Rows | 105, newest first | 15 | 145 over 89 days, newest first |
| Preamble | 14 rows; CCCD, address, full account number | 24 rows, 73 merged cells; card number, credit limit | None; headers on row 1 |
| Oddities | None | Sub-header rows inside the table; totals rows after it; **credits negative** | 3 "Thất bại" rows that still carry amounts |
| Date | Text, day only | Text, day only; transaction vs post date differ on 13 of 15 | Text, to the second |
| Amount | Debit and credit columns | Debit and credit columns | One signed column |
| Extras | Running balance; opening, closing, totals | MCC column; previous and closing debt, totals | Transaction id; sender/receiver account and name; running balance |
| Proof | Every row; totals; opening → closing | Totals; previous + debit − credit = closing | 128 of 141; 9 rows leave the balance unchanged (bank-funded) |

The MoMo email body states the wallet number and the period in words, and states
the password rule. The password hint is deliberately **not** surfaced (S8).

## 16. Decision log

Design interview, 2026-09-18 → 19.

| # | Decision |
|---|---|
| S1 | The file is unlocked **on the device**. The server never holds a statement password. |
| S2 | After unlock the rows are **N saved cards** in the ordinary queue; before unlock the statement is one locked card. |
| S3 | A statement is both a gap filler and a primary source; dedup decides which, per row. |
| S4 | `.xlsx` and `.csv` only. PDF is its own future epic. |
| S5 | Gmail direct read only; forwarding later. `bytes_source` keeps that door open. |
| S6 | Known senders only. The sender list stays the boundary between "bank mail" and "all mail". |
| S7 | **Store a sealed copy** (not fetch-on-demand): under weekly token expiry in Google's Testing status, it is the only option where tapping the card always works. |
| S8 | Password remembered **opt-in, on this device only**, under the personal key. No password hint from the email body. |
| S9 | All kinds on, as in the email review. |
| S10 | One statement, one account; its running balance feeds the existing drift detector and post-import setup. *(Built as that, not as a separate "set the anchor" prompt: the two surfaces already exist.)* |
| S11 | History statements are all captured, folded under "Sao kê cũ". |
| S12 | Rows live in a new owner-only `statement_rows` table, field-encrypted; `email_transactions` is untouched. |
| S13 | The sealed file is deleted **the moment its rows are written**; unopened files after **90 days**. Redo means picking the file from the device. |
| S14 | A confirmed column mapping is remembered per sender, on the device. |
| S15 | Rows already booked are **written and collapsed**, never filtered at parse. The badge counts every row. Quick review is unchanged. |
| S16 | A ✕ is remembered by an opaque on-device fingerprint; MoMo's transaction id makes it exact. |
| S17 | One path for locked and unlocked files; no server-side parsing. |
| S18 | **The model decides** "statement or not", once per mail format, cached for all users in `statement_shapes`; a limited model leaves the mail undecided, a "no" is logged. |
| S19 | Mapping: heuristics → model on a **masked** sample → arithmetic proof, accepted silently at ≥ 90% reconciliation. *(The model step is not built: the vocabulary reader covers every layout seen so far. §6.)* |
| S20 | Transfers need evidence (three levels); both matchers stay at **±1 day** (T5 unchanged). |
| S21 | A wallet row that did not move the wallet balance is tagged to the funding bank; the wallet's merchant name survives a merge. |
| S22 | **Big bang**: core loop, merchant concepts and the amount correction in one release; forwarding stays later. |
| S23 | Consent **v5** gates statements only; email capture continues under v4. |
| S24 | The statement file and its rows are **always personal-sealed**, whatever the mailbox default. Reversible later in the safe direction only. |
| S25 | A one-time, targeted history re-scan on v5 acceptance, in its own rate-limited lane. |
| S26 | Own push wording, "Có sao kê mới chờ bạn mở", carrying nothing. |
| S27 | Everyone on the mailbox allowlist, no separate flag. |

## 17. Related

- `docs/specs/effortless-transaction-logging-spec.md` — the pipeline; its Part 3
  release log gets an entry when this ships.
- `docs/specs/transaction-review-spec.md` — the queue the rows land in.
- `docs/specs/full-ledger-spec.md` — kinds, pairs, anchors.
- `docs/specs/personal-ledger-spec.md` — the personal key and staging keypair.
- `docs/features/csv-import.md` — the parser and mapper this reuses.
- `docs/ARCHITECTURE.md` — the dedup model ("an exact key may block, a guess may
  only flag").
