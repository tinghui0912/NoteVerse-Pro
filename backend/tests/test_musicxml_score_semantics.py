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
        (0, "forward", None),
        (1, "backward", 2),
    ]
    practice = project_practice_score(model)
    assert practice == compile_practice_score(content)
    assert [m.start_tick for m in practice.measures] == [
        practice.timebase.to_tick(m.start) for m in model.measures
    ]
    assert len(practice.notes) == 8  # Written pitched notes, with no repeated occurrences.
    assert [t.start_tick for t in practice.tempo_segments] == [2]
    original = metadata._playback_duration_ms

    def witness(plan):
        performance = plan.projection
        assert plan.initial_tempo_bpm == Fraction(80)
        assert [o.measure_index for o in performance.occurrences] == [0, 1, 0, 1, 2, 3]
        assert all(type(o.performance_start) is Fraction for o in performance.occurrences)
        assert [(o.written_start, o.written_end) for o in performance.occurrences] == [
            (model.measures[i].start, model.measures[i].end) for i in [0, 1, 0, 1, 2, 3]
        ]
        assert tuple((f.performance_position, f.bpm) for f in plan.tempo_events) == (
            (Fraction(2), Fraction(90)),
            (Fraction(10), Fraction(90)),
        )
        assert [f.occurrence_ordinal for f in plan.tempo_events] == [0, 2]
        return original(plan)

    monkeypatch.setattr(metadata, "_playback_duration_ms", witness)
    result = metadata.project_score_metadata(model)
    assert result == metadata.extract_musicxml_metadata(content)
    assert result.part_count == 2 and result.measure_count == 4
    assert result.playback_duration_ms == 14833
    assert result.tempo_events == [{"part": 1, "measure": "1", "offset_quarters": 2, "bpm": 90}]


def test_namespace_and_late_tempo_offset():
    xml = score(
        note("a", "6")
        + '<direction><offset sound="yes">-3</offset><sound tempo="90"/></direction>'
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


def test_timewise_is_outside_canonical_and_document_admission_boundaries():
    from app.processing.musicxml.admission import admit_musicxml_document
    from app.processing.musicxml.metadata import extract_musicxml_metadata, MetadataExtractionError

    xml = b'<score-timewise><measure number="1"><part id="P1"/></measure></score-timewise>'
    from app.core.exceptions import ValidationException

    with pytest.raises(ValidationException):
        admit_musicxml_document(xml)
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
            '<measure number="2"><direction><offset sound="yes">-3</offset><sound tempo="60"/></direction>'
            + note("b", "6")
            + "</measure>",
        )
    )
    assert model.tempos[0].measure_index == 1
    assert model.tempos[0].position == Fraction(1)
    assert project_practice_score(model).tempo_segments[0].start_tick == 1
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


# Scoped notation is canonical data; consumers validate their own representable subset.
def scoped_meter(beats=4, denominator=4, staff=None):
    scope = f' number="{staff}"' if staff is not None else ""
    return f"<time{scope}><beats>{beats}</beats><beat-type>{denominator}</beat-type></time>"


def scoped_part(identity, meters="", key="", body=None, staves=1, second=""):
    if body is None:
        body = note(identity, "4")
    return f'<part id="{identity}"><measure number="1"><attributes><divisions>1</divisions><staves>{staves}</staves>{meters}{key}</attributes>{body}</measure>{second}</part>'


def scoped_score(*parts):
    return "<score-partwise>" + "".join(parts) + "</score-partwise>"


def test_cross_part_polymeter_is_canonical_but_not_one_practice_meter():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError
    from app.processing.musicxml.metadata import project_score_metadata

    model = parse_score_semantics(
        scoped_score(
            scoped_part("a", scoped_meter()), scoped_part("b", scoped_meter(3), body=note("b", "3"))
        )
    )
    assert [(m.part_index, m.staff_number, m.position, m.groups) for m in model.meters] == [
        (0, None, Fraction(0), (((4,), 4),)),
        (1, None, Fraction(0), (((3,), 4),)),
    ]
    assert model.end == Fraction(4)
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(model)
    result = project_score_metadata(model)
    assert result.time_signature_events == [
        {"part": 1, "measure": "1", "beats": 4, "beat_type": 4},
        {"part": 2, "measure": "1", "beats": 3, "beat_type": 4},
    ]
    assert result.playback_duration_ms == 3000


