# Receipt scan  (brief, 2026-09-15)
Status: storyboard-sent

Supersedes the 2026-09-14 draft. Written end first, per `docs/WORKFLOW.md`. Why the feature is shaped this way: `research/jtbd-individual-finance.md`, Part 4.

## End state

### Announcement
**Chụp hóa đơn, app tự ghi**
Trả bằng MoMo hay tiền mặt thì không có email nào báo về. Giờ bạn chụp hóa đơn hoặc chọn ảnh chụp màn hình, một lúc tới 10 tấm, app đọc số tiền và ngày giúp bạn, bạn chỉ cần xem lại rồi lưu.

**Snap a receipt, and it's logged**
Paying with MoMo or cash sends no email. Now you can photograph receipts or pick screenshots, up to 10 at once. The app reads the amount and date, and you just check and save.

### Outcome
Each scanned receipt becomes an expense in the person's ledger with the right amount and date and its receipt attached. It is visible in the transaction list the moment they save, and to the family the same way a typed expense is. The receipt stays with its expense and never appears in Kỷ niệm. Over time the person trusts the read enough that checking takes seconds.

The screen where they see it: the Chi tiêu transaction list (`#tx-rows`) with the new rows marked, and one toast, "Đã ghi 3 khoản từ hóa đơn · 439.000đ". A personal-scope scan lands in the Cá nhân transaction list instead.

### Thresholds
Window: 8 weeks from release. Rates only. The user pulls the numbers; Claude never queries the live database.

The build writes `source = 'scan'` on a row saved with the amount as read, and `'scan-edited'` when the person changed the amount. `source` is plain text on `transactions` and `personal_transactions`, readable for encrypted families too.

| Measure | Success | Kill |
|---|---|---|
| **Read trust:** saved scans whose amount was not changed | ≥ 80% | < 65% |
| **Repeat:** people who saved a scan and saved another in a later week, within 4 weeks | ≥ 40% | < 20% |
| **Coverage lift:** expenses logged per scanner in the 4 weeks after their first scan, against the 4 weeks before | ≥ +15% | ≤ 0% |
| **Disclosure:** scanned receipts found in Kỷ niệm or outside their expense | 0 | any one, pull at once |

Coverage lift is the outcome measure. Scanning that only replaces typing moves read trust and repeat, but not coverage.

**Not measurable today (feasibility result):** scan attempts, scans abandoned before Save, and consent declines. The app has no event tracking anywhere, the consents table is legal proof and must not hold declines, and a counter table is a migration, which this workflow does not do. See *Feasibility inputs needed*, item 3.

Queries for the user (family ledger shown; the personal ledger is the same with `personal_transactions` and `owner_user_id`):
```sql
-- Read trust
select source, count(*) from transactions
where source in ('scan','scan-edited') and created_at >= :release group by source;

-- Repeat: scanners whose scans fall in 2+ distinct weeks within 28 days of their first
with s as (select member_id, created_at from transactions where source like 'scan%' and created_at >= :release),
     f as (select member_id, min(created_at) first_at from s group by member_id)
select avg(case when weeks >= 2 then 1.0 else 0 end) as repeat_rate from (
  select f.member_id, count(distinct date_trunc('week', s.created_at)) weeks
  from f join s using (member_id) where s.created_at < f.first_at + interval '28 days' group by f.member_id) x;

-- Coverage lift: typed + scanned expenses per scanner, 28 days after first scan vs 28 days before
with f as (select member_id, min(created_at) first_at from transactions where source like 'scan%' group by member_id)
select sum(case when t.created_at >= f.first_at then 1 else 0 end)::float
     / nullif(sum(case when t.created_at < f.first_at then 1 else 0 end), 0) - 1 as lift
from f join transactions t on t.member_id = f.member_id
where (t.source is null or t.source like 'scan%')
  and t.created_at between f.first_at - interval '28 days' and f.first_at + interval '28 days';
```

## Journey
Derived backwards from the outcome; read top to bottom from first awareness. Each stage: **target · delivers to the next stage · today · gap · plan · feasibility** (✅ checked · ⏳ waits on an input · ❌ accepted gap).

