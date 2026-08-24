"""The parser against real mail, in the shape production delivers it.

`bodies/` holds transaction mail fetched through the same Gmail API call the
ingest function makes, then normalised the same way — see
`tools/fetch_fixtures.py`. Every other test here hands the parser a sentence
someone wrote; these hand it what actually arrives.

That distinction keeps earning itself. Fixtures used to be pages saved from a
browser, which carried the Gmail interface, the inbox listing around the mail,
and Gmail's own AI summary — and that summary prints the transaction amount a
second time, in wording no bank uses. Every measurement taken against those
files was measuring the wrong thing.

WHY THESE ASSERT PROPERTIES, NOT VALUES

The bodies are real mail: real names, phone numbers, references and amounts.
They are gitignored, so this file cannot pin `amount == 391500` — the fixture
that figure came from is not in the repo, and writing it here would put the
figure in the repo instead.

So the assertions are about SHAPE. A body that names an amount must yield one;
a figure that is read must survive a round trip through masking; nothing that
is not money may be masked. Those hold for any real mail, which is what makes
them worth running on a corpus that changes whenever someone refetches.

Run `tools/fetch_fixtures.py` to populate `bodies/`. With it empty every test
here skips rather than fails: an empty corpus is a missing corpus, not a
broken parser.
"""

import pathlib
import re

import pytest
from parser import masking, spec

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
BODIES = FIXTURES / "bodies"

CORPUS = sorted(p.name for p in BODIES.glob("*.txt")) if BODIES.is_dir() else []

pytestmark = pytest.mark.skipif(
    not CORPUS,
    reason="no fixtures; run tools/fetch_fixtures.py to fetch real mail",
)

# A figure beside a currency marker, in any spelling Vietnamese mail uses.
# Used to ask "does this body name an amount at all" without knowing which.
#
# The marker must END a word. `đ` and `Đ` begin real Vietnamese words, and
# real mail puts them right after digits: `hotline 0943833122 để hủy vé`,
# `số 484-486 Đường 2/9`. Without the boundary this reads all three as money
# and reports a leak the masker was right not to have.
_MONEY = re.compile(
    r"[\d.,]{3,}\s*(?:VN[DĐ]|[đĐ₫])\b|(?:VN[DĐ]|₫)\s*[\d.,]{3,}", re.IGNORECASE
)

# Digits that are not money. None may be masked: masking one blinds the parser
# to a field it reads.
_NOT_MONEY = (
    re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b"),
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),
)

# What a mail calls its total, in the wording seen so far.
_TOTAL_LABELS = ("Tổng tiền", "Tổng cộng", "Số tiền")


def _body(name: str) -> str:
    return (BODIES / name).read_text()


def _total_label(body: str) -> str | None:
    return next((word for word in _TOTAL_LABELS if word in body), None)


@pytest.mark.parametrize("name", CORPUS)
def test_a_body_is_text_not_markup(name: str) -> None:
    """Normalisation happens in ingest, before the topic. Anything reaching
    the parser with tags in it means that step was skipped."""
    body = _body(name)

    assert "<td" not in body
    assert "<div" not in body
    assert "</" not in body


@pytest.mark.parametrize("name", CORPUS)
def test_a_body_that_names_an_amount_has_one_masked(name: str) -> None:
    """The property that matters most: every figure beside a currency marker
    is found. One that slips through is one sent to a third party."""
    body = _body(name)
    if not _MONEY.search(body):
        pytest.skip("this mail prints no amount")

    _, table = masking.mask(body)

    assert any(isinstance(value, int) for value in table.values())


@pytest.mark.parametrize("name", CORPUS)
def test_no_figure_beside_a_marker_survives_masking(name: str) -> None:
    masked, _ = masking.mask(_body(name))

    assert _MONEY.findall(masked) == []


@pytest.mark.parametrize("name", CORPUS)
def test_dates_and_times_are_not_masked(name: str) -> None:
    """Masking a date is not a small error: it takes away a field the parser
    reads, so a mail that was readable stops being readable."""
    body = _body(name)
    masked, _ = masking.mask(body)

    for pattern in _NOT_MONEY:
        for found in pattern.findall(body):
            assert found in masked, found


@pytest.mark.parametrize("name", CORPUS)
def test_masking_is_idempotent_on_real_mail(name: str) -> None:
    once, _ = masking.mask(_body(name))
    twice, table = masking.mask(once)

    assert twice == once
    assert table == {}


@pytest.mark.parametrize("name", CORPUS)
def test_every_masked_figure_restores_to_what_it_was(name: str) -> None:
    """The round trip on real figures. A name that does not restore is an
    amount the parser can never recover."""
    _, table = masking.mask(_body(name))

    for token, value in table.items():
        assert masking.restore(token, table) == value


@pytest.mark.parametrize("name", CORPUS)
def test_a_spec_written_for_this_mail_reads_its_amount(name: str) -> None:
    """End to end on real text: take the label the mail prints before its
    total, build the spec a learned rule would be, and read it back.

    Label-driven rather than value-driven on purpose — what is being tested is
    that the engine can anchor on what a mail prints, not that any particular
    mail says 391,500.
    """
    body = _body(name)
    label = _total_label(body)
    if label is None:
        pytest.skip("this mail names its total some other way")

    loaded = spec.Spec.from_dict(
        {"amount": {"label": label, "type": "money"},
         "direction": {"label": "debit", "type": "fixed"}}
    )
    result = spec.apply(loaded, body)

    assert result.amount is not None
    assert result.amount > 0


@pytest.mark.parametrize("name", CORPUS)
def test_a_value_does_not_swallow_the_field_below_it(name: str) -> None:
    """The bug only real mail showed.

    Gmail hands over the text/plain part when a mail has one, and those carry
    no tags — so a line ending is the only field boundary there is. While
    `strip_html` collapsed newlines to spaces, `Tổng tiền` read back as
    `165.000đ Giá vé 165.000đ Bảo hiểm 0đ`: one field swallowing four.
    """
    body = _body(name)
    label = _total_label(body)
    if label is None:
        pytest.skip("this mail names its total some other way")

    loaded = spec.Spec.from_dict({"amount": {"label": label, "type": "money"}})
    result = spec.apply(loaded, body)
    if result.amount is None:
        pytest.skip("no amount to read")

    # A total that swallowed the rows below it reads as an implausible figure:
    # the digits of several amounts run together. The bound is the validator's,
    # so this fails exactly where a real reading would be rejected.
    assert result.amount <= 500_000_000