def test_staff_meters_are_preserved_and_rejected_by_both_current_projections():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError
    from app.processing.musicxml.metadata import project_score_metadata, MetadataExtractionError

    xml = scoped_score(scoped_part("a", scoped_meter(staff=1) + scoped_meter(3, staff=2), staves=2))
    model = parse_score_semantics(xml)
    assert [m.staff_number for m in model.meters] == [1, 2]
    assert model.end == Fraction(4)  # Actual timed extent is independent of nominal meters.
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(model)
    with pytest.raises(MetadataExtractionError, match="unsupported_staff_meter"):
        project_score_metadata(model)


@pytest.mark.parametrize("staff", [None, 1, 2])
def test_meter_conflict_is_local_to_the_same_part_staff_position(staff):
    xml = scoped_score(
        scoped_part("a", scoped_meter(staff=staff) + scoped_meter(3, staff=staff), staves=2)
    )
    with pytest.raises(MusicXMLSemanticError, match="conflicting_meter"):
        parse_score_semantics(xml)


def test_identical_cross_part_meters_collapse_in_practice():
    from app.modules.practice.score.compiler.musicxml import project_practice_score

    model = parse_score_semantics(
        scoped_score(scoped_part("a", scoped_meter()), scoped_part("b", scoped_meter()))
    )
    assert len(model.meters) == 2
    assert len(project_practice_score(model).meter_segments) == 1


def test_practice_rejects_part_meter_timelines_that_diverge_after_origin():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.modules.practice.score.piano_key import PracticeScoreInvalidError

    second = (
        '<measure number="2"><attributes>'
        + scoped_meter(3)
        + "</attributes>"
        + note("c", "3")
        + "</measure>"
    )
    xml = scoped_score(
        scoped_part("a", scoped_meter(), second=second),
        scoped_part(
            "b", scoped_meter(), second='<measure number="2">' + note("d", "4") + "</measure>"
        ),
    )
    model = parse_score_semantics(xml)
    assert [m.start for m in model.measures] == [Fraction(0), Fraction(4)]
    with pytest.raises(PracticeScoreInvalidError):
        project_practice_score(model)


@pytest.mark.parametrize(
    "first,second", [(scoped_meter(), scoped_meter(2, 2)), (scoped_meter(3), scoped_meter(6, 8))]
)
def test_empty_measure_accepts_agreeing_cross_part_nominal_durations(first, second):
    model = parse_score_semantics(
        scoped_score(scoped_part("a", first, body=""), scoped_part("b", second, body=""))
    )
    assert model.end == model.meters[0].duration_quarters == model.meters[1].duration_quarters
    assert model.measures[0].uses_meter_duration


def test_empty_measure_uses_complete_agreeing_staff_meters():
    model = parse_score_semantics(
        scoped_score(
            scoped_part("a", scoped_meter(staff=1) + scoped_meter(2, 2, staff=2), body="", staves=2)
        )
    )
    assert model.end == Fraction(4)


@pytest.mark.parametrize(
    "xml",
    [
        scoped_score(
            scoped_part("a", scoped_meter(), body=""), scoped_part("b", scoped_meter(3), body="")
        ),
        scoped_score(
            scoped_part("a", scoped_meter(staff=1) + scoped_meter(3, staff=2), body="", staves=2)
        ),
    ],
)
def test_empty_measure_rejects_ambiguous_scoped_nominal_duration(xml):
    with pytest.raises(MusicXMLSemanticError, match="ambiguous_empty_measure_duration"):
        parse_score_semantics(xml)


@pytest.mark.parametrize(
    "xml",
    [
        scoped_score(scoped_part("a", scoped_meter(staff=1), body="", staves=2)),
        scoped_score(scoped_part("a", scoped_meter(), body=""), scoped_part("b", body="")),
    ],
)
def test_empty_measure_requires_relevant_meter_coverage(xml):
    with pytest.raises(MusicXMLSemanticError, match="empty_measure_requires_meter"):
        parse_score_semantics(xml)


def test_empty_measure_resolves_staff_override_and_later_part_wide_change():
    second = '<measure number="2"><attributes>' + scoped_meter(2, 4) + "</attributes></measure>"
    model = parse_score_semantics(
        scoped_score(
            scoped_part(
                "a",
                scoped_meter() + scoped_meter(3, staff=1) + scoped_meter(3, staff=2),
                body="",
                staves=2,
                second=second,
            )
        )
    )
    assert [(m.start, m.end) for m in model.measures] == [
        (Fraction(0), Fraction(3)),
        (Fraction(3), Fraction(5)),
    ]


