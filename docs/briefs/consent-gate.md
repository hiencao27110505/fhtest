# Consent gate  (brief, 2026-11-08)
Status: merged

Written end first, per `docs/WORKFLOW.md`. The design is `docs/specs/consent-gate-spec.md` (CG1–CG12, grilled 2026-11-08); this brief is the journey and the acceptance for building it. Client only, no migration.

## End state

### Announcement
**Bật từng phần đọc email, ngay chỗ bạn cần**
Sao kê và hoá đơn từ email giờ có công tắc riêng. Khi phần nào chưa bật, mục Duyệt giao dịch và Cài đặt nói rõ và cho bật ngay tại chỗ, không phải tìm lại tờ đồng ý cũ.

**Switch on each email feature right where you need it**
Statements and receipts from email now have their own switch. When one is off, Review and Settings say so and let you turn it on right there, with no hunting for the old consent sheet.

### Outcome
A person whose recorded `bank_email` consent is below what a feature needs can never miss that it is off: the review queue and Settings say which feature is off on every open, one tap opens a sheet scoped to that feature, and agreeing turns it on. After agreeing, the lane captures their next statement (or receipt) with no further step.

The screen where they see it: the top of "Duyệt giao dịch" (`#csv-result`, staged mode) and its empty sheet, with the line *"Sao kê từ email đang tắt · Bật"*; after agreeing, the line is gone and the next queue open carries the statement card.

### Thresholds
Window: 14 days from release for the consent rate; 28 days for the decline rate. Rates only. The user pulls the numbers; Claude never queries the live database.

| Measure | Success | Kill |
|---|---|---|
| **Reach:** connected people below v5 on release day who reach the current version within 14 days | ≥ 70% | < 40% |
| **Nag:** of those, people who decline the scoped sheet ≥ 3 times in one week | ≤ 30% | > 30% |

Declines are not recorded (a decline writes nothing, by design), so the nag rate is measured from the one thing that is: a person still below v5 after 28 days who opened the queue in that time (`mailbox_grants.last_synced_at` moves on every tick; queue opens are not logged). The honest statement of what is measurable: reach is exact; nag is a proxy and is read as "people who kept declining".

```sql
-- Reach: connected on release day and below v5 then (run once on release day, keep the ids)
select g.user_id from mailbox_grants g
left join (select user_id, max(version) v from user_consents where kind='bank_email' group by user_id) c on c.user_id=g.user_id
where coalesce(c.v,0) < 5;
-- 14 days later: how many of those ids now have version >= current
select count(*) from user_consents where kind='bank_email' and version >= 7 and user_id = any(:ids);
```

## Journey

### 1. A statement is held because the consent is below v5
- **target:** the person opens "Duyệt giao dịch" and reads, above the cards or in the empty sheet, the row *"Sao kê từ email · Đang tắt ›"* under the eyebrow "ĐỌC TỪ EMAIL". Same block in Settings → Email ngân hàng.
- **delivers to the next stage:** the tap on "Bật".
- **today:** `fhConsentOffer` (`src/js-data/75-consent-ui.js:704`) shows the full sheet once per session on the way into the queue (`72-txn-review.js:277`); "Để sau" continues into the queue; nothing else says statements are off. The lane returns `no_consent` silently (`statement.mjs:186`).
- **gap:** no persistent signal; a once-per-session sheet that is dismissed forever.
- **plan:** `fhConsentStatusHTML()` draws one `.cst-lrow` per feature (`statements`, `receipts`; value "Đang tắt" or "Đang bật") in a `.cst-group` under an `.atx-seq-lbl` eyebrow; `renderCsvReview` draws it at the top of `#csv-result` in staged mode, the empty sheet draws it after its two doors and above "Đóng", `fhAutoTxnStatus` draws it above `#atx-pg`. The block joins `csvReviewSigCompute`.
- **feasibility:** `fhConsentCached()` already caches the record per uid (`75-consent-ui.js:565`); the harness's default fixture is a v4 person (`stub-supabase.js:78`), so the line renders in shots with no stub change. Checked: passes.

### 2. The person taps "Bật" (or any feature door)
- **target:** a consent sheet scoped to the feature: kicker "ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN · SAO KÊ TỪ EMAIL", title "Bật sao kê từ email", lead "Để đọc sao kê gửi kèm email, cần bạn đồng ý thêm một điều.", the change block holding the feature's own entry (its footer names how many other changes sit in the full text), the full text folded, "Tôi hiểu và đồng ý" / "Để sau". It fits one screen, buttons included.
- **delivers to the next stage:** the agree tap, or a decline that changes nothing.
- **today:** `fhConsentSheet` (`75-consent-ui.js:589`) has one kicker ("EMAIL NGÂN HÀNG") and no lead; `_cstChangedBlock` lists changes in version order.
- **gap:** no scoping; the feature's own entry is not first.
- **plan:** `FH_CONSENT_NEEDS` table (kicker, title, lead per feature); `fhConsentNeed(feature, go)`; `fhConsentSheet({feature})` passes the kicker as `_cstKicker`'s `extra`, sets the title and `.sheet-sub` lead, and asks `_cstChangedBlock` for the feature's entry only with a footer counting the rest.
- **feasibility:** `FH_CONSENT_CHANGES.bank_email` has entries 4–7; the test `consent-changes` already requires an entry per bump. Checked: passes.

