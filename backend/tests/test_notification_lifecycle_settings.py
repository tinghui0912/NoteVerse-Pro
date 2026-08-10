import pytest
from pydantic import ValidationError

from app.core.settings.notification_lifecycle import NotificationLifecycleSettings


def test_notification_lifecycle_settings_accept_default_policy() -> None:
    settings = NotificationLifecycleSettings()

    assert settings.NOTIFICATION_RETENTION_DAYS == 90


@pytest.mark.parametrize(
    "field_name",
    ("NOTIFICATION_CLEANUP_INTERVAL_SECONDS", "NOTIFICATION_RETENTION_DAYS"),
)
def test_notification_lifecycle_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="notification lifecycle settings must be positive"):
        NotificationLifecycleSettings(**{field_name: 0})