Capture follows Apple's document scanner (`VNDocumentCameraViewController`): a full-screen camera, a tray counting what has been captured, one commit verb. Expensify's SmartScan has the same shape. In the pattern lexicon it is a **stage-and-commit basket**: each capture stages a photo, Xong commits the batch. Review then reuses the ledger's own row, so a scanned expense reads like every other expense, with the receipt as the tile saying where it came from.

### 1. Hearing it exists
- **Target:** existing users meet the note in "Có gì mới" once. Everyone meets a "Quét hóa đơn" row in the add sheet and in the personal quick-add.
- **Delivers:** a person who knows scanning exists and ties it to their own moment.
- **Today:** the note opens by itself once for onboarded users with an unseen release (`src/js-ui/90-release-notes.js:294-309`). Finishing onboarding marks every note seen (`src/js-ui/80-onboard-boot.js:263`), so later joiners never see it.
- **Gap:** no scan row anywhere.
- **Plan:** a release note from the Announcement; a row under "Ghi giao dịch" in `#sheet-add`; the same row after the personal "Ghi giao dịch" (`src/js-ui/21-personal.js:313`). The entry point decides the book: the add sheet saves to the family, the personal card to Cá nhân.
- **Feasibility:** ✅ every surface exists.

### 2. The moment of need
- **Target:** the person reaches for a scan when typing is worse: a long receipt, a MoMo or cash payment no email reports, a busy checkout, a week's pile.
- **Delivers:** the intent to scan now.
- **Today:** they type, or skip logging. E-wallet payments cannot be harvested (research Part 4).
- **Gap and plan:** no screen. The Announcement names these moments in people's own words.
- **Feasibility:** ⏳ demand is still a hypothesis (JTBD 1, approach 2). Real users see the target before any build.

### 3. Agreeing, once
- **Target:** the first scan shows one short sheet: what is sent, what for, who reads it, whether anything saves by itself, how long it is kept, how to stop, who is answerable. "Đồng ý và mở máy ảnh" goes straight to the camera; "Để sau" closes with nothing sent. Later scans skip it.
- **Delivers:** a recorded consent, and the camera.
- **Today:** consent sheets exist for bank email (`src/js-data/75-consent-ui.js:526-587`), with a test asserting the seven items the law requires (`tools/consent-gate.test.js:101-116`).
- **Gap:** no consent kind or sheet for scanning.
- **Plan:** kind `receipt_scan` v1; the sheet in a new `src/js-data/78-receipt-scan.js` reusing the `cst-*` classes; the image is sent only after the insert confirms; the seven items asserted by a test. The agree tap acquires the camera stream **synchronously inside the tap** and awaits the consent insert afterwards, the way quick review does (`_qrCamPreacquire`), because iOS drops the gesture across an await; a failed insert stops the stream.
- **Feasibility:** ✅ the consents insert policy checks only the author (`supabase/migrations/0082_user_consents_disconnect.sql:39`), so no migration. ✅ the sheet itself is a new file, so the only edits to `75-consent-ui.js` are the three additive ones in stage 9. ⏳ the Gemini tier, since the sheet may only claim what those terms allow.

### 4. Capturing
- **Target:** a full-screen camera. Corner brackets frame the receipt, one line narrates ("Đưa hóa đơn vào khung"), the shutter sits under the thumb, the library button is on the left, and each capture drops into a tray on the right with a running count. "Xong" ends the batch. Up to 10.
- **Delivers:** a set of images, each destined to be one expense.
- **Today:** the app already runs a live camera inside a sheet, including the iOS rule that `getUserMedia` must be called inside the tap (`src/js-data/76-quick-review.js:603-679`). `readPhoto` keeps the capture date (`src/js-ui/50-sheets-expense-capture.js:1077`).
- **Gap:** no full-screen capture surface, no tray, no batch.
- **Plan:** a new full-screen surface reusing the quick-review camera code, requesting a high-resolution stream and drawing the full frame before compression, since receipt text needs it; the library button opens the system picker, which is how bank screenshots arrive. The build names it (`.scan-cam`, `.scan-frame`, `.scan-tray`, `.scan-shutter`) with its own dark token rather than raw hex, adds those to `DESIGN.md` §3, and records the layer in §4: **capture 66**, above modals (62) and sheets (60), below the photo viewer (68).
- **Feasibility:** ✅ camera precedent exists in the app. ✅ 10 sits under the 20 the receipt tool already holds in memory on iOS. ⏳ live edge detection is unproven; v1 may ship with static brackets and no auto-capture.

