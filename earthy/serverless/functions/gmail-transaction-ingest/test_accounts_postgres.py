"""PostgresStore behaviour, with the connection pool faked.

There is no database here: what these pin down is the contract the store keeps
with its callers — which statements run, what happens on a missing row, and
that a token never reaches a log line. Whether Postgres accepts the SQL is a
question for an integration test against a real database.
"""

from typing import Any

import accounts
import pytest


class _FakeCursor:
    def __init__(self, rows: list[tuple], rowcount: int):
        self._rows = rows
        self.rowcount = rowcount

    def fetchone(self) -> tuple | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[tuple]:
        return self._rows


class _FakeConnection:
    def __init__(self, rows: list[tuple], rowcount: int, log: list[tuple]):
        self._rows = rows
        self._rowcount = rowcount
        self._log = log

    def execute(self, sql: str, params: tuple = ()) -> _FakeCursor:
        self._log.append((" ".join(sql.split()), params))
        return _FakeCursor(self._rows, self._rowcount)

    def __enter__(self) -> "_FakeConnection":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class _FakePool:
    def __init__(self, rows: list[tuple] | None = None, rowcount: int = 1):
        self.rows = rows or []
        self.rowcount = rowcount
        self.statements: list[tuple] = []

    def connection(self) -> _FakeConnection:
        return _FakeConnection(self.rows, self.rowcount, self.statements)


@pytest.fixture
def pool(monkeypatch: pytest.MonkeyPatch) -> Any:
    fake = _FakePool()
    monkeypatch.setattr(accounts, "_get_pool", lambda: fake)
    # Decryption is exercised separately; here it would only obscure the SQL.
    monkeypatch.setattr(accounts, "_decrypt", lambda blob: blob.decode())
    return fake


def test_get_left_joins_so_a_new_account_has_a_null_cursor(pool: Any) -> None:
    pool.rows = [("a@x.com", b"tok", None, False)]
    account = accounts.PostgresStore().get("a@x.com")
    sql, _ = pool.statements[0]
    assert "left join" in sql.lower()
    assert account.history_id is None


def test_get_returns_the_row(pool: Any) -> None:
    pool.rows = [("a@x.com", b"tok", "100", False)]
    account = accounts.PostgresStore().get("a@x.com")
    assert account.email == "a@x.com"
    assert account.refresh_token == "tok"
    assert account.history_id == "100"
    assert account.needs_reauth is False


def test_get_passes_the_email_as_a_parameter(pool: Any) -> None:
    # Interpolating it would be an injection hole.
    pool.rows = [("a@x.com", b"tok", None, False)]
    accounts.PostgresStore().get("a@x.com")
    _, params = pool.statements[0]
    assert params == (accounts.PROVIDER, "a@x.com")


def test_get_raises_for_a_missing_row(pool: Any) -> None:
    pool.rows = []
    with pytest.raises(accounts.UnknownMailbox):
        accounts.PostgresStore().get("nobody@x.com")


def test_save_history_id_updates_that_row(pool: Any) -> None:
    accounts.PostgresStore().save_history_id("a@x.com", "900")
    sql, params = pool.statements[0]
    # Upsert, so two concurrent runs cannot race to create the sync row.
    assert "on conflict" in sql.lower()
    assert params == ("900", accounts.PROVIDER, "a@x.com")


def test_save_history_id_raises_when_nothing_matched(pool: Any) -> None:
    # A silent no-op would lose the cursor without anyone noticing.
    pool.rowcount = 0
    with pytest.raises(accounts.UnknownMailbox):
        accounts.PostgresStore().save_history_id("nobody@x.com", "1")


def test_mark_needs_reauth_sets_the_flag(pool: Any) -> None:
    accounts.PostgresStore().mark_needs_reauth("a@x.com")
    sql, params = pool.statements[0]
    assert "needs_reauth = true" in sql
    assert params == (accounts.PROVIDER, "a@x.com")


def test_mark_needs_reauth_raises_when_nothing_matched(pool: Any) -> None:
    pool.rowcount = 0
    with pytest.raises(accounts.UnknownMailbox):
        accounts.PostgresStore().mark_needs_reauth("nobody@x.com")


def test_list_connected_excludes_reauth_pending(pool: Any) -> None:
    pool.rows = [("a@x.com",), ("b@x.com",)]
    assert accounts.PostgresStore().list_connected() == ["a@x.com", "b@x.com"]
    sql, _ = pool.statements[0]
    assert "needs_reauth = false" in sql


def test_list_connected_orders_results(pool: Any) -> None:
    # Stable order makes a partially-failed renewal run readable.
    pool.rows = []
    accounts.PostgresStore().list_connected()
    sql, _ = pool.statements[0]
    assert "order by email" in sql


def test_repr_never_leaks_the_refresh_token(pool: Any) -> None:
    pool.rows = [("a@x.com", b"super-secret-token", "1", False)]
    account = accounts.PostgresStore().get("a@x.com")
    assert "super-secret-token" not in repr(account)


# --- token decryption ------------------------------------------------------


def _key() -> str:
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode()


def test_decrypt_round_trips(monkeypatch: pytest.MonkeyPatch) -> None:
    from cryptography.fernet import Fernet

    key = _key()
    monkeypatch.setenv("GMAIL_TOKEN_KEY", key)
    ciphertext = Fernet(key.encode()).encrypt(b"1//refresh-token")
    assert accounts._decrypt(ciphertext) == "1//refresh-token"


def test_decrypt_accepts_a_memoryview(monkeypatch: pytest.MonkeyPatch) -> None:
    # psycopg hands bytea back as memoryview, not bytes.
    from cryptography.fernet import Fernet

    key = _key()
    monkeypatch.setenv("GMAIL_TOKEN_KEY", key)
    ciphertext = Fernet(key.encode()).encrypt(b"tok")
    assert accounts._decrypt(memoryview(ciphertext)) == "tok"


def test_decrypt_refuses_to_run_without_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # Treating ciphertext as a token would fail much later and far away.
    monkeypatch.delenv("GMAIL_TOKEN_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GMAIL_TOKEN_KEY"):
        accounts._decrypt(b"anything")


def test_decrypt_rejects_the_wrong_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from cryptography.fernet import Fernet

    ciphertext = Fernet(_key().encode()).encrypt(b"tok")
    monkeypatch.setenv("GMAIL_TOKEN_KEY", _key())
    with pytest.raises(RuntimeError, match="could not be decrypted"):
        accounts._decrypt(ciphertext)


def test_decrypt_error_never_contains_the_ciphertext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from cryptography.fernet import Fernet

    ciphertext = Fernet(_key().encode()).encrypt(b"tok")
    monkeypatch.setenv("GMAIL_TOKEN_KEY", _key())
    try:
        accounts._decrypt(ciphertext)
    except RuntimeError as exc:
        assert ciphertext.decode() not in str(exc)
