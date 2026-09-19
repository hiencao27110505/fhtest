# Receipt Scan

## Problem & Why

Two kinds of spending never reach the ledger through the bank-email pipeline: cash, which leaves no record anywhere but a paper receipt, and e-wallet payments (MoMo, ZaloPay), which leave a perfect record inside an app we cannot enter. Vietnamese users already screenshot those confirmations because the screenshot *is* their receipt. Scanning makes that artifact useful and reaches the one hole no other channel can (`research/jtbd-individual-finance.md`, Part 4).

Three product decisions follow from working backwards from the outcome (`docs/briefs/receipt-scan.md`):

1. **Scanning is its own surface, not a branch of typing.** For a known amount, typing "cafe 50k" is faster and always will be. A scan earns its place for a long receipt, a busy checkout, a payment no email reports, or a week's pile. So capture is a full-screen camera on Apple's document-scanner skeleton, a tray that counts, one commit verb. The manual expense form appears only when the person taps a row to fix it.
2. **Review reuses the ledger row.** A scanned expense reads like every other expense, with the receipt as the row's tile saying where it came from. The commit is the nav Save with the count in its label, grey until a row is ready, exactly as the CSV import review does.
3. **The model reads; the app verifies; the person confirms.** Nothing is written automatically. Every returned amount is re-parsed with the bank-email pipeline's own amount reader, the date is checked as a strict ISO date in a sane window, and an amount the model's own transcription does not contain is flagged in amber. A read that is right most of the time can never be an automatic write, but it can be a prefill a human confirms.

## Architecture & How It Works

### Consent before bytes
A first scan shows one sheet carrying the seven items the law requires (`tools/receipt-scan.test.js` asserts each). The agree tap acquires the camera stream **synchronously inside the tap** (iOS drops the gesture across an await, the trick quick review uses), then awaits the `user_consents` insert (kind `receipt_scan`, version 1). A failed insert stops the stream and sends nothing. A per-device memo (`fh-scan-consent-v1` in localStorage) lets later scans open the camera inside the tap; the table is re-verified on every use and a withdrawal anywhere (`receipt_scan_withdraw`) clears it. The privacy sheet lists the consent as one more row because `fhPrivacySheet` renders one row per consent kind it knows (`_CST_LABELS` gained `receipt_scan`, `_MBX_SVG` gained a `cam` glyph, `fhConsentReview` gained a branch).

### Capture (`.scan-cam`, layer 66)
`src/js-data/78-receipt-scan.js` drives `#scan-cam` in `src/index.html`: a high-resolution rear stream drawn frame-for-frame onto a canvas at capture, a library button for screenshots (the system picker), up to 10 photos, each stored as a data URI and remembered in a **receipt set**. Cancel arms when captures would be lost. Styles in `src/css/76-receipt-scan.css` (DESIGN §3 "Receipt scan"; layers in §4).

### Reading (`api/receipt-extract.js`)
Each photo is compressed by the app's existing `fhCompressImage` (1600px JPEG, which strips EXIF/GPS) and posted with the session token to a Vercel function cloned from the CSV column mapper: POST only, key present, token verified against Supabase auth, 12 calls per person per minute, mime and size checked. Gemini answers a strict schema at temperature 0. The function re-validates everything (`validate()`, pure and unit-tested), returns fields only, never logs the image or the values, and never echoes a Gemini body. The transcription is used for the amount cross-check and dropped. Three reads run at a time so rows fill in place.

### Review (`#scan-review`, layer 61)
The ledger's own `.rows`/`.row` markup, rendered by the engine: a placeholder while reading, amber "Kiểm tra lại số tiền" for a flagged amount, "Chưa đọc được · chạm để nhập tay" for an unreadable photo, "Chạm để chọn danh mục" when the family has no category for the concept. Tapping a row opens the existing expense form for that row; its Save is intercepted (`fhScanCollectEdit`, one hook at the top of `submitExpense`) and the fields flow back to the review, which owns the commit. Tapping a receipt opens it in the existing photo viewer with **Chụp lại** instead of delete, since the row is not an expense yet. `closeModals` keeps the review open while a form sits on top of it, the same rule `photo-assign` uses.

### Commit
The batch goes through the **existing** save paths: `submitBulk({prepared:true, stay:true})` for the family, `_submitPersonalExpense()` for Cá nhân. Two one-line changes let each row carry its own photo (both loops previously attached photos to row 0 only), and the personal path now passes the `source` it used to drop. Every row is stamped `scan`, or `scan-edited` when the person changed the amount, in the existing plain-text `source` column (0100), which is what makes the brief's thresholds measurable with no migration. Category chips are rebuilt before the commit because a scan may never have opened the form.

### Receipts never become memories
Two doors, both closed by one predicate, `fhIsReceiptSrc(src)`: true for a data URI in the receipt set, or for a storage path whose object name starts with `rcpt_`. `_uploadPhoto` decides on the **original** data URI (compression mints a new string) and prefixes the object name; the snapshot carries only that path, so every device can tell a receipt from a memory with no column. The memories feed skips receipt sources; `addExpense` skips the event mirror for them; the photo strip stops promising "lưu thành kỷ niệm"; the per-photo "Đã lưu ảnh" toast is quiet for a receipt batch so the batch toast survives. Saved rows are marked briefly in the list by note and amount, which is what survives the re-hydrate 700 ms after a write.

### Test seams
`window.__fhScanSeed` renders any review or camera state without a camera or a network (the UI harness uses it; it renders, never fakes a read). `tools/receipt-scan.test.js` runs the real client file in a vm with a record-based fake DOM; `tools/receipt-extract.test.js` runs the real handler with a fake fetch and the real parsers; `tools/ui-harness/flows/receipt-scan.flow.js` saves a seeded batch through the real save path and asserts the stub's write log; `tools/receipt-bench.js` is the accuracy gate over real images.

## Current State

Built on `feat/receipt-scan` (2026-09-19), not yet shipped. 44 client and 29 server unit tests pass; the save flow passes 16 checks; 14 built screens match their approved target pictures in both languages. Open before release:

- **The accuracy gate has not run.** `tools/receipt-bench.js` needs 20–30 real receipts and screenshots with answers. Gate: amounts right ≥ 95%, dates ≥ 90%. If it fails, the target becomes typing with the receipt beside you.
- **The Gemini tier decides what the consent sheet may claim.** The copy says only "theo điều khoản của gói đang dùng" for that reason.
- **Vercel must trace the dynamic import** of `labeltable.mjs` from the CommonJS function; verify on the preview deploy. The function fails closed (500) if the validator cannot load.
- **iPhone-only:** the system picker, the tap-gesture camera rule, torch support, and `100vh` behaviour are verifiable only on a phone.
- **Not measurable without a migration:** scan attempts, abandons, consent declines.

## Related

- [docs/briefs/receipt-scan.md](../briefs/receipt-scan.md) — the brief: end state, thresholds, the journey with feasibility per stage, acceptance criteria.
- [research/jtbd-individual-finance.md](../../research/jtbd-individual-finance.md) Part 4 — why capture is transcription under time decay, and why images are a reach into the e-wallet hole.
- [expense-capture.md](expense-capture.md) — the expense form, bulk rows, photo upload and EXIF path this feature rides on.
- [memories.md](memories.md) — the feed and the event mirror that receipts must stay out of.
- `DESIGN.md` §3 "Receipt scan", §4 layers 61 and 66.