### 5. Reading
- **Target:** the review list opens at once, one row per photo, each saying "Đang đọc…" with its receipt already the tile. Rows fill in place as each read lands, under a line that counts progress and names the book.
- **Delivers:** rows with amount, note, date and category where it maps, or an honest "Chưa đọc được".
- **Today:** nothing reads images. The only client-to-model call is the CSV mapper (`api/csv-column-mapping.js`): sign-in check, 12 per person per minute, strict schema.
- **Gap:** the server function, a client read queue, per-row states.
- **Plan:** `api/receipt-extract.js` modelled on the CSV mapper, sending the compressed copy (1600px JPEG, metadata stripped); every returned amount re-parsed with the email pipeline's `parseAmountCell`, the date checked as a strict ISO date inside a sane window (the pipeline's `parseWhenCell` reads bank-cell shapes and rejects a bare date, so it is the wrong tool here); an amount missing from the model's own transcription is flagged; the client divides by `curMult()` exactly once.
- **Feasibility:** ✅ a compressed image sits far under the request size limit. ✅ 10 reads fit the limiter. ⏳ **amount accuracy on real Vietnamese receipts and screenshots, which needs your images.** Gate: at least 95% of amounts right, else the target becomes typing with the receipt beside you. ⏳ read time per image.

### 6. Checking
- **Target:** the review list is the ledger's own row: receipt as tile, merchant as title, amount and category on the right. A doubtful amount replaces the date line with amber "Kiểm tra lại số tiền". An unreadable photo reads "Chưa đọc được · chạm để nhập tay" with no amount. Tapping a row opens the existing expense form for that row alone; tapping a receipt opens it large.
- **Delivers:** values the person has compared with the receipt.
- **Today:** the ledger row already shows a photo as its tile (`src/js-ui/60-transactions.js:125-128`). The photo viewer only opens event memories (`src/js-ui/65-events-gallery-peek.js:106`).
- **Gap:** the review surface, the row states, a viewer for an arbitrary image, and a single-row mode of the expense form.
- **Plan:** a full-screen review list at **layer 61**, above sheets (60) and below the expense form (62) it drills into, recorded in `DESIGN.md` §4; its swipe-down dismissal goes through the same arm-then-confirm as Cancel, since `initSheetDrag` wires every modal at boot; rows built from the ledger's row markup; a review mode for `#peek` whose action is **Chụp lại**, since `.peek-actions` is always visible by design (`src/css/65-peek-celebrate.css:37`) and a row that is not yet an expense has nothing to delete.
- **Feasibility:** ✅ the viewer stacks above the form (`src/css/65-peek-celebrate.css:6` at 68, `src/css/50-sheets-modals.css:10` at 62). ✅ the expense form already opens prefilled for one row. ❌ drafts keep no photos across a reload (`docs/features/expense-capture.md`), so a batch dies if iOS reloads the tab. Accepted for the first release.

### 7. Saving
- **Target:** the commit lives in the nav bar with the count in its label, "Lưu 3", grey until something is ready, exactly as the CSV import review does (`csv-save`, `src/js-ui/56-csv-import-ui.js:2580`). The section header carries the book and the total ("Sổ gia đình · 439.000 đ"), so one line narrates and one control commits. Unread rows stay behind, and a line under the list says so.
- **Delivers:** ledger rows, each marked as scanned.
- **Today:** bulk save attaches photos to the first row only (`submitBulk`), and so does the personal save (`_submitPersonalExpense`). Source is stamped only on bulk saves, from `_fhImportSrc` (`src/js-data/50-writethrough-realtime.js:12`).
- **Gap:** photos per row; a source for scans on every save path.
- **Plan:** each row carries its own photo through both save paths, which is one line in each save loop because the data layer already uploads whatever photos a row carries (`_dbUploadTxnPhotos`); the personal path passes the `source` argument it currently drops; `scan` when the amount was untouched, `scan-edited` when the person changed it.
- **Feasibility:** ✅ `source` is plain text with no constraint (`supabase/migrations/0100_txn_source.sql:19-21`), so no migration.

