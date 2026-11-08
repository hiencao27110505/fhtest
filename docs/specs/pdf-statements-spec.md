# PDF Statements — the statement lane reads the file most banks actually send

A bank emails a credit-card statement. It is a password-locked PDF, not a
spreadsheet. Today the statement lane does not list it, does not record it, and
tells nobody; the person opens "Duyệt giao dịch" and sees "Chưa có giao dịch
mới". This spec makes a PDF statement first a visible card, then a readable one,
and finally a format the app can learn when it meets one it has never seen.

> **Status, 2026-11-08. §3–§6 BUILT** (branch `feat/email-capture`, SW v634; the
> lane's `STATEMENT_EXTS` + query, the client card and reader, `43-pdf-grid.js`,
> the `fxAmount`/`postDate` roles, the per-product password scope, the manual
> door). Verified on the synthetic fixture AND, locally, on the real Techcombank
> file: 35 rows, totals exact. **§7 (learning an unknown layout) is NOT built**:
> it needs the `statement_formats` migration (§12), which is the user's to write;
> the SQL was handed over. Agreed in a grilling of five rounds (decision log §14,
> PS1–PS29). The real file and its password never enter the repo. The coverage
> matrix (`statement-coverage-spec.md`) is this spec's acceptance gate and is
> green. Two things the build taught, folded into §11: a header needs three
> roles (a bilingual preamble prints "Credit Limit" beside "Payment due date"),
> columns are found on the header's raw text runs and snapped to where the body
> starts, and a figure pdf.js glued to the words after it is split.

> **How this relates to its siblings.** `statement-capture-spec.md` owns the
> lane: detection, sealing, the locked card, unlock, the proof, the rows, dedup,
> retirement. Its decision **S4 (`.xlsx` and `.csv` only; PDF is its own future
> epic) is superseded here**; everything else in it stands and is not restated.
> `statement-balance-spec.md` owns what a statement does to an account's balance
> and a card's limit and dates; a PDF feeds it the same facts. `consent-gate-spec.md`
> owns how a person is asked for the consent a feature needs; the learn step in §7
> needs a new sentence in that consent. `email-reading-v2-spec.md` is the
> precedent for "one sample per new format, once, then local": §7 applies the
> same economics to statements.

---

# Part 1 — Behaviour

## 1. Summary

- **Every statement from a known sender becomes a card**, whatever file it
  carries. If the app cannot read that file type yet, the card says so and
  points at the one way out that exists. Silence is the bug this spec fixes
  first (PS1, PS2).
- **PDF statements are read on the device**, like locked spreadsheets: the
  password is typed on the phone, used there, and thrown away or remembered
  there. The file never opens anywhere else (PS3, S1 unchanged).
- **The reader is the one the app already has.** A PDF is turned into the same
  grid of rows and cells a spreadsheet gives, and from there the table finder,
  the arithmetic proof, the row classifier and the account facts are the
  existing code, untouched (PS5).
- **An unknown layout can be learned, once, for everyone.** When the table
  cannot be found, the person may send a masked copy of the text (every digit
  replaced, no name, no address) to the AI to learn the layout. A layout the
  proof cannot confirm is never kept; one that proves is saved for every later
  person with that bank (PS20–PS29).

## 2. Why this exists

- Most Vietnamese card statements, and several account statements, are PDF.
  Techcombank, Vietcombank, VPBank, TPBank and others email a locked PDF monthly.
  For a person whose bank emails no per-transaction alerts for the card, the PDF
  is the only feed; without it the ledger has a hole the size of a card.
- The first teammate outside the founders to try statement capture
  (2026-11-08) received a Techcombank card statement on 29/10 and saw nothing.
  The lane's Gmail query asks only for `xlsx` and `csv` filenames; a PDF is never
  listed; nothing is written; no card, no push, no log entry a person could find.
  Every exit of that path was silent (`AGENT_SYNC.md` rule 4).
- S4 decided PDF was its own epic. This is that epic.

## 3. The card for a file the app cannot read yet

Shipped first, on its own, before any reader.

