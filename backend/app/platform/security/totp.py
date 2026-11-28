"""RFC 6238 SHA-1 TOTP, authenticated secret storage and recovery credentials."""

import base64
import hashlib
import hmac
import re
import secrets
import struct
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet


def generate_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii")


def code_for_step(secret: str, step: int) -> str:
    digest = hmac.digest(base64.b32decode(secret), struct.pack(">Q", step), hashlib.sha1)
    offset = digest[-1] & 15
    number = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{number % 1000000:06d}"


def verify_code(
    secret: str, code: str, *, timestamp: float, last_used_step: int | None = None
) -> int | None:
    if re.fullmatch(r"[0-9]{6}", code) is None:
        return None
    step = int(timestamp) // 30
    for candidate in (step, step - 1, step + 1):
        if candidate >= 0 and (last_used_step is None or candidate > last_used_step):
            if hmac.compare_digest(code_for_step(secret, candidate), code):
                return candidate
    return None


def encrypt_secret(key: str, secret: str) -> str:
    return Fernet(key.encode("ascii")).encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_secret(key: str, ciphertext: str) -> str:
    return Fernet(key.encode("ascii")).decrypt(ciphertext.encode("ascii")).decode("ascii")


def validate_encryption_key(value: str) -> str:
    try:
        decoded = base64.b64decode(value.encode("ascii"), altchars=b"-_", validate=True)
        if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode("ascii") != value:
            raise ValueError("Noncanonical encryption key")
        Fernet(value.encode("ascii"))
    except (ValueError, UnicodeError) as error:
        raise ValueError("A valid URL-safe base64 Fernet key is required") from error
    return value


def provisioning_uri(secret: str, email: str) -> str:
    return (
        "otpauth://totp/"
        + quote("NoteVerse Admin:" + email, safe=":")
        + "?"
        + urlencode(
            {
                "secret": secret,
                "issuer": "NoteVerse Admin",
                "algorithm": "SHA1",
                "digits": 6,
                "period": 30,
            }
        )
    )


def generate_recovery_codes() -> tuple[str, ...]:
    values = (secrets.token_hex(10).upper() for _ in range(10))
    return tuple("-".join(value[i : i + 5] for i in range(0, 20, 5)) for value in values)
