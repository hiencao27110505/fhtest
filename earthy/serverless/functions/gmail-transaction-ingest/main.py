"""Gmail push notification -> transaction email ingest.

Gmail's watch() posts to a Pub/Sub topic whenever the mailbox changes. The
message payload is only {"emailAddress": ..., "historyId": ...} — it carries no
mail content, so the actual messages have to be fetched with users.history.list
starting from the last historyId this function processed.

The pipeline is multi-user: each notification names the mailbox it belongs to,
and credentials for that mailbox come from the account store (accounts.py).

This stage only identifies transaction mail and forwards it. Parsing amounts is
a separate concern; see README for the intended split.
"""

import base64
import json
import logging
import os

import accounts
import functions_framework
import gmail_auth
import senders
from cloudevents.http import CloudEvent

# basicConfig is a no-op on Cloud Functions: the runtime configures the root
# logger before this module is imported, so the level has to be set here or
# INFO records are dropped.
log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

# Built once per instance: cheap, and the Postgres-backed store will want to
# hold a connection pool rather than reconnect per invocation.
STORE = accounts.create_store()

# Where detected transactions go next. Must match transaction-parser's
# [tool.earthy.gcf] topic.
DOWNSTREAM_TOPIC = os.environ.get("DOWNSTREAM_TOPIC", "transaction-detected")


@functions_framework.cloud_event
def main(cloud_event: CloudEvent) -> None:
    """Entry point. Raising re-queues the message, so raise only on transient
    failures — a permanent error would otherwise redeliver until the topic's
    retention expires."""
    notification = _decode(cloud_event)
    if notification is None:
        return  # malformed: ack and drop, retrying will not help

    email = notification.get("emailAddress")
    history_id = notification.get("historyId")
    if not email or not history_id:
        log.warning(
            "notification missing emailAddress/historyId: %s", notification)
        return

    log.info("gmail change for %s at historyId=%s", email, history_id)

    try:
        account = STORE.get(email)
    except accounts.UnknownMailbox:
        # Permanent: the mailbox is not connected (or was disconnected while
        # its watch was still live). Retrying cannot help, so ack and drop.
        log.warning("no account on file for %s; dropping notification", email)
        return

    try:
        service = gmail_auth.build_client(account.refresh_token)
    except gmail_auth.TokenRejected:
        # Permanent until the user reconnects — revoked, password changed, or
        # the 7-day expiry that applies to every token while the app is in
        # Testing status. Retrying cannot fix it, so record it and ack.
        log.warning("refresh token rejected for %s; marking for re-consent", email)
        STORE.mark_needs_reauth(email)
        return

    # Without a stored cursor there is no window to read: the notification's
    # own historyId is the newest change, not a starting point. Fall back to
    # it so the first run after connecting has somewhere to begin.
    start_id = account.history_id or history_id
    messages = _added_message_ids(service, start_id)
    log.info("%d new message(s) since historyId=%s", len(messages), start_id)

    hits = 0
    for message_id in messages:
        message = _message(service, message_id)
        if message is None:
            continue
        label = senders.match(message["from"])
        if label is None:
            log.debug("skip %s from %s", message_id, message["from"])
            continue
        hits += 1
        log.info(
            "TRANSACTION source=%s message_id=%s subject=%r date=%s",
            label,
            message_id,
            message["subject"],
            message["date"],
        )
        _publish(
            DOWNSTREAM_TOPIC,
            {
                "message_id": message_id,  # idempotency key for the parser
                "source": label,
                "subject": message["subject"],
                "date": message["date"],
                "body": message["body"],
            },
        )

    log.info("done: %d/%d message(s) matched a known sender", hits, len(messages))

    # Written last, on purpose: delivery is at-least-once, so a crash mid-loop
    # should replay the same window rather than skip past it.
    STORE.save_history_id(email, history_id)


