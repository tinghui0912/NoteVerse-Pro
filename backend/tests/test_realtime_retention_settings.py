import pytest
from pydantic import ValidationError

from app.core.settings.realtime_retention import RealtimeRetentionSettings


def test_realtime_retention_settings_accept_explicit_deployment_policy() -> None:
    settings = RealtimeRetentionSettings(
        REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS=86400,
        REALTIME_EVENT_RETENTION_DAYS=7,
    )

    assert settings.REALTIME_EVENT_RETENTION_DAYS == 7


def test_realtime_retention_settings_require_both_values() -> None:
    with pytest.raises(ValidationError, match="REALTIME_EVENT_RETENTION_DAYS"):
        RealtimeRetentionSettings(REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS=86400)


@pytest.mark.parametrize(
    "field_name",
    ("REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS", "REALTIME_EVENT_RETENTION_DAYS"),
)
def test_realtime_retention_settings_reject_non_positive_values(field_name: str) -> None:
    values = {
        "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS": 86400,
        "REALTIME_EVENT_RETENTION_DAYS": 7,
    }
    values[field_name] = 0

    with pytest.raises(ValidationError, match="realtime retention settings must be positive"):
        RealtimeRetentionSettings(**values)
