"""Playback sources, presentation independence and shared sound applicability."""

from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest

from app.core.exceptions import ValidationException
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.musicxml_tempo import MusicXMLTempoError, parse_tempo_directive
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint

ATTRIBUTES = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
NOTE = "<note><rest/><duration>4</duration></note>"
METRONOME = "<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type>"


def score(body, second=""):
    return f'<score-partwise><part id="P1"><measure number="1">{ATTRIBUTES}{body}</measure></part>{second}</score-partwise>'


def admitted(xml):
    return parse_score_semantics(admit_musicxml_document(xml.encode()))


@pytest.mark.parametrize("kind", ["segno", "coda"])
@pytest.mark.parametrize("location,point", [("left", 0), ("middle", 2), ("right", 6)])
@pytest.mark.parametrize("visual", [False, True])
def test_barline_destinations_preserve_source_and_shared_exact_points(
    kind, location, point, visual
):
    barline = (
        f'<barline location="{location}" {kind}="  Label&#x9; A  ">'
        + (f"<{kind}/>" if visual else "")
        + "</barline>"
    )
    timed = (
        NOTE + "<backup><duration>3</duration></backup><forward><duration>1</duration></forward>"
    )
    body = barline + timed if location == "left" else timed + barline
    other = '<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><rest/><duration>6</duration></note></measure></part>'
    model = admitted(score(body, other))
    fact = model.playback_navigation[0]
    assert (fact.source, fact.barline_location, fact.point, getattr(fact, kind)) == (
        "barline",
        location,
        WrittenPoint(0, Fraction(point)),
        "Label A",
    )
    assert (
        fact.dacapo,
        fact.dalsegno,
        fact.tocoda,
        fact.fine,
        fact.forward_repeat,
        fact.time_only,
    ) == (False, None, None, None, False, None)
    if visual:
        assert model.navigation_markers[0].point == fact.point
        assert model.navigation_markers[0].kind == kind
    else:
        assert model.navigation_markers == ()
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [0]


@pytest.mark.parametrize(
    "layout,order", [("linear", [0, 1, 2]), ("repeat", [0, 1, 0, 1, 2]), ("volta", [0, 1, 0, 2])]
)
def test_visual_markers_and_unmodeled_sound_applicability_do_not_change_traversal(layout, order):
    presentation = '<direction><direction-type><segno/><coda/></direction-type></direction><sound dynamics="70" time-only="2"/>'
    forward = (
        '<barline location="left"><repeat direction="forward"/></barline>'
        if layout != "linear"
        else ""
    )
    first = (
        '<barline location="left"><ending number="1" type="start"/></barline>'
        if layout == "volta"
        else ""
    )
    backward = (
        '<barline location="right">'
        + ('<ending number="1" type="stop"/>' if layout == "volta" else "")
        + '<repeat direction="backward"/></barline>'
        if layout != "linear"
        else ""
    )
    final_start = (
        '<barline location="left"><ending number="2" type="start"/></barline>'
        if layout == "volta"
        else ""
    )
    final_end = (
        "<barline><coda/>"
        + ('<ending number="2" type="discontinue"/>' if layout == "volta" else "")
        + "</barline>"
    )
    xml = score(forward + presentation + NOTE).replace(
        "</part>",
        f'<measure number="2">{first}{NOTE}{backward}</measure><measure number="3">{final_start}{NOTE}{final_end}</measure></part>',
    )
    model = admitted(xml)
    assert model.playback_navigation == ()
    assert len(model.navigation_markers) == 3
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == order
    assert extract_musicxml_metadata(xml).playback_duration_ms == len(order) * 3000


def test_tempo_keeps_applicability_without_becoming_a_navigation_event():
    xml = score('<sound tempo="100" time-only="2"/>' + NOTE)
    assert admit_musicxml_document(xml.encode()) == xml.encode()
    model = admitted(xml)
    assert model.playback_navigation == ()
    assert model.tempos[0].time_only == (2,)
    assert model.tempos[0].quarter_bpm == Fraction(100)
    assert model.tempos[0].point == WrittenPoint(0, Fraction(0))
    with pytest.raises(PerformanceNavigationError, match="unsupported_time_only_playback"):
        project_performance_occurrences(model)
    with pytest.raises(MetadataExtractionError, match="unsupported_time_only_playback"):
        extract_musicxml_metadata(xml)


def test_sound_applicability_without_navigation_or_tempo_is_not_a_command():
    xml = score('<sound dynamics="70" time-only="2"/>' + NOTE)
    model = admitted(xml)
    assert model.playback_navigation == model.tempos == model.navigation_markers == ()
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [0]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 3000


def test_barline_endpoint_and_next_sound_start_retain_distinct_written_ownership():
    xml = score(NOTE + '<barline segno="S1"/>').replace(
        "</part>", '<measure number="2"><sound coda="C1"/>' + NOTE + "</measure></part>"
    )
    model = admitted(xml)
    assert [(f.source, f.point) for f in model.playback_navigation] == [
        ("barline", WrittenPoint(0, Fraction(4))),
        ("sound", WrittenPoint(1, Fraction(4))),
    ]


