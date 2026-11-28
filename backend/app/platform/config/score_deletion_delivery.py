"""Score deletion durable delivery and recovery settings."""

from app.platform.config.maintenance_defaults import DEFAULT_SCORE_DELETION_INTERVAL_SECONDS


from pydantic import BaseModel, field_validator


class ScoreDeletionDeliverySettings(BaseModel):
    """Shared policy for durable score-deletion delivery."""

    SCORE_DELETION_INTERVAL_SECONDS: int = DEFAULT_SCORE_DELETION_INTERVAL_SECONDS
    SCORE_DELETION_BATCH_SIZE: int = 20
    SCORE_DELETION_RETRY_BASE_SECONDS: int = 60
    SCORE_DELETION_MAX_ATTEMPTS: int = 10
    SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS: int = 120
    SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS: int = 900

    @field_validator(
        "SCORE_DELETION_INTERVAL_SECONDS",
        "SCORE_DELETION_BATCH_SIZE",
        "SCORE_DELETION_RETRY_BASE_SECONDS",
        "SCORE_DELETION_MAX_ATTEMPTS",
        "SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS",
        "SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS",
    )
    @classmethod
    def validate_positive_score_deletion_delivery_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("score deletion delivery settings must be positive integers")
        return value
