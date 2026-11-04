"""Canonical measure occurrences and their consumers, independent of renderer IDs."""

from dataclasses import FrozenInstanceError
from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest
import verovio

from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint


def bar(direction, *, location=None, times=None, after_jump=None):
    location = location or ("left" if direction == "forward" else "right")
    attrs = f' times="{times}"' if times is not None else ""
    attrs += f' after-jump="{after_jump}"' if after_jump is not None else ""
    return f'<barline location="{location}"><repeat direction="{direction}"{attrs}/></barline>'


def measure(index, before="", after="", duration=4):
    attributes = (
        "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
        if index == 0
        else ""
    )
    return f'<measure number="{index + 1}">{attributes}{before}<note id="n{index}"><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration><type>whole</type></note>{after}</measure>'


def score(*measures, second_part=None):
    parts = '<part id="P1">' + "".join(measures) + "</part>"
    part_list = '<score-part id="P1"><part-name>Piano</part-name></score-part>'
    if second_part is not None:
        parts += '<part id="P2">' + "".join(second_part) + "</part>"
        part_list += '<score-part id="P2"><part-name>Piano</part-name></score-part>'
    return (
        f'<score-partwise version="4.0"><part-list>{part_list}</part-list>{parts}</score-partwise>'
    )


def tempo(bpm):
    return f'<direction><sound tempo="{bpm}"/></direction>'


def test_linear_occurrences_keep_exact_written_and_performance_coordinates():
    xml = score(measure(0, duration=1), measure(1, duration=2)).replace(
        "<divisions>1", "<divisions>3"
    )
    model = parse_score_semantics(xml)
    projection = project_performance_occurrences(model)
    assert [(o.ordinal, o.measure_index, o.visit) for o in projection.occurrences] == [
        (0, 0, 1),
        (1, 1, 1),
    ]
    assert [
        (o.written_start, o.written_end, o.performance_start, o.performance_end)
        for o in projection.occurrences
    ] == [
        (Fraction(0), Fraction(1, 3), Fraction(0), Fraction(1, 3)),
        (Fraction(1, 3), Fraction(1), Fraction(1, 3), Fraction(1)),
    ]
    assert type(projection.end) is Fraction and projection.end == model.end == 1
    with pytest.raises(FrozenInstanceError):
        projection.occurrences[0].visit = 2


@pytest.mark.parametrize("times, plays", [(None, 2), (3, 3)])
@pytest.mark.parametrize("explicit_start", [False, True])
def test_simple_repeat_total_plays_and_visits(times, plays, explicit_start):
    model = parse_score_semantics(
        score(
            measure(0, bar("forward") if explicit_start else ""),
            measure(1, after=bar("backward", times=times)),
        )
    )
    result = project_performance_occurrences(model)
    assert [(o.measure_index, o.visit) for o in result.occurrences] == [
        (index, visit) for visit in range(1, plays + 1) for index in (0, 1)
    ]
    assert [o.ordinal for o in result.occurrences] == list(range(plays * 2))
    assert [o.performance_start for o in result.occurrences] == list(
        map(Fraction, range(0, plays * 8, 4))
    )
    assert result.end == plays * 8
    assert model.repeats[-1].times == times
    if explicit_start:
        assert model.repeats[0].times is None
        assert model.repeats[0].location == "left"


def test_sequential_repeat_contexts_close_independently():
    model = parse_score_semantics(
        score(
            measure(0, bar("forward")),
            measure(1, after=bar("backward")),
            measure(2, bar("forward")),
            measure(3, after=bar("backward", times=3)),
        )
    )
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
        0,
        1,
        0,
        1,
        2,
        3,
        2,
        3,
        2,
        3,
    ]


@pytest.mark.parametrize("second", ["none", "matching", "different", "partial"])
def test_score_wide_program_requires_agreement_between_annotated_parts(second):
    first = [measure(0, bar("forward")), measure(1, after=bar("backward")), measure(2)]
    other = {
        "none": [measure(i) for i in range(3)],
        "matching": first,
        "different": [measure(0), measure(1, bar("forward")), measure(2, after=bar("backward"))],
        "partial": [measure(0, bar("forward")), measure(1), measure(2)],
    }[second]
    model = parse_score_semantics(score(*first, second_part=other))
    if second in {"different", "partial"}:
        with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
            project_performance_occurrences(model)
    else:
        assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
            0,
            1,
            0,
            1,
            2,
        ]


