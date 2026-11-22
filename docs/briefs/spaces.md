# Spaces (Nhóm), release 1  (brief, 2026-11-21)
Status: shipped-preview

Spec: `docs/specs/spaces-spec.md` (decisions S1 to S31). This brief covers
release 1 only: the foundation. Release 2 (the personal book and capture) and
release 3 (notifications, lifecycle) get their own briefs.

**This brief needs schema changes** (section "Feasibility inputs needed").
Migrations are outside the feature workflow: the build stops after the target
is approved until Hien has reviewed and applied them.

## End state

### Announcement

**vi.** Gia đình hay nhóm bạn, giờ đều là một "Nhóm" trong Earthy: chọn những
gì nhóm cần, mời bạn bằng một đường link, rồi ghi khoản chung hoặc chia đều
cho từng người. Mọi nhóm của bạn nằm chung một chỗ trong Tài chính, kèm số
bạn đang nợ hay được nợ.

**en.** Family or friends, every group is now a Space in Earthy: pick what the
group needs, invite people with a link, then log shared expenses or split them
between members. All your spaces sit in one place on the Finance tab, with
what you owe or are owed.

### Outcome

The four founders are members of one space. Each of them can open it from the
Nhóm section of Tài chính, see the month's shared expenses with who paid and
how each was split, and see one list of who pays whom. When the list is
empty, the space's money tab says "Đã cân bằng" and the Nhóm row on Tài chính
shows no amount. Their family spaces look and behave as they did before.

Screen: the space's money tab (shot `12-outcome`) and the Nhóm section (shot
`02-nhom-section`).

### Thresholds

Window: the first 30 days after release 1 reaches `main`. The population is
one group of four, so these are counts with the rate beside them. Hien pulls
them with plaintext queries (row counts, `created_by`, `txn_date`,
`settle_date`; nothing here needs a key).

| Measure | Success | Kill |
|---|---|---|
| Members who recorded at least one expense in the space | 4 of 4 (100%) | fewer than 2 of 4 (under 50%) |
| Shared bills of the month recorded in the space, by the group's own count at month end | at least 80% | under 50% |
| Members at zero balance within 7 days of the month's end, settled through the app | 4 of 4 | fewer than 2 of 4 |
| Existing families that report any change in behaviour they did not choose | 0 | 1 or more (fix before anything else) |
| A space expense whose split and balance disagree (found by hand check of 20 rows) | 0 of 20 | 1 or more |

## Journey

Derived backwards from the outcome.

### 8. Outcome: the group is square
- **Target.** The money tab leads with "Đã cân bằng", lists the month's
  expenses and settle-ups, and the Nhóm row on Tài chính shows no amount.
- **Today.** `openDebtSpace` shows "0đ · đã cân bằng" on a tile inside Tài sản
  (`src/js-data/23-debts-ui.js:162`); there is no month view.
- **Gap.** The balance lives on the wrong shelf and has no month.
- **Plan.** The balance block moves onto the space's money tab; the tile
  becomes a row in the Nhóm section.
- **Feasibility.** `fhSpaceBalances` and `fhSpacePairwise` already derive
  both (`22-spaces.js:196-243`). Checked by reading; not run against a real
  space because none opens today (stage 2).

### 7. Settle up
- **Target.** One sheet: who pays, who receives, the proposed amount filled
  in. Either side records it.
- **Delivers.** A zero balance.
- **Today.** `fhSpaceSettleSheet` (`23-debts-ui.js:1480`) does this.
- **Gap.** None in release 1. VietQR and bank-mail matching are later.
- **Feasibility.** Exists; the target shot calls the real sheet.

### 6. See what is owed
- **Target.** The space's money tab: this month's total, each member's net,
  the simplified pay-whom list, then the expenses with payer and split.
- **Today.** The same blocks exist in the `openDebtSpace` overlay
  (`23-debts-ui.js:645`), reachable only from a tile.
- **Gap.** A space cannot be the active one, so it has no tabs.
- **Plan.** `switch_family` accepts any member space; the money tab reads the
  profile and renders the balance block when Chia tiền is on, the budget card
  when Ngân sách chung is on.
- **Feasibility.** Needs the `switch_family` migration. `get_family_snapshot`
  does not return `txn_shares` or `settle_ups`; release 1 fetches them beside
  the hydrate, as `fhSpaceHydrate` does, so THE hydrate is not touched.

### 5. Record a shared expense
- **Target.** The expense sheet's "Ghi vào đâu?" lists Cá nhân and the open
  space. In a space with Chia tiền on, three more rows: Ai trả (the person
  recording, pre-selected), Tính thế nào (Chung or Chia, from the profile's
  default), Chia cho ai (members as chips, all on, with the per-person amount
  under them; "Tự nhập" for exact amounts).
