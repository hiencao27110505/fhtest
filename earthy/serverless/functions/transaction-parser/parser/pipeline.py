"""The cascade. See the package docstring for what it is and why.

This module owns the ordering and the promotion rule; the stages themselves
live in their own modules and know nothing about each other.
"""

import logging
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol, cast

from . import category as category_mod
from . import llm, spec, validate

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Result:
    """What came out of parsing one mail.

    `stage` names where the answer came from — "spec" or "llm" — so the logs
    show how much of the traffic still needs a model. `reasons` is why nothing
    worked, when nothing did.

    `ok` is derived from `reading` rather than stored beside it: they cannot
    then disagree, and a caller that checks `ok` first is left holding a
    `reading` the type checker knows is present.
    """

    reading: spec.Extracted | None = None
    stage: str = ""
    reasons: tuple[str, ...] = ()
    learned: bool = False

    # What kind of spending this was, and whether it was already known. Not
    # part of `reading` because it is not read off the mail: it is inferred
    # from the merchant, and a mail that was read perfectly can still have no
    # category. See category.py.
    category: str | None = None
    category_source: str = ""

    # Which stored spec produced this, when one did. Lets the store credit the
    # spec that worked, so it can try the busiest one first next time.
    spec: dict | None = None

    @property
    def ok(self) -> bool:
        """Whether the mail was read."""
        return self.reading is not None


class Templates(Protocol):
    """What the pipeline needs from storage.

    Structural, so nothing has to inherit from it: the Postgres-backed store
    lands in templates.py without this module changing, and a test passes an
    in-memory stand-in that just has the two methods.
    """

    def for_source(self, source: str) -> list[dict]:
        """Every stored spec for this sender, as spec.Spec-shaped dicts."""
        ...

    def save(self, source: str, proposed: dict) -> None:
        """Record a newly learned spec for this sender."""
        ...


def parse(source: str, body: str, templates: Templates | None = None) -> Result:
    """Read one mail. Never raises.

    `body` is the flattened text; `source` is the sender label the ingest
    function assigned. `templates` is optional so the deterministic stages can
    run with no database at all.
    """
    stored = _stored(templates, source)

    result = _try_stored(stored, body)
    if result is not None:
        _record_hit(templates, source, result.spec)
        return _categorised(result, templates)

    return _categorised(_try_llm(source, body, templates), templates)


def _categorised(result: Result, templates: "Templates | None") -> Result:
    """Attach a category, if one can be worked out.

    Runs on the result rather than inside either stage: the category depends
    on the merchant, and both stages produce one the same way. A mail that
    could not be read has no merchant and so gets no category, which is
    correct — there is nothing to categorise.
    """
    if result.reading is None:
        return result

    store = templates if _can_store_categories(templates) else None
    guess = category_mod.of(
        result.reading.merchant,
        result.reading.direction,
        cast("category_mod.Store | None", store),
    )
    return replace(result, category=guess.category, category_source=guess.source)


def _can_store_categories(templates: "Templates | None") -> bool:
    """Whether this store keeps categories as well as specs.

    Optional on the protocol, the same way `record_hit` is: an in-memory store
    used by a test need not have them, and the pipeline still works — it just
    asks the model once per mail instead of once per merchant.
    """
    return hasattr(templates, "category_for") and hasattr(templates, "save_category")


def _try_stored(stored: list[dict], body: str) -> Result | None:
    """Apply each stored spec that is meant for this mail, until one produces
    a result that validates.

    Order is whatever the store returned. There is no cleverness about which
    spec to try first: `matches` excludes the ones written for another of this
    sender's templates, and validation decides correctness among what is left.
    """
    for raw in stored:
        try:
            loaded = spec.Spec.from_dict(raw)
        except spec.InvalidSpec as exc:
            # A stored spec that no longer loads is a data problem, not a mail
            # problem: skip it and let the other specs have their turn.
            log.warning("stored spec is unusable: %s", exc)
            continue

        if not spec.matches(loaded, body):
            # Written for a different notice from this sender. Checked before
            # applying, not after: two variants can share every label and
            # differ only in direction, so both would read cleanly and both
            # would validate, and whichever was tried first would win.
            continue

        extracted = spec.apply(loaded, body)
        if validate.check(extracted, body):
            return Result(reading=extracted, stage="spec", spec=raw)
    return None


