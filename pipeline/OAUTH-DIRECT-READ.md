# Direct mailbox read (OAuth) — handoff

Starting point for building **read the user's mailbox directly** instead of
having them forward mail to us. Written to be read cold, by a session that has
none of the context. If you are that session: read this file, then
`pipeline/README.md` and `pipeline/SEALED-STAGING-DESIGN.md`.

Status: **nothing built.** This is a starting brief, not a design.

> **Update 2026-08-13 — §3.1 and §3.2 have been answered.** See
> `pipeline/OAUTH-COMPLIANCE-FINDINGS.md`. Short version: CASA is ~$540/yr at
> this size and restricted-scope verification is ~6 weeks, so the lead time does
> **not** change the plan; the Testing-mode 7-day refresh-token limit is real and
> confirmed, but appears tied to *Testing* status rather than to being
> unverified, so a published-unverified 100-user beta may need no assessment at
> all (one experiment settles it). `gmail.metadata` is a dead end — restricted
> *and* body-less. The live risks are Google's Appropriate Access list, not the
> price, and §3.2 below is stale: Decree 13/2023 was superseded on 2026-01-01.

---

## 0. Read this first — you are reversing a decision

The forwarding pipeline exists *because* OAuth was rejected. The recorded reason
was **CASA cost**: reading Gmail message bodies needs a restricted scope, and
restricted scopes require a third-party security assessment, repeated annually.
Forwarding was chosen to sidestep that entirely.

That decision is now being revisited deliberately. It is not an oversight, and
you should not re-litigate it — but you **must** re-price it, because if the
assessment is unaffordable or slow, everything else in this document is moot.
**Make that the first thing you find out, before writing any code.**

There are two real arguments for revisiting it, and neither is convenience: the
routing/spoofing problems forwarding created disappear entirely, and historical
backfill becomes possible. Both are in §2.

---

## 1. What exists today, and what survives

The current pipeline is: forwarded email → Apps Script → Gemini extract → dedup →
route by `+tag` → staged row → human review → ledger. (Masking sat between Apps
Script and Gemini until 2026-08-25; see §4.1.)
Full detail in `pipeline/README.md`.

**Reusable as-is under OAuth — do not rebuild these:**

| Piece | Where | Note |
|---|---|---|
| ~~Masking before any LLM call~~ | removed 2026-08-25 | Consent replaced it. See §4.1. |
| Local extraction templates | `deriveExtractionTemplate`/`applyExtractionTemplate` | Repeat senders parse with zero LLM. This is most volume. |
| Gemini prompt + output schema | `pipeline/extraction.md` | Includes the `memo` field — the only thing carrying *why* money moved. |
| Sealed staging design | `pipeline/SEALED-STAGING-DESIGN.md` | Envelope format is transport-agnostic. Unaffected. |
| `email_transactions` schema | migrations 0025/0027/0028, 0058, 0060 | Staging table + review read policy + resolve-on-import. |
| Review UI | `src/js-data/72-txn-review.js` | Reuses the CSV import screen. Works today. |
| Known bank domains | migration 0050 | 11 VN providers seeded. |
| Sender authenticity (DKIM) | `bank-email-pipeline.gs` | **Still needed** — see §4.3. |

**Dies with forwarding:**

- The `+tag` alias and `get_or_create_mailbox_alias` (migration 0059)
- Gmail forwarding-confirmation handling (`confirmPendingForwarding`)
- The `X-Forwarded-For` / `personal_email` check
- The routing gate that holds unroutable mail (`ROUTING_GRACE_DAYS`)
- Most of the "Gmail's actual behaviour" section in `pipeline/README.md` —
  keep the file, mark that section historical rather than deleting it

**Repurpose, don't replace:** `mailbox_connections` already holds
`member_id` + `personal_email` + `verified`. It is the natural home for OAuth
tokens and sync state. Same table, same role — proving which mailbox belongs to
which member — different mechanism.

---

## 2. Why this is genuinely better (the honest upside)

Not just "no setup step." Direct read **deletes an entire class of problem.**

Under forwarding, mail arrives at a shared inbox and we must work out who it
belongs to from headers that the sender controls. `To:` is typed text and can
name anyone. `X-Forwarded-For` is a plain header and can be forged by a direct
sender. The `+tag` exists to make the routing key something an attacker has to
*obtain* rather than merely *know*. All of that is scaffolding around one hole:
**we cannot prove whose mailbox a forwarded message came from.**

OAuth closes it at the source. We fetch from a mailbox we hold a grant for, so
ownership is proven by the grant itself. No tag, no routing table lookup, no
spoofable header, no unroutable-mail limbo.

Second: **historical backfill becomes possible.** A forwarding filter only ever
applies to *new* mail — a user who connects today gets nothing from last month.
Direct read can pull history on first connect, which is the difference between
"start logging from now" and "here is your last six months." For a spending app
that is a real product difference, not a nicety.

Third, smaller: **the Apps Script CSPRNG landmine disappears.** GAS has no
`crypto.getRandomValues`, which forced a hand-rolled HMAC-counter DRBG for
`eph_priv` — flagged in `SEALED-STAGING-DESIGN.md` §8 as *"the difference between
real encryption and decoration."* Any normal Node runtime has real randomness,
and that whole construction can be deleted.

---

## 3. What it costs — decide these before writing code

### 3.1 The compliance bill (gating)

Reading message bodies requires **`gmail.readonly`**, a *restricted* scope.
Restricted scopes require app verification **plus** a third-party security
assessment (CASA), redone annually, with a real invoice attached.

**Prior research on this (2026-08-01, when OAuth was rejected):** CASA Tier 2,
roughly **$500–5,000/yr**, with **weeks-to-months lead time** before the first
real user can be onboarded. The lead time may matter more than the money.