- **Today.** The sheet offers Cá nhân and Gia đình
  (`src/index.html:633`); a split is a separate sheet that always covers
  every member (`23-debts-ui.js:1426`).
- **Gap.** No Chia on the expense sheet, no member subset, two inserts with
  no rollback (`22-spaces.js:170`).
- **Plan.** Fold the split fields into the expense sheet; `space_add_expense`
  RPC writes the row and its shares together.
- **Feasibility.** `txn_shares` RLS already admits the active family
  (0107:47-57). The RPC is a new migration. A subset needs no schema change:
  `shares_enc` simply lists fewer ids.

### 4. Enter the space
- **Target.** Tapping a row in the Nhóm section switches into the space. Its
  first tab shows members, the group's balance and recent activity when the
  house is off; the house when it is on. The header carries the space's name
  as a chip that opens a switcher sheet.
- **Today.** Only a family can be active (`0078:174`). The picker is a
  full-screen overlay titled "Gia đình của bạn" (`10-client-auth.js:166`).
- **Gap.** The switch is refused for friend spaces; the tabs have no notion
  of a profile.
- **Plan.** The migration above; each tab checks its switches; the picker is
  replaced by the section and the sheet.
- **Feasibility.** Open: how long a switch takes. It is a server write plus a
  full hydrate. To be measured with `tools/boot-harness` once a second space
  can be active; if it is over two seconds, the space keeps a warm snapshot
  per space as the family does today.

### 3. Join
- **Target.** The invitee taps a link, signs in, and is in. The Nhóm section
  shows the new space; nothing is typed.
- **Today.** The owner types the friend's Google email, sends the card over
  Zalo, and the friend types 16 characters (`23-debts-ui.js:1410`,
  `22-spaces.js:93`). Families already have a card link and QR
  (`67-card-ui.js:143-166`, `#fh-k=`).
- **Gap.** No link or QR for a space; the email step.
- **Plan.** The family card link and QR, carrying the space id. The email
  whitelist stays as the membership gate in release 1.
- **Feasibility.** Open: whether `redeem_invite` (0106b) can admit a member
  from the link alone, removing the email step. Read the RPC before the
  build; if it cannot, the email step stays and the target shot 04 already
  shows it.

### 2. Create a space
- **Target.** "＋ Tạo nhóm" opens one form: name, preset (Gia đình, Bạn bè,
  Khác), and the switches the preset filled in, each changeable. Then the Key
  Card, then the invite.
- **Today.** `fhSpaceCreateSheet` asks for a name only and hard-codes
  `'friend'` (`23-debts-ui.js:1389`). The button exists only in an empty
  state (`:54-55`).
- **Gap.** No profile. The button vanishes once the person has an account.
- **Plan.** `families.profile`; `create_space` takes a preset and profile.
- **Feasibility.** Needs the migration. Plaintext profile agreed (spec
  section 11): it holds switches, not content.

### 1. First awareness
- **Target.** A release note, and a Nhóm section on Tài chính that already
  lists the person's family with "đang mở" beside it, so the concept is
  visible before anything is created.
- **Today.** The family appears as a pass card under "Tiền đi đâu tháng này"
  with the caption "Nhóm của bạn" (`21-personal.js:888`); spaces are tiles in
  Tài sản.
- **Gap.** No single place that says "these are your groups".
- **Plan.** `persSpacesSection` above Tài sản.
- **Feasibility.** `my_families` already returns every membership with its
  type. The roster bug (`22-spaces.js:63-64` reads `f.id`, the RPC returns
  `family_id`) must be fixed first; confirmed in the repo, to be confirmed
  against the live function by Hien.

## Feasibility inputs needed

- **From Hien, before the build:** review and apply the release 1 migrations
  (spec section 11): `families.profile`; `switch_family`, `leave_family`,
  `archive_*` across all memberships; `create_space` with preset and profile;
  `space_update`; `my_families` returning profile and member count;
  `space_add_expense`. Drafted as SQL once the target is approved.
- **From Hien:** the live text of `my_families` (one `pg_get_functiondef`),
  to settle the roster bug.
- **From the founders:** the list of bills and trips the group actually
  shares, to make the fixture and the month-end count real.
- **A decision on the storyboard:** tab labels for a space without a house
  (the target proposes "Nhóm" and "Chi tiêu").

## Screens

| Screen or state | Opened by |
|---|---|
| Nhóm section on Tài chính (list, invite, empty) | `go('personal')`, new `persSpacesSection` |
| Create a space (name, preset, switches) | `fhSpaceCreateSheet()` |
| Key Card and invite (link, QR, email) | after create; `fhSpaceInviteSheet(fid)` |
| Space first tab, house off | `go('home')` in a space without Ngôi nhà |
| Space money tab, budget off | `go('spending')` in a space without Ngân sách chung |
| Expense sheet with Chung or Chia | `openExpense()` |
| Settle up | `fhSpaceSettleSheet(fid)` |
| Space profile (name, switches, members) | new `fhSpaceProfileSheet(fid)` from the header chip's sheet |
| Space switcher sheet | header chip on the three space tabs |

