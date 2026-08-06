# FamilyHub — Key Card authentication (spec + migration plan)

Status: **proposal, not built.** Supersedes the 6-digit passcode as the "safe key."
Author handoff doc — read alongside `project_familyhub_e2ee` memory and migrations
`0030`/`0032`/`0033`/`0035`/`0038`.

---

## 0. One-paragraph summary

Split the family's two secrets cleanly: the **door** (who is in the family) becomes
**a whitelisted Google account, nothing typed**; the **safe** (who can read the
encrypted data) becomes **a randomly-generated 128-bit Key Card**, not a 6-digit
code. The card is the new *input* to the existing key-derivation — the DEK, the
AES-GCM envelope, and every `enc_state` machine (dual/enc, scrub, triggers) are
**unchanged**. Because the card is 128-bit random, brute-forcing the stored wrap is
impossible even for us, which is the whole point. The card is **introduced
proactively** — a short What/Why/How screen at onboarding for new users and on return
for current users (§7.0), because it is the product's strongest selling point — and
handed to new members as text / QR / link / printed card. Migration of the current live
family reuses the existing "change passcode" machinery: an unlocked device re-wraps
the same DEK under a card-derived key, so **nothing re-encrypts and no data moves.**

---

## 1. Why (recap of the decision trail)

- The 6-digit passcode has ~20 bits of entropy: one GPU grinds all 10⁶ codes through
  our KDF in ~30s **offline**. Online rate-limiting (already live, `passcode_attempts`)
  cannot touch an offline attacker who holds `wrapped_dek` — and we, the operator,
  hold it. So "even we can't read it" is a *policy* truth today, not a *math* truth.
