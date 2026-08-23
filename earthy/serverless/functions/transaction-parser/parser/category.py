"""What kind of spending a transaction was.

Every other field in this package is READ from the mail: the amount, the
balance, the labels. A category is not — no bank prints one. It is inferred
from the merchant, which means it is the one field here that can be wrong
without the mail being wrong, and the one a household will want to correct.

That shapes the design:

* It is keyed on the MERCHANT, not on the template. A merchant appears in
  several templates, and a template carries many merchants, so a category
  stored against a template would be wrong for most mail it was applied to.
* It is cached. The model is asked once per merchant, not once per mail, so a
  household that shops in the same places stops paying for this almost
  immediately — the same bargain `templates` makes for parse rules.
* It is never required. A transaction with no category is a transaction that
  still counts toward the month's total; guessing one to fill the column is
  how a spending report becomes confidently wrong.

The categories are fixed rather than free text. A model asked for an open
label invents a new spelling every few mails ("ăn uống", "Ăn Uống", "đồ ăn"),
and a report that groups by category then shows the same spending three
times.
"""

import logging
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger(__name__)

# The categories a household actually thinks in. Vietnamese, because that is
# what the app shows; the app's own i18n turns them into English.
#
# Deliberately coarse. Each split has to earn itself: a category nobody
# filters by is a category that only makes the model's job harder.
SPENDING = (
    "ăn uống",       # restaurants, cafés, delivery
    "chợ siêu thị",  # groceries and everyday household shopping
    "đi lại",        # ride-hailing, fuel, parking, fares
    "hóa đơn",       # electricity, water, internet, phone
    "nhà cửa",       # rent, repairs, furnishings
    "sức khỏe",      # clinics, pharmacies, insurance
    "giáo dục",      # tuition, books, courses
    "mua sắm",       # clothes, electronics, general retail
    "giải trí",      # cinema, streaming, travel, games
    "biếu tặng",     # gifts, weddings, charity
)

INCOME = (
    "lương",     # salary
    "thu khác",  # everything else coming in
)

# Money moving between the household's own wallets. Neither spending nor
# income: counting it as either inflates both sides of a cash-flow report,
# because the same dong appears once leaving one wallet and once entering
# another.
TRANSFER = "chuyển nội bộ"

CATEGORIES = SPENDING + INCOME + (TRANSFER,)


class Store(Protocol):
    """What this module needs from storage.

    Structural, like `pipeline.Templates`: a test passes an in-memory stand-in
    with these two methods and nothing has to inherit from anything.
    """

    def category_for(self, merchant: str) -> str | None:
        """The category already known for this merchant, if any."""
        ...

    def save_category(self, merchant: str, category: str) -> None:
        """Remember a category for this merchant."""
        ...


@dataclass(frozen=True)
class Guess:
    """A category and where it came from.

    `source` is "store" when it was already known and "llm" when the model was
    asked, so the logs show how much of the traffic still costs an API call.
    """

    category: str | None = None
    source: str = ""


def of(merchant: str | None, direction: str | None, store: Store | None = None) -> Guess:
    """The category for one transaction. Never raises.

    Returns an empty guess when there is nothing to go on — no merchant, no
    store, no model, or a model that answered with something that is not a
    category. The caller records the transaction either way.
    """
    key = normalise(merchant)
    if not key:
        return Guess()

    known = _known(store, key)
    if known:
        return Guess(category=known, source="store")

    guessed = _ask(key, direction)
    if guessed is None:
        return Guess()

    _remember(store, key, guessed)
    return Guess(category=guessed, source="llm")


def normalise(merchant: str | None) -> str:
    """The key a category is stored against.

    Case-folded and whitespace-squashed so `GRAB`, `Grab` and `grab  ` are one
    merchant rather than three rows that can disagree with each other.
    """
    if not merchant:
        return ""
    return " ".join(merchant.split()).strip().lower()


def _known(store: Store | None, key: str) -> str | None:
    """The stored category, or None if there is no store or it is unreachable.

    A database that is down must degrade to asking the model, not take the
    delivery with it.
    """
    if store is None:
        return None
    try:
        found = store.category_for(key)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read a category for %r: %s", key, exc)
        return None
    return found if found in CATEGORIES else None


def _remember(store: Store | None, key: str, category: str) -> None:
    """Store a category. Best-effort: losing it costs one more API call."""
    if store is None:
        return
    try:
        store.save_category(key, category)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not store a category for %r: %s", key, exc)


def _ask(merchant: str, direction: str | None) -> str | None:
    """Ask the model which category this merchant belongs to.

    Only the merchant name is sent — never the amount, the balance or the mail
    body. A merchant name is what a category depends on, and it is already the
    least sensitive thing in the transaction.
    """
    from . import llm  # noqa: PLC0415 - avoids a cycle at import time

    if not llm.enabled():
        return None
    return llm.categorise(merchant, direction)