### 8. Seeing it in the ledger (the outcome)
- **Target:** saving opens the transaction list with the new rows marked and one toast with count and total. Each row shows its receipt as the tile. The family sees the rows. The receipt is not in Kỷ niệm.
- **Delivers:** the outcome.
- **Today:** saving opens the overview, not the list (`src/js-ui/60-transactions.js:436`). A photo on an expense also becomes a memory and the toast says so (`:432`), because the memories feed treats every expense photo as a memory (`src/js-ui/40-memories.js:141-148`). The photo strip promises "lưu thành kỷ niệm" too (`src/js-ui/55-expense-photos-writes.js:216`). Uploads show a progress chip (`:577`).
- **Gap:** landing screen, marking, toast wording, the strip's promise, and receipts leaking into Kỷ niệm through **two** doors: the memories feed, and the expense-to-event mirror (`syncExpenseEvent`, fired by `addExpense` for any photo expense, `src/js-ui/60-transactions.js:421`), which carries the photo into the events list.
- **Plan:** open the activity list and mark the new rows briefly; toast "Đã ghi N khoản từ hóa đơn"; store receipts under an object name starting `rcpt_`, skip those in the memories feed, and skip the event mirror for them; a client-side set of receipt sources covers the window before upload, when the photo is still a data URI.
- **Feasibility:** ✅ the snapshot carries only the photo's path, and storage policies check only the family folder (`(storage.foldername(name))[1]`, `supabase/migrations/0017_public_media_bucket.sql:34-43`), so a marker in the file name reaches every device with no migration. ✅ marking rows needs CSS only.

### 9. Stopping (branch)
- **Target:** Settings, Privacy lists "Quét hóa đơn · Đang bật" beside bank email. Opening it restates what is sent and offers "Dừng gửi ảnh cho AI". Stopping works at once, and the next scan asks again.
- **Delivers:** withdrawal as easy as consent.
- **Today:** `fhPrivacySheet` (`src/js-data/75-consent-ui.js:334`) already renders **one row per consent** it finds in `user_consents`, under "Điều bạn đã đồng ý", each row navigating to `fhConsentReview(kind)`. So the row is not a new screen; it appears by itself once the consent exists and the sheet knows its label.
- **Gap:** `_CST_LABELS` has no entry for `receipt_scan`, the glyph set `_MBX_SVG` has no camera, and `fhConsentReview` routes only the two known kinds.
- **Plan:** add `receipt_scan: ['Quét hóa đơn','Receipt scan','cam']` to `_CST_LABELS`, a `cam` line glyph to `_MBX_SVG` (DESIGN §2.6 forbids emoji as a functional icon), and a `receipt_scan` branch in `fhConsentReview` that opens the scan consent sheet read-only with "Dừng gửi ảnh cho AI". Withdrawal records kind `receipt_scan_withdraw`.
- **Feasibility:** ✅ same table, no migration, and no new screen. ⚠️ these three edits are the only ones this feature makes to `75-consent-ui.js`, which `bank-email-sealing` is also editing; they are additive, but claim them in `AGENT_SYNC.md` before touching the file.

## Feasibility inputs needed
1. **20 to 30 real receipts and bank or e-wallet screenshots** from the team's phones, each with its correct amount and date (stage 5 gate).
2. **The Gemini tier:** free or paid (stage 3 consent copy).
3. **A counter migration or not:** without one, attempts, abandons and consent declines cannot be measured (Thresholds).
4. **An iPhone pass** on the picker and consent moments (stage 3).

## Screens
| Stage | Screen or state | Opened by |
|---|---|---|
| 1 | Note in "Có gì mới" | `openWhatsNew()`, automatic once after release |
| 1 | "Quét hóa đơn" in the add sheet | `openSheet('sheet-add')`, row calls `fhScanStart('family')` |
| 1 | "Quét hóa đơn" in the personal quick-add | `go('personal')`, row calls `fhScanStart('personal')` |
| 3 | Consent sheet | `fhScanStart()` without a current consent |
| 4 | Full-screen camera, tray and count | after consent, or straight from the row |
| 4 | System picker, for screenshots | the library button on the camera |
| 5 | Review list, rows reading | Xong |
| 6 | Review list, mixed states; receipt large | reads land; tap a receipt |
| 6 | Expense form for one row | tap a row |
| 8 | Transaction list, new rows marked, toast | Lưu |
| 9 | Settings, Privacy: "Quét hóa đơn" row in "Điều bạn đã đồng ý" | `fhPrivacySheet()`, row calls `fhConsentReview('receipt_scan')` |

