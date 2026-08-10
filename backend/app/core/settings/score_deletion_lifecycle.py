"""Score deletion cleanup scheduling and retry settings."""

from pydantic import BaseModel, field_validator


class ScoreDeletionLifecycleSettings(BaseModel):
    """Shared policy for asynchronous score-deletion cleanup."""

    SCORE_DELETION_CLEANUP_INTERVAL_SECONDS: int = 60
    SCORE_DELETION_CLEANUP_BATCH_SIZE: int = 20
    SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS: int = 60
    SCORE_DELETION_CLEANUP_MAX_ATTEMPTS: int = 10

    @field_validator(
        "SCORE_DELETION_CLEANUP_INTERVAL_SECONDS",
        "SCORE_DELETION_CLEANUP_BATCH_SIZE",
        "SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS",
        "SCORE_DELETION_CLEANUP_MAX_ATTEMPTS",
    )
    @classmethod
    def validate_positive_score_deletion_lifecycle_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("score deletion lifecycle settings must be positive integers")
        return value
