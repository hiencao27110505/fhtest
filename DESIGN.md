# FamilyHub — Design Guideline

The single source of truth for building new FamilyHub features so they stay visually and
behaviorally consistent. Extracted from the shipping app (`index.html`). When in doubt,
match an existing screen rather than inventing a new pattern.

---

## 1. Principles

FamilyHub follows Apple's Human Interface Guidelines, adapted for a warm family-finance app.

- **Clarity first.** One clear job per screen. Big legible titles, generous spacing, tabular
  numbers for money. Never make the user hunt.
- **Deference.** Chrome is quiet; content leads. Neutral surfaces, hairline borders, and the
  brand color used *sparingly* on the one thing that matters (the primary action, the selected
  state, a positive figure).
- **Depth through layering, not decoration.** Navigation reads as physical layers — tabs at the
  base, detail screens push in from the right, modals rise from the bottom, sheets and the scrim
  sit on top. Motion reinforces the hierarchy.
- **Native feel.** Full-bleed on device, safe-area aware everywhere, 44×44 minimum touch targets,
  momentum scrolling, drag-to-dismiss, no browser chrome.
- **Warm, not corporate.** Friendly copy, soft shadows, rounded everything, tasteful emoji as
  category/identity marks — but never emoji inside data tables or as UI icons.

---

## 2. Foundations

### 2.1 Color

Colors are CSS variables. **Only** the brand ramp changes with the theme; everything else is fixed.
Use the semantic token, never a raw hex, so theming and dark-mode work.

**Brand ramp (theme-driven — default "Sage"):**
| Token | Sage value | Use |
|---|---|---|
| `--brand` | `#2E9E6B` | Primary actions, selected state, the one accent per view |
| `--brand-ink` | `#1F7E52` | Brand-colored text on light backgrounds (higher contrast) |
| `--brand-2` | `#5FD3A0` | Secondary brand, gradient stop |
| `--grad-brand` | `linear-gradient(135deg,#34B87A,#5FC98D)` | Primary button fill |
| `--grad-hero` | `linear-gradient(150deg,#4CB584,#2E9E6B,#8FC97E)` | Home hero, app mark |
| `--brand-tint` | `#e9f7f0` | Selected-chip fill, subtle brand backgrounds |
| `--brand-glow` | `rgba(46,158,107,.32)` | Primary button shadow |

**Neutrals & surfaces (fixed):**
| Token | Value | Use |
|---|---|---|
| `--ink` | `#191022` | Primary text, titles |
| `--ink-2` | `#3a2f45` | Body text |
| `--muted` | `#8a8494` | Secondary text, labels, captions |
| `--muted-soft` | `#a29caa` | Tertiary / disabled |
| `--canvas` | `#f4f1f6` | App background (behind cards) |
| `--white` | `#ffffff` | Card / sheet / modal surfaces, input fields |
| `--surface` | `#f9f7f8` | Subtle hover / inset field fill |
| `--hairline` | `#e9e4ee` | Borders, dividers between groups |
| `--divider` | `#f1edf4` | Row dividers inside a card |

**Semantic:**
| Token | Value | Meaning |
|---|---|---|
| `--good` / `--good-tint` | `#1a9d5f` / `#e7f5ee` | Positive, income, success, "today" |
| `--danger` / `--danger-tint` | `#E0322F` / `#fdecef` | Destructive, over budget |
| `--amber` / `--amber-tint` | `#B8730B` / `#fbefda` | Warning, "over pace" |

**Category colors** (`--cat-housing #5E5CE6`, `--cat-food #34C759`, `--cat-dining #FF375F`,
`--cat-kids #FF9F0A`, `--cat-transport #32ADE6`, `--cat-fun #BF5AF2`, `--cat-other #98949e`) —
each category has a `[emoji, tint-bg, text-color]` triple in `catStyle`. New categories cycle a
palette (`CATPAL`). **Member/person colors** are per-member, stored on the member.

**Themes:** `Sage, Ocean, Lavender, Blossom, Twilight` — each overrides the brand ramp via a
`.phone.t-<name>` class; chosen in onboarding + Settings, persisted to `localStorage: fh-theme`.

**Rules:** No colored fills on info cards, quote cards, table headers or stat blocks — use borders
and left-accent lines. No gradients except the brand hero/CTA. One accent per view.

