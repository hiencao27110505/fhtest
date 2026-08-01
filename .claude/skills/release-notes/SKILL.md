---
name: familyhub-release-notes
description: Update the FamilyHub in-app "What's new" release notes from the latest deploys. Triggers on "update release notes", "release note", "what's new", "cập nhật release note", "ghi chú phát hành", or any request to refresh the FamilyHub changelog after shipping features. Reads git history since the last note, selects only user-facing changes, drafts problem-first bilingual (VN+EN) entries, applies them to src/js-ui/90-release-notes.js, rebuilds, and bumps the service worker. Stops before pushing.
---

# FamilyHub — Update Release Notes

Refresh the in-app **"What's new"** feature with the newest user-facing changes. Run this
after shipping features, whenever the user triggers it. Mode: **fully automatic apply** — no
approval gate before writing — but **prepare only**: never push. Report what you did and offer
to deploy.

Work inside the FamilyHub repo: `~/Documents/ClaudeHC/familyhub`.

## Core principle — releases ≠ deploys

The `RELEASES` list is curated, NOT a commit dump. Deploys land all day from several people;
most commits are fixes/refactors/wip and must be **excluded**. A note exists only for a change
worth telling a *family* about. Be ruthlessly selective and cluster related commits into one note.

## Steps

### 1. Find the watermark
Open `src/js-ui/90-release-notes.js`. The newest entry is `RELEASES[0]`; its `date` is the
watermark. Note every existing entry's title so you can dedupe by feature (not by commit).

### 2. Gather candidate changes
```
git -C ~/Documents/ClaudeHC/familyhub log --since="<watermark date>" --no-merges \
  --pretty=format:"%ad | %h | %s" --date=short
```
If nothing is newer than the watermark, tell the user there's nothing to add and stop.

### 3. Select + cluster (judgment — this is the point of the skill)
From the candidates keep ONLY changes a family would notice and care about. **Exclude**: bug
fixes, perf, refactors, layout/HIG tweaks, "wip", build/deploy plumbing, anything internal.
**Cluster** several commits about the same feature into a single note. Skip anything already
represented by an existing `RELEASES` entry. If the meaningful changes are few, a short list is
correct — do not pad. If genuinely nothing is user-facing, say so and stop.

### 4. Draft each entry — match the shape exactly
Prepend to the `RELEASES` array (newest first). Shape:
```js
{ id:'YYYY-MM-DD-slug', date:'YYYY-MM-DD', time:'HH:MM', ver:'vNNN', icon:ICO.<key>,
  vi:{ t:'…', problem:'…', sol:'…' },
  en:{ t:'…', problem:'…', sol:'…' } },
```
- **`id`**: date-prefixed, unique, sortable (newest at top). Use the deploy date.
- **`date` / `time`**: the real deploy date and 24h time. Pull them from the feature's commit:
  `git log -1 --date=format:'%Y-%m-%d %H:%M' --format='%ad' <sha>`. Never invent a time.
- **`ver`**: the SW build the change shipped in. For a NEW note this is the version you are about
  to bump the SW to in step 6 (e.g. `v235`). For a backfill, read it from git at that commit:
  `git grep -h -oE "familyhub-v[0-9]+" <sha> -- sw.js`.
- **`icon`**: reuse a key from the `ICO` map at the top of the file (heart, calendar, timeline,
  sun, house, globe, pie, camera, grid, envelope). If none fits, add a NEW stroked SVG glyph to
  `ICO` — single-color paths, `viewBox 0 0 24 24`, SF-Symbol-like. **Never** an emoji as the icon.
- **`t`** (title): the feature, headline voice. VN with full diacritics; EN clear.
- **`problem`**: the pain in the **user's own POV** — what wasn't working / was annoying, before.
- **`sol`**: what changed now. `problem` + `sol` render as ONE paragraph.

### 5. Copywriting rule — write like a person, not a changelog robot
The single most important thing: the copy must NOT read as AI-generated. Each note should sound
like one of the founders typing a quick line to their family. This is a rule, not optional polish.

**Mechanics (hard):**
- No em-dashes (—) or en-dashes (–) anywhere. This app deliberately removed them. Use a comma, a
  full stop, or two sentences.