- Only entropy fixes offline grinding. A 128-bit random card makes the search space
  2¹²⁸ — done, unconditionally, for every family including careless ones (unlike a
  human-invented passphrase, whose strength is only as good as the family's choice).
- Base32 card (ASCII) also **eliminates the Vietnamese NFC-normalization hazard** a
  passphrase would have introduced (mèo in NFC vs NFD → different bytes → false
  "wrong key").
- Splitting door/safe means joining needs **no typing** (scan/tap), and the entire
  wrong-code + lockout apparatus can retire.

Trade accepted: the card must **outlive every copy of the app**. Memory alone no
longer recovers a family that loses all devices — the same property that today lets a
family recover from nothing is the property that lets us grind their data. This design
chooses the family over us and pays for it with a card ceremony.

---

## 2. The Key Card

### 2.1 Format

```
FH-K7MR4-WPD9T-XAQ2-H8E5-CN6Z-YBVG
```

- `FH-` prefix: self-identifying ("what is this string"), and a version marker
  (`FH2-` if the encoding ever changes).
- **128 bits** of `crypto.getRandomValues`, encoded **Crockford Base32** (uppercase,
  no `O/0`, `I/L/1`, `U` — survives handwriting, phone lines, reading glasses).
- Grouped 4–5 chars with dashes for copy-accuracy and read-aloud pacing.
- **Last group is a checksum** (e.g. CRC of the payload, Base32-encoded) → a typo is
  caught the instant entry finishes ("hình như sai một ký tự ở nhóm thứ 3"), never a
  mysterious "không mở được" that reads as data loss.
- Entry is forgiving: accepts lowercase, ignores dashes/spaces, auto-groups as typed,
  accepts a full paste.

### 2.2 Card as a URL (three delivery forms, one artifact)

The card is offered to users in **three interchangeable forms — text, QR, and URL/link**
(plus print and save-file as containers for them). All three encode the same 128-bit
value; the URL is the canonical carrier the QR and the share-link both wrap.

```
https://fhtest-opal.vercel.app/#fh-key=FH-K7MR4-WPD9T-XAQ2-H8E5-CN6Z-YBVG
```

- **Key lives in the `#fragment`, never a `?query`** — fragments are not sent to
  Vercel, not logged server-side, not in referrer headers. Non-negotiable.
- **Eat-on-arrival**: import → `history.replaceState` to strip it from the URL bar,
  history, and share sheet. One line, mandatory.
- The QR encodes this same URL, so OS camera apps handle scanning — no in-app scanner.
- **Sao chép link** puts this URL on the clipboard for the user to send through any
  channel (custody caveat, §7.3): the link carries the *safe* key, but the *door* is
  still the Gmail whitelist, so a leaked link alone opens nothing.
- **Do NOT embed the family id or name in the QR/link** (a photographed QR would then
  identify the family — OQ4 resolved: no). The invitee's own session resolves the family.

### 2.3 What the printed card shows

```
🏠 FamilyHub — Thẻ khóa của nhà
    FH-K7MR4-WPD9T-XAQ2-H8E5-CN6Z-YBVG
    [QR]
Tạo ngày 06/08/2026
Đây là chìa khóa duy nhất mở dữ liệu của nhà mình.
Mất thẻ và mất hết điện thoại là mất dữ liệu, không ai cứu được.
In hai bản. Giữ như giữ sổ đỏ.
```

No family name / email on the card — a found card should be an anonymous key, not a
signpost to whose data it opens.

---

## 3. Cryptographic design (the small-change headline)

The card **replaces the passcode as the input to `FHCrypto.deriveKeys`**. Everything
downstream is identical.

```
card string ──PBKDF2──HKDF──▶ K_wrap (device-only; unwraps the DEK)
                                DEK (unchanged) ──AES-GCM──▶ every _enc value & photo
```

- `FHCrypto.deriveKeys(secret, salt, iters, version)` takes the **card string** where
  it used to take the passcode. **No signature change.**
- Because the input is now 128-bit random, `K_auth`/`auth_hash` (the "prove you know
  the code to the server" half) is **no longer needed for the door** — the door is the
  Gmail whitelist. It is dropped from the core flow. (Retain-for-gated-release is
  Open Question 2; not required, since a 2¹²⁸ wrap is ungrindable even if handed out.)
- PBKDF2 iterations become nearly irrelevant against a random card, but keep a sane
  value (600k) as free defense-in-depth; harmless.
- **Offline unlock is preserved**: a device with the saved card can unwrap without a
  network round trip. (This is why we do NOT need Lever C / gated release here.)
- The DEK, `wrapped_dek` envelope shape `b64(iv‖ct)`, all `_enc` columns, `fhField`/
  `fhRead`, the 0033/0038/0039 triggers, scrub, and `enc_state` transitions are
  **untouched**. This feature is an *auth* change, not an *encryption* change.

---

## 4. Data model

### 4.1 New: `family_key_wraps` (multi-custodian, enables non-destructive migration)

Today `family_keys` holds a single `wrapped_dek` + kdf params + `auth_hash`. Replace
that single slot with a table of wraps so **card and legacy-passcode wraps can coexist
during migration** (and so future custodians — passkey, per-device — slot in cleanly).

```sql
create table family_key_wraps (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  kind         text not null check (kind in ('passcode','card','passkey')),
  kdf_salt     text not null,
  kdf_iters    int  not null,
  kdf_version  int  not null,
  wrapped_dek  text not null,          -- b64(iv‖AES-GCM(K_wrap, DEK))
  label        text,                   -- optional human note ("thẻ tạo 06/08")
  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,            -- set when superseded; null = live
  unique (family_id, kind) where rotated_at is null  -- one live wrap per kind
);
alter table family_key_wraps enable row level security;
create policy fkw_select on family_key_wraps for select
  using (family_id = (select auth_family_id()));      -- members may read (wrap is ungrindable)
-- all writes via SECURITY DEFINER RPCs; no write policy
```

- `family_keys` keeps `enc_state`, `join_mode`, and kdf params of record; the
  `wrapped_dek`/`auth_hash` columns become **legacy/nullable** (read by old builds
  only). New builds read wraps from `family_key_wraps`.
- Members may `select` wraps — a 2¹²⁸ wrap is safe to expose to a joined member; they
  still can't unwrap without the card. (If Open Question 2 chooses gated release, move
  this behind an RPC instead.)

### 4.2 `get_family_snapshot`

Add a `key_wraps` key returning the family's live wraps (id, kind, kdf_*, wrapped_dek).
Client picks `kind='card'` (falls back to `'passcode'` for a not-yet-migrated family).

---

## 5. Server RPCs

| RPC | Change |
|---|---|
| `set_family_passcode` | **Deprecated for new families.** Replaced by `set_family_card` (below). Kept callable only for rollback. |
| `set_family_card(p_kind, p_kdf_salt, p_iters, p_version, p_wrapped_dek)` | **New.** Owner-only. Inserts a live wrap of the given kind. Used at creation and by migration. Guarded: requires an existing DEK context (family already has `enc_state != off` or is being created enc-by-default). |
| `rotate_family_card(p_new_wrapped_dek, p_new_salt, ...)` | **New.** Owner-only (or any keyed member — decide in OQ3). Marks the current `card` wrap `rotated_at=now()`, inserts a fresh one. Same DEK, so nothing re-encrypts. This is card *regeneration*. |
| `change_family_passcode` | Repurposed / superseded by `rotate_family_card`; keep as the migration primitive (it already re-wraps the same DEK). |
| `join_with_passcode` | **Retired.** The door is now the whitelist + Google SSO; there is no card-proof to the server. |
| `whitelist_add/remove/list`, `find_my_invite`, `accept_invitation` | **Unchanged** — this is the door, and it stays. |
| `mark_key_unlocked` | Unchanged (roster telemetry). |
| `_fh_passcode_gate` / `passcode_attempts` | **Retired** (no server-side secret to throttle). Table can be dropped in a later cleanup migration. |

---

## 6. Client changes by file

- `15-crypto.js` — `deriveKeys` input becomes the card; add `genCard()` (128-bit →
  Crockford Base32 + checksum), `parseCard()` (normalize, validate checksum),
  `cardToUrl()` / `parseKeyFragment()`. IndexedDB DEK cache (`fh-keys`) unchanged.
- `65-passcode-ui.js` → rename concept to **card UI**: replace the 6-digit `_pcField`
  set-passcode / change / unlock modals with card-set (generate + confirm), card-enter
  (paste/scan/type with live checksum feedback), and the regenerate flow. Keep the lock
  bar; its copy changes to "nhập thẻ khóa" / "quét thẻ".
- `66-enc-ui.js` — the enable/scrub lifecycle is unchanged; the **card display + backup
  nudge** live here (or a new `67-card-ui.js`). Card view = text + QR + In/Lưu/Chia sẻ.
- `30-hydrate.js` — read `snap.key_wraps`; on a card family, load the DEK from the
  cached IndexedDB key exactly as today (no change once unlocked).
- `80-onboard-boot.js` / onboarding — **remove the mandatory passcode screen**;
  generate the card silently after `create_family`.
- **New landing handler** for `#fh-key=` (in `10-client-auth.js` boot): detect fragment
  → if running as installed PWA, import + `replaceState`; if in a browser tab that is
  NOT the installed app (iOS Safari case), show the handoff screen (§7.3).
- `55-push.js` — unaffected (actor name already client-supplied for enc families).

---

## 7. UX flows (the user steps)

### 7.0 The introduction screen (proactive — the USP moment)

**Decision (2026-08-06): the card is introduced PROACTIVELY, not generated silently.**
The card is the product's strongest unique selling point, so it is surfaced with a
short, strong What/Why/How screen — to **new users at onboarding** and to **current
users on return** (the migration moment). Reversal of the earlier "silent + nudge"
plan; the friction is accepted because the security *is* the pitch, and the honest
"lose it = gone" line is reframed as the proof of "nobody else can read it."

Shared component, five delivery actions on the save step: **QR · Sao chép chữ (copy
text) · Sao chép link (copy URL, §2.2) · In (print) · Lưu file**. Copy in Appendix A.

The action behind the screen differs by context:
- New family, owner → generate card, save.
- New member joining → receive + save the owner's card.
- Current family, owner returning → generate card (migration re-wrap, §8), save, share.
- Current family, member returning → receive + save the owner's card (or, if the owner
  hasn't migrated yet, show the pitch and defer the save with a standing reminder).

### 7.1 Create a family (owner)

1. Sign in with Google.
2. Onboarding: name / currency / budget.
3. **Introduction screen (§7.0)** — card generated on-device (family is enc-by-default,
   0032), shown with What/Why/How + the five save actions. "Để sau" is allowed but nags.
4. In, unlocked.

→ One added screen vs today's flow, and it *replaces* the "invent a 6-digit code" screen
rather than adding to it — so the step count is unchanged, the content is stronger.

### 7.2 Backup fallback (for anyone who tapped "Để sau")

The intro screen is the primary save moment. The old first-photo nudge survives only as
a **fallback** for a user who deferred: a standing Settings badge + a soft re-prompt at
first real value (first photo / end of first logging session), and a **hard prompt at
first invite** (you cannot hand the family a card you never saved). Not the main path
anymore — just the safety net under "Để sau."

### 7.3 Invite (owner) + Join (invitee)

**Owner:** Settings → add invitee's Gmail to whitelist → give the card:
- **In person:** show the card QR from any unlocked device; invitee scans.
- **Remote:** "Chia sẻ thẻ khóa" → send the `#fh-key=` link (custody caveat: the chat
  now holds the safe key; the door still protects the data).
- **Paper:** hand a printed card.

**Invitee — Android / desktop:**
1. Tap link / scan QR.
2. Sign in with Google (door). Key imports from the fragment. **In.** No typing.

**Invitee — iPhone (the honest wart):**
1. Tap link / scan QR → opens in **Safari** (separate storage from the installed PWA).
2. Landing page: "Thêm FamilyHub vào Màn hình chính trước nha" + big **Sao chép thẻ
   khóa** button (or renders the QR for a second phone).
3. Open the installed app → sign in → **Dán thẻ khóa** → in.

→ Android/desktop is *easier* than typing 6 digits; iPhone costs one copy-paste hop
(the same class of wart iOS already imposes on the current passcode join).

### 7.4 Re-logging into the family

| Case | Steps |
|---|---|
| Same device, signed out | Sign in with Google → in. **Key still cached; no card.** Identical to today. |
| New device / deleted PWA / iOS evicted storage | Sign in → provide the card (paste saved file / scan another family phone's QR / type from paper) → in. **Memory alone no longer suffices.** |
| Every device wiped at once | Card required. No card anywhere = data gone, by design. |

### 7.5 Regenerate the card (lost / leaked / member left)

Any **unlocked** device (holds the DEK): Settings → "Tạo lại thẻ khóa" → `rotate_family_card`
re-wraps the same DEK under a fresh card, marks the old wrap rotated. Old card stops
working instantly. Ten seconds. Then re-distribute the new card to members' future
devices (their currently-unlocked devices keep working on the cached DEK).

---

## 8. Migration plan

### 8.1 The live family (6-digit → card), non-destructive

Precondition: the owner has an **unlocked** device (holds the raw DEK). This is the
same precondition as `change_family_passcode` today.

1. **Deploy the new client build first** (card-capable, but still able to read a
   `passcode`-kind wrap). Old builds must not meet a card-only family.
2. Apply the schema migration: create `family_key_wraps`, **seed it** from the existing
   `family_keys` row as a `kind='passcode'` wrap (so nothing breaks mid-migration).
3. Owner opens Settings → "Nâng cấp thẻ khóa". On the unlocked device:
   - `genCard()` → derive K_wrap → re-wrap the **same DEK** → `set_family_card('card', …)`.
   - Both wraps now live: `passcode` (legacy) + `card` (new). Any device can still
     unlock by either path during the window.
4. Owner saves/distributes the new card (§7.3). Existing members' unlocked devices keep
   working untouched; they're nudged to save the card for their next device.
5. **Cleanup migration (later, after confidence):** `rotate_family_card` the passcode
   wrap out (or a one-line migration marking `kind='passcode'` wraps `rotated_at`), and
   drop `passcode_attempts` / retire `join_with_passcode`. Reversible until this step.

**Nothing re-encrypts. The DEK never changes. Data never moves.** This is a re-wrap of
32 bytes, exactly like a passcode change.

### 8.2 Rollout ordering (strict)

1. Client build with card support + fragment landing handler → Vercel, verify live, SW
   bump.
2. Schema migration (`family_key_wraps` + seed) via MCP.
3. `set_family_card` / `rotate_family_card` RPCs deployed.
4. Owner-driven migration of the live family (step 8.1.3).
5. Cleanup migration only after the family is confirmed happy on the card.

Same "client-before-trigger" discipline as the 0038 rollout.

### 8.3 New families during/after rollout

0032 default-enc onboarding calls `set_family_card` instead of `set_family_passcode`.
Born card-only; no passcode wrap ever exists for them.

---

## 9. Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | **Old app build meets a card-only family** | Old build tries the passcode path, fails. Reuse the existing `enc_required` self-heal: SW `reg.update()` → reload into new build → card prompt. Keep a `passcode` wrap live until all devices are known-updated to shrink this window. |
| 2 | **Solo owner loses only device before backup nudge acted on** | The uninsured window. Value-triggered nudge (§7.2) is the mitigation; if dismissed and device lost → data gone (warned). This is the single worst regression vs today — weigh in OQ1. |
| 3 | **PWA deleted / iOS storage eviction** | Device loses cached DEK → treated as a new device (§7.4 row 2). **iOS can trigger this with no user action** — the card must be reachable (saved file / another device / paper). Strongest argument for the passkey follow-up (§12). |
| 4 | **All devices wiped simultaneously** | Card required; no card = gone, by design. |
| 5 | **Card lost, devices fine** | Regenerate (§7.5). |
| 6 | **Card leaked (chat backup, found paper)** | Regenerate + review whitelist. A leaked card **alone** opens nothing: reading data needs the `wrapped_dek`, which needs a joined (whitelisted-Google) session via RLS. Leak = breach only if paired with a compromised family Google account. |
| 7 | **Member removed / leaves** | Regenerate the card so their copy is dead for *future* devices. **Honest limit:** their currently-unlocked device already holds the raw DEK; card rotation does **not** re-key existing data, so a departed member who copied the DEK (or the plaintext they already saw) keeps what they had. True re-keying = re-encrypt everything under a new DEK, which `enc` being terminal (0035) does not support and which is out of scope. Document, don't pretend. |
| 8 | **QR/link opened in iOS Safari, not the PWA** | Handoff screen (§7.3 iPhone): copy card → paste in app. |
| 9 | **Link intercepted in transit** | Fragment-only + eat-on-arrival limit exposure; door still gated by Gmail; regeneration is the cleanup. |
| 10 | **Diacritics / encoding** | N/A — Base32 ASCII card removes the NFC hazard a passphrase would have had. |
| 11 | **Manual-entry typo** | Checksum group catches it at entry time with a specific message. |
| 12 | **Regeneration race / stale card** | `rotate_family_card` is last-write-wins on the live `card` wrap. A device using a rotated card fails AES-GCM unwrap → prompts for the current card. No corruption (DEK unchanged). |
| 13 | **Multi-family user** | One card per family; DEK cache already keyed by `fid`. Card view + entry are per-family. |
| 14 | **Family with `enc_state='off'` / no DEK** | No DEK to wrap → no card until encryption is enabled. Enabling encryption generates the card. (Theoretical — 0032 makes new families enc; the live family is enc.) |
| 15 | **Concurrent owner + member both regenerating** | `unique(family_id, kind) where rotated_at is null` prevents two live card wraps; second write conflicts → client re-reads and retries. |
| 16 | **Export/backup interplay** | Excel/JSON export decrypts on-device with the cached DEK — independent of the card mechanism, unchanged. |
| 17 | **Offline join** | Card import + Google SSO: SSO needs network (unchanged today); the card half is offline-capable. |

---

## 10. What retires

**Decision (2026-08-06): the passcode is retired ENTIRELY.** An optional per-device
"app lock" (reusing the passcode as a local device-theft gate) was considered and
**rejected** — it would either drag a low-entropy secret back onto the server (throttle
+ `auth_hash`, re-muddying the "only the ungrindable card lives on our server" story)
or add local-only machinery for a nicety users get by convention. The card is the one
secret; there is no passcode of any kind after this ships.

- 6-digit passcode UI (set / change / unlock modals) → **removed**, replaced by card UI.
- `passcode_attempts` throttle + `_fh_passcode_gate` → **dropped** (no server secret to guess).
- `join_with_passcode` → **dropped** (door is whitelist + SSO).
- `K_auth` / `family_keys.auth_hash` → **dropped** from the core path (OQ2 resolved: not gated).
- The mandatory onboarding passcode screen → **removed**.

Kept, unchanged: the whitelist door, `enc_state` machine, DEK envelope, all `_enc`
columns and triggers, scrub, `fhField`/`fhRead`, photo `.enc` pipeline, push.

---

## 11. Decisions (resolved 2026-08-06)

1. **Solo-owner uninsured window (§9.2)** — resolved by the **proactive intro screen
   (§7.0)**: the card is presented and saved up front, not silently generated. The
   first-photo nudge + hard-prompt-at-first-invite survive only as the fallback for a
   user who taps "Để sau" (§7.2). The intro doubles as the USP moment.
2. **Gated key release (Lever C)** — **not gated.** A 2¹²⁸ card is ungrindable even if
   the wrap is handed to any member; keep offline unlock, no proof RPC. `auth_hash`
   dropped entirely (§10).
3. **Who may regenerate the card** — **any keyed member** (friendlier for the lost-phone
   case; an unlocked device already holds the DEK, so no privilege is gained).
4. **QR embeds family id?** — **no.** The invitee's own session resolves the family; a
   photographed QR must not identify whose data it opens.
5. **Passcode** — **retired entirely** (§10); no app-lock feature.
6. **Cleanup timing (open)** — how long to keep the legacy `passcode` wrap live in Phase
   C before Phase D drops it (rollback safety vs surface). Proposed: through one full
   confirmed session on the card, owner's judgment.

---

## 12. Follow-up: the passkey evolution (not this phase)

Store the 128-bit card in a **passkey (WebAuthn PRF)** synced by iCloud Keychain /
Google Password Manager — both themselves E2EE. Then: sign in with Google, and the safe
key rides the platform keychain silently. This **erases the reinstall/eviction
regression (§9.3)** and demotes the printed card to a break-glass backup. It is the true
endgame UX (your original "Gmail to join, secret silent" instinct, fully realized). Real
engineering + browser-support homework (esp. installed-PWA-on-iOS PRF support) — ship the
card first, evolve into the passkey. Gate on a feasibility spike before committing.

---

## 13. Build phases & test checklist

Discipline every phase: client-before-any-rejecting-schema; `node build.js` byte-clean +
`node --check`; bump `sw.js` `CACHE_NAME` against `origin/main` max; rehearse each
migration on a throwaway family (simulated-JWT pattern from the 0030 rehearsal) before
the live family; advisor scan after each DDL; no push until asked.

| Phase | What | Prod? | Est. | Risk |
|---|---|---|---|---|
| **0 Harness** | Throwaway-family rehearsal rig + DEK-byte-identity assertion | no | ½ d | none |
| **A Card core** | `genCard`/`parseCard`/checksum + `#fh-key=` landing + iOS handoff; `deriveKeys` input swap; migration `0042_family_key_wraps` + `set_family_card`/`rotate_family_card`; card set/enter/regenerate UI (`67-card-ui.js`); all behind a dormant flag | yes (inert) | 3–4 d | low |
| **B Onboarding + nudge** | Remove onboarding passcode screen, silent `genCard` on create; value-triggered backup nudge + hard prompt at first invite; invite sheet gains "give the card" | yes | 2 d | medium |
| **C Migrate live family** | `0043_seed_passcode_wrap` (seed wraps from `family_keys`); owner "Nâng cấp thẻ khóa" re-wraps same DEK; dual-wrap window (both unlock) | yes | ½ d | **the careful one — non-destructive + reversible** |
| **D Retire passcode** | `0044_retire_passcode`: rotate out passcode wraps, drop `passcode_attempts`/`_fh_passcode_gate`/`join_with_passcode`, null legacy `family_keys` crypto cols; remove passcode UI. No app-lock. | yes | 1 d | low |
| **E Passkey (later)** | §12 — feasibility spike on installed-iOS-PWA WebAuthn PRF first | later | spike | — |

Roughly 1.5 weeks to end of D; Phase C is the only moment real data is touched, and even
then it is a 32-byte re-wrap, not a data operation.

**Test matrix** (throwaway family): create → silent card → nudge fires on first photo →
invite (in-person QR / remote link / iOS handoff) → join with no typing → reinstall PWA →
card re-entry → regenerate → old card dies → all-devices-wiped = card recovers →
leaked-card-alone opens nothing → **confirm DEK byte-identical before/after migration
(zero re-encryption)** → old build meets card family = graceful self-heal, no data loss.

---

## Appendix A — Introduction screen copy

Voice rules: warm Vietnamese with full diacritics + calm English, no em-dashes, no
semicolons, no marketing gloss (see `DESIGN.md` / release-notes banned list). The
"lose it = gone" line is deliberately kept and reframed as the proof of the promise —
it is the strongest trust statement, not a warning to soften.

### A.1 New user (onboarding) / any member receiving the card

> **Thẻ khóa của nhà mình** · *Your family's Key Card*
>
> Mọi thứ nhà mình ghi lại, từ tiền nong, hình ảnh tới tên gọi, đều được khóa bằng tấm thẻ này.
> *Everything your family logs, money, photos, names, is locked with this one card.*
>
> Máy chủ chỉ giữ bản đã khóa. Không ai mở được nếu không có thẻ, kể cả tụi mình làm ra app.
> *Our server only keeps the locked copy. Without the card nobody can open it, not even us who built the app.*
>
> Giữ thẻ kỹ nha. Mất thẻ và mất hết điện thoại là mất luôn dữ liệu, không ai lấy lại được. Đó cũng chính là lý do không ai ngoài nhà mình đọc được.
> *Keep it safe. Lose the card and all your phones and the data is gone for good, nobody can bring it back. That is exactly why nobody outside your family can read it.*
>
> **[ Lưu thẻ khóa / Save the Key Card ]** → QR · Sao chép chữ · Sao chép link · In · Lưu file
> [ Để sau / Later ]

### A.2 Returning current user (the migration moment)

> **Nhà mình vừa có một tấm thẻ khóa riêng** · *Your family just got its own Key Card*
>
> Trước giờ tiền nong đã được khóa. Giờ có một tấm thẻ khóa mạnh hơn nhiều, khóa hết mọi thứ và không ai bẻ được, kể cả tụi mình.
> *Your money was already locked. Now there's a much stronger card that locks everything, one nobody can break, us included.*
>
> (owner) Bấm để tạo thẻ khóa của nhà rồi đưa cho người thân.
> *(owner) Tap to create your family's card, then pass it to your family.*
>
> (member) [tên] vừa tạo thẻ khóa cho nhà. Nhận và lưu lại để dùng cho máy mới sau này.
> *(member) [name] just made the family's card. Get it and save it for your next device.*

Verify copy before shipping (scan `t`/`problem`/`sol`-style fields only) against the
release-notes banned-phrase list; read each line aloud once so none reads templated.
