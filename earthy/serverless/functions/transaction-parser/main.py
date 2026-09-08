"""transaction-detected -> parsed transaction.

Fed by gmail-transaction-ingest, which sends the mail body along with the
message metadata. Nothing here talks to Gmail, so this function needs no
credentials and can be tested with a static payload.

`body` arrives already normalised: ingest runs `mailtext.strip_html` and
`mailtext.declutter` before publishing, so what reaches the topic is text
rather than the 4.5MB HTML document Gmail hands over. This function no longer
flattens anything — see that module for why the split is on that side.

Reading a mail is `parser.parse`, one call: how it does it — a stored rule, or
a model that then learns one — is the parser package's business and
deliberately not this file's. See `parser/__init__.py`.

When persistence is configured, a valid reading is handed to the existing
mailbox-sync boundary, which owns tidy, deduplication, encryption and insert.
"""

import base64
import json
import logging

import functions_framework
import notify
import parser
import persist
from cloudevents.http import CloudEvent

# basicConfig is a no-op on Cloud Functions: the runtime configures the root
# logger before this module is imported, so the level has to be set here or
# INFO records are dropped.
log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

# Built once per instance: the Postgres-backed store holds a connection pool
# rather than reconnecting per invocation.
STORE = parser.create_store()

# What separates one field from the next once the tags are gone. Bank mail lays
# its fields out in a table, so a cell boundary is the ONLY thing between a


@functions_framework.cloud_event
def main(cloud_event: CloudEvent) -> None:
    """Entry point. Delivery is at-least-once, so `message_id` is the key that
    keeps a redelivery from counting twice once this writes anywhere."""
    payload = _decode(cloud_event)
    if payload is None:
        return  # malformed: ack and drop, retrying will not help

    message_id = payload.get("message_id")
    source = payload.get("source")
    body = payload.get("body") or ""

    if not message_id or not body:
        log.warning("payload missing message_id/body: keys=%s", sorted(payload))
        return

    subject = str(payload.get("subject", ""))
    result = parser.parse(
        parser.EmailInput(source=str(source or ""), subject=subject, body=str(body)),
        STORE,
    )

    reading = result.reading
    if reading is None:
        # Not an error: an unrecognised template is normal until the pipeline
        # has learned one. Logged at warning so the gaps are easy to find.
        log.warning(
            "UNREAD source=%s message_id=%s code=%s stage=%s",
            source,
            message_id,
            result.failure_code or "unknown",
            result.stage or "none",
        )
        # The subject EARNS its place here, unlike on the success path: when
        # nothing could be read, the mail's own title is the only handle a
        # person has on which message this was. `reasons` says what was
        # missing, so a gap is actionable instead of just disappointing.
        _announce(
            f"⚠️ <b>Chưa đọc được</b>\n"
            f"Mã lỗi: {notify.escape(str(result.failure_code or 'unknown'))}\n"
            f"Nguồn: {notify.escape(str(source))}"
        )
        return

    log.info(
        "PARSED source=%s message_id=%s stage=%s learned=%s category_source=%s",
        source,
        message_id,
        result.stage,
        result.learned,
        result.category_source or "-",
    )
    if persist.configured():
        outcome = persist.send(
            persist.build_payload(
                email=str(payload.get("email") or ""),
                message_id=str(message_id),
                source=str(source or ""),
                sender_kind=str(payload.get("sender_kind") or "bank"),
                from_header=str(payload.get("from") or ""),
                body=str(body),
                reading=reading,
                category=result.category,
            )
        )
        log.info(
            "STAGING source=%s message_id=%s outcome=%s reason=%s",
            source,
            message_id,
            outcome.status,
            outcome.reason or "-",
        )
    _announce(_parsed_message(reading, result, source))


def _parsed_message(reading, result, source: object) -> str:
    """The Telegram line for a mail that was read.

    WHAT THIS DELIBERATELY DOES NOT SHOW: the mail's subject. Bank mail titles
    are fixed banners — every MB transfer arrives as "Thong bao giao dich thanh
    cong" — so a subject line says the same thing on every message and reads as
    if it were describing this one. What the person actually wants is what the
    parser read OUT of the mail: who it went to, what it was for, how it was
    paid. Those were being extracted and then dropped, while the subject took
    the prominent line.

    Fields appear only when present. A mail that yielded little says little,
    rather than padding the message with em-dashes for everything missing.
    """
    del reading
    return (
        "💸 <b>Đã đọc một giao dịch</b>\n"
        f"Nguồn: {notify.escape(str(source))}\n"
        f"Cách đọc: {notify.escape(getattr(result, 'stage', '') or 'unknown')}"
    )


def _announce(text: str) -> None:
    """Send a status line, if notifications are configured.

    Deliberately swallows everything: a failed notification must not fail the
    delivery, or Pub/Sub redelivers and the work is repeated for the sake of a
    message nobody is blocked on.
    """
    if notify.enabled():
        notify.send(text)


def _when(moment) -> str:
    """A transaction time the way Vietnamese mail prints it: 21/08/2026 13:15."""
    return moment.strftime("%d/%m/%Y %H:%M")


def _vnd(amount: int | None) -> str:
    """Format an amount the way Vietnamese bank mail does: 1.234.567 VND."""
    if amount is None:
        return "—"
    return f"{amount:,}".replace(",", ".") + " VND"


def _decode(cloud_event: CloudEvent) -> dict | None:
    """Pull the JSON payload out of the Pub/Sub envelope."""
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
        log.error("could not decode payload: %s", exc)
        return None
