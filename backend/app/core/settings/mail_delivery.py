"""Mail outbox delivery and retention settings."""

from pydantic import BaseModel, field_validator


class MailDeliverySettings(BaseModel):
    """Shared policy for mail delivery retries, leases, and retention."""

    MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS: int = 10
    MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS: int = 120
    MAIL_OUTBOX_RETRY_BASE_SECONDS: int = 30
    MAIL_OUTBOX_MAX_ATTEMPTS: int = 5
    MAIL_OUTBOX_DISPATCH_BATCH_SIZE: int = 50
    MAIL_OUTBOX_RETENTION_DAYS: int = 7

    @field_validator(
        "MAIL_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "MAIL_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "MAIL_OUTBOX_RETRY_BASE_SECONDS",
        "MAIL_OUTBOX_MAX_ATTEMPTS",
        "MAIL_OUTBOX_DISPATCH_BATCH_SIZE",
        "MAIL_OUTBOX_RETENTION_DAYS",
    )
    @classmethod
    def validate_positive_mail_delivery_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("mail delivery settings must be positive integers")
        return value
