# Gmail Push Notifications, Cloud Pub/Sub, and OAuth — How a User-Authorized `watch()` Reaches the App's GCP Project

**Date:** 2026-08-22
**Status:** Verified against primary sources (Google official docs only)
**Scope:** Gmail API `users.watch()` push notifications for **personal @gmail.com mailboxes** where the end user grants OAuth consent to a third-party app. Covers the trust/identity model, the exact IAM grant, watch lifecycle, notification payload, `historyId` semantics, refresh-token rules for background services, and restricted-scope verification. Excludes Google Workspace domain-wide delegation and service-account impersonation (a different model that does **not** apply to consumer @gmail.com accounts).

> **Doc-location note:** The Gmail API documentation moved from `developers.google.com/gmail/api/...` to **`developers.google.com/workspace/gmail/api/...`**. Old URLs redirect. Every URL in Sources is the canonical one actually fetched on 2026-08-22.

---

## Answer to the central question

**The user's OAuth token never touches your GCP project, and the user never publishes anything.**

There are two separate authorization decisions, checked against two different principals:

1. **`watch()` is called with the end user's OAuth access token.** That token authorizes exactly one thing: *this app may watch this user's mailbox.* It confers zero GCP permission. The `topicName` you pass is just a **string naming a destination** — the user is not being asked to access it, and their token is not evaluated against it.

2. **Gmail itself does the publishing, under Google's own service identity** — `gmail-api-push@system.gserviceaccount.com`. That identity lives outside your project and outside the user's account. It can publish to your topic only because **you**, the project owner, granted it `roles/pubsub.publisher` on that topic ahead of time. That grant is the *entire* bridge between the two worlds.

So the flow is not "user → your project". It is **user → Gmail (authorizes mailbox access)** and, separately, **Gmail → your topic (authorized by your IAM grant)**. The user is a data subject in the first leg and completely absent from the second. They need no GCP account, no project access, and no awareness that your project exists.

The `topicName` string is the only thing that crosses the boundary — it tells Gmail *where to deliver*, not *whose rights to use*.

---

## Trust boundaries (ASCII)

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │ END USER  (personal @gmail.com — owns NOTHING in your GCP project)   │
  │   • grants OAuth consent for gmail.readonly (restricted scope)       │
  │   • identity = their Google Account                                  │
  └───────────────┬──────────────────────────────────────────────────────┘
                  │ (1) consent screen, one time
                  │     access_type=offline → refresh token
                  ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ YOUR APP / BACKEND                                                   │
  │   • holds the user's refresh token                                   │
  │   • mints access tokens, calls:                                      │
  │        POST /gmail/v1/users/me/watch                                 │
  │        Authorization: Bearer <USER access token>                     │
  │        body: { topicName: "projects/MYPROJ/topics/gmail-in" }        │
  │                                                                      │
  │     ↑ user's token authorizes MAILBOX READ only.                     │
  │       topicName is a DESTINATION STRING, not a permission claim.     │
  └───────────────┬──────────────────────────────────────────────────────┘
                  │ (2) watch() registers the mailbox → topic mapping
                  ▼
  ┌══════════════════════ GOOGLE-OWNED (neither you nor the user) ══════┐
  ║ GMAIL PUSH SERVICE                                                  ║
  ║   publishes AS: gmail-api-push@system.gserviceaccount.com           ║
  ╚═══════════════┬═════════════════════════════════════════════════════╝
                  │ (3) on mailbox change, PUBLISH
                  │     ── authorized by YOUR pre-existing IAM binding ──
                  │        roles/pubsub.publisher on the topic
                  ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ YOUR GCP PROJECT  (you own; user has no access, no awareness)        │
  │   Pub/Sub topic:        projects/MYPROJ/topics/gmail-in              │
  │     IAM: gmail-api-push@system.gserviceaccount.com                   │
  │          → roles/pubsub.publisher   ◄── THE ONLY BRIDGE              │
  │   Pub/Sub subscription: push (HTTPS POST) or pull                    │
  └───────────────┬──────────────────────────────────────────────────────┘
                  │ (4) {emailAddress, historyId}  — NO mail content
                  ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ YOUR WEBHOOK / WORKER                                                │
  │   (5) history.list(startHistoryId=…) using the USER's token again    │
  │       ↑ back to identity #1 — content fetch is user-authorized       │
  └──────────────────────────────────────────────────────────────────────┘
