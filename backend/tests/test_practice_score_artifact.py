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


def test_practice_score_artifact_matches_browser_fixture(tmp_path) -> None:
    musicxml_path = tmp_path / "canonical-local-core.musicxml"
    musicxml_path.write_text(_canonical_musicxml(), encoding="utf-8")
    timeline = practice_timeline_from_compiled(compile_practice_score(musicxml_path.read_bytes()))

    artifact = practice_score_artifact_from_timeline(
        timeline,
        score_id="canonical-local-core-score",
        revision_id="canonical-local-core-revision",
        score_tempo_segments=(PracticeTempoSegment(0.0, 120.0), PracticeTempoSegment(3.0, 90.0)),
    )

    assert artifact["schemaVersion"] == 3
    assert artifact["artifactId"] == "practice-score-artifact:c2f3275222932efa"
    assert artifact["scoreTempoSegments"] == [
        {"startBeat": 0.0, "bpm": 120.0},
        {"startBeat": 3.0, "bpm": 90.0},
    ]
    assert artifact["scoreId"] == "canonical-local-core-score"
    assert artifact["revisionId"] == "canonical-local-core-revision"
    assert [[attack["pianoKey"] for attack in moment["attacks"]] for moment in artifact["moments"]] == [
        [60],
        [60],
        [67],
        [69, 72],
        [74],
    ]
    assert artifact["moments"][2]["canonicalEndBeat"] == 4.5
    assert next(n for n in artifact["notes"] if n["noteId"] == artifact["moments"][3]["continuationNoteIds"][0])["pianoKey"] == 67
    assert artifact["meterSegments"] == [
        {
            "startBeat": 0.0,
            "numerator": 3,
            "denominator": 4,
            "measureDurationBeats": 3.0,
            "countInPulses": 3,
            "source": "MUSICXML",
        },
        {
            "startBeat": 3.0,
            "numerator": 6,
            "denominator": 8,
            "measureDurationBeats": 3.0,
            "countInPulses": 6,
            "source": "MUSICXML",
        },
    ]
def test_empty_practice_score_artifact_is_not_practice_ready() -> None:
    import pytest
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError
    timeline = PracticeScoreTimeline(notes=(), events=(), moments=(),
                                    first_playable_beat=None, end_beat=0., meter_segments=())
    with pytest.raises(PracticeScoreInvalidError):
        practice_score_artifact_from_timeline(timeline, score_id="s", revision_id="r", score_tempo_segments=())


def test_practice_score_artifact_deterministic_identity(tmp_path) -> None:
    musicxml_path = tmp_path / "canonical-local-core.musicxml"
    musicxml_path.write_text(_canonical_musicxml(), encoding="utf-8")
    timeline = practice_timeline_from_compiled(compile_practice_score(musicxml_path.read_bytes()))

    artifact1 = practice_score_artifact_from_timeline(
        timeline,
        score_id="score-123",
        revision_id="rev-456",
        score_tempo_segments=(PracticeTempoSegment(0.0, 120.0),),
    )
    artifact2 = practice_score_artifact_from_timeline(
        timeline,
        score_id="score-123",
        revision_id="rev-456",
        score_tempo_segments=(PracticeTempoSegment(0.0, 120.0),),
    )

    assert artifact1 == artifact2
    assert artifact1["artifactId"] == artifact2["artifactId"]
    assert artifact1["artifactId"].startswith("practice-score-artifact:")



def _canonical_musicxml() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note id="n3"><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="2">
      <attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
      <note id="n4"><pitch><step>G</step><octave>4</octave></pitch><duration>1.5</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
      <backup><duration>1.5</duration></backup>
      <note id="n5"><pitch><step>A</step><octave>4</octave></pitch><duration>1.5</duration><voice>2</voice><staff>1</staff></note>
      <note id="n6"><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>1.5</duration><voice>2</voice><staff>1</staff></note>
      <note id="n7"><pitch><step>D</step><octave>5</octave></pitch><duration>1.5</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""


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

    segments = compile_practice_score(prepare_musicxml_ids_for_practice(xml_path.read_text())).tempo_segments
    assert segments == (
        PracticeTempoSegment(start_beat=0.0, bpm=120.0),
        PracticeTempoSegment(start_beat=3.0, bpm=90.0),
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

    segments = compile_practice_score(prepare_musicxml_ids_for_practice(xml_path.read_text())).tempo_segments
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

    segments = compile_practice_score(prepare_musicxml_ids_for_practice(xml_path.read_text())).tempo_segments
    # half at 60 = 120 bpm; dotted-quarter at 80 = 80 * 1.5 = 120 bpm
    assert segments == (
        PracticeTempoSegment(start_beat=0.0, bpm=120.0),
        PracticeTempoSegment(start_beat=2.0, bpm=120.0),
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

    segments = compile_practice_score(prepare_musicxml_ids_for_practice(xml_path.read_text())).tempo_segments
    assert segments == (
        PracticeTempoSegment(start_beat=4.0, bpm=100.0),
    )


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
        first_playable_beat=None,
        end_beat=0.0,
        meter_segments=(),
    )
    with pytest.raises(TypeError):
        # Omitting score_tempo_segments must raise TypeError
        practice_score_artifact_from_timeline(  # type: ignore[call-arg]
            timeline,
            score_id="score-1",
            revision_id="rev-1",
        )


def test_practice_score_artifact_rejects_unsupported_schema() -> None:
    import json
    import os
    import pytest
    from pydantic import ValidationError
    from app.modules.practice.source.schemas import PracticeScoreArtifactRead
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    value = json.loads((root / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json").read_text())
    assert PracticeScoreArtifactRead.model_validate(value).schemaVersion == 3
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate({**value, "schemaVersion": 999})
