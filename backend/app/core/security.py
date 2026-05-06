"""Security helpers for token creation and password hashing."""

from datetime import timedelta

from jose import jwt
from passlib.context import CryptContext

from .config import settings
from app.utils.timezone import utc_now


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def create_access_token(
    subject: object,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a JWT access token for the given subject."""

    if expires_delta:
        expire = utc_now() + expires_delta
    else:
        expire = utc_now() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> dict[str, object]:
    """Decode and validate a JWT access token."""

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token has expired")
    except jwt.JWTError:
        raise ValueError("Invalid token")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against the stored hash."""

    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a plaintext password using the configured password context."""

    return pwd_context.hash(password)
