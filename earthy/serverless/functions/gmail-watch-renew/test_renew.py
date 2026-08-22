"""Renewal behaviour, with the Gmail API stubbed out.

The contract worth pinning: every mailbox gets renewed even when one fails,
and an existing cursor is never overwritten.
"""

import json
from typing import Any

import accounts
import main
import pytest


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> accounts.InMemoryStore:
    seeded = accounts.InMemoryStore(
        {"a@x.com": "tok-a", "b@x.com": "tok-b", "c@x.com": "tok-c"}
    )
    monkeypatch.setattr(main, "STORE", seeded)
    monkeypatch.setenv("GCP_PROJECT", "test-project")
    return seeded


class _FakeWatch:
    """Stands in for service.users().watch(...).execute()."""

    def __init__(self, history_id: str, fail_for: set[str] | None = None):
        self.history_id = history_id
        self.fail_for = fail_for or set()
        self.topics: list[str] = []
        self.labels: list[list[str]] = []

    def __call__(self, refresh_token: str) -> Any:
        outer = self

        class Service:
            def users(self) -> Any:
                return self

            def watch(self, userId: str, body: dict) -> Any:  # noqa: N803 - Google's arg name
                outer.topics.append(body["topicName"])
                outer.labels.append(body["labelIds"])
                if refresh_token in outer.fail_for:
                    raise RuntimeError("token revoked")
                return self

            def execute(self) -> dict:
                return {"historyId": outer.history_id}

        return Service()


def test_renews_every_mailbox(store, monkeypatch):
    watch = _FakeWatch("100")
    monkeypatch.setattr(main.gmail_auth, "build_client", watch)

    body, status = main.main(None)

    assert status == 200
    assert json.loads(body) == {"renewed": 3, "failed": 0, "needs_reauth": 0}


def test_one_failure_does_not_stop_the_others(store, monkeypatch):
    # The whole point of the job: a single revoked token must not leave the
    # remaining mailboxes unrenewed.
    watch = _FakeWatch("100", fail_for={"tok-b"})
    monkeypatch.setattr(main.gmail_auth, "build_client", watch)

    body, status = main.main(None)
    parsed = json.loads(body)

    assert status == 207
    assert parsed["renewed"] == 2
    assert parsed["failed"] == 1
    assert parsed["failures"][0]["email"] == "b@x.com"


def test_watches_the_configured_topic_and_inbox(store, monkeypatch):
    watch = _FakeWatch("100")
    monkeypatch.setattr(main.gmail_auth, "build_client", watch)

    main.main(None)

    assert watch.topics == ["projects/test-project/topics/gmail-events"] * 3
    assert watch.labels == [["INBOX"]] * 3


def test_first_registration_seeds_the_cursor(store, monkeypatch):
    monkeypatch.setattr(main.gmail_auth, "build_client", _FakeWatch("500"))

    main.main(None)

    assert store.get("a@x.com").history_id == "500"


def test_existing_cursor_is_never_overwritten(store, monkeypatch):
    # Overwriting would skip every message between the old cursor and now.
    store.save_history_id("a@x.com", "100")
    monkeypatch.setattr(main.gmail_auth, "build_client", _FakeWatch("999"))

    main.main(None)

    assert store.get("a@x.com").history_id == "100"
    assert store.get("b@x.com").history_id == "999"


def test_missing_project_is_reported_not_crashed(store, monkeypatch):
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    body, status = main.main(None)

    assert status == 500
    assert "error" in json.loads(body)


def test_no_connected_mailboxes_is_a_clean_run(monkeypatch):
    monkeypatch.setattr(main, "STORE", accounts.InMemoryStore({}))
    monkeypatch.setenv("GCP_PROJECT", "test-project")

    body, status = main.main(None)

    assert status == 200
    assert json.loads(body) == {"renewed": 0, "failed": 0, "needs_reauth": 0}


def test_dead_token_is_recorded_not_counted_as_failure(store, monkeypatch):
    """A 7-day expiry is routine in Testing status, not an outage.

    It is reported separately from real failures so a weekly wave of
    re-consents does not read as the job breaking.
    """

    def reject(refresh_token: str) -> object:
        if refresh_token == "tok-b":
            raise main.gmail_auth.TokenRejected("expired")
        return _FakeWatch("100")(refresh_token)

    monkeypatch.setattr(main.gmail_auth, "build_client", reject)

    body, status = main.main(None)
    parsed = json.loads(body)

    assert parsed["renewed"] == 2
    assert parsed["failed"] == 0
    assert parsed["needs_reauth"] == 1
    assert store.get("b@x.com").needs_reauth is True


def test_reauth_pending_mailboxes_are_skipped_next_run(store, monkeypatch):
    store.mark_needs_reauth("b@x.com")
    watch = _FakeWatch("100")
    monkeypatch.setattr(main.gmail_auth, "build_client", watch)

    body, _ = main.main(None)

    assert json.loads(body)["renewed"] == 2  # a and c only


def test_watch_body_uses_label_filter_behavior(store, monkeypatch):
    # labelFilterAction is deprecated; labelFilterBehavior replaces it.
    captured: list[dict] = []

    class Service:
        def users(self):
            return self

        def watch(self, userId: str, body: dict):  # noqa: N803
            captured.append(body)
            return self

        def execute(self) -> dict:
            return {"historyId": "1"}

    monkeypatch.setattr(main.gmail_auth, "build_client", lambda tok: Service())
    main.main(None)

    assert captured[0]["labelFilterBehavior"] == "INCLUDE"
    assert captured[0]["labelIds"] == ["INBOX"]
    assert "labelFilterAction" not in captured[0]
