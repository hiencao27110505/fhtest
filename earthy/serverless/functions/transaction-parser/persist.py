"""HTTPS handoff to the canonical mailbox staging/encryption boundary."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

ACK_STATUSES = frozenset({"staged", "skipped", "ignored", "held", "rejected"})
TIMEOUT_SECONDS = 10


class ConfigurationError(RuntimeError):
    pass


class PersistenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class Outcome:
    status: str
    reason: str | None = None


def configured() -> bool:
    url = os.environ.get("MAILBOX_INGEST_URL")
    secret = os.environ.get("MAILBOX_SYNC_SECRET")
    if bool(url) != bool(secret):
        raise ConfigurationError("MAILBOX_INGEST_URL and MAILBOX_SYNC_SECRET must be set together")
    return bool(url)


def build_payload(
    *, email: str, message_id: str, source: str, sender_kind: str,
    from_header: str, body: str, reading: Any, category: str | None = None,
) -> dict[str, object]:
    values = asdict(reading)  # parser output is a frozen dataclass
    for key, value in tuple(values.items()):
        if isinstance(value, datetime):
            values[key] = value.isoformat()
    if category is not None:
        values["category"] = category
    return {
        "email": email,
        "gmailMessageId": message_id,
        "sourceProvider": source,
        "senderKind": sender_kind,
        "from": from_header,
        "body": body,
        "reading": values,
    }


def send(
    payload: dict[str, object], *, opener: Callable[..., object] = urllib.request.urlopen
) -> Outcome:
    url = os.environ.get("MAILBOX_INGEST_URL")
    secret = os.environ.get("MAILBOX_SYNC_SECRET")
    if not url or not secret:
        raise ConfigurationError("persistence is not fully configured")
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", "x-sync-secret": secret},
        method="POST",
    )
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:  # type: ignore[attr-defined]
            if getattr(response, "status", 0) != 200:
                raise PersistenceError(f"mailbox ingest returned HTTP {response.status}")
            raw = response.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PersistenceError("mailbox ingest transport failed") from exc
    try:
        answer = json.loads(raw)
        status = answer["status"]
    except (ValueError, TypeError, KeyError) as exc:
        raise PersistenceError("mailbox ingest returned an invalid response") from exc
    if status not in ACK_STATUSES:
        raise PersistenceError("mailbox ingest returned an unknown status")
    reason = answer.get("reason")
    return Outcome(status=status, reason=reason if isinstance(reason, str) else None)
