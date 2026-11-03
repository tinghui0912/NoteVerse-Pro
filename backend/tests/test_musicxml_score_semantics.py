from fractions import Fraction
from pathlib import Path

import pytest

from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics

FIXTURE = Path(__file__).parent / "fixtures/musicxml/written-semantics.musicxml"


def score(body, second=""):
    return f'<score-partwise><part id="P1"><measure number="1"><attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>{body}</measure>{second}</part></score-partwise>'


def note(identity, duration="1", extra="", voice="1"):
    return f'<note id="{identity}">{extra}<pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration><voice>{voice}</voice></note>'


def test_exact_thirds_and_divisions_changes():
    model = parse_score_semantics(
        score(
            note("a") + note("b") + note("c"),
            '<measure number="2"><attributes><divisions>2</divisions></attributes>'
            + note("d", "2")
            + "</measure>",
        )
    )
    assert [n.position for n in model.notes] == [
        Fraction(0),
        Fraction(1, 3),
        Fraction(2, 3),
        Fraction(1),
    ]
    assert all(type(n.position) is Fraction and type(n.duration) is Fraction for n in model.notes)
    assert [m.start for m in model.measures] == [Fraction(0), Fraction(1)]
    assert model.end == Fraction(2)
    assert model.tempos == ()


def test_backup_forward_chord_and_extent():
    model = parse_score_semantics(
        score(
            note("a", "3")
            + note("b", "6", "<chord/>")
            + "<forward><duration>6</duration></forward><backup><duration>9</duration></backup>"
            + note("c", "3", voice="2")
        )
    )
    assert [n.position for n in model.notes] == [Fraction(0), Fraction(0), Fraction(0)]
    assert model.notes[1].is_chord
    assert model.measures[0].end == Fraction(3)


@pytest.mark.parametrize(
    "body",
    [
        "<backup><duration>1</duration></backup>",
        note("a", extra="<chord/>"),
        note("a") + note("b", extra="<chord/>", voice="2"),
        note("a", "0"),
    ],
)
def test_invalid_chronology_fails_closed(body):
    with pytest.raises(MusicXMLSemanticError):
        parse_score_semantics(score(body))


def test_empty_measure_requires_known_meter():
    with pytest.raises(MusicXMLSemanticError):
        parse_score_semantics("<score-partwise><part><measure/></part></score-partwise>")
    model = parse_score_semantics(
        score("", '<measure number="2">' + note("b", "12") + "</measure>")
    )
    assert [(m.start, m.end, m.uses_meter_duration) for m in model.measures] == [
        (Fraction(0), Fraction(4), True),
        (Fraction(4), Fraction(8), False),
    ]


@pytest.mark.parametrize(
    "fact",
    [
        '<direction><sound tempo="90"/></direction><direction><sound tempo="100"/></direction>',
        "<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>",
    ],
)
def test_conflicting_positioned_facts(fact):
    with pytest.raises(MusicXMLSemanticError):
        parse_score_semantics(score(fact + note("a")))


def test_cross_projection_written_witness(monkeypatch):
    from app.modules.practice.score.compiler.musicxml import (
        compile_practice_score,
        project_practice_score,
    )
    from app.processing.musicxml import metadata

    content = FIXTURE.read_bytes()
    model = parse_score_semantics(content)
    assert [m.start for m in model.measures] == list(map(Fraction, [0, 4, 8, 11]))
    assert [m.end for m in model.measures] == list(map(Fraction, [4, 8, 11, 14]))
    assert model.measures[0].part_extents == (Fraction(3), Fraction(4))
    assert model.measures[1].uses_meter_duration
    assert [(t.position, t.quarter_bpm) for t in model.tempos] == [(Fraction(2), Fraction(90))]
    assert [(m.position, m.groups) for m in model.meters if m.part_index == 0] == [
        (Fraction(0), (((4,), 4),)),
        (Fraction(8), (((3,), 4),)),
    ]
    assert [(r.measure_index, r.direction, r.times) for r in model.repeats] == [
        (0, "forward", 2),
        (1, "backward", 2),
    ]
    practice = project_practice_score(model)
    assert practice == compile_practice_score(content)
    assert [m.start_beat for m in practice.measures] == [float(m.start) for m in model.measures]
    assert len(practice.notes) == 8  # Written pitched notes, with no repeated occurrences.
    assert [t.start_beat for t in practice.tempo_segments] == [2]
    original = metadata._playback_duration_ms

    def witness(order, durations, tempos):
        assert order == [0, 1, 0, 1, 2, 3]
        assert durations == [m.end - m.start for m in model.measures]
        assert all(type(d) is Fraction for d in durations)
        assert tempos == {0: [(Fraction(2), Fraction(90))]}
        return original(order, durations, tempos)

    monkeypatch.setattr(metadata, "_playback_duration_ms", witness)
    result = metadata.project_score_metadata(model)
    assert result == metadata.extract_musicxml_metadata(content)
    assert result.part_count == 2 and result.measure_count == 4
    assert result.playback_duration_ms == 15000
    assert result.tempo_events == [{"part": 1, "measure": "1", "offset_quarters": 2, "bpm": 90}]


