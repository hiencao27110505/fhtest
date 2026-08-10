# Expense Capture

## Problem & Why

Logging a spend is the single most frequent write in FamilyHub, and it has to survive real conditions: someone typing on a phone one-handed at a register, entering several items from one grocery run at once, or getting interrupted mid-entry by a phone call. Three product decisions follow directly from that:

1. **Bulk, natural-language entry.** A family rarely spends on one thing at a time — a market run is five line items, not one. Forcing five separate "open form → fill fields → save → reopen" cycles is the kind of friction that gets people to stop logging altogether. The expense modal instead behaves like a single running list: typing `"cafe 50k, chợ 200k, đi chơi 800k"` and moving on peels each comma-terminated segment into its own row, with amount and category already guessed from the text (`src/js-ui/50-sheets-expense-capture.js:135-139,488-540`).
2. **Draft persistence.** Any bottom-sheet dismissal — swipe-down, tapping the scrim, a stray back-gesture — is easy to trigger by accident. Losing a half-typed multi-item entry to that is a worse experience than not having autosave at all, so every keystroke is mirrored to `localStorage` and silently restored the next time the sheet opens (`src/js-ui/50-sheets-expense-capture.js:202-205`).
3. **A dedicated after-the-fact photo-assignment tool.** Receipt photos and expense entries don't always happen in the same sitting — someone dumps a phone's camera roll of receipts at the end of the week. That's a fundamentally different task from "attach a photo while logging one expense," so it gets its own screen (`photo-assign`) rather than being bolted onto the single-expense photo picker (`src/js-ui/55-expense-photos-writes.js:14-24`).

## Architecture & How It Works

### The bulk row model (accordion over one shared editor)

The expense modal is backed by an array of draft rows, not a single form: `bulkRows[]`, with `bulkActive` indexing which row is currently expanded (`src/js-ui/50-sheets-expense-capture.js:140`). There is only **one** set of live DOM fields (`#ex-note`, `#ex-amt`, `#ex-cat`, `#ex-who`, `#ex-date`); `renderBulk()` physically relocates that single editor node into whichever card is active and renders the rest as collapsed summary cards (`src/js-ui/50-sheets-expense-capture.js:408-455`). Switching rows (`setActiveRow`, `:357-363`) always commits the row being left before loading the new one, so nothing typed is dropped by the swap.

`BULK_SAVING` is a save-loop flag: `submitBulk()` (`:662-693`) iterates every row and calls the same `addExpense()` used for a single expense (defined in `src/js-ui/60-transactions.js:209`, called as `window.addExpense()`), but with `BULK_SAVING=true` so each per-row call skips its own close/toast/navigation — those fire once, after the loop, from `submitBulk()` itself. This means the bulk UI is a thin orchestration layer over the same single-expense write path, not a parallel one; `addExpense()` itself doesn't know it's being called in a loop.

Comma handling is deliberately non-live: a comma typed mid-entry does nothing by itself (splitting immediately would drop an empty, half-parsed card on screen). The split only happens once the user starts a *new* entry after the comma, at blur (`onExNoteBlur`, `:501-513`) or on an explicit "+ Add item" / Save tap (`commitActiveRow`, `:318-343`), which is also where the comma-terminated segments get parsed via `parseEntries()`/`parseBulkLine()` (`:516-540`) into their own rows.

### Natural-language parsing: amount + category

`parseBulkLine(text)` (`:533-540`) turns one free-text segment into `{note, amt, cat}` using two independent detectors:

**Currency-aware amount detection — `matchAmount()`** (`:542-566`). Recognizes Vietnamese magnitude shorthand before falling back to a bare number: `tr`/`triệu` (×1,000,000, including compound forms like `1tr2` → 1,200,000), `tỷ`/`tỉ` (×1,000,000,000), `k`/`nghìn`/`ngàn` (×1,000). A bare trailing number is currency-sensitive: under VND, a value below 1000 is assumed to be shorthand for thousands (`"45"` → 45,000₫), matching how Vietnamese speakers actually say prices; non-VND currencies take the literal number.