```

Two identities, two authorizations, one string (`topicName`) linking them.

---

## 1. Whose credentials call `watch()`?

**The end user's OAuth access token.** Not a service account.

The reference page lists `watch` under standard OAuth authorization scopes:

> "Requires one of the following OAuth scopes:
> `https://mail.google.com/`
> `https://www.googleapis.com/auth/gmail.modify`
> `https://www.googleapis.com/auth/gmail.readonly`
> `https://www.googleapis.com/auth/gmail.metadata`"
> — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch

The request is `POST https://gmail.googleapis.com/gmail/v1/users/{userId}/watch`, with `userId` = `me` for the authenticated user (same convention documented on `users.stop`: *"The special value `me` can be used to indicate the authenticated user."* — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop).

For a **consumer @gmail.com** mailbox there is no alternative: service-account impersonation requires Workspace domain-wide delegation, which a personal account cannot grant. `gmail.readonly` is sufficient for a read-only ingestion pipeline.

---

## 2. THE CENTRAL QUESTION — how a user-authorized call reaches your project

**`topicName` is a destination, not a permission.** The reference defines it purely as an address:

> "**topicName** `string` — A fully qualified Google Cloud Pub/Sub API topic name to publish the events to. This topic name **must** already exist in Cloud Pub/Sub and you **must** have already granted gmail "publish" permission on it."
> — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch

Note the second person: *"**you** must have already granted"* — the developer, not the user.

**Who publishes:** Gmail's own service identity. The setup guide instructs:

> "grant `publish` privileges to `gmail-api-push@system.gserviceaccount.com`"
> — https://developers.google.com/workspace/gmail/api/guides/push

That is a Google-owned `@system.gserviceaccount.com` address. It is not your project's service account and not the user. The end user's token is never presented to Pub/Sub.

**When is the grant checked?** Both — but the docs are only explicit about the `watch()`-time check. The reference makes the grant a precondition of `watch` ("must have already granted"), and the guide says:

> "If you receive an error from the `watch` call, the details should explain the source of the problem. This is typically an issue with the setup of the Cloud Pub/Sub topic and subscription."
> — https://developers.google.com/workspace/gmail/api/guides/push

**⚠️ Documentation gap — flagged:** Google does **not** publish the exact HTTP status code or error string returned when the publisher grant is missing. Community reports describe an `HTTP 400` with a message of the form *"User not authorized to perform this action"*, but **this is not stated in any primary source and I could not verify it** — treat the specific code/wording as unverified. What *is* documented: the grant is a stated precondition, and grant/topic misconfiguration is the typical cause of a `watch` error. Similarly, whether Gmail re-verifies the IAM binding at publish time (and silently drops on failure) is **not documented / could not verify**; the safe engineering assumption is that revoking the binding after a successful `watch` will break delivery, so do not revoke it.

**Practical consequence:** validate your IAM binding by calling `watch()` once during setup and treating a non-200 as a configuration failure, not a per-user failure.

---

## 3. The exact IAM grant

| Item | Value |
|---|---|
| **Principal** | `gmail-api-push@system.gserviceaccount.com` (Google-owned; not in your project) |
| **Role** | `roles/pubsub.publisher` |
| **Resource** | the specific topic: `projects/PROJECT_ID/topics/TOPIC_NAME` |

Role definition, verbatim:

