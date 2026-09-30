# Earning the notification permission

The app asks for notification permission once, 2.6 seconds after the person first
sees the home screen, before they have any idea what it would send them. Whatever
they do with that sheet — grant, decline, or brush it away — is recorded as the
same answer, and they are never asked again. In the UT session of 2026-09-26 the
participant went looking for the switch, could not find it, turned it on by
another route, and then said they still did not know what they would receive
(`research/UT/UT-onboarding-report.html`, problem 13, P1).

The moment that should carry the ask is standing empty. A person who has just
watched the app read a year of their bank mail has every reason to want to be
told about the next one. This spec puts the ask there, shows them the actual
notification before they answer, and gives the feature a permanent home they can
find on their own.

> **Status, 2026-09-30. SPEC, not built.** Chosen from eight options in
> `mockups/push-nudge-options.html`; the three that survived are drawn as built
> surfaces in `mockups/push-nudge-build.html`. Copy in this document is the
> shipping copy.

> **How this relates to its siblings.** `docs/features/web-push.md` owns the
> subscription lifecycle, the payload shape and the tap routing, none of which
> change here. `activation-journey-spec.md` §8 (Q29a) removed the family gate so a
> solo account can subscribe at all; this spec assumes that. `personal-activation-spec.md`
> owns the Tài Chính tab that surface 1 lives in. `reading-loop-cost-spec.md`
> decision H6 blocks any further backoff of the mailbox poll until problem 13 is
> fixed, which makes this spec that decision's unblocker.

---

# Part 1 — Behaviour

## 1. Summary

- **Three surfaces, one for each half of the problem.** A row in Tài Chính that
  can always be found. A sheet at the moment the mailbox finishes reading, whose
  content is two real notifications rather than a promise. A card after the first
  import, for the person who imports in the same session.
- **The preview is the ask.** Surface 2 does not describe the notification. It
  renders the line the person would actually have received for their own two
  newest transactions, with their real times.
- **Declining is no longer permanent.** The one-way flag is replaced by a count
  and a date, so the app may ask up to three times, at least fourteen days apart.
- **The row never asks.** It states whether notifications are on, and that is all.
  It does not consume one of the three asks.
- **iOS folds into the row.** A person in Safari without the app installed sees a
  fourth state that leads through the install step and picks the permission ask up
  afterwards, instead of a switch that cannot work.

## 2. The three surfaces

| # | Surface | When | Primary action |
|---|---|---|---|
| 1 | Row in the Tài Chính action list | Always | Opens the state sheet |
| 2 | Sheet with a live preview | Once, when the first mailbox read finishes and the person is in the app | Bật thông báo |
| 3 | Card under the import result | Once, after the person's first import into the ledger | Bật thông báo |

Surfaces 2 and 3 never appear in the same session. If the import happens in the
reading session, surface 3 wins, because it sits after a thing the person chose to
do rather than after a thing that happened to them.

### 2.1 Surface 1 — the row

Fifth row of the Tài Chính action list, directly under **Khoản thu chi từ email**,
which is where the UT participant went looking. Title **Nhắc khi có khoản mới**.
The subtitle carries the state and nothing else, because the explanation belongs
in the sheet.

| State (`fhPushState()`) | Subtitle | Dot |
|---|---|---|
| `off` | Đang tắt | neutral |
| `on` | Bật cho máy này | green |
| `denied` | Bị chặn trong Cài đặt máy | amber icon |
| `ios-install` | Cần thêm Earthy vào MH chính | amber icon |
| `unsupported` | row hidden | — |

Amber is reserved for the two states that are actually blocked. Notifications
being off is a choice, not a fault, and an amber row on a working app would be a
false alarm every time it is seen.

"Máy này" is load-bearing: a subscription belongs to a device, not to an account,
and a person with two phones must not read the row as a global setting.

### 2.2 Surface 2 — the sheet with a preview

A bottom sheet, per DESIGN §4: this is a single decision, not a form.

```
Lần sau bạn biết ngay
Có khoản mới là Earthy nhắc bạn, kể cả khi app đang đóng.

  [ 😏  14:32   Chiều mà cà phê nữa, tối ngủ được không đó! ]
  [ 😌  08:05   Ghé chợ tí mà đảm đang ghê!                 ]

Hai khoản thật của bạn hôm nay. Không số tiền, không tên cửa hàng.

        ( Bật thông báo )
            Để sau
```

