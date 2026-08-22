"""Make this function's own modules importable, and win over any same-named
module from a sibling function.

Every function has a `main.py`. pytest collects the whole workspace in one
process, so without this the first `main` imported wins and the other
function's tests bind to the wrong module.
"""

import sys
from pathlib import Path

_HERE = str(Path(__file__).parent)


def pytest_collectstart():
    # Re-asserted per collection: sys.path order alone is not enough once a
    # sibling `main` is already in sys.modules.
    if _HERE in sys.path:
        sys.path.remove(_HERE)
    sys.path.insert(0, _HERE)
    for name in ("main", "senders", "parsing", "accounts", "gmail_auth"):
        module = sys.modules.get(name)
        if module and not getattr(module, "__file__", "").startswith(_HERE):
            del sys.modules[name]