> "**Pub/Sub Publisher** (`roles/pubsub.publisher`) — Provides access to publish messages to a topic."
> Permission granted: `pubsub.topics.publish`
> — https://docs.cloud.google.com/pubsub/docs/access-control

Pub/Sub IAM is settable **per topic**, so scope the grant to the single topic rather than project-wide.

**Exact command shown in the docs.** The Gmail push guide itself directs you to the **Cloud console** ("Cloud Pub/Sub permissions console in the Google Cloud console") and does **not** print a gcloud command. The Pub/Sub access-control page shows the policy-file form:

```bash
gcloud pubsub topics set-iam-policy \
    projects/PROJECT_ID/topics/TOPIC_NAME \
    policy.json
```
— https://docs.cloud.google.com/pubsub/docs/access-control

**⚠️ Flag:** the commonly-circulated one-liner

```bash
gcloud pubsub topics add-iam-policy-binding TOPIC_NAME \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

is a valid gcloud invocation and is equivalent in effect, but **it is not printed verbatim in either primary source I read.** Use it if you like, but don't cite it as documented.

**Org-policy caveat, verbatim:**

> "Your organization's domain restricted sharing configuration might prevent you from granting publish permissions. To resolve this, you can configure an exception for this service account."
> — https://developers.google.com/workspace/gmail/api/guides/push

This bites projects inside a Workspace org: `gmail-api-push@system.gserviceaccount.com` is outside your domain, so Domain Restricted Sharing will silently reject the binding until an exception is added.

---

## 4. Does the end user need ANY GCP permission or awareness?

**No. Definitively no.**

Nothing in any primary source requires, mentions, or implies end-user involvement in the app's GCP project. The reference addresses the grant to the developer (*"you must have already granted gmail 'publish' permission on it"*), the guide addresses topic/subscription creation to the developer, and the publishing principal is a Google-owned system account. The user's only action is the OAuth consent screen, which shows **Gmail scopes only** — it does not name your project's Pub/Sub topic and does not request any Cloud IAM permission.

The user needs: a Google Account and one consent click. They need **no** GCP account, **no** billing, **no** project access, and receive **no** indication that Pub/Sub is involved.

(Your project *does* need Pub/Sub enabled and, per general GCP rules, billing configured for Pub/Sub usage — that is your cost, not the user's.)

---

## 5. Watch expiry & renewal

**Response body**, verbatim:

> "**historyId** `string` — The ID of the mailbox's current history record."
> "**expiration** `string (int64 format)` — When Gmail will stop sending notifications for mailbox updates (epoch millis)."
> — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch

Example from the guide:

```
{ historyId: 1234567890, expiration: 1431990098200 }
```
— https://developers.google.com/workspace/gmail/api/guides/push

`expiration` is **epoch milliseconds** (13 digits) — not seconds. A classic off-by-1000 bug.

**Expiry duration and renewal cadence**, verbatim:

> "You must call `watch` at least every 7 days or else you will stop receiving updates for the user. We recommend calling `watch` once per day."
> — https://developers.google.com/workspace/gmail/api/guides/push

So: **7-day maximum lifetime, renew daily.** The one-day cadence gives six days of slack for outages.

**What happens when a watch lapses:** it **silently stops**. The docs say only "you will stop receiving updates" — there is no terminal notification, no error pushed to your topic, and no callback. Your system must detect this itself (e.g. track `expiration` per user and alert if renewal fails). **⚠️ The docs do not describe any lapse signal — verified absent, not omitted here.**

**Is repeat `watch()` idempotent?** Calling `watch` again on the same mailbox re-registers it and returns a fresh `expiration`; this is exactly what the daily-renewal recommendation prescribes, so repeated calls are the intended steady-state behavior. **⚠️ However, the docs never explicitly state the semantics of a second `watch` with a *different* `topicName` or different `labelIds`** — whether it replaces the prior registration or coexists is **not documented / could not verify**. The strong implication of "one watch per mailbox" is that the latest `watch` replaces the prior one, but treat that as inference. Safe practice: always call `watch` with identical parameters; if you must change topic or filters, call `users.stop` first.

**Stopping:** `POST /gmail/v1/users/{userId}/stop` — *"Turn off push notification delivery for the given user mailbox."* Empty request body, empty JSON object response. — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop

---

## 6. Notification payload

Gmail publishes a message to your topic; Pub/Sub then delivers it. **Push** delivery POSTs this envelope, verbatim from the guide:

```
POST https://yourserver.example.com/yourUrl
{
  message: {
    // This is the actual notification data, as base64url-encoded JSON.
    data: "eyJlbWFpbEFkZHJlc3MiOiAidXNlckBleGFtcGxlLmNvbSIsICJoaXN0b3J5SWQiOiAiMTIzNDU2Nzg5MCJ9",

    // This is a Cloud Pub/Sub message id, unrelated to Gmail messages.
    "messageId": "2070443601311540",

    // This is the publish time of the message.
    "publishTime": "2021-02-26T19:13:55.749Z",
  }

  subscription: "projects/myproject/subscriptions/mysubscription"
}
```
— https://developers.google.com/workspace/gmail/api/guides/push

**Decoded `data`**, verbatim:

```
{"emailAddress": "user@example.com", "historyId": "9876543210"}
```
— same page

**Encoding:** `message.data` is **base64url**-encoded JSON (URL-safe alphabet: `-`/`_`, padding may be present or stripped). Decode with a base64url decoder, not plain base64.

**Is mail content ever included? No.** The payload carries only the mailbox address and a `historyId`. There is no subject, sender, body, or message ID of any Gmail message. The guide is explicit that you then call `history.list` to learn what changed. This is a privacy/design property, not an option you can turn on — **there is no documented way to include content in the notification.**

Note the comment in Google's own example: *"This is a Cloud Pub/Sub message id, unrelated to Gmail messages."* Do not confuse `message.messageId` (Pub/Sub) with a Gmail message id.

**Acknowledgement:** for push subscriptions, *"responding successfully (for example, HTTP 200) acknowledges the notification"* (Gmail guide). Pub/Sub's own contract is broader — return one of `102, 200, 201, 202, 204`; any other code is a nack and the message is redelivered (https://docs.cloud.google.com/pubsub/docs/push). For pull subscriptions you must explicitly call acknowledge.

---

## 7. `historyId` semantics

**What it is:** *"The ID of the mailbox's current history record"* (watch and history.list responses). It is a monotonically increasing per-mailbox cursor over mailbox mutations — not a message id and not comparable across mailboxes.

**How `history.list` works:**

> "Returns history records after the specified `startHistoryId`. The supplied `startHistoryId` should be obtained from the `historyId` of a message, thread, or previous `list` response."
> — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list

`historyTypes[]` filters record kinds: `messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`. Response carries `history[]`, `historyId` (new cursor), and `nextPageToken`.

**Retention**, verbatim:

> "A `historyId` is typically valid for at least a week, but in some rare circumstances may be valid for only a few hours."
> — same page

Note the hedge: **"at least a week" is not a guarantee, and "a few hours" is an explicitly acknowledged case.** Do not design assuming a week of replay.

**Error when too old**, verbatim:

> "Supplying an invalid or out of date `startHistoryId` typically returns an `HTTP 404` error code."
> — same page

**Prescribed recovery**, verbatim:

> "If you receive an `HTTP 404` error response, your application should perform a full sync."
> — same page

So a **404 is a normal, expected control-flow signal**, not an exception to alert on. Your ingestion worker must implement a full-sync fallback path from day one.

**One notification ≠ one message.** Changes are coalesced. The guide states:

> "Each Gmail user being watched has a maximum notification rate of one event per second. Any user notifications exceeding that rate are dropped."
> — https://developers.google.com/workspace/gmail/api/guides/push

Combined with the cursor model: a single notification can cover **many** mailbox changes, and notifications can be **dropped outright** under load. The `historyId` in the notification is therefore a *hint that something changed*, not a per-message event. **Always drive off your own last-processed `historyId`, never off the one in the payload as if it were the only delta.** Duplicate deliveries are also possible (Pub/Sub is at-least-once) — handle idempotently.

---

## 8. OAuth for a background service

**Obtaining a refresh token**, verbatim:

> "Set the value to `offline` if your application needs to refresh access tokens when the user is not present at the browser."
> — https://developers.google.com/identity/protocols/oauth2/web-server

> "the refresh token is only returned if your application set the `access_type` parameter to `offline` in the initial request to Google's authorization server"
> — same page

Critically:

> "the `refresh_token` is only returned on the first authorization."
> — same page

**This is the #1 background-service bug.** A user who re-authorizes gets an access token but **no refresh token**, so if you lost the first one you are stuck. The remedy is `prompt=consent`, which forces the consent screen and re-issues a refresh token: *"call the setPrompt function to set 'consent' will prompt the user for consent"* (same page). For a background pipeline, always send `access_type=offline&prompt=consent` and persist the refresh token on receipt.

**Documented causes of refresh-token expiry**, verbatim list:

> - "The user has revoked your app's access"
> - "The refresh token has not been used for six months"
> - "The user changed passwords and the refresh token contains Gmail scopes"
> - "The user account has exceeded a maximum number of granted (live) refresh tokens"
> - "The user granted time-based access to your app and the access expired"
> - (admin restricted services in your app's scopes → error `admin_policy_enforced`)
> — https://developers.google.com/identity/protocols/oauth2

**Note the third item — it is Gmail-specific and directly affects you: a user changing their Google password invalidates refresh tokens carrying Gmail scopes.** Your service must handle re-auth gracefully, not treat it as a crash.

**THE 7-DAY TESTING RULE — CONFIRMED.** Projects with an **external** user type and publishing status **Testing** issue refresh tokens that expire in **7 days**, unless scopes are limited to name/email/profile:

> "If your OAuth client requests an `offline` access type and receives a refresh token, that token will also expire" — alongside authorizations expiring after seven days.
> — https://support.google.com/cloud/answer/15549945

> Projects with external user type consent screens and "Testing" status receive tokens expiring in 7 days, unless scopes are limited to "name, email address, and user profile."
> — https://developers.google.com/identity/protocols/oauth2

**This is fatal for a background Gmail pipeline in Testing status.** Gmail scopes are never in the exempt set, so every refresh token dies weekly and the user must re-consent. You cannot ship a "set it and forget it" ingestion service until the app is **In production**.

**Test-user cap**, verbatim:

> "Projects configured with a publishing status of **Testing** are limited to up to 100 test users"
> — https://support.google.com/cloud/answer/15549945

> "Projects configured with a publishing status of **In production** are available to any user with a Google Account"
> — same page

**Refresh-token count cap:** 100 refresh tokens per Google Account per OAuth client ID; exceeding it silently invalidates the **oldest** token (https://developers.google.com/identity/protocols/oauth2). Relevant if you mint tokens repeatedly for the same user — don't; persist and reuse.

---

## 9. Restricted scope verification

**`gmail.readonly` is a RESTRICTED scope — confirmed.** All four `watch`-capable scopes are restricted:

> `https://mail.google.com/` — "Read, compose, send, and permanently delete all your email from Gmail." (Restricted)
> `https://www.googleapis.com/auth/gmail.readonly` — "View your email messages and settings." (Restricted)
> `https://www.googleapis.com/auth/gmail.metadata` — "View your email message metadata such as labels and headers, but not the email body." (Restricted)
> `https://www.googleapis.com/auth/gmail.modify` — "Read, compose, and send emails from your Gmail account. …" (Restricted)
> — https://developers.google.com/workspace/gmail/api/auth/scopes; restricted classification corroborated at https://support.google.com/cloud/answer/13464325