## States
- **Reading:** cards say "Đang đọc…" under a progress line.
- **Partial read:** only fields that passed re-parsing are filled.
- **Doubtful amount:** "Kiểm tra lại".
- **Unreadable or not a receipt:** "Chưa đọc được · chạm để nhập tay" in muted ink with the affordance in brand ink, photo kept, no amount.
- **Offline:** nothing is sent; drafts open with their photos to be typed.
- **Consent record failed:** error in the sheet, nothing sent.
- **Declined:** the sheet closes, nothing sent.
- **Withdrawn:** the next scan asks again.
- **Encrypted family:** the same flow after consent; saved photos are encrypted as today.

## Acceptance criteria
- [ ] Onboarded users see the "Chụp hóa đơn, app tự ghi" note once after release, in both languages. · evidence: no receipt_scan entry in src/js-ui/90-release-notes.js; built shots/receipt-scan/01-whatsnew.vi.sage.png lacks the note the target 01-whatsnew shows — the note is written at ship
- [x] The add sheet shows "Quét hóa đơn" directly under "Ghi giao dịch", and the personal quick-add shows the same row. · evidence: shots/receipt-scan/02-addsheet.vi.sage.png and 03-personal.vi.sage.png, both matching their targets: “Quét hóa đơn” directly under “Ghi giao dịch”
- [x] The entry point decides the book: from the add sheet the batch saves to the family ledger, from the personal card to Cá nhân, and the review list says which. · evidence: flows.json scan-review-save-family, step “seed a reviewed batch”, check “header names the family book”; receipt-scan.test.js “the header names the personal book” + “a personal batch commits through _submitPersonalExpense with source on the row”
- [x] The first scan shows a consent sheet stating what is sent, what for, the third party (Google), how it is processed, how long it is kept, how to stop, and the controller's contact, asserted by a test. · evidence: receipt-scan.test.js, seven PASS checks WHAT/WHY/WHO ELSE (Google)/HOW/HOW LONG/RIGHTS/WHO IS ANSWERABLE; 04-consent.vi.sage.png matches its target
- [x] No image is sent before a `receipt_scan` consent row is confirmed; declining, or a failed record, sends nothing. · evidence: receipt-scan.test.js “a failed insert: no camera, no cache, a friendly toast”, “a first scan with no consent on record shows the sheet, never the camera”, “a confirmed insert writes kind receipt_scan v1, caches, and opens the camera”
- [x] Agreeing opens the camera directly, with no expense form in between. · evidence: receipt-scan.test.js “agreeing opens the camera, not a form”
- [x] The camera is full screen with a shutter, a library button, a narrator line and a tray showing the running count, and never shows expense fields. · evidence: shots/receipt-scan/05-camera.vi.sage.png + 06-camera-batch.vi.sage.png vs target 06: brackets, “Đưa hóa đơn vào khung”, shutter, library button, tray count, no expense fields (torch button is iPhone-only)
- [x] Up to 10 photos per batch, and Xong ends the batch. · evidence: 06-camera-batch.vi.sage.png shows the tray count 3 and Xong; every review test drives fhScanDone; the cap is MAX=10 at src/js-data/78-receipt-scan.js:22,206
- [x] The review list opens at once with one row per photo, each carrying its receipt as the tile, under a line that counts progress and names the book. · evidence: shots/receipt-scan/07-reading.vi.sage.png, pixel-for-pixel the target: four rows, receipt tiles, “Đang đọc 4 ảnh…” and “Sổ gia đình”
- [x] Rows fill in place as each read lands; a row still reading shows a placeholder, never a control. · evidence: 07-reading.vi.sage.png shows placeholder bars only, no controls; 08-review.vi.sage.png shows the same rows filled — both match their targets
- [x] A receipt totalling 337.900đ fills the row as 337.900 and saves as 337.900đ. · evidence: receipt-scan.test.js “raw 337900 becomes 337.9 base units: divided by curMult exactly once”; receipt-extract.test.js “200 with the amount in RAW units (337900, not 337.9)”
- [x] A returned amount or date that fails re-parsing leaves its field empty; an amount missing from the transcription shows amber "Kiểm tra lại số tiền" in place of the date line. · evidence: receipt-extract.test.js “a malformed date is dropped” / “an amount the transcription does not contain is flagged”; receipt-scan.test.js “an unverified amount renders the amber check line”; 08-review.vi.sage.png shows amber “Kiểm tra lại số tiền” in the date line
- [x] An unreadable photo shows "Chưa đọc được · chạm để nhập tay" with no amount, and is never saved silently. · evidence: 08-review.vi.sage.png “Chưa đọc được / Chạm để nhập tay” with no amount; flows.json step “the unread row stayed behind”
- [x] Tapping a row opens the existing expense form for that row alone; tapping a receipt opens it large with a retake action. · evidence: 09-edit-row.vi.sage.png (“Sửa khoản 2/4”, prefilled) and 10-receipt-large.vi.sage.png with “Chụp lại”; receipt-scan.test.js “the existing expense form opens for that row with its photo and scope”
- [x] The commit is the nav Save with the count in its label, grey until a row is ready; the section header carries the book and the total; a line under the list says what happens to rows left behind. · evidence: 08-review.vi.sage.png “Lưu 3” + “Sổ gia đình · 439.000 đ” + the line under the list; 07-reading.vi.sage.png shows Lưu grey; receipt-scan.test.js “Save counts only the ready rows”
- [x] Cancel arms before discarding a batch, like `cancelExpense` does for a draft, because the review holds every captured photo and read amount and cannot survive a reload. · evidence: receipt-scan.test.js “first tap arms and does not close” + “second tap closes”
- [x] Offline, no request is made, and rows open with their photos to be typed. · evidence: receipt-scan.test.js “no request is made” + “the rows open with their photos, marked not sent, save grey”; 14-offline.vi.sage.png
- [x] Saved scanned rows carry `source` `scan`, or `scan-edited` when the amount was changed. · evidence: flows.json step “the backend was told the right things”, check “both carry source=scan”; receipt-scan.test.js “a changed amount is stamped scan-edited, with the edited values”
- [x] After saving, the transaction list opens with the new rows marked and a toast stating count and total. · evidence: flows.json scan-review-save-family "the two saved rows are marked in the list" + the toast check; 11-outcome.vi.sage.png · evidence: 11-outcome.vi.sage.png has the marked rows and the toast “Đã ghi 3 khoản từ hóa đơn · 439.000 đ”, but all three saved rows read 08:12 where target 11-outcome reads 08:12 / 09:40 / 16:05 — per-row time is lost in submitBulk (src/js-ui/50-sheets-expense-capture.js:954 with :230)
- [x] No scanned receipt appears in Kỷ niệm, on this device or on another device after it hydrates. · evidence: flows.json checks “no QC receipt in the memories feed” and “every receipt object name starts with rcpt_”; receipt-scan.test.js rcpt_ path checks including the .enc variant
- [x] Neither the photo strip nor the save toast tells the person a receipt is saved as a memory. · evidence: flows.json toast check “Đã ghi 2 khoản từ hóa đơn · 203.000 ₫” (no memory claim); strip copy at src/js-ui/55-expense-photos-writes.js:222-226 — the strip is below the fold in every shot
- [x] Other family members see scanned rows like any typed expense. · evidence: flows.json step “the backend was told the right things”: two transactions inserts and a transaction_photos insert per row, the same tables a typed expense writes
- [x] Settings, Privacy shows "Quét hóa đơn" as a row in "Điều bạn đã đồng ý" with the date agreed and a line-SVG camera glyph, and opening it offers "Dừng gửi ảnh cho AI"; stopping records a withdrawal and the next scan asks again. · evidence: 12-settings-privacy.vi.sage.png shows “Quét hóa đơn · 2 thg 1” as the third consent row with a line-SVG camera; 13-stop.vi.sage.png offers Dừng; receipt-scan.test.js “after a withdrawal the sheet is asked again”
- [x] The server function answers 401 without sign-in, 400 for a bad or oversized image, and 429 over the limit, and logs no image content or values. · evidence: receipt-extract.test.js “bad token is 401”, “non-base64 image is 400”, “wrong mime is 400”, “oversized image is 400 and Gemini is never called”, “raw_text never reaches the client”; the limiter 429 is api/receipt-extract.js:136 and the file has no console call
- [x] Every new string exists in Vietnamese with full diacritics and in English. · evidence: i18n audit CLEAN after four copy fixes; report.json language lint carries no scan string on any en shot · evidence: report.json language lint on 03-personal.en and 02-addsheet.en flags span.cc-t “Quét hóa đơn” — the personal quick-add label is hardcoded Vietnamese at src/js-ui/21-personal.js:315
- [x] Baseline screenshots and flows show no regressions. · evidence: shots/baseline/report.json 30 shots, no setup or console errors; shots/baseline/flows.json both flows ok=true

