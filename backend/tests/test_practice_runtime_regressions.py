from __future__ import annotations

import builtins
from pathlib import Path
from unittest.mock import patch

import pytest

from app.processing.engines.matchmaker_live import (
    MatchmakerLiveEngine,
    build_alignment_engine,
)
from app.processing.engines.score_timeline import ScoreTimelineBuilder
from app.processing.realtime.session_runtime import PracticeSessionRuntimeRegistry

ORIGINAL_IMPORT = builtins.__import__


class DummyAlignmentEngine:
    def ingest_audio(self, chunk: bytes):
        _ = chunk
        return None

    def close(self) -> None:
        pass


def import_without_matchmaker(name, *args, **kwargs):
    if name == "matchmaker":
        raise ImportError("No module named 'matchmaker'")
    return ORIGINAL_IMPORT(name, *args, **kwargs)


def test_score_timeline_builder_extracts_basic_musicxml_events(tmp_path: Path) -> None:
    xml_path = tmp_path / "score.xml"
    xml_path.write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
      </note>
      <note>
        <rest />
        <duration>1</duration>
      </note>
    </measure>
  </part>
</score-partwise>
""",
        encoding="utf-8",
    )

    builder = ScoreTimelineBuilder()
    timeline = builder.build_from_file(str(xml_path))

    assert timeline["total_events"] == 1
    assert timeline["total_measures"] == 1
    assert timeline["events"][0]["pitches"] == ["C4"]


def test_practice_runtime_registry_registers_and_releases_sessions() -> None:
    registry = PracticeSessionRuntimeRegistry()

    with patch(
        "app.processing.realtime.session_runtime.build_alignment_engine",
        return_value=DummyAlignmentEngine(),
    ):
        runtime = registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            timeline={"events": [], "total_events": 0, "total_measures": 0},
            score_file_path="score.xml",
        )

    assert runtime.session_id == "session-1"
    assert registry.get("session-1") is runtime

    released = registry.release("session-1")

    assert released is runtime
    assert registry.get("session-1") is None


def test_alignment_engine_factory_rejects_fake_engine() -> None:
    with pytest.raises(ValueError):
        build_alignment_engine(
            engine_name="fake",
            timeline={"events": [], "total_events": 0, "total_measures": 0},
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )


def test_alignment_engine_factory_requires_matchmaker_dependency() -> None:
    with patch("builtins.__import__", side_effect=import_without_matchmaker):
        with pytest.raises(RuntimeError, match="pymatchmaker"):
            build_alignment_engine(
                engine_name="matchmaker",
                timeline={"events": [], "total_events": 0, "total_measures": 0},
                score_file_path="score.xml",
                sample_rate=16000,
                channels=1,
                frame_format="pcm_s16le",
            )


def test_matchmaker_live_engine_raises_when_dependency_is_unavailable() -> None:
    with patch("builtins.__import__", side_effect=import_without_matchmaker):
        with pytest.raises(RuntimeError, match="pymatchmaker"):
            MatchmakerLiveEngine(
                timeline={"events": [], "total_events": 0, "total_measures": 0},
                score_file_path="score.xml",
                sample_rate=16000,
                channels=1,
                frame_format="pcm_s16le",
            )


def test_matchmaker_live_engine_rejects_unsupported_audio_shape() -> None:
    with pytest.raises(RuntimeError, match="mono"):
        MatchmakerLiveEngine(
            timeline={"events": [], "total_events": 0, "total_measures": 0},
            score_file_path="score.xml",
            sample_rate=16000,
            channels=2,
            frame_format="pcm_s16le",
        )


def test_matchmaker_live_engine_rejects_unsupported_frame_format() -> None:
    with pytest.raises(RuntimeError, match="pcm_s16le"):
        MatchmakerLiveEngine(
            timeline={"events": [], "total_events": 0, "total_measures": 0},
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="float32",
        )
