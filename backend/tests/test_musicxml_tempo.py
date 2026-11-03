from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest

from app.score_semantics.musicxml_tempo import (
    MusicXMLTempoError,
    parse_tempo_directive,
    put_tempo_fact,
)
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.processing.musicxml.admission import admit_musicxml_document
from app.core.exceptions import ValidationException


def metronome(unit="quarter", rate="90", dots=0):
    return f"<direction-type><metronome><beat-unit>{unit}</beat-unit>{'<beat-unit-dot/>' * dots}<per-minute>{rate}</per-minute></metronome></direction-type>"


@pytest.mark.parametrize(
    "notation, bpm",
    [
        ('<sound tempo="132"/>', Fraction(132)),
        (metronome(), Fraction(90)),
        (metronome("half", "60"), Fraction(120)),
        (metronome("quarter", "60", 1), Fraction(90)),
        (metronome("eighth", "120"), Fraction(60)),
        (metronome("quarter", "0.1", 2), Fraction(7, 40)),
        ('<sound tempo="120"/>' + metronome("half", "60"), Fraction(120)),
    ],
)
def test_explicit_tempo_is_namespace_agnostic_and_exact(notation, bpm):
    for namespace in ("", ' xmlns="http://www.musicxml.org/ns/musicxml"'):
        element = ET.fromstring(
            f'<direction{namespace}>{notation}<offset sound="yes">-3</offset></direction>'
        )
        directive = parse_tempo_directive(element, Fraction(2))
        assert directive is not None
        assert directive.quarter_bpm == bpm
        assert directive.playback_offset_quarters == Fraction(-3, 2)


@pytest.mark.parametrize(
    "value", ["0", "-1", "NaN", "Infinity", "-Infinity", "1e2", "90bpm", "", "1_20"]
)
def test_invalid_explicit_rates_fail_closed(value):
    for notation in (f'<sound tempo="{value}"/>', metronome(rate=value)):
        with pytest.raises(MusicXMLTempoError):
            parse_tempo_directive(ET.fromstring(f"<direction>{notation}</direction>"), Fraction(1))


@pytest.mark.parametrize(
    "notation",
    [
        '<sound tempo="120"/>' + metronome(rate="90"),
        metronome() + metronome(),
        metronome("unknown"),
        "<direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type>",
        "<direction-type><metronome><metronome-note/></metronome></direction-type>",
    ],
)
def test_conflicting_or_unsupported_notation_is_not_missing_tempo(notation):
    with pytest.raises(MusicXMLTempoError):
        parse_tempo_directive(ET.fromstring(f"<direction>{notation}</direction>"), Fraction(1))


def test_missing_directive_produces_no_default_and_positions_reject_conflicts():
    assert (
        parse_tempo_directive(
            ET.fromstring(
                "<direction><direction-type><words>Allegro</words></direction-type></direction>"
            ),
            None,
        )
        is None
    )
    facts = {}
    put_tempo_fact(facts, Fraction(0), Fraction(120))
    put_tempo_fact(facts, Fraction(0), Fraction(120))
    with pytest.raises(MusicXMLTempoError):
        put_tempo_fact(facts, Fraction(0), Fraction(90))
    with pytest.raises(MusicXMLTempoError):
        put_tempo_fact(facts, Fraction(-1), Fraction(90))


def score(body):
    return (
        '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
        + body
        + "</measure></part></score-partwise>"
    )


def rest(duration):
    return f"<note><rest/><duration>{duration}</duration></note>"


@pytest.mark.parametrize(
    "notation, expected",
    [
        ('<direction><offset>2</offset><sound tempo="90"/></direction>', 0),
        ('<direction><offset sound="no">2</offset><sound tempo="90"/></direction>', 0),
        ('<direction><offset sound="yes">2</offset><sound tempo="90"/></direction>', 1),
        ('<sound tempo="90"><offset>2</offset></sound>', 1),
        (
            '<direction><offset sound="yes">4</offset><sound tempo="90"><offset>2</offset></sound></direction>',
            1,
        ),
        (
            '<direction><offset sound="no">4</offset><sound tempo="90"><offset>2</offset></sound></direction>',
            1,
        ),
    ],
)
def test_directive_uses_effective_sound_playback_position(notation, expected):
    directive = parse_tempo_directive(ET.fromstring(notation), Fraction(2))
    assert directive.playback_offset_quarters == expected


def test_visual_offset_does_not_require_divisions_but_invalid_sound_flag_fails():
    directive = parse_tempo_directive(
        ET.fromstring('<direction><offset>4</offset><sound tempo="90"/></direction>'), None
    )
    assert directive.playback_offset_quarters == 0
    with pytest.raises(MusicXMLTempoError):
        parse_tempo_directive(
            ET.fromstring(
                '<direction><offset sound="maybe">4</offset><sound tempo="90"/></direction>'
            ),
            Fraction(2),
        )


@pytest.mark.parametrize(
    "notation, position",
    [
        ('<direction><offset>2</offset><sound tempo="60"/></direction>', 1),
        ('<direction><offset sound="no">2</offset><sound tempo="60"/></direction>', 1),
        ('<direction><offset sound="yes">2</offset><sound tempo="60"/></direction>', 2),
        ('<sound tempo="60"><offset>2</offset></sound>', 2),
        (
            '<direction><offset sound="yes">4</offset><sound tempo="60"><offset>2</offset></sound></direction>',
            2,
        ),
    ],
)
def test_canonical_practice_and_metadata_share_sound_playback_position(notation, position):
    from app.score_semantics.musicxml_score import parse_score_semantics

    xml = score(rest(2) + notation + rest(6))
    assert [(t.position, t.quarter_bpm) for t in parse_score_semantics(xml).tempos] == [
        (Fraction(position), Fraction(60))
    ]
    assert [(t.start_beat, t.bpm) for t in compile_practice_score(xml).tempo_segments] == [
        (position, 60)
    ]
    metadata = extract_musicxml_metadata(xml)
    assert metadata.tempo_events == [
        {"part": 1, "measure": "1", "offset_quarters": position, "bpm": 60}
    ]
    assert metadata.playback_duration_ms == position * 750 + (4 - position) * 1000