def test_repeat_markup_in_later_part_is_score_wide_authority_too():
    model = parse_score_semantics(
        score(
            measure(0),
            measure(1),
            second_part=[measure(0, bar("forward")), measure(1, after=bar("backward"))],
        )
    )
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
        0,
        1,
        0,
        1,
    ]


@pytest.mark.parametrize(
    "measures",
    [
        [
            measure(0, bar("forward")),
            measure(1, bar("forward"), bar("backward")),
            measure(2, after=bar("backward")),
        ],
        [measure(0, after=bar("backward")), measure(1, after=bar("backward"))],
        [measure(0, bar("forward"))],
        [measure(0, bar("forward", location="middle")), measure(1, after=bar("backward"))],
        [measure(0, bar("forward", location="right")), measure(1, after=bar("backward"))],
        [measure(0, bar("forward")), measure(1, after=bar("backward", location="left"))],
        [measure(0, bar("forward")), measure(1, after=bar("backward", after_jump="yes"))],
        [measure(0, bar("forward") + bar("forward")), measure(1, after=bar("backward"))],
    ],
)
def test_unsupported_repeat_shapes_are_admitted_but_not_executed(measures):
    model = parse_score_semantics(admit_musicxml_document(score(*measures).encode()))
    with pytest.raises(PerformanceNavigationError):
        project_performance_occurrences(model)
    with pytest.raises(MetadataExtractionError):
        extract_musicxml_metadata(score(*measures))


def test_ending_facts_survive_admission_and_select_whole_measure_visits():
    xml = score(
        measure(0, bar("forward")),
        measure(1),
        measure(
            2,
            '<barline location="left"><ending number="1" type="start"/></barline>',
            '<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
        ),
        measure(
            3,
            '<barline location="left"><ending number="2" type="start"/></barline>',
            '<barline><ending number="2" type="discontinue"/></barline>',
        ),
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert [
        (e.part_index, e.measure_index, e.location, e.type, e.raw_number) for e in model.endings
    ] == [
        (0, 2, "left", "start", "1"),
        (0, 2, "right", "stop", "1"),
        (0, 3, "left", "start", "2"),
        (0, 3, "right", "discontinue", "2"),
    ]
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
        0,
        1,
        2,
        0,
        1,
        3,
    ]


@pytest.mark.parametrize(
    "attribute",
    [
        'dacapo="yes"',
        'dalsegno="s"',
        'segno="s"',
        'coda="c"',
        'tocoda="c"',
        'fine="yes"',
        'forward-repeat="yes"',
        'time-only="1,2"',
    ],
)
@pytest.mark.parametrize("nested", [False, True])
def test_sound_navigation_preserves_effective_playback_position_without_executing(
    attribute, nested
):
    sound = f"<sound {attribute}><offset>1</offset></sound>"
    markup = f'<direction><offset sound="yes">2</offset>{sound}</direction>' if nested else sound
    xml = score(measure(0, markup)).replace("<divisions>1", "<divisions>3")
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    fact = model.sound_navigation[0]
    assert fact.position == Fraction(1, 3)
    assert fact.part_index == fact.measure_index == 0
    assert dict(fact.attributes) == dict(ET.fromstring(f"<sound {attribute}/>").attrib)
    with pytest.raises(PerformanceNavigationError, match="unsupported_performance_navigation"):
        project_performance_occurrences(model)