- The lane lists `has:attachment (filename:xlsx OR filename:csv OR filename:pdf)`
  from known senders, decides "statement or not" by the subject shape exactly as
  today, and seals and stores the file whatever its extension (`STATEMENT_EXTS`
  gains `pdf`). The server stores the extension; it has no opinion on
  readability (PS2).
- **Readability is the client's judgement, at open time.** A card whose
  extension the running client has no reader for shows, instead of "Mở sao kê":

  > **Sao kê Techcombank thẻ tín dụng · 10/2026**
  > File PDF, app chưa đọc được. Nếu ngân hàng có bản Excel/CSV, chọn file đó ở đây.
  > [Chọn file từ máy] · ✕

  The day the client gains the reader, the same stored card opens. No status
  value is added, no migration, nothing is re-captured.
- The push, the "Sao kê cũ" fold, the 90-day expiry, the 10 MB cap and erasure
  on disconnect apply unchanged.
- One tally stage, `stmt_pdf_captured`, counts PDF statements the lane seals,
  so the share of PDF in what people receive is measurable. No digest (decided
  against, PS14).

## 4. Reading a PDF — what the Techcombank file taught

Facts from one real file, 2026-11-08 (digits masked, nothing personal kept):

| Fact | What it means for the reader |
|---|---|
| Text PDF: two embedded TrueType fonts with `ToUnicode`, one image (the logo) | Text extraction, no OCR. A scanned statement is out of scope (PS9) |
| Locked: `/V 5 /R 5 /AESV3`, AES-256 | pdf.js opens revision 5 and 6 with a password callback |
| Producer iTextSharp 5.5; letter size; 3 pages | Column x-positions are fixed by the generator, not by content |
| **One header**, on page 1, bilingual over two text lines ("Ngày giao dịch / Transaction Date", "Ngày cập nhật hệ thống / Post Date", "Số tiền giao dịch gốc / Original Amount", "Ghi nợ (VND) / Debit", "Ghi có (VND) / Credit", "Diễn giải giao dịch / Transaction Description") | The header is found once; its x-ranges are carried to every page |
| **Pages 2–3 continue with no header**; every column keeps its x (date 28 pt, post date 83 pt, original amount ≈ 192 pt, …) | Column assignment is by carried x-range, never re-detected per page |
| A description spans two lines: line 1 the type and the masked card ("Giao dịch thanh toán/Purchase - Số Thẻ/Card No: ####...####"), line 2 the merchant ("CO.OPMART NHIEU LOC HO CHI MINH VN") | Line 2 is the counterparty; line 1 sets the kind and the account tail (PS11) |
| **Fee rows carry no transaction date**, only a post date ("PHI GIAO DICH NOI TE O NUOC NGOAI") | `txn_date` = post date for such rows; fee words classify them (PS10) |
| A card repayment is a credit row ("Thanh toan no the tin dung - Sotien … - Ngay …") | The existing repayment vocabulary applies |
| "Số tiền giao dịch gốc" carries a currency ("##,### VND") | A foreign purchase is representable: `fx_amount` + `fx_currency`, VND debit as the amount (PS12) |
| **Negative means owed**: "Số dư kỳ trước (VND) -#,###,###", "Số dư cần thanh toán -#,###,###" | The opposite of VIB's card xlsx (credits printed negative). The proof already tries both signs (§10 of the capture spec) |
| **The proof holds exactly**: previous balance − Σ debit + Σ credit = outstanding; outstanding = "Dư nợ cuối kỳ"; the 35 rows sum to the printed totals | Totals-block proof, as for the VIB card xlsx; no running balance |
| Page 1 carries statement date, "Thời hạn thanh toán trước" (time + date), minimum payment, credit limit, the **full card account number** and the **home address** | Limit, due date, closing debt feed the balance tools (PS13); the number and address are read past, never into a row (S24) |
| Page 3 is a glossary ("Cách đọc và hiểu sao kê") | Outside the table by the "table ends at the totals block" rule |

## 5. What the person sees

Identical to a locked spreadsheet, on purpose:

1. The card: "Sao kê Techcombank thẻ tín dụng · 10/2026", **Mở sao kê**, ✕.
2. "File này có mật khẩu" when the PDF is locked; the password is used on the
   device. The opt-in switch reads **"Nhớ mật khẩu sao kê thẻ tín dụng
   Techcombank trên máy này"** (product before bank in Vietnamese, "Techcombank
   credit card statement" in English): remembered per **bank and product**,
   because one person can
   hold a Techcombank card PDF and a Techcombank account spreadsheet with
   different passwords (PS16). No hint from the email body (S8).
3. The columns are read and proved. When the proof passes, nothing is asked.
   When it cannot, the person sees which column was read as what and confirms or
   backs out, as today.
4. The summary line and the account, then the rows in the queue. A card
   statement's closing debt, limit and due date land on the card's account as
   dated anchors (`statement-balance-spec.md`); the minimum payment is not stored
   (PS13).
5. An unlocked PDF that proves silently **stages itself at queue open** (S31)
   like an unlocked spreadsheet; a locked one waits for the tap (PS18).
6. "Nhập file sao kê" and "Chọn file từ máy" accept `.pdf` once the reader
   ships, through the same path, so an expired or dismissed card has the same way
   out a locked spreadsheet has (PS17).

## 6. Safety rules

- **The file opens on the device only.** No PDF bytes leave the phone, for
  reading or for learning (S1, S17, PS3). The learn step sends masked text (§7).
- **The proof is the gate.** A reading that does not reconcile is shown, never
  silently imported, as today. A learned layout that does not reconcile is never
  saved (PS22).
- **Personal data in the preamble stays in the file.** Full card number, address,
  CCCD, credit limit beyond the anchor: read past. Rows keep the masked tail only
  (S24).
- **Fee rows never pair.** A row with only a post date is a fee by its words and
  is classified as one; it is not a candidate for a transfer pair or a card
  repayment (PS10).
- **A scanned PDF stops with a card**, not an error: "File này là ảnh chụp, app
  chưa đọc được. Nếu ngân hàng có bản Excel/CSV, chọn file đó." No OCR (PS9).
- **An amount cell is one figure, or the row is unreadable** (PS30, 2026-11-08).
  `fhStmtFigure` accepts one number with its separators, an optional sign or
  accounting parens and an optional currency word, and nothing else; a cell with
  digits that is not that, or a figure of 100 tỷ or more, marks the row
  *unreadable*. Unreadable rows are kept apart from the rows, the proof cannot
  pass while any exist (`how: 'unreadable'`), the capture flow names them by day
  and cell on the ask screen ("Có 2 dòng tụi mình không đọc được số tiền"), and
  they are never written to the queue. A cell with no digit at all is empty, not
  unreadable. Why: two real card PDFs glued a repayment's figure to its memo in
  a shape the word-pattern split did not foresee, and the permissive number
  reader turned 7,270,899 ₫ into 7,270,899,672,708,996 ₫ in the review queue.
  The next glue will be different again; the shape check does not depend on it.

## 7. When the app has never seen this layout

Every bank's PDF is laid out by a different generator. The Techcombank reader
covers one. For the rest, the deterministic path (header words → roles → proof)
will sometimes find no table. Then, after the password step has succeeded:

> App chưa đọc được định dạng sao kê này.
> Gửi bản đã che số cho AI để học cách đọc?
> **[Phân tích]** · Để sau

- **What is sent (PS20).** Never the PDF. The device extracts the text layer and
  **masks** it: every digit becomes `#`, the lines carrying the holder's name and
  address are dropped, merchant words are kept, each text item keeps its
  coordinates. With it go the sender address and the subject shape. The AI never
  sees an amount, a date, a name, a card number or a balance.
- **What is learned (PS21).** A **format**, keyed by (sender address, header
  signature): the column roles with their x-ranges (`date · post_date · amount ·
  currency · debit · credit · balance · description`), the sign convention, the
  continuation-line rule, the labels of the totals block. The model answers in a
  fixed schema; the device applies it to the real grid and runs the proof.
- **A format that proves is saved for everyone** (`statement_formats`, beside
  `statement_shapes`), so the next person with that bank costs zero calls. **A
  format that does not prove is not saved** and the person sees "Chưa học được.
  Chọn file Excel/CSV nếu ngân hàng có." (PS22).