### 2.2 Typography

Two families, both system-first (no web font shipped for display):
- `--disp` = `"SF Pro Display", -apple-system, BlinkMacSystemFont, "Inter", system-ui` — titles,
  numbers, anything big/bold.
- `--text` = `"SF Pro Text", -apple-system, BlinkMacSystemFont, "Inter", system-ui` — body/UI.
- Money & figures add `.num` → `font-family:var(--disp); font-variant-numeric:tabular-nums`.

**Scale** (weight + size + negative tracking make hierarchy — never a contrasting font):
| Role | Family | Size / Weight / Tracking | Token |
|---|---|---|---|
| Screen large title | disp | 34 / 800 / −1px | `.h-title` |
| Onboarding / detail H1 | disp | 30 / 800 / −.8px | `.ob-h1` |
| Modal / sheet title | disp | 25 / 800 / −.7px | `.sheet-h` |
| Section title | disp | 20 / 800 / −.4px | `.photo-sec-title` |
| Big number / stat | disp | 28–34 / 800 / −.5→−1.2px | `.num` |
| Body | text | 15–17 / 400–500 / −.01em | `p, li, input` |
| Field label / eyebrow | text | 12–13 / 700 / +.02–.04em, **UPPERCASE** | `.field label`, `.eyebrow` |
| Row title | text | 15–16 / 600 | `.r-t` |
| Row subtitle / meta | text | 13–14 / 400–500, `--muted` | `.r-s` |

`<em>` inside a display title = same weight, `--brand-ink` color (e.g. "Welcome to *FamilyHub*").

### 2.3 Spacing, radius, layout

- **Screen gutter:** content sits `16px` from the phone edge (cards `margin:0 16px`), text blocks
  and section headers `18–22px`. Onboarding uses `24px`.
- **Radius:** cards/sheets `16–24px` · modal top `22px` · sheet top `24px` · inputs `13px` ·
  chips & buttons `9999px` (pill) · small tiles `12–14px` · icon tiles `10–15px`.
- **Section header** (`.section-h`): baseline-aligned title + optional right-side link, `margin:26px 22px 13px`.
- **Edge-to-edge exceptions:** photo mosaics and the memory calendar run full-bleed (inside the
  16px gutter only via their own inset), matching iOS Photos.

### 2.4 Elevation (shadows)

Soft, layered, low-opacity — never a hard drop shadow.
- **Card:** `0 1px 3px rgba(25,16,34,.05), 0 8px 24px rgba(25,16,34,.04)`
- **Raised card (hero/ov-card):** `0 2px 6px …/.06, 0 16px 34px …/.12`
- **Floating (FAB, memory tile):** `0 8px 22px …/.14`, `0 12px 28px var(--brand-glow)`
- **Modal:** `0 -12px 44px rgba(25,16,34,.22)` (rises from bottom)
- ⚠️ A horizontally-scrolling row (`overflow-x:auto`) clips vertical shadows — add vertical padding
  to the scroller (see `.mem-strip`) so card shadows aren't cut.

### 2.5 Motion

- Standard easing: `cubic-bezier(.32,.72,0,1)` (iOS-like) for slides/dismiss; `cubic-bezier(.4,0,.2,1)` for taps.
- Detail overlays slide in from the right (`.38s`), modals rise from the bottom (`.42s`), sheets rise (`.4s`).
- Buttons press with `transform:scale(.95–.99)`.
- Hidden layers use `visibility:hidden` (not just transform) so they can't paint over content.

### 2.6 Iconography & emoji

- UI icons are inline SVG, `stroke-width` 1.9–2.4, `stroke-linecap:round`, sized 16–26px.
- Emoji are content marks only: category icons, event/memory covers, member fallbacks, welcome art.
- Never put emoji in data tables or use them as functional control icons.

---

## 3. Components

### Buttons
- **Primary CTA** (`.cta`): full-width pill, `--grad-brand` fill, white 17/700, `padding:17px`,
  `radius:9999px`, brand glow shadow. One per screen, bottom-anchored in modals/onboarding.
- **Line button** (`.btn-line`): white pill, 1.5px brand border, brand text — secondary actions
  ("Add member", "Add a photo").
