"""Per-user Gmail credentials and history checkpoints.

The pipeline is multi-user: a notification names a mailbox, and this module
answers "what are that mailbox's credentials, and where did we get to last
time". Where those live is deliberately behind an interface — the Postgres
implementation lands later without touching main.py.

Two implementations live here behind one protocol: InMemoryStore for local
runs and tests, PostgresStore for deployments. `create_store()` picks between
them from the environment, so neither function changes when a deployment gains
a database.

Two rules the backing store must honour, whatever it ends up being:

* A refresh token grants unlimited read access to someone's mail. It must be
  encrypted at rest and must never reach a log line.
* `historyId` is a per-mailbox cursor. It is written only after the messages
  in that window are handled, so a crash replays rather than skips.
"""

import logging
import os
from typing import Any, Protocol

log = logging.getLogger(__name__)

# OAuth scope this pipeline needs. Read-only on purpose: nothing here sends,
# modifies or deletes mail, and a narrower scope is a smaller blast radius if
# a token leaks.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class UnknownMailbox(Exception):
    """No account on file for this address.

    Permanent: the notification is acked rather than retried. It happens when
    a user disconnects Gmail but their watch has not expired yet.
    """


class Account(Protocol):
    """What the store returns for one mailbox."""

    email: str
    refresh_token: str
    history_id: str | None
    needs_reauth: bool
    watch_expires_at: int | None


class AccountStore(Protocol):
    """The seam. A Postgres-backed implementation replaces InMemoryStore with
    no change to its callers."""

    def get(self, email: str) -> Account:
        """Credentials and cursor for one mailbox.

        Raises UnknownMailbox if the address is not connected.
        """
        ...

    def save_history_id(self, email: str, history_id: str) -> None:
        """Advance the cursor, after the work for that window succeeded."""
        ...

    def save_watch(self, email: str, history_id: str, expires_at: int) -> None:
        """Record a fresh watch registration.

        `expires_at` is Gmail's `expiration`, epoch **milliseconds**.

        The cursor is written only when there is not one already: a renewal
        returns the mailbox's position *now*, and overwriting an existing
        cursor with it would skip every message in between. Doing both in one
        statement keeps a concurrent ingest from losing its write.
        """
        ...

    def mark_needs_reauth(self, email: str) -> None:
        """Record that this mailbox's refresh token no longer works.

        Google invalidates a refresh token when the user revokes access,
        changes their password, or — while the app is in Testing status —
        every 7 days. None of those are transient, so callers stop retrying
        and the app asks the user to reconnect.
        """
        ...

    def list_due_for_renewal(self, within_seconds: int) -> list[str]:
        """Mailboxes whose Gmail watch lapses within `within_seconds`.

        A watch lasts 7 days, so renewing every mailbox on every daily run
        repeats work that is good for another six — and with enough mailboxes
        the run stops fitting in the function's timeout, silently leaving the
        tail of the list to lapse. Asking for the ones that are actually due
        keeps the work proportional to what expires, not to how many users
        exist.

        Mailboxes with no watch yet are included: they are due by definition.
        """
        ...

    def list_connected(self) -> list[str]:
        """Addresses of every mailbox still connected.

        Excludes mailboxes awaiting re-consent: their token cannot mint an
        access token, so renewing them would only produce noise.

        Used by the watch-renewal job, which has to touch all of them: a Gmail
        watch lapses after 7 days and takes the notifications with it.
        """
        ...


class _Account:
    """One mailbox. Shared by both stores so they cannot drift apart."""

    __slots__ = (
        "email",
        "refresh_token",
        "history_id",
        "needs_reauth",
        "watch_expires_at",
    )

    def __init__(
        self,
        email: str,
        refresh_token: str,
        history_id: str | None = None,
        needs_reauth: bool = False,
        watch_expires_at: int | None = None,
    ):
        self.email = email
        self.refresh_token = refresh_token
        self.history_id = history_id
        self.needs_reauth = needs_reauth
        self.watch_expires_at = watch_expires_at

    def __repr__(self) -> str:
        # Never let the token near a log line or a traceback.
        return (
            f"<Account {self.email} history_id={self.history_id} needs_reauth={self.needs_reauth}>"
        )


def _now_ms() -> int:
    """Wall clock in epoch milliseconds, matching Gmail's `expiration`."""
    import time  # noqa: PLC0415

    return int(time.time() * 1000)


# --- in-memory ------------------------------------------------------------


