"""Opaque credential generation and digest comparisons."""

import hashlib
import hmac
import secrets


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def matches_digest(token: str, digest: str) -> bool:
    return hmac.compare_digest(token_digest(token), digest)