NONTRADITIONAL_KEY = "<key><key-step>B</key-step><key-alter>-1</key-alter><key-step>E</key-step><key-alter>-2</key-alter></key>"


def test_nontraditional_key_is_canonical_and_practice_compatible():
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.processing.musicxml.metadata import project_score_metadata, MetadataExtractionError

    model = parse_score_semantics(
        scoped_score(scoped_part("a", scoped_meter(), NONTRADITIONAL_KEY))
    )
    key = model.keys[0]
    assert (key.part_index, key.staff_number, key.position, key.fifths, key.mode) == (
        0,
        None,
        Fraction(0),
        None,
        None,
    )
    assert [(a.step, a.alter, a.accidental) for a in key.alterations] == [
        ("B", Fraction(-1), None),
        ("E", Fraction(-2), None),
    ]
    assert len(project_practice_score(model).notes) == 1
    with pytest.raises(MetadataExtractionError, match="unsupported_nontraditional_key"):
        project_score_metadata(model)


def test_nontraditional_microtonal_key_retains_exact_alteration_and_accidental():
    key = "<key><key-step>F</key-step><key-alter>0.5</key-alter><key-accidental>quarter-sharp</key-accidental></key>"
    model = parse_score_semantics(scoped_score(scoped_part("a", scoped_meter(), key)))
    assert model.keys[0].alterations[0].alter == Fraction(1, 2)
    assert model.keys[0].alterations[0].accidental == "quarter-sharp"


def test_optional_key_mode_is_only_defaulted_by_metadata():
    from app.processing.musicxml.metadata import project_score_metadata

    model = parse_score_semantics(
        scoped_score(scoped_part("a", scoped_meter(), "<key><fifths>1</fifths></key>"))
    )
    assert model.keys[0].mode is None
    assert model.keys[0].fifths == 1 and model.keys[0].alterations == ()
    result = project_score_metadata(model)
    assert result.primary_mode == "major"
    assert result.key_signature_events[0]["mode"] == "major"


@pytest.mark.parametrize(
    "key",
    [
        '<key number="2"><fifths>-2</fifths><mode>minor</mode></key>',
        NONTRADITIONAL_KEY.replace("<key>", '<key number="2">'),
    ],
)
def test_key_staff_scope_is_preserved_but_not_projected_to_metadata(key):
    from app.modules.practice.score.compiler.musicxml import project_practice_score
    from app.processing.musicxml.metadata import project_score_metadata, MetadataExtractionError

    model = parse_score_semantics(scoped_score(scoped_part("a", scoped_meter(), key, staves=2)))
    assert model.keys[0].staff_number == 2
    assert len(project_practice_score(model).notes) == 1
    with pytest.raises(MetadataExtractionError, match="unsupported_staff_key"):
        project_score_metadata(model)


def test_explicit_traditional_minor_mode_is_preserved():
    from app.processing.musicxml.metadata import project_score_metadata

    model = parse_score_semantics(
        scoped_score(
            scoped_part("a", scoped_meter(), "<key><fifths>-2</fifths><mode>minor</mode></key>")
        )
    )
    assert model.keys[0].fifths == -2 and model.keys[0].mode == "minor"
    assert project_score_metadata(model).primary_mode == "minor"


@pytest.mark.parametrize(
    "key",
    [
        "<key><key-step>B</key-step></key>",
        "<key><key-alter>-1</key-alter></key>",
        "<key><key-step>E</key-step><key-alter>NaN</key-alter></key>",
        "<key><fifths>1</fifths><key-step>B</key-step><key-alter>-1</key-alter></key>",
    ],
)
def test_invalid_key_representations_are_not_silently_projected(key):
    with pytest.raises(MusicXMLSemanticError):
        parse_score_semantics(scoped_score(scoped_part("a", scoped_meter(), key)))


@pytest.mark.parametrize(
    "fact", [scoped_meter(staff=0), '<key number="0"><fifths>0</fifths></key>']
)
def test_explicit_staff_scope_must_be_positive(fact):
    with pytest.raises(MusicXMLSemanticError, match="invalid_staff_number"):
        parse_score_semantics(scoped_score(scoped_part("a", fact)))
