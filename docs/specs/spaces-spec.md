# Spaces ("Nhóm"): one shared container for family, friends and anything else

A person's money life has one root (their own book, the Tài chính tab) and any
number of shared spaces hanging off it. Today the app has two kinds of shared
container that behave nothing alike: the **family**, which has everything, and
the **"nhóm chia tiền"**, a split ledger tucked inside Tài sản that has almost
nothing. This spec replaces both with one concept, the **space**, whose
differences are a profile of switches and not a different kind of thing.

> **Status, 2026-11-22. TARGET APPROVED, BUILD IN PROGRESS (one build, all
> three releases).** Decisions S1 to S31 come from a design interview with
> Hien on 2026-11-17 to 2026-11-21; S32 to S41 from the review of the target
> screens and the code sweep on 2026-11-22. Hien asked for one "big bang"
> build in place of three releases; section 14 keeps the release names only
> as a map of the work. The brief is `docs/briefs/spaces.md`, the target
> screens `tools/ui-harness/manifests/spaces-target.js`, the build checklist
> `docs/specs/spaces-checklist.md`, the SQL for Hien to apply
> `supabase/migrations/0165_spaces.sql`. Where the code already does
> something, the section says so and cites it.

> **How this relates to its siblings.** `borrowing-lending-spec.md` shipped
> the friend split ledger this spec absorbs (its Q4, Q5, Q7 to Q11, Q14 stand
> unless a decision here replaces them). `personal-ledger-spec.md` is still
> the storage philosophy: the person is the root, a space is where they direct
> money. `full-ledger-spec.md` T6 named "space contribution" as a future
> concept; the fund in S9 is where that lands. `effortless-transaction-logging-spec.md`
> and `transaction-review-spec.md` own capture and review, which release 2
> extends to any space.

---

# Part 1: Behaviour

## 1. Summary

- **Everything shared is a space.** A family is a space. A group of friends is
  a space. The user-facing word is **Nhóm** (English: Space). A family keeps
  its own name ("Nhà Minh") and is simply one of your nhóm.
- **A space has a profile.** Name, picture, a preset (Gia đình, Bạn bè, Khác)
  and a set of feature switches the owner can change at any time. The preset
  only pre-fills the switches.
- **You are in one space at a time, and you see all of them at once.** Opening
  a space switches the app into it, and the Nhà, space and Khoảnh khắc tabs
  show that space. The Tài chính tab is yours and never changes; its Nhóm
  section lists every space you belong to with what you owe or are owed.
- **A space expense is paid for in one of two ways.** *Chung*: it comes out of
  the shared pot and nobody owes anybody. *Chia*: one person fronts it and the
  others owe their share. A third way, *Quỹ* (a fund members pay into), is
  designed for but not built in the first releases.
- **Your own book shows your share, in every space.** What you fronted for
  others is money owed to you, never your spending.
- **Same privacy promise as a family.** Each space has its own Key Card. The
  operator cannot read it, and no space can read another.

## 2. Why this exists

- The founders of this app share bills and take occasional trips together and
  have nowhere in the app to do it. The existing "nhóm chia tiền" cannot hold
  photos, reactions or an occasion, does not reach anyone's own book, and
  (section 9) most likely does not open at all.
- Two container kinds means every feature is decided twice. "Can friends have
  goals?" should be a switch on a profile, not a schema question.
- The personal book is meant to be a person's full financial picture
  (`research/jtbd-individual-finance.md`: "Finance tab is my full picture").
  A dinner fronted for four friends is currently invisible there.

## 3. The space profile

| Attribute | Notes |
|---|---|
| Tên | Free text, shown everywhere the space is named |
| Ảnh hoặc biểu tượng | An emoji in release 1; a photo later |
| Loại (preset) | Gia đình · Bạn bè · Khác. Pre-fills the switches, nothing else |
| Ngân sách chung | Monthly budget, "Còn lại", pace guide |
| Chia tiền | Chia expenses, balances, settle-up |
| Kỷ niệm và ảnh | Photos on expenses, occasions (events), the Khoảnh khắc tab |
| Cảm xúc | Reactions on expenses |
| Mục tiêu tiết kiệm | Saving goals |
| Đề xuất cần duyệt | Planned expenses and occasions that need another member's sign-off |
| Ngôi nhà | The house scene and moods on the first tab |
| Hiện nguồn tiền | Whether other members see which bank or card you paid with |

Preset defaults:

| Switch | Gia đình | Bạn bè | Khác |
|---|---|---|---|
| Ngân sách chung | on | off | off |
| Chia tiền | off | on | on |
| Kỷ niệm và ảnh | on | on | on |
| Cảm xúc | on | on | on |
| Mục tiêu tiết kiệm | on | off | off |
| Đề xuất cần duyệt | on | off | off |
| Ngôi nhà | on | off | off |
| Hiện nguồn tiền | on | off | off |
| New expense defaults to | Chung | Chia, equally, everyone | Chia, equally, everyone |

