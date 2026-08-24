"""Obtain a Gmail refresh token for one mailbox, interactively.

Run locally. It opens a browser, you sign in and grant access, and it prints
the resulting tokens. Nothing about this can be automated away: the consent is
the whole point, and only the account owner can give it.

    make authorize

What you get back:

  * refresh_token — the long-lived credential. This is what gets stored.
  * access_token  — valid for about an hour, shown only so you can confirm the
                    grant works. It is deliberately NOT stored: google-auth
                    mints a fresh one from the refresh token whenever a
                    function needs it.

The refresh token is as good as a password on the mailbox. Printing it puts it
in your terminal scrollback, so --out writes it to a file instead when you
would rather it not be on screen.
"""

import argparse
import json
import os
import pathlib
import sys

# Read-only: this pipeline never sends, modifies, or deletes mail, and a
# narrower scope is a smaller blast radius if the token leaks.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _load_dotenv(path: pathlib.Path) -> None:
    """Minimal .env reader — enough for KEY=value, quoted or not."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("'\"")
        os.environ.setdefault(key.strip(), value)


def _client_config() -> dict:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        sys.exit(
            "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set.\n"
            "Create an OAuth client (Console -> APIs & Services -> Credentials)\n"
            "and put both values in serverless/.env."
        )
    # A Web application client, which is what the app itself will use later.
    # Unlike a Desktop client, it accepts only redirect URIs registered in the
    # Console — hence REDIRECT_URI below and the note in the error message.
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [_redirect_uri()],
        }
    }


def _redirect_uri() -> str:
    """Where Google sends the browser back after consent.

    Must match an entry under "Authorized redirect URIs" on the OAuth client,
    character for character — including the scheme, the port, and the trailing
    slash. A mismatch is Google's error 400 redirect_uri_mismatch.
    """
    return f"http://localhost:{_port()}/"


_PORT = 8765


def _port() -> int:
    return _PORT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        help="write the credentials here as JSON instead of printing them",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="local port for the OAuth loopback (default: 8765)",
    )
    args = parser.parse_args()

    _load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env")

    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    global _PORT
    _PORT = args.port

    flow = InstalledAppFlow.from_client_config(_client_config(), SCOPES)
    # run_local_server derives its own redirect from the port; setting it here
    # keeps the value identical to the one sent in the authorization request.
    flow.redirect_uri = _redirect_uri()

    # access_type=offline is what makes Google issue a refresh token at all.
    # prompt=consent forces the consent screen even for an account that has
    # already granted access — without it a re-authorization returns an access
    # token and NO refresh token, because Google only sends one on the first
    # grant. For a background service, always send both.
    print(f"redirect URI in use: {_redirect_uri()}")
    print("It must be registered on the OAuth client, or Google returns")
    print("error 400 redirect_uri_mismatch.\n")

    creds = flow.run_local_server(
        port=args.port,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Opening a browser to authorize Gmail access...",
        success_message="Authorized. You can close this tab and return to the terminal.",
    )

    if not creds.refresh_token:
        sys.exit(
            "Google returned no refresh token.\n"
            "Revoke this app at https://myaccount.google.com/permissions and retry."
        )

    # Confirm the grant actually works rather than trusting the redirect.
    if not creds.valid:
        creds.refresh(Request())
    profile = (
        build("gmail", "v1", credentials=creds, cache_discovery=False)
        .users()
        .getProfile(userId="me")
        .execute()
    )

    payload = {
        "email": profile["emailAddress"],
        "refresh_token": creds.refresh_token,
        "access_token": creds.token,
        "scopes": list(creds.scopes or []),
        "messages_total": profile.get("messagesTotal"),
        "history_id": profile.get("historyId"),
    }

    if args.out:
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        args.out.chmod(0o600)
        print(f"authorized {payload['email']}")
        print(f"credentials written to {args.out} (mode 600)")
        return 0

    print()
    print(f"  mailbox        {payload['email']}")
    print(f"  messages       {payload['messages_total']}")
    print(f"  historyId      {payload['history_id']}")
    print(f"  scopes         {' '.join(payload['scopes'])}")
    print()
    print("  access_token   (expires in ~1h; not stored — google-auth mints these)")
    print(f"    {payload['access_token']}")
    print()
    print("  refresh_token  (this is the one that gets stored, encrypted)")
    print(f"    {payload['refresh_token']}")
    print()
    print("  Treat the refresh token like a password on this mailbox. It is now")
    print("  in your terminal scrollback — use --out next time to avoid that.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