### 3. Agree, or not now
- **target:** agree records the current version (one row), the sheet closes, the line is gone from every surface, the toast says "Đã bật sao kê từ email" (or "Đã bật hoá đơn từ cửa hàng"). "Để sau" closes the sheet and leaves the line; the next tap asks again.
- **delivers to the next stage:** the lane's next tick captures with no further step.
- **today:** `fhConsentAgree` inserts `(bank_email, FH_CONSENT_V)` and runs `_cstThen`; `fhConsentLater` runs the soft-offer continuation.
- **gap:** no per-feature toast; the once-per-session latch (`sessionStorage 'fh-cst-offered'`) would suppress the second ask.
- **plan:** `fhConsentAgree` toasts per feature and calls `fhConsentStatusRefresh`; the latch and `fhConsentOffer` are removed; `fhConsentLater` closes only.
- **feasibility:** `user_consents` has `unique (user_id, kind, version)`; the duplicate case is handled (`75-consent-ui.js:727`). Checked: passes.

### 4. The outcome: the next statement arrives
- **target:** the next queue open shows the statement card (or the statement rows), with no line above it.
- **delivers to the next stage:** —
- **today:** the lane already reads the recorded version on every tick (`statement.mjs:185`); nothing to build server-side.
- **gap:** none.
- **plan:** none; covered by the existing `pipeline/statement-lane.test.js` consent case.
- **feasibility:** server unchanged. Checked.

### 5. The other doors
- **target:** connect (forwarding, OAuth) blocks through the same gate; the store list in Settings paints the status row instead of the stores while `stores` (v7) is off; receipt scan routes its own sheet through the gate; nothing else is gated.
- **today:** `fhConsentEnsure` at `71-mailbox-ui.js:60,147` and `74-autotxn-ui.js:1180`; `78-receipt-stores.js:78` paints regardless of version; `78-receipt-scan.js:47` has its own `consentOk()`.
- **gap:** three separate behaviours; the store list shows stores a v6 person's mailbox does not read.
- **plan:** `fhConsentEnsure` becomes an alias of `fhConsentNeed('bank_email', …)` for one release; `fhReceiptStoresPaint` checks `stores`; receipt scan is left on its own per-use check (already no-latch), `fhConsentNeed('scan', …)` being a no-op that names the kind.
- **feasibility:** the scan sheet already re-verifies the table on every use (`receipt-scan.md`), so routing it through the gate changes no behaviour. Checked.

## Feasibility inputs needed
None. No sample data, no access: the harness fixture is already a v4 person.

## Screens
- **Review queue, staged** (`fhTxnReviewSheet()`): `.cst-line` rows at the top of `#csv-result`, one per unmet need; gone when none.
- **Review queue, empty sheet** (`fhTxnReviewSheet()` with no rows): the same lines above "Nhập file sao kê".
- **Consent sheet, scoped** (`fhConsentNeed('statements', fn)` / `fhConsentNeed('receipts', fn)`): kicker + lead + changes + folded full text + CTA + Để sau.
- **Settings → Email ngân hàng** (`fhAutoTxnStatus(conn)`): two `.atx-row`s "Sao kê từ email" and "Hoá đơn từ cửa hàng", value "Đang tắt" with action "Bật", or value "Đang bật".
- **Settings → store list** (`fhReceiptStoresPaint(conn)`): while `stores` is off, the status row and the "Bật" verb instead of the list.

## States
- **empty:** no unmet need → no line anywhere; the queue and Settings look exactly as today.
- **loading:** the record is read from the per-uid cache; a first read in flight draws nothing (never a false "off").
- **error:** an unreadable record is "ask": the line shows and the sheet asks; agreeing retries the insert with `_friendly(e)` on failure, the sheet stays open.
- **offline:** the line shows from the cache; agreeing needs the network and fails with the standard offline banner; nothing local changes.
- **locked:** not applicable (consent is per account, not per device key).