- **Text link** (`.ob-textlink`): centered brand-ink text, no fill — tertiary ("I already have an account").
- **Destructive** (`.ex-del`): small, muted, centered text — *low prominence on purpose*. Requires a
  **two-tap arm-then-confirm** ("Delete" → "Tap again to delete", auto-resets ~3s). Never a big red button.
- **Nav Save** (`.modal-save`): text button in the modal nav bar; **disabled until the form is valid /
  changed** (grey `--muted-soft`), brand-ink when active.

### Choice chips (`.choices` / `.choice`)
Wrapping pills, white with hairline border. Selected: brand border (2px), `--brand-tint` fill,
brand text, weight 700. Use for single-select options (category, who paid, role).

### Fields (`.field`)
- Label: uppercase 13/700 `--muted`, `margin-bottom:8px`.
- Input: `radius:13px`, `padding:15px`, 17px text, 2px transparent border → **brand border + white
  bg on focus**. Big numeric inputs use `.num.big` (disp 30/800).
- Fill: `--canvas` **on a white surface** (modals/sheets). On the canvas app background (onboarding),
  inputs must be **white with a hairline border** so they're visible — never canvas-on-canvas.

### Cards & rows
- **Card** (`.card`): white, radius 20, padding 20, card shadow, `margin:0 16px 14px`.
- **List row** (`.row`): `padding:14px 18px`, `--divider` bottom border, `gap:14px`; icon/avatar +
  title/subtitle + right-aligned figure. Grouped rows live in a rounded white container.
- **Tappable row** adds `.tap` (cursor + `:active` `--canvas` bg) and a right chevron.

### Avatars (`.av`)
Circular, `--disp` 700 white initials on a per-person color (or gradient class). Sizes: hero, 44, sm.
Initials = first letters of the name, max 2, uppercased.

### Tags & badges
Small uppercase pills: `--brand-tint`/`--brand-ink` (info, "future"), `--good-tint`/`--good` ("today"),
`--danger`/`--amber` inline text for over-budget/over-pace (shown on a sub-line, never crammed on the title line).

### Overlays, modals, sheets, tab bar — see §4.

### Progress bar (onboarding)
Thin (3px) track `--divider`, brand fill, positioned **below the safe-area inset** (never under the
status bar). Shows from step 2 onward.

### Toast (`.toast`)
Dark pill, bottom-center, check icon, auto-dismiss ~2.4s. For lightweight confirmations.

### Empty states (`.mem-empty`)
Centered emoji + short title + one-line hint on a white rounded block. Always guide the next action.

### Photo / memory system
- **Mosaic** (`.photo-mosaic`): 6-col grid, dynamic collage by count (1 hero / 2 halves / 3 big+2 /
  4-up / 5+ hero+grid), tiny 2px gaps, rounded inset card, container-query sized so cells stay square.
- **Memory strip** (home): horizontal snap-scroll of 160×204 cards.
- Photos group by **date** (tab) and by **event** (date drill-in), iOS-Photos style.

---

## 4. Navigation & interaction patterns

**The four layers (pick the right one):**
| Layer | z-index | Use for | Dismiss |
|---|---|---|---|
| **Tab views** (`.view`) | base | The 4 primary tabs (Home / Spending / Events / Memories) | Tab bar |
| **Push overlay** (`.overlay`) | 45–49 | Read/drill-in detail that keeps context (category detail, event, memory, photos-by-date) | Back chevron (top-left), slides right |
| **Full-screen modal** (`.modal`) | 62 | **Create/edit forms** with several inputs (log expense, new event, add memory, suggest, settings/budget) and **long self-contained tasks holding unsaved state** (bulk photo assign). Nav bar = Cancel · Title · Save | Cancel, or **drag down**; rises from bottom |
| **Bottom sheet** (`.sheet`) | 60 | **Quick pickers / menus** (add menu, month, category filter, theme) | Tap scrim, or drag down; rises from bottom |

- **Form → modal. Quick pick → sheet.** Don't put a multi-field form in a sheet, and don't make a
  one-tap picker a full-screen modal.
- **Tab bar** (`.tabbar`): frosted (`backdrop-filter: blur`), `74px + safe-area-inset-bottom`, 4 tabs,
  brand for the active tab. **FAB** (`.fab`): brand gradient circle, bottom-right above the tab bar.