Existing families become spaces on the Gia đình preset with every switch they
have today left on. Nothing changes for them. Chia tiền is off for a family
until its owner turns it on (S39); "Ai chi" on a family expense is untouched
either way. Choosing Gia đình when creating a space opens today's
create-a-family flow, since a family is born with a passcode door and a
"Chung" seat that the other presets do not have.

A switch turned off hides the feature; it deletes nothing. Turning it back on
shows what was there.

## 4. Where spaces live

### 4.1 The Nhóm section on Tài chính

One section on the Tài chính tab lists every space the person belongs to,
families included. Each row: the space's mark, its name, a second line (member
count, and "đang mở" on the space the app is currently in), and on the right
what the person owes or is owed there, or nothing when balanced. A pending
invite sits above the list. "＋ Tạo nhóm" is the section's action.

This replaces three things: the space tiles inside Tài sản, the full-screen
"Gia đình của bạn" picker, and the "Tạo nhóm chia tiền" button that only
existed in an empty state.

### 4.2 Being in a space

Tapping a row opens that space: the app switches into it and lands on its
first tab. The three space tabs (today labelled Nhà, Gia đình, Khoảnh khắc)
show the active space. Each carries the space's name in its header as a chip;
tapping the chip opens a switcher sheet with the same list. A tab drops what
is switched off:

| Tab | Everything on (family today) | Bạn bè preset |
|---|---|---|
| First tab | The house, moods, activity | Members, the group's balance, activity |
| Money tab | Còn lại, budget, proposals, transactions | This month's total, balances, who pays whom, transactions |
| Khoảnh khắc | Calendar, album, occasions | The same |

One layout follows the switches. There is no separate friend-space design.

### 4.3 What you see of the others

Activity in a space you are not currently in reaches you as a notification
and as an unseen mark on its row (release 3). Until then the row's balance is
the signal.

## 5. Money in a space

### 5.1 Chung and Chia

Chosen per expense, defaulting from the profile.

- **Chung.** The expense belongs to the space. It counts toward the space's
  totals and budget. Nobody owes anybody. This is every family expense today.
- **Chia.** One member paid; a chosen set of members share it. The split is
  equal or by exact amounts, among all members or only some. Each share is a
  debt to the payer until settled.

The person recording the expense is the payer by default and can name another
member instead (S20).

### 5.2 Balances

A balance is never stored. It is always the sum over the space's own rows:

```
my net in a space = what I paid on Chia expenses − my shares
                    + settle-ups I sent − settle-ups I received
```

Because only the raw facts are kept (this expense, this payer, each share,
each settle-up), the same rows answer "by space", "by person" and "by space
and person". The first releases show one net per space on Tài chính and the
per-person detail inside the space. A by-person view across spaces is a
display change later, for members who are the same account in each space.
Private IOUs typed under a name do not merge with a space member
automatically (S17).

### 5.3 Settling up

Either side records it and it stands; the other is told (S21). The settle
sheet proposes the simplified "who pays whom" amount. Later releases add the
payee's VietQR on the sheet and matching a captured bank transfer to the
balance at review.

### 5.4 Changing an expense

The member who recorded it and the payer can both edit or delete it at any
time, including after settle-ups. Balances recalculate. Every member in the
split is told (S22).

### 5.5 Occasions

A trip, a wedding, a monthly dinner is an occasion inside a space (the
existing events: dates, a total, linked photos), available wherever Kỷ niệm
và ảnh is on. Nothing stops a group from making a separate space for a trip
instead; that is their call (S10).

### 5.6 Currency

VND only. A foreign expense is entered in VND with the original amount kept
in the note, as captured foreign card charges already are (S24).

## 6. The personal book

The rule, the same for every space: **your book shows your share.**

A 2.000.000 ₫ dinner, paid by Hien from VIB, split five ways:

| | Account | Spending | Owed |
|---|---|---|---|
| Hien (payer) | VIB −2.000.000 | 400.000 | nhóm nợ bạn 1.600.000 |
| Each other member | untouched | 400.000 | bạn nợ nhóm 400.000 |

- The 1.600.000 ₫ is not spending. It is money lent, and it moves Còn lại
  the way any loan does today (cash went out; S34).
- A settle-up is a transfer between the two people's accounts. It clears the
  balance and is never spending or income.
- For a Chung expense the payer's share is the whole amount, which is exactly
  today's family mirror. Families see no change.
- The row in your own book keeps your bank or card. Other members see it only
  when the space's Hiện nguồn tiền switch is on.

What is new against today: a member who did not pay gets their share in their
own book, and it happens for every space they belong to, not only the one the
app is currently in. That is release 2.

## 7. Capture into a space (release 2)

"Ghi vào đâu?" on the expense sheet and on a review card lists Cá nhân and
every space the person belongs to. For a space with Chia tiền on, the card
also asks Chung or Chia, with the profile's default pre-selected. A bank
transfer that looks like a settle-up (the other side is a member, the amount
matches the proposed pay-whom figure) is offered as one at review, never
applied by itself.

### 7.1 The flow, step by step

Pictured in the target storyboard, shots 13 to 20
(`tools/ui-harness/manifests/spaces-target.js`). The queue, its cards and its
picker sheet are today's; only the marked rows are new.

