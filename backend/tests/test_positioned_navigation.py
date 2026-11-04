"""Typed playback events and independent presentation points, without execution."""

from dataclasses import FrozenInstanceError
from fractions import Fraction
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest

from app.core.exceptions import ValidationException
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint

FIXTURES = Path(__file__).parent / "fixtures/musicxml"


def note(duration=4, identity="n1"):
    return f'<note id="{identity}"><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration></note>'


def score(body, divisions=1, second_part=""):
    return f'<score-partwise><part id="P1"><measure number="7"><attributes><divisions>{divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>{body}</measure></part>{second_part}</score-partwise>'


def admitted(xml):
    return parse_score_semantics(admit_musicxml_document(xml.encode()))


def test_official_style_segno_has_independent_visual_and_playback_points():
    content = (FIXTURES / "positioned-segno.musicxml").read_bytes()
    model = parse_score_semantics(admit_musicxml_document(content))
    marker = model.navigation_markers[0]
    fact = model.playback_navigation[0]
    assert (marker.point, marker.source, marker.kind, marker.barline_location) == (
        WrittenPoint(0, Fraction(2)),
        "direction",
        "segno",
        None,
    )
    assert fact.point == WrittenPoint(0, Fraction(0))
    assert fact.segno == "3"
    assert (fact.part_index, fact.measure_number) == (0, "1")
    with pytest.raises(FrozenInstanceError):
        fact.segno = "different"


@pytest.mark.parametrize(
    "direction_offset,sound_offset,visual,playback",
    [
        ("<offset>2</offset>", "", 2, 0),
        ('<offset sound="no">2</offset>', "", 2, 0),
        ('<offset sound="yes">2</offset>', "", 2, 2),
        ('<offset sound="yes">1</offset>', "<offset>2</offset>", 1, 2),
    ],
)
def test_direction_visual_and_sound_playback_offsets_are_independent(
    direction_offset, sound_offset, visual, playback
):
    xml = score(
        f'<direction><direction-type><segno/></direction-type>{direction_offset}<sound segno="S1">{sound_offset}</sound></direction>'
        + note()
    )
    model = admitted(xml)
    assert model.navigation_markers[0].point == WrittenPoint(0, Fraction(visual))
    assert model.playback_navigation[0].point == WrittenPoint(0, Fraction(playback))


def test_named_destinations_references_and_gating_stay_in_the_same_sound_event():
    model = parse_score_semantics(
        admit_musicxml_document((FIXTURES / "named-navigation.musicxml").read_bytes())
    )
    facts = model.playback_navigation
    assert [(f.point, f.segno, f.coda) for f in facts[:2]] == [
        (WrittenPoint(0, Fraction(0)), "S1", None),
        (WrittenPoint(0, Fraction(2)), "S2", "C1"),
    ]
    jump = facts[2]
    assert (jump.point, jump.dalsegno, jump.tocoda, jump.time_only) == (
        WrittenPoint(1, Fraction(5)),
        "S2",
        "C2",
        (2,),
    )
    assert (jump.dacapo, jump.forward_repeat, jump.fine) == (False, False, None)
    assert (facts[3].point, facts[3].coda) == (WrittenPoint(1, Fraction(6)), "C2")
    assert (facts[4].point, facts[4].fine) == (WrittenPoint(1, Fraction(8)), "1.5")
    assert len(facts) == 5


