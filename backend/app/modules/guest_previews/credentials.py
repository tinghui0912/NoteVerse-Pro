"""Guest Preview bearer generation and one-way lookup identity."""

import hashlib
import secrets


def issue_guest_preview_token() -> str:
    return secrets.token_urlsafe(32)


def guest_preview_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
