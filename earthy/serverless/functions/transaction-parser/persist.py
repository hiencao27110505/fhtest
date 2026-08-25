"""Hand a parsed transaction to FamilyHub, which seals and stages it.

This is the other end of the `# TODO: persist` that used to close main.py. The
reading crosses one HTTP call to the FamilyHub Edge Function
(`mailbox-sync/ingest`), and everything after that — sealing to the family's
key, deduplication, the review queue, the push to the owner's device — is that
side's code, already built and tested against the same payload shape this file
sends (`pipeline/direct-ingest.test.js` in the FamilyHub repo drives the real
sealer with a payload built by THIS module, so the contract cannot drift
silently).

WHY THE SEAL IS NOT HERE. A staged row is encrypted to `family_keys.staging_pub`
by whoever holds the plaintext last. Doing that here would mean a second
implementation of the envelope in a second language against a single client
opener, and a second DEDUP_FP_KEY space — and a second key space fails silently:
every cross-transport duplicate simply stops being caught. One implementation,
one key, one boundary; this side reads mail, that side owns ciphertext.

WHO MAY CALL IT. The endpoint authenticates on a shared secret
(FAMILYHUB_INGEST_SECRET = the function's MAILBOX_SYNC_SECRET), sent as a
header. Both env vars unset = the stage is off and the pipeline behaves exactly
as before this file existed: parse, announce, done.

THE ERROR CONTRACT, which is the only subtle thing here:

* 2xx        — done, whatever the body says. The body's `status` is a fact
               about the mailbox (`staged`, `held`, `skipped`, `ignored`,
               `rejected`), not a fault; `held` and `rejected` are logged
               loudly because a human will want to know, but they are FINAL
               for this delivery. FamilyHub's own 5-minute poll is the layer
               that retries a `held` mailbox, from its own cursor, with the
               original mail — this call must not fight it.
* 4xx        — misconfiguration (wrong secret, wrong URL). Logged as an error
               and SWALLOWED: a redelivery would fail identically, and the
               poll on the other side stages the mail anyway, so nothing is
               lost while a human fixes the config.
* 5xx / net  — transient. RAISED, so Pub/Sub redelivers and the write is
               retried. The other side is idempotent on message_id, so a
               retry that half-landed costs one lookup.
"""

# Annotations stay strings so this module runs under any interpreter the
# cross-repo contract test finds — it is imported by a FamilyHub test that must
# not require this package's own toolchain.
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

# Same budget discipline as notify: the function has a 60s deadline and the
# model call has already spent most of it on a cold template.
_TIMEOUT_SECONDS = 10


class PersistUnavailable(Exception):
    """FamilyHub answered 5xx or did not answer. Raised so Pub/Sub redelivers."""


def enabled() -> bool:
    return bool(
        os.environ.get("FAMILYHUB_INGEST_URL") and os.environ.get("FAMILYHUB_INGEST_SECRET")
    )


def build_payload(payload: dict, reading, category: str | None) -> dict | None:
    """The exact JSON `mailbox-sync/ingest` validates, or None if this event
    cannot be persisted at all.

    None happens for one reason: the event carries no `mailbox`. That is an
    ingest deployed before the field existed — the reading is genuinely
    unroutable, since the mailbox is the only link to a member, a family, and a
    key. Returning None (logged by the caller) rather than guessing is the
    whole point; there is no safe default for "whose money is this".

    Field names on the wire are the receiving side's names, translated HERE at
    the boundary rather than leaking either side's conventions into the other.
    `occurred_at` goes as ISO-8601; the parser holds a datetime.
    """
    mailbox = payload.get("mailbox")
    if not mailbox:
        return None

    occurred_at = reading.occurred_at
    return {
        "email": mailbox,
        "gmailMessageId": payload["message_id"],
        "sourceProvider": str(payload.get("source", "")),
        "senderKind": payload.get("kind"),
        "from": payload.get("from"),
        # The body rides along for one reason: the receiving side's memo tidy
        # detects the account holder's name by it appearing ELSEWHERE in the
        # mail, which the memo alone cannot answer. It is used there and never
        # stored — their stage builder writes no raw_body under any transport.
        "body": payload.get("body", ""),
        "reading": {
            "amount": reading.amount,
            "balance": reading.balance,
            "direction": reading.direction,
            "merchant": reading.merchant,
            "description": reading.description,
            "occurred_at": occurred_at.isoformat() if occurred_at is not None else None,
            "reference": reading.reference,
            "account_tail": reading.account_tail,
            "channel": reading.channel,
            "category": category,
        },
    }


def save(payload: dict, reading, category: str | None) -> str | None:
    """Send one reading. Returns FamilyHub's `status` word, or None if the
    stage is off or the event predates the `mailbox` field.

    Raises PersistUnavailable only for failures a redelivery can fix.
    """
    if not enabled():
        return None

    body = build_payload(payload, reading, category)
    if body is None:
        log.error(
            "cannot persist %s: event carries no mailbox — ingest predates the field?",
            payload.get("message_id"),
        )
        return None

    request = urllib.request.Request(  # noqa: S310 - operator-configured https endpoint
        os.environ["FAMILYHUB_INGEST_URL"],
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            # A header, not a query parameter: URLs land in access logs.
            "x-sync-secret": os.environ["FAMILYHUB_INGEST_SECRET"],
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            answer = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
    except urllib.error.HTTPError as exc:
        if 500 <= exc.code:
            raise PersistUnavailable(f"familyhub ingest HTTP {exc.code}") from exc
        # 4xx: wrong secret or wrong URL. Redelivery fails identically, and the
        # FamilyHub poll stages this mail regardless, so log and stand down.
        log.error("familyhub ingest refused HTTP %s for %s — check "
                  "FAMILYHUB_INGEST_URL/SECRET", exc.code, payload.get("message_id"))
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PersistUnavailable(f"familyhub ingest unreachable: {type(exc).__name__}") from exc

    status = str(answer.get("status", ""))
    if status in ("held", "rejected"):
        # Facts, not faults — but facts a human wants surfaced. `held` means the
        # family has no staging key yet (their poll heals it); `rejected` means
        # THIS module sent something their validation refused, which is a bug
        # here, not there.
        log.warning(
            "familyhub ingest %s message %s: %s",
            status, payload.get("message_id"), answer.get("reason", ""),
        )
    else:
        log.info("familyhub ingest %s message %s", status or "?", payload.get("message_id"))
    return status or None
