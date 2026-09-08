"""Provider and template-shape detection without extracting values."""

from .models import Detection, MatchStatus, NormalizedEmail


def detect(email: NormalizedEmail) -> Detection:
    signals = _fold(f"{email.subject} {email.body}")
    transaction_words = (
        "giao dich",
        "transaction",
        "so tien",
        "amount",
        "ghi co",
        "ghi no",
        "thanh toan",
        "nhan tien",
        "chuyen tien",
    )
    direction = None
    if any(word in signals for word in ("ghi co", "nhan tien", "refund", "hoan tien")):
        direction = "incoming"
    elif any(word in signals for word in ("ghi no", "thanh toan", "chuyen tien", "purchase")):
        direction = "outgoing"
    status = (
        MatchStatus.PARTIAL
        if any(word in signals for word in transaction_words)
        else MatchStatus.NOT_MATCHED
    )
    template = f"{email.source}:{direction}" if direction else None
    return Detection(email.source, email.subject_template, template, direction, status)


def _fold(value: str) -> str:
    import unicodedata

    return "".join(
        char
        for char in unicodedata.normalize("NFD", value.casefold())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
