# Spaces ("Nhóm"): build checklist

One build for everything in `spaces-spec.md` (S41). Tick a line when it is
built AND seen working in the harness. "Hien" lines are Hien's to do; no
agent session applies SQL, deploys a function or pushes `main`.

Worktree `../fh-spaces`, branch `feat/spaces`. Claim in `AGENT_SYNC.md`.

## 0. Before the client ships

- [x] Live definitions of the eight replaced functions compared with the repo
      bases (2026-11-22): all matched.
- [x] `0165_spaces` applied by Hien in the SQL editor, verified, committed.
- [ ] Live `push-send` (v24) diffed against `main`: identical `index.ts`.
      Deploy from the branch.
- [ ] Merge to `main`.

Order matters: the migration first (old clients keep working with it), the
function second (old clients keep working with it), the client last.

## 1. Foundation: the roster and the profile

- [x] `22-spaces.js`: roster reads `family_id`, `is_owner`, `profile`,
      `closed`, `members`, `is_active`; lists every container except the
      personal ledger (`S.all`), keeps `S.list` = the ones on the light path.
- [x] `fhSpaceProfile(fid)`, `fhSpaceHas(feature)` (active container),
      preset defaults for `{}` (Gia đình: all on except split; friend: split,
      moments, react).
- [x] Old-server tolerance: a `my_families` without `profile` reads as `{}`;
      a `switch_family` that refuses a space shows "cần cập nhật máy chủ"
      rather than a broken screen.
- [x] Harness stub answers the new and changed RPCs
      (`tools/boot-harness/stub-supabase.js`).

## 2. Opening and switching

- [x] `fhSpaceOpen(fid)`: `switch_family`, drop the cached fid, hydrate, apply
      the profile, land on the first tab. The space key is handed to the
      family crypto path from the `fh-keys` store.
- [x] Switcher sheet (`fhSpaceSwitcher`), opened from the header chip on the
      space tabs and from Settings ("Đổi nhóm").
- [ ] `afterLogin`: a person whose active container is a friend space boots
      into it; a person with spaces but nothing active is switched into the
      first one (families first), not shown the old picker.
- [ ] `showFamilyPicker` kept only for the no-active fallback, with Nhóm
      wording and type shown.
- [x] Creating a space switches into it after the card is set.

## 3. The Nhóm section on Tài chính

- [x] `persSpacesSection()` above Tài sản: every space, families included,
      member count, "đang mở", net owed or owing for spaces with Chia tiền.
- [x] "＋ Tạo nhóm", pending invites as cards ("Tham gia").
- [x] Space tiles and the "Tạo nhóm chia tiền" button leave Tài sản; the
      rings keep summing space nets.
- [x] A person with no family and no space sees the section's empty state
      with "Tạo nhóm" and "Tạo gia đình".

## 4. Create, profile, members, invite

- [x] Create sheet: name, preset chips, switches, note. Gia đình routes to the
      existing family flow.