**There is no non-restricted path to push notifications.** Every scope `watch()` accepts is restricted. You cannot avoid verification by downgrading — even `gmail.metadata`, the narrowest, is restricted.

**Verification requirement**, verbatim:

> "Apps requesting access to scopes categorized as sensitive or restricted must complete Google's OAuth app verification before being granted access."
> — https://support.google.com/cloud/answer/9110914

**Security assessment (CASA)**, verbatim:

> "applications requesting access to restricted scopes must undergo an annual security assessment."
> — https://support.google.com/cloud/answer/13465431

The assessment verifies apps can *"securely handle data and delete user data upon request"*, uses OWASP-based standardized requirements, and assigns a tiered assurance level **AL1 or AL2**. On success you receive a **Letter of Validation (LOV)**.

**Validity/timeline**, verbatim:

> "All applications must be revalidated every year."
> — same page

Once validated at the highest level (AL2), apps continue at that level in subsequent years.

**⚠️ Cost — not documented / could not verify.** The Google support page states **no fee or pricing information**. Third-party assessor pricing is widely discussed outside Google's docs, but since primary sources are silent I will not quote a number. Likewise **calendar turnaround time for verification is not stated** on the pages read — only the annual revalidation cadence. Budget and schedule from an assessor quote, not from these docs.