1. **The row arrives as it does today.** A bank email is read into the
   person's own sealed queue. Nobody else in any space can see it. The card
   opens with Ghi vào đâu set to Cá nhân (or to whatever a rule or a standing
   route says), exactly as now. (Shot 13.)
2. **Ghi vào đâu lists every space.** The picker shows Cá nhân, then each
   space the person belongs to, families and friend spaces alike, whichever
   one the app is currently in. (Shot 14.)
3. **Picking a space with Chia tiền on reshapes the card.** Loại khoản goes
   away (a space row is always an expense or a settle-up) and two rows take
   its place (shot 15):
   - **Ai trả**: the person, read-only. The money left their own account, so
     the payer is not a question here.
   - **Tính thế nào**: the space's default, pre-filled. A friend space
     defaults to Chia đều among all current members and shows the person's
     own share under the value. Tapping it opens Chung or Chia, who shares,
     and the door to exact amounts. (Shot 16.)
   Category, node, date and time keep working as they do today. A line above
   the button says what the others will see.
4. **One tap files it.** The button reads "Ghi vào <tên nhóm>". The row
   leaves the queue with a toast. (Shot 17.)
5. **What the space gets.** One expense: amount, note, category, date, payer,
   split. The bank and the card number stay out of it unless the space has
   Hiện nguồn tiền on. Balances and the pay-whom list recalculate. (Shot 18.)
6. **What the person's own book gets.** One row for the full amount on the
   account it left, of which only their share is spending; the rest is "nhóm
   nợ bạn" and does not touch Còn lại. (Shot 19, section 6.)
7. **Everyone else in the split** gets their share in their own book and,
   from release 3, a notification.

**A settle-up that arrives by bank transfer.** Money in from a person who is
a member of one of the person's spaces, for the amount that member owes them
there, opens with the space and "Lan trả nợ nhóm" pre-filled and a line
saying why. It is still a card waiting for a tap; changing Ghi vào đâu back
to Cá nhân makes it an ordinary incoming transfer. (Shot 20.)

**The one-card quick review sheet** offers Cá nhân and the open space, by
name. A row filed there to a space whose new expenses default to Chia takes
that default: equally among every member. Another space, a different split or
an outside share is the full queue's job.

### 7.2 Rules

- A captured row is never sent to a space by the app itself. A space is a
  person's pick on that row, or a rule the person wrote.
- The payer of a captured row is the person whose account it left. To record
  somebody else's payment, use the expense sheet (S20).
- The default split is the space's, not the app's guess about who was at the
  table.
- Bulk approve ("Nhập N") files each row where its card says; a row nobody
  opened goes where it would go today.

### 7.3 Not settled yet

- **The same bill twice.** Lan records "Minh trả 1.240.000" by hand at the
  table; an hour later Minh's bank email arrives. Today's duplicate check
  reads the personal and family books only. Proposed: it also reads the
  spaces the person is in, and the card offers "Gắn vào khoản Lan đã ghi"
  (the bank row becomes the proof on the existing expense) instead of adding
  a second one.
- **Writing into a space the app is not in.** Needs that space's key on the
  device and `auth_space_ids()` to cover every membership (section 11,
  release 2).
- **A rule that names a space** ("Quán nướng → Hội bạn thân"): carry rules
  hold a scope today; whether a space can be one is open.

### 7.4 A sharer who is not in the space

A bill shared with people outside the space is split across everyone who
ate, but only the members' shares go into the space. The outside shares are
money the payer collects, held in the payer's own book (S32). Target shots 21
to 24.

The person does not have to name anybody. The split sheet asks two things:

- **Ai trong nhóm?** The members who share, as chips.
- **Chia mấy phần?** Number chips starting at the count of ticked members
  (3, 4, 5, 6, Số khác). Any share above the ticked count is an outside share.
  "Ghi tên người đó" is optional and can be done later from the row in the
  person's own book.

A 1.240.000 ₫ dinner paid by Minh, three members ticked, four shares:

| Where | What is recorded |
|---|---|
| The space | 930.000 ₫, split three ways. Lan and Khoa each owe Minh 310.000 ₫. The row says "Hoá đơn 1.240.000 ₫ · 1 phần ngoài nhóm". |
| Minh's book, account | VIB −1.240.000 ₫ |
| Minh's book, spending | 310.000 ₫ |
| Minh's book, nhóm nợ bạn | 620.000 ₫ |
| Minh's book, ngoài nhóm nợ bạn | 310.000 ₫, a loan (the existing lending kind) with no name until Minh adds one |

- The number chips are on the expense sheet as well as the review card.
- Outside shares are always owed to the payer. If Lan paid, they are in
  Lan's book.
- Money coming back is an ordinary loan repayment. A named share is matched
  at review the way lending capture already does it; an unnamed one is
  picked by hand. It never touches the space.
- If that person joins the space later, the old loan stays a private loan.
- With exact amounts, the outside figure is whatever is left after the
  members' amounts.

## 8. Membership

- **Invite.** By Google email, as today, plus a link or QR that carries the
  space's Key Card so the invitee types nothing. An account is required.