- [x] Profile screen (from the space's settings): name, members, switches
      (owner only; read-only for members), invite, leave, close (owner).
- [x] Invite sheet: QR and link (`#fh-s=<id>&fh-k=<card>`), share, copy, the
      email whitelist with pending invites and cancel.
- [ ] Opening an invite link: sign in if needed, join, unlock with the card in
      the link, land in the space. The fragment is cleared from the URL.
- [ ] Remove a member (owner), leave (member), close and reopen (owner);
      a closed space shows a banner and offers no add, edit or settle.

## 5. Feature switches

One helper, `fhSpaceHas`, and one gate per surface (map from the sweep):

- [x] house: sky, scene, hearth, weather fx and fetch; settings button moves
      out of the sky; first tab relabelled.
- [x] budget: setup card, budget rows, trend budget line, category bars,
      month list wording, budget toasts, `sheet-budget`.
- [ ] moments: Khoảnh khắc tab, add-sheet rows, home blocks, Event chip,
      photo field, `renderGoals` still called.
- [x] react: chips, wall, home strip, long-press, arrivals.
- [ ] goals: goal card, add-sheet rows, home sections, `openGoal`, `fhSavings`.
- [x] ask: `_entCreatorId()` returns null; no proposal toasts or pushes.
- [x] source: the instrument string is not written to a space row when off,
      and not shown to others.
- [x] split: the expense sheet's Chia block and the money tab's balances.
- [x] Tab labels and the header chip follow the active space; `go()` redirects
      away from a hidden tab; deep links and push taps respect the gates.
- [ ] Family-only settings (add a seat, passcode, mailbox to family) hidden in
      a friend space.

## 6. Chung or Chia on the expense sheet

- [x] In a space with Chia tiền: "Ai trả?" (recorder pre-selected), "Tính thế
      nào?" (Chung or Chia, the profile's default), "Ai trong nhóm?",
      "Chia mấy phần?" (number chips, Số khác), "Tự nhập từng phần".
- [x] Shares math in one pure function with tests: equal with a remainder,
      subset, exact, outside shares, rounding to the đồng.
- [x] Save: the expense through the normal write path, then `txn_shares`, with
      the local retry queue.
- [x] No "Chung/Both" who-chip in a space that has no shared seat.

## 7. The space's money tab and home

- [x] Money tab with Chia tiền on: total, "Bạn đã trả", "Phần của bạn", the
      net line, "Ghi trả nợ", balances, pay-whom, then the usual rows.
- [x] Rows show payer and split ("chia 4 · bạn 310k"); a row with outside
      shares shows the bill total.
- [ ] Expense detail shows payer, split, each share; the recorder and the
      payer can edit amount, split and delete; balances recalculate.
- [x] Settle-up sheet from the tab; a settle row can be deleted by either
      side or its recorder.
- [x] Home with the house off: space name, net, the two actions, "Ai trả ai"
      for me, recent rows.

## 8. The personal book

- [ ] Space pass (`fhSpaceBookSync`): derived link ids; expense + loan rows per
      the table in spec section 12; settle-ups as repayments; rewrite on
      change; delete only inside the covered range.
- [ ] The saver's own rows written at save time with the account.
- [ ] Today's mirror skips rows that have a share row.
- [ ] `@space:` counterparty: excluded from people tiles; labelled with the
      space's name wherever a counterparty is shown; per-space net fallback
      when the space is not loaded.
- [ ] Outside loan row: shows as a person; can be renamed; repayment works
      through the existing sheet.
- [ ] A mirrored space row taps through to the space expense (switching if the
      space is not the open one, after a confirm).
- [x] Pure planner (`fhSpaceBookPlan`) with tests: payer, non-payer, outside,
      Chung, settle, edit, delete.

## 9. Capture

- [x] Review card: "Ghi vào đâu?" lists Cá nhân and every space; a space with
      Chia tiền swaps Loại khoản for "Ai trả" (locked) and "Tính thế nào".
- [x] The split sheet on the card (same component as the expense sheet).
- [x] Promote one row and bulk promote into any space: active space through
      the family path, another space through its own key.
- [ ] Quick review sheet: the same destination chips; default split.
- [x] Settle-up suggestion for money in from a member who owes that amount.
- [ ] Duplicate index reads loaded spaces; the card names the space.
- [x] The row's note line above the button; the toast after.

## 10. Notifications

- [ ] `fhNotify` sends `family_id`; space expense and settle-up notify.
- [ ] `push-send`: `family_id` honoured for members, audience by membership,
      two new kinds, copy without amounts.
- [ ] Push tap opens the space (switching if needed).

## 11. Proof

- [x] `npm run check && npm test` (the two known failures unchanged).
- [x] New tests: shares math, book planner, profile defaults, roster mapping.
- [x] `tools/ui-harness/manifests/spaces.js` with the target's shot names;
      every built frame compared with its target.
- [ ] `baseline.js` unchanged for a family (nothing moved for existing users).
- [x] `tools/boot-harness/harness.js timing` still green.
- [x] Docs: `docs/features/spaces.md`, `CHANGELOG.md`, `AGENT_SYNC.md`,
      release note, brief status.

## What the unticked lines mean

Unticked in sections 1 to 11 = **written, not seen working**. The code is on
the branch; the harness could not exercise it (it hangs personal-table reads,
has no second device, no push service and no Postgres), or only part of the
line is done:

- Book pass and everything in section 8: planner and diff are unit-tested
  (`tools/spaces-core.test.js`); the writes into `personal_transactions` have
  never run against a real table.
- Login landing, the invite link on a second device, removing a member, push
  across spaces, the tap on a notification: need the migration and two real
  accounts.
- moments / goals: gated on the tab bar, the add sheet and the money tab; the
  family HOME tab still shows those blocks when a family turns them off.
- Family-only settings: hidden by class in a friend space; the server
  functions behind them are not guarded (spec section 19).
- Expense detail: shows the split and edits it; not covered by a flow.
- Quick review, duplicate index: written, no flow.
- `baseline.js`: the sweep shows no new errors or lint for a family; the
  approved summary was not re-approved (that is Hien's call).

## Not in this build

Quỹ (a fund). Guests as members. A by-person view across spaces.
Multi-currency. Attaching a bank row to an expense someone else recorded.
Rules that name a space. VietQR on the settle sheet. A photo as the space's
mark. Founder metrics for spaces.
