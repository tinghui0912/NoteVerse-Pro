import pytest
from pydantic import ValidationError

from app.core.settings.realtime_stream import RealtimeStreamSettings


def test_realtime_stream_settings_accept_default_policy() -> None:
    settings = RealtimeStreamSettings()

    assert settings.REALTIME_EVENT_BATCH_SIZE == 100


@pytest.mark.parametrize(
    "field_name",
    (
        "REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS",
        "REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS",
        "REALTIME_EVENT_BATCH_SIZE",
    ),
)
def test_realtime_stream_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="realtime stream settings must be positive"):
        RealtimeStreamSettings(**{field_name: 0})