**Re-verify all of it against current Google docs — policies change and this
brief may be stale:**

- Current CASA tier and price for an app of this size
- Whether the **Testing** publishing mode is a viable start: up to 100 test
  users with restricted scopes and no verification. Known limitation from the
  earlier research: **refresh tokens expire after 7 days** unless the app is
  published "In production" — a weekly re-consent. Confirm, because it decides
  whether a private beta is possible at all.
- Whether any narrower scope can read enough. `gmail.metadata` is believed
  restricted *and* body-less, so probably useless for extraction — confirm.
- What the Limited Use disclosure requires you to say and show.

### 3.2 Vietnamese data law — do not skip this

**Decree 13/2023 (PDPD) classifies financial data as *sensitive* personal
data.** For a VN-targeted product that means **explicit, separate consent** (not
bundled into general terms) and a **Personal Data Processing Impact Assessment
filed with A05**.

This applies to the product either way — it is already true of the forwarding
pipeline. But direct mailbox read raises the exposure: the grant covers the whole
mailbox, and the consent you collect has to describe honestly what is accessed,
not just what is stored. Treat the DPIA as work with a lead time, in parallel
with CASA, not as paperwork to do at launch.

### 3.3 The privacy posture change (the real design problem)

This is the part that deserves the most thought, and it is not a technical
problem.

The product promise, stated precisely in `SEALED-STAGING-DESIGN.md` §1, is
*blocked for database attackers, detected for operator attackers, bounded by
code-serving trust.* The forwarding design supports it structurally: **we only
ever see mail the user chose to send us.** A user can verify that claim by
looking at their own forwarding rule.

`gmail.readonly` grants **the entire mailbox**. Querying only
`from:(bank domains)` is a self-imposed restraint, not a boundary the user can
check. There is no scope that means "only these senders."

That is not disqualifying — plenty of trusted products hold this grant — but it
must be handled openly:

- Decide and write the honest user-facing sentence *before* building. If you
  cannot write one you would be comfortable defending, that is a finding.
- The query restriction should be enforced somewhere auditable, and stated.
- Never store raw message bodies beyond what staging needs.
  `SEALED-STAGING-DESIGN.md` §7 already requires deleting `raw_body` at
  promotion or rejection. That requirement gets stricter here, not looser.
- Consider keeping forwarding as the option for users who will not grant this.
  Two paths is more code, but "we read everything or you get nothing" is a bad
  place to put a privacy-first product.

### 3.4 Architecture

Apps Script is bound to *our* inbox and writes with `service_role`. Per-user
OAuth needs somewhere to store tokens and run per user.

- **Likely home: `api/` on Vercel.** It already exists and already gates on a
  Supabase JWT — see `api/csv-column-mapping.js`, which verifies the token via
  `/auth/v1/user` and rate-limits. Same pattern applies.
- Token storage is a **new class of secret at rest.** A stolen refresh token is
  standing access to a user's whole mailbox. Decide where it lives and how it is
  encrypted before you write the first insert. This is squarely in the
  encryption owner's territory — see §5.
- Sync: `users.watch` + Pub/Sub for push, or poll with the History API and a
  stored `historyId`. Polling is simpler and probably right to start.
- Handle revocation as a normal state, not an error: users will revoke, and the
  UI should show a re-connect path, not a broken screen.

---

## 4. Things that stay true and are easy to forget

1. **Masking is unconditional.** No real amounts, names, accounts, refs or
   emails reach the LLM, ever. Direct read does not relax this — it makes it
   more important, since you are now touching mail the user never hand-picked.
2. **Every row is still human-reviewed.** Never auto-import. The reason is in
   `72-txn-review.js`: the machine gets amount and date right but cannot know
   that *"NGUYEN THU TRANG chuyen tien"* was lunch with your mum.
3. **DKIM checking still matters.** A phishing mail sitting in the user's inbox
   pretending to be their bank will be read by us now, with no forwarding step
   to filter it. `known_provider_domains` (0050) and the DKIM verdict are still
   the defence. DKIM proves *a domain signed this*, not *this is really your
   bank* — a lookalike domain signs perfectly for itself.
4. **Deployment is by hand today.** `bank-email-pipeline.gs` is pasted into the
   Apps Script editor; `PIPELINE_VERSION` is logged every run so you can tell
   which code is live. If the fetch moves to `api/`, this problem goes away for
   the new code — but the old path still runs until it is retired.

---

## 5. Coordination

Two Claude sessions share this repo, plus a human partner
(`hiencao27110505`) who owns **encryption and auth**. Cross-session decisions go
in `AGENT_SYNC.md` — dated entry under **Open**, moved to **Resolved** by
whoever answers. Read it before starting; it is the live channel.

- **Next free migration number: 0061.**
- **Open and unblocked:** the partner's three staging-encryption client steps
  (TweetNaCl into the bundle, `client-reference-staging-keys.js` into
  `15-crypto.js`, two calls at unlock). Migration `0051` is applied, so the DB
  side is ready. Sealing cannot switch on until those land.
- **Token storage design belongs to them.** Post it in `AGENT_SYNC.md` early —
  it is a bigger secret than anything the pipeline currently holds.

---

## 6. Suggested first moves

1. **Price CASA and check the Testing-mode refresh-token limit.** Everything
   depends on this. Do not start building first.
2. **Write the user-facing privacy sentence.** One or two sentences you would
   defend publicly. If it cannot be written honestly, stop and say so.
3. **Decide: does forwarding stay as a second path?**
4. Only then: a spike that OAuths one account, pulls one bank email through
   the *existing* extract path, and stages one row. Everything
   downstream already works — the review UI has been used against real staged
   rows.

Do not touch the forwarding pipeline until direct read stages a row end to end.
It works today and there are real transactions flowing through it.
