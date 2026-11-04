"""Explicit per-region repeat policy on exact pre/post-primary traversal legs."""

from fractions import Fraction

import pytest
import verovio

from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import MetadataExtractionError, extract_musicxml_metadata
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint


def sound(attributes):
    return f"<sound {attributes}/>"


def repeat(direction, policy=None, times=None):
    location = "left" if direction == "forward" else "right"
    attrs = (f' after-jump="{policy}"' if policy is not None else "") + (
        f' times="{times}"' if times is not None else ""
    )
    return f'<barline location="{location}"><repeat direction="{direction}"{attrs}/></barline>'


def measure(index, events=None):
    events = events or {}
    attributes = (
        "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
        if index == 0
        else ""
    )
    body = "".join(
        events.get(q, "")
        + f'<note id="n{index}_{q}"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>'
        for q in range(4)
    ) + events.get(4, "")
    return f'<measure id="m{index}" number="{index + 1}">{attributes}{body}</measure>'


def score(measures, other=None):
    names = '<score-part id="P1"><part-name>Piano</part-name></score-part>'
    parts = '<part id="P1">' + "".join(measures) + "</part>"
    if other is not None:
        names += '<score-part id="P2"><part-name>Piano</part-name></score-part>'
        parts += (
            '<part id="P2">'
            + "".join(other).replace('id="n', 'id="p2n').replace('id="m', 'id="p2m')
            + "</part>"
        )
    return f'<score-partwise version="4.0"><part-list>{names}</part-list>{parts}</score-partwise>'


def jump_measures(policy=None, times=None, kind="dc"):
    return [
        measure(0, {0: repeat("forward") + (sound('segno="S1"') if kind == "ds" else "")}),
        measure(1, {4: repeat("backward", policy, times)}),
        measure(2, {2: sound('fine="yes"')}),
        measure(3, {2: sound('dacapo="yes"' if kind == "dc" else 'dalsegno="S1"')}),
    ]


def projection(xml):
    return project_performance_occurrences(
        parse_score_semantics(admit_musicxml_document(xml.encode()))
    )


def intervals(result):
    return [(o.measure_index, o.visit, o.written_start, o.written_end) for o in result.occurrences]


@pytest.mark.parametrize("kind", ["dc", "ds"])
@pytest.mark.parametrize("policy,total,duration", [("yes", 40, 30000), ("no", 32, 24000)])
def test_explicit_post_jump_policy_changes_only_the_post_primary_repeat_count(
    kind, policy, total, duration
):
    xml = score(jump_measures(policy, kind=kind))
    result = projection(xml)
    expected_order = [0, 1, 0, 1, 2, 3] + ([0, 1, 0, 1, 2] if policy == "yes" else [0, 1, 2])
    visits = {}
    expected = []
    for index in expected_order:
        visits[index] = visits.get(index, 0) + 1
        end = 14 if index == 3 else 10 if index == 2 and visits[index] == 2 else index * 4 + 4
        expected.append((index, visits[index], index * 4, end))
    assert intervals(result) == expected
    assert result.end == Fraction(total)
    assert extract_musicxml_metadata(xml).playback_duration_ms == duration
    assert len(compile_practice_score(xml).notes) == 16


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_reachable_post_jump_repeat_with_absent_policy_is_ambiguous(kind):
    xml = score(jump_measures(kind=kind))
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert model.repeats[-1].after_jump is None
    with pytest.raises(PerformanceNavigationError, match="ambiguous_repeat_after_jump"):
        project_performance_occurrences(model)
    with pytest.raises(MetadataExtractionError, match="ambiguous_repeat_after_jump"):
        extract_musicxml_metadata(xml)


@pytest.mark.parametrize("policy", ["yes", "no"])
@pytest.mark.parametrize("times,plays", [(None, 2), (3, 3)])
def test_no_jump_repeat_ignores_post_jump_policy(policy, times, plays):
    xml = score(
        [measure(0, {0: repeat("forward")}), measure(1, {4: repeat("backward", policy, times)})]
    )
    assert [o.measure_index for o in projection(xml).occurrences] == [0, 1] * plays
    assert extract_musicxml_metadata(xml).playback_duration_ms == 6000 * plays


