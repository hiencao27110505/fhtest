"""Save real transaction mail as fixtures, the way the pipeline sees it.

Fixtures used to be pages saved from a browser, and that turned out to be a
poor stand-in: a saved page carries the Gmail interface, the inbox listing
around the mail, and Gmail's own AI summary — which prints the transaction
amount a second time, in wording no bank uses. A spec learned from one of
those files would anchor on text that does not exist in production.

This fetches through the same API `gmail-transaction-ingest` uses, so what
lands on disk is exactly the MIME body the ingest function decodes.

    GMAIL_TOKEN_KEY=... DATABASE_URL=... \\
      uv run --no-project python tools/fetch_fixtures.py <mailbox> [label]

Writes two files per message under functions/transaction-parser/tests/fixtures:

    emails/<source>-<id>.html   the body as delivered
    bodies/<source>-<id>.txt    the same, after ingest normalises it

Read what it wrote before committing: these are real mail, and the repo rule
is that a fixture is real in SHAPE only. Replace the figures, names, account
numbers and references by hand — see fixtures/README.md.
"""

import base64
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
INGEST = ROOT / "functions" / "gmail-transaction-ingest"
FIXTURES = ROOT / "functions" / "transaction-parser" / "tests" / "fixtures"

sys.path.insert(0, str(INGEST))
sys.path.insert(0, str(ROOT / "shared"))

import accounts  # noqa: E402
import gmail_auth  # noqa: E402
import mailtext  # noqa: E402
import senders  # noqa: E402

# How many to take. A handful of templates is what makes a fixture set useful;
# a hundred near-identical receipts is just a slower test suite.
LIMIT = 12


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <mailbox> [label]  (default label: Transactions)")

    mailbox = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else "Transactions"

    account = accounts.create_store().get(mailbox)
    service = gmail_auth.build_client(account.refresh_token)

    label_id = _label_id(service, label)
    if label_id is None:
        sys.exit(f"no label named {label!r} in {mailbox}")

    listing = (
        service.users()
        .messages()
        .list(userId="me", labelIds=[label_id], maxResults=LIMIT)
        .execute()
    )
    ids = [m["id"] for m in listing.get("messages", [])]
    if not ids:
        sys.exit(f"label {label!r} holds no messages")

    (FIXTURES / "emails").mkdir(parents=True, exist_ok=True)
    (FIXTURES / "bodies").mkdir(parents=True, exist_ok=True)

    for message_id in ids:
        message = (
            service.users().messages().get(userId="me", id=message_id, format="full").execute()
        )
        payload = message.get("payload", {})
        headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}

        raw = _body(payload)
        if not raw:
            print(f"  skip {message_id}: no text part")
            continue

        source = senders.match(headers.get("from", "")) or "unknown"
        stem = f"{source}-{message_id[-8:]}"
        body = mailtext.declutter(mailtext.strip_html(raw))

        (FIXTURES / "emails" / f"{stem}.html").write_text(raw, encoding="utf-8")
        (FIXTURES / "bodies" / f"{stem}.txt").write_text(body, encoding="utf-8")
        print(f"  {len(raw):>8,} -> {len(body):>6,}  {stem}  {headers.get('subject', '')[:44]}")

    print(f"\nwrote to {FIXTURES}")
    print("ANONYMISE BEFORE COMMITTING — see fixtures/README.md")


def _label_id(service, name: str) -> str | None:
    """Gmail's id for a user label. Matched case-insensitively on the name."""
    labels = service.users().labels().list(userId="me").execute().get("labels", [])
    for label in labels:
        if label["name"].lower() == name.lower():
            return label["id"]
    return None


def _body(payload: dict) -> str:
    """The decoded body, exactly as gmail-transaction-ingest decodes one.

    Deliberately a copy of that function rather than an import: this script
    has to keep producing what ingest produces, and a shared helper that
    drifted would leave the fixtures quietly describing a different pipeline.
    """
    plain, htm = _collect_parts(payload)
    data = plain or htm
    if not data:
        return ""
    return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")


def _collect_parts(part: dict) -> tuple[str, str]:
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data", "")
    if data:
        if mime == "text/plain":
            return data, ""
        if mime == "text/html":
            return "", data

    plain = htm = ""
    for child in part.get("parts", []):
        child_plain, child_html = _collect_parts(child)
        plain = plain or child_plain
        htm = htm or child_html
    return plain, htm


if __name__ == "__main__":
    main()
