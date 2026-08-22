"""transaction-detected -> parsed transaction.

Fed by gmail-transaction-ingest, which sends the mail body along with the
message metadata. Nothing here talks to Gmail, so this function needs no
credentials and can be tested with a static payload.

For now it only logs what it read. Persisting is deliberately not wired up.
"""

import base64
import html
import json
import logging
import re

import functions_framework
import notify
import parsing
from cloudevents.http import CloudEvent

# basicConfig is a no-op on Cloud Functions: the runtime configures the root
# logger before this module is imported, so the level has to be set here or
# INFO records are dropped.
log = logging.getLogger(__name__)
log.setLevel(logging.INFO)

_TAG = re.compile(r"<[^>]+>")
_SCRIPT_OR_STYLE = re.compile(r"<(script|style)\b.*?</\1>", re.IGNORECASE | re.DOTALL)


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

    result = parsing.parse(strip_html(body))

    if not result.is_complete:
        # Not an error: an unrecognised template is normal until its patterns
        # are added. Logged at warning so the gaps are easy to find.
        log.warning(
            "INCOMPLETE source=%s message_id=%s amount=%s direction=%s subject=%r",
            source,
            message_id,
            result.amount,
            result.direction,
            payload.get("subject", ""),
        )
        _announce(
            f"⚠️ <b>Chưa đọc được</b>\n"
            f"Nguồn: {notify.escape(str(source))}\n"
            f"Tiêu đề: {notify.escape(str(payload.get('subject', '')))}\n"
            f"Số tiền: {result.amount or '—'} · Chiều: {result.direction or '—'}"
        )
        return

    log.info(
        "PARSED source=%s message_id=%s amount=%s direction=%s balance=%s subject=%r",
        source,
        message_id,
        result.amount,
        result.direction,
        result.balance,
        payload.get("subject", ""),
    )
    _announce(
        f"💸 <b>{_vnd(result.amount)}</b> · "
        f"{'vào' if result.direction == 'credit' else 'ra'}\n"
        f"Nguồn: {notify.escape(str(source))}\n"
        f"Tiêu đề: {notify.escape(str(payload.get('subject', '')))}"
        + (f"\nSố dư: {_vnd(result.balance)}" if result.balance else "")
    )

    # TODO: persist. Use message_id as the idempotency key — the same
    # notification can arrive more than once.


def _announce(text: str) -> None:
    """Send a status line, if notifications are configured.

    Deliberately swallows everything: a failed notification must not fail the
    delivery, or Pub/Sub redelivers and the work is repeated for the sake of a
    message nobody is blocked on.
    """
    if notify.enabled():
        notify.send(text)


def _vnd(amount: int | None) -> str:
    """Format an amount the way Vietnamese bank mail does: 1.234.567 VND."""
    if amount is None:
        return "—"
    return f"{amount:,}".replace(",", ".") + " VND"


def strip_html(body: str) -> str:
    """Flatten an HTML mail body to plain text.

    Good enough for regex matching: script/style blocks go first so their
    contents do not leak into the text, then tags, then entities.
    """
    text = _SCRIPT_OR_STYLE.sub(" ", body)
    text = _TAG.sub(" ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


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
