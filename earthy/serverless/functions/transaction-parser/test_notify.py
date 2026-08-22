"""Notification behaviour.

The contract that matters: a notification is best-effort. Nothing it does may
turn a successful parse into a redelivered Pub/Sub message.
"""

import base64
import json
from typing import Any

import main
import notify
import pytest


def _event(payload: dict[str, Any]) -> Any:
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    return type("Event", (), {"data": {"message": {"data": encoded}}})()


PARSEABLE = {
    "message_id": "m1",
    "source": "momo",
    "subject": "Bien lai",
    "body": "Ghi nợ 150.000 VND. Số dư: 2.000.000 VND",
}


def test_disabled_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notify.enabled() is False


def test_needs_both_halves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notify.enabled() is False


def test_send_is_a_noop_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notify.send("hello") is False


def test_a_failing_notification_does_not_fail_the_parse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point. An exception here would redeliver the message."""

    def explode(text: str) -> bool:
        raise RuntimeError("telegram is down")

    monkeypatch.setattr(main.notify, "enabled", lambda: True)
    monkeypatch.setattr(main.notify, "send", explode)

    with pytest.raises(RuntimeError):
        # Confirms the stub really does raise...
        main.notify.send("x")

    # ...and that main still swallows it.
    monkeypatch.setattr(main, "_announce", lambda text: None)
    main.main(_event(PARSEABLE))


def test_network_errors_are_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "1")

    def boom(*a: object, **k: object) -> None:
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(notify.urllib.request, "urlopen", boom)
    assert notify.send("hello") is False


def test_a_parse_announces_the_amount(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []
    monkeypatch.setattr(main.notify, "enabled", lambda: True)
    monkeypatch.setattr(main.notify, "send", lambda text: sent.append(text) or True)

    main.main(_event(PARSEABLE))

    assert len(sent) == 1
    assert "150.000 VND" in sent[0]
    assert "momo" in sent[0]


def test_an_unreadable_email_announces_too(monkeypatch: pytest.MonkeyPatch) -> None:
    # The gap worth knowing about while watching a new pipeline.
    sent: list[str] = []
    monkeypatch.setattr(main.notify, "enabled", lambda: True)
    monkeypatch.setattr(main.notify, "send", lambda text: sent.append(text) or True)

    main.main(_event({**PARSEABLE, "body": "khong co so tien"}))

    assert len(sent) == 1
    assert "Chưa đọc được" in sent[0]


def test_subject_markup_is_escaped(monkeypatch: pytest.MonkeyPatch) -> None:
    # Subjects come from email and are attacker-controlled.
    sent: list[str] = []
    monkeypatch.setattr(main.notify, "enabled", lambda: True)
    monkeypatch.setattr(main.notify, "send", lambda text: sent.append(text) or True)

    main.main(_event({**PARSEABLE, "subject": "<b>bold</b> & co"}))

    assert "&lt;b&gt;" in sent[0]
    assert "<b>bold</b>" not in sent[0]


def test_amount_formatting() -> None:
    assert main._vnd(1234567) == "1.234.567 VND"
    assert main._vnd(None) == "—"