**Practical takeaway:** while unverified, you are capped at **100 test users** with **7-day refresh tokens**. That is workable for a prototype or personal/internal use, and unworkable for a public product without completing verification + CASA.

---

## 10. Gotchas

Things that will bite a naive implementation, each documented above:

1. **`expiration` is epoch *milliseconds*, not seconds.** 13 digits. Dividing or not-dividing by 1000 is the classic bug.
2. **`message.data` is base64*url*, not standard base64.** Use a URL-safe decoder; expect possibly-stripped padding.
3. **Notifications contain no mail content — ever.** Only `{emailAddress, historyId}`. Every implementation must do a second, user-token-authorized `history.list` call.
4. **One notification can represent many changes, and notifications can be dropped.** Rate cap is *"one event per second"* per watched user; *"Any user notifications exceeding that rate are dropped."* Never treat a notification as "one new email."
5. **Pub/Sub is at-least-once — expect duplicates.** Deduplicate on Gmail message id after `history.list`, not on `message.messageId`.
6. **`HTTP 404` from `history.list` is expected control flow**, not an outage. *"your application should perform a full sync."* Build the full-sync path first, not as an afterthought.
7. **`historyId` retention is "typically at least a week… in some rare circumstances may be valid for only a few hours."** Do not assume a week of replay headroom.
8. **A lapsed watch fails silently.** No error, no final notification. Track `expiration` per user and monitor renewal failures yourself.
9. **Renew daily, not weekly.** *"You must call `watch` at least every 7 days… We recommend calling `watch` once per day."* Weekly renewal has zero slack for an outage.
10. **`refresh_token` is only returned on the *first* authorization.** Without `prompt=consent`, a re-authorizing user yields no refresh token. Persist it the moment you get it.
11. **A Google password change invalidates refresh tokens containing Gmail scopes.** Re-auth is a normal lifecycle event for a Gmail integration.
12. **Testing publishing status = 7-day refresh tokens + 100 test users.** A background pipeline effectively cannot run unattended until the app is In production. This is the single biggest schedule risk.
13. **All `watch`-capable scopes are restricted** → OAuth verification + **annual** CASA security assessment. There is no cheaper scope.
14. **Domain Restricted Sharing can block the IAM grant** if your project is in a Workspace org — `gmail-api-push@…` is external to your domain. *"you can configure an exception for this service account."*
15. **`labelFilterAction` is deprecated** — *"This field is deprecated because it caused incorrect behavior in some cases."* Use **`labelFilterBehavior`** (`INCLUDE` / `EXCLUDE`). With `labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE"` you get notifications only for INBOX changes; unspecified `labelIds` means *"all changes are pushed out."* Filtering at `watch()` time is far cheaper than filtering after `history.list`.
16. **Grant the publisher role on the *topic*, not the project.** Pub/Sub IAM is per-resource; a project-wide grant to a Google system account is needlessly broad.
17. **Do not confuse `message.messageId` with a Gmail message id** — Google's own example comments on this.
18. **Two credentials in one pipeline.** `watch()` and `history.list` use the *user's* token; the topic/IAM/subscription use *your* project's admin identity. Mixing them up (e.g. trying a service account against a consumer mailbox) is the root of most confusion here.

