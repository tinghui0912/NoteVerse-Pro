from __future__ import annotations
from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice

from pathlib import Path

from app.modules.practice.score.domain import PracticeScoreTimeline
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.artifact import (
    practice_score_artifact_from_timeline,
)
from app.modules.practice.score.domain import PracticeTempoSegment

CANONICAL_MUSICXML = Path(__file__).parent / "fixtures/musicxml/canonical-practice-score.musicxml"


def test_practice_score_artifact_matches_browser_fixture() -> None:
    compiled = compile_practice_score(CANONICAL_MUSICXML.read_bytes())
    timeline = practice_timeline_from_compiled(compiled)

    artifact = practice_score_artifact_from_timeline(
        timeline,


        score_tempo_segments=compiled.tempo_segments,
    )

    assert artifact["schemaVersion"] == 1
    assert artifact["artifactId"] == "practice-score-artifact:f302746d7229b692"
    assert artifact["scoreTempoSegments"] == [
        {"startTick": 0, "bpm": 120},
        {"startTick": 6, "bpm": 90},
    ]
    assert "scoreId" not in artifact
    assert "revisionId" not in artifact
    assert [
        [attack["pianoKey"] for attack in moment["attacks"]] for moment in artifact["moments"]
    ] == [
        [60],
        [60],
        [67],
        [69, 72],
        [74],
    ]
    assert artifact["moments"][2]["canonicalEndTick"] == 9
    assert (
        next(
            n
            for n in artifact["notes"]
            if n["noteId"] == artifact["moments"][3]["continuationNoteIds"][0]
        )["pianoKey"]
        == 67
    )
    assert artifact["meterSegments"] == [
        {
            "startTick": 0,
            "numerator": 3,
            "denominator": 4,
        },
        {
            "startTick": 6,
            "numerator": 6,
            "denominator": 8,
        },
    ]


def test_empty_practice_score_artifact_is_not_practice_ready() -> None:
    import pytest
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    timeline = PracticeScoreTimeline(
        notes=(), events=(), moments=(), score_end_tick=0, ticks_per_quarter=1, meter_segments=()
    )
    with pytest.raises(PracticeScoreInvalidError):
        practice_score_artifact_from_timeline(
            timeline,   score_tempo_segments=()
        )


def test_practice_score_artifact_deterministic_identity() -> None:
    compiled = compile_practice_score(CANONICAL_MUSICXML.read_bytes())
    timeline = practice_timeline_from_compiled(compiled)

    artifact1 = practice_score_artifact_from_timeline(
        timeline,


        score_tempo_segments=compiled.tempo_segments,
    )
    artifact2 = practice_score_artifact_from_timeline(
        timeline,


        score_tempo_segments=compiled.tempo_segments,
    )

    assert artifact1 == artifact2
    assert artifact1["artifactId"] == artifact2["artifactId"]
    assert artifact1["artifactId"].startswith("practice-score-artifact:")


def test_practice_tempo_segments_from_musicxml_multi_tempo(tmp_path: Path) -> None:

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <direction placement="above"><sound tempo="120"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
    <measure number="2">
      <direction placement="above"><sound tempo="90"/></direction>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
"""
    xml_path = tmp_path / "multi_tempo.musicxml"
    xml_path.write_text(xml, encoding="utf-8")

    segments = compile_practice_score(
        prepare_musicxml_ids_for_practice(xml_path.read_text())
    ).tempo_segments
    assert segments == (
        PracticeTempoSegment(start_tick=0, bpm=120),
        PracticeTempoSegment(start_tick=3, bpm=90),
    )


def test_practice_tempo_segments_empty_when_no_tempo_tag(tmp_path: Path) -> None:

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>
"""
    xml_path = tmp_path / "no_tempo.musicxml"
    xml_path.write_text(xml, encoding="utf-8")

    segments = compile_practice_score(
        prepare_musicxml_ids_for_practice(xml_path.read_text())
    ).tempo_segments
    assert segments == ()


def test_practice_tempo_segments_metronome_beat_units(tmp_path: Path) -> None:

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction>
        <direction-type>
          <metronome>
            <beat-unit>half</beat-unit>
            <per-minute>60</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <direction>
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <beat-unit-dot/>
            <per-minute>80</per-minute>
          </metronome>
        </direction-type>
      </direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure>
  </part>