def test_namespace_and_late_tempo_offset():
    xml = score(
        note("a", "6")
        + '<direction><offset>-3</offset><sound tempo="90"/></direction>'
        + note("b", "6")
    )
    plain = parse_score_semantics(xml)
    assert (
        parse_score_semantics(
            xml.replace("<score-partwise>", '<score-partwise xmlns="urn:musicxml">')
        )
        == plain
    )
    assert [(t.position, t.quarter_bpm) for t in plain.tempos] == [(Fraction(1), Fraction(90))]


def test_meter_placement_is_written_fact_but_practice_support_is_separate():
    from app.modules.practice.score.compiler.musicxml import compile_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    xml = score(
        note("a", "3")
        + "<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>"
        + note("b", "3")
    )
    assert [m.position for m in parse_score_semantics(xml).meters] == [Fraction(0), Fraction(1)]
    with pytest.raises(PracticeScoreInvalidError):
        compile_practice_score(xml)


def test_timewise_boundary_is_explicit_without_changing_root_admission():
    from app.processing.musicxml.validation import prepare_musicxml_document
    from app.processing.musicxml.metadata import extract_musicxml_metadata, MetadataExtractionError

    xml = b'<score-timewise><measure number="1"><part id="P1"/></measure></score-timewise>'
    assert prepare_musicxml_document(xml) == xml
    with pytest.raises(MusicXMLSemanticError, match="unsupported_root"):
        parse_score_semantics(xml)
    with pytest.raises(MetadataExtractionError):
        extract_musicxml_metadata(xml)


def test_chord_extent_and_following_written_onset_are_distinct_facts():
    model = parse_score_semantics(
        score(note("a", "3") + note("b", "6", "<chord/>") + note("c", "1"))
    )
    assert [n.position for n in model.notes] == [Fraction(0), Fraction(0), Fraction(1)]
    assert model.measures[0].end == Fraction(2)
    assert model.notes[1].duration == Fraction(2)


def test_written_model_does_not_require_practice_meter_or_physical_pitch_support():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError
    from app.processing.musicxml.metadata import project_score_metadata

    xml = (
        '<score-partwise><part id="P1"><measure><attributes><divisions>3</divisions></attributes>'
        + note("a", "3").replace("<octave>4</octave>", "<alter>0.5</alter><octave>4</octave>")
        + "</measure></part></score-partwise>"
    )
    model = parse_score_semantics(xml)
    assert model.notes[0].pitch.alter == Fraction(1, 2)
    assert model.meters == ()
    assert project_score_metadata(model).playback_duration_ms == 750
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(model)


def test_additive_meter_can_own_an_empty_written_measure():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    model = parse_score_semantics(
        score("").replace(
            "<beats>4</beats><beat-type>4</beat-type>", "<beats>3+2</beats><beat-type>8</beat-type>"
        )
    )
    assert model.meters[0].groups == (((3, 2), 8),)
    assert model.end == Fraction(5, 2)
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(model)


def test_negative_direction_offset_can_place_a_fact_in_the_previous_measure():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.processing.musicxml.metadata import project_score_metadata

    model = parse_score_semantics(
        score(
            note("a", "6"),
            '<measure number="2"><direction><offset>-3</offset><sound tempo="60"/></direction>'
            + note("b", "6")
            + "</measure>",
        )
    )
    assert model.tempos[0].measure_index == 1
    assert model.tempos[0].position == Fraction(1)
    assert project_practice_score(model).tempo_segments[0].start_beat == 1
    result = project_score_metadata(model)
    assert result.tempo_events == [{"part": 1, "measure": "2", "offset_quarters": -1, "bpm": 60}]
    assert result.playback_duration_ms == 3750  # 1 quarter at 80, then 3 at 60.


@pytest.mark.parametrize(
    "body",
    [
        "<attributes><divisions>3</divisions><divisions>6</divisions></attributes>" + note("a"),
        note("a").replace("<octave>4</octave>", "<alter/><octave>4</octave>"),
    ],
)
def test_explicit_ambiguous_or_empty_numeric_facts_are_invalid(body):
    with pytest.raises(MusicXMLSemanticError):
        parse_score_semantics(score(body))
