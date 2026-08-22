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


class TokenRejected(Exception):
    """Google refused the refresh token, and no retry will change that.

    Raised for revocation, a password change, and — while the app is in
    Testing publishing status — the 7-day refresh-token expiry that applies to
    every user. Callers should mark the mailbox for re-consent and ack, not
    retry: the message would otherwise redeliver until the topic's retention
    runs out.
    """


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

    The token is exchanged for an access token here rather than lazily on the
    first API call, so a dead token surfaces as TokenRejected at a single known
    point instead of from somewhere deep in a request.
    """
    import google.auth.transport.requests  # noqa: PLC0415
    from google.auth.exceptions import RefreshError  # noqa: PLC0415
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

    try:
        credentials.refresh(google.auth.transport.requests.Request())
    except RefreshError as exc:
        # RefreshError covers invalid_grant (revoked, expired, password
        # changed) — all permanent. The message can carry token material, so
        # only the type is propagated.
        raise TokenRejected("refresh token rejected by Google") from exc

    # cache_discovery=False: the default file cache is unwritable on Cloud
    # Functions and logs a warning on every cold start.
    return build("gmail", "v1", credentials=credentials, cache_discovery=False)
