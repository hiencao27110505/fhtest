"""Idempotent normalization for already-flattened email text."""

import re
import unicodedata

from .models import EmailInput, NormalizedEmail

_INVISIBLE = re.compile(r"[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]")
_SPACE = re.compile(r"[^\S\n]+")
_LINES = re.compile(r"[ \t]*\n[ \t\n]*")
_BREAKS = re.compile(r"(?:\s*·\s*)+")
_FORWARD = re.compile(r"^(?:(?:fwd?|re|chuyển tiếp)\s*:\s*)+", re.IGNORECASE)
_REF = re.compile(r"(?:#\s*[A-Z0-9-]{5,}|\b\d{6,}\b)", re.IGNORECASE)
_DATE = re.compile(r"\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b")


def normalize_email(value: EmailInput) -> NormalizedEmail:
    source = " ".join(str(value.source or "").split()).strip().lower()
    subject = unicodedata.normalize("NFC", str(value.subject or "")).strip()
    body = normalize_text(str(value.body or ""))
    return NormalizedEmail(source, subject, normalize_subject(subject), body)


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\xa0", " ")
    text = _INVISIBLE.sub("", text)
    text = _LINES.sub(" · ", text)
    text = _SPACE.sub(" ", text)
    text = _BREAKS.sub(" · ", text)
    fields: list[str] = []
    for raw in text.split("·"):
        field = raw.strip()
        if field and (not fields or field != fields[-1]):
            fields.append(field)
    return " · ".join(fields)


def normalize_subject(subject: str) -> str:
    value = _FORWARD.sub("", unicodedata.normalize("NFC", subject))
    value = _DATE.sub(" ", _REF.sub(" ", value))
    return " ".join(value.casefold().split())