def _decode(cloud_event: CloudEvent) -> dict | None:
    """Pull the JSON payload out of the Pub/Sub envelope.

    The data is base64-encoded inside message.data; anything unparseable is a
    permanent failure and returns None rather than raising.
    """
    try:
        message = cloud_event.data["message"]
    except (TypeError, KeyError):
        log.error("event carried no Pub/Sub message: %r", cloud_event.data)
        return None

    raw = message.get("data")
    if not raw:
        log.error("Pub/Sub message had no data field")
        return None

    try:
        return json.loads(base64.b64decode(raw).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        log.error("could not decode notification payload: %s", exc)
        return None


def _added_message_ids(service, start_history_id: str) -> list[str]:
    """Message ids added since start_history_id, oldest first, deduplicated.

    A 404 means the history window has expired (Gmail keeps roughly a week);
    the caller cannot recover those messages, so it is logged and treated as
    an empty result rather than retried forever.
    """
    from googleapiclient.errors import HttpError  # noqa: PLC0415

    seen: list[str] = []
    page_token = None
    try:
        while True:
            response = (
                service.users()
                .history()
                .list(
                    userId="me",
                    startHistoryId=start_history_id,
                    historyTypes=["messageAdded"],
                    pageToken=page_token,
                )
                .execute()
            )
            for record in response.get("history", []):
                for added in record.get("messagesAdded", []):
                    message_id = added["message"]["id"]
                    if message_id not in seen:
                        seen.append(message_id)
            page_token = response.get("nextPageToken")
            if not page_token:
                return seen
    except HttpError as exc:
        if exc.status_code == 404:
            log.warning(
                "history %s expired; a full resync is needed", start_history_id)
            return []
        raise  # transient (429/5xx): let Pub/Sub redeliver


def _message(service, message_id: str) -> dict | None:
    """Fetch one message, headers and body.

    format="full" costs more than "metadata", but it means the parser stage
    never has to touch Gmail: the body travels with the event instead.
    """
    from googleapiclient.errors import HttpError  # noqa: PLC0415

    try:
        message = (
            service.users()
            .messages()
            .get(userId="me", id=message_id, format="full")
            .execute()
        )
    except HttpError as exc:
        if exc.status_code == 404:
            log.warning(
                "message %s vanished before it could be read", message_id)
            return None
        raise

    payload = message.get("payload", {})
    values = {h["name"].lower(): h["value"]
              for h in payload.get("headers", [])}
    return {
        "from": values.get("from", ""),
        "subject": values.get("subject", ""),
        "date": values.get("date", ""),
        "body": _body(payload),
    }


def _body(payload: dict) -> str:
    """Best-effort plain text of a message body.

    Walks the MIME tree preferring text/plain, falling back to text/html.
    Gmail base64url-encodes part data.
    """
    plain, htm = _collect_parts(payload)
    raw = plain or htm
    if not raw:
        return ""
    try:
        return base64.urlsafe_b64decode(raw).decode("utf-8", errors="replace")
    except (ValueError, TypeError) as exc:
        log.warning("could not decode message body: %s", exc)
        return ""


def _collect_parts(part: dict) -> tuple[str, str]:
    """Return (text/plain data, text/html data) found anywhere in the tree."""
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data", "")
    if data:
        if mime == "text/plain":
            return data, ""
        if mime == "text/html":
            return "", data

    plain = htm = ""
    for child in part.get("parts", []):
        child_plain, child_html = _collect_parts(child)
        plain = plain or child_plain
        htm = htm or child_html
    return plain, htm


def _publish(topic: str, payload: dict) -> None:
    """Hand a detected transaction to the parser stage.

    Raises on failure so Pub/Sub redelivers: losing a detected transaction is
    worse than processing it twice, which message_id already guards against.
    """
    from google.cloud import pubsub_v1 as pubsub  # noqa: PLC0415

    publisher = pubsub.PublisherClient()
    path = publisher.topic_path(_project(), topic)
    future = publisher.publish(path, json.dumps(payload).encode("utf-8"))
    future.result(timeout=30)


def _project() -> str:
    """Project id, from the runtime env on GCP or GCP_PROJECT locally."""
    return (
        os.environ.get("GCP_PROJECT")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or ""
    )
