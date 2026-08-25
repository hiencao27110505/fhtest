"""The handover to FamilyHub: exact payload, exact error contract.

The payload shape is a cross-repo, cross-language contract — the FamilyHub side
validates it and seals what it accepts, and `pipeline/direct-ingest.test.js`
over there drives the REAL sealer with a payload built by this very module. So
these tests pin the two halves that repo cannot see from its side: that the
fields leave here under the right names, and that each HTTP outcome does what
persist.py's docstring promises (2xx final, 4xx swallowed, 5xx redelivered).
"""

import datetime
import io
import json
import urllib.error

import persist
import pytest
from parser import spec

EVENT = {
    "message_id": "msg-1",
    "source": "techcombank",
    "subject": "Thong bao giao dich",
    "date": "Fri, 21 Aug 2026 13:15:00 +0700",
    "body": "So tien: 500.000 VND ... NGUYEN THU TRANG chuyen tien",
    "mailbox": "alice@x.com",
    "from": "Techcombank <no-reply@techcombank.com.vn>",
    "kind": "bank",
}

# spec.Extracted, not llm.Reading, and the difference is the datetime:
# pipeline.parse hands its caller an Extracted with occurred_at PARSED, and
# persist is that caller. llm.Reading still carries the model's string.
READING = spec.Extracted(
    amount=500000,
    balance=12345678,
    direction="debit",
    merchant="HIGHLANDS COFFEE",
    description="NGUYEN THU TRANG chuyen tien",
    occurred_at=datetime.datetime(2026, 8, 21, 13, 15, 0),
    reference="FT26234",
    account_tail="4412",
    channel="POS",
)


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAMILYHUB_INGEST_URL", "https://x.supabase.co/functions/v1/mailbox-sync/ingest")
    monkeypatch.setenv("FAMILYHUB_INGEST_SECRET", "s3cret")


class _Response:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode()
        self.status = 200

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# ── the payload, field by field ─────────────────────────────────────────────

def test_the_payload_is_what_familyhub_validates() -> None:
    body = persist.build_payload(EVENT, READING, "an uong")

    assert body == {
        "email": "alice@x.com",
        "gmailMessageId": "msg-1",
        "sourceProvider": "techcombank",
        "senderKind": "bank",
        "from": "Techcombank <no-reply@techcombank.com.vn>",
        "body": "So tien: 500.000 VND ... NGUYEN THU TRANG chuyen tien",
        "reading": {
            "amount": 500000,
            "balance": 12345678,
            "direction": "debit",
            "merchant": "HIGHLANDS COFFEE",
            "description": "NGUYEN THU TRANG chuyen tien",
            "occurred_at": "2026-08-21T13:15:00",
            "reference": "FT26234",
            "account_tail": "4412",
            "channel": "POS",
            "category": "an uong",
        },
    }


def test_a_sparse_reading_sends_nulls_not_absences() -> None:
    """FamilyHub's validator reads fields by name; a missing key and a null both
    mean 'not stated', but sending a stable shape keeps the contract diffable."""
    body = persist.build_payload(EVENT, spec.Extracted(amount=1000, direction="credit"), None)

    assert body["reading"]["balance"] is None
    assert body["reading"]["occurred_at"] is None
    assert body["reading"]["category"] is None
    assert body["reading"]["amount"] == 1000


def test_an_event_with_no_mailbox_is_unroutable() -> None:
    """An ingest deployed before the field existed. There is no safe default for
    'whose money is this', so the answer is None, not a guess."""
    event = {k: v for k, v in EVENT.items() if k != "mailbox"}
    assert persist.build_payload(event, READING, None) is None


# ── the switch ──────────────────────────────────────────────────────────────

def test_off_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FAMILYHUB_INGEST_URL", raising=False)
    monkeypatch.delenv("FAMILYHUB_INGEST_SECRET", raising=False)
    assert persist.enabled() is False
    assert persist.save(EVENT, READING, None) is None   # and save is a no-op


# ── the error contract ──────────────────────────────────────────────────────

def test_the_secret_travels_as_a_header(configured, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list = []

    def fake_urlopen(request, timeout):
        seen.append(request)
        return _Response({"status": "staged"})

    monkeypatch.setattr(persist.urllib.request, "urlopen", fake_urlopen)

    assert persist.save(EVENT, READING, None) == "staged"
    request = seen[0]
    assert request.get_header("X-sync-secret") == "s3cret"
    assert "secret" not in request.full_url    # never in the URL: URLs land in logs
    sent = json.loads(request.data.decode())
    assert sent["gmailMessageId"] == "msg-1"


def test_held_is_final_for_this_delivery(configured, monkeypatch: pytest.MonkeyPatch) -> None:
    """FamilyHub's poll heals a held mailbox from its own cursor. Raising here
    would fight it with redeliveries a key-less family cannot satisfy."""
    monkeypatch.setattr(
        persist.urllib.request, "urlopen",
        lambda request, timeout: _Response({"status": "held", "reason": "no_staging_pub"}),
    )
    assert persist.save(EVENT, READING, None) == "held"   # returned, not raised


def test_4xx_is_swallowed(configured, monkeypatch: pytest.MonkeyPatch) -> None:
    """A wrong secret fails identically on every redelivery, and the mail is
    not lost — the FamilyHub poll stages it regardless."""
    def fake_urlopen(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 403, "forbidden", {}, io.BytesIO(b""))

    monkeypatch.setattr(persist.urllib.request, "urlopen", fake_urlopen)
    assert persist.save(EVENT, READING, None) is None     # no raise


def test_5xx_raises_for_redelivery(configured, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 503, "unavailable", {}, io.BytesIO(b""))

    monkeypatch.setattr(persist.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(persist.PersistUnavailable):
        persist.save(EVENT, READING, None)


def test_network_failure_raises_for_redelivery(configured, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request, timeout):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(persist.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(persist.PersistUnavailable):
        persist.save(EVENT, READING, None)
