import pytest
from pydantic import ValidationError

from app.core.settings.fingering_execution import FingeringExecutionSettings


def test_fingering_execution_settings_accept_default_policy() -> None:
    settings = FingeringExecutionSettings()

    assert settings.FINGERING_MAX_CONTENT_BYTES == 2 * 1024 * 1024


@pytest.mark.parametrize(
    "field_name",
    (
        "FINGERING_MAX_CONCURRENCY",
        "FINGERING_QUEUE_WAIT_SECONDS",
        "FINGERING_MAX_CONTENT_BYTES",
    ),
)
def test_fingering_execution_settings_reject_non_positive_values(field_name: str) -> None:
    with pytest.raises(ValidationError, match="fingering execution settings must be positive"):
        FingeringExecutionSettings(**{field_name: 0})
