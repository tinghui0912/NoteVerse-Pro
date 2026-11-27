"""Notification retention and cleanup settings."""

from app.platform.config.maintenance_defaults import DEFAULT_NOTIFICATION_CLEANUP_INTERVAL_SECONDS


from pydantic import BaseModel, field_validator


class NotificationLifecycleSettings(BaseModel):
    """Shared policy for notification retention and scheduled cleanup."""

    NOTIFICATION_CLEANUP_INTERVAL_SECONDS: int = DEFAULT_NOTIFICATION_CLEANUP_INTERVAL_SECONDS
    NOTIFICATION_RETENTION_DAYS: int = 90

    @field_validator(
        "NOTIFICATION_CLEANUP_INTERVAL_SECONDS",
        "NOTIFICATION_RETENTION_DAYS",
    )
    @classmethod
    def validate_positive_notification_lifecycle_setting(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("notification lifecycle settings must be positive integers")
        return value