**Must the topic be in the same GCP project as the OAuth client?**
**⚠️ Not documented / could not verify.** No primary source read states a same-project requirement. The guide says only that the topic *"can be any name you choose under your project."* Since authorization runs entirely through the IAM binding on the topic (not through your OAuth client), a cross-project topic is *mechanically* plausible — but this is **inference, not documentation**. Keeping the topic in the same project as the OAuth client is the documented, safe configuration.

**Rate limits on `watch()` itself:**
**⚠️ Not documented / could not verify.** The guide documents a *notification* rate cap (one event/second per watched user) but states no explicit quota on `watch()` API calls. General Gmail API per-user and per-project quota units apply, but no `watch`-specific limit is published. If you renew daily across many users, spread the calls rather than bursting at midnight.

**Only one watch per mailbox?**
Strongly implied — the model is a single mailbox→topic registration renewed in place, and `users.stop` takes no topic argument (*"Turn off push notification delivery for the given user mailbox"*, request body empty), which only makes sense if there is one registration to turn off. **But the docs never state it explicitly**, so this is inference. Treat it as one watch per mailbox and call `stop` before re-pointing to a different topic.

---

## Sources

All fetched 2026-08-22.

**Gmail API**
- https://developers.google.com/workspace/gmail/api/guides/push — Push notification setup guide (central page: Pub/Sub setup, IAM grant, watch example, renewal, payload, rate limit)
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch — `users.watch` reference (topicName, labelIds, labelFilterBehavior, historyId, expiration, scopes)
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop — `users.stop` reference
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list — `users.history.list` (startHistoryId, 404 semantics, retention, historyTypes)
- https://developers.google.com/workspace/gmail/api/auth/scopes — Gmail API scope list

