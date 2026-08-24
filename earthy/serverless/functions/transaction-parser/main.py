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

For now it only logs what it read. Persisting is deliberately not wired up.
"""

import base64
import json
import logging

import functions_framework
import notify
import parser
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

    result = parser.parse(str(source), body, STORE)
    subject = str(payload.get("subject", ""))

    reading = result.reading
    if reading is None:
        # Not an error: an unrecognised template is normal until the pipeline
        # has learned one. Logged at warning so the gaps are easy to find.
        log.warning(
            "UNREAD source=%s message_id=%s subject=%r reasons=%s",
            source,
            message_id,
            subject,
            "; ".join(result.reasons),
        )
        # The subject EARNS its place here, unlike on the success path: when
        # nothing could be read, the mail's own title is the only handle a
        # person has on which message this was. `reasons` says what was
        # missing, so a gap is actionable instead of just disappointing.
        _announce(
            f"⚠️ <b>Chưa đọc được</b>\n"
            f"Tiêu đề: {notify.escape(subject)}\n"
            f"Thiếu: {notify.escape('; '.join(result.reasons))}\n"
            f"Nguồn: {notify.escape(str(source))}"
        )
        return

    log.info(
        "PARSED source=%s message_id=%s stage=%s learned=%s amount=%s direction=%s "
        "balance=%s at=%s ref=%s tail=%s category=%s/%s subject=%r",
        source,
        message_id,
        result.stage,
        result.learned,
        reading.amount,
        reading.direction,
        reading.balance,
        reading.occurred_at or "-",
        reading.reference or "-",
        reading.account_tail or "-",
        result.category or "-",
        result.category_source or "-",
        subject,
    )
    _announce(_parsed_message(reading, result, source))

    # TODO: persist. Use message_id as the idempotency key — the same
    # notification can arrive more than once.


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
    direction = "vào" if reading.direction == "credit" else "ra"
    lines = [f"💸 <b>{_vnd(reading.amount)}</b> · {direction}"]

    # The counterparty, which is the single most useful thing after the amount.
    if reading.merchant:
        lines.append(f"{'Từ' if reading.direction == 'credit' else 'Tới'}: "
                     f"{notify.escape(reading.merchant)}")

    # The transfer memo — the human sentence the sender typed. This is the
    # "nội dung" a person means when they ask what a transaction was about, and
    # it is what the subject was standing in for.
    if reading.description:
        lines.append(f"Nội dung: {notify.escape(reading.description)}")

    if result.category:
        lines.append(f"Danh mục: {notify.escape(result.category)}")
    if reading.occurred_at:
        lines.append(f"Lúc: {_when(reading.occurred_at)}")
    if reading.channel:
        lines.append(f"Hình thức: {notify.escape(reading.channel)}")
    if reading.account_tail:
        lines.append(f"Tài khoản: ...{notify.escape(reading.account_tail)}")
    if reading.balance:
        lines.append(f"Số dư: {_vnd(reading.balance)}")

    # Provenance last, and quietly: useful when a reading looks wrong, noise
    # when it does not. `source` is the sender key, not the mail's title.
    tail = notify.escape(str(source))
    if reading.reference:
        tail += f" · {notify.escape(reading.reference)}"
    lines.append(tail)

    return "\n".join(lines)


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
