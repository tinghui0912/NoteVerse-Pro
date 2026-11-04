"""Whole-measure volta traversal, fact encounters and renderer conformance."""

from fractions import Fraction
from dataclasses import replace

import pytest
import verovio

from app.processing.musicxml.admission import admit_musicxml_document
from app.core.exceptions import ValidationException
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.score_semantics.musicxml_score import MusicXMLSemanticError, parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint


def ending(number, kind, location=None):
    location = location or ("left" if kind == "start" else "right")
    return f'<barline location="{location}"><ending number="{number}" type="{kind}"/></barline>'


def repeat(direction, times=None):
    location = "left" if direction == "forward" else "right"
    count = f' times="{times}"' if times is not None else ""
    return f'<barline location="{location}"><repeat direction="{direction}"{count}/></barline>'


def close_repeat(number, times=None):
    count = f' times="{times}"' if times is not None else ""
    return f'<barline location="right"><ending number="{number}" type="stop"/><repeat direction="backward"{count}/></barline>'


def tempo(bpm):
    return f'<direction><sound tempo="{bpm}"/></direction>'


def measure(index, before="", after=""):
    attributes = (
        "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
        if index == 0
        else ""
    )
    return f'<measure number="{index + 1}">{attributes}{before}<note id="n{index}"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>{after}</measure>'


def score(measures, other=None):
    part_list = '<score-part id="P1"><part-name>Piano</part-name></score-part>'
    parts = '<part id="P1">' + "".join(measures) + "</part>"
    if other is not None:
        part_list += '<score-part id="P2"><part-name>Piano</part-name></score-part>'
        parts += '<part id="P2">' + "".join(other).replace('id="n', 'id="p2n') + "</part>"
    return (
        f'<score-partwise version="4.0"><part-list>{part_list}</part-list>{parts}</score-partwise>'
    )


def volta(
    *,
    times=2,
    implicit=False,
    common_tempo="",
    back_tempo="",
    exit_tempo="",
    endpoint_tempo="",
    close="discontinue",
):
    return [
        measure(0, ("" if implicit else repeat("forward")) + common_tempo),
        measure(
            1,
            ending("1" if times == 2 else "1,2", "start") + back_tempo,
            endpoint_tempo + close_repeat("1" if times == 2 else "1,2"),
        ),
        measure(2, ending(str(times), "start") + exit_tempo, ending(str(times), close)),
    ]


@pytest.mark.parametrize("times,order", [(2, [0, 1, 0, 2]), (3, [0, 1, 0, 1, 0, 2])])
def test_simple_volta_selects_occurrences_by_pass(times, order):
    model = parse_score_semantics(admit_musicxml_document(score(volta(times=times)).encode()))
    projection = project_performance_occurrences(model)
    assert [o.measure_index for o in projection.occurrences] == order
    assert projection.end == Fraction(len(order) * 4)
    assert projection.written_spans == tuple((m.start, m.end) for m in model.measures)
    assert [o.visit for o in projection.occurrences] == (
        [1, 1, 2, 1] if times == 2 else [1, 1, 2, 2, 3, 1]
    )