**Two-axis category guessing — `guessCat()`** (`:655-658`), deliberately built as two orthogonal lookups rather than one keyword table (documented in the block comment at `:570-580`):
- **Language axis** — keyword lists are split by the note's language (`isVi()`), because the same word means different things across languages (the comment's example: `"gas"` means fuel/Transport in English but cooking gas/Housing in Vietnamese). `KW_VI` and `KW_EN` (`:587-606`) are the per-language keyword→**concept** maps; `KW_SHARED` (`:581-586`) holds brand/loan words (`grab`, `kfc`, `netflix`...) that are unambiguous in either language. `conceptFromNote()` (`:635-644`) tries shared + the UI's own language first, falling back to the other language only if nothing matched.
- **Concept → family-category axis** — matching a note never yields a literal category name directly; it first resolves to an abstract **concept** (`Housing`, `Groceries`, `Dining`, etc.), and `familyCatForConcept()` (`:645-653`) then searches the *specific family's* actual `catOrder`/`catStyle` for a category whose name (deburred substring match) or emoji matches that concept, via the `CONCEPT_MATCH` table (`:609-618`). If the family has no category that matches the concept, the result is `''` (unclassified) — the guesser **never invents or writes a category the family doesn't have**. This is what lets the same keyword tables work regardless of whether a family named their category "Ăn uống", "Food", or gave it a plate emoji with no text at all.

`CONCEPT_ORDER` (`:621`) is scanned specific-before-broad (e.g. `Clothing` before `Dining`) so `"quần áo"` doesn't fall through to matching `"an"` inside a broader keyword. A guessed category only overwrites a row's category when the user hasn't hand-picked one (`_catTouched`, checked in `commitActiveRow` at `:338-342`) — a manual chip tap always wins over the guess.

### Draft auto-persistence, including the encrypted variant

`persistDrafts()` (`:212-231`) fires on every edit (via `onExInput()` in `src/js-ui/55-expense-photos-writes.js:255`) and writes the full `bulkRows` array plus which row is active to `localStorage` under `FH_DRAFTS = 'fh-expense-drafts'` (`:206`). It intentionally does **not** persist for `editingTx` (editing an existing expense) or `exPreset` (a one-off preset log, e.g. from a category shortcut) — only the ad-hoc bulk-entry flow needs a safety net. Photos are excluded from the draft on purpose: it's a single-row edge case, and data URIs are large enough to blow the `localStorage` quota (`:202-205` comment).

For a family in the `enc` encryption state (`window.fhEncState()==='enc'`), the draft is encrypted before it ever touches disk: `persistDrafts()` whole-string-encrypts the JSON blob with `window.fhEncStr()` and stores `{v:2, enc:1, cur, ct}` instead of plaintext (`:220-227`). This is a different mechanism from the per-field `fhField`/`fhRead` machinery documented in `docs/features/encryption.md` — it's a single opaque ciphertext blob, encrypted/decrypted with the same session DEK via the shared `fhEncStr`/`fhDecStr` helpers (`src/js-data/15-crypto.js:217-218`). If the key isn't loaded (device locked), `persistDrafts()` simply skips writing — the family can't save the expense either, so there's nothing meaningful to draft anyway. A monotonic `_draftSeq` guard (`:211,222-224`) discards a stale async encrypt result if a newer draft was written while it was still in flight. `loadDrafts()` (`:233-244`) is the inverse: it decrypts off the synchronous path and only applies the restored draft via `applyDecryptedDraft()` (`:247-255`) if the sheet is still untouched, so a slow decrypt can never clobber something the user already started typing.

### EXIF-based photo-date extraction (must run before compression)

Every uploaded photo passes through `_compressImage()` (`src/js-data/40-txn-writes-outbox.js:4-35`) before it's stored: downscale to `maxPx=1600`, re-encode as JPEG on a `<canvas>`. That re-encode is not just a size optimization — the code comment at `src/js-data/40-txn-writes-outbox.js:24-27` states it runs unconditionally, even when the output is larger, specifically because **the original bytes carry EXIF, including GPS, and the storage bucket is public-by-URL**. Canvas re-encoding strips all metadata as a side effect, which is the deliberate privacy behavior — but it also destroys the one piece of EXIF the app actually wants to keep: `DateTimeOriginal`, the photo's real capture date, which is what makes the bulk photo-assign tool (below) able to narrow a photo to the day it was taken.