- **Drag-to-dismiss** (sheets + modals): axis-locked — only a downward, vertical-dominant drag from
  the top of the scroll dismisses; horizontal/upward gestures scroll normally. Past ~110–120px it
  closes, else snaps back; the scrim fades with the drag.
- **Contextual entry:** opening a detail can carry params (e.g. category detail preset to a category +
  month; "Log expense" from category detail prefills category + today's date).
- **Destructive confirm:** arm-then-confirm (see Buttons). Deleting a linked object cleans up its
  dependents (e.g. removing an expense's photos also removes its linked memory event).

### 4.0 Photo capture dates (EXIF)

`_compressImage()` redraws every upload on a `<canvas>`, and **canvas output carries no EXIF** — the
capture date is destroyed before the bytes reach storage, unrecoverably. So any new photo entry point
must read the date from the original `File` *before* compression:

- Use **`readPhoto(file, cb)`**, never a bare `FileReader`. It parses EXIF `DateTimeOriginal` off the
  original bytes, records it in `PHOTO_TAKEN` (data URI → `'YYYY-MM-DD'`), then hands back the data URI.
  Order is always **parse → compress → hold**.
- Persist it by passing `_takenOn(dataUri)` into the row's `taken_on` column.
- Treat the date as **naive local wall-clock**. `taken_on` and `transactions.txn_date` are both plain
  `date`, so they compare directly. Never build a `Date` and `toISOString()` it — in UTC+7 that shifts
  anything shot between midnight and 07:00 to the previous day.
- **Null means unknown.** Screenshots, chat-app saves and raw HEIC have no usable EXIF. Never fall back
  to `file.lastModified` — on iOS that is often the export time, so it looks authoritative while being
  wrong. Bucket unknowns separately and let the user place them.

Date matching **narrows, it does not resolve**: a normal day has several expenses and EXIF's capture
time has no counterpart on `txn_date`. UI must present candidates and let the tap decide — never
auto-assign.

### 4.1 Never use browser chrome

`alert()`, `confirm()` and `prompt()` are **banned** — they break the native illusion instantly,
ignore the theme, and escape the device frame on desktop. Every case has a house equivalent:

| Instead of | Use |
|---|---|
| `alert('failed: ' + e.message)` | `toast(_friendly(e))` — see §4.3 |
| `confirm('Delete X?')` | Arm-then-confirm on a low-prominence control, or a `_fhSheet` naming the consequences |
| `prompt('Name?')` | A form in `_fhModal` (Cancel · Title · Save) |

Dynamic UI built by the auth/data module uses `_fhSheet(html)` for quick menus and confirms, and
`_fhModal({title, body, valid, save})` for forms. Both mount **inside `.phone`**, so they stay in
the device frame, inherit drag-to-dismiss, and sit below the toast (z-80) — anything appended to
`document.body` above z-1 covers the whole browser window and hides its own error messages.

### 4.2 Async actions

Every async write shows progress and cannot be double-fired: disable the control, swap its label
(`Saving…`, `Deleting…`), and restore it on failure. `_fhModal`'s Save does this for you.
Long background work (photo upload) uses the `fhUploadBusy()` counter chip, not a toast.

**Never confirm success before the write lands.** A toast fired at modal-close time is a lie if the
request then fails — report from the completion handler.

### 4.3 Errors

- Writes go through `_w(query, label)`. supabase-js **resolves** `{data, error}` on 4xx, so a bare
  `await sb.from(x).update(...)` swallows RLS denials and reports false success.
- Users never see raw Postgres text. `_friendly(e)` maps errors to human sentences.
- Errors must be recoverable: keep the form open, keep their input, offer the retry.
- Offline is surfaced by the `#fh-offline` banner (`html.fh-offline`), because writes are optimistic.

---

## 5. Layout shell & PWA (native feel)

- The app lives in `.phone` = `position:fixed; inset:0` — **fills the screen edge-to-edge** on device
  (no dark letterbox); a centered device mockup only on desktop (`min-width:440px and pointer:fine`);
  always full-bleed when installed (`display-mode: standalone`).
- `html{ overflow:hidden; min-height:calc(100% + env(safe-area-inset-top)); -webkit-text-size-adjust:100% }`,
  `body{ height:100%; overflow:hidden }` — no rubber-band, no iOS text auto-inflation.
- **Safe areas everywhere:** top spacers use `env(safe-area-inset-top)`; bottom bars/CTAs pad
  `env(safe-area-inset-bottom)`. Never let a control sit under the notch or home indicator.
- Meta: `viewport-fit=cover, maximum-scale=1, user-scalable=no`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style=black-translucent`, manifest + service worker (network-first
  for the document, so edits ship on reload). **Bump `sw.js` `CACHE_NAME` on every change.**

---

## 6. Content & voice

- **Language:** English. Warm, concise, human ("Here's how the family's money looks today.",
  "You're all set!"). Second person. No jargon, no consultant-ese.
- **Money:** see §6.1 — never hand-format an amount.
- **Roles are relational and playful:** Mom, Dad, Husband, Wife, Boyfriend, Sweetheart, Partner,
  Son, Daughter, Kid, Teen, Guardian, Grandma/Grandpa, and fun ones (Coldheart, Man of steel…).
- **Empty states and nudges** always offer the next step, never a dead end.

### 6.1 Currency

The app is bi-currency (`CUR` = `'USD'` | `'VND'`, chosen in onboarding). **Never format an
amount by hand and never hardcode a symbol** — every rule below is already encoded in a helper.

| Helper | USD | VND | Use |
|---|---|---|---|
| `fmt(n)` | `$9,000` | `9.000.000 ₫` | Any amount shown as text |
| `fmtK(n)` | `$1.2k` | `4tr ₫` · `120k ₫` | Compact chart labels |
| `amtToInput(n)` | `9,000` | `9.000.000` | Base value → what an input shows (no symbol) |
| `parseAmtBase(s)` | `9000` | `9000` | What an input holds → the value we store |
| `amtPlaceholder()` | `9,000` | `9.000.000` | The only placeholder source for a money field |
| `snapAmtInput(el)` | — | rounds to 1,000đ | `onblur` on every money input |

**Symbol placement follows the locale: `$` prefixes, `₫` suffixes.** This holds in `fmt`, in
`fmtK`, and in the budget editor's input affix — an amount must never read `₫ 9.000.000` in one
place and `9.000.000 ₫` in another.

**Storage unit.** VND is stored in units of **1,000đ** (`curMult()` = 1000), so the display value
is 1,000× the stored one. Sub-1,000đ input can't be represented — `snapAmtInput()` therefore
rewrites the field on blur to the value that will actually be saved, so rounding is *visible*
rather than silently applied underneath the user.

**Grouping separators differ** (`vi-VN` dots, `en-US` commas). Always go through `amtPlaceholder()`
/ `amtToInput()`; a hardcoded `9,000,000` teaches VND users a format the field never produces.

**Layout.** VND figures are ~4 characters longer. `html.cur-vnd` scale-down rules exist for the
hero, overview, category rows, `.sum-num`, `.cd-sum-num` and `.cat-bud` — extend that block when
adding any new large figure rather than letting it clip. Every money figure carries `.num`
(or `font-variant-numeric: tabular-nums`) so digits don't jitter between renders.

Money inputs are `inputmode="numeric"` (never `type="number"` — the values are grouped strings).

---

## 7. Quick checklist for any new feature

- [ ] Right layer? (tab / overlay / modal / sheet — §4)
- [ ] Semantic color tokens only; one accent per view; no colored info-card fills.
- [ ] Type from the scale; `--disp` + tabular nums for money.
- [ ] 16px gutters, pill buttons, 13px input radius, soft layered shadows.
- [ ] Safe-area top **and** bottom; 44×44 targets; edge-to-edge on device.
- [ ] Primary CTA bottom-anchored; destructive is low-prominence + confirm.
- [ ] Forms are modals (Cancel · Title · Save, Save gated); pickers are sheets; both drag-to-dismiss.
- [ ] Hidden layers use `visibility:hidden`; scroll containers don't clip shadows.
- [ ] Bumped `sw.js` `CACHE_NAME`.
- [ ] Copy is warm, concise, English; empty states guide the next action.
- [ ] No `alert` / `confirm` / `prompt`; no raw hex (tokens only, so all 5 themes apply).
- [ ] Money via §6.1 helpers; `inputmode="numeric"` + `onblur="snapAmtInput(this)"`.
- [ ] Writes wrapped in `_w()`; success reported only after the write lands.
- [ ] User-authored text escaped with `esc()` / `escAttr()` before it enters HTML or an `onclick`.