**Cloud Pub/Sub**
- https://docs.cloud.google.com/pubsub/docs/access-control — IAM roles incl. `roles/pubsub.publisher`, `set-iam-policy` command *(canonical; `cloud.google.com/pubsub/docs/access-control` 301-redirects here)*
- https://docs.cloud.google.com/pubsub/docs/push — push subscription request format and ack status codes

**OAuth 2.0 / verification**
- https://developers.google.com/identity/protocols/oauth2/web-server — `access_type=offline`, `prompt=consent`, refresh token returned only on first authorization
- https://developers.google.com/identity/protocols/oauth2 — refresh token expiry causes, Testing-status 7-day rule, 100-token-per-client cap
- https://support.google.com/cloud/answer/15549945 — publishing status Testing vs In production, 100 test users, 7-day expiry
- https://support.google.com/cloud/answer/9110914 — OAuth app verification requirement for sensitive/restricted scopes
- https://support.google.com/cloud/answer/13464325 — list of restricted scopes (Gmail scopes confirmed restricted)
- https://support.google.com/cloud/answer/13465431 — annual security assessment (CASA), AL1/AL2, Letter of Validation

**Explicitly unverified / documentation silent** (stated as such in-line above, not guessed):
exact error code+message when the publisher grant is missing; whether the IAM binding is re-checked at publish time; semantics of a second `watch()` with different topic/labels; whether the topic must be in the same project as the OAuth client; any `watch()`-specific API rate limit; CASA assessment cost and verification turnaround time.
