> **Archived — superseded by [`docs/features/encryption.md`](docs/features/encryption.md).**
> Kept for historical reference; not maintained. The new doc also covers the off→dual→enc
> migration lifecycle for pre-existing passcode families, which this note deliberately
> scoped out.

# FamilyHub — End-to-end encryption for new families (technical note)

*Audience: readers comfortable with applied cryptography. Scope: families created on
the current build ("born on the Key Card"). Legacy 6-digit-passcode families and their
migration are deliberately out of scope here.*

---

## Claim, stated precisely

For a family created on the current build, the FamilyHub operator — us, or anyone who
compromises our database, storage, and API — **cannot recover the plaintext of encrypted
fields.** The reason is not policy or access control; it is that the only key able to
unwrap the data-encryption key is a **128-bit uniformly random value that is never
transmitted to or derivable by the server.** Recovering it means searching a 2¹²⁸ space.

This is a confidentiality guarantee for field *values* against the operator. It is **not**
a claim of positional integrity against an actively malicious operator, nor of metadata
confidentiality. Those non-goals are spelled out at the end, because an honest crypto note
lists what it does not defend.

---

## Primitives

| Purpose | Primitive | Parameters |
|---|---|---|
| Key stretching | PBKDF2-HMAC-SHA256 | 600,000 iterations, per-family 128-bit random salt, 256-bit output |
| Sub-key derivation | HKDF-SHA256 | domain-separated by `info` (`fh-wrap-v1`, `fh-auth-v1`) |
| DEK wrap | AES-256-GCM | 96-bit random IV, 128-bit tag, envelope `base64(iv‖ct)` |
| Field / photo encryption | AES-256-GCM | 96-bit random IV per value, 128-bit tag |
| Card | CSPRNG | 128 bits from `crypto.getRandomValues`, Crockford Base32 + CRC-16 typo checksum |

All crypto runs in the browser via WebCrypto (`crypto.subtle`). The card's CRC group is a
transcription checksum only — it carries no security weight and gates nothing.

---

## Key hierarchy

```
Key Card  (128-bit CSPRNG, printed FH-XXXX-…, never leaves the device)
   │
   │  PBKDF2-SHA256(salt, 600k)  →  256-bit master
   ▼
 HKDF-SHA256
   ├─ info="fh-wrap-v1" ─▶  K_wrap   (AES-256-GCM key, device-only)
   └─ info="fh-auth-v1" ─▶  K_auth   (derived but UNUSED for card families — see below)
                    │
        K_wrap unwraps ▼
   DEK  (256-bit CSPRNG, generated on-device at family creation)
                    │
     AES-256-GCM(DEK) ▼
   every encrypted field:  amounts, notes, category / member / goal names,
   photo captions, and photo bytes (stored as `.enc` objects)
```

Two independent secrets, cleanly split: the **door** (who is in the family) is a
whitelisted Google account enforced by Postgres RLS; the **safe** (who can read the data)
is the Key Card. Knowing one gives nothing about the other.

---

## What the server receives at family creation

Family creation runs entirely client-side, then calls one RPC (`init_family_card`) with
exactly four values:

```
kdf_salt      (the per-family PBKDF2 salt — public by design)
kdf_iters     (600000)
kdf_version   (1)
wrapped_dek   = base64( iv ‖ AES-256-GCM(K_wrap, DEK) )
```

The server persists these and sets `enc_state = 'enc'`. Note the two NULLs it writes:

```sql
insert into family_keys (..., auth_hash, wrapped_dek, enc_state)
values (..., NULL, NULL, 'enc');            -- no server-side auth secret at all
insert into family_key_wraps (family_id, kind, kdf_salt, kdf_iters, kdf_version, wrapped_dek)
values (..., 'card', ...);
```

**The server never receives, and cannot derive:** the Key Card, K_wrap, K_auth, or the DEK
in the clear. It holds only the AES-GCM-wrapped DEK, the salt, and the iteration count.

Crucially, `auth_hash` is `NULL` for card-born families. The legacy passcode design stored
a bcrypt hash of a low-entropy secret server-side (a ~20-bit target an offline attacker
holding `wrapped_dek` could grind). Card families have **no such secret on the server** —
there is nothing low-entropy anywhere in the system to attack. The 128-bit card is the only
input, and it never leaves the device.

---

## Data at rest

Once `enc_state = 'enc'`, plaintext columns are `NULL` and every value is stored as
`base64(iv‖ct)` under the DEK; photo bytes are stored as raw `iv‖ct` in `.enc` storage
objects. This is enforced server-side by triggers (a plaintext write in the `enc` state is
rejected with `enc_required`), and the `enc` state is terminal — it cannot be silently
downgraded. So the ciphertext-only property is a database invariant, not a client promise.

