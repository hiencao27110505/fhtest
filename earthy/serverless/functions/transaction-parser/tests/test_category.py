"""Choosing a spending category, and refusing to invent one.

The rules that matter: a category is cached per merchant so the model is asked
once rather than once per mail; an answer that is not one of the known
categories is discarded rather than stored; and a transaction with no category
is still a transaction.
"""

import pytest
from parser import category


class FakeStore:
    """In-memory stand-in, recording what it was asked to keep."""

    def __init__(self, known=None):
        self.known = dict(known or {})
        self.saved: list[tuple[str, str]] = []
        self.reads = 0

    def category_for(self, merchant):
        self.reads += 1
        return self.known.get(merchant)

    def save_category(self, merchant, cat):
        self.saved.append((merchant, cat))
        self.known.setdefault(merchant, cat)


@pytest.fixture
def asked(monkeypatch):
    """Merchants the model was asked about, in order."""
    seen: list[str] = []

    def fake(merchant, direction):
        seen.append(merchant)
        return "ăn uống"

    monkeypatch.setattr(category, "_ask", lambda m, d: fake(m, d))
    return seen


def test_a_known_merchant_does_not_reach_the_model(asked):
    store = FakeStore({"highlands coffee": "ăn uống"})

    guess = category.of("Highlands Coffee", "debit", store)

    assert guess.category == "ăn uống"
    assert guess.source == "store"
    assert asked == []  # the whole point of the cache


def test_an_unknown_merchant_is_asked_about_once(asked):
    """Asked once, then remembered: the second mail from the same merchant
    costs nothing."""
    store = FakeStore()

    first = category.of("Quán Cơm Tấm", "debit", store)
    second = category.of("Quán Cơm Tấm", "debit", store)

    assert first.source == "llm"
    assert second.source == "store"
    assert asked == ["quán cơm tấm"]
    assert store.saved == [("quán cơm tấm", "ăn uống")]


def test_the_merchant_is_normalised_before_it_is_looked_up(asked):
    """GRAB, Grab and 'grab  ' are one merchant.

    Without this the cache misses on spelling and the same merchant is asked
    about, and stored, several times over.
    """
    store = FakeStore({"grab": "đi lại"})

    for spelling in ("GRAB", "Grab", "  grab  ", "grab"):
        assert category.of(spelling, "debit", store).category == "đi lại"

    assert asked == []


@pytest.mark.parametrize("merchant", [None, "", "   "])
def test_no_merchant_means_no_category(merchant, asked):
    """A mail whose merchant could not be read still records a transaction;
    it just has nothing to categorise."""
    guess = category.of(merchant, "debit", FakeStore())

    assert guess.category is None
    assert asked == []


def test_an_answer_that_is_not_a_category_is_discarded(monkeypatch):
    """A model that invents a label has not answered.

    Storing it would put a value in the column that nothing else in the app
    knows about, and a spending report would show a category no one can filter
    by.
    """
    monkeypatch.setattr(category, "_ask", lambda m, d: None)
    store = FakeStore()

    guess = category.of("Tiệm Lạ", "debit", store)

    assert guess.category is None
    assert store.saved == []


def test_a_stored_value_that_is_not_a_category_is_ignored(asked):
    """Rows can go stale: a category removed from the list must not keep being
    served from the cache."""
    store = FakeStore({"tiệm cũ": "danh mục đã bỏ"})

    guess = category.of("Tiệm Cũ", "debit", store)

    assert guess.source == "llm"  # fell through to the model
    assert guess.category == "ăn uống"


def test_no_store_still_categorises(asked):
    """Without a store the model is asked every time. Slower and dearer, but
    the transaction is still categorised."""
    guess = category.of("Quán Mới", "debit", None)

    assert guess.category == "ăn uống"
    assert guess.source == "llm"


def test_a_store_that_raises_does_not_take_the_delivery_with_it(monkeypatch):
    """A database that is down degrades to asking the model."""
    monkeypatch.setattr(category, "_ask", lambda m, d: "đi lại")

    class Broken:
        def category_for(self, merchant):
            raise RuntimeError("db is down")

        def save_category(self, merchant, cat):
            raise RuntimeError("db is down")

    guess = category.of("Grab", "debit", Broken())

    assert guess.category == "đi lại"


def test_the_category_list_has_no_duplicates():
    # A duplicate would let the same spending be grouped twice in a report.
    assert len(category.CATEGORIES) == len(set(category.CATEGORIES))


def test_transfers_are_neither_spending_nor_income():
    """Money between the household's own wallets is not a flow in or out.

    Counting it as either inflates both sides of a cash-flow report, because
    the same dong appears once leaving one wallet and once entering another.
    """
    assert category.TRANSFER not in category.SPENDING
    assert category.TRANSFER not in category.INCOME
    assert category.TRANSFER in category.CATEGORIES
