"""Customer authentication session and CSRF cookie settings."""

from pydantic import BaseModel, field_validator


class CustomerSessionSecuritySettings(BaseModel):
    """Shared customer-session lifetime and browser cookie contract."""

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    AUTH_COOKIE_NAME: str
    REFRESH_COOKIE_NAME: str
    CSRF_COOKIE_NAME: str
    CSRF_HEADER_NAME: str
    AUTH_COOKIE_SECURE: bool
    AUTH_COOKIE_SAMESITE: str

    @field_validator("ACCESS_TOKEN_EXPIRE_MINUTES", "REFRESH_TOKEN_EXPIRE_DAYS")
    @classmethod
    def validate_positive_session_lifetime(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("customer session lifetimes must be positive integers")
        return value

    @field_validator(
        "AUTH_COOKIE_NAME",
        "REFRESH_COOKIE_NAME",
        "CSRF_COOKIE_NAME",
        "CSRF_HEADER_NAME",
    )
    @classmethod
    def validate_non_empty_cookie_contract_value(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("customer session cookie contract values must not be empty")
        return value

    @field_validator("AUTH_COOKIE_SAMESITE")
    @classmethod
    def validate_cookie_samesite(cls, value: str) -> str:
        if value not in {"lax", "strict", "none"}:
            raise ValueError("AUTH_COOKIE_SAMESITE must be one of: lax, strict, none")
        return value