def _try_llm(source: str, body: str, templates: Templates | None) -> Result:
    """Read the mail with a model, and try to learn a rule from it."""
    if not llm.enabled():
        return Result(reasons=("no stored spec matched; LLM is not configured",))

    reading = llm.extract(body)
    if reading is None:
        return Result(reasons=("no stored spec matched; LLM returned nothing",))

    extracted = spec.Extracted(
        amount=reading.amount,
        balance=reading.balance,
        direction=reading.direction,
        merchant=spec.free_text(reading.merchant),
        occurred_at=_parsed_datetime(reading.occurred_at),
        reference=spec.reference(reading.reference),
        account_tail=spec.account_tail(reading.account_tail),
        description=spec.free_text(reading.description),
        channel=spec.free_text(reading.channel),
    )

    verdict = validate.check(extracted, body)
    if not verdict:
        # The model's answer is judged exactly like a spec's. Sounding
        # confident is not evidence.
        return Result(reasons=verdict.reasons)

    learned = _learn(source, body, reading, extracted, templates)
    return Result(reading=extracted, stage="llm", learned=learned)


def _learn(
    source: str,
    body: str,
    reading: llm.Reading,
    extracted: spec.Extracted,
    templates: Templates | None,
) -> bool:
    """Ask for a reusable spec, and store it only if it actually works.

    The check is the whole point: the proposal has to match and re-read the
    very mail it was derived from, and agree with what the model read. A spec that cannot do
    that would be applied to every future mail from this sender, so accepting
    one on the model's word alone is how a whole bank's transactions end up
    silently wrong.

    Failing to learn is not a failure to parse — the mail was read either way.
    """
    if templates is None:
        return False

    proposed = llm.induce(body, reading)
    if proposed is None:
        return False

    try:
        loaded = spec.Spec.from_dict(proposed)
    except spec.InvalidSpec as exc:
        log.warning("proposed spec for %s did not load: %s", source, exc)
        return False

    if not spec.matches(loaded, body):
        # The phrases have to be found in the very mail they were taken from.
        # A proposal that fails this would be stored and then never match
        # anything — inert, and invisibly so, because nothing downstream ever
        # asks why a spec is not being used.
        log.warning("proposed spec for %s does not match its own mail", source)
        return False

    replay = spec.apply(loaded, body)
    if not _agrees(replay, extracted):
        log.warning(
            "proposed spec for %s did not reproduce the reading: %s vs %s",
            source,
            replay,
            extracted,
        )
        return False

    try:
        templates.save(source, proposed)
    except Exception as exc:  # noqa: BLE001
        # Storage is a nicety here: the mail has already been read. Losing the
        # spec costs one more LLM call next time, which is not worth failing a
        # delivery over.
        log.warning("could not store spec for %s: %s", source, exc)
        return False

    # The phrases go in the log line, not just the fact that something was
    # learned. A spec is only worth its two API calls if it goes on to match
    # the NEXT mail off its template, and the way that fails is a phrase the
    # model drew too narrowly — one carrying a shop name, a seat number, a
    # figure. Such a spec matches the mail it came from and nothing else, so
    # it looks learned while every later mail still pays for a model.
    #
    # Logged rather than rejected because narrowness is not decidable from one
    # mail. What tells them apart is `hit_count` staying at zero, which is a
    # question for whoever reads these lines against the table.
    log.info(
        "learned a spec for %s: fields=%s match=%s",
        source,
        sorted(field for field in proposed if field != "match"),
        proposed.get("match", "(none — applies to any mail from this sender)"),
    )
    return True


def _parsed_datetime(value: str | None) -> datetime | None:
    """The model's timestamp, which it was asked to give in ISO order.

    A value it got wrong reads as None rather than raising: the mail was still
    read, and a missing time is a missing field, not a failed delivery.
    """
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        log.warning("model returned an unparseable occurred_at")
        return None


def _agrees(replay: spec.Extracted, reading: spec.Extracted) -> bool:
    """Whether a replayed spec read the same transaction as the model did.

    Compares the fields that decide money, not merchant. A spec reads merchant
    as "everything up to the next label", which routinely keeps a trailing
    sign-off the model left out — a cosmetic difference that says nothing
    about whether the spec found the right row.
    """
    return (
        replay.amount == reading.amount
        and replay.direction == reading.direction
        and replay.balance == reading.balance
    )


def _record_hit(templates: Templates | None, source: str, used: dict | None) -> None:
    """Credit the spec that read this mail, if the store keeps counters.

    Optional on the protocol: an in-memory store has nothing to count. Never
    raises — the mail has already been read, and bookkeeping must not undo it.
    """
    recorder = getattr(templates, "record_hit", None)
    if recorder is None or used is None:
        return
    try:
        recorder(source, used)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not record a spec hit for %s: %s", source, exc)


def _stored(templates: Templates | None, source: str) -> list[dict]:
    """Stored specs, or none if storage is absent or unreachable."""
    if templates is None:
        return []
    try:
        return templates.for_source(source)
    except Exception as exc:  # noqa: BLE001
        # A database that is down must degrade to the LLM stage, not take the
        # delivery with it.
        log.warning("could not read specs for %s: %s", source, exc)
        return []