- **Person-initiated, never automatic** (PS23). "Để sau" leaves the card as it
  was.
- **Also for spreadsheets** whose table is not found: the grid path is one, so
  the offer costs nothing extra and generalises S19's unbuilt "model on a masked
  sample" (PS25).
- **One new sentence in the consent** (a version bump, through
  `consent-gate-spec.md`): a masked copy of a statement the app cannot read may be
  sent to the AI service to learn the layout, with no amounts, dates or names in
  it, only when the person asks (PS24).

## 8. Status and current limits

- **Not built.** §3 ships first (client + one worker constant + a tally stage);
  §4–§6 second; §7 third.
- **Out, named:** OCR of scanned statements; `.xls`, `.zip`; the minimum payment
  as a stored fact; learning from the PDF bytes; automatic learning without a
  tap; reading a PDF on the server.
- **Unverified until a sample lands:** every bank other than Techcombank's card.
  The coverage matrix lists them as `unverified` and the test refuses to call
  them supported without a fixture that proves.

---

# Part 2 — Technical Appendix

## 9. Architecture in one view

```
Gmail ──► statement lane (statement.mjs) ──► subject-shape verdict (unchanged)
            list: has:attachment (filename:xlsx OR filename:csv OR filename:pdf)
            seal to the personal key, store, card row (file_ext = 'pdf')
                                   │
device: card ──► ext readable by THIS client? ── no ──► the §3 card (manual door)
                                   │ yes
                            download, open seal
                                   │
                    43-pdf-grid.js (new): pdf.js text items ──► grid
                      password callback ◄── the existing password sheet
                                   │
                    59-statement-table.js: fhStmtFindTable → fhStmtRead → fhStmtProve  (unchanged)
                                   │ no table
                    §7 learn: masked items ──► /api/statement-format ──► Gemini ──► format
                      apply as rolesOverride ──► prove ──► save statement_formats (only if proved)
                                   │
                    77-statement-capture.js: census, rows, stage_statement_rows (unchanged)
```

## 10. Module map

| File | Change |
|---|---|
| `_shared/mailbox/statement.mjs` | `STATEMENT_EXTS` gains `'pdf'`; `statementQuery` adds `OR filename:pdf`; tally stage `stmt_pdf_captured` |
| `src/js-data/77-statement-capture.js` | `fhStmtReaders` (the set of extensions this build reads); the §3 card branch; PDF branch of the unlock step; password memory keyed `(provider, product)`; manual door accepts `.pdf`; the §7 offer |
| `src/js-data/43-pdf-grid.js` (new) | pdf.js loader (lazy, `vendor/pdfjs/`), password callback, text items → grid (§11), masking for §7 |
| `src/js-ui/59-statement-table.js` | `post_date` role (PS10); `rolesOverride` accepts x-range roles from a learned format; no other change |
| `vendor/pdfjs/pdf.min.js`, `pdf.worker.min.js` | vendored browser build, **not** in the SW precache (PS6) |
| `api/statement-format.js` (new) | the learn call, cloned from `api/receipt-extract.js` (§13) |
| `supabase/migrations/NNNN_statement_formats.sql` | the shared format table (§12); number verified against `origin/main` at build time |
| `tools/make-statement-fixtures.py` | PDF branch (§15) |
| `tools/pdf-grid.test.js`, `tools/statement-pdf.test.js` (new) | §15 |
| `taxonomy/statement-formats.json` | the matrix row for Techcombank card PDF (`statement-coverage-spec.md`) |

## 11. `43-pdf-grid.js` — from text items to the grid

pdf.js gives, per page, text items with a string and a transform (x, y, width).
The grid builder:

1. **Rows.** Cluster items by `y` with a tolerance of 2 pt; order rows top to
   bottom, items left to right. Page order is preserved; the footer page number
   ("#/ #") is a one-item row the table finder ignores.
2. **Header.** `fhStmtRoles` runs on the first row whose words name a date and an
   amount (as for a spreadsheet). The header's x-ranges are recorded once: each
   column spans from its first item's x to the next column's x. A bilingual header
   over two lines is merged: a row directly under the header row whose items all
   sit inside existing column ranges and carry no digit joins the header text.