class InMemoryStore:
    """Stand-in until the Postgres store exists.

    Seeded from GMAIL_ACCOUNTS, a JSON object of {email: refresh_token}. State
    dies with the instance, so a saved historyId does not survive a cold start
    — fine for wiring the pipeline up, not for running it.
    """

    def __init__(self, seed: dict[str, str] | None = None):
        self._accounts: dict[str, _Account] = {
            email: _Account(email, token) for email, token in (seed or {}).items()
        }

    def get(self, email: str) -> Account:
        try:
            return self._accounts[email]
        except KeyError:
            raise UnknownMailbox(email) from None

    def save_history_id(self, email: str, history_id: str) -> None:
        account = self._accounts.get(email)
        if account is None:
            raise UnknownMailbox(email)
        account.history_id = history_id

    def save_watch(self, email: str, history_id: str, expires_at: int) -> None:
        account = self._accounts.get(email)
        if account is None:
            raise UnknownMailbox(email)
        account.watch_expires_at = expires_at
        if account.history_id is None:
            account.history_id = history_id

    def mark_needs_reauth(self, email: str) -> None:
        account = self._accounts.get(email)
        if account is None:
            raise UnknownMailbox(email)
        account.needs_reauth = True

    def list_due_for_renewal(self, within_seconds: int) -> list[str]:
        cutoff_ms = (_now_ms() + within_seconds * 1000) if within_seconds else 0
        return [
            e
            for e, a in self._accounts.items()
            if not a.needs_reauth
            and (a.watch_expires_at is None or a.watch_expires_at <= cutoff_ms)
        ]

    def list_connected(self) -> list[str]:
        return [e for e, a in self._accounts.items() if not a.needs_reauth]


def _seed_from_env() -> dict[str, str]:
    """Read GMAIL_ACCOUNTS, tolerating absence and malformed JSON.

    A bad value must not take the function down at import time; it is logged
    and treated as "no accounts connected".
    """
    import json  # noqa: PLC0415

    raw = os.environ.get("GMAIL_ACCOUNTS")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        log.error("GMAIL_ACCOUNTS is not valid JSON: %s", exc)
        return {}
    if not isinstance(parsed, dict):
        log.error("GMAIL_ACCOUNTS must be a JSON object of {email: refresh_token}")
        return {}
    return {str(k): str(v) for k, v in parsed.items()}


# --- postgres -------------------------------------------------------------


# Tables this store reads and writes; the DDL lives in
# supabase/migrations/0070_connected_accounts.sql.
#
# connected_accounts is provider-agnostic — one row per external account a user
# has linked. gmail_sync_state holds what only Gmail needs, so a second
# provider does not add nullable columns nobody else uses.
ACCOUNTS_TABLE = "public.connected_accounts"
SYNC_TABLE = "public.gmail_sync_state"

# This store only ever deals with Gmail links.
PROVIDER = "google"

_pool: Any = None


def _decrypt(ciphertext: bytes | memoryview) -> str:
    """Turn a stored refresh_token_enc back into a usable token.

    The column holds ciphertext so that a database dump is not a permanent
    read grant on every connected mailbox. The key belongs to the application,
    not to Postgres — encrypting inside the database would put key and data in
    the same place and defeat the point.

    GMAIL_TOKEN_KEY is a urlsafe-base64 Fernet key. Without it the store
    refuses to run rather than silently treating ciphertext as a token.
    """
    from cryptography.fernet import Fernet, InvalidToken  # noqa: PLC0415

    key = os.environ.get("GMAIL_TOKEN_KEY")
    if not key:
        raise RuntimeError("GMAIL_TOKEN_KEY is not set; cannot read stored tokens")

    try:
        return Fernet(key.encode()).decrypt(bytes(ciphertext)).decode()
    except InvalidToken as exc:
        # Wrong key, or a row written by something else. Never log the value.
        raise RuntimeError("stored token could not be decrypted") from exc


def _dsn() -> str:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    return dsn


def _get_pool() -> Any:
    """The process-wide connection pool, opened on first use.

    Built lazily rather than at import so a function that never touches the
    database (or a test that stubs the store) does not need one.
    """
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool  # noqa: PLC0415

        _pool = ConnectionPool(
            _dsn(),
            min_size=0,  # a cold instance should not hold a connection open
            max_size=int(os.environ.get("DB_POOL_MAX", "2")),
            # Transaction-mode pooling cannot carry prepared statements
            # between statements on the same connection.
            kwargs={"prepare_threshold": None},
            open=True,
        )
    return _pool


