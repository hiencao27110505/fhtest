# Sealed staging — design reference

How the bank-email pipeline stores transaction data without any server ever being
able to read it, and exactly where that promise starts and stops.

Written to be read cold. If you are picking this up months later, or you are the
other Claude session, this file plus `pipeline/README.md` should be enough to work
from without reconstructing anything from chat history.

**Status legend used throughout:** ✅ built and live · 🟡 decided, not built ·
⛔ rejected, with reasons kept so it isn't re-litigated

---

## 1. The promise, stated precisely

The product promise is *"no one but you can see your data."* The honest version of
that claim, for this pipeline specifically:

> Blocked for database attackers. Detected for operator attackers. Bounded by
> code-serving trust.

Unpacked:

- A stolen `service_role` key, a Supabase breach, or a subpoena of stored data
  yields ciphertext and routing metadata. Nothing readable. *(Once §4 ships.)*
- An operator (us) who swaps a key to intercept future rows can do so — but
  cannot do it silently; see §6.
- Everything ultimately rests on the client JavaScript we serve behaving. This is
  the irreducible ceiling of web-delivered E2EE (Signal mitigates it with signed
  store-distributed builds; a web app structurally cannot). Documented, not solved.

Anything stronger than the wording above is overclaiming. Use that wording.

---

## 2. Two lock systems, one wall

The whole architecture is two independent cryptosystems with a wall between them,
meeting in exactly one place.

**The safe — DEK world (symmetric, one key locks and unlocks).**
`DEK` is the family Data Encryption Key. It encrypts the real ledger (`transactions.amount_enc`,
notes, category/member names, photo bytes). It exists **only in the memory of an
unlocked family device**, unwrapped via passcode or Key Card (see `KEY-CARD-AUTH-SPEC.md`,
migrations 0030–0047). It also holds `wrapped_priv` — the staging private key, stored
as `encVal(DEK, family_priv)`. That nesting is deliberate: opening the safe
automatically yields the staging key, so there is no second door, no second
passcode, and no separate recovery story.

**The mail slot — keypair world (asymmetric, locking and unlocking are different keys).**
`family_pub` is stored openly in the database. Any untrusted writer can seal a box
through it and cannot open anything, including boxes it sealed itself.

**The wall.** One rule, no exceptions: *nothing that can read ever exists on the
server side.*

| | server side (robot) | family side (device) |
|---|---|---|
| holds | `family_pub`, `BASE`, a momentary `eph_priv`, ciphertext, metadata, `service_role` | `DEK`, `family_priv`, plaintext |
| can | seal, route, count, relabel | open, read, write the ledger |
| cannot | open **anything** | — |

**The only crossing** is an unlocked family device, and it happens exactly twice in
the system's life: when the keypair is generated (§4.1), and when a human taps
approve to promote a reviewed transaction into the ledger (§4.5). No scheduled job
and no server process ever moves data from slot-world into safe-world — the review
step *is* the border crossing.

---

## 3. Canonical variable names

Use these names everywhere — code, specs, diagrams, migration comments. Toy numbers
in parentheses map to the worked example in §5, kept because they make the
handshake legible to non-cryptographers.

| name | what it is |
|---|---|
| `BASE` | Curve25519 base point. A published constant (literally 9), baked into every crypto library on earth. Public, shared by everyone, secret to no one. |
| `family_priv` (7) | Family long-term private key. Random 32 bytes. Born on a family device, never leaves one unencrypted. |
| `family_pub` (17) | `X25519(family_priv, BASE)`. Stored in the clear, one per family. Can only lock. |
| `wrapped_priv` | `encVal(DEK, family_priv)`. Lets any device that unlocks the DEK recover `family_priv`. |
| `DEK` | Family Data Encryption Key. Symmetric. Ledger encryption. **Never on a server, in any form, ever.** |
| `eph_priv` (4) | Robot's throwaway private key. Fresh random 32 bytes **per row**. Destroyed immediately after sealing. |
| `eph_pub` (14) | `X25519(eph_priv, BASE)`. Stored openly **on the row** so the family can rebuild `K_box`. Harmless alone. |
| `K_box` (21) | Per-row symmetric key. `DH(eph_priv, family_pub)` == `DH(family_priv, eph_pub)`. **Never stored, never transmitted.** |
| `nonce` | Per-row random, never reused. Stored openly on the row. |
| `payload` | The sensitive JSON: amount, currency, direction, counterparty, reference_number, raw_body, raw_extracted, **plus `family_id` and `gmail_message_id`** (see §4.3). |
| `sealed` | `XSalsa20Poly1305(K_box, nonce, payload)`. The locked box. |
| *luggage tag* | The deliberately-plaintext columns: `gmail_message_id`, `member_id`, `source_provider`, `occurred_at`, `review_status`. Routing and pre-unlock queue display only. |

