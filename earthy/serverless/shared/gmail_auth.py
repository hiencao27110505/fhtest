"""Turning a stored refresh token into a usable Gmail client.

The OAuth client id and secret identify *this application* and are the same
for every user; the refresh token identifies *one user's* grant. Together they
mint short-lived access tokens, which google-auth refreshes on demand — the
caller never handles expiry.
"""

import logging
import os

from accounts import SCOPES

log = logging.getLogger(__name__)

_TOKEN_URI = "https://oauth2.googleapis.com/token"


class CredentialsUnavailable(Exception):
    """The app's OAuth client is not configured.

    Distinct from a user problem: every mailbox fails until it is fixed, so
    the caller should raise and let the message redeliver rather than ack.
    """


def client_config() -> tuple[str, str]:
    """The app's OAuth client id and secret.

    Read from the environment, which on GCP is fed by Secret Manager rather
    than a plain env var — the secret is per-application, not per-user, but it
    is still a secret.
    """
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise CredentialsUnavailable(
            "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set"
        )
    return client_id, client_secret


def build_client(refresh_token: str):
    """A Gmail API client acting as the user who granted `refresh_token`.

    google-auth exchanges the refresh token for an access token on the first
    call and renews it as needed, so nothing above this line deals with token
    lifetimes.
    """
    from google.oauth2.credentials import Credentials  # noqa: PLC0415
    from googleapiclient.discovery import build  # noqa: PLC0415

    client_id, client_secret = client_config()
    credentials = Credentials(
        token=None,  # forces a refresh on first use
        refresh_token=refresh_token,
        token_uri=_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )
    # cache_discovery=False: the default file cache is unwritable on Cloud
    # Functions and logs a warning on every cold start.
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)