3. **Columns carried across pages.** Every later row's items are assigned to the
   column whose x-range contains the item's x. Pages 2–n are not re-scanned for a
   header; a header row met again (some banks repeat it) is dropped by its
   signature (`fhStmtHeaderSig`).
   **Glued runs are cut by geometry** (2026-11-08): pdf.js joins neighbouring
   cells into one run when the gap is under a space. A run that reaches past a
   column boundary is cut at that boundary, at the nearest space its average
   glyph width puts there (3 characters of slack), boundary after boundary; the
   remainder belongs to the next column. A run with no space near the boundary
   stays whole in its start column, where the reader refuses it as an amount
   (§6, unreadable rows). The earlier rule, "a figure followed by words in a
   figure column", is gone: it was one glue's shape, and the next glue (a figure
   glued to a figure) did not have it.
4. **Continuation lines.** A row with no date in the `date` column and no date in
   the `post_date` column, whose items all sit in the `description` column, is
   joined to the row above with a space. This is how the two-line description
   becomes one cell (line 1 + " " + line 2).
5. **Fee rows.** A row with a date only in `post_date` is a body row; `fhStmtParse`
   takes `post_date` as the row's date when `date` is empty (the new `post_date`
   role). Matching on the transaction date, never the post date, still holds for
   rows that have both (capture spec §11).
6. **Totals and preamble.** Rows outside the header's column structure (the
   preamble, the totals block, the glossary) are passed as `notes` exactly as a
   spreadsheet's preamble and totals are, so `fhStmtSummary` reads "Số dư kỳ
   trước", "Tổng ghi nợ", "Tổng ghi có", "Số dư cần thanh toán" and the proof
   runs unchanged.
7. **Masking (for §7).** `fhPdfGridMask(items)` returns the same items with every
   digit replaced by `#`, items on the lines labelled "Ông/Bà", "Mr/Ms", "Địa chỉ",
   "Address" and the holder's name removed, and nothing else changed. A test
   asserts no digit and no holder name survives.

**Where it runs.** pdf.js's own worker runs the parsing and the AES key
derivation off the main thread; the grid builder is cheap and runs on the main
thread after `getTextContent()` resolves. The same unlock cache rules as the
spreadsheet path apply (device-heat spec, approach C): the grid is remembered by
file hash in memory and in the sealed `fh-stmt` IndexedDB store.

**Loading pdf.js.** `vendor/pdfjs/` is same-origin and not precached; the SW's
same-origin path serves it network-first, cached after the first fetch. The
`<script>` is injected on the first PDF open (`fhPdfReady()`, a promise kept for
the session). The worker is given by URL (`GlobalWorkerOptions.workerSrc`).
`tools/vendor-pin.test.js` asserts the vendored build's version string equals
`pdfjs-dist`'s in `package.json`.

## 12. Data model — `statement_formats`

```sql
create table public.statement_formats (
  sender_address text not null,
  header_sig     text not null,      -- fhStmtHeaderSig of the learned header words
  format         jsonb not null,     -- roles with x-ranges, sign convention, continuation rule, totals labels
  source         text not null check (source in ('seed', 'model')),
  reader_build   text,               -- the client build that saved it
  proved_files   int not null default 1,
  failed_files   int not null default 0,
  stale          boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (sender_address, header_sig)
);
```

- Readable by `authenticated` (a layout is not personal data: it holds column
  names and coordinates, never a value from any row). Written through two
  `SECURITY DEFINER` RPCs: `statement_format_save(address, sig, format)` which
  inserts or replaces only when the caller just proved it, and
  `statement_format_fail(address, sig)` which bumps `failed_files` and sets
  `stale` after two failures (PS26). `service_role` may seed.
- The Techcombank card layout ships as a `seed` row generated from the matrix,
  so it costs no call for anyone.
- `fhStmtFindTable(grid, rolesOverride)` already accepts a remembered mapping;
  a format row is that mapping with x-ranges, applied before the word heuristics.
  A file that fails the proof under a known format is **unknown**, not wrong: the
  device offers the §7 learn for it and reports the failure (PS26).