---

## 4. The construction

### 4.1 Setup, once per family 🟡

Runs on a family device with the DEK unlocked:

1. `family_priv = random_32_bytes()` — a CSPRNG call, nothing more ceremonial.
2. `family_pub = X25519(family_priv, BASE)`.
3. `wrapped_priv = encVal(DEK, family_priv)`.
4. Upload `family_pub` (clear) and `wrapped_priv` — **insert only if none exists**
   (first-writer-wins; two devices opening the app simultaneously must not both
   generate).

**Never regenerate.** A second keypair orphans every box sealed to the first —
those rows become permanently unopenable. Regeneration is a deliberate rotation
ceremony (§6), never an automatic code path.

`family_pub` is derived, not stored preciously: any device holding `family_priv`
can recompute it. That property is what makes §6's detector possible.

### 4.2 Ingestion ✅

Live today. Gmail filter labels the forwarded email `txn/inbox`; the Apps Script
time trigger (every 1 min) picks it up; the `+tag` on the receiving address
resolves through `mailbox_connections` to `member_id` and `family_id`.

Extraction is two-path, and this is a privacy mechanism as much as a cost one:

- **Known (sender, subject_template) with a stored template** → parsed entirely
  locally by `applyExtractionTemplate()`. Zero LLM. Nothing leaves. This is most
  volume, permanently.
- **New sender or template mismatch** → `maskForSharing()` replaces every amount,
  account, reference, phone, ALL-CAPS name and email address with
  shape-preserving fakes; only the masked text goes to Gemini; real values are
  restored locally via `unmaskExtraction()`. Then a template is derived, validated
  against the LLM's own output, and stored — so that sender never needs the LLM
  again. Templates carry `EXTRACTION_LOGIC_VERSION`, so improving the prompt
  auto-invalidates stale templates and forces one clean re-derivation.

Masking is **unconditional** — no encryption-state gate — because encryption is
default-on product-wide.

### 4.3 Seal 🟡

Ships with the review UI (§4.4). Until it does, rows are plaintext behind RLS
deny-all — that is the known, accepted interim gap.

1. Build `payload`, **including `family_id` and `gmail_message_id` inside it**.
   This is the anti-relocation binding: without it, someone with DB write access
   could move a sealed blob onto a different row of the same family so the wrong
   amount lands on the wrong transaction. The opener verifies inside == outside.
2. `eph_priv = random_32_bytes()` — **see §8, this line is the most dangerous in
   the implementation.**
3. `eph_pub = X25519(eph_priv, BASE)`.
4. `K_box = DH(eph_priv, family_pub)`.
5. `sealed = XSalsa20Poly1305(K_box, nonce, payload)`.
6. **Delete `eph_priv`. Forget `K_box`.** The robot is now locked out of its own
   output — provably, not by policy.

### 4.4 Save ✅ (shape changes with §4.3)

One HTTPS POST to PostgREST with the `service_role` key (which bypasses the
deny-all RLS; that posture was reviewed by the security advisor and is by-design).
The row carries the luggage tag plus `{sealed, eph_pub, nonce}`. `unique(gmail_message_id)`
blocks double-ingestion. Thread relabels `txn/processed`.

Operators looking at this table see *"MB Bank · Aug 8 · pending · this family"*
and gibberish. There is no arithmetic over stored values that yields `K_box` —
`eph_pub`, `family_pub` and `BASE` are all public, and combining publics never
produces the shared secret.

### 4.5 Open and promote 🟡

On any family device, any time later:

1. Luggage tags render the pending queue **before** unlocking.
2. Unlock → `DEK` → `family_priv = decVal(DEK, wrapped_priv)`.
3. `K_box = DH(family_priv, eph_pub)` — the same value the robot burned, rebuilt
   from the other side.
4. `payload = open(K_box, nonce, sealed)`.
5. **Verify** `payload.family_id == row.family_id` and
   `payload.gmail_message_id == row.gmail_message_id`.
6. Client-side dedup (§7), then the human picks a category — per-transaction,
   always human, never cached (see migration 0027 for why).
7. Approve → written to the ledger through `addExpense()`, encrypted under the
   `DEK` like a hand-typed expense.
8. **Delete the staging row**, `raw_body` and all.

---

## 5. Why it must be two keys — rejected one-key designs ⛔

Kept so this isn't re-argued. Each attempt springs a specific leak:

1. **Give the robot the DEK.** Symmetric: a robot that can encrypt can decrypt the
   entire family ledger. One leaked Script Property opens everything. ⛔
2. **A second symmetric key just for staging.** Ledger is safe, but the robot can
   still read staging — and the key sits on the server beside the data it
   protects. This is "we promise not to look" in costume. ⛔
3. **Random key per row, then forget it.** The family then can't open it either.
   Delivering the row-key requires a lock only the family can open — which *is*
   the padlock. Every version of this reinvents public-key crypto in its last
   step. (Pre-deposited one-time key stacks technically work but leave unused
   future keys on the server and are strictly worse.) ⛔
4. **No robot encryption; a family device encrypts later.** Either (a) rows sit
   plaintext until someone opens the app — a readable window *is* the leak; or (b)
   the robot stores nothing and defers all parsing to clients — which works, but
   dismantles the pipeline (nothing processes until an app opens, extraction logic
   moves client-side, the shared inbox needs new per-family auth). Different,
   worse product. ⛔

**The worked example.** `family_priv`=7 → `family_pub`=17 (i.e. 7+`BASE`, `BASE`=10).
Robot rolls `eph_priv`=4 → `eph_pub`=14. Robot computes 4+17=**21**; family computes
7+14=**21**. Identical because both are `4+7+10` in different order. Burning the 4
destroys the robot's route; the family's route (7 + the openly-stored 14) survives.
An observer holding 17 and 14 gets 31 — the wrong number, and there is no way to
un-mix a public back into its secret. (In the toy you could subtract `BASE`; real
curve math is the one-way function that closes exactly that hole.)

This construction is ephemeral-static ECDH — the same handshake protecting HTTPS,
Signal and SSH. Not novel, deliberately.

---

## 6. Key substitution — the residual threat 🟡

**The attack.** Anyone with DB write access replaces `family_pub` with their own
key. The robot can't tell padlocks apart and seals future rows to the attacker.

**Blast radius — narrow and loud.** They read rows sealed *after* the swap only.
Pre-swap boxes stay shut (ciphertext already written is not retroactively
re-keyed). The ledger is untouched — different lock system entirely. And the
family's own decryption **breaks immediately and visibly**: 7+14 no longer equals
the attacker's blend, so boxes simply fail to open. Even swap-then-restore leaves
a block of permanently-undecryptable rows as evidence. The realistic outcome is a
visible outage, not silent surveillance.

**Defense 1 — robot pins (TOFU).** On first use of a family's key, store
`sha256(family_pub)` in Script Properties; refuse to seal on later mismatch. This
works *only* because the pin lives in a different trust domain (Google) than the
key (Supabase), so it genuinely blocks a DB-only attacker. It does nothing against
the operator — that isn't its job.

**Defense 2 — the device verifies itself, every unlock.** Recompute
`X25519(family_priv, BASE)` and compare with the server's `family_pub`. This
catches *everyone including us*, because an operator cannot fake a value derived
from a secret they never held.

**Rejected: "the robot checks a signature/stamp on the key."** ⛔ The attacker it
targets is the operator, who also deploys the robot and would simply delete the
check — and the robot's reference for what a valid stamp looks like would come
from the same database it distrusts. A guard hired by the thief guards nothing.
Verification must never be performed by the party being defended against.

**On mismatch:** blocking, family-wide state — freeze approve on new staged rows,
mask their amounts, push to every member, and state plainly that existing ledger
data is untouched. UI built: screen 5 of the prototype
(`family-hub-design/fhtest-transaction-pipeline/onboarding-review-flow.standalone.html`).

