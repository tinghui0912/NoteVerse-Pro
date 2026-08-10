import pytest
from pydantic import ValidationError

from app.core.settings.playback_delivery import PlaybackDeliverySettings


def test_playback_delivery_settings_accept_default_policy() -> None:
    settings = PlaybackDeliverySettings()

    assert settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS == 5


@pytest.mark.parametrize(
    "field_name",
    (
        "PLAYBACK_OUTBOX_DISPATCH_INTERVAL_SECONDS",
        "PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS",
        "PLAYBACK_OUTBOX_RETRY_BASE_SECONDS",
        "PLAYBACK_OUTBOX_MAX_ATTEMPTS",
        "PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE",
    ),
)
def test_playback_delivery_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="playback delivery settings must be positive"):
        PlaybackDeliverySettings(**{field_name: 0})