@pytest.mark.parametrize("attribute", ["segno", "dalsegno", "coda", "tocoda"])
def test_navigation_tokens_collapse_only_xml_whitespace_without_case_folding(attribute):
    model = admitted(score(f'<sound {attribute}="  Segno&#x9; &#xA; A  "/>' + note()))
    assert getattr(model.playback_navigation[0], attribute) == "Segno A"
    xml = score(f'<sound {attribute}=" &#x9; "/>' + note())
    with pytest.raises(MusicXMLSemanticError, match="invalid_navigation"):
        parse_score_semantics(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


@pytest.mark.parametrize("raw,expected", [("yes", "yes"), ("  1.50  ", "1.50")])
def test_fine_preserves_a_normalized_uninterpreted_source_token(raw, expected):
    fact = admitted(score(f'<sound fine="{raw}"/>' + note())).playback_navigation[0]
    assert fact.fine == expected
    assert fact.time_only is None


@pytest.mark.parametrize(
    "attribute,field", [("dacapo", "dacapo"), ("forward-repeat", "forward_repeat")]
)
def test_navigation_boolean_requires_literal_yes(attribute, field):
    fact = admitted(score(f'<sound {attribute}="yes"/>' + note())).playback_navigation[0]
    assert getattr(fact, field) is True
    assert fact.point == WrittenPoint(0, Fraction(0))


@pytest.mark.parametrize("attribute", ["dacapo", "forward-repeat"])
@pytest.mark.parametrize("value", ["no", "true", "1", "", "maybe"])
def test_invalid_navigation_boolean_fails_canonical_admission(attribute, value):
    xml = score(f'<sound {attribute}="{value}"/>' + note())
    with pytest.raises(MusicXMLSemanticError, match="invalid_navigation"):
        parse_score_semantics(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


@pytest.mark.parametrize("raw,expected", [("1", (1,)), ("1,2", (1, 2)), ("1, 2, 3", (1, 2, 3))])
def test_time_only_is_an_ordered_exact_pass_predicate(raw, expected):
    fact = admitted(
        score(f'<sound dalsegno="S1" time-only="{raw}"/>' + note())
    ).playback_navigation[0]
    assert fact.time_only == expected
    assert fact.dalsegno == "S1"


@pytest.mark.parametrize("raw", ["0", "01", "2,1", "1,1", "1,,2", "1-", "1-2", "", " ", "1,02"])
def test_malformed_time_only_is_not_sorted_or_deduplicated(raw):
    xml = score(f'<sound time-only="{raw}"/>' + note())
    with pytest.raises(MusicXMLSemanticError, match="invalid_sound_time_only"):
        parse_score_semantics(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


@pytest.mark.parametrize(
    "markup,field,value,point",
    [
        ('<sound dacapo="yes"/>', "dacapo", True, 2),
        ('<sound dalsegno="S1"><offset>1</offset></sound>', "dalsegno", "S1", 3),
        ('<sound fine="yes"/>', "fine", "yes", 2),
        ('<sound tocoda="C1"/>', "tocoda", "C1", 2),
        ('<sound coda="C1"/>', "coda", "C1", 2),
    ],
)
def test_mid_measure_playback_facts_keep_exact_owned_points(markup, field, value, point):
    model = admitted(score(note(2) + markup + note(2, "n2")))
    fact = model.playback_navigation[0]
    assert (fact.point, fact.measure_number) == (WrittenPoint(0, Fraction(point)), "7")
    assert getattr(fact, field) == value


def test_visual_and_playback_offsets_remain_exact_fraction_thirds():
    model = admitted(
        score(
            '<direction><direction-type><coda/></direction-type><offset>1</offset><sound coda="C1"><offset>2</offset></sound></direction>'
            + note(3),
            divisions=3,
        )
    )
    assert model.navigation_markers[0].point == WrittenPoint(0, Fraction(1, 3))
    assert model.playback_navigation[0].point == WrittenPoint(0, Fraction(2, 3))


def test_barline_markers_use_shared_boundaries_and_middle_cursor():
    second = (
        '<part id="P2"><measure number="other"><attributes><divisions>1</divisions></attributes>'
        + note(6, "p2")
        + "</measure></part>"
    )
    model = admitted(
        score(
            '<barline location="left"><segno/></barline>'
            + note(4)
            + '<backup><duration>3</duration></backup><barline location="middle"><coda/></barline>'
            + "<barline><coda/></barline>",
            second_part=second,
        )
    )
    assert model.measures[0].end == 6
    assert [(m.point, m.source, m.barline_location, m.kind) for m in model.navigation_markers] == [
        (WrittenPoint(0, Fraction(0)), "barline", "left", "segno"),
        (WrittenPoint(0, Fraction(1)), "barline", "middle", "coda"),
        (WrittenPoint(0, Fraction(6)), "barline", "right", "coda"),
    ]


@pytest.mark.parametrize("kind", ["segno", "coda"])
def test_visual_only_and_playback_only_markers_remain_distinct(kind):
    visual = admitted(
        score(f"<direction><direction-type><{kind}/></direction-type></direction>" + note())
    )
    playback = admitted(score(f'<sound {kind}="destination"/>' + note()))
    assert len(visual.navigation_markers) == 1 and visual.playback_navigation == ()
    assert playback.navigation_markers == () and len(playback.playback_navigation) == 1
    assert [o.measure_index for o in project_performance_occurrences(visual).occurrences] == [0]
    with pytest.raises(PerformanceNavigationError, match="unsupported_performance_navigation"):
        project_performance_occurrences(playback)


def test_duplicate_labels_unresolved_references_and_part_identity_remain_source_facts():
    other = (
        '<part id="P2"><measure number="x"><attributes><divisions>1</divisions></attributes><sound segno="S1"/>'
        + note(4, "p2")
        + "</measure></part>"
    )
    xml = score(
        '<sound segno="S1"/>'
        + note(2)
        + '<sound segno="S1"/><sound segno="s1"/><sound dalsegno="unresolved" tocoda="missing"/>'
        + note(2, "n2"),
        second_part=other,
    )
    model = admitted(xml)
    assert [(f.part_index, f.point, f.segno) for f in model.playback_navigation if f.segno] == [
        (0, WrittenPoint(0, Fraction(0)), "S1"),
        (0, WrittenPoint(0, Fraction(2)), "S1"),
        (0, WrittenPoint(0, Fraction(2)), "s1"),
        (1, WrittenPoint(0, Fraction(0)), "S1"),
    ]
    assert model.playback_navigation[3].dalsegno == "unresolved"
    assert model.playback_navigation[3].tocoda == "missing"
    with pytest.raises(MetadataExtractionError):
        extract_musicxml_metadata(xml)
    assert len(compile_practice_score(xml).notes) == 3


def test_direction_position_owner_handles_namespace_and_validates_its_numeric_boundary():
    from app.score_semantics.musicxml_direction_position import (
        MusicXMLDirectionPositionError,
        resolve_direction_offset_quarters,
    )

    direction = ET.fromstring(
        '<direction xmlns="urn:musicxml"><offset sound="no">-1</offset></direction>'
    )
    assert resolve_direction_offset_quarters(direction, Fraction(3)) == Fraction(-1, 3)
    assert resolve_direction_offset_quarters(ET.fromstring("<direction/>"), None) == 0
    for unit in (None, Fraction(0), Fraction(-1)):
        with pytest.raises(MusicXMLDirectionPositionError):
            resolve_direction_offset_quarters(direction, unit)
    for raw in ("NaN", "Infinity", "one", ""):
        with pytest.raises(MusicXMLDirectionPositionError):
            resolve_direction_offset_quarters(
                ET.fromstring(f"<direction><offset>{raw}</offset></direction>"), Fraction(1)
            )


def test_visual_marker_at_measure_end_retains_source_boundary_identity():
    xml = score(
        note()
        + '<direction><direction-type><segno/></direction-type><sound fine="yes"/></direction>'
    ).replace(
        "</part>", '<measure number="8"><sound segno="S1"/>' + note(4, "n2") + "</measure></part>"
    )
    model = admitted(xml)
    assert model.navigation_markers[0].point == WrittenPoint(0, Fraction(4))
    assert [f.point for f in model.playback_navigation] == [
        WrittenPoint(0, Fraction(4)),
        WrittenPoint(1, Fraction(4)),
    ]


def test_right_barline_marker_uses_nominal_end_of_an_empty_measure():
    model = admitted(score("<barline><coda/></barline>"))
    assert model.measures[0].uses_meter_duration
    assert model.navigation_markers[0].point == WrittenPoint(0, Fraction(4))


@pytest.mark.parametrize("offset", ["one", "NaN", "", "1</offset><offset>2"])
def test_invalid_visual_marker_offset_is_a_canonical_position_error(offset):
    xml = score(
        f"<direction><direction-type><segno/></direction-type><offset>{offset}</offset></direction>"
        + note()
    )
    with pytest.raises(MusicXMLSemanticError, match="invalid_navigation_marker_position"):
        parse_score_semantics(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


def test_visual_marker_offset_requires_divisions_even_without_playback_offset():
    xml = score(
        "<direction><direction-type><segno/></direction-type><offset>1</offset></direction>"
    ).replace("<divisions>1</divisions>", "")
    with pytest.raises(MusicXMLSemanticError, match="invalid_navigation_marker_position"):
        parse_score_semantics(xml)