@pytest.mark.parametrize("policy,passes,total", [("yes", 6, 56), ("no", 4, 40)])
def test_times_three_is_used_only_when_the_repeat_is_active(policy, passes, total):
    result = projection(score(jump_measures(policy, times=3)))
    assert [o.measure_index for o in result.occurrences].count(0) == passes
    assert [o.measure_index for o in result.occurrences].count(1) == passes
    assert result.end == total


def test_repeat_before_ds_target_needs_no_unencountered_post_jump_policy():
    measures = jump_measures(kind="ds")
    measures[0] = measure(0, {0: repeat("forward")})
    measures[2] = measure(2, {0: sound('segno="S1"'), 2: sound('fine="yes"')})
    xml = score(measures)
    result = projection(xml)
    assert [o.measure_index for o in result.occurrences] == [0, 1, 0, 1, 2, 3, 2]
    assert result.end == 24
    assert extract_musicxml_metadata(xml).playback_duration_ms == 18000


@pytest.mark.parametrize("policy,expected", [("yes", 33000), ("no", 27000)])
def test_ds_target_at_non_origin_forward_boundary_can_enter_the_complete_repeat(policy, expected):
    xml = score(
        [
            measure(0),
            measure(1, {0: repeat("forward") + sound('segno="S1"')}),
            measure(2, {4: repeat("backward", policy)}),
            measure(3, {2: sound('fine="yes"')}),
            measure(4, {2: sound('dalsegno="S1"')}),
        ]
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected


def test_ds_target_before_repeat_start_keeps_its_partial_prefix_and_complete_repeat():
    xml = score(
        [
            measure(0, {1: sound('segno="S1"')}),
            measure(1, {0: repeat("forward")}),
            measure(2, {4: repeat("backward", "yes")}),
            measure(3, {2: sound('fine="yes"')}),
            measure(4, {2: sound('dalsegno="S1"')}),
        ]
    )
    result = projection(xml)
    assert intervals(result)[7] == (0, 2, 1, 4)
    assert result.end == 47
    assert extract_musicxml_metadata(xml).playback_duration_ms == 35250


def test_sequential_contexts_keep_individual_post_jump_policies():
    xml = score(
        [
            measure(0, {0: repeat("forward")}),
            measure(1, {4: repeat("backward", "yes")}),
            measure(2, {0: repeat("forward")}),
            measure(3, {4: repeat("backward", "no")}),
            measure(4, {2: sound('fine="yes"')}),
            measure(5, {2: sound('dacapo="yes"')}),
        ]
    )
    result = projection(xml)
    assert [o.measure_index for o in result.occurrences] == [
        0,
        1,
        0,
        1,
        2,
        3,
        2,
        3,
        4,
        5,
        0,
        1,
        0,
        1,
        2,
        3,
        4,
    ]
    assert result.end == 64
    assert extract_musicxml_metadata(xml).playback_duration_ms == 48000


@pytest.mark.parametrize("policy,total", [("yes", 44), ("no", 36), (None, None)])
def test_post_primary_repeat_before_tocoda_uses_after_jump(policy, total):
    xml = score(
        [
            measure(0, {0: repeat("forward")}),
            measure(1, {4: repeat("backward", policy)}),
            measure(2, {2: sound('tocoda="C1"')}),
            measure(3, {2: sound('dacapo="yes"')}),
            measure(4, {0: sound('coda="C1"')}),
        ]
    )
    if total is None:
        with pytest.raises(PerformanceNavigationError, match="ambiguous_repeat_after_jump"):
            projection(xml)
    else:
        assert projection(xml).end == total
        assert extract_musicxml_metadata(xml).playback_duration_ms == total * 750


@pytest.mark.parametrize("policy,total", [("yes", 36), ("no", 28), (None, None)])
def test_post_coda_repeat_keeps_after_primary_phase(policy, total):
    xml = score(
        [
            measure(0),
            measure(1, {2: sound('tocoda="C1"')}),
            measure(2),
            measure(3, {2: sound('dacapo="yes"')}),
            measure(4, {0: repeat("forward") + sound('coda="C1"')}),
            measure(5, {4: repeat("backward", policy)}),
        ]
    )
    if total is None:
        with pytest.raises(PerformanceNavigationError, match="ambiguous_repeat_after_jump"):
            projection(xml)
    else:
        assert projection(xml).end == total


@pytest.mark.parametrize(
    "role", ["primary-source", "fine", "ds-target", "tocoda-source", "coda-target"]
)
def test_control_points_strictly_inside_repeat_regions_remain_unsupported(role):
    measures = jump_measures("yes")
    if role == "primary-source":
        measures[1] = measure(1, {1: sound('dacapo="yes"'), 4: repeat("backward", "yes")})
        measures[3] = measure(3)
    elif role == "fine":
        measures[1] = measure(1, {2: sound('fine="yes"'), 4: repeat("backward", "yes")})
        measures[2] = measure(2)
    elif role == "ds-target":
        measures[0] = measure(0, {0: repeat("forward"), 1: sound('segno="S1"')})
        measures[3] = measure(3, {2: sound('dalsegno="S1"')})
    elif role == "tocoda-source":
        measures[1] = measure(1, {2: sound('tocoda="C1"'), 4: repeat("backward", "yes")})
        measures[2] = measure(2)
        measures.append(measure(4, {1: sound('coda="C1"')}))
    else:
        measures = [
            measure(0),
            measure(1, {2: sound('tocoda="C1"')}),
            measure(2),
            measure(3, {0: repeat("forward")}),
            measure(4, {1: sound('coda="C1"'), 4: repeat("backward", "no")}),
            measure(5, {2: sound('dacapo="yes"')}),
        ]
    xml = score(measures)
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(
        PerformanceNavigationError, match="unsupported_partial_repeat_jump_interaction"
    ):
        project_performance_occurrences(model)


def test_primary_at_backward_repeat_endpoint_is_ambiguous():
    measures = jump_measures("yes")
    measures[1] = measure(1, {4: repeat("backward", "yes") + sound('dacapo="yes"')})
    measures[3] = measure(3)
    with pytest.raises(PerformanceNavigationError, match="ambiguous_jump_repeat_boundary"):
        projection(score(measures))


def test_primary_at_next_measure_start_is_after_the_completed_repeat():
    measures = jump_measures("yes")
    measures[2] = measure(2, {0: sound('dacapo="yes"'), 2: sound('fine="yes"')})
    measures[3] = measure(3)
    xml = score(measures)
    result = projection(xml)
    assert (2, 1, Fraction(8), Fraction(8)) in intervals(result)
    assert result.end == 34
    assert result.project_position(WrittenPoint(2, Fraction(8))) == (Fraction(16), Fraction(32))
    assert extract_musicxml_metadata(xml).playback_duration_ms == 25500


def test_post_jump_leg_ending_at_forward_boundary_has_not_encountered_backward_repeat():
    measures = jump_measures()
    measures[0] = measure(0, {0: repeat("forward") + sound('fine="yes"')})
    measures[2] = measure(2)
    result = projection(score(measures))
    assert result.end == 22
    assert intervals(result)[-1] == (0, 3, 0, 0)


@pytest.mark.parametrize(
    "opinion", ["none", "same", "repeat-only", "jump-only", "different-policy", "different-times"]
)
def test_annotated_parts_must_agree_on_the_complete_jump_and_repeat_program(opinion):
    first = jump_measures("yes", kind="ds")
    no_repeats = [
        m.replace(repeat("forward"), "").replace(repeat("backward", "yes"), "") for m in first
    ]
    other = {
        "none": [measure(i) for i in range(4)],
        "same": [
            m.replace('<sound segno="S1"/>', '<barline location="left" segno="S1"/>').replace(
                'dalsegno="S1"', 'dalsegno="S1" time-only="1"'
            )
            for m in first
        ],
        "repeat-only": [
            measure(0, {0: repeat("forward")}),
            measure(1, {4: repeat("backward", "yes")}),
            measure(2),
            measure(3),
        ],
        "jump-only": no_repeats,
        "different-policy": jump_measures("no", kind="ds"),
        "different-times": jump_measures("yes", times=3, kind="ds"),
    }[opinion]
    xml = score(first, other)
    if opinion in {"none", "same"}:
        assert intervals(projection(xml)) == intervals(projection(score(first)))
    else:
        model = parse_score_semantics(admit_musicxml_document(xml.encode()))
        with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
            project_performance_occurrences(model)


def test_jump_only_and_repeat_only_parts_are_not_stitched():
    first = jump_measures("yes")
    first = [m.replace(repeat("forward"), "").replace(repeat("backward", "yes"), "") for m in first]
    other = [
        measure(0, {0: repeat("forward")}),
        measure(1, {4: repeat("backward", "yes")}),
        measure(2),
        measure(3),
    ]
    with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
        projection(score(first, other))


@pytest.mark.parametrize(
    "policy,reset,expected",
    [("yes", False, 24900), ("no", False, 20100), ("yes", True, 27600), ("no", True, 21900)],
)
def test_tempo_carries_until_an_actual_repeat_start_fact_reexecutes(policy, reset, expected):
    measures = jump_measures(policy)
    measures[0] = measure(0, {0: repeat("forward") + (sound('tempo="80"') if reset else "")})
    measures[1] = measure(1, {2: sound('tempo="100"'), 4: repeat("backward", policy)})
    xml = score(measures)
    model = parse_score_semantics(xml)
    facts = project_performance_occurrences(model).project_facts(
        [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
    )
    assert [f.position for f in facts if f.value == 100] == (
        [6, 14, 28, 36] if policy == "yes" else [6, 14, 28]
    )
    assert [f.position for f in facts if f.value == 80] == (
        ([0, 8, 22, 30] if policy == "yes" else [0, 8, 22]) if reset else []
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected


@pytest.mark.parametrize("policy", ["yes", "no"])
def test_forward_barline_after_jump_is_preserved_but_not_executable(policy):
    xml = score([measure(0, {0: repeat("forward", policy)}), measure(1, {4: repeat("backward")})])
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match="unsupported_repeat_after_jump_placement"):
        project_performance_occurrences(model)


def test_gated_tempo_remains_unsupported():
    xml = score(jump_measures("yes")).replace(
        '<note id="n0_0">', sound('tempo="100" time-only="2"') + '<note id="n0_0">'
    )
    with pytest.raises(PerformanceNavigationError, match="unsupported_time_only_playback"):
        projection(xml)


@pytest.mark.parametrize("policy", ["yes", "no"])
def test_real_verovio_post_jump_repeat_witness(policy):
    xml = score(jump_measures(policy))
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(admit_musicxml_document(xml.encode()).decode())
    toolkit.renderToMIDI()
    timing = toolkit.renderToTimemap({"includeMeasures": True})
    rendered = [
        int(e["on"][0].split("-rend")[0][1:].split("_")[0])
        for e in timing
        if e.get("on") and e["on"][0].split("-rend")[0].endswith("_0")
    ]
    result = projection(xml)
    assert rendered == [o.measure_index for o in result.occurrences]
    # Verovio honors the per-repeat policy, but rounds these mid-measure
    # D.C./Fine cutoffs to full measures. Domain coordinates remain exact.
    assert max(e["qstamp"] for e in timing) == (44 if policy == "yes" else 36)
    assert result.end == (40 if policy == "yes" else 32)