class PostgresStore:
    """Reads and writes mailbox credentials in Postgres.

    Connection notes, because they are easy to get wrong on Cloud Functions:
    Supabase's pooler in transaction mode (port 6543) is the right target for
    serverless — many short-lived connections — but it does not support
    prepared statements. The pool below is configured accordingly; leaving them
    on produces intermittent "prepared statement already exists" errors under
    load rather than a clean failure.

    Every method is a single statement in its own transaction: the callers are
    short-lived Cloud Functions, and a longer transaction would hold a pooled
    connection across a network call to Gmail.
    """

    def get(self, email: str) -> Account:
        """The link for one mailbox, with its Gmail cursor.

        A left join: a freshly connected account has no sync row yet, and that
        is a null cursor rather than a missing account.
        """
        with _get_pool().connection() as conn:
            row = conn.execute(
                f"select a.email, a.refresh_token_enc, s.history_id, a.needs_reauth "  # noqa: S608
                f"from {ACCOUNTS_TABLE} a "
                f"left join {SYNC_TABLE} s on s.connected_account_id = a.id "
                f"where a.provider = %s and a.email = %s",
                (PROVIDER, email),
            ).fetchone()

        if row is None:
            raise UnknownMailbox(email)
        return _Account(row[0], _decrypt(row[1]), row[2], row[3])

    def save_history_id(self, email: str, history_id: str) -> None:
        """Advance the cursor, inserting the sync row on first use.

        One statement: an upsert keyed on the account id, so two concurrent
        invocations for the same mailbox cannot race to create the row.
        """
        with _get_pool().connection() as conn:
            updated = conn.execute(
                f"insert into {SYNC_TABLE} (connected_account_id, history_id) "  # noqa: S608
                f"select a.id, %s from {ACCOUNTS_TABLE} a "
                f"where a.provider = %s and a.email = %s "
                f"on conflict (connected_account_id) do update "
                f"set history_id = excluded.history_id, updated_at = now()",
                (history_id, PROVIDER, email),
            ).rowcount
        if not updated:
            raise UnknownMailbox(email)

    def save_watch(self, email: str, history_id: str, expires_at: int) -> None:
        """Record a fresh watch registration.

        `expires_at` is Gmail's `expiration`, epoch milliseconds, converted to
        a timestamptz on the way in.

        One statement on purpose. Reading the cursor and then writing it would
        let a concurrent ingest slip a newer cursor in between, and this call
        would overwrite it with the mailbox's position *now* — silently
        skipping every message in the gap. `coalesce` keeps whatever cursor is
        already stored and only fills in a missing one.
        """
        with _get_pool().connection() as conn:
            updated = conn.execute(
                f"insert into {SYNC_TABLE} "  # noqa: S608
                f"  (connected_account_id, history_id, watch_expires_at) "
                f"select a.id, %s, to_timestamp(%s / 1000.0) "
                f"from {ACCOUNTS_TABLE} a "
                f"where a.provider = %s and a.email = %s "
                f"on conflict (connected_account_id) do update set "
                f"  watch_expires_at = excluded.watch_expires_at, "
                f"  history_id = coalesce({SYNC_TABLE}.history_id, excluded.history_id), "
                f"  updated_at = now()",
                (history_id, expires_at, PROVIDER, email),
            ).rowcount
        if not updated:
            raise UnknownMailbox(email)

    def mark_needs_reauth(self, email: str) -> None:
        with _get_pool().connection() as conn:
            updated = conn.execute(
                f"update {ACCOUNTS_TABLE} set needs_reauth = true, updated_at = now() "  # noqa: S608
                f"where provider = %s and email = %s",
                (PROVIDER, email),
            ).rowcount
        if not updated:
            raise UnknownMailbox(email)

    def list_due_for_renewal(self, within_seconds: int) -> list[str]:
        """Mailboxes due for renewal, soonest expiry first.

        `watch_expires_at is null` covers a mailbox connected but never
        watched. The ordering means a run that does get cut short has at least
        handled the most urgent ones.
        """
        with _get_pool().connection() as conn:
            rows = conn.execute(
                f"select a.email from {ACCOUNTS_TABLE} a "  # noqa: S608
                f"left join {SYNC_TABLE} s on s.connected_account_id = a.id "
                f"where a.provider = %s and a.needs_reauth = false "
                f"  and a.email is not null "
                f"  and (s.watch_expires_at is null "
                f"       or s.watch_expires_at <= now() + make_interval(secs => %s)) "
                f"order by s.watch_expires_at asc nulls first",
                (PROVIDER, within_seconds),
            ).fetchall()
        return [row[0] for row in rows]

    def list_connected(self) -> list[str]:
        """Mailboxes whose token still works.

        Ordered so a renewal run touches accounts in a stable sequence, which
        makes a partial failure easier to reason about in the logs.
        """
        with _get_pool().connection() as conn:
            rows = conn.execute(
                f"select email from {ACCOUNTS_TABLE} "  # noqa: S608
                f"where provider = %s and needs_reauth = false and email is not null "
                f"order by email",
                (PROVIDER,),
            ).fetchall()
        return [row[0] for row in rows]


# --- selection ------------------------------------------------------------


def create_store() -> AccountStore:
    """Build the store for this deployment.

    Postgres when DATABASE_URL is set, the in-memory stand-in otherwise. The
    choice is configuration, not code: callers only ever see the AccountStore
    protocol, so neither function changes when a deployment gains a database.

    psycopg itself is imported lazily inside the pool, so a deployment without
    a database never loads it.
    """
    if os.environ.get("DATABASE_URL"):
        return PostgresStore()
    return InMemoryStore(_seed_from_env())
