"""Account erasure delivery and continuation policy."""

from app.platform.config.maintenance_defaults import DEFAULT_ACCOUNT_DELETION_INTERVAL_SECONDS


from pydantic import BaseModel, field_validator


class AccountDeletionSettings(BaseModel):
    ACCOUNT_DELETION_INTERVAL_SECONDS: int = DEFAULT_ACCOUNT_DELETION_INTERVAL_SECONDS
    ACCOUNT_DELETION_MAX_ATTEMPTS: int = 5
    ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS: int = 300
    ACCOUNT_DELETION_BATCH_SIZE: int = 50
    ACCOUNT_DELETION_RESOURCE_BATCH_SIZE: int = 100

    @field_validator(
        "ACCOUNT_DELETION_INTERVAL_SECONDS",
        "ACCOUNT_DELETION_MAX_ATTEMPTS",
        "ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS",
        "ACCOUNT_DELETION_BATCH_SIZE",
        "ACCOUNT_DELETION_RESOURCE_BATCH_SIZE",
    )
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Account deletion policy must be positive")
        return value