## 13. The learn call — `api/statement-format.js`

Cloned from `api/receipt-extract.js` (receipt scan), with the same posture:
POST only, session token verified against Supabase auth, 6 calls per person per
hour, body size capped, temperature 0, a fixed response schema re-validated in
code, nothing logged beyond a status and a duration, never the request body.

- **Request:** `{ sender, shape, items: [{x, y, w, text}] }` after masking (§11.7).
  A test on the server side refuses any item text containing a digit.
- **Prompt:** the Techcombank format as a worked example, the role vocabulary,
  the rule that every role is a column x-range and nothing else, and the totals
  labels to look for. It is told the text is masked and must not infer values.
- **Response schema:** `{ roles: {role: {x0, x1}}, sign: 'neg_owed'|'neg_credit'|'plain', continuation: 'description_only'|'none', totals: {prev, debit, credit, closing}[labels], header_row: n }`.
- **On the device:** the answer becomes a `rolesOverride`; `fhStmtParse` runs;
  `fhStmtProve` decides. Proved → `statement_format_save`, then the ordinary
  summary. Not proved → "Chưa học được…", nothing saved, the card stays.
- **Budget:** one call per (sender, header signature) across all users: a
  format already in the table is never asked again; a stale one is asked once
  more.

## 14. Decision log

Grilling of 2026-11-08, five rounds.

| # | Decision | Why |
|---|---|---|
| PS1 | **Every statement from a known sender becomes a card, whatever its file type.** The lane lists `pdf` beside `xlsx` and `csv`. | The teammate's Techcombank PDF produced nothing anywhere: silence is the defect |
| PS2 | **"Unsupported" is a client judgement at open time, not a server status.** The server stores the extension; the client shows the §3 card when it has no reader for it. | No migration, no status churn; the stored card opens the day the reader ships |
| PS3 | **Read on the device with pdf.js text extraction.** Rendering to an image and sending it to the receipt-scan model was rejected. | S1/S17 and consent v5 ("file chỉ mở trên máy bạn"); the file carries CCCD, address and the full card number |
| PS4 | Model use for reading stays what S19 allows: a masked column sample, once per format. | — |
| PS5 | **One reader.** A PDF becomes the spreadsheet grid; `fhStmtFindTable → prove → classify → account facts` are untouched. | One implementation of the proof |
| PS6 | pdf.js vendored under `vendor/pdfjs/`, **lazy-loaded on first PDF open, not precached**; its worker keeps the key derivation off the main thread. | 1.3 MB would double the precache and every bump |
| PS7 | Password flow identical to xlsx: same sheet, opt-in memory under the personal key, no hint (S8). | — |
| PS8 | Same proof, same confirm-or-back-out. | — |
| PS9 | **No OCR.** A scanned PDF stops with a card and the manual door. | Text PDFs are what banks send; OCR is its own problem |
| PS10 | **Fee rows take the post date as `txn_date`** and are classified as fees by their words; they never pair. | The Techcombank file prints fee rows with no transaction date |
| PS11 | **Counterparty = the merchant line; the type words set the kind; the masked tail = account tail.** The full card number and the address are read past. | The two-line description |
| PS12 | A non-VND original amount carries `fx_amount`/`fx_currency`; the VND debit is the amount. | Same contract as email rows; `fx_final` keeps working |
| PS13 | Statement date, due date, limit and closing debt feed the balance anchors like an xlsx card statement; **minimum payment not stored.** | `statement-balance-spec.md` already has the fields |
| PS14 | **No digest.** | Decided against in round 1 |
| PS15 | Fixtures synthetic (reportlab, AES-256 R5, known password); real files git-ignored; `pdfjs-dist` in devDependencies pinned to the vendored build. | Real statements never enter the repo |
| PS16 | **Password remembered per (bank, product).** | A card PDF and an account spreadsheet from one bank can differ |
| PS17 | The manual door accepts `.pdf` once the reader ships. | The way out for expired or dismissed cards |
| PS18 | Auto-stage (S31) applies to unlocked PDFs that prove. | One rule for both file types |
| PS19 | Spec facts about the sample are stated with digits masked and no name, address, account number or password. | — |
| PS20 | **Learning sends masked text only, never the PDF.** Digits → `#`, name and address lines dropped, coordinates kept. | Keeps "file chỉ mở trên máy bạn" true in substance |
| PS21 | **What is learned is a format**: roles with x-ranges, sign, continuation rule, totals labels, keyed by (sender, header signature). | Small, replayable, holds no value from any row |
| PS22 | **A learned format is saved only when the proof passes.** | The proof is the replay check the email templates have |
| PS23 | **Person-initiated, never automatic.** The offer appears after the password step, when no table is found. | — |
| PS24 | **One new consent sentence** (version bump via `consent-gate-spec.md`). | A masked copy still leaves the device |
| PS25 | The offer also covers spreadsheets whose table is not found. | The grid path is one; generalises S19 for free |
| PS26 | A shared format is re-proved on every file; a failing file is "unknown" and gets its own offer; two failures mark the format stale. | Trust in a mapping learned from someone else's file |
| PS27 | The learn call lives in a Vercel function cloned from receipt scan, not in the mailbox worker. | The request starts on the device; the worker never sees the file |
| PS28 | One call per format across all users; a known format is answered from the table. | Free-tier economics |
| PS29 | Build order: §3 → §4–§6 → §7; the coverage matrix is the acceptance gate; thresholds: ≥ 80% of captured PDFs prove silently in the first 4 weeks, kill below 50%. | — |
| PS30 | An amount cell is one figure or the row is unreadable; unreadable rows are named and never queued; glued runs are cut by column geometry, not by a word pattern (2026-11-08). | Two real files, one day after launch: a repayment reached the queue as a 16-digit amount. A word pattern fits the glue it was written for; a shape check and a geometric cut fit the next one |

