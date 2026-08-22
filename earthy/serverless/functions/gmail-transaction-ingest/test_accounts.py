import accounts
import pytest


def test_get_returns_the_stored_account():
    store = accounts.InMemoryStore({"a@example.com": "refresh-1"})
    account = store.get("a@example.com")
    assert account.email == "a@example.com"
    assert account.refresh_token == "refresh-1"
    assert account.history_id is None


def test_get_raises_for_unknown_mailbox():
    store = accounts.InMemoryStore({"a@example.com": "refresh-1"})
    with pytest.raises(accounts.UnknownMailbox):
        store.get("stranger@example.com")


def test_accounts_are_isolated_from_each_other():
    store = accounts.InMemoryStore({"a@x.com": "tok-a", "b@x.com": "tok-b"})
    store.save_history_id("a@x.com", "111")
    assert store.get("a@x.com").history_id == "111"
    assert store.get("b@x.com").history_id is None
    assert store.get("b@x.com").refresh_token == "tok-b"


def test_save_history_id_advances_the_cursor():
    store = accounts.InMemoryStore({"a@x.com": "tok"})
    store.save_history_id("a@x.com", "100")
    store.save_history_id("a@x.com", "200")
    assert store.get("a@x.com").history_id == "200"


def test_save_history_id_rejects_unknown_mailbox():
    store = accounts.InMemoryStore({})
    with pytest.raises(accounts.UnknownMailbox):
        store.save_history_id("nobody@x.com", "1")


def test_repr_never_leaks_the_refresh_token():
    store = accounts.InMemoryStore({"a@x.com": "super-secret-token"})
    assert "super-secret-token" not in repr(store.get("a@x.com"))


def test_seed_from_env_reads_json(monkeypatch):
    monkeypatch.setenv("GMAIL_ACCOUNTS", '{"a@x.com": "tok"}')
    assert accounts._seed_from_env() == {"a@x.com": "tok"}


def test_seed_from_env_is_empty_when_unset(monkeypatch):
    monkeypatch.delenv("GMAIL_ACCOUNTS", raising=False)
    assert accounts._seed_from_env() == {}


def test_seed_from_env_survives_malformed_json(monkeypatch):
    # A bad value must not take the function down at import time.
    monkeypatch.setenv("GMAIL_ACCOUNTS", "{not json")
    assert accounts._seed_from_env() == {}


def test_seed_from_env_rejects_non_object(monkeypatch):
    monkeypatch.setenv("GMAIL_ACCOUNTS", '["a@x.com"]')
    assert accounts._seed_from_env() == {}


def test_new_account_does_not_need_reauth():
    store = accounts.InMemoryStore({"a@x.com": "tok"})
    assert store.get("a@x.com").needs_reauth is False


def test_mark_needs_reauth_flags_only_that_account():
    store = accounts.InMemoryStore({"a@x.com": "tok-a", "b@x.com": "tok-b"})
    store.mark_needs_reauth("a@x.com")
    assert store.get("a@x.com").needs_reauth is True
    assert store.get("b@x.com").needs_reauth is False


def test_mark_needs_reauth_rejects_unknown_mailbox():
    store = accounts.InMemoryStore({})
    with pytest.raises(accounts.UnknownMailbox):
        store.mark_needs_reauth("nobody@x.com")


def test_list_connected_skips_accounts_awaiting_reauth():
    # Renewing a mailbox whose token is dead only produces noise.
    store = accounts.InMemoryStore({"a@x.com": "tok-a", "b@x.com": "tok-b"})
    store.mark_needs_reauth("a@x.com")
    assert store.list_connected() == ["b@x.com"]


def test_repr_shows_reauth_state_without_the_token():
    store = accounts.InMemoryStore({"a@x.com": "super-secret"})
    store.mark_needs_reauth("a@x.com")
    text = repr(store.get("a@x.com"))
    assert "needs_reauth=True" in text
    assert "super-secret" not in text
