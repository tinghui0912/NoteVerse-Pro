from __future__ import annotations

from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline
from app.processing.performance.timeline import TempoSegment
from app.processing.practice_score.practice_score_artifact import (
    practice_score_artifact_from_timeline,
)


class _DType:
    names = ("onset_beat", "duration_beat", "pitch", "voice", "id")


class _Note(dict):
    dtype = _DType()


class _NoteArray(list):
    dtype = _DType()


def test_practice_score_artifact_matches_browser_fixture(tmp_path) -> None:
    musicxml_path = tmp_path / "canonical-local-core.musicxml"
    musicxml_path.write_text(_canonical_musicxml(), encoding="utf-8")
    timeline = PracticeScoreTimeline.from_note_array(
        _canonical_note_array(),
        musicxml_path=musicxml_path,
    )

    artifact = practice_score_artifact_from_timeline(
        timeline,
        score_id="canonical-local-core-score",
        revision_id="canonical-local-core-revision",
        tempo_segments=(TempoSegment(0.0, 120.0), TempoSegment(3.0, 90.0)),
    )

    assert artifact["schemaVersion"] == 1
    assert artifact["artifactId"] == "practice-score-artifact-v1:0529eb0f2b5dfe1a"
    assert artifact["scoreId"] == "canonical-local-core-score"
    assert artifact["revisionId"] == "canonical-local-core-revision"
    assert [group["pitches"] for group in artifact["expectedPracticeGroups"]] == [
        ["C4"],
        ["C4"],
        ["G4"],
        ["A4", "C5"],
        ["D5"],
    ]
    assert artifact["expectedPracticeGroups"][2]["canonicalEndBeat"] == 4.5
    assert artifact["practiceAttackSteps"][3]["continuation"][0]["pitch"] == "G4"
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


def _canonical_note_array() -> _NoteArray:
    return _NoteArray(
        [
            _Note(onset_beat=0.0, duration_beat=1.0, pitch=60, voice=1, id="n1"),
            _Note(onset_beat=1.0, duration_beat=1.0, pitch=60, voice=1, id="n2"),
            _Note(onset_beat=2.0, duration_beat=1.0, pitch=67, voice=1, id="n3"),
            _Note(onset_beat=3.0, duration_beat=1.5, pitch=67, voice=1, id="n4"),
            _Note(onset_beat=3.0, duration_beat=1.5, pitch=69, voice=2, id="n5"),
            _Note(onset_beat=3.0, duration_beat=1.5, pitch=72, voice=2, id="n6"),
            _Note(onset_beat=4.5, duration_beat=1.5, pitch=74, voice=1, id="n7"),
        ]
    )


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
      <note id="n5"><pitch><step>A</step><octave>4</octave></pitch><duration>1.5</duration><voice>2</voice><staff>1</staff></note>
      <note id="n6"><pitch><step>C</step><octave>5</octave></pitch><duration>1.5</duration><voice>2</voice><staff>1</staff></note>
      <note id="n7"><pitch><step>D</step><octave>5</octave></pitch><duration>1.5</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>
"""
