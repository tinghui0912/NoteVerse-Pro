"""Account email-link lifetime settings."""

from pydantic import BaseModel, field_validator


class AccountEmailLinkSettings(BaseModel):
    """Shared expiry policy for password-reset and email-verification links."""

    EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS: int = 300
    EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS: int = 900

    @field_validator(
        "EMAIL_PASSWORD_RESET_TOKEN_TTL_SECONDS",
        "EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS",
    )
    @classmethod
    def validate_positive_account_email_link_lifetime(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("account email-link lifetimes must be positive integers")
        return value
