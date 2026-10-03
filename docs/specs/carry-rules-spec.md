# Quy tắc cho khoản sau này — carry rules

> **Status (2026-10-03): BUILT, SW v614, client only, no migration.** Decided in one
> grilling session (Q1–Q28, §12); UI direction **A · Công tắc** chosen from
> `mockups/carry-rules-options.html`, its settings-style list included. What was
> built differs from the design in the places listed in §15. Background on what the
> app already remembers: `research/silent-lessons.html`.

> **How this relates to its siblings.** `apply-to-similar-spec.md` owns the carry:
> the sheet, "similar", the ticks, undo, the ledger half (§15–§17). A rule is the
> carry extended to rows that have not arrived yet, so it reuses that spec's key,
> fields and sheet and adds one control to it. `transaction-review-spec.md` owns
> the queue a rule pre-fills. `lending-capture-spec.md` and `category-tree-spec.md`
> own the silent lessons this spec ranks rules above (and improves, §9).
> "Theo nguồn" (per-bank Phạm vi, `56` `csvTxrRoutes`) is folded into rules (§8).

---

## 1. Summary

When a person corrects a transaction and carries the change to similar rows, they
can also switch on **"Cả các khoản sau này"**. That saves a **rule**: a visible,
named instruction such as *"Chi 500k–5tr cho TRAN MINH KHOA: Nhà ở, Tiền nhà"*.
From then on every matching new transaction arrives in the queue already set that
way. The person still imports it, one tap per row or one tap for all of them
("12 khoản theo quy tắc · Nhập 12 khoản"). Rules live in one list, can be edited
and deleted, sync across the person's devices, and are encrypted like everything
else: the server never reads them.

## 2. Why

The carry fixes the past. The same correction then has to be repeated every time
the payee appears again, because what the app learns silently today:

- loses to the machine (the email pipeline's guess beats a lesson);
- is split by amount band, so a new amount gets nothing;
- covers only Danh mục, Tiêu vào gì and loans (never Phạm vi per payee, income
  category, Người, or transfer kinds);
- cannot be seen, so a wrong one cannot be found.

Until `aa34bd8` (2026-10-03) the Tiêu vào gì lessons did not even survive a reload.

## 3. What a rule is

| Part | Value |
|---|---|
| **Match** | The carry's "similar" key: the payee key (`csvPatternKey`, ≥ 6 letters), else the wording from the same bank (`'w:'+csvSimKey+'|'+provider`). Same **direction** only: out or in (R6). |
| **Amount** | Any amount for a merchant. For a person-to-person transfer (the p2p shape tier, `p2p-breakdown-spec.md`), only the amount band of the row the rule was made on: < 50k, < 500k, < 5tr, ≥ 5tr (R5). |
| **Sets** | Whatever the carry carried and was switched on: Phạm vi, Loại khoản (with its follow-up, e.g. the borrower's name), Danh mục, Danh mục thu, Tiêu vào gì, Người (R3). A rule may set one field or all of them. |
| **Name** | The payee's display name (account digits stripped, as the sheet's subtitle does), plus the band when there is one: "TRAN MINH KHOA · 500k–5tr". |
| **Owner** | One person. Not shared with the family, even when it sends rows to the family ledger (R12). |

A **bank rule** is the old "Theo nguồn": match = the canonical bank name, sets
Phạm vi only. It lives in the same list (§8).

## 4. What a rule does

1. **Pre-fills, never imports.** A matching new row arrives in the queue with the
   rule's values. Nothing reaches the ledger without the person's tap (R1).
2. **Where:** the full queue, quick review, and statement rows (which are queue
   rows). Rows already waiting when the rule is made are pre-filled at once
   (R15, R28).
3. **Not:** booked ledger rows (that is the carry), manual entries (no payee).
4. **Wins over** everything the machine does: the email pipeline's node and
   category hint, history, silent lessons, keywords (R7).
5. **Loses to** the person's own pick on that card. A field set by hand
   (`c._hand[f]`) is never overwritten by a rule.
6. **Two rules match:** per field, the more specific rule wins: payee over
   wording+bank over bank; banded over unbanded; then the newer one (R17, R18).
   Two rules can each contribute different fields to one row.

**Known limit, unchanged by this spec:** the queue rebuilds from the waiting rows
every time it opens (`72-txn-review.js`, `csvBuildReview` on open), and picks made
in it are not saved until import. A hand pick therefore wins only while the queue
is open; on the next open the rule fills that field again, as the machine's guess
does today.

## 5. Making, changing and removing a rule

### 5.1 Making one

- **In the carry sheet**, in the queue and in the ledger (before and after Lưu),
  one more section, "Khoản sau này", with one switch row: **"Cả các khoản sau
  này"**, and a second line saying exactly what it matches and sets (R11).
- **Off by default, always.** The app never suggests a rule, never turns the
  switch on for you, never nudges after a repeat (R22).
- **Only where it can be kept and used:** the bank-email queue (not the file
  import, which rules never fill) and the ledger, and only while the personal
  ledger is unlocked, since the rule is written to its encrypted record.
- **No similar rows yet** (a payee seen for the first time): the card's bottom
  button still appears once a carried field has changed and the row has a key, as
  **"Áp dụng cho khoản sau này"**, opening the sheet with only the change and the
  switch (R5).
- **When it is saved** (R21):
  - queue: when the sheet's button is pressed, together with the carry;
  - ledger, before Lưu: staged with the edit; Lưu saves it, Huỷ drops it (L13);
  - ledger, after Lưu: when the sheet's button is pressed.
- **One act, one undo** (R19): "Hoàn tác" on that carry also deletes the rule it
  created, or restores the version of the rule it changed.

### 5.2 On a card a rule filled

- Each field the rule set shows **"Theo quy tắc"** under its value; tapping that
  line opens the rule (R8).
- Changing one of those fields applies to that row only. The carry sheet that the
  change opens finds the rule for the same payee, direction and size, and its switch
  reads **"Đổi quy tắc"** instead of "Cả các khoản sau này", off (R12), with the
  rule's new values spelled out on its second line. Switched on, those fields of
  that rule are replaced; nothing else in it changes.

### 5.3 The list

- **One list, "Quy tắc"**, reachable from Cài đặt (a row under Duyệt giao dịch)
  and from the queue's Chỉnh sửa (a row under Theo nguồn) (R9). Sections "Theo
  người nhận" (name, then "Chi 500k–5tr · Nhà ở, Tiền nhà") and "Theo ngân hàng"
  (each bank with a Cá nhân / Gia đình control, footnote "Mọi khoản từ ngân hàng
  này vào sổ đã chọn, trừ khi quy tắc theo người nhận nói khác.").
- Empty: "Chưa có quy tắc nào" and how to make one.
- The last line: **"App tự nhớ thêm N gợi ý từ những lần bạn sửa. Quên hết"**,
  the silent lessons' only visible handle (§9). Quên hết is tap-twice ("Chạm lần
  nữa để quên hết") and clears Tiêu vào gì, loan and category lessons.

### 5.4 One rule's screen

- The card's own rows, each opening the app's chips inline (Tiêu vào gì opens the
  tree picker). A field the rule does not set reads **"Không đổi"**; picking a value
  adds it, picking "Không đổi" removes it. Loại khoản shows only when the rule sets
  one, and can be removed but not changed here. Ai trả shows only when the rule
  sends rows to Gia đình. "Khớp khi" shows direction and band; a person's rule can
  widen to "Mọi số tiền" and back (R14).
- Lưu with nothing set is a delete.
- **Xoá quy tắc** is low-prominence at the foot.

### 5.5 Deleting or editing when rows are waiting (R24, R27)

The question only exists when the rule has filled rows that are still waiting.

| Case | What happens |
|---|---|
| Nothing waiting | Delete: the usual tap-twice ("Chạm lần nữa để xoá"). Edit: Lưu saves. |
| Delete, N waiting | Action sheet: "Xoá quy tắc này?" / "N khoản đang chờ đã theo quy tắc này." / **Xoá và xếp lại N khoản** · **Xoá, giữ N khoản như cũ** · Huỷ. Both actions red, neither preselected. |
| Edit, N waiting | Action sheet: "Lưu thay đổi?" / same message / **Đổi cả N khoản** · **Chỉ từ khoản sau** · Huỷ. |

- "xếp lại" / "Đổi cả": nothing to store; the next build simply uses what is left
  (or the new values).
- "giữ như cũ" / "Chỉ từ khoản sau": because the queue rebuilds on every open,
  the old values are **pinned to those waiting rows**: `pin[stagedId] = { set, t }`
  in the same store. A pin ranks exactly where the rule did, for that row only,
  and is dropped when the row is imported or retired (swept at build: a pin whose
  staged id is not waiting any more is deleted).
- **N** counts the waiting rows the rule filled in the queue as last built this
  session. Opened from Cài đặt before the queue was opened, N is 0: nothing filled
  by the rule has been on screen, and the next open simply follows the rules as
  they are.

## 6. The queue (R20)

- One row on top of the queue when at least one waiting row has a field from a
  rule: **"12 khoản theo quy tắc"** · **"Nhập 12 khoản"**. The button imports
  exactly those rows through the normal import path; the nav's "Nhập 24" still
  imports everything ready. Gone at zero.
- Counted: waiting rows with at least one field filled by a rule or a pin that
  the person has not since changed by hand.
- Quick review: the same "Theo quy tắc" line on its card; no summary (one row at
  a time).
- The verb is "Nhập", the queue's own (`csv-save` reads "Nhập N"); the screen is
  titled "Duyệt giao dịch".

## 7. Storage and privacy (R10)

- Rules are a new section, `rule`, of the encrypted `personal_lessons` blob
  (`24-lessons.js`), next to `kind`, `cat`, `node` and `tomb`; pins are `pin`;
  bank routes are `route`.
  Encrypted on the device under the personal key; the server stores ciphertext.
  It sees that the blob changed and roughly how big it is, nothing else.
- Deletion writes a tombstone `tomb['rule|'+id]`, merged newest-wins like the
  other namespaces, so a deleted rule does not come back from an older device.
- Applied on the device when the queue (or quick review) is built. The server
  cannot pre-fill before the device opens the queue; it cannot today either.
- Rules **never** write to `merchant_corrections` (R16, §9).
- The promise "Mã hóa đầu cuối, chỉ bạn và người thân bạn chọn đọc được. Tụi
  mình cũng không xem được." holds: no rule content leaves the device unencrypted.

```
rule  = { id, k:'p:<payee>'|'w:<wording>|<bank>', dir:'out'|'in', band:null|'a'|'b'|'c'|'d',
          set:{ scope?, kind?, cat?, inccat?, node?, who? }, name, t }
          // kind = { cur, isTransfer, xfer, repay, loan, invest, payCardId, xferOtherId, repayWho, loanWho, investPosId }
pin   = { [stagedId]: { set, t } }
route = { [bank]: { v:'personal'|'family', t } }
```

## 8. "Theo nguồn": in the list, and synced

- The queue keeps its own map (`56` `csvTxrRoutes`, localStorage); every change is
  now also written to the record's `route` section, and on first load the record's
  routes are adopted (they are the newer truth: every local change is pushed the
  moment it is made) while banks only this device knew are sent up. Bank routes
  therefore start syncing across devices, which they never did.
- A payee rule's Phạm vi beats a bank rule (R18), the case "Theo nguồn" could not
  express: "VIB goes to Cá nhân, but transfers to mẹ go to Gia đình".
- The Chỉnh sửa fold keeps its per-bank control and its line "Đặt một lần, các
  lần sau tự vào đúng sổ."

## 9. The silent lessons, alongside (R13, R25)

Kept as the tier under rules. Inside this epic, three small changes
(`research/silent-lessons.html`, Phần 1 B):

1. ~~A lesson beats a guess the machine made from its shared memory or the model,
   but not what the email itself states.~~ **Not built:** the pipeline does not
   record where a category or node came from (`classify.mjs` `_apply` keeps the
   value only), so the device cannot tell the two apart. Needs a `mailbox-sync`
   change first. Rules (R7) already beat every machine tier.
2. Tiêu vào gì gets an amount-free lesson for merchants (key `m|<payee>`), as Danh
   mục already has; person-to-person rows stay banded (`fhLooksPersonToPerson`).
   The banded lesson is read first. Forgetting a banded lesson forgets its
   amount-free twin only when they say the same thing.
3. Carried rows teach the amount-free lesson too: `fhLessonLearnNode` writes both
   keys for a merchant, whoever calls it.

The tree backfill reads lessons, so its cursor moved to **v13**, and the sweep now
waits for the lessons record to load before its first slice (it used to run
before them and mark itself done).

Then, as a follow-up once (1) has run for a while: stop sending
`merchant_corrections` and delete its rows (10 rows, 3 people, 0 with a node as of
2026-10-03). Not part of this build.

## 10. Copy

| Where | Copy |
|---|---|
| Sheet section | Khoản sau này |
| Switch, no rule yet | Cả các khoản sau này |
| Switch, the rule exists | Đổi quy tắc |
| Switch, second line | Chi 500k–5tr cho TRAN MINH KHOA: Nhà ở, Tiền nhà (money in: "Thu … từ …") |
| After saving, in the sheet | Đã tạo quy tắc · Hoàn tác / Đã đổi quy tắc · Hoàn tác |
| Bottom button, no similar rows | Áp dụng cho khoản sau này |
| Bottom button, rule saved alone | Đã tạo quy tắc / Đã đổi quy tắc |
| Sheet button, rule only | Lưu quy tắc |
| Card, under a value | Theo quy tắc |
| Quick review, after a value | · theo quy tắc (where it said "· gợi ý") |
| Queue summary | 12 khoản theo quy tắc · Nhập 12 khoản |
| Cài đặt row, Chỉnh sửa row | Quy tắc (Chỉnh sửa shows the count, or "Chưa có") |
| List sections | Theo người nhận · Theo ngân hàng |
| List row, second line | Chi 500k–5tr · Nhà ở, Tiền nhà |
| Bank footnote | Mọi khoản từ ngân hàng này vào sổ đã chọn, trừ khi quy tắc theo người nhận nói khác. |
| Empty list | Chưa có quy tắc nào · Khi áp dụng một thay đổi cho khoản giống, bật "Cả các khoản sau này" để các khoản sau tự điền như vậy. |
| Silent lessons line | App tự nhớ thêm 48 gợi ý từ những lần bạn sửa. Quên hết → Chạm lần nữa để quên hết |
| Rule screen, header | TRAN MINH KHOA · Khoản chi 500k–5tr |
| Rule screen, field not set | Không đổi |
| Rule screen, match row | Khớp khi · Chi 500k–5tr (a merchant: Chi · mọi số tiền); chips 500k–5tr / Mọi số tiền |
| Delete | Xoá quy tắc → Chạm lần nữa để xoá |
| Delete sheet | Xoá quy tắc này? · N khoản đang chờ đã theo quy tắc này. · Xoá và xếp lại N khoản · Xoá, giữ N khoản như cũ · Huỷ |
| Edit sheet | Lưu thay đổi? · N khoản đang chờ đã theo quy tắc này. · Đổi cả N khoản · Chỉ từ khoản sau · Huỷ |
| Toasts | Đã tạo quy tắc · Đã đổi quy tắc · Đã lưu quy tắc · Đã xoá quy tắc · Đã quên N gợi ý · "Đã áp dụng cho 3 khoản · Đã tạo quy tắc" · "Đã lưu · Đã tạo quy tắc" · Quy tắc này không còn |

No softeners, no em-dashes, no exclamation marks. Every queue string carries its
`L('vi','en')` English; the ledger detail (61) stays Vietnamese-only, as it was.

## 11. Mechanics

- **Store** (`24-lessons.js`): `fhRulesReady()`, `fhRulesAll()`, `fhRuleGet(id)`,
  `fhRuleSave(rule)`, `fhRuleDelete(id)`; `fhRulePins()`, `fhRulePinSet(ids, set)`,
  `fhRulePinDrop(ids)`; `fhRoutesSynced()`, `fhRoutesChanged(map)`;
  `fhLessonsCount()`, `fhLessonsForgetAll()`. `_pull` / `_mergeIn` carry `rule`,
  `pin` and `route` (newest `t` wins per id; tombstones `rule|id`, `pin|id`).
  Loaded before any save (`_ensureLoaded`, `aa34bd8`).
- **Rules** (`src/js-ui/66-rules.js`, new): `fhRuleMatch(input, rules)` (pure);
  `csvRuleApplyOne` / `csvRuleUnwrite` / `csvRulesApplyQueue` (the queue pass;
  `c._rule[f]` = rule id or `'_pin'`, `c._ruleSnap[f]` = what the machine said);
  `csvRuleDraft` / `fhRuleDraftLedger` / `fhRuleCommit` / `fhRuleRevert` (making
  one, and undo); `fhRuleBlock` (the sheet's block); `csvRulesSumHTML` /
  `csvRulesImport` (the summary); `fhRuleForQuick` (quick review); the modal
  (`fhRulesOpen`, `fhRuleOpen`, the list, the rule screen, the action sheet).
- **Queue** (`72-txn-review.js`): `csvRulesApplyQueue(readable)` right after the
  staged-id stamp, before the first paint. Values are written exactly as the carry
  writes them (`csvFixKindCopy` for a kind) with `catSource` / `_nodeSource`
  `'rule'`; a rule's node counts as a person's at import (`csvPromoteNode`,
  `_nodeTouched`), so the composer's guess cannot replace it.
- **Carry sheets**: `fhCarryBodyHTML` draws `m.rule` (`{title,label,sub,on,tap}` or
  `{title,done,link}`) as the last section. Queue (56): `fx.ruleOn`, `fx.rule`,
  `csvFixRuleBlock` / `csvFixRuleToggle` / `csvFixRuleSave` / `csvFixRuleUndo` /
  `csvFixRuleDoor`; `csvFixSheetGo` saves after the rows, `csvFixUnapply` reverts.
  Ledger (61): `_pexdPre.rule` (staged; `pexdSave` commits after the write lands),
  `_pexdCarry.ruleOn` / `.ruleU`, `pexdCarryRuleToggle` / `pexdCarryRuleUndo`.
- **Card mark**: the srow renderer adds `csvRuleLineHTML(c, f)`.
- **Modal**: `#rule-modal` (`src/index.html`, z 66, above the queue and the move
  sheet), styles in `src/css/75-rules.css`. It binds its own drag-to-dismiss
  (`initSheetDrag` now keeps the FIRST binding of an element), so dragging it away
  never closes the queue underneath.

## 12. Decisions — the R series

| # | Decision | Q |
|---|---|---|
| R1 | Pre-fill only; never auto-import. Auto-import is a separate, later decision | Q1 |
| R2 | A rule is explicit, visible, named, editable and deletable; not a stronger silent lesson | Q2 |
| R3 | A rule repeats every field the carry covers | Q3 |
| R4 | The lesson-persistence bug is fixed on its own first (`aa34bd8`) | Q4 |
| R5 | Made in the carry sheet with a switch, off by default; the bottom button also appears with no similar rows | Q5 |
| R6 | Same key as "similar"; merchants at any amount, person-to-person transfers banded to the edited row's band, shown in the name | Q6 |
| R7 | Hand pick > rule > every machine tier | Q7 |
| R8 | "Theo quy tắc" under each value a rule set; tap opens the rule | Q8 |
| R9 | One list, from Cài đặt and the queue's Chỉnh sửa, "Theo nguồn" folded in | Q9 |
| R10 | Stored in the encrypted lessons blob, applied on the device, per person, synced | Q10 |
| R11 | The switch's second line spells out what the rule matches and sets | Q11 |
| R12 | Changing a rule-set field is one-off; the carry sheet offers "Đổi quy tắc", off | Q12 |
| R13 | Silent lessons stay as the lower tier | Q13 |
| R14 | Rules are edited with the card's pickers, and deleted | Q14 |
| R15 | A new rule pre-fills rows already waiting; never booked rows or manual entries | Q15 |
| R16 | Rules never write to `merchant_corrections`; its fate is decided separately | Q16 |
| R17 | More specific rule wins, then newer, per field | Q17 |
| R18 | A payee rule beats a bank rule | Q18 |
| R19 | Undo of the carry also undoes the rule it created or changed | Q19 |
| R20 | Queue summary row with one import button; concise copy | Q20 |
| R21 | Ledger: staged with the edit; queue: saved with the carry | Q21 |
| R22 | The app never suggests a rule | Q22 |
| R23 | A rule only matches its own direction of money | Q23 |
| R24 | Deleting or editing with waiting rows: the person chooses re-fill or keep | Q24 |
| R25 | Lesson improvements in this epic (2 and 3 built; 1 needs the pipeline, §9); stopping `merchant_corrections` right after | Q25 |
| R26 | This spec is its own file | Q26 |
| R27 | The choice is an Apple action sheet, shown only when rows are waiting | Q27 |
| R28 | Rules apply in the full queue, quick review and statement rows | Q28 |

## 13. Tests

`tools/carry-rules.test.js` (39 checks, real functions): the match (band, newest,
direction, per field), the queue pass (beats the machine, never a hand pick, the
carry's limits, the mark, the summary count, undo restores the machine's values),
pins (keep vs refill, survive a rebuild, dropped once the row leaves), the store
(tombstones beat an older device, routes come back), making and changing a rule
from the carry (band, sentence, "Đổi quy tắc", undo), the ledger and quick review
on the same key, the amount-free merchant lesson, and the wiring in 56/61/72/76.
`tools/lessons-sync.test.js` keeps guarding the record's load-before-save.

## 14. Open

- **Lesson provenance** (§9.1): a `mailbox-sync` change to tag where a category or
  node came from, so a lesson can beat a model guess but not the mail's own words.
- **`merchant_corrections`**: stop sending and delete its rows once §9.2 has run
  for a while (R25).
- **Auto-import** (R1): not in this epic.

## 15. Built vs designed (2026-10-03)

- **No "đã xếp n khoản".** Counting it needs a hook in the import path for every
  row; the rule screen's header says what it matches instead.
- **N on delete or edit** counts the queue as built this session (§5.5), not a
  fresh read of the waiting rows.
- **Rows unticked in the sheet** keep what they show while the queue is open; the
  next time it opens, the rule fills them like any other waiting row (unless set
  by hand).
- **A rule's Loại khoản** can be removed on its screen but not changed there; it
  is made on a card.
- **Lesson improvement 1** is not built (§9).
- **Theo nguồn** keeps its own map in the queue and syncs through the record (§8)
  instead of being converted into rule objects.
