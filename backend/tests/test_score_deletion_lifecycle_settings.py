import pytest
from pydantic import ValidationError

from app.core.settings.score_deletion_lifecycle import ScoreDeletionLifecycleSettings


def test_score_deletion_lifecycle_settings_accept_default_policy() -> None:
    settings = ScoreDeletionLifecycleSettings()

    assert settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS == 10


@pytest.mark.parametrize(
    "field_name",
    (
        "SCORE_DELETION_CLEANUP_INTERVAL_SECONDS",
        "SCORE_DELETION_CLEANUP_BATCH_SIZE",
        "SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS",
        "SCORE_DELETION_CLEANUP_MAX_ATTEMPTS",
    ),
)
def test_score_deletion_lifecycle_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="score deletion lifecycle settings must be positive"):
        ScoreDeletionLifecycleSettings(**{field_name: 0})
