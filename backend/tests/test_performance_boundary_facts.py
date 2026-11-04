"""Written measure ownership survives repeated endpoint encounters."""

from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest
import verovio

from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint


def projected(model):
    return project_performance_occurrences(model).project_facts(
        [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
    )


def rates(model):
    return [(f.position, f.value) for f in projected(model)]


def measure(index, before="", after=""):
    attributes = (
        "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
        if index == 0
        else ""
    )
    return f'<measure number="{index + 1}">{attributes}{before}<note id="n{index}"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>{after}</measure>'


def tempo(bpm):
    return f'<direction><sound tempo="{bpm}"/></direction>'


FORWARD = '<barline location="left"><repeat direction="forward"/></barline>'
BACKWARD = '<barline location="right"><repeat direction="backward"/></barline>'


def score(*measures):
    return (
        '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">'
        + "".join(measures)
        + "</part></score-partwise>"
    )


def endpoint_score(next_start="", repeat_start=""):
    return score(
        measure(0, FORWARD + repeat_start),
        measure(1, after=tempo(100) + BACKWARD),
        measure(2, next_start),
    )


def test_interior_repeat_endpoint_tempo_executes_before_each_jump_and_exit():
    xml = endpoint_score()
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    fact = model.tempos[0]
    assert fact.measure_index == 1
    assert fact.position == model.measures[1].end == model.measures[2].start == Fraction(8)
    assert rates(model) == [(Fraction(8), 100), (Fraction(16), 100)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 13200


def test_endpoint_and_next_measure_start_are_distinct_canonical_tempo_slots():
    xml = endpoint_score(tempo(80))
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert [(t.measure_index, t.position, t.quarter_bpm) for t in model.tempos] == [
        (1, Fraction(8), Fraction(100)),
        (2, Fraction(8), Fraction(80)),
    ]
    assert rates(model) == [(Fraction(8), 100), (Fraction(16), 100), (Fraction(16), 80)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 13800


def test_endpoint_encounter_precedes_repeat_destination_even_when_bpm_decreases():
    xml = endpoint_score(repeat_start=tempo(80))
    assert rates(parse_score_semantics(xml)) == [(0, 80), (8, 100), (8, 80), (16, 100)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 14400


def test_generic_projection_retains_boundary_identity_source_order_and_duplicate_values():
    model = parse_score_semantics(endpoint_score())
    projection = project_performance_occurrences(model)
    end = WrittenPerformanceFact(WrittenPoint(1, Fraction(8)), "end")
    start = WrittenPerformanceFact(WrittenPoint(0, Fraction(0)), "start")
    following = WrittenPerformanceFact(WrittenPoint(2, Fraction(8)), "next")
    result = projection.project_facts([following, end, end, start])
    assert [(f.position, f.value, f.occurrence_ordinal) for f in result] == [
        (0, "start", 0),
        (8, "end", 1),
        (8, "end", 1),
        (8, "start", 2),
        (16, "end", 3),
        (16, "end", 3),
        (16, "next", 4),
    ]
    assert result[1].source is end and result[-1].source is following


@pytest.mark.parametrize(
    "source,offset,expected",
    [
        (0, 2, [2, 10]),
        (0, 5, [5, 13]),
        (2, -3, [5, 13]),
        (0, 4, [4, 12]),
        (1, 0, [4, 12]),
        (0, 12, [20]),
        (2, -8, [0, 8]),
    ],
)
def test_sound_offsets_preserve_source_identity_and_resolve_unambiguous_playback_owner(
    source, offset, expected
):
    notation = f'<direction><offset sound="yes">{offset}</offset><sound tempo="90"/></direction>'
    measures = [
        measure(0, FORWARD + (notation if source == 0 else "")),
        measure(1, notation if source == 1 else "", BACKWARD),
        measure(2, notation if source == 2 else ""),
    ]
    model = parse_score_semantics(admit_musicxml_document(score(*measures).encode()))
    assert model.tempos[0].measure_index == source
    facts = projected(model)
    assert [f.position for f in facts] == list(map(Fraction, expected))
    assert all(f.source.point == model.tempos[0].point for f in facts)
    assert all(type(f.position) is Fraction for f in facts)


@pytest.mark.parametrize("source,offset", [(0, 8), (2, -4)])
def test_cross_measure_offset_on_an_unowned_shared_boundary_is_admitted_but_not_guessed(
    source, offset
):
    notation = f'<direction><offset sound="yes">{offset}</offset><sound tempo="90"/></direction>'
    xml = score(
        measure(0, FORWARD + (notation if source == 0 else "")),
        measure(1, after=BACKWARD),
        measure(2, notation if source == 2 else ""),
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match="ambiguous_cross_measure_boundary"):
        projected(model)
    with pytest.raises(MetadataExtractionError, match="ambiguous_cross_measure_boundary"):
        extract_musicxml_metadata(xml)


@pytest.mark.parametrize("second_bpm", [90, 100])
def test_cross_part_same_semantic_slot_still_requires_tempo_agreement(second_bpm):
    xml = score(measure(0, tempo(90)))
    other = '<part id="P2">' + measure(0, tempo(second_bpm)) + "</part>"
    xml = xml.replace("</score-partwise>", other + "</score-partwise>")
    if second_bpm != 90:
        with pytest.raises(MusicXMLSemanticError, match="invalid_tempo"):
            parse_score_semantics(xml)
    else:
        model = parse_score_semantics(xml)
        assert len(model.tempos) == 2
        assert rates(model) == [(0, 90), (0, 90)]


def test_cross_measure_interior_offset_conflicts_with_same_effective_slot():
    xml = score(
        measure(0, '<direction><offset sound="yes">5</offset><sound tempo="90"/></direction>'),
        measure(1, '<direction><offset sound="yes">1</offset><sound tempo="100"/></direction>'),
    )
    with pytest.raises(MusicXMLSemanticError, match="invalid_tempo"):
        parse_score_semantics(xml)


def test_cross_part_boundary_slots_coexist_with_agreed_rates():
    xml = endpoint_score(tempo(80))
    xml = xml.replace(
        "</score-partwise>",
        '<part id="P2">'
        + measure(0)
        + measure(1, after=tempo(100))
        + measure(2, tempo(80))
        + "</part></score-partwise>",
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert rates(model) == [(8, 100), (8, 100), (16, 100), (16, 100), (16, 80), (16, 80)]


@pytest.mark.parametrize("owner", [1, 2])
def test_true_cross_part_boundary_slot_conflicts_are_still_rejected(owner):
    xml = endpoint_score(tempo(80))
    xml = xml.replace(
        "</score-partwise>",
        '<part id="P2">'
        + measure(0)
        + measure(1, after=tempo(90) if owner == 1 else "")
        + measure(2, tempo(90) if owner == 2 else "")
        + "</part></score-partwise>",
    )
    with pytest.raises(MusicXMLSemanticError, match="invalid_tempo"):
        parse_score_semantics(xml)


def test_real_verovio_boundary_witness():
    from app.processing.engines.playback.tempo_projection import (
        playback_musicxml,
        renderer_tempo_events,
    )
    from app.score_semantics.tempo_policy import DEFAULT_SCORE_TEMPO_BPM

    xml = endpoint_score()
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(playback_musicxml(xml.encode()))
    toolkit.renderToMIDI()
    timing = toolkit.renderToTimemap({"includeMeasures": True})
    endpoint = [e for e in ET.fromstring(toolkit.getMEI()).iter() if e.tag.endswith("}tempo")]
    assert len(endpoint) == 1
    assert endpoint[0].get("tstamp") == "5"
    assert endpoint[0].get("midi.bpm") == "100"
    events = renderer_tempo_events(
        toolkit.getMEI(), timing, DEFAULT_SCORE_TEMPO_BPM, toolkit.renderToExpansionMap()
    )
    assert events == [(Fraction(0), Fraction(80))] + rates(parse_score_semantics(xml))
    assert [e["on"][0].split("-rend")[0] for e in timing if e.get("on")] == [
        "n0",
        "n1",
        "n0",
        "n1",
        "n2",
    ]