The two cards are the person's two newest readable staged rows, rendered with the
**same line-selection function the server uses**. Tapping the preview area rerolls
the variant, which is also how a person satisfies themselves that the app is not
showing them a single canned example.

Degradations, in order: fewer than two readable rows renders one; none renders
none and the sheet stands on its subtitle alone; a locked personal ledger renders
none. The sheet is never blocked by the preview failing.

### 2.3 Surface 3 — the card after the first import

One card, not two. The result and the ask share a block separated by a hairline,
so the screen keeps a single primary action.

```
        ✓
806 khoản đã vào sổ
Một năm chi tiêu của bạn, giờ đã ở trong sổ.
─────────────────────────────────
Bật thông báo cho lần sau
Khoản mới vẫn vào hàng chờ khi app đóng.
Bật thông báo là bạn biết ngay.

        ( Bật thông báo )
            Để sau
```

It yields outright to the account-setup wizard rather than queueing behind it:
two sheets after one press is worse than not asking, and the ask has two other
surfaces plus a permanent row to fall back on. Spacing across repeated imports
needs no separate first-import flag, because the ask budget in §3 already
guarantees fourteen days between asks.

## 3. Asking again

Today `fh-push-nudged:<id>` is written the moment a sheet opens and read as a
permanent refusal. It is replaced by a record holding the number of asks and the
date of the last one.

- At most **three** asks, ever.
- At least **fourteen days** between asks.
- The count increments only when a sheet actually opens. A sheet suppressed
  because another one owns the screen costs nothing.
- Granting stops the asks permanently. So does reaching three.
- The existing legacy keys are honoured: a member who answered the old post-import
  offer starts at one ask already spent.

There is no explicit "never ask me again" control, because a button that promises
it has to be honoured forever and three asks over six weeks is already quiet.

## 4. Copy

Shipping strings. Vietnamese only, consistent with the rest of the tab.

| Where | String |
|---|---|
| Row title | Nhắc khi có khoản mới |
| Sheet title | Lần sau bạn biết ngay |
| Sheet subtitle | Có khoản mới là Earthy nhắc bạn, kể cả khi app đang đóng. |
| Preview caption | Hai khoản thật của bạn hôm nay. Không số tiền, không tên cửa hàng. |
| Primary button | Bật thông báo |
| Secondary | Để sau |
| Import card title | 806 khoản đã vào sổ |
| Import card body | Một năm chi tiêu của bạn, giờ đã ở trong sổ. |
| Import ask title | Bật thông báo cho lần sau |
| Import ask body | Khoản mới vẫn vào hàng chờ khi app đóng. Bật thông báo là bạn biết ngay. |
| On state, sheet | Máy này sẽ nhắc bạn khi có khoản mới từ email. |
| Denied state, sheet | Mở Cài đặt của máy, tìm Earthy và cho phép thông báo, rồi quay lại đây. |
| iOS state, sheet | Trên iPhone, thêm Earthy vào Màn hình chính trước. Bấm nút Chia sẻ, chọn Thêm vào MH chính, rồi mở app từ biểu tượng mới. |

Rules applied: say what the person receives, not how it works; no emoji on
buttons; no dashes and no arrows; a button label never carries a system promise.

## 5. What this does not do

- No per-kind toggles. One switch covers everything push sends.
- No quiet hours. The pipeline's one-push-per-run rule is the only cadence
  control, and the streak digest is the only scheduled push.
- No change to the payload, the fan-out, or the tap routing.

---

# Part 2 — Technical appendix

## 6. One source for the notification's voice

Surface 2 is only honest if the preview and the real notification cannot drift. The
line tables and the selection logic live today inside
`supabase/functions/_shared/mailbox/notify-copy.mjs`, which a browser cannot
import.

This follows the taxonomy precedent exactly (`tools/gen-taxonomy.js`, run by
`build.js` before every assembly):

| Artefact | Role |
|---|---|
| `taxonomy/notify-lines.json` | the source: the tier matrix, the daypart sets, the pool lines, both languages |
| `tools/gen-notify-lines.js` | the generator, run from `build.js` and `npm run notify-lines` |
| `supabase/functions/_shared/mailbox/notify-lines.mjs` | generated, imported by `notify-copy.mjs` |
| `src/js-ui/14-notify-lines.js` | generated, exposes `window.FH_NOTIFY` with `meta()` and `body()` |