def test_occurrence_mapping_owns_late_tempo_positions_and_boundary_selection():
    xml = score(
        measure(
            0,
            bar("forward")
            + '<direction><offset sound="yes">2</offset><sound tempo="90"/></direction>',
        ),
        measure(1, after=bar("backward")),
    )
    model = parse_score_semantics(xml)
    projection = project_performance_occurrences(model)
    assert projection.project_position(WrittenPoint(0, Fraction(2))) == (Fraction(2), Fraction(10))
    assert projection.project_position(WrittenPoint(1, Fraction(4))) == (Fraction(4), Fraction(12))
    assert tuple(
        (f.position, f.value)
        for f in projection.project_facts(
            [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
        )
    ) == (
        (Fraction(2), Fraction(90)),
        (Fraction(10), Fraction(90)),
    )
    with pytest.raises(PerformanceNavigationError):
        projection.project_position(WrittenPoint(0, Fraction(-1)))
    assert len(compile_practice_score(xml).notes) == 2


@pytest.mark.parametrize("reset, expected_ms", [(False, 18000), (True, 18600)])
def test_metadata_carries_tempo_across_repeat_jump_until_a_mark_reexecutes(reset, expected_ms):
    xml = score(
        measure(0, tempo(80)),
        measure(1, bar("forward") + (tempo(80) if reset else "")),
        measure(2, tempo(100)),
        measure(3, after=bar("backward")),
    )
    projection = project_performance_occurrences(parse_score_semantics(xml))
    assert [o.measure_index for o in projection.occurrences] == [0, 1, 2, 3, 1, 2, 3]
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected_ms


@pytest.mark.parametrize("times", [None, 3])
def test_real_verovio_is_a_simple_repeat_order_conformance_witness(times):
    xml = score(measure(0, bar("forward")), measure(1, after=bar("backward", times=times)))
    model = parse_score_semantics(xml)
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(xml)
    toolkit.renderToMIDI()
    order = [
        int(event["on"][0].split("-rend")[0][1:])
        for event in toolkit.renderToTimemap()
        if event.get("on")
    ]
    assert order == [o.measure_index for o in project_performance_occurrences(model).occurrences]


def test_written_repeat_preserves_default_location_count_and_after_jump():
    model = parse_score_semantics(
        score(
            measure(
                0,
                '<barline location="left"><repeat direction="forward"/></barline>',
                '<barline><repeat direction="backward" after-jump="no"/></barline>',
            )
        )
    )
    assert [(r.location, r.direction, r.times, r.after_jump) for r in model.repeats] == [
        ("left", "forward", None, None),
        ("right", "backward", None, False),
    ]
    with pytest.raises(PerformanceNavigationError):
        project_performance_occurrences(model)


@pytest.mark.parametrize(
    "markup",
    [
        "<direction><direction-type><segno/></direction-type></direction>",
        "<direction><direction-type><coda/></direction-type></direction>",
        "<barline><segno/></barline>",
        "<barline><coda/></barline>",
    ],
)
def test_navigation_symbols_are_preserved_and_not_silently_played_linearly(markup):
    xml = score(measure(0, markup))
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert len(model.navigation_markers) == 1
    with pytest.raises(PerformanceNavigationError, match="unsupported_performance_navigation"):
        project_performance_occurrences(model)


def test_late_tempo_in_repeated_second_measure_executes_at_each_occurrence():
    xml = score(
        measure(0),
        measure(
            1,
            bar("forward")
            + '<direction><offset sound="yes">2</offset><sound tempo="90"/></direction>',
        ),
        measure(2, after=bar("backward")),
    )
    model = parse_score_semantics(xml)
    projection = project_performance_occurrences(model)
    assert projection.project_position(WrittenPoint(1, Fraction(6))) == (Fraction(6), Fraction(14))
    assert tuple(
        (f.position, f.value)
        for f in projection.project_facts(
            [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
        )
    ) == (
        (Fraction(6), Fraction(90)),
        (Fraction(14), Fraction(90)),
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == 13833


def test_exact_duration_is_rounded_only_at_the_millisecond_boundary():
    xml = score(
        measure(0, tempo(90), duration=1), measure(1, after=bar("backward"), duration=1)
    ).replace("<divisions>1", "<divisions>3")
    projection = project_performance_occurrences(parse_score_semantics(xml))
    assert projection.end == Fraction(4, 3)
    assert extract_musicxml_metadata(xml).playback_duration_ms == 889


def test_projected_facts_at_end_execute_before_repeat_destination_facts():
    projection = project_performance_occurrences(
        parse_score_semantics(score(measure(0, bar("forward")), measure(1, after=bar("backward"))))
    )
    assert tuple(
        (f.position, f.value)
        for f in projection.project_facts(
            [
                WrittenPerformanceFact(WrittenPoint(0, Fraction(0)), "start"),
                WrittenPerformanceFact(WrittenPoint(1, Fraction(8)), "end"),
            ]
        )
    ) == (
        (Fraction(0), "start"),
        (Fraction(8), "end"),
        (Fraction(8), "start"),
        (Fraction(16), "end"),
    )
