"""NFC-normalized passwords and Argon2id hashing."""

import unicodedata
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher(type=Type.ID)


def normalize_password(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Password must be a string")
    return unicodedata.normalize("NFC", value)


def validate_password(value: str) -> str:
    value = normalize_password(value)
    if not 12 <= len(value) <= 128 or not value.strip():
        raise ValueError("Password must contain 12 to 128 characters and must not be blank")
    return value


def hash_password(password: str) -> str:
    return _hasher.hash(normalize_password(password))


def verify_password(password: str, digest: str) -> bool:
    if not digest.startswith("$argon2id$"):
        return False
    try:
        return _hasher.verify(digest, normalize_password(password))
    except (InvalidHashError, VerificationError):
        return False