- **Roles.** One owner. The owner alone changes the profile, removes a member
  and closes the space. Every member records expenses and settle-ups.
- **Guests.** Only members can be in a split. No participant who is not on the
  app (borrowing-lending Q7 stands).
- **Leaving.** A member can leave with a balance outstanding; the balance
  stays on record under their name. The owner cannot leave without handing
  over or closing.
- **Closing.** A closed space is read-only. Its history and balances stay
  visible to its members.

## 9. What exists today

From a read of the code on 2026-11-17 (repo only; the live database was not
queried).

**Built and reusable**

- `families.type in ('family','personal','friend','trip')`
  (`0076_personal_ledger.sql:13`); `create_space`, `init_space_card`,
  `space_whitelist_add`, `leave_space` (`0106a_space_rls_and_rpcs.sql`).
- `auth_space_ids()` and additive membership policies on `transactions`,
  `categories`, `members`, `family_keys`, `family_key_wraps` (0106a). These
  are what let a member write into a space that is not the active one.
- `txn_shares` (`payer_member_id`, `rule in ('equal','exact')`, `shares_enc`)
  and `settle_ups` (0107), with RLS that already admits the active family.
- `src/js-data/22-spaces.js`: per-space key, hydrate, `fhSpaceAddExpense`,
  `fhSpaceSettle`, `fhSpaceBalances`, `fhSpaceMyNet`, `fhSpacePairwise`.
- `src/js-data/23-debts-ui.js`: the tile, `openDebtSpace`, and the create,
  invite, split and settle sheets.

**Broken or missing**

- **The roster reads the wrong fields.** `22-spaces.js:63-64` maps `f.id` and
  `f.owner_id`; `my_families` returns `family_id` and `is_owner`
  (`0076_personal_ledger.sql:100-104`). Every space would get an undefined id
  and its tile would open nothing. To be confirmed against the live function.
- The create button lives only in the Tài sản empty state
  (`23-debts-ui.js:54-55`).
- `switch_family` rejects any space that is not a family (0078:174), and the
  join RPCs never make one active (0106b).
- Spaces are denied incomes, budgets, events, photos and goals by design
  (0106a header). They become reachable the moment a space can be active,
  because every family policy keys on `auth_family_id()`.
- A split is two inserts with no rollback (`22-spaces.js:170`).
- A split always covers every member; there is no subset.
- No edit or delete of a split or a settle-up.
- No link or QR for a space card; the friend types 16 characters.
- Friend spaces leak into the family picker (`10-client-auth.js:101, 262`).
- Space expenses never reach the personal book.
- No push and no realtime for a space that is not active.
- No close, remove-member, cancel-invite or rename RPC.

---

# Part 2: Technical appendix

## 10. Architecture: switch on open

The whole family stack runs on one active container: `profiles.family_id`,
read by `auth_family_id()`, gates the policies on 34 migrations;
`get_family_snapshot` hydrates it; one realtime channel follows it; one
session key decrypts it. Loading several full spaces side by side would mean
rewriting all of that.

Instead: **any space can become the active one.** Once it is, every family
feature works in it with no further access change, because the policies never
asked what kind of container it was. The work is in three places.

1. **Let any space be active.** `switch_family` accepts any non-archived
   space the caller is a member of. Joining a space does not switch into it.
   `leave_family` and the archive functions pick the next active space from
   any the person still belongs to.
2. **Gate features by profile, on the client.** Every tab and entry point
   reads the active space's profile. Feature gating is presentation, not
   security: a member is trusted with everything in their space.
3. **Keep the light path for the spaces you are not in.** The Nhóm section's
   per-space net comes from the existing explicit-id read in `22-spaces.js`,
   which never needed the space to be active. It needs `auth_space_ids()` to
   cover every membership, family presets included (release 2 needs the same
   for capture into any space).

What is deliberately not done: several spaces hydrated at once, a second
realtime channel per space, a per-space session key in the family crypto
path (the active space's key is loaded on switch, as a family's is today).

## 11. Data model changes

One migration, drafted in `supabase/migrations/0165_spaces.sql` for Hien to
review, number and apply. No agent session writes `supabase/migrations/*`.
All additive, or a widened guard.

| Change | For |
|---|---|
| `families.profile jsonb` (plaintext switches and one default mode), `families.closed_at` | S2 to S4, S27 |
| `switch_family` accepts any space the caller belongs to except the personal ledger | S5 |
| `_next_active_space(uid, exclude)`; `leave_family`, `leave_space`, `archive_family`, `archive_member` hand a person their next space instead of nothing | section 19 |
| `leave_family` refuses the owner of a friend or trip space | section 19 |
| `create_space(name, type, idempotency_key, profile)` replaces the 3-argument form | S1 |
| `space_update(family_id, name, profile)`, owner only, families included | S25 |
| `my_families` also returns `profile`, `closed`, `members` | 4.1 |
| `auth_space_ids()` covers every membership except the personal ledger | 10(3), section 7 |
| `space_close`, `space_remove_member`, `space_whitelist_cancel` | S27 |