- No semicolons in the prose. No ellipses (…). No exclamation-mark hype.
- One or two short sentences per description.
- Do not reuse the same "Vấn đề. Giờ giải pháp." skeleton on every note. Vary how each one opens
  and where the "now" lands, so ten notes do not read like one mail-merge.

**Banned phrases — English** (marketing / AI tells, never use):
seamless, effortless(ly), delight(ful), elevate, unlock, empower, streamline, supercharge, revamp,
"at a glance", "with just a tap / one tap" as filler, "say goodbye to", "we're excited/thrilled to",
"introducing", "take X to the next level", "game changer", "a whole new way to", "and all", "no more X".

**Banned phrases — Vietnamese** (translated / corporate tells, never use):
"trải nghiệm liền mạch", "liền mạch", "tối ưu (hoá)", "nâng tầm", "giải pháp toàn diện",
"một cách dễ dàng", "dễ dàng hơn bao giờ hết", "giờ đây bạn có thể", "chúng tôi rất vui / hân hạnh",
"đơn giản hoá", "mượt mà" (as gloss), "cải tiến vượt trội".

**Write instead:** warm, casual, family-texting Vietnamese with full diacritics ("tụi mình",
"nhà mình", "cho gọn", "kể tụi mình nghe"); plain, calm English. State the concrete before/after in
ordinary words.

**Good vs bad:**
- Bad VI: "Giờ đây bạn có thể dễ dàng theo dõi chi tiêu một cách liền mạch."
- Good VI: "Trước hơi khó nhìn ra tháng này tiền chia cho những khoản nào. Giờ có vòng phân bổ cho thấy từng nhóm."
- Bad EN: "Introducing a seamless new way to react to spending, delightful and effortless!"
- Good EN: "Before, when someone spent money the rest of you could only look at it. Now you can drop a heart on it and they see it right away."

**Verify before applying** — scan only the copy fields (`t` / `problem` / `sol`), not the code,
so semicolons and dashes are caught in the prose alone. Zero matches required:
```
grep -nE "(t|problem|sol):'" src/js-ui/90-release-notes.js \
  | grep -E "—|–|;|seamless|effortless|delight|elevate|unlock|empower|streamline|at a glance|liền mạch|tối ưu|nâng tầm|giờ đây bạn có thể|chúng tôi rất|một cách dễ dàng"
```
If anything matches, rewrite that note. Then read the descriptions aloud once; if any sounds like a
template, rewrite it too. (If you happen to have the momo `feedback_ai_tell_phrases` table on hand,
apply it as an extra pass, but this skill does not depend on it.)

The panel shows `date · time · ver` under each title, a "You're on version vNNN" line (the running
build, injected into the app by `build.js` from `sw.js`), and a prompt that opens the feedback
modal. You only edit `RELEASES`/`ICO`; that chrome is already wired.

### 6. Apply, build, bump SW
1. Edit `src/js-ui/90-release-notes.js` (the source — never hand-edit `index.html`).
2. `node ~/Documents/ClaudeHC/familyhub/build.js` (regenerates `index.html`).
3. `node --check src/js-ui/90-release-notes.js` to confirm valid JS.
4. Bump the service worker, collision-safe against co-founder pushes:
   ```
   git -C ~/Documents/ClaudeHC/familyhub fetch --quiet
   git -C ~/Documents/ClaudeHC/familyhub show origin/main:sw.js | grep "CACHE_NAME ="
   ```
   Set `sw.js` `CACHE_NAME` to `familyhub-v<N+1>` where N is the **max** of the local and
   `origin/main` versions. Without the bump the PWA serves the stale cached build.

### 7. Report + offer to deploy — do NOT push
Show the user a compact summary of the notes you added (title + a line each) and the new SW
version. Then ask whether to commit + push to `main` (which deploys via Vercel). Only push if
they say yes; commit message co-authored per the repo convention, then
`git -C ~/Documents/ClaudeHC/familyhub push origin main`.

## Notes
- Design reference: the "What's New" section of `DESIGN.md`. The panel follows Apple's HIG
  "What's New" pattern — tinted line glyph + headline + one prose description, generous spacing,
  single accent, no cards/badges.
- Surfacing logic (auto-open once, unread dot, seen-tracking) already lives in the module — you
  only ever touch the `RELEASES` array and, if needed, `ICO`.
- If the user asked for fully-hands-off end-to-end (including push), confirm once, then also do
  step 7's push.
