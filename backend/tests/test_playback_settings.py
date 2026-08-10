from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.settings.playback import PlaybackSettings


def test_playback_settings_normalize_soundfont_path() -> None:
    settings = PlaybackSettings(PLAYBACK_SOUNDFONT_PATH="~/sounds/playback.sf2")

    assert settings.PLAYBACK_SOUNDFONT_PATH == str(Path("~/sounds/playback.sf2").expanduser())


@pytest.mark.parametrize("field_name", ("PLAYBACK_SAMPLE_RATE", "PLAYBACK_MAX_DURATION_SECONDS"))
def test_playback_settings_reject_non_positive_limits(field_name: str) -> None:
    with pytest.raises(ValidationError):
        PlaybackSettings(PLAYBACK_SOUNDFONT_PATH="/tmp/playback.sf2", **{field_name: 0})