@pytest.mark.parametrize("plays", [2, 3])
def test_official_style_volta_derives_pass_count_without_repeat_times(plays):
    back = "1" if plays == 2 else "1,2"
    xml = score(
        [
            measure(0, repeat("forward")),
            measure(1),
            measure(2, ending(back, "start"), close_repeat(back, None)),
            measure(3, ending(str(plays), "start"), ending(str(plays), "discontinue")),
        ]
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == (
        [0, 1, 2] * (plays - 1) + [0, 1, 3]
    )
    assert model.repeats[-1].times is None


@pytest.mark.parametrize("reset,expected", [(False, 10200), (True, 11400)])
def test_tempo_state_follows_visited_endings_and_explicit_common_markings(reset, expected):
    xml = score(volta(common_tempo=tempo(80) if reset else "", back_tempo=tempo(100)))
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected


@pytest.mark.parametrize(
    "raw,passes",
    [
        ("1", (1,)),
        ("2", (2,)),
        ("3", (3,)),
        ("1,2", (1, 2)),
        ("1, 2", (1, 2)),
        ("2,1", (1, 2)),
        ("1,1", (1,)),
        ("", None),
        ("   ", None),
    ],
)
def test_written_ending_number_preserves_raw_fact_and_normalized_pass_set(raw, passes):
    xml = score([measure(0, ending(raw, "start"), ending(raw, "stop"))])
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert all(e.raw_number == raw and e.passes == passes for e in model.endings)


@pytest.mark.parametrize("raw", ["0", "01", "1-2", "1,,2", ",1", "1,", "-1", "1.0", "1,0", "one"])
def test_malformed_ending_number_is_a_fact_lexical_error(raw):
    xml = score([measure(0, ending(raw, "start"), ending(raw, "stop"))])
    with pytest.raises(MusicXMLSemanticError, match="invalid_ending_number"):
        parse_score_semantics(xml)
    with pytest.raises(ValidationException):
        admit_musicxml_document(xml.encode())


@pytest.mark.parametrize("implicit", [False, True])
@pytest.mark.parametrize("close", ["stop", "discontinue"])
def test_first_repeat_default_count_and_implicit_origin_with_volta(implicit, close):
    xml = score(volta(implicit=implicit, close=close))
    assert [
        o.measure_index
        for o in project_performance_occurrences(parse_score_semantics(xml)).occurrences
    ] == [0, 1, 0, 2]


def test_sequential_volta_contexts_continue_after_each_final_exit():
    xml = score(
        volta()
        + [
            measure(3, repeat("forward")),
            measure(4, ending("1", "start"), close_repeat("1")),
            measure(5, ending("2", "start"), ending("2", "stop")),
        ]
    )
    assert [
        o.measure_index
        for o in project_performance_occurrences(parse_score_semantics(xml)).occurrences
    ] == [0, 1, 0, 2, 3, 4, 3, 5]


def test_multi_measure_ending_spans_and_following_linear_continuation():
    xml = score(
        [
            measure(0, repeat("forward")),
            measure(1, ending("1", "start")),
            measure(2, after=close_repeat("1")),
            measure(3, ending("2", "start")),
            measure(4, after=ending("2", "discontinue")),
            measure(5),
        ]
    )
    assert [
        o.measure_index
        for o in project_performance_occurrences(parse_score_semantics(xml)).occurrences
    ] == [0, 1, 2, 0, 3, 4, 5]


@pytest.mark.parametrize("opinion", ["none", "matching", "repeat-only", "different-ending"])
def test_repeat_and_ending_programs_are_normalized_together_across_parts(opinion):
    first = volta(times=3)
    other = {
        "none": [measure(i) for i in range(3)],
        "matching": [
            m.replace('number="1,2"', 'number="1, 2"').replace('type="discontinue"', 'type="stop"')
            for m in first
        ],
        "repeat-only": [
            measure(0, repeat("forward")),
            measure(1, after=repeat("backward", 3)),
            measure(2),
        ],
        "different-ending": [m.replace('number="3" type=', 'number="2" type=') for m in first],
    }[opinion]
    model = parse_score_semantics(admit_musicxml_document(score(first, other).encode()))
    if opinion in {"repeat-only", "different-ending"}:
        with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
            project_performance_occurrences(model)
    else:
        assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
            0,
            1,
            0,
            1,
            0,
            2,
        ]


def test_later_part_can_supply_the_complete_volta_program():
    model = parse_score_semantics(score([measure(i) for i in range(3)], volta()))
    assert [o.measure_index for o in project_performance_occurrences(model).occurrences] == [
        0,
        1,
        0,
        2,
    ]