## Acceptance criteria
- [x] A v4 person opening the staged queue sees, under the eyebrow "ĐỌC TỪ EMAIL", two `.cst-lrow` rows ("Sao kê từ email · Đang tắt ›", "Hoá đơn từ cửa hàng · Đang tắt ›") above the cards; a v5 person sees "Sao kê từ email · Đang bật ›" and the receipts row off; a current person sees both rows on in Settings and no block in the queue. (stage 1)
- [x] The same block appears in the empty sheet after its two doors and in Settings → Email ngân hàng above the progress block; the store list shows "Chọn cửa hàng · Đang tắt ›" with its footer while below v7. (stage 1)
- [x] Tapping an off row opens the consent sheet with kicker "ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN · SAO KÊ TỪ EMAIL", title "Bật sao kê từ email", the lead, and only the v5 entry in the change block; tapping an on row opens the read-only sheet. (stage 2)
- [x] Tapping "Để sau" writes nothing; tapping the row again opens the sheet again in the same session (no latch). (stage 3)
- [x] Tapping "Tôi hiểu và đồng ý" sends one insert `{kind:'bank_email', version: FH_CONSENT_V}`, toasts "Đã bật sao kê từ email" through `toast()`, and flips the row to "Đang bật" (the queue block disappears when nothing is off) without a reload. (stage 3)
- [x] `fhConsentOffer` and `sessionStorage['fh-cst-offered']` no longer exist in `src/`. (stage 3)
- [x] The connect doors still block below the current version, through `fhConsentNeed('bank_email', …)`. (stage 5)
- [x] The store list paints the status row instead of the stores while the record is below v7. (stage 5)
- [x] `tools/consent-gate.test.js` pins `FH_CONSENT_NEEDS` to `STATEMENT_CONSENT_V`, `RECEIPT_CONSENT_V`, `RECEIPT_REGISTRY_V`. (stage 1)
- [x] The queue's render signature includes the status block, so agreeing repaints once and an unchanged state is skipped. (stage 3)
- [ ] Both languages: every new string has an `L()` twin; the i18n audit finds no Vietnamese in English mode. (all)
- [x] Outcome: with a stub grant and a v4 record, agreeing then reopening the queue shows no line (flow `consent-gate.flow.js`). (stage 4)

## Out of scope / Known gaps
- Per-feature opt-in (accept statements, refuse receipts): the single monotone version stays (CG10).
- The `learn` need (v8) for `pdf-statements-spec.md` §7: added when that bump lands; absent from the table now.
- Decline counting: not recorded by design; the nag threshold is a proxy (see Thresholds).
- The PDF capture gap itself is `pdf-statements-spec.md`; this feature only makes the consent cause visible and fixable.

## Assumptions
- **The status line is the privacy sheet's own row** (`.cst-lrow` inside `.cst-group`: glyph · title · muted "Đang tắt · Bật" · chevron, whole row tappable, 56 px), not a new `.cst-line` class. Decided at target time: the spec's text-plus-verb line lint-failed the 44 px rule as an `.atx-row-act` text button (31×24), and `.cst-lrow` already exists for exactly this job. `consent-gate-spec.md` §7 and §10 are amended to say so.
- The status rows sit at the very top of `#csv-result` in staged mode, above statement cards and the toolbox; in the file-import flow (`csvStagedMode` false) nothing is drawn.
- The reviewer agent definitions (`~/.claude/agents/*.md`) do not exist on this machine; the target review and the stage 4 reviews are run as general-purpose agents briefed with each reviewer's contract from `docs/WORKFLOW.md`. Known gap, recorded here.
- The Settings rows live in the connected-mailbox sheet (`fhAutoTxnStatus`), under the destination row and above `#atx-pg`; a person with no mailbox has no rows (no feature to switch on).
- The connect flow's inline consent block (`fhConsentInlineHTML`, `74-autotxn-ui.js:504`) is unchanged: it already shows the current text before Google's screen.
- A fifth question was not needed: every decision in this brief was settled in the grilling of 2026-11-08 (`consent-gate-spec.md` §9).

## Target manifest
`tools/ui-harness/manifests/consent-gate-target.js`, shots in journey order (the built manifest reuses these names):
- `01-queue-line`: staged queue, v4 person, the "ĐỌC TỪ EMAIL" block with both rows off above the cards.
- `01-queue-empty`: the empty sheet with the block after its two doors.
- `01-settings-rows`: Settings → Email ngân hàng, v4 person: both rows off, and the store list stood down to "Chọn cửa hàng · Đang tắt ›".
- `02-sheet-scoped`: the scoped sheet for `statements`, whole structure in one frame.
- `03-agreed`: the queue after agreeing: statements row gone from the queue block, receipts row still off, toast "Đã bật sao kê từ email".
- `05-stores-off`: Settings, v6 person: both rows "Đang bật ›", store list still "Chọn cửa hàng · Đang tắt ›". *(Built frame: the fixture has no v6 person; the built 05 agrees to the current text first, so both rows are on AND the store list shows its real toggles. The v6 state is covered by `consent-gate.test.js` "v5: the store list is below its need" and the §3.3 code path, not by a picture.)* The queue block carries no eyebrow (as the target); the empty sheet and Settings keep theirs.

Shot 2026-11-08: `shots/consent-gate-target/` (12 frames, vi + en, 0 failed; the injected rows pass the 44 px lint). Reviewed by a design-language pass and an Apple HIG + copy-tone pass (both as general-purpose agents, see Assumptions); every high/medium finding applied: value-only trailing text, legal kicker kept, `file`/`receipt` glyphs, Settings eyebrow, on-state pictured, scoped sheet re-titled and shortened, EN leads rewritten as sentences. Accepted as deliberate: the status group is the privacy sheet's shadowed card even inside the queue's flat bordered cards (one card for one block across three surfaces); and the queue mock's nav reads "Nhập từ file" (direct build path). Storyboard: `shots/consent-gate-target/storyboard.html`.
