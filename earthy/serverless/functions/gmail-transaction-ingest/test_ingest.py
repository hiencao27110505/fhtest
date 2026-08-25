"""Entry-point behaviour, with the Gmail side stubbed out.

These exist to pin the multi-user contract: the right user's token is used,
and the cursor only advances when the work actually finished.
"""

import base64
import json
from typing import Any

import accounts
import main
import pytest


def _event(payload: dict[str, Any]) -> Any:
    """A CloudEvent-shaped stub carrying a Pub/Sub message.

    Only `.data` is read by the handler, so a plain object is enough.
    """
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    return type("Event", (), {"data": {"message": {"data": encoded}}})()


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> accounts.InMemoryStore:
    seeded = accounts.InMemoryStore({"alice@x.com": "tok-alice", "bob@x.com": "tok-bob"})
    monkeypatch.setattr(main, "STORE", seeded)
    return seeded


@pytest.fixture
def tokens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Refresh tokens that build_client was called with, in order."""
    seen: list[str] = []

    def fake_build_client(refresh_token: str) -> object:
        seen.append(refresh_token)
        return object()  # a stand-in service; never called by these tests

    monkeypatch.setattr(main.gmail_auth, "build_client", fake_build_client)
    return seen


@pytest.fixture
def starts(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """historyIds that _added_message_ids was asked to start from."""
    seen: list[str] = []

    def fake_added_message_ids(service: object, start_history_id: str) -> list[str]:
        seen.append(start_history_id)
        return []

    monkeypatch.setattr(main, "_added_message_ids", fake_added_message_ids)
    return seen


@pytest.fixture
def no_gmail(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub out the Gmail side for tests that only care about the cursor."""

    def fake_build_client(refresh_token: str) -> object:
        return object()

    monkeypatch.setattr(main.gmail_auth, "build_client", fake_build_client)


def test_uses_the_notified_users_token(
    store: accounts.InMemoryStore, tokens: list[str], starts: list[str]
) -> None:
    main.main(_event({"emailAddress": "bob@x.com", "historyId": "500"}))
    assert tokens == ["tok-bob"]


def test_unknown_mailbox_is_acked_not_raised(
    store: accounts.InMemoryStore, tokens: list[str], starts: list[str]
) -> None:
    # A disconnected account must not wedge the subscription.
    main.main(_event({"emailAddress": "stranger@x.com", "historyId": "1"}))
    assert tokens == []


def test_cursor_advances_after_a_clean_run(
    store: accounts.InMemoryStore, tokens: list[str], starts: list[str]
) -> None:
    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))
    assert store.get("alice@x.com").history_id == "900"


def test_cursor_is_untouched_when_the_run_fails(
    store: accounts.InMemoryStore,
    no_gmail: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(service: object, start_history_id: str) -> list[str]:
        raise RuntimeError("gmail is down")

    monkeypatch.setattr(main, "_added_message_ids", boom)
    store.save_history_id("alice@x.com", "100")

    with pytest.raises(RuntimeError):
        main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))

    # Still the old cursor: the next delivery replays the window.
    assert store.get("alice@x.com").history_id == "100"


def test_stored_cursor_wins_over_the_notification(
    store: accounts.InMemoryStore, no_gmail: None, starts: list[str]
) -> None:
    store.save_history_id("alice@x.com", "100")
    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))
    assert starts == ["100"]


def test_falls_back_to_the_notification_on_first_run(
    store: accounts.InMemoryStore, no_gmail: None, starts: list[str]
) -> None:
    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))
    assert starts == ["900"]


def test_dead_token_is_acked_and_recorded(
    store: accounts.InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A rejected refresh token must not raise.

    Raising would redeliver the message until the topic's retention expires,
    and no retry can revive a token the user has to reconnect.
    """

    def reject(refresh_token: str) -> object:
        raise main.gmail_auth.TokenRejected("nope")

    monkeypatch.setattr(main.gmail_auth, "build_client", reject)

    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))

    assert store.get("alice@x.com").needs_reauth is True


def test_dead_token_leaves_the_cursor_alone(
    store: accounts.InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Reconnecting must resume from where the pipeline actually got to.
    store.save_history_id("alice@x.com", "100")

    def reject(refresh_token: str) -> object:
        raise main.gmail_auth.TokenRejected("nope")

    monkeypatch.setattr(main.gmail_auth, "build_client", reject)
    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))

    assert store.get("alice@x.com").history_id == "100"


def test_published_event_carries_the_routing_fields(
    store: accounts.InMemoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The persist stage downstream needs three things this event did not use
    to carry: WHOSE mailbox this is (the only link to a family and a sealing
    key), the From header (so the other side can classify the sender against
    its own registry), and our own bank-or-wallet verdict (for when it cannot).

    Pinned here because the failure is quiet and far away: an event without
    `mailbox` is unroutable, and persist.py logs and drops it — the transaction
    then arrives minutes later via FamilyHub's own poll, which reads exactly
    like the wiring working slowly rather than not at all.
    """
    monkeypatch.setattr(main.gmail_auth, "build_client", lambda token: object())
    monkeypatch.setattr(main, "_added_message_ids", lambda service, start: ["msg-1"])
    monkeypatch.setattr(
        main,
        "_message",
        lambda service, message_id: {
            "from": "Techcombank <no-reply@techcombank.com.vn>",
            "subject": "Thong bao giao dich",
            "date": "Fri, 21 Aug 2026 13:15:00 +0700",
            "body": "So tien: 500.000 VND",
        },
    )

    published: list[tuple[str, dict]] = []
    monkeypatch.setattr(main, "_publish", lambda topic, payload: published.append((topic, payload)))

    main.main(_event({"emailAddress": "alice@x.com", "historyId": "900"}))

    assert len(published) == 1
    _, payload = published[0]
    # The original contract, untouched.
    assert payload["message_id"] == "msg-1"
    assert payload["source"] == "techcombank"
    assert payload["body"] == "So tien: 500.000 VND"
    # The three routing fields the persist stage stands on.
    assert payload["mailbox"] == "alice@x.com"
    assert payload["from"] == "Techcombank <no-reply@techcombank.com.vn>"
    assert payload["kind"] == "bank"


def test_kind_tells_banks_from_wallets() -> None:
    """Classified by LABEL so every alias domain inherits the answer."""
    import senders

    assert senders.kind("techcombank") == "bank"
    assert senders.kind("vietcombank") == "bank"
    assert senders.kind("cake") == "bank"          # digital banks are banks
    assert senders.kind("momo") == "wallet"
    assert senders.kind("zalopay") == "wallet"
    assert senders.kind("ssi") == "wallet"         # securities: receipts, not bank txns
    assert senders.kind("fecredit") == "wallet"    # BNPL likewise
    assert senders.kind("test") == "bank"          # test mail exercises the strict path

    # Every non-bank label actually exists in the registry — a typo in the set
    # would silently reclassify that sender as a bank.
    known_labels = set(senders.KNOWN_SENDERS.values())
    missing = senders.NON_BANK_LABELS - known_labels
    assert not missing, f"labels in NON_BANK_LABELS but not the registry: {missing}"
