"""Interactive fingering execution-capacity settings."""

from pydantic import BaseModel, field_validator


class FingeringExecutionSettings(BaseModel):
    """API resource limits for blocking interactive fingering generation."""

    FINGERING_MAX_CONCURRENCY: int = 2
    FINGERING_QUEUE_WAIT_SECONDS: int = 5
    FINGERING_MAX_CONTENT_BYTES: int = 2 * 1024 * 1024

    @field_validator(
        "FINGERING_MAX_CONCURRENCY",
        "FINGERING_QUEUE_WAIT_SECONDS",
        "FINGERING_MAX_CONTENT_BYTES",
    )
    @classmethod
    def validate_positive_fingering_execution_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("fingering execution settings must be positive integers")
        return value
