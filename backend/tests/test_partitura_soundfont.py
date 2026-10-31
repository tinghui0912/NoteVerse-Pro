from types import SimpleNamespace
from pathlib import Path


def test_partitura_default_soundfont_helper_requires_real_soundfont(
    monkeypatch,
    tmp_path: Path,
) -> None:
    from app.processing.resources import soundfont

    package_root = tmp_path / "partitura"
    source = tmp_path / "practice.sf2"
    source.write_bytes(b"real-soundfont")
    spec = SimpleNamespace(submodule_search_locations=[str(package_root)])
    monkeypatch.setattr(soundfont.importlib.util, "find_spec", lambda name: spec)

    resolved = soundfont.ensure_partitura_default_soundfont(str(source))

    target = package_root / "assets" / "MuseScore_General.sf3"
    assert resolved == target
    assert target.read_bytes() == b"real-soundfont"


def test_partitura_default_soundfont_helper_does_not_create_placeholder(
    monkeypatch,
    tmp_path: Path,
) -> None:
    from app.processing.resources import soundfont

    package_root = tmp_path / "partitura"
    spec = SimpleNamespace(submodule_search_locations=[str(package_root)])
    monkeypatch.setattr(soundfont.importlib.util, "find_spec", lambda name: spec)

    resolved = soundfont.ensure_partitura_default_soundfont(None)

    assert resolved is None
    assert not (package_root / "assets" / "MuseScore_General.sf3").exists()
