"""Where learned parse rules are kept.

Two implementations behind one shape, the same arrangement as accounts.py in
the ingest function: an in-memory store for tests and local runs, and a
Postgres one for deployments. `create_store()` picks between them from the
environment, so the pipeline is unchanged by the presence of a database.

The table is `public.email_parse_templates` (migration 0071). It is shared
across families rather than family-scoped, because a bank's template is the
same for everyone — which is only safe because a spec holds field labels and
no transaction data.
"""

import json
import logging
import os
from typing import Any

log = logging.getLogger(__name__)

TABLE = "public.email_parse_templates"

# Held per process. Cloud Functions reuses a warm instance for many
# invocations, so the pool outlives any one delivery.
_pool: Any = None


class InMemoryStore:
    """Specs for one process, lost when it exits.

    Used by tests and by a local run with no DATABASE_URL. Deliberately shares
    no code with the Postgres store beyond the shape: they are small enough
    that a shared base would cost more than it saves.
    """

    def __init__(self) -> None:
        self._by_source: dict[str, list[dict]] = {}

    def for_source(self, source: str) -> list[dict]:
        return list(self._by_source.get(source, []))

    def save(self, source: str, proposed: dict) -> None:
        specs = self._by_source.setdefault(source, [])
        if proposed not in specs:
            specs.append(proposed)


class PostgresStore:
    """Specs in Postgres.

    Connection notes, because they are easy to get wrong on Cloud Functions:
    Supabase's pooler in transaction mode (port 6543) is the right target for
    serverless, but it does not support prepared statements. The pool below is
    configured accordingly; leaving them on produces intermittent "prepared
    statement already exists" errors under load rather than a clean failure.

    Each method is a single statement in its own transaction. These run inside
    a function that also calls out to an LLM, and holding a pooled connection
    across that would be a good way to exhaust the pool.
    """

    def for_source(self, source: str) -> list[dict]:
        """Every stored spec for one sender.

        Ordered most-used first: a sender accumulates one spec per notice type,
        and trying the busiest first means the common case matches on the first
        attempt. Correctness does not depend on the order — validation decides
        that — so this is purely about doing less work.
        """
        with _get_pool().connection() as conn:
            rows = conn.execute(
                f"select spec from {TABLE} "  # noqa: S608 - TABLE is a module constant
                f"where source = %s "
                f"order by hit_count desc, id",
                (source,),
            ).fetchall()
        return [row[0] for row in rows]

    def save(self, source: str, proposed: dict) -> None:
        """Store a newly learned spec.

        `on conflict do nothing` rather than a check-then-insert: two
        invocations can learn from two mails off one template at the same time
        and propose an identical spec, and the unique index is the only thing
        that settles that without one of them raising.
        """
        with _get_pool().connection() as conn:
            conn.execute(
                f"insert into {TABLE} (source, spec, model) "  # noqa: S608
                f"values (%s, %s::jsonb, %s) "
                f"on conflict (source, spec) do nothing",
                (source, json.dumps(proposed), _model_name()),
            )

    def record_hit(self, source: str, spec: dict) -> None:
        """Note that a spec was used, for the ordering above and for spotting
        a rule that has quietly stopped matching since the bank changed its
        template.

        Best-effort by design: this is bookkeeping, and a mail that was read
        successfully must not be failed over a counter.
        """
        try:
            with _get_pool().connection() as conn:
                conn.execute(
                    f"update {TABLE} set hit_count = hit_count + 1, "  # noqa: S608
                    f"last_used_at = now() where source = %s and spec = %s::jsonb",
                    (source, json.dumps(spec)),
                )
        except Exception as exc:  # noqa: BLE001
            log.warning("could not record a spec hit for %s: %s", source, exc)


def create_store() -> Any:
    """The store this deployment should use.

    Postgres when DATABASE_URL is set, in-memory otherwise. An in-memory store
    is not a broken deployment: the pipeline still reads mail, it just relearns
    each template once per instance instead of once ever.
    """
    if os.environ.get("DATABASE_URL"):
        return PostgresStore()
    log.info("DATABASE_URL is not set; learned specs will not outlive this instance")
    return InMemoryStore()


def _model_name() -> str | None:
    """Which model proposed a spec, recorded so a rule that misreads can be
    traced back to what wrote it.

    Read from llm.MODEL, not from the environment: GEMINI_MODEL is only an
    override, so reading it directly leaves the column empty in the common case
    where the default is used — which is exactly when you would want to know
    what wrote a bad rule.
    """
    from . import llm  # noqa: PLC0415 - avoids a cycle at import time

    return llm.MODEL or None


def _dsn() -> str:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    return dsn


def _get_pool() -> Any:
    """The process-wide connection pool, opened on first use.

    Built lazily rather than at import so a function that never reaches the
    database does not need one.
    """
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool  # noqa: PLC0415

        _pool = ConnectionPool(
            _dsn(),
            min_size=0,  # a cold instance should not hold a connection open
            max_size=int(os.environ.get("DB_POOL_MAX", "2")),
            # Transaction-mode pooling cannot carry prepared statements between
            # statements on the same connection.
            kwargs={"prepare_threshold": None},
            open=True,
        )
    return _pool
