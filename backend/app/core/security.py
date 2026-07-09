"""Security helpers for token creation and password hashing."""

from datetime import timedelta
from uuid import uuid4

import jwt
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

from .config import settings
from app.utils.timezone import utc_now


password_hash = PasswordHash.recommended()

ALGORITHM = "HS256"


def create_token(
    subject: object,
    token_type: str,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT for the given subject and token type."""
    issued_at = utc_now()
    if expires_delta:
        expire = issued_at + expires_delta
    else:
        expire = issued_at + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "exp": expire,
        "iat": issued_at,
        "jti": uuid4().hex,
        "sub": str(subject),
        "typ": token_type,
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_access_token(
    subject: object,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a JWT access token for the given subject."""
    return create_token(subject, "access", expires_delta)


def decode_token(token: str) -> dict[str, object]:
    """Decode and validate a signed JWT."""

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid token")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against the stored hash."""

    try:
        return password_hash.verify(plain_password, hashed_password)
    except UnknownHashError:
        return False


def get_password_hash(password: str) -> str:
    """Hash a plaintext password using Argon2id."""

    return password_hash.hash(password)