## Verification (stage 4)
44 client checks (`tools/receipt-scan.test.js`), 29 server checks (`tools/receipt-extract.test.js`), a 17-check save flow (`tools/ui-harness/flows/receipt-scan.flow.js`), 28 built screens against their targets, 67/67 test files, boot timing/freeze/freeze-early/warm all green, baseline shots and flows unchanged.

Two defects the acceptance pass caught, both fixed:
- **Per-row time was lost on every batch save** (`submitBulk` moved `loadRow(k)` without moving `bulkActive`, so `_syncExTime` read row 0 and stamped the first row's time on all of them). This was a pre-existing bug in the shared save loop that scan rows exposed, and it also affected CSV import and bank-email review, since all three carry `_timeAuto:false` rows. The flow now asserts each row keeps its own time.
- **The personal quick-add row was Vietnamese-only**; it now localizes like its add-sheet twin. The rest of that tab stays a pre-existing gap.

## Out of scope / Known gaps
- A receipt that needs more than one photo.
- Splitting one receipt's items into several rows.
- Warning when a screenshot duplicates a staged bank-email transaction.
- A batch surviving an app reload, because drafts keep no photos today.
- Measuring attempts, abandons and consent declines, pending the counter decision.
- Target pictures for the declined, consent-failed and encrypted-family states; only offline is drawn.
- iOS picker and gesture behaviour, verifiable only on a phone.

## Assumptions
1. Consent is asked of every family, not only encrypted ones, because the image reaches Google's AI either way. Confirm at target approval.
2. Up to 10 photos per scan, each one expense, as recommended in chat on 2026-09-15. Confirm at target approval.
3. Discovery runs through the release note, the add sheet row and the personal quick-add row. The contextual offer inside the manual form was dropped: scanning is its own surface, not a branch of typing.
4. The image sent is the compressed copy the app already makes for uploads; nothing read is stored or logged on the server.
5. Client code goes in a new `src/js-data/78-receipt-scan.js`. The only edits to `75-consent-ui.js` are the three additive ones in stage 9, claimed in `AGENT_SYNC.md`.
6. `api/receipt-extract.js` is the one piece of product code outside `src/`; tests, manifests and docs live where they always do.

## Target manifest
`tools/ui-harness/manifests/receipt-scan-target.js`, in journey order. The built manifest reuses these names. Stage 2 has no screen, and the system picker is the iPhone's own, so neither is mocked.

| Shot | Stage | Shows |
|---|---|---|
| 01-whatsnew | 1 | the note at the top of "Có gì mới" |
| 02-addsheet | 1 | the new row in the add sheet |
| 03-personal | 1 | the new row in the personal quick-add |
| 04-consent | 3 | the consent sheet, ending in "Đồng ý và mở máy ảnh" |
| 05-camera | 4 | the viewfinder with brackets and narrator |
| 06-camera-batch | 4 | three captured, tray count and Xong |
| 07-reading | 5 | the review list, every row reading |
| 08-review | 6 | two read, one flagged, one unreadable, save button ready |
| 09-edit-row | 6 | the existing expense form opened for one row |
| 10-receipt-large | 6 | the receipt large above the review list |
| 11-outcome | 8 | the transaction list with new rows marked and the toast |
| 12-settings-privacy | 9 | the real privacy sheet, with "Quét hóa đơn" as a third consent row |
| 13-stop | 9 | the stop sheet |
