"""Connect one mailbox end to end: authorize, encrypt, store.

    make connect

Opens a browser for consent, encrypts the resulting refresh token with
GMAIL_TOKEN_KEY, and writes it to connected_accounts. Run it once per mailbox
you want watched — the account owner has to be at the browser, because consent
is the one step nothing can automate.

Re-running for an already-connected mailbox replaces its token and clears
needs_reauth, which is exactly what a user reconnecting after the 7-day
Testing-status expiry needs.

The sync cursor is deliberately left alone: gmail-watch-renew seeds it when it
registers the watch, and overwriting a live cursor would skip every message
between it and now.
"""

import argparse
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gmail_authorize  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _database_url() -> str:
    """DATABASE_URL, from serverless/.env (already loaded) or the environment.

    Deployed functions get it from Secret Manager; this is the local path.
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit(
            "DATABASE_URL is not set.\n"
            "Uncomment it in serverless/.env — the Supabase pooler URL, port 6543."
        )
    return url


def resolve_user(conn: object, email: str) -> str:
    """The auth.users id that owns this address.

    Looked up from the address Google returned, not passed in on the command
    line: a mistyped id would file the mailbox under the wrong person, and
    nothing downstream would ever notice.
    """
    row = conn.execute(  # type: ignore[attr-defined]
        "select id from auth.users where lower(email) = lower(%s)", (email,)
    ).fetchone()
    if row is None:
        sys.exit(
            f"No auth.users row for {email}.\n"
            "The owner has to exist as a user before their mail can be linked\n"
            "to them. Create the account first, then re-run."
        )
    return str(row[0])


def store(credentials: dict, dsn: str) -> tuple[int, str, str]:
    """Insert or refresh the row for this mailbox.

    Returns (connected_accounts id, email, owning user id).
    """
    import psycopg  # noqa: PLC0415
    from cryptography.fernet import Fernet  # noqa: PLC0415

    key = os.environ.get("GMAIL_TOKEN_KEY")
    if not key:
        sys.exit("GMAIL_TOKEN_KEY is not set — cannot encrypt the token.")

    ciphertext = Fernet(key.encode()).encrypt(credentials["refresh_token"].encode())

    with psycopg.connect(dsn) as conn:
        user_id = resolve_user(conn, credentials["email"])
        row = conn.execute(
            """
            insert into public.connected_accounts
              (user_id, provider, provider_account_id, email,
               refresh_token_enc, scopes)
            values (%s, 'google', %s, %s, %s, %s)
            on conflict (provider, provider_account_id) do update set
              refresh_token_enc = excluded.refresh_token_enc,
              scopes            = excluded.scopes,
              needs_reauth      = false,
              updated_at        = now()
            returning id, email
            """,
            (
                user_id,
                credentials["email"],
                credentials["email"],
                ciphertext,
                " ".join(credentials["scopes"]),
            ),
        ).fetchone()
        conn.commit()
    assert row is not None  # noqa: S101 - RETURNING on a guaranteed upsert
    return row[0], row[1], user_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port", type=int, default=8765, help="OAuth loopback port (default: 8765)"
    )
    parser.add_argument(
        "--from-file",
        type=pathlib.Path,
        help="skip the browser and read credentials from a previous --out file",
    )
    args = parser.parse_args()

    gmail_authorize._load_dotenv(ROOT / ".env")
    dsn = _database_url()

    if args.from_file:
        credentials = json.loads(args.from_file.read_text())
        print(f"using credentials from {args.from_file}")
    else:
        credentials = _authorize(args.port)

    account_id, email, user_id = store(credentials, dsn)
    print()
    print(f"  connected  {email}")
    print(f"  owner      auth.users {user_id}")
    print(f"  row        connected_accounts id={account_id}")
    print(
        f"  historyId  {credentials.get('history_id')} (mailbox position now)")
    print()
    print("  Next: `make renew` registers the Gmail watch for it.")
    return 0


def _authorize(port: int) -> dict:
    """Run the consent flow and return the credential payload."""
    from google.auth.transport.requests import Request  # noqa: PLC0415
    from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: PLC0415
    from googleapiclient.discovery import build  # noqa: PLC0415

    gmail_authorize._PORT = port
    flow = InstalledAppFlow.from_client_config(
        gmail_authorize._client_config(), gmail_authorize.SCOPES
    )
    flow.redirect_uri = gmail_authorize._redirect_uri()

    print(f"redirect URI in use: {gmail_authorize._redirect_uri()}")
    print("It must be registered on the OAuth client.\n")

    creds = flow.run_local_server(
        port=port,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Opening a browser to authorize Gmail access...",
        success_message="Authorized. You can close this tab.",
    )
    if not creds.refresh_token:
        sys.exit(
            "Google returned no refresh token.\n"
            "Revoke the app at https://myaccount.google.com/permissions and retry."
        )
    if not creds.valid:
        creds.refresh(Request())

    profile = (
        build("gmail", "v1", credentials=creds, cache_discovery=False)
        .users()
        .getProfile(userId="me")
        .execute()
    )
    return {
        "email": profile["emailAddress"],
        "refresh_token": creds.refresh_token,
        "scopes": list(creds.scopes or []),
        "history_id": profile.get("historyId"),
    }


if __name__ == "__main__":
    raise SystemExit(main())
