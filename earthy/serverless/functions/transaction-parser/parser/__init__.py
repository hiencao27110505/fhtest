"""Reading a transaction out of a bank email.

One entry point:

    result = parser.parse(source="techcombank", subject=..., body=...)

`result.ok` says whether anything usable came out; `result.reading` carries
the figures. Everything else in this package is how that happens, and callers
should not need to know it.

WHAT HAPPENS INSIDE

Templates are learned, not hand-written. The first mail off an unfamiliar
template is read by an LLM, which also proposes a reusable rule for it; every
later mail off that template is read by the rule, deterministically, with no
model involved. So the cost of a new bank is a couple of API calls once,
rather than a code change and a deploy.

Two stages, stopping at the first that produces a result that passes
validation:

1. STORED SPECS — every rule on file for this sender, tried in turn
   (`spec.apply`). This is the path almost every mail takes.
2. LLM — `llm.extract` reads the mail; `llm.induce` then proposes a rule for
   next time. The proposal is only saved if it can re-read the very mail it
   came from, so a plausible-sounding rule that does not actually work never
   reaches the database.

There is deliberately NO hand-written-regex stage. One existed and was
removed: tested against real mail it read a MoMo receipt correctly only by
matching the hyphen in "13:15 - 21/08/2026" as a minus sign, and read a
Techcombank notice's ACCOUNT NUMBER as the balance because "biến động số dư"
in the opening sentence anchored the balance pattern. Patterns that general
are right by luck and wrong in silence, which on a ledger is the worst way to
be wrong. An unfamiliar template now costs one API call instead.

Validation (`validate.check`) gates both stages, including the LLM's own
answer. That is deliberate: stage 1 picks between a sender's rules by trying
them, so "passes validation" is the whole of what stops a credit template
being applied to a debit notice and posting money the wrong way.

Nothing here raises for a mail it cannot read. An unreadable mail is a
result with `ok=False`, because Pub/Sub redelivers on exceptions and a mail
that fails once will fail identically every time.
"""

from .pipeline import Result, parse
from .templates import create_store

__all__ = ["Result", "create_store", "parse"]
