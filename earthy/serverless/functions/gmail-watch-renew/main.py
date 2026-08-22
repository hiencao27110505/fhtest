"""Renew the Gmail watch on every connected mailbox.

A watch registered with users.watch() lapses after 7 days. When it does, Gmail
simply stops publishing — no error, no notification, and the pipeline goes
quiet with nothing in the logs to explain it. This job exists to make that
impossible: it runs daily and re-registers every mailbox.

Calling watch() again is idempotent. It does not create a second registration;
it pushes the same one's expiry further out. So a mailbox renewed early, or
twice, is harmless — which is what makes a blunt "renew everything daily" job
the right shape here.

Invoked by Cloud Scheduler over HTTP with an OIDC token.
"""

import json
import logging
import os

import accounts
import functions_framework
import gmail_auth
from flask import Request

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

# The topic Gmail publishes change notifications to. Must match the topic
# gmail-transaction-ingest is subscribed to.
WATCH_TOPIC = os.environ.get("WATCH_TOPIC", "gmail-events")

# Which labels count as a change worth reporting. INBOX only: mail filed
# straight into another label is not something this pipeline reacts to.
# Filtering here is far cheaper than filtering after history.list, and
# labelFilterBehavior replaces the deprecated labelFilterAction.
WATCH_LABELS = ["INBOX"]
WATCH_LABEL_BEHAVIOR = "INCLUDE"

STORE = accounts.create_store()


@functions_framework.http
def main(request: Request) -> tuple[str, int]:
    """HTTP entry point. The request carries nothing this job needs."""
    return renew_all()


def renew_all() -> tuple[str, int]:
    """Renew every connected mailbox, and report what happened.

    Separate from the entry point so it can be called — and typed — without
    Flask in the way; the decorator widens `main`'s return type to Flask's
    response union.

    One mailbox failing must not stop the others: a single revoked token would
    otherwise leave every later mailbox unrenewed, and they would all lapse
    silently a week later. Failures are collected and reported instead.
    """
    project = _project()
    if not project:
        log.error("no project id in the environment; cannot build a topic path")
        return _response({"error": "project id not configured"}, 500)

    topic = f"projects/{project}/topics/{WATCH_TOPIC}"
    emails = STORE.list_connected()
    log.info("renewing %d mailbox(es) against %s", len(emails), topic)

    renewed: list[str] = []
    failed: list[dict[str, str]] = []

    needs_reauth: list[str] = []

    for email in emails:
        try:
            expires_at = _renew_one(email, topic)
        except gmail_auth.TokenRejected:
            # Not a failure to retry: the user has to reconnect. Recorded so
            # the next run skips them and the app can prompt.
            log.warning("refresh token rejected for %s; marking for re-consent", email)
            STORE.mark_needs_reauth(email)
            needs_reauth.append(email)
            continue
        except Exception as exc:  # noqa: BLE001 - one bad mailbox must not stop the rest
            # Logged without the exception object's repr, which for Google
            # client errors can carry request details.
            log.warning("renew failed for %s: %s", email, type(exc).__name__)
            failed.append({"email": email, "error": type(exc).__name__})
            continue
        renewed.append(email)
        log.info("renewed %s, watch expires %s", email, expires_at)

    body: dict[str, object] = {
        "renewed": len(renewed),
        "failed": len(failed),
        "needs_reauth": len(needs_reauth),
    }
    if failed:
        body["failures"] = failed

    # 207 when some mailboxes failed: the scheduler should surface it, but a
    # retry would only re-renew the ones that already succeeded.
    return _response(body, 207 if failed else 200)


def _renew_one(email: str, topic: str) -> str:
    """Register the watch for one mailbox and return its new expiry.

    watch() returns the mailbox's position *now* plus when the registration
    lapses. Both are handed to the store in one call: it keeps an existing
    cursor and only fills in a missing one, because overwriting a live cursor
    with "now" would skip every message in between.
    """
    account = STORE.get(email)
    service = gmail_auth.build_client(account.refresh_token)

    result = (
        service.users()
        .watch(
            userId="me",
            body={
                "topicName": topic,
                "labelIds": WATCH_LABELS,
                "labelFilterBehavior": WATCH_LABEL_BEHAVIOR,
            },
        )
        .execute()
    )

    # expiration is epoch MILLISECONDS (13 digits), not seconds.
    expires_at = int(result["expiration"])
    STORE.save_watch(email, str(result["historyId"]), expires_at)
    return _iso(expires_at)


def _iso(epoch_millis: int) -> str:
    """Epoch millis as an ISO timestamp, for the log line."""
    from datetime import UTC, datetime  # noqa: PLC0415

    return datetime.fromtimestamp(epoch_millis / 1000, tz=UTC).isoformat()


def _project() -> str:
    """Project id, from the runtime env on GCP or GCP_PROJECT locally."""
    return os.environ.get("GCP_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT") or ""


def _response(body: dict[str, object], status: int) -> tuple[str, int]:
    return json.dumps(body), status
