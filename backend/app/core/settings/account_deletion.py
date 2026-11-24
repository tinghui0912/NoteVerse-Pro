"""Account erasure delivery and continuation policy."""

from pydantic import BaseModel, field_validator


class AccountDeletionSettings(BaseModel):
    ACCOUNT_DELETION_INTERVAL_SECONDS: int = 30
    ACCOUNT_DELETION_MAX_ATTEMPTS: int = 5
    ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS: int = 300
    ACCOUNT_DELETION_BATCH_SIZE: int = 50

    @field_validator(
        "ACCOUNT_DELETION_INTERVAL_SECONDS",
        "ACCOUNT_DELETION_MAX_ATTEMPTS",
        "ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS",
        "ACCOUNT_DELETION_BATCH_SIZE",
    )
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Account deletion policy must be positive")
        return value
