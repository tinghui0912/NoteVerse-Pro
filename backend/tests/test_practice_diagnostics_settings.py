import pytest
from pydantic import ValidationError

from app.core.settings.practice_diagnostics import PracticeDiagnosticsSettings


def test_practice_diagnostics_settings_accept_explicit_intervals() -> None:
    settings = PracticeDiagnosticsSettings(
        PRACTICE_AUDIO_DIAGNOSTICS=True,
        PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL=10,
        PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL=3,
    )

    assert settings.PRACTICE_AUDIO_DIAGNOSTICS is True
    assert settings.PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL == 10
    assert settings.PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL == 3


@pytest.mark.parametrize(
    "field_name",
    (
        "PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL",
        "PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL",
    ),
)
def test_practice_diagnostics_settings_reject_non_positive_intervals(field_name: str) -> None:
    with pytest.raises(ValidationError, match="task timing settings must be positive"):
        PracticeDiagnosticsSettings(**{field_name: 0})