**No new tables and no new columns for money.** The member subset, the count
of shares and the outside amount all live inside `txn_shares.shares_enc`
(ciphertext): `{"<member_id>": amountK, …, "_parts": 4, "_out": 310}`. Keys
that start with `_` are never member ids and are skipped by the balance sum.

**No atomic expense RPC (changed from the first draft).** The expense row
goes through the family write path every expense already uses (outbox,
photos, encryption state), then its `txn_shares` row. The transaction id is
minted on the device, and a share row that fails to land is kept in a small
local queue and retried at the next open. Until it lands the row reads as a
Chung expense, which moves no balance. An RPC would have had to mirror every
column the transactions table grows.

**The profile is plaintext on purpose.** It holds booleans and one default
mode. It says what a space can do, never what anyone did. The space's name is
already plaintext on `families.name`.

**Push** needs an Edge Function change, not a migration: `push-send` picks
its audience from the caller's active container and from where each device is
"seated". Section 20.

## 12. The personal book

Settled 2026-11-22 (S33 to S36). No schema change: the personal book already
has the row kinds this needs, and anchored balances and spending already read
them the right way (`fhAnchorDelta`: an expense and a loan both leave the
account; spending sums expenses only).

**What each person's device writes into their own book, for a Chia expense**

| Who | Rows (all machine-owned, `space_id` set, `link_id` derived) |
|---|---|
| The payer | an **expense** for their own share, on the paying account; a **loan** for the rest of the members' part, counterparty = the space, same account |
| A member who did not pay | an **expense** for their share, no account; a **loan** of minus their share (borrowed), counterparty = the space, no account |
| The payer, with outside shares | additionally a **loan** for the outside amount, counterparty = the name typed or "Ngoài nhóm", same account |

