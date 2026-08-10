from pathlib import Path

from app.core.settings.playback import PlaybackSettings


def test_playback_settings_normalize_soundfont_path() -> None:
    settings = PlaybackSettings(PLAYBACK_SOUNDFONT_PATH="~/sounds/playback.sf2")

    assert settings.PLAYBACK_SOUNDFONT_PATH == str(Path("~/sounds/playback.sf2").expanduser())