@pytest.mark.parametrize("times", [2, 3, 4])
def test_repeat_times_on_ending_is_preserved_but_not_executed(times):
    xml = score(volta(times=3)).replace(
        '<repeat direction="backward"/>', f'<repeat direction="backward" times="{times}"/>'
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert model.repeats[-1].times == times
    with pytest.raises(PerformanceNavigationError, match="repeat_times_with_ending"):
        project_performance_occurrences(model)


def test_parts_cannot_agree_by_replacing_source_times_with_inferred_volta_count():
    first = volta(times=3)
    second = [
        m.replace('<repeat direction="backward"/>', '<repeat direction="backward" times="3"/>')
        for m in first
    ]
    model = parse_score_semantics(admit_musicxml_document(score(first, second).encode()))
    assert [r.times for r in model.repeats if r.direction == "backward"] == [None, 3]
    with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
        project_performance_occurrences(model)


@pytest.mark.parametrize(
    "back,final,times",
    [
        ("", "2", 2),
        ("   ", "2", 2),
        ("1", "3", 2),
        ("1,2", "2", 2),
        ("1", "3", 3),
        ("1,3", "2", 3),
        ("1,3", "4", 3),
        ("1", "2,3", 2),
        ("1", "1", 2),
    ],
)
def test_unknown_or_incomplete_or_overlapping_pass_coverage_is_not_guessed(back, final, times):
    xml = score(volta(times=times))
    old_back = "1" if times == 2 else "1,2"
    xml = xml.replace(f'number="{old_back}" type=', f'number="{back}" type=').replace(
        f'number="{times}" type=', f'number="{final}" type='
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError):
        project_performance_occurrences(model)
    with pytest.raises(MetadataExtractionError):
        extract_musicxml_metadata(xml)


@pytest.mark.parametrize(
    "measures",
    [
        [measure(0, ending("1", "start"))],
        [measure(0, after=ending("1", "stop"))],
        [measure(0, ending("1", "start"), ending("2", "stop"))],
        [
            measure(0, ending("1", "start")),
            measure(1, ending("2", "start"), ending("2", "stop")),
            measure(2, after=ending("1", "stop")),
        ],
        [measure(0, ending("1", "start") + ending("1", "start"), ending("1", "stop"))],
        [measure(0, ending("1", "start"), ending("1", "stop") + ending("1", "stop"))],
        [measure(0, ending("1", "start"), ending("1", "stop"))],
        [
            measure(0, repeat("forward")),
            measure(1, ending("1", "start"), close_repeat("1")),
            measure(2),
            measure(3, ending("2", "start"), ending("2", "stop")),
        ],
        volta() + [measure(3, ending("3", "start"), ending("3", "stop"))],
        [
            measure(0, repeat("forward")),
            measure(1, ending("1", "start"), close_repeat("1")),
            measure(2, ending("2", "start"), close_repeat("2")),
        ],
    ],
)
def test_unsupported_span_pairings_and_complex_groups_remain_admissible(measures):
    model = parse_score_semantics(admit_musicxml_document(score(measures).encode()))
    with pytest.raises(PerformanceNavigationError):
        project_performance_occurrences(model)


@pytest.mark.parametrize(
    "kind,location",
    [("start", "right"), ("start", "middle"), ("stop", "left"), ("discontinue", "middle")],
)
def test_non_whole_measure_ending_boundaries_are_explicitly_unsupported(kind, location):
    xml = (
        score(volta()).replace(
            ending("1" if kind == "start" else "2", kind),
            ending("1" if kind == "start" else "2", kind, location),
        )
        if kind in {"start", "discontinue"}
        else score([measure(0, ending("1", "start"), ending("1", "stop", location))])
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match="unsupported_ending_boundary"):
        project_performance_occurrences(model)


def test_endpoint_fact_precedes_jump_and_final_ending_start_only_executes_on_entry():
    xml = score(volta(endpoint_tempo=tempo(100), exit_tempo=tempo(60)))
    model = parse_score_semantics(xml)
    assert [(t.measure_index, t.position) for t in model.tempos] == [
        (1, Fraction(8)),
        (2, Fraction(8)),
    ]
    projection = project_performance_occurrences(model)
    facts = projection.project_facts([WrittenPerformanceFact(t.point, t) for t in model.tempos])
    assert [(f.position, f.value.quarter_bpm) for f in facts] == [(8, 100), (12, 60)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 12400


def test_common_and_ending_facts_replay_only_on_their_own_visits():
    model = parse_score_semantics(
        score(volta(times=3, common_tempo=tempo(80), back_tempo=tempo(100), exit_tempo=tempo(90)))
    )
    projection = project_performance_occurrences(model)
    facts = projection.project_facts([WrittenPerformanceFact(t.point, t) for t in model.tempos])
    assert [(f.position, f.value.quarter_bpm) for f in facts] == [
        (0, 80),
        (4, 100),
        (8, 80),
        (12, 100),
        (16, 80),
        (20, 90),
    ]


def test_complete_written_spans_are_independent_of_visited_occurrences():
    model = parse_score_semantics(score(volta()))
    projection = project_performance_occurrences(model)
    assert projection.written_spans == (
        (Fraction(0), Fraction(4)),
        (Fraction(4), Fraction(8)),
        (Fraction(8), Fraction(12)),
    )
    partial = replace(projection, occurrences=projection.occurrences[:1])
    assert partial.project_position(WrittenPoint(2, Fraction(9))) == ()
    assert partial.written_spans == projection.written_spans


def test_practice_keeps_written_notes_once_without_selecting_volta_branches():
    compiled = compile_practice_score(score(volta()))
    assert len(compiled.notes) == 3
    assert [m.start_beat for m in compiled.measures] == [0, 4, 8]


@pytest.mark.parametrize("navigation", ['dacapo="yes"', 'dalsegno="s"'])
def test_volta_does_not_enable_jump_execution(navigation):
    xml = score(volta(common_tempo=f"<sound {navigation}/>"))
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match="unsupported_jump_repeat_interaction"):
        project_performance_occurrences(model)


def test_volta_does_not_enable_after_jump_repeat_behavior():
    xml = score(volta()).replace('direction="backward"', 'direction="backward" after-jump="yes"')
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match="unsupported_performance_navigation"):
        project_performance_occurrences(model)


@pytest.mark.parametrize("times", [2, 3])
def test_real_verovio_simple_volta_conformance(times):
    back = "1" if times == 2 else "1,2"
    xml = score(
        [
            measure(0, repeat("forward")),
            measure(1),
            measure(2, ending(back, "start"), close_repeat(back)),
            measure(3, ending(str(times), "start"), ending(str(times), "discontinue")),
        ]
    )
    model = parse_score_semantics(xml)
    toolkit = verovio.toolkit()
    assert model.repeats[-1].times is None
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(xml)
    toolkit.renderToMIDI()
    events = [e for e in toolkit.renderToTimemap() if e.get("on")]
    rendered = [int(e["on"][0].split("-rend")[0][1:]) for e in events]
    domain = [o.measure_index for o in project_performance_occurrences(model).occurrences]
    assert rendered == domain
    assert [Fraction(str(e["qstamp"])) for e in events] == [
        o.performance_start for o in project_performance_occurrences(model).occurrences
    ]
