import pytest
from pydantic import ValidationError

from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings


def test_score_deletion_delivery_settings_accept_default_policy() -> None:
    settings = ScoreDeletionDeliverySettings()

    assert settings.SCORE_DELETION_MAX_ATTEMPTS == 10


@pytest.mark.parametrize(
    "field_name",
    (
        "SCORE_DELETION_INTERVAL_SECONDS",
        "SCORE_DELETION_BATCH_SIZE",
        "SCORE_DELETION_RETRY_BASE_SECONDS",
        "SCORE_DELETION_MAX_ATTEMPTS",
        "SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS",
        "SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS",
    ),
)
def test_score_deletion_delivery_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="score deletion delivery settings must be positive"):
        ScoreDeletionDeliverySettings(**{field_name: 0})
