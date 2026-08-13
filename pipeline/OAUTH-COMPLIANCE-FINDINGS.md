# Direct mailbox read — compliance findings

Answers §3.1 and §3.2 of `OAUTH-DIRECT-READ.md`, which asked for CASA to be
re-priced and the Testing-mode refresh-token limit confirmed **before any code
is written**. Researched 2026-08-13. No code written.

Every claim below is tagged **[Google]** (Google's own documentation),
**[ADA]** (App Defense Alliance), **[3P]** (third-party — assessor or law-firm
publication, directionally reliable, not authoritative) or **[UNVERIFIED]**
(could not confirm; needs an experiment or a question to Google).

---

## Verdict

**Cost is not the blocker. Lead time is ~6 weeks, not months, so it does not
invalidate the plan.** The brief's "weeks-to-months" was pessimistic at the top
end; Google's own published estimate for restricted-scope verification is
6 weeks.

Two things the brief did not have, and both matter more than the price:

1. **There is probably a build-and-beta path that needs no CASA at all** — the
   7-day refresh-token death is tied to *Testing* publishing status, not to
   being unverified. A **Published-but-unverified** app gets a hard cap of 100
   total users and a scary consent screen, but is not documented as suffering
   the 7-day expiry. If that holds, a 100-user private beta can run with stable
   tokens, no assessment, no lead time. **One cheap experiment settles it —
   do that before committing to anything else.**
2. **The real risk is approval, not money.** Google restricts Gmail scopes to
   four named use cases. A family spending ledger is *adjacent* to the fourth,
   not squarely inside it. That is a reviewer's judgement call that lands
   *after* the invoice is paid, and it is the thing that can sink this.

And one correction to the brief: **§3.2 is out of date.** Decree 13/2023 was
superseded on 2026-01-01. The substance survives and gets sharper.

---

## 1. Scopes — the narrow-scope escape is closed

| Scope | Class | Reads body? |
|---|---|---|
| `gmail.readonly` | **Restricted** | yes |
| `gmail.metadata` | **Restricted** | **no** — "labels and headers, but not the email body" |
| `gmail.modify` | **Restricted** | yes |
| `gmail.addons.current.message.readonly` | **Sensitive** | yes, but only the message the user has open |

**[Google]** The brief asked whether `gmail.metadata` could read enough. It
cannot, and it is *also* restricted — so it costs the same and buys nothing.
That escape hatch is closed, definitively.

The only body-reading scope outside the restricted tier is the Gmail Add-on
contextual scope. It fires only while the user has an add-on open on a message:
no background sync, no history backfill. It cannot do this job. Worth knowing it
exists — it is the standard advice for "read one open email cheaply" — but it
does not serve the ledger.

**So: `gmail.readonly`, restricted tier, or nothing.**

## 2. The two publishing states, and the gap between them

**[Google]** Testing status: *"limited to up to 100 test users listed in the
OAuth consent screen"* and *"Authorizations by a test user will expire seven
days from the time of consent"* — refresh tokens included. The oauth2 reference
states it as a property of the *publishing status*: *"A Google Cloud Platform
project with an OAuth consent screen configured for an external user type and a
publishing status of 'Testing' is issued a refresh token expiring in 7 days."*

So the brief's memory is correct: **weekly re-consent, per user, in Testing.**
That rules Testing out as a beta vehicle. Nobody re-authorises their bank mail
every seven days.

**[Google]** Published + unverified is a different state: *"unverified app
warnings (Danger UI) will be displayed to users, and a hard cap of 100 total
users applies."* The 7-day rule is referenced there only as *"the 7-day refresh
token expiration limit for apps in the **Testing** status."*

**[UNVERIFIED] — and this is the one to settle first.** Google's docs describe
the Danger UI and the 100-user cap for published-unverified apps, but nowhere
state plainly that a restricted scope will actually be *granted* in that state.
Two independent readings agree the 7-day clock is Testing-only; neither
confirms restricted scopes survive unverified publication.

**Experiment (~20 min, plus one 8-day wait):**
1. New GCP project, consent screen External, publish it (do **not** submit for
   verification), request `gmail.readonly`.
2. Consent with a throwaway account. Does it complete past the Danger UI, or
   does Google block the scope outright?
3. Store the refresh token. Come back on day 8 and try it.

Step 2 answers "can we build at all right now" today. Step 3 answers "can 100
real users live on this" next week. Everything downstream depends on it, and it
costs almost nothing to find out.

## 3. CASA, re-priced

**[ADA]** The framework has changed shape since the brief was written. It is no
longer Tier 1/2/3 but two assurance levels, assigned by Google on risk (user
count, scopes, other signals):

- **AL1 — verified self-assessment.** Developer submits evidence and scan
  artifacts for every test case; an approved lab reviews without testing the
  running app.
- **AL2 — lab assessment.** The lab tests every case against the live app.

**[Google]** *"Google does not charge the developer any fees for security
assessment"* — the fee is between developer and assessor. **[Google]** *"All
applications must be revalidated every year"*, and the level is dynamic: it can
escalate as the user base grows. Once at AL2, it stays at AL2.

**[3P]** Street prices: **AL1 ≈ $500** (TAC Security, Google's named preferred
lab, advertises ~$540 basic / ~$720 with unlimited rescans); **AL2 ≈ $3,000–
6,000** (Leviathan and others quote $800–1,200 for narrow scans up to several
thousand for full lab work).

**Re-priced answer: the brief's "$500–5,000/yr" still holds, and an app this
size sits at the bottom of it — call it ~$540/yr while small, with a step up to
low-four-figures if it grows.** That is not a number that should decide this.

**[Google] Lead time — the number to plan against:**

| Step | Google's published estimate |
|---|---|
| Brand verification | 2–3 business days |
| Sensitive scope verification | 10 business days |
| **Restricted scope verification** | **6 weeks** |

**[3P]** Lab testing itself runs 1–3 weeks (AL2) once it starts. Google notes
these estimates are not guaranteed and stretch with developer responsiveness.

**So: ~6 weeks, not months.** The brief's gating condition ("if the lead time is
months, that changes the plan") is **not** met. The plan stands.

## 4. The risk that actually matters: Appropriate Access

**[Google]** Gmail scopes are limited to four permitted use cases, verbatim:

1. *"Built-in and web email clients that allow users to compose, send, read,
   and process email via a user interface."*
2. *"Applications that automatically backup email"*
3. *"Applications that enhance the email experience for productivity purposes
   (such as applications for customer relationship management, delayed sending
   of email or mail merge, or providing generative AI summaries)"*
4. *"Applications that use information from emails to provide reporting or
   monitoring services for the benefit of users that improve the email
   experience (such as applications that automate travel itineraries or track
   flights or package delivery statuses)"*

Ours is #4 in shape — read a notification email, turn it into a tracked item for
the user's benefit. Package tracking and flight tracking are exactly our
mechanic with a different noun.

The exposure is the qualifier: **"that improve the email experience."** Package
tracking arguably improves how you experience your mail. A family spending
ledger improves a finance app; the mailbox is a data source, not the thing being
improved. A reviewer could read that either way, and there is no appeal tariff.

**[UNVERIFIED]** No published precedent found either way for a personal-finance
app extracting bank-email transactions. Absence of evidence, not evidence of
absence — this category of app plainly exists — but I could not confirm one was
approved, so treat approval as genuinely uncertain rather than routine.

**De-risk before spending:** submit the verification request early, with the
demo video and justification framed as monitoring/reporting on the user's own
mail (#4's language), and find out whether Google bites *before* commissioning
an assessment. Verification and assessment are separate steps; the rejection, if
it comes, should arrive before the invoice does.

## 5. Limited Use — what it obliges, and what we already do

**[Google]**, four rules, and where we stand:

| Rule | Us |
|---|---|
| No ads/retargeting use of the data | Fine, nothing to do. |
| No transfers except to provide the use case, with consent | The Gemini call is a transfer. **Masking is what makes it defensible** — shape-preserving fakes leave, real values never do. This moves masking from good practice to compliance load-bearing. |
| *"Do not allow humans to read user data"* except with explicit consent / aggregated + anonymised / security / law | Aimed at developer staff, not at the user reading their own mail — our human-review step is the *user*, and is fine. But it does mean **no operator-side triage of raw bodies, ever.** Sealed staging is what lets us claim that honestly. |
| No using user data to train AI/ML models beyond that user's own personalised model | Must confirm the Gemini tier in use carries no-training terms, and say so in the policy. |

Plus: the privacy policy must disclose the use, and actual use must not exceed
what it discloses.

**Consequence worth flagging (§3.3 of the brief):** the privacy sentence we would
want to defend — "nobody at FamilyHub can read your mail" — is only true once
sealed staging is live. Today, staged rows are plaintext at rest.
**Sealed staging stops being a pending nicety and becomes a prerequisite for
direct read.** That reorders the partner's three client steps from "sequencing,
not a blocker" (their 2026-08-10 note) to on the critical path.

## 6. Vietnam — the brief is stale, and the news is sharper

**[3P, law firms]** Decree 13/2023 was superseded on **2026-01-01** by the
**Personal Data Protection Law (Law 91/2025/QH15)** plus **Decree
356/2025/ND-CP**. The brief cites Decree 13 as current; it is seven months out
of date. What replaced it:

- **Financial data is still sensitive, and more explicitly so.** Decree 356
  names account credentials, bank card details, **transaction history**, and
  customer financial information held by authorised entities. Our staging table
  is a list of exactly that.
- **DPIA is now a filing with a clock, not a document to hold.** Submit to
  **A05** (Cyber Security & Hi-Tech Crime Prevention, Ministry of Public
  Security) **within 60 days of starting processing**, refreshed every 6 months.
- **The startup grace period does not cover us.** Small businesses and startups
  get five years' relief from DPIA obligations — but explicitly *not* entities
  that "directly process sensitive personal data." Processing bank transaction
  data is the carve-out.
- **Cross-border transfer has its own filing.** A Transfer Impact Assessment to
  A05 within 60 days of the first transfer. Supabase, Vercel and Gemini are all
  offshore, so this is live **today, for the forwarding pipeline**, not
  something direct read introduces.
- **Penalties:** up to VND 3bn baseline; up to **5% of prior-year revenue** for
  cross-border violations; up to 10× proceeds for unlawful data trading.

**This is not a reason to prefer forwarding — it applies to both.** But the
brief treated it as parallel paperwork with a lead time. It is better than that:
a 60-day clock from first processing, which the forwarding pipeline has
plausibly already started. Worth a lawyer's hour, not a Claude session's
opinion.

---

## 7. What I recommend

**Sequencing** — do these in order, stop if one fails:

1. **Run the published-unverified experiment (§2).** Cheap, decisive, blocks
   everything else. If restricted scopes work unverified with stable tokens: build
   the whole thing now, beta with ≤100 users, and treat CASA as a scale gate, not
   a start gate.
2. **Submit for verification early, before commissioning any assessment.** The
   Appropriate Access judgement (§4) is the real risk and it is free to test.
3. **Ship sealed staging before the first real mailbox is connected** (§5).
   Reordered onto the critical path.
4. **Then** the spike from the brief's §6.4 — one account, one email, through the
   existing mask → extract → unmask path.

**Keep forwarding.** Four reasons, and none of them is sentiment: the 100-user
cap is a hard ceiling until verification lands; approval is genuinely uncertain
(§4); some users will not grant whole-mailbox access and "read everything or get
nothing" is a bad posture for a privacy-first product; and it works today with
real transactions in it. Retire it only after direct read has been verified,
approved and has staged rows end to end.

**The user-facing privacy sentence** (§6.2 of the brief asked for one that could
be defended publicly — this is a draft, and it is only true once sealed staging
ships):

> Google chỉ có một quyền đọc thư duy nhất, và nó bao trùm toàn bộ hộp thư của
> bạn — không có quyền nào hẹp hơn. FamilyHub chỉ tải về email từ những ngân hàng
> bạn chọn, và chỉ những email đó mới rời khỏi hộp thư của bạn. Nội dung được mã
> hoá bằng khoá của gia đình ngay khi lấy về, nên chỉ nhà bạn đọc được — FamilyHub
> cũng không đọc được. Bạn gỡ quyền bất cứ lúc nào trong tài khoản Google.

> *(EN, for the policy page: Google offers only one mail-reading permission and
> it covers your entire mailbox — there is no narrower one. FamilyHub fetches
> only mail from the banks you choose, and only those emails ever leave your
> mailbox. They are encrypted to your family's key on arrival, so only your
> household can read them — FamilyHub cannot. You can revoke access at any time
> from your Google account.)*

The second sentence is a self-imposed restraint, not a boundary the user can
check — §3.3 of the brief is right about that, and the sentence does not pretend
otherwise. It says what we fetch, not what we *could* fetch, and pairs it with
something that *is* checkable: revocation. The query restriction must be enforced
somewhere auditable for this to stay honest.

---

## Sources

Google: [OAuth 2.0 refresh token expiration](https://developers.google.com/identity/protocols/oauth2) ·
[Manage app audience](https://support.google.com/cloud/answer/15549945) ·
[OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) ·
[Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) ·
[Security assessment](https://support.google.com/cloud/answer/13465431) ·
[OAuth API verification FAQ](https://support.google.com/cloud/answer/13463817) ·
[Unverified apps](https://support.google.com/cloud/answer/7454865) ·
[Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) ·
[Workspace API user data & developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

ADA: [CASA assurance levels](https://appdefensealliance.dev/casa/casa-tiering)

Third-party — assessor pricing: [Switch Labs, CASA providers & pricing](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option) ·
[Leviathan Security, CASA](https://www.leviathansecurity.com/programs/google-casa-cloud-application-security-assessment)

Third-party — Vietnam law: [Tilleke & Gibbins, PDPL closer look](https://www.tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look/) ·
[DFDL, VN personal data protection 2026](https://www.dfdl.com/insights/legal-and-tax-updates/vietnam-personal-data-protection-2026-what-foreign-organizations-need-to-know/) ·
[Vietnam Briefing, Decree 356](https://www.vietnam-briefing.com/news/vietnam-personal-data-protection-regulation-decree-356.html/)
