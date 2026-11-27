"""Password policy, opaque credentials and host-only cookie attributes."""

import unicodedata
import pytest
from fastapi import Response
from app.platform.security.passwords import hash_password, verify_password, validate_password
from app.platform.security.opaque_tokens import generate_token, token_digest, matches_digest
from app.platform.security.cookies import set_session_cookie, clear_session_cookie
from app.runtime.customer_api.settings import CustomerApiSettings


@pytest.mark.parametrize("value", ["a" * 11, "a" * 129, " " * 12, "\t" * 12])
def test_password_policy_rejects_invalid_bounds_and_blanks(value):
    with pytest.raises(ValueError):
        validate_password(value)


@pytest.mark.parametrize("length", [12, 128])
def test_argon2id_passwords_and_unicode_normalization(length):
    password = "é" + "a" * (length - 1)
    digest = hash_password(password)
    assert digest.startswith("$argon2id$")
    assert verify_password(unicodedata.normalize("NFD", password), digest)
    assert not verify_password("incorrect-password", digest)
    assert not verify_password(password, "invalid hash")


def test_password_schema_normalizes_before_length_and_change_comparison():
    from app.modules.auth.schemas import LoginRequest, RegisterRequest, ChangePasswordRequest

    password = "é" * 128
    decomposed = unicodedata.normalize("NFD", password)
    assert LoginRequest(email="member@example.com", password=decomposed).password == password
    assert (
        RegisterRequest(
            email="member@example.com", display_name="Member", password=decomposed
        ).password
        == password
    )
    with pytest.raises(ValueError):
        ChangePasswordRequest(current_password=decomposed, new_password=password)


def test_opaque_tokens_have_full_entropy_size_and_digest_identity():
    tokens = {generate_token() for _ in range(100)}
    assert len(tokens) == 100 and all(len(t) == 43 for t in tokens)
    token = tokens.pop()
    assert len(token_digest(token)) == 64 and matches_digest(token, token_digest(token))
    assert not matches_digest(generate_token(), token_digest(token))


@pytest.mark.parametrize("secure,name", [(True, "__Host-nv_session"), (False, "nv_session")])
def test_session_cookie_transport_invariants(secure, name):
    response = Response()
    set_session_cookie(response, "opaque", secure_cookies=secure, max_age=3600)
    value = response.headers["set-cookie"]
    assert (
        value.startswith(name + "=")
        and "HttpOnly" in value
        and "Path=/" in value
        and "SameSite=lax" in value
    )
    assert ("Secure" in value) == secure and "Domain=" not in value
    clear_session_cookie(response, secure_cookies=secure)
    assert "Max-Age=0" in response.headers.getlist("set-cookie")[-1]


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_production_cookie_policy_is_fail_closed(environment):
    with pytest.raises(ValueError):
        CustomerApiSettings(ENVIRONMENT=environment, AUTH_COOKIE_SECURE=False)
    assert CustomerApiSettings(ENVIRONMENT=environment, AUTH_COOKIE_SECURE=True).AUTH_COOKIE_SECURE