## 15. Testing

| Suite | Pins |
|---|---|
| `tools/pdf-grid.test.js` (new) | the synthetic Techcombank PDF (locked, known password) → grid: one header, columns carried to pages 2–3, the two-line description joined, fee rows with post date only, the totals block in `notes`; a wrong password surfaces `bad_password`; a scanned PDF (image only) yields no grid |
| `tools/statement-pdf.test.js` (new) | the grid through the REAL `fhStmtParse` and `fhStmtProve`: proves exactly, 35 rows, negative-owed sign, fee rows classified, card repayment as `cardpay`, account facts carry limit, due date and closing debt, masked tail only |
| `tools/statement-table.test.js` | extended: `post_date` role; a file with both dates still matches on the transaction date |
| `tools/pdf-mask.test.js` (new) | `fhPdfGridMask`: no digit survives, no holder name, no address line; coordinates unchanged |
| `tools/statement-learn.test.js` (new) | a model answer applied as `rolesOverride`: proves → saved; does not prove → nothing saved and the card copy; a known format is never re-asked; two failures → stale |
| `api/statement-format.test.js` (new) | refuses a body with a digit in any item; schema validation; rate limit |
| `tools/vendor-pin.test.js` (new) | vendored pdf.js version == `pdfjs-dist` version |
| `pipeline/statement-lane.test.js` | extended: a PDF attachment from a known sender is captured with `file_ext = 'pdf'` |
| `tools/statement-flow.test.js` | extended: the §3 card for an ext this build cannot read; the same card opens when the reader is present |
| `tools/consent-gate.test.js` | the §7 consent sentence is version-gated (`consent-gate-spec.md`) |

## 16. Related

- `docs/specs/statement-capture-spec.md` — the lane; S4 superseded by this spec.
- `docs/specs/statement-coverage-spec.md` — the matrix this spec's reader is held to.
- `docs/specs/statement-balance-spec.md` — what the card facts do.
- `docs/specs/consent-gate-spec.md` — the per-feature ask, and the §7 sentence.
- `docs/specs/email-reading-v2-spec.md` — the once-per-format precedent.
- `docs/features/receipt-scan.md`, `api/receipt-extract.js` — the function pattern §13 clones.
- `docs/specs/device-heat-spec.md` — the unlock cache the PDF path joins.
