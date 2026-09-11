from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace


def test_practice_score_timeline_loader_does_not_require_soundfont(
    monkeypatch,
    tmp_path: Path,
) -> None:
    from app.processing.practice_score import score_loader

    score_path = tmp_path / "score.musicxml"
    prepared_path = tmp_path / "prepared.musicxml"
    score_path.write_text("<score-partwise version='4.0' />", encoding="utf-8")
    prepared_path.write_text("<score-partwise version='4.0' />", encoding="utf-8")

    @contextmanager
    def fake_prepared_musicxml_path_for_practice(_score_path):
        yield prepared_path

    sentinel = object()
    loaded_paths: list[str] = []

    monkeypatch.delenv("PRACTICE_SOUNDFONT_PATH", raising=False)
    monkeypatch.setattr(
        score_loader,
        "prepared_musicxml_path_for_practice",
        fake_prepared_musicxml_path_for_practice,
    )
    monkeypatch.setattr(
        score_loader,
        "load_score_as_part_for_practice",
        lambda path: (
            loaded_paths.append(path)
            or SimpleNamespace(note_array=lambda: ("note-array",))
        ),
    )
    monkeypatch.setattr(
        score_loader.PracticeScoreTimeline,
        "from_note_array",
        staticmethod(lambda note_array, musicxml_path: sentinel),
    )

    timeline = score_loader.practice_score_timeline_from_musicxml(score_path)

    assert timeline is sentinel
    assert loaded_paths == [str(prepared_path)]


def test_partitura_adapter_prepares_real_default_soundfont_when_configured(
    monkeypatch,
    tmp_path: Path,
) -> None:
    import sys

    from app.processing.practice_score import partitura_adapter

    score_path = tmp_path / "prepared.musicxml"
    score_path.write_text("<score-partwise version='4.0' />", encoding="utf-8")
    soundfont_path = tmp_path / "practice.sf2"
    soundfont_path.write_bytes(b"soundfont")

    calls: list[str | None] = []
    loaded_paths: list[str] = []
    fake_partitura = SimpleNamespace(
        load_score_as_part=lambda path: (
            loaded_paths.append(path)
            or SimpleNamespace(note_array=lambda: ("note-array",))
        ),
    )

    monkeypatch.setenv("PRACTICE_SOUNDFONT_PATH", str(soundfont_path))
    monkeypatch.setitem(sys.modules, "partitura", fake_partitura)
    monkeypatch.setattr(
        partitura_adapter,
        "ensure_partitura_default_soundfont",
        lambda path: calls.append(path),
    )

    score_part = partitura_adapter.load_score_as_part_for_practice(str(score_path))

    assert score_part.note_array() == ("note-array",)
    assert calls == [str(soundfont_path)]
    assert loaded_paths == [str(score_path)]


def test_partitura_adapter_blocks_optional_fluidsynth_when_no_soundfont(
    monkeypatch,
) -> None:
    import builtins

    from app.processing.practice_score.partitura_adapter import (
        configure_partitura_for_offline_score_parsing,
    )

    with configure_partitura_for_offline_score_parsing(block_optional_fluidsynth=True):
        try:
            builtins.__import__("fluidsynth")
        except ImportError as exc:
            assert "offline score parsing" in str(exc)
        else:  # pragma: no cover
            raise AssertionError("fluidsynth import should be blocked")

    assert builtins.__import__("sys").__name__ == "sys"


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