Because compression is one-way and irreversible, the capture date has to be read from the **original** `File` object before compression ever runs. `readPhoto(file, cb)` (`src/js-ui/50-sheets-expense-capture.js:787-806`) does this: it reads the first 256KB of the raw file as an `ArrayBuffer` (EXIF sits near the start of a JPEG) and runs a hand-rolled JPEG/EXIF parser, `_exifTakenOn()` (`:739-767`), that walks JPEG markers looking for the `APP1` segment (`0xFFE1`), locates `IFD0`, follows the Exif sub-IFD pointer (tag `0x8769`), and reads `DateTimeOriginal` (tag `0x9003`), falling back to the top-level `DateTime` tag (`0x0132`) if that's absent. `_exifTag()` (`:768-783`) is the shared TIFF-directory-entry reader used for both lookups. The date string (`"YYYY:MM:DD HH:MM:SS"`) is sliced directly rather than parsed into a `Date` and reformatted via `toISOString()` — the comment at `:734-736` notes that would push anything shot before 07:00 local (UTC+7) back a day in UTC and misattribute it to the wrong day. Only JPEG is handled (`v.getUint16(0)!==0xFFD8` short-circuits for HEIC/PNG, `:742`); no capture date for a non-JPEG source is a graceful `null`, not an error.

The extracted date is kept in `PHOTO_TAKEN`, a `Map` from the **pre-compression** data-URI string to `'YYYY-MM-DD'` (`:737`). Keying on the URI itself — rather than threading a new field through `exPhotos`/`evPhotos`/`memPickMulti` — means every existing array shape and every splice/reorder of those arrays keeps working untouched; `_uploadPhoto()` (`src/js-data/40-txn-writes-outbox.js:41`) receives that same pre-compression URI before it calls `_compressImage()` internally, so the lookup still resolves at upload time (design rationale at `src/js-ui/50-sheets-expense-capture.js:722-736`).

### Photo writes on an expense: cap, edit/delete reversal, upload progress

`exPhotos[]` holds up to 10 photos for the expense currently open in the modal (cap enforced in `onExPhoto`, `src/js-ui/55-expense-photos-writes.js:3-10`). Two write paths matter:

- **`saveExpenseEdit()`** (`:300-332`) reverses the transaction's *old* budget contribution before applying the new one — `jul.spent`, `jul.catSpent[cat]`, `jul.memberSpent[who]` are decremented for the old category/payer/amount (`:310-314`, only if the old row wasn't a future/unrealized expense) and then incremented for the new values (`:319-323`), so editing an expense's category, amount, or payer keeps the monthly budget totals correct rather than double-counting or leaking the old contribution.
- **`deleteExpense()`** (`:335-357`) does the same reversal on removal (`:344-348`) and, if the deleted expense had photos, clears them and calls `syncExpenseEvent()` to drop the mirrored event too (`:349`).

Both photo-bearing writes go through `_uploadPhoto()`, which is genuinely slow on cellular (compress + POST per image, tens of seconds for several photos). `fhUploadBusy()` (`:387-396`) drives a small progress indicator (`#fh-uploading`) that increments/decrements a counter as uploads start and finish. The comment at `:382-386` records why this exists: an earlier version toasted "saved" the instant the modal closed, before any upload had actually completed, so a failed upload looked identical to a success and the photo silently vanished on the next reload. The current code only claims success once bytes are confirmed stored.

### The bulk photo-assign tool — narrows, never auto-assigns

`photo-assign` is a separate modal for retroactively attaching a batch of receipt photos to already-logged expenses, driven by `paBatch[]` (`{src, taken, txId}` per photo), `paSel` (the current multi-select), and `paBusy` (`src/js-ui/55-expense-photos-writes.js:25-28`).

