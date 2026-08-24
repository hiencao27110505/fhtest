import gmail_auth
import pytest


def test_client_config_reads_both_halves(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "id-1")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "secret-1")
    assert gmail_auth.client_config() == ("id-1", "secret-1")


def test_client_config_raises_when_unset(monkeypatch):
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
    with pytest.raises(gmail_auth.CredentialsUnavailable):
        gmail_auth.client_config()


def test_client_config_raises_when_half_configured(monkeypatch):
    # An id without a secret is a misconfiguration, not a usable client.
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "id-1")
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
    with pytest.raises(gmail_auth.CredentialsUnavailable):
        gmail_auth.client_config()


def test_scope_is_read_only():
    # Widening this scope widens the blast radius of a leaked token.
    assert gmail_auth.SCOPES == ["https://www.googleapis.com/auth/gmail.readonly"]
