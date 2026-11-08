# PDF statements  (brief, 2026-11-08)
Status: merged

Built big-bang with the consent gate and the coverage matrix, by the founder's call (2026-11-08), so stage 2 (a target storyboard shown to users) was skipped for this feature: the design is `docs/specs/pdf-statements-spec.md` (PS1–PS29, grilled the same day on one real file) and the built storyboard is the first picture. §7 of that spec (learning an unknown layout) needs the `statement_formats` migration and is NOT built here; its SQL is handed to the user.

## End state

### Announcement
**Sao kê PDF giờ đọc được**
Ngân hàng gửi sao kê thẻ dạng PDF có mật khẩu? App giờ nhận và đọc được ngay trên máy bạn, như file Excel. File lạ chưa đọc được thì vẫn hiện thành thẻ, nói rõ vì sao.

**PDF statements now read**
Does your bank email card statements as a locked PDF? The app now captures and reads them on your device, like an Excel file. A file it cannot read yet still shows as a card that says so.

### Outcome
A person whose bank emails a locked PDF statement opens "Duyệt giao dịch", sees the statement card, types the password once, and the rows are in the queue with the proof passed; the card's closing debt, limit and dates land on the card's account. A file this build cannot read is a card that says so and offers the file door, never silence.

Screen: the statement card in the queue (`#csv-stm-cards`), the password step painted into `#csv-result`, then the rows.

### Thresholds
Window: 4 weeks from release. The user pulls the numbers; Claude never queries the live database.

| Measure | Success | Kill |
|---|---|---|
| **Silent proof:** captured PDF statements that proved without the confirm step (`statement_files` opened, `statement_rows` written, no mapping confirmation) | ≥ 80% | < 50% |
| **Captured at all:** PDF statement mails from known senders that became a `statement_files` row (`read_tally` stage `stmt_pdf_captured` against Gmail counts the user checks) | ≥ 95% | < 80% |

## Journey
1. **A bank emails a locked PDF statement.** target: the lane captures it (PS1). today: not listed (`filename:xlsx OR filename:csv`). plan: `STATEMENT_EXTS` + query gain `pdf`; one tally stage. feasibility: `pipeline/statement-lane.test.js` passes with the new query (47/47).
2. **The card appears in the queue.** target: "Sao kê Techcombank thẻ tín dụng · 10/2026 · Mở sao kê". today: the card builder is extension-blind. plan: `_stmCanRead(card)` from `fhStmtReaders()`; an unreadable type shows the §3 copy and `fhStmtOpenFile`. feasibility: built.
3. **Mở sao kê → password.** target: the same password step as a workbook, remembered per bank and product (PS16). plan: `_stmGrid` pdf branch → `fhPdfGrid`; `pdf_encrypted`/`bad_password` mapped where the xlsx codes are; `_stmPwScope`. feasibility: built; `tools/statement-pdf.test.js` proves the lock behaviour.
4. **The reader proves the file.** target: rows, proof by totals, fee rows on their post date, fx on foreign rows, account facts. plan: `43-pdf-grid.js` → `fhStmtParse` with the `fxAmount` role, the `postDate` fallback and the three-role header rule. feasibility: the synthetic fixture AND the real file prove exactly (35 rows, totals match).
5. **The outcome.** target: rows in the queue, the card's facts on the account (statement-balance, unchanged). plan: none beyond 4. feasibility: existing path.

## Feasibility inputs needed
Received: one real Techcombank card PDF and its password (local only, never in the repo).

## Screens
- Queue: the statement card (readable / unreadable copy); the file door; the password step with the product-scoped remember switch.
- Manual door: "Nhập file sao kê" accepts `.pdf` (PS17).

## States
- **locked:** password step; wrong password says so; a remembered password is tried first.
- **unsupported:** scanned PDF → "File này là ảnh chụp…" with the file door.
- **unreadable type** (older client): the §3 card.
- **offline:** as every statement open (needs the download).

## Acceptance criteria
- [x] The lane query lists `filename:pdf`; `statementExt('x.pdf') === 'pdf'`; a PDF attachment from a known sender is captured (lane test).
- [x] A card whose extension this build cannot read shows "File PDF, app chưa đọc được…" and opens the file door; the same card opens normally in this build.
- [x] A locked PDF asks for the password; a wrong one says so; the switch reads "Nhớ mật khẩu sao kê thẻ tín dụng Techcombank trên máy này" (product before bank in Vietnamese, "Techcombank credit card statement" in English) and is stored under `(provider|product)`.
- [x] The synthetic Techcombank-layout fixture proves through the real reader: 32 rows, totals exact, fee row on its post date, fx row carries `{amount:2.99, currency:'USD'}`, account facts with negative debt, limit and statement date (`tools/statement-pdf.test.js`).
- [x] The vendored pdf.js equals the `pdfjs-dist` devDependency and is not precached (`tools/vendor-pin.test.js`).
- [x] "Nhập file sao kê" accepts `.pdf` and reads it through the same table finder.
- [x] Every new string has an `L()` twin.

## Out of scope / Known gaps
- **Consent text scope (for the user to decide):** the v5 entry a person agrees to says "file sao kê (Excel/CSV)" while the lane now captures PDF under the same v5. The processing is identical (a statement file sealed to the personal key, opened on the device), so the build rides v5; whether the wording is widened in the next bump (v8, with the learn sentence) or noted in `docs/PDPL-COMPLIANCE.md` is a legal-copy call, and versioned text is never edited in place.
- §7 learn step (needs migration `statement_formats`): SQL handed over, not built.
- The Techcombank subject shape is not seeded (needs a migration): until the user applies the printed seed SQL, the first Techcombank statement per shape costs one model verdict.
- OCR for scanned PDFs; `.xls`; minimum payment as a stored fact.
- A figure wider than its heading starts in the column before (documented limit of the start-x rule).

## Assumptions
- The harness pictures the password and read steps by feeding the fixture through `fhStmtFilePicked` (the storage stub cannot serve a sealed object); the real download path is covered by the existing flow tests. In `04-read` the reader ran and the proof passed (no column confirmation was asked), then the write to `stage_statement_rows` failed against the stub (no RPC), so the frame shows the retry card; the write itself is `tools/statement-flow.test.js`'s.
- Found while shooting: a dynamic `import()` needs a relative specifier (`./vendor/pdfjs/…`); the bare path resolved nowhere, and the mapped message ("Chưa tải được bộ đọc PDF") was the first honest sign. The harness server now serves `.mjs` as JavaScript.
- Stage 2 skipped by the founder's big-bang decision; the built storyboard is the review surface.

## Target manifest
None (stage 2 skipped). Built manifest: `tools/ui-harness/manifests/pdf-statements.js` (01-card-unread · 02-card-pdf · 03-password · 04-read).