Flow:
1. **`paIngest()`** (`:31-49`) reads up to `PA_MAX = 20` photos through the same `readPhoto()` EXIF pipeline, capping and toasting if more were selected. The batch lives only in memory — nothing is uploaded until the user taps Done — so an abandoned batch costs no storage quota, at the cost of being fragile (it dies with the page reload). The 20-photo cap exists specifically to keep the held bytes small enough that iOS is unlikely to reclaim the tab (`:14-24` comment).
2. **`paGroups()`** (`:63-74`) buckets the batch by EXIF capture date (newest first, undated last), and **`paTxForDay(iso)`** (`:75-78`) lists that day's existing expenses (`txDateInput(t) === iso`).
3. **`paRender()`** (`:80-126`) shows each day's unassigned photos next to that day's expenses. This is a deliberate design boundary, not a missing feature: EXIF only gives a capture *date*, and a normal day commonly has several expenses — there's no reliable signal to pick which one a given receipt photo belongs to. So the tool **narrows** candidates to the right day and leaves the final match to an explicit tap (`paAssign(txId)`, `:129-134`, assigns every currently-selected photo to the tapped expense); it never auto-assigns based on date alone (rationale spelled out in the header comment at `:21-24`).
4. If a day has photos but no logged expense at all, `paNewExpense(iso)` (`:142-149`) opens the normal expense form pre-filled with that date and those photos — on the theory that an unmatched receipt often means the expense itself was never logged, not that the match failed. `paAdopt()` (`:151-158`) removes those photos from the batch once that new expense actually saves.
5. **`paDone()`** (`:159-182`) is async and uploads per-expense in batches, updating a `"Đang lưu N/M"` label on the save button as it goes (`:171`), then calls `renderTxns()`/`renderEvents()` — the comment at `:177-179` notes `renderEvents()` specifically matters because the Memories tab and calendar are rebuilt from the events tail, so skipping it would leave photos saved but invisible there.
6. Cancelling with photos still in the batch uses arm-then-confirm (`paCancel()`, `:199-215`) rather than a browser `confirm()`, since leaving discards a batch that exists nowhere else once the tab closes.

The actual per-photo write is `window.paApply(txId, srcs)` (`:185-190`): appends the src list to `t.photos` and calls `syncExpenseEvent(t)`.

### The `syncExpenseEvent` seam

Every write path that changes an expense's photos — `addExpense()` (`src/js-ui/60-transactions.js:250`), `saveExpenseEdit()` (`src/js-ui/55-expense-photos-writes.js:318`), `deleteExpense()` (`:349`), and `window.paApply()` (`:188`) — calls `syncExpenseEvent(t)` (defined in `src/js-ui/40-memories.js:107-123`), which mirrors the expense into a shadow `events[]` row (`linkedEvent`, keyed `xp-<id>`) so it surfaces in the Events and Memories tabs. Code comments in `40-memories.js` (`:126-133`) flag this mirror as somewhat fragile/semi-legacy: `buildMemRecords()` has since moved to reading expense photos directly off `txns[]` rather than relying solely on the mirrored event, specifically to avoid double-counting mirror events in the Memories feed. The full mirror/read-model story belongs to `docs/features/memories.md`, not here — this doc just flags the seam.

## Current State

Highly polished, no known gaps. The code carries the marks of heavy iteration rather than a single clean design pass — several comments exist purely to explain a past UX bug and its fix, not the current happy path:
- `fhUploadBusy()`'s progress indicator exists because an earlier version toasted success before an upload actually finished (`src/js-ui/55-expense-photos-writes.js:382-386`).
- `PHOTO_TAKEN` is keyed by data-URI string (not threaded as a new array field) specifically to avoid touching every existing splice/reorder call site (`src/js-ui/50-sheets-expense-capture.js:729-733`).
- `syncExpenseEvent()`'s in-place `events[key]` update (rather than replacing the object) exists because a wholesale replace once dropped `_dbId`/`_srcTxn` and caused the write-through layer to insert a duplicate DB row (`src/js-ui/40-memories.js:113-114`).
- `closeModals()` special-cases keeping the `photo-assign` modal open under another modal specifically so an expense logged mid-batch doesn't silently destroy the rest of the batch (`src/js-ui/50-sheets-expense-capture.js:18-24`).

No open TODOs or known-broken paths were found in either file.

## Related

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — overall app structure, hydrate/write-through model.
- [docs/features/memories.md](memories.md) — the full story of the `syncExpenseEvent` mirror bridge and how the Memories feed now reads expense photos directly.
- [docs/features/transactions.md](transactions.md) — the transaction-row data model and write-through layer (`addExpense`, budget totals) that this capture UI sits on top of.
- [docs/features/encryption.md](encryption.md) — the DEK/`fhEncStr`/`fhDecStr` machinery the encrypted draft variant reuses, and the separate per-field `fhField`/`fhRead` mechanism used for the actual saved expense (not the draft).