</score-partwise>
"""
    xml_path = tmp_path / "metronome.musicxml"
    xml_path.write_text(xml, encoding="utf-8")

    segments = compile_practice_score(
        prepare_musicxml_ids_for_practice(xml_path.read_text())
    ).tempo_segments
    # half at 60 = 120 bpm; dotted-quarter at 80 = 80 * 1.5 = 120 bpm
    assert segments == (
        PracticeTempoSegment(start_tick=0, bpm=120),
        PracticeTempoSegment(start_tick=2, bpm=120),
    )


def test_practice_tempo_segments_preserves_positive_first_tempo_beat(tmp_path: Path) -> None:

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
    <measure number="2">
      <direction><sound tempo="100"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>
"""
    xml_path = tmp_path / "delayed_tempo.musicxml"
    xml_path.write_text(xml, encoding="utf-8")

    segments = compile_practice_score(
        prepare_musicxml_ids_for_practice(xml_path.read_text())
    ).tempo_segments
    assert segments == (PracticeTempoSegment(start_tick=4, bpm=100),)


def test_practice_tempo_segments_missing_file_raises(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(FileNotFoundError):
        compile_practice_score((tmp_path / "does_not_exist.musicxml").read_bytes())


def test_practice_tempo_segments_invalid_xml_raises(tmp_path: Path) -> None:
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError
    import pytest

    bad_xml = tmp_path / "corrupted.musicxml"
    bad_xml.write_text("<score-partwise><broken", encoding="utf-8")
    with pytest.raises(PracticeScoreInvalidError):
        compile_practice_score(bad_xml.read_bytes())


def test_practice_score_artifact_requires_explicit_score_tempo_segments() -> None:
    import pytest

    timeline = PracticeScoreTimeline(
        events=(),
        notes=(),
        moments=(),
        score_end_tick=0,
        ticks_per_quarter=1,
        meter_segments=(),
    )
    with pytest.raises(TypeError):
        # Omitting score_tempo_segments must raise TypeError
        practice_score_artifact_from_timeline(  # type: ignore[call-arg]
            timeline,


        )


def test_practice_score_artifact_rejects_unsupported_schema() -> None:
    import json
    import os
    import pytest
    from pydantic import ValidationError
    from app.modules.practice.bundle.schemas import PracticeScoreArtifactRead

    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    value = json.loads(
        (
            root
            / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
        ).read_text()
    )
    assert PracticeScoreArtifactRead.model_validate(value).schemaVersion == 1
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate({**value, "schemaVersion": 999})


def test_semantic_score_fact_changes_artifact_content_identity():
    from app.modules.practice.bundle.compiler import PracticeBundleCompiler

    builder = PracticeBundleCompiler()
    xml = CANONICAL_MUSICXML.read_bytes()
    first = builder.compile(  canonical_musicxml=xml)
    same = builder.compile(  canonical_musicxml=xml)
    changed = builder.compile(


        canonical_musicxml=xml.replace(b"<step>C</step>", b"<step>D</step>", 1),
    )
    assert first.artifact.artifact_id == same.artifact.artifact_id
    assert changed.artifact.artifact_id != first.artifact.artifact_id
    assert changed.bundle_id != first.bundle_id


def test_repeat_notation_artifact_matches_browser_alignment_fixture() -> None:
    import json
    import os

    xml = Path(__file__).parent / "fixtures/musicxml/practice-simple-repeat.musicxml"
    compiled = compile_practice_score(xml.read_bytes())
    artifact = practice_score_artifact_from_timeline(
        practice_timeline_from_compiled(compiled),


        score_tempo_segments=compiled.tempo_segments,
    )
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    fixture = (
        root / "apps/customer-web/tests/fixtures/musicxml/practice-simple-repeat.artifact.json"
    )
    assert artifact == json.loads(fixture.read_text())
    assert [event["onsetTick"] for event in artifact["events"]] == [0, 4, 8, 12]
    assert artifact["scoreEndTick"] == 16