@pytest.mark.parametrize("flag, position", [("", 1), (' sound="no"', 1), (' sound="yes"', 2)])
def test_admission_materialization_preserves_effective_playback_offset(flag, position):
    from app.score_semantics.musicxml_score import parse_score_semantics

    raw = score(
        rest(2) + f"<direction><offset{flag}>2</offset>" + metronome() + "</direction>" + rest(6)
    ).encode()
    admitted = admit_musicxml_document(raw)
    assert admitted != raw
    assert parse_score_semantics(raw).tempos == parse_score_semantics(admitted).tempos
    assert parse_score_semantics(admitted).tempos[0].position == position
    assert admit_musicxml_document(admitted) == admitted


@pytest.mark.parametrize(
    "notation",
    [
        '<direction><offset sound="maybe">2</offset><sound tempo="90"/></direction>',
        '<sound tempo="90"><offset>NaN</offset></sound>',
        '<sound tempo="90"><offset>-1</offset></sound>',
    ],
)
def test_admission_rejects_invalid_sound_positions_before_returning_trusted_bytes(notation):
    from app.shared.constants import ErrorCode

    with pytest.raises(ValidationException) as caught:
        admit_musicxml_document(score(notation + rest(8)).encode())
    assert caught.value.code == ErrorCode.REVISION_CONTENT_INVALID


@pytest.mark.parametrize("flag", ["", ' sound="no"'])
def test_visual_metronome_offset_without_divisions_remains_admissible(flag):
    xml = f"<score-partwise><part><measure><attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><offset{flag}>4</offset>{metronome()}</direction></measure></part></score-partwise>"
    admitted = admit_musicxml_document(xml.encode())
    assert extract_musicxml_metadata(admitted).tempo_events[0]["offset_quarters"] == 0


@pytest.mark.parametrize("before, offset, after", [(0, 4, 8), (6, -2, 2)])
def test_offset_position_agrees_in_practice_metadata_and_duration(before, offset, after):
    xml = score(
        (rest(before) if before else "")
        + f'<direction><offset sound="yes">{offset}</offset>{metronome(rate="60")}</direction>'
        + rest(after)
    )
    compiled = compile_practice_score(xml)
    assert [(t.start_beat, t.bpm) for t in compiled.tempo_segments] == [(2, 60)]
    metadata = extract_musicxml_metadata(xml)
    assert metadata.tempo_events == [{"part": 1, "measure": "1", "offset_quarters": 2, "bpm": 60}]
    assert metadata.playback_duration_ms == 3500  # 2 quarters at 80, then 2 at 60.


def test_missing_and_late_tempo_do_not_backfill_the_initial_default():
    assert extract_musicxml_metadata(score(rest(8))).playback_duration_ms == 3000
    xml = score(rest(4) + "<direction>" + metronome(rate="90") + "</direction>" + rest(4))
    assert extract_musicxml_metadata(xml).playback_duration_ms == 2833
    assert [(t.start_beat, t.bpm) for t in compile_practice_score(xml).tempo_segments] == [(2, 90)]


@pytest.mark.parametrize("value", ["0", "-1", "NaN", "Infinity", "bad"])
def test_ingestion_boundaries_preserve_invalid_tempo_failure(value):
    xml = score(f'<direction><sound tempo="{value}"/></direction>' + rest(8))
    with pytest.raises(PracticeScoreInvalidError):
        compile_practice_score(xml)
    with pytest.raises(MetadataExtractionError, match="invalid_tempo"):
        extract_musicxml_metadata(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


@pytest.mark.parametrize(
    "unit, rate, dots, bpm",
    [
        ("quarter", "90", 0, "90"),
        ("half", "60", 0, "120"),
        ("quarter", "60", 1, "90"),
        ("eighth", "120", 0, "60"),
        ("quarter", "0.1", 2, "0.175"),
    ],
)
def test_canonical_document_materializes_same_exact_playback_fact(unit, rate, dots, bpm):
    raw = score(
        '<direction><offset sound="yes">2</offset>'
        + metronome(unit, rate, dots)
        + "</direction>"
        + rest(8)
    ).encode()
    prepared = admit_musicxml_document(raw)
    root = ET.fromstring(prepared)
    assert root.find(".//sound").get("tempo") == bpm
    assert root.find(".//metronome/beat-unit").text == unit
    assert len(root.findall(".//metronome/beat-unit-dot")) == dots
    assert admit_musicxml_document(prepared) == prepared
    assert (
        compile_practice_score(raw).tempo_segments
        == compile_practice_score(prepared).tempo_segments
    )
    assert extract_musicxml_metadata(raw) == extract_musicxml_metadata(prepared)


def test_missing_tempo_document_remains_byte_identical():
    raw = score(rest(8)).encode()
    assert admit_musicxml_document(raw) == raw


def test_namespaced_canonical_playback_projection():
    raw = score("<direction>" + metronome("half", "60") + "</direction>" + rest(8)).replace(
        "<score-partwise>", '<score-partwise xmlns="urn:musicxml">'
    )
    prepared = admit_musicxml_document(raw.encode())
    root = ET.fromstring(prepared)
    assert next(e for e in root.iter() if e.tag.endswith("}sound")).get("tempo") == "120"