## States

- **Empty.** No space beyond the family: the section shows the family row
  and one line inviting a first group.
- **Locked.** A space whose key is not on this device: the row says "Nhập mã
  nhóm để mở" and opens the card entry.
- **Loading.** A row whose net is not loaded shows no amount, never a zero.
- **Error.** A failed switch leaves the person in the space they were in,
  with a toast; it never lands in a half-loaded space.
- **Offline.** Switching needs the network. Rows stay visible; a tap says so.

## Acceptance criteria

- [ ] The Nhóm section lists every space the person belongs to, families
  included, each with its name, member count and the person's net or nothing
  when balanced; the active one is marked "đang mở".
- [ ] "＋ Tạo nhóm" is reachable from the section header whatever else the
  person has.
- [ ] Creating a space with the Bạn bè preset yields a profile with Chia
  tiền, Kỷ niệm và ảnh and Cảm xúc on and the other five off, and each switch
  can be changed before saving.
- [ ] The owner can change the name and any switch afterwards; a member
  cannot.
- [ ] An invitee who opens the invite link while signed in becomes a member
  and can read the space without typing the card.
- [ ] Tapping a space row switches into it; the three space tabs show its
  name; tapping the family row switches back, and the family's tabs are
  unchanged against the baseline shots.
- [ ] A tab shows nothing for a switch that is off: no house, no budget card,
  no goals, no proposals in a default Bạn bè space.
- [ ] In a space with Chia tiền on, the expense sheet offers Chung or Chia,
  pre-selected from the profile; the person recording is the pre-selected
  payer; any subset of members can be chosen; the per-person amount shown
  equals what is written.
- [ ] A Chia expense is written with its shares in one transaction: a failure
  leaves neither.
- [ ] Each member's net on the money tab equals paid minus shares plus
  settle-ups sent minus settle-ups received, and the pay-whom list clears
  every net to zero.
- [ ] Recording a settle-up for the proposed amount removes that line from
  the list; when no line is left the tab says "Đã cân bằng".
- [ ] Friend spaces no longer appear under "Gia đình của bạn", and a person
  whose only space is a Bạn bè one lands on Tài chính.
- [ ] Other members do not see the payer's bank or card on a row in a space
  with Hiện nguồn tiền off; the payer does.
- [ ] Every new string exists in Vietnamese and English.
- [ ] A family that existed before the release shows the same screens as the
  approved baseline for Nhà, Gia đình and Khoảnh khắc.

## Out of scope / Known gaps

- The personal book does not yet show a member's share of an expense they did
  not record, and what you fronted is not yet a receivable in your own book
  (release 2). Until then the Nhóm row is the only place the balance shows.
- Filing a captured bank row into a space at review (release 2).
- Notifications for a space you are not in, unseen marks, VietQR on settle,
  closing a space, removing a member (release 3).
- Quỹ (a fund), guests, percentage splits, multi-currency, a by-person view
  across spaces.
- Realtime inside a space works once it is active, as for a family; the Nhóm
  section's nets for other spaces refresh on open, not live.
- The headless harness cannot prove key delivery by link, or the switch
  itself against real access rules. Both need the phone pass.

## Assumptions

- A Bạn bè space has no "Chung" shared member; the payer of a Chung expense
  is a real member.
- The space's mark is an emoji in release 1.
- Tab labels for a space without a house are "Nhóm" and "Chi tiêu".
- The email whitelist stays as the membership gate; the link carries the key.
- Feature switches are enforced on the client only; members are trusted with
  everything in their own space.

## Target manifest

`tools/ui-harness/manifests/spaces-target.js`, `feature: 'spaces-target'`.

| Shot | Journey stage |
|---|---|
| `01-whatsnew` | 1 |
| `02-nhom-section` | 1, 8 |
| `03-create` | 2 |
| `04-invite` | 3 |
| `05-invited` | 3 |
| `06-space-home` | 4 |
| `07-switcher` | 4 |
| `08-expense-chia` | 5 |
| `09-space-money` | 6 |
| `10-settle` | 7 |
| `11-profile` | 2 |
| `12-outcome` | 8 |

Shots `13-capture-queue` to `24-outsider-book` picture release 2 (a bank
email filed into a space from the review queue, spec section 7.1; and a sharer
who is not in the space, section 7.4). They are in
the storyboard so the whole journey can be read in one place. They are not
part of release 1 and no acceptance line above covers them.