**Rotation must announce itself** through the DEK-authenticated path. Otherwise
the first legitimate rotation alarms every family device at once, users learn the
alarm is noise, and the mechanism is dead. This screen gets zero cry-wolfs.

---

## 7. Consequences to remember

- **Server-side dedup dies.** `findDuplicate()` currently queries `amount=eq.X`.
  Once amounts are sealed, that stops working, and no server-computable blind
  index is safe (VND amounts sit in a small, dictionary-attackable range). Dedup
  **moves client-side into review**, where everything is decrypted and it works
  better than it does today.
- **`raw_body` must be deleted** at promotion or rejection, regardless of anything
  else. It is the fattest sensitive payload and is only needed while a row is
  pending.
- **`parse_failures` and any quarantine table are side doors.** They store full
  plaintext emails for debugging — a backdoor around the sealed table. They must
  be sealed identically, or reduced to error metadata only. 🟡
- **Debugging changes shape.** Post-sealing, operators can no longer eyeball a row
  to verify the pipeline. Verification relies on metadata, logs, and viewing our
  own family's data through the app like any user.
- **Metadata is a deliberate leak.** Luggage tags reveal which banks a member
  uses, transaction timing, and family activity rhythms (salary day is visible
  from timestamps). Accepted because the queue must render pre-unlock — but it is
  a choice, and it belongs in any user-facing security statement.

---

## 8. Implementation landmines

**⚠️ Apps Script has no CSPRNG.** There is no `crypto.getRandomValues` in GAS.
`eph_priv` **must not** come from `Math.random()` — predictable ephemerals make
every sealed box openable by anyone who can replay the generator. Required: seed
once from real entropy and run a HKDF/HMAC-counter DRBG, with the seed in Script
Properties. This single line is the difference between real encryption and
decoration.

**Crypto library.** TweetNaCl (pure JS, ~30KB) runs in both Apps Script and the
browser. The Apps Script side is deployed by pasting whole-file into the editor
until clasp is wired — historically hazardous (a paste once wiped the script; a
null-byte incident followed). Prefer wiring clasp before pasting a crypto library.

**Format agreement.** The `15-crypto.js` side is owned by Hien's session, which
provides an exact construction spec plus a test vector; the Apps Script seal is
implemented against that vector. One format, two implementations — do not let the
two ends diverge.

**Insert-failure detection.** `supabasePost` returns PostgREST's error *object* on
failure, which is truthy — so a naive `if (!inserted)` treats failures as success
and silently loses the row. Check `response.getResponseCode()` for 2xx.

---

## 9. Status at a glance

| piece | status |
|---|---|
| Ingestion, fingerprints, templates, masking | ✅ live |
| Staging schema (`0025`/`0027`/`0028`) | ✅ live |
| `known_provider_domains` seed (`0050`) | ✅ merged · 🟡 live-DB apply pending |
| Sender/forwarder authentication (DKIM + `X-Forwarded-For` checks) | 🟡 designed |
| Keypair generation, `wrapped_priv`, sealing, opening | 🟡 decided, ships with review UI |
| Key-substitution pin + device self-check | 🟡 agreed both sessions |
| Mismatch alarm UI | ✅ prototyped · 🟡 copy needs native-speaker review |
| Review UI (approve, categorize, promote, client-side dedup) | 🟡 next build |
| `parse_failures` sealing decision | 🟡 open |
| Backend rewrite (owned domain + inbound service) | 🟡 deferred to multi-family |

---

## 10. Where things live

- `pipeline/bank-email-pipeline.gs` — the Apps Script (source of truth; deployed by paste)
- `pipeline/extraction.md` — LLM prompt, output schema, masking spec, template derivation
- `pipeline/README.md` — how the pipeline runs, privacy invariants, setup
- `AGENT_SYNC.md` — live cross-session decisions and open questions
- `CSV-IMPORT-ENCRYPTION.md` — the sibling analysis from the CSV side; where the
  shared masker and promotion-path decisions were first settled
- `family-hub-design/fhtest-transaction-pipeline/` — prototype screens, the
  draw.io-importable sequence diagram, sample CSVs
