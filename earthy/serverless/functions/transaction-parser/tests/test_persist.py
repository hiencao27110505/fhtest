import json
import urllib.error
from datetime import datetime

import persist
import pytest
from parser.spec import Extracted


class Response:
    def __init__(self, payload: object, status: int = 200) -> None:
        self.status = status
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self) -> bytes:
        return self.payload


def test_config_requires_url_and_secret_together(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAILBOX_INGEST_URL", "https://example.test/ingest")
    monkeypatch.delenv("MAILBOX_SYNC_SECRET", raising=False)
    with pytest.raises(persist.ConfigurationError):
        persist.configured()


def test_build_payload_maps_the_parser_contract() -> None:
    reading = Extracted(
        amount=250_000,
        direction="debit",
        currency="VND",
        fx_amount=10,
        fx_currency="USD",
        merchant="Shop",
        occurred_at=datetime(2026, 8, 21, 6, 15),
        transaction_type="purchase",
        account_kind="credit_card",
        flow="expense",
    )
    payload = persist.build_payload(
        email="me@example.com", message_id="msg-1", source="vib", sender_kind="bank",
        from_header="VIB <notice@vib.com.vn>", body="mail", reading=reading,
        category="ăn uống",
    )
    assert payload["gmailMessageId"] == "msg-1"
    assert payload["sourceProvider"] == "vib"
    assert payload["senderKind"] == "bank"
    assert payload["reading"] == {
        **reading.__dict__,
        "occurred_at": "2026-08-21T06:15:00",
        "category": "ăn uống",
    }


@pytest.mark.parametrize("status", ["staged", "skipped", "ignored", "held", "rejected"])
def test_all_200_decisions_are_acked(monkeypatch: pytest.MonkeyPatch, status: str) -> None:
    monkeypatch.setenv("MAILBOX_INGEST_URL", "https://example.test/ingest")
    monkeypatch.setenv("MAILBOX_SYNC_SECRET", "secret")
    captured = {}

    def open_(request, timeout):
        captured["secret"] = request.headers["X-sync-secret"]
        captured["timeout"] = timeout
        return Response({"status": status, "reason": "decision"})

    assert persist.send({}, opener=open_).status == status
    assert captured == {"secret": "secret", "timeout": persist.TIMEOUT_SECONDS}


def test_transient_and_invalid_responses_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAILBOX_INGEST_URL", "https://example.test/ingest")
    monkeypatch.setenv("MAILBOX_SYNC_SECRET", "secret")

    def down(*args, **kwargs):
        raise urllib.error.URLError("down")

    with pytest.raises(persist.PersistenceError):
        persist.send({}, opener=down)
    with pytest.raises(persist.PersistenceError):
        persist.send({}, opener=lambda *a, **k: Response({}, 403))
    with pytest.raises(persist.PersistenceError):
        persist.send({}, opener=lambda *a, **k: Response({"status": "surprise"}))