Each encryption draws a fresh 96-bit IV from the CSPRNG, so identical plaintexts across
rows produce unrelated ciphertexts, and the 128-bit GCM tag authenticates each value on
decrypt (a flipped bit fails, it does not silently corrupt).

---

## Why the operator cannot decrypt (threat model)

Assume the strongest realistic operator-side adversary: full read access to the database,
the storage bucket, logs, and the ability to run queries. They obtain, for a target family:
`wrapped_dek`, `kdf_salt`, `kdf_iters`, and all field ciphertexts.

To read any value they need the DEK. The DEK exists only as `AES-256-GCM(K_wrap, DEK)`.
Recovering it requires K_wrap, which is `HKDF(PBKDF2(card, salt))`. The only unknown is the
**card**. There is no server-side verifier, no password hash, no escrow, no recovery key —
by construction. So the adversary's only path is to guess the card:

- Search space: **2¹²⁸** (uniform CSPRNG). Each trial costs a PBKDF2(600k) + HKDF +
  AES-GCM-unwrap; the GCM tag makes a correct guess unambiguous. The iteration count is
  almost irrelevant at this entropy — 2¹²⁸ is the wall on its own, and it is not
  traversable by any adversary bounded by physics.
- There is no shortcut via the door: RLS lets a *joined, whitelisted* member read the
  `wrapped_dek`, but the wrap is safe to expose precisely because it is ungrindable without
  the card. Compromising a family member's Google account gets the adversary the wrap they
  already effectively have — still not the card.

Hence "even we can't read it" is, for card-born families, a statement about the size of a
search space rather than about our conduct.

---

## Non-goals and honest caveats

A guarantee is only as good as its stated boundary. The following are explicitly **out of
scope**, by design or by the nature of a browser-delivered app:

1. **Client-code trust (the web-E2EE caveat).** The encryption happens in JavaScript we
   serve. A user trusts the code delivered on load; a malicious operator could in principle
   serve code that exfiltrates the card or DEK. We reduce the surface (all crypto deps are
   vendored and service-worker-precached, nothing loads from a third-party CDN on the crypto
   path), but web delivery cannot match a signed native binary here. This is the honest
   ceiling of in-browser E2EE, and we state it rather than paper over it.

2. **Positional integrity against an *active* operator.** AES-GCM here authenticates each
   value but is used **without associated data (AAD)** binding a ciphertext to its row id and
   column. So a malicious operator could relocate or replay a validly-encrypted ciphertext
   into another field; it would decrypt to a real (wrong-place) value. Confidentiality is
   preserved; positional integrity is not currently enforced cryptographically. Binding
   per-cell AAD is the natural hardening and is not yet done.

3. **Metadata is not encrypted.** Field *values* are encrypted; the *shape* is not. Row
   existence and counts, timestamps, category/member structure, family membership, and photo
   object sizes/paths are visible to the operator. We encrypt what a value is, not that a
   value exists.

4. **Unlocked devices and departed members.** A device that has unlocked caches the raw DEK
   in IndexedDB (so the card is entered once per device, not per session). Regenerating the
   card re-wraps the *same* DEK — it does not re-key existing data (the `enc` state is
   terminal, no bulk re-encryption). Therefore a member who has already unlocked, or who has
   left, retains whatever DEK/plaintext their device already held. Rotation kills a lost or
   leaked card for *future* device set-ups; it is not forward-secret against a copy already
   made.

5. **No recovery, by design.** There is no key escrow and no operator reset. If every device
   loses its cached DEK *and* no copy of the card survives (saved file, QR, printed card),
   the data is permanently unrecoverable. This is the direct cost of removing our ability to
   read it — the two are the same property.

6. **KDF salting detail.** Per-family entropy for the wrap comes from the 128-bit card plus
   the random PBKDF2 salt; the subsequent HKDF step uses a fixed (zero) salt and relies on
   distinct `info` labels for domain separation of K_wrap and K_auth. This is standard HKDF
   usage (the salt is optional; domain separation is the security-relevant input) and does
   not weaken the wrap, whose strength rests on the card's entropy.

---

## Versioning

`kdf_version = 1` is carried on every wrap so the derivation can evolve without ambiguity.
The wrap envelope, DEK, AES-GCM field format, and the `enc_state` machine are unchanged from
the passcode era; only the *input* to key derivation changed (a 128-bit card in place of a
6-digit code), which is what turns the confidentiality guarantee from a policy into a
math one.