A settle-up is a **repayment** row on each side (the sender's negative, the
receiver's positive), counterparty = the space. A Chung expense is unchanged:
today's mirror, one expense row for the author, full amount.

- **Who writes them.** Each member's own device, for every space it holds the
  key to, on the explicit-id read (`fhSpaceHydrate`), so it does not depend on
  which space is open. Nobody writes into another person's book. The person
  who saves the expense writes their own rows at once, with the account.
- **Link ids are derived**, not stored on the space row: `link_id` =
  UUID-shaped SHA-256 of `<txn or settle id>:<role>` (`x` expense, `l` loan
  to the space, `o` outside loan, `s` settle). The same device or another of
  the person's devices arrives at the same id, so the pass is idempotent, and
  the write-once `transactions.link_id` stays free for the Chung mirror.
- **The counterparty for the space** is the sentinel `@space:<family_id>`. It
  is excluded from the people tiles; the space's net on Tài chính comes from
  the space's own rows when they are loaded, and from these loan and repayment
  rows when they are not (key missing, offline), which is what lets the book
  stand on the personal key alone (security invariant 4).
- **Edits and deletes** follow the space row: the pass rewrites amounts that
  differ and removes rows whose space expense is gone, but only inside the
  date range the space read actually covers.
- **The outside loan** shows as an ordinary person in Tài sản so it can be
  collected and renamed. Its name lives only in the payer's book.
- **Today's mirror skips any row that has a share row**, or it would add a
  full-amount master on top.
- **Known limit.** A Chia expense somebody else recorded for you lands with no
  account ("Nguồn tiền: chưa rõ") until you pick one.

## 13. Client work (first sketch; the build list is `spaces-checklist.md`)

| Area | Change |
|---|---|
| `22-spaces.js` | Roster reads `family_id` / `is_owner`; carries `profile` and member count; split accepts a member subset; writes through `space_add_expense` |
| `21-personal.js` | The Nhóm section (`persSpacesSection`), listing every space; `P.fams` populated so no space is named "Nhóm" by default |
| `23-debts-ui.js` | Space tiles and the invite banner leave Tài sản; the rings keep summing space nets |
| `10-client-auth.js` | The full-screen picker is retired in favour of the section and a switcher sheet; a person with only non-family spaces lands on Tài chính |
| `10-nav-model.js`, `src/index.html` | Tab labels and the header chip follow the active space; tabs read the profile |
| `22-home.js`, `20-budget.js`, `35-goals.js`, `64-requests.js`, `40-memories.js` | Each surface checks its switch before rendering |
| `50-sheets-expense-capture.js`, `55-expense-photos-writes.js` | Scope chips list Cá nhân and the active space; Chung or Chia; payer; who shares |
| `60-settings-family-ui.js` | The space profile screen: name, preset, switches, members, invite |
| `67-card-ui.js` | Card link and QR work for any space |
| `60-transactions.js`, `61-expense-detail.js` | A Chia expense shows payer and split; edit and delete with recalculated balances |

Singular assumptions that a second active-capable space touches, each to be
grepped and listed in `AGENT_SYNC.md` before the build (ground rule 3):
`_obInvites[0]` (`65-passcode-ui.js:189`); the founder metrics trigger and
digest counting `type='family'` (0078); mailbox alias routing guarded to
`f.type='family'` (0087, 0092, 0093, 0098); streaks and month aggregates
built from one hydrate; `create_family` seeding a "Chung" shared member.

## 14. Releases

1. **Nhóm foundation.** Any space can be opened. The Nhóm section. Create
   with preset and switches. Join by link or QR. Chung or Chia on the expense
   sheet with a choice of members. Balances and settle-up on the space's
   money tab. The roster and picker faults fixed. The founders start here.
2. **The personal book and capture.** Shares and what is owed in every
   member's own book, for every space. Review files a captured row into any
   space as Chung or Chia. Settle-ups from bank mail are matched.
3. **Staying in touch.** Notifications across spaces, unseen marks, VietQR on
   the settle sheet, closing a space, removing a member.
4. **Later, unscheduled.** Quỹ (a fund). Guests. A by-person view across
   spaces. Multi-currency. Space photos as the space's mark.

Known gap between 1 and 2: a person's own book does not show space spending
they did not author, the same hole the existing groups have today.

## 15. Security invariants

1. A space is end-to-end encrypted under its own Key Card from birth. No
   plaintext value columns are added.
2. No space key is ever wrapped by another space's key or by a personal key
   that is not its member's own device cache.
3. Membership is the only access rule. A profile switch never grants or
   removes access.
4. The personal book rebuilds from the personal key alone, including what
   the person is owed.
5. Notifications about a space carry no amount and no merchant. They name
   the space and the first name of the member who acted, as family
   notifications already do.
6. Balances are derived on the device from rows the member can already read.
   No stored net exists to drift or to leak.

## 16. Decision log

Design interview, 2026-11-17 to 2026-11-21.

| # | Decision |
|---|---|
| S1 | One concept, the **space**. Family and friend groups are profiles of it. This upgrades the existing "nhóm chia tiền"; it does not add a second kind of group. |
| S2 | A profile is a preset plus feature switches. The preset only pre-fills. The owner can change switches later. |
| S3 | Presets: Gia đình, Bạn bè, Khác. Defaults as in section 3. |
| S4 | Existing families become spaces on the Gia đình preset with everything on. |
| S5 | Opening a space switches into it. The Nhóm section shows a light summary of the others without loading them. |
| S6 | A person can be in many spaces at once, alongside their family. |
| S7 | The user-facing word is **Nhóm** (English: Space), for every space. |
| S8 | Chia: equal or exact amounts, among all members or a chosen subset. |
| S9 | Money cases in the first releases: Chung and Chia, chosen per expense. Quỹ (a fund) comes after. The model must not block it. |
| S10 | An occasion (trip, event) is available inside any space with Kỷ niệm on. Whether a group uses an occasion or a separate space is theirs to choose. |
| S11 | Engagement starts from what the family space has: photos, reactions, occasions on by default; goals, proposals and the house are switches, off for Bạn bè. |
| S12 | Spaces stay end-to-end encrypted, exactly as families are. |
| S13 | The Nhóm section lives on the Tài chính tab and lists every space, families included. Tài chính is the person's full picture and the door to everything related. |
| S14 | The other tabs show the active space, with its name in the header as the way back to the list. One layout follows the switches. |
| S15 | The personal book shows your share in every space. It is the book of the person's whole financial picture, not of personal spending only. |
| S16 | A Chia expense in the personal book: the payer's account drops by the full amount, spending is the share, the rest is owed by the space. A non-payer has spending and a payable, no account movement. A settle-up is a transfer. |
| S17 | Owed amounts are one net per space on Tài chính, per person inside the space. Only raw facts are stored, so by-person and by-space views can be added later as display changes. |
| S18 | A captured transaction can be filed into any of your spaces at review, as Chung or Chia. |
| S19 | Only members can be in a split. No guests in the first releases. |
| S20 | Any member can record an expense another member paid. **The person recording is the default payer.** |
| S21 | A settle-up is one person's word. The other side is notified. |
| S22 | The recorder and the payer can edit or delete a shared expense at any time. Balances recalculate and the members in the split are notified. |
| S23 | Members are notified of activity that involves them in any space, active or not. No amount, no merchant. |
| S24 | VND only. |
| S25 | One owner per space. The owner alone changes the profile, removes a member, closes the space. |
| S26 | Join by invite link or QR that carries the key. An account is required. |
| S27 | A closed space is read-only with balances visible. A member can leave with a balance outstanding. |
| S28 | Other members never see which bank or card you paid with unless the space's switch is on (on for Gia đình). Your own view always shows it. |
| S29 | The first group is the founders: shared bills and occasional trips. Success is that group settling a month of shared spending in the app. |
| S30 | Release order as in section 14. |
| S31 | A brief and target screens come before any code. Migrations are drafted for Hien and applied by Hien. |
| S32 | A bill can be split into more shares than the members who share it (number chips). The extra shares stay out of the space: they are a loan in the payer's own book, named only if the payer chooses. The space records the members' part only. |
| S33 | Capture into a space: the payer of a captured row is the person whose account it left, and is not a choice on the card. The app never picks a space by itself. The split defaults to the space's setting. |
| S34 | The personal book stores a share with the kinds it already has: an expense for the share, a loan to the space for the rest (a borrowed loan for a member who did not pay), a repayment for a settle-up. No new columns. What you fronted is not spending and moves Còn lại as a loan does. |
| S35 | Each member's own device writes that member's rows, for every space it has the key to. Link ids are derived from the space row's id. |
| S36 | The headline of a space expense in your own book is the amount that left your account; the share and what is owed sit beneath it. |
| S37 | With the house off, the first tab is labelled "Nhóm" and the second "Chi tiêu". With it on they keep "Nhà" and the family's label. |
| S38 | No "Chung" shared member outside the Gia đình preset. A Chung expense in a friend space is paid by a real member. |
| S39 | A Gia đình space defaults to every switch on except Chia tiền; "Ai chi" on a family expense stays as it is. Turning Chia tiền on in a family adds Chung or Chia to its expense sheet with Chung pre-selected. |
| S40 | The invite link carries the space id and its Key Card. The owner still adds the invitee's Google email (the whitelist is the access rule); the link only saves typing the card. |
| S41 | One build covers all three releases. Hien applies the migration and deploys `push-send`; the client ships after the migration. |

## 17. Open questions

- **The same bill twice** (7.3). The duplicate check now reads the spaces the
  person holds a key to, so a bank row that matches an expense already in a
  space is flagged "đã có trong <tên nhóm>". Attaching the bank row to the
  existing expense as its proof is not built.
- **A rule that names a space** (7.3). Not built: carry rules still hold
  Cá nhân or the active space only.
- **Founder metrics.** The Telegram digest counts families only (0078). A new
  space is not counted. Proposed: its own line.
- **Switching cost.** A switch is a server write and a full hydrate; to be
  measured with `tools/boot-harness` on the built client.
- **The device's push seat** follows the active container (section 20). Until
  `push-send` is redeployed, a person sitting in a friend space does not get
  their family's social pushes.

## 18. Related

- `docs/briefs/spaces.md`: the release 1 brief.
- `docs/specs/borrowing-lending-spec.md`: the split ledger this absorbs.
- `docs/specs/personal-ledger-spec.md`, `docs/features/personal-ledger.md`:
  Model Y and the mirror.
- `docs/specs/full-ledger-spec.md`: transfer pairs, anchored balances.
- `docs/specs/cross-ledger-move-spec.md`: moving a row between books.
- `docs/features/key-card-auth.md`: the card link and QR.
- `research/jtbd-individual-finance.md`: spaces for navigation, hub-and-spoke
  Finance tab, fairness as the friend-circle job.

## 19. Server functions that act on "the active container"

Found by the sweep of 2026-11-22. Each of these read the active slot and
never asked what kind of container it was. Once a friend space can be active,
each needs a rule.

| Function | Today | Rule |
|---|---|---|
| `leave_family` (0078:151) | leaves whatever is active, no owner check; next = oldest family or nothing | owner of a friend or trip space cannot leave; next = any remaining space (migration) |
| `archive_family` (0010:56), `archive_member` (0010:66) | clear every affected person's slot | hand each person their next space (migration) |
| `leave_space` (0106a:185) | leaves the slot pointing at a space you are no longer in | frees the slot (migration) |
| `add_member`, `update_member` | add or rename a seat in the active container | client does not offer "add a member without login" in a friend space |
| passcode and card functions (0030, 0032, 0042, 0043, 0047) | operate on the active container's key rows | client offers only "Xem thẻ nhóm" in a friend space; no passcode |
| `set_family_staging_key` (0051) | gives the active container a mail staging key | client never calls it outside a Gia đình space |
| `set_family_house`, `set_family_save_goal`, `set_savings`, `archive_event`, `archive_goal` | act on the active container | reachable only when that feature's switch is on |
| `grant_mailbox_access` (0098:53) | binds mail to the oldest family membership, not the active slot | unchanged, and now clearly right: mail never follows a switch |
| `get_or_create_mailbox_alias` (0118:47) | picks a member row with no type filter and no order | older fault, left for its own fix |
| `_tg_on_member_joined` (0061:73) | pings on any join, spaces included | unchanged |

## 20. Push across spaces

`push-send` (user branch) takes the audience from `profiles.family_id` of the
caller and delivers to `push_subscriptions.family_id`, the container each
device is seated on, which the client re-points at every switch.

Change, in `supabase/functions/push-send/index.ts`:

- The body may carry `family_id`. It is honoured only if the caller is a
  current member of it; otherwise the active slot is used as today.
- Recipients are the other members of that container, by
  `members.user_id` → `push_subscriptions.owner_user_id`, so a device is
  reached whichever space it is sitting in.
- Two new kinds, `space_expense` and `space_settle`, with copy that names the
  space and the actor and carries no amount.

The client sends `family_id` on every social push and opens the right space
when one is tapped. The function is deployed by Hien after a diff against the
live version (ground rule: a redeploy replaces whatever is live).

## 21. How an invite reaches the invitee (added 2026-11-22, S42 to S44)

Found on the first real invite: Hien's friend scanned the QR on an iPhone and
landed in a browser, signed out, and after signing in nothing happened.

**Why.** An iPhone never opens a link or a scanned code in an installed web
app: it opens Safari, or the scanning app's own browser. That browser is a
separate copy of the app with its own storage. On top of that the first build
kept the invite in a window variable, and "Continue with Google" reloads the
page, so the invite was gone by the time the person was signed in. And Google
often refuses sign-in inside another app's browser.

**Three roads, all built.**

| Road | For whom | What happens |
|---|---|---|
| The key sealed to the account (S42) | someone who already has Earthy | The owner adds the email. The owner's device seals the space's Key Card to that account's public key (`personal_keys.staging_pub`, the keypair every account already has for sealed bank mail) and stores the box on the invitation. The invitee opens Earthy, sees the invite in the Nhóm section, taps Tham gia, and is in. Nothing is scanned, pasted or typed. |
| Paste (S43) | an iPhone that was sent a link anyway | The browser shows a hand-off sheet: "Sao chép lời mời", then open Earthy from the home screen and tap "Dán link mời" in the Nhóm section. One tap reads the clipboard; if the browser will not hand it over, a field to paste into. |
| Continue in the browser (S44) | someone with no account yet | "Chưa cài, tiếp tục trên trình duyệt này". The invite now waits in `sessionStorage` through the sign-in round trip and joins on return. In an in-app browser the sheet says to open it in Safari or Chrome. |

The invite sheet puts the email first, since for an existing user it is the
whole invite, and the link and QR below it under "Người chưa có Earthy".

**An invitee with no account when invited** has no key to seal to. The owner's
device seals to them later: whenever it lists that space's invites, and at
most every ten minutes from the Nhóm section's refresh. Until then the list
says "Chưa có tài khoản Earthy. Gửi link mời cho bạn ấy."

**A second device of the invitee** asks for the same box
(`space_my_sealed_key`) before it asks for a code.

**What this trusts that the link does not.** The owner's device asks the
server which public key belongs to the invited email. A server that answered
with a key of its own could open the box. The box binds the space id and the
email inside it, so it cannot be moved to another invitation, but it cannot
prove whose key it was sealed to. The owner's list shows a six-character
"mã xác nhận" of the key it sealed to; comparing it with the invitee is the
check, and it is optional. This is a deliberate step down from "the key never
goes near the server in any form" for the sake of a one-tap join; the link
remains available to anyone who prefers it. Security invariant 2 still holds:
no space key is wrapped by another space's key or by a key its member does not
own.

**Schema** (`supabase/migrations/0166_space_invite_sealed_key.sql`):
`invitations.key_sealed`; `space_invite_pubkey` (owner only, and only for an
email with a pending invite in that space, so it is not an account-probing
oracle beyond the people the owner already invited); `space_invite_seal`;
`space_my_sealed_key`; `space_whitelist_list` returns `sealed`;
`find_my_invites` returns `key_sealed`. A client on the old schema falls back
to the link.

| # | Decision |
|---|---|
| S42 | The space key also travels sealed to the invitee's account, so an existing user joins with one tap in the installed app. |
| S43 | A link opened where nobody is signed in shows a hand-off sheet; the installed app has "Dán link mời". |
| S44 | An invite survives the sign-in round trip; an in-app browser is told to open Safari or Chrome. |

## 22. Telling the invitee (added 2026-11-22, S45)

Adding an email wrote the invitation and sealed the key, and told nobody: the
invitee found out only by opening the app and looking at the Nhóm section.

Now "Mời" also sends one push to the invitee's own devices. `push-send` gains
the kind `space_invite`, the only one whose audience is not a member. It is
sent only when all of these hold, each read on the server: the caller owns the
space and it is a friend or trip space; the email has a pending, unexpired
invitation there; an account with that email exists. So it reaches nobody the
owner has not already invited. The copy says who invites and the space's name,
in the reader's own language, and where to tap; it carries no key and no
amount. Tapping it lands on Tài chính at the Nhóm section.

Inviting the same email again sends it again, which is the way to remind
someone. Nothing is sent to a person with no account or with notifications
off; the link is still their road. An invite sent before the person signed up
is not announced later.

| # | Decision |
|---|---|
| S45 | Inviting by email notifies the invitee's devices, under the owner-and-pending-invite check above. |

## 23. Scanned receipts in a space (added 2026-11-22, S46)

Found on first use: a receipt scanned into a friend space was saved as a
plain shared row. The scan review never asked how it was counted, so nothing
was split and nobody's balance moved. The scan path was the one way into a
space that the Chung or Chia work had missed.

The scan review now names the space as its destination and carries one split
for the batch under its rows ("Tính thế nào"), pre-filled with the space's
default: Chia đều among every member, the person scanning as payer. Tapping
it opens the shared split control (payer, members, number of shares; typed
amounts are not offered, since one setting covers several bills). On save
each receipt becomes its own expense with its own share row. Chung writes no
shares. A split batch needs a connection.

An expense that is already in unsplit can be fixed from its detail screen:
"Tính thế nào" is tappable there for whoever recorded or paid it, without
going through Sửa.

| # | Decision |
|---|---|
| S46 | A scan batch into a space with Chia tiền takes one split for all its receipts, defaulting to the space's. |