Both the enum derivation and the line selection are emitted from one template, so
the client cannot hold a stale copy of either. `notify-copy.mjs` keeps its own
public surface (`copyMeta`, `reviewBody`, `digestBody`, `statementBody`) and loses
only the literal tables.

The client derives the enum from an already-unsealed staged row, which it has via
the quick-review opener. No new decryption, no new query.

## 7. Where it lives

| File | Change |
|---|---|
| `src/js-ui/21-personal.js` | the row in the `.cf-cta` list, with its four states |
| `src/js-data/55-push.js` | the ask-again record; `fhPushSheet` gains the preview; the reading-finished trigger; the iOS resume |
| `src/js-data/72-txn-review.js` | surface 3, fired after an import unless the account wizard claims the moment |
| `src/js-data/74-autotxn-ui.js` | fires the reading-finished trigger on the transition into `done` |
| `src/js-data/76-quick-review.js` | `fhNotifyPreview(n)` — the opened rows reduced to the copy enum |
| `src/css/40-spending-tabs.css` | `.cc-state`, the row's state dot |
| `src/css/80-settings-families.css` | `.np-*`, the preview cards |
| `src/js-ui/14-notify-lines.js` | new, generated |
| `taxonomy/notify-lines.json`, `tools/gen-notify-lines.js` | new |
| `build.js` | runs the new generator |
| `sw.js` | version bump only |

## 8. Trigger derivation

```
askable   = fhPushState() === 'off' && asks.n < 3
            && (now - asks.last) > 14d
            && onboarding finished
            && no scrim open
finished  = backfilled_at flipped in this session
surface2  = askable && finished && !askedThisSession
surface3  = askable && importJustCompleted && !accountWizardPending
```

`ios-install` never reaches surface 2 or 3. It is handled by the row, which walks
the install step and re-offers the permission once the app is opened from the Home
Screen icon, detected by `display-mode: standalone` with a resume flag that expires
after seven days.

## 9. Failure modes

| Case | Behaviour |
|---|---|
| Preview cannot render any line | Sheet opens without the preview block; the ask still counts |
| Personal ledger locked | Same as above; the sheet never prompts for the Key Card |
| Another sheet owns the screen | Ask is skipped, nothing is recorded, retried next launch |
| Permission prompt dismissed by the OS | Counts as one ask; state stays `off` |
| Permission denied at OS level | Row switches to the denied state; no further asks |
| Person has two member seats on one device | Asks are per seat, as subscriptions are |
| Generator not run | `npm run check` fails on drift, as it does for the taxonomy |

## 10. Acceptance

- The row is present in all four states and reflects a permission change without a
  reload.
- The preview line for a given row is byte-identical to the line the server would
  send for that same row. Covered by a test that runs both generated targets over
  the same fixture.
- A declined ask reappears no earlier than fourteen days later, and never a fourth
  time.
- On iOS Safari, the row leads to the install step and the permission ask follows
  the first launch from the Home Screen icon.
- No surface asks twice in one session.

## 11. Decision log

| # | Decision |
|---|---|
| N1 | Three surfaces from eight options: the findable row, the preview ask at the reading finish, the card after the first import. The rest are recorded in `mockups/push-nudge-options.html` as considered and not taken. |
| N2 | The ask shows real notifications built from the person's own rows, not written examples. This is the only part that answers the second half of UT problem 13. |
| N3 | The line tables get a generator rather than a copy, because a hand-copied preview becomes a false promise the first time the server's copy changes. |
| N4 | The one-way flag becomes three asks, fourteen days apart. A dismissal is not a refusal. |
| N5 | The row states its status and never asks, so it costs no ask. |
| N6 | The iOS ladder collapses into a row state instead of its own surface. |
| N7 | Surfaces 2 and 3 are mutually exclusive in a session; the import beat wins. |
| N8 | No per-kind toggles and no quiet hours in this spec. |
| N9 | No "never ask again" button; three asks over six weeks is quiet enough, and the button would be a promise with no expiry. |

## 12. Related

- `docs/features/web-push.md` — subscription lifecycle, payload, tap routing
- `docs/specs/activation-journey-spec.md` §8 — the family gate removal this assumes
- `docs/specs/personal-activation-spec.md` — the tab surface 1 lives in
- `docs/specs/reading-loop-cost-spec.md` H6 — the decision this unblocks
- `mockups/push-nudge-options.html`, `mockups/push-nudge-build.html`