def test_empty_measure_barline_destination_uses_determinate_meter_end():
    model = admitted(score('<barline segno="S1"><segno/></barline>'))
    assert (
        model.playback_navigation[0].point
        == model.navigation_markers[0].point
        == WrittenPoint(0, Fraction(4))
    )


@pytest.mark.parametrize(
    "raw,expected",
    [(None, None), ("1", (1,)), ("1,2", (1, 2)), ("1, 2", (1, 2)), ("1,\t2", (1, 2))],
)
def test_shared_time_only_datatype_and_all_sound_consumers(raw, expected):
    from app.score_semantics.musicxml_time_only import parse_time_only

    assert parse_time_only(raw) == expected
    attribute = f' time-only="{raw.replace(chr(9), "&#x9;")}"' if raw is not None else ""
    model = admitted(score(f'<sound dalsegno="S1" tempo="100"{attribute}/>' + NOTE))
    fact = model.playback_navigation[0]
    assert (fact.dalsegno, fact.source, fact.barline_location, fact.time_only) == (
        "S1",
        "sound",
        None,
        expected,
    )
    assert model.tempos[0].time_only == expected
    directive = parse_tempo_directive(
        ET.fromstring(f'<sound tempo="100"{attribute}/>'), Fraction(1)
    )
    assert directive.time_only == expected


@pytest.mark.parametrize("raw", ["0", "01", "2,1", "1,1", "1,,2", "1-2", "1 ,2", "1 , 2", "", " "])
def test_invalid_time_only_is_rejected_for_every_sound_source(raw):
    from app.score_semantics.musicxml_time_only import MusicXMLTimeOnlyError, parse_time_only

    with pytest.raises(MusicXMLTimeOnlyError):
        parse_time_only(raw)
    with pytest.raises(MusicXMLTempoError, match="Invalid tempo sound applicability"):
        parse_tempo_directive(ET.fromstring(f'<sound tempo="100" time-only="{raw}"/>'), Fraction(1))
    for fields in ('dalsegno="S1"', 'tempo="100"', 'dynamics="70"', ""):
        xml = score(f'<sound {fields} time-only="{raw}"/>' + NOTE)
        with pytest.raises(MusicXMLSemanticError):
            parse_score_semantics(xml)
        with pytest.raises(ValidationException):
            admit_musicxml_document(xml.encode())


@pytest.mark.parametrize(
    "existing_sound",
    [
        "",
        '<sound dynamics="70"/>',
        '<sound dynamics="70" time-only="2"/>',
        '<sound dynamics="70" time-only="2"><offset>2</offset></sound>',
    ],
)
def test_metronome_materialization_preserves_sound_applicability_and_is_idempotent(existing_sound):
    content = score(f"<direction>{METRONOME}{existing_sound}</direction>" + NOTE).encode()
    trusted = admit_musicxml_document(content)
    assert admit_musicxml_document(trusted) == trusted
    sounds = list(ET.fromstring(trusted).iter("sound"))
    assert len(sounds) == (2 if "time-only" in existing_sound else 1)
    tempo_sound = next(s for s in sounds if "tempo" in s.attrib)
    assert tempo_sound.get("tempo") == "100"
    assert tempo_sound.get("time-only") is None
    if existing_sound:
        original = next(s for s in sounds if "dynamics" in s.attrib)
        assert original.get("dynamics") == "70"
        assert original.get("time-only") == ("2" if "time-only" in existing_sound else None)
    model = parse_score_semantics(trusted)
    assert model.tempos[0].time_only is None
    assert model.playback_navigation == ()
    assert model.tempos[0].position == (2 if "<offset>" in existing_sound else 0)


def test_duplicate_sound_and_barline_labels_retain_part_and_source_identity():
    body = '<sound segno="S1"/><note><rest/><duration>2</duration></note><sound segno="S1"/><note><rest/><duration>2</duration></note><barline segno="S1"><segno/></barline>'
    other = f'<part id="P2"><measure number="1">{ATTRIBUTES}{NOTE}<barline segno="S1"/></measure></part>'
    model = admitted(score(body, other))
    assert [(f.part_index, f.source, f.point, f.segno) for f in model.playback_navigation] == [
        (0, "sound", WrittenPoint(0, Fraction(0)), "S1"),
        (0, "sound", WrittenPoint(0, Fraction(2)), "S1"),
        (0, "barline", WrittenPoint(0, Fraction(4)), "S1"),
        (1, "barline", WrittenPoint(0, Fraction(4)), "S1"),
    ]


@pytest.mark.parametrize("kind", ["segno", "coda"])
def test_empty_barline_labels_are_lexically_invalid(kind):
    with pytest.raises(ValidationException):
        admit_musicxml_document(score(NOTE + f'<barline {kind}=" &#x9; "/>').encode())
