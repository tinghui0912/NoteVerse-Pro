"""Representation-neutral repeat starts with exact source ownership."""

from tests.support.performance_plan import performed_duration_ms

from fractions import Fraction

import pytest
from tests.support.canonical_musicxml import INVISIBLE, VISIBLE, backward, measure, score, sound
import verovio

from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.processing.musicxml.admission import admit_musicxml_document
from app.processing.musicxml.metadata import extract_musicxml_metadata
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_navigation import (
    PerformanceNavigationError,
    WrittenPerformanceFact,
    project_performance_occurrences,
)
from app.score_semantics.written_point import WrittenPoint


def admitted(xml):
    return parse_score_semantics(admit_musicxml_document(xml.encode()))


def projection(xml):
    return project_performance_occurrences(admitted(xml))


def jump_score(start=INVISIBLE, policy=None, kind="dc", times=None):
    return score(
        [
            measure(0, {0: start + (sound('segno="S1"') if kind == "ds" else "")}),
            measure(1, {4: backward(policy, times)}),
            measure(2, {2: sound('fine="yes"')}),
            measure(3, {2: sound('dacapo="yes"' if kind == "dc" else 'dalsegno="S1"')}),
        ]
    )


@pytest.mark.parametrize("times,plays", [(None, 2), (3, 3)])
@pytest.mark.parametrize("policy", [None, "yes", "no"])
def test_no_jump_invisible_start_matches_visible_repeat(times, plays, policy):
    xml = score([measure(0, {0: INVISIBLE}), measure(1, {4: backward(policy, times)})])
    explicit = xml.replace(INVISIBLE, VISIBLE)
    result = projection(xml)
    assert result == projection(explicit)
    assert [o.measure_index for o in result.occurrences] == [0, 1] * plays
    assert performed_duration_ms(xml) == 6000 * plays
    assert len(compile_practice_score(xml).notes) == 8


@pytest.mark.parametrize("kind", ["dc", "ds"])
@pytest.mark.parametrize("policy,duration", [("yes", 30000), ("no", 24000)])
def test_post_jump_invisible_context_is_the_same_program(kind, policy, duration):
    xml = jump_score(policy=policy, kind=kind)
    assert projection(xml) == projection(jump_score(VISIBLE, policy, kind))
    assert performed_duration_ms(xml) == duration


@pytest.mark.parametrize("markup", [VISIBLE + INVISIBLE, INVISIBLE * 2, VISIBLE + INVISIBLE * 2])
def test_duplicate_representations_collapse_only_in_performance(markup):
    xml = score([measure(0, {0: markup}), measure(1, {4: backward()})])
    model = admitted(xml)
    assert sum(f.forward_repeat for f in model.playback_navigation) == markup.count(INVISIBLE)
    assert project_performance_occurrences(model) == projection(xml.replace(markup, VISIBLE))


@pytest.mark.parametrize("kind", [None, "dc"])
def test_parts_agree_across_visible_and_invisible_representation(kind):
    first = [measure(0, {0: VISIBLE}), measure(1, {4: backward("yes")})]
    if kind:
        first += [measure(2, {2: sound('fine="yes"')}), measure(3, {2: sound('dacapo="yes"')})]
    other = [m.replace(VISIBLE, INVISIBLE) for m in first]
    assert projection(score(first, other)) == projection(score(first))


@pytest.mark.parametrize("label", ['segno="S1"', 'coda="C1"'])
def test_destination_metadata_and_invisible_start_share_one_source_event(label):
    xml = score(
        [measure(0, {0: sound(f'forward-repeat="yes" {label}')}), measure(1, {4: backward()})]
    )
    fact = admitted(xml).playback_navigation[0]
    assert fact.forward_repeat and fact.point == WrittenPoint(0, Fraction(0))
    assert fact.segno == ("S1" if label.startswith("segno") else None)
    assert fact.coda == ("C1" if label.startswith("coda") else None)
    assert projection(xml).end == 16


@pytest.mark.parametrize("policy,duration", [("yes", 30000), ("no", 24000)])
def test_ds_can_enter_exact_invisible_start_with_destination_on_same_sound(policy, duration):
    xml = jump_score(sound('forward-repeat="yes" segno="S1"'), policy, "ds")
    assert performed_duration_ms(xml) == duration
    assert projection(xml) == projection(jump_score(VISIBLE, policy, "ds"))


def test_semantic_region_agreement_includes_an_implicit_origin_start():
    first = [measure(0, {0: INVISIBLE}), measure(1, {4: backward()})]
    other = [m.replace(INVISIBLE, "") for m in first]
    assert projection(score(first, other)) == projection(score(first))


def test_invisible_repeat_retains_fractional_axes():
    xml = score([measure(0, {0: INVISIBLE}), measure(1, {4: backward()})]).replace(
        "<divisions>1", "<divisions>3"
    )
    result = projection(xml)
    assert result.end == Fraction(16, 3)
    assert result.occurrences[1].written_start == Fraction(4, 3)
    assert projection(xml.replace(INVISIBLE, VISIBLE)) == result


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_reachable_missing_post_jump_policy_is_not_filled_in(kind):
    xml = jump_score(kind=kind)
    with pytest.raises(PerformanceNavigationError, match="ambiguous_repeat_after_jump"):
        projection(xml)
    assert extract_musicxml_metadata(xml).measure_count > 0


def test_invisible_repeat_before_ds_target_needs_no_post_jump_policy():
    xml = score(
        [
            measure(0, {0: INVISIBLE}),
            measure(1, {4: backward()}),
            measure(2, {0: sound('segno="S1"'), 2: sound('fine="yes"')}),
            measure(3, {2: sound('dalsegno="S1"')}),
        ]
    )
    assert projection(xml) == projection(xml.replace(INVISIBLE, VISIBLE))
    assert performed_duration_ms(xml) == 18000


@pytest.mark.parametrize("after_coda", [False, True])
@pytest.mark.parametrize("policy", ["yes", "no", None])
def test_invisible_context_uses_the_same_phase_before_and_after_coda(after_coda, policy):
    measures = [
        measure(0, {0: INVISIBLE} if not after_coda else None),
        measure(1, {2: sound('tocoda="C1"')} if after_coda else {4: backward(policy)}),
        measure(2, None if after_coda else {2: sound('tocoda="C1"')}),
        measure(3, {2: sound('dacapo="yes"')}),
        measure(4, {0: sound('coda="C1"') + (INVISIBLE if after_coda else "")}),
    ]
    if after_coda:
        measures.append(measure(5, {4: backward(policy)}))
    xml = score(measures)
    if policy is None:
        with pytest.raises(PerformanceNavigationError, match="ambiguous_repeat_after_jump"):
            projection(xml)
    else:
        assert projection(xml) == projection(xml.replace(INVISIBLE, VISIBLE))
        assert projection(xml).end == (
            (36 if policy == "yes" else 28) if after_coda else (44 if policy == "yes" else 36)
        )


@pytest.mark.parametrize(
    "variant",
    [
        "start-only/backward-only",
        "complete/start-only",
        "different-start",
        "different-times",
        "different-policy",
    ],
)
def test_annotated_parts_cannot_stitch_or_disagree(variant):
    complete = [measure(0, {0: INVISIBLE}), measure(1), measure(2, {4: backward("yes")})]
    first = complete
    other = {
        "start-only/backward-only": [measure(0), measure(1), measure(2, {4: backward()})],
        "complete/start-only": [measure(0, {0: INVISIBLE}), measure(1), measure(2)],
        "different-start": [measure(0), measure(1, {0: VISIBLE}), measure(2, {4: backward("yes")})],
        "different-times": [
            measure(0, {0: VISIBLE}),
            measure(1),
            measure(2, {4: backward("yes", 3)}),
        ],
        "different-policy": [measure(0, {0: VISIBLE}), measure(1), measure(2, {4: backward("no")})],
    }[variant]
    if variant == "start-only/backward-only":
        first = [measure(0, {0: INVISIBLE}), measure(1), measure(2)]
    with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
        projection(score(first, other))


@pytest.mark.parametrize("start", [VISIBLE, INVISIBLE])
def test_different_start_points_before_one_close_are_not_duplicates(start):
    xml = score([measure(0, {0: start}), measure(1, {0: INVISIBLE}), measure(2, {4: backward()})])
    with pytest.raises(PerformanceNavigationError, match="unsupported_nested_repeat"):
        projection(xml)


def test_unclosed_invisible_start_is_admissible_but_not_executable():
    with pytest.raises(PerformanceNavigationError, match="unclosed_repeat"):
        projection(score([measure(0, {0: INVISIBLE})]))


@pytest.mark.parametrize(
    "passes,final,order", [("1", "2", [0, 1, 0, 2]), ("1,2", "3", [0, 1, 0, 1, 0, 2])]
)
def test_standalone_simple_volta_accepts_the_same_normalized_start(passes, final, order):
    xml = score(
        [
            measure(0, {0: INVISIBLE}),
            measure(
                1,
                {
                    0: f'<barline location="left"><ending number="{passes}" type="start"/></barline>',
                    4: f'<barline location="right"><ending number="{passes}" type="stop"/><repeat direction="backward"/></barline>',
                },
            ),
            measure(
                2,
                {
                    0: f'<barline location="left"><ending number="{final}" type="start"/></barline>',
                    4: f'<barline location="right"><ending number="{final}" type="discontinue"/></barline>',
                },
            ),
        ]
    )
    assert [o.measure_index for o in projection(xml).occurrences] == order
    assert projection(xml) == projection(xml.replace(INVISIBLE, VISIBLE))


@pytest.mark.parametrize("predicate", ["1", "2", "1,2"])
def test_gated_repeat_start_is_not_static_even_for_pass_one(predicate):
    xml = score(
        [
            measure(0, {0: sound(f'forward-repeat="yes" time-only="{predicate}"')}),
            measure(1, {4: backward()}),
        ]
    )
    assert admitted(xml).playback_navigation[0].time_only is not None
    with pytest.raises(PerformanceNavigationError, match="unsupported_forward_repeat_time_only"):
        projection(xml)


@pytest.mark.parametrize("position", [1, 4])
def test_mid_measure_and_previous_endpoint_starts_keep_source_ownership(position):
    xml = score([measure(0, {position: INVISIBLE}), measure(1, {4: backward()})])
    assert admitted(xml).playback_navigation[0].point == WrittenPoint(0, Fraction(position))
    with pytest.raises(PerformanceNavigationError, match="unsupported_forward_repeat_position"):
        projection(xml)


def test_sound_owned_offset_does_not_turn_an_interior_start_into_a_whole_measure_start():
    xml = score(
        [
            measure(0, {0: '<sound forward-repeat="yes"><offset>1</offset></sound>'}),
            measure(1, {4: backward()}),
        ]
    )
    with pytest.raises(PerformanceNavigationError, match="unsupported_forward_repeat_position"):
        projection(xml)


@pytest.mark.parametrize("command", ['dacapo="yes"', 'dalsegno="S1"', 'tocoda="C1"', 'fine="yes"'])
def test_repeat_start_and_execution_command_on_one_event_have_no_assumed_precedence(command):
    xml = score(
        [measure(0, {0: sound(f'forward-repeat="yes" {command}')}), measure(1, {4: backward()})]
    )
    with pytest.raises(PerformanceNavigationError, match="unsupported_compound_navigation_event"):
        projection(xml)


def test_ds_target_inside_invisible_context_remains_a_partial_context():
    xml = jump_score(policy="yes", kind="ds").replace(
        sound('segno="S1"'), '<sound segno="S1"><offset>1</offset></sound>'
    )
    with pytest.raises(
        PerformanceNavigationError, match="unsupported_partial_repeat_jump_interaction"
    ):
        projection(xml)


def test_primary_at_invisible_repeat_backward_endpoint_remains_ambiguous():
    xml = score(
        [
            measure(0, {0: INVISIBLE}),
            measure(1, {4: backward("yes") + sound('dacapo="yes"')}),
            measure(2, {2: sound('fine="yes"')}),
        ]
    )
    with pytest.raises(PerformanceNavigationError, match="ambiguous_jump_repeat_boundary"):
        projection(xml)


@pytest.mark.parametrize("reset", [False, True])
@pytest.mark.parametrize("policy", ["yes", "no"])
def test_tempo_replay_is_independent_of_start_representation(reset, policy):
    tempo = sound('tempo="80"') if reset else ""
    xml = jump_score(INVISIBLE + tempo, policy).replace(
        '<note id="n1_2">', sound('tempo="100"') + '<note id="n1_2">'
    )
    explicit = xml.replace(INVISIBLE, VISIBLE)

    def tempos(source):
        model = admitted(source)
        return project_performance_occurrences(model).project_facts(
            [WrittenPerformanceFact(t.point, t) for t in model.tempos]
        )

    assert tempos(xml) == tempos(explicit)
    assert performed_duration_ms(xml) == performed_duration_ms(explicit)


@pytest.mark.parametrize("policy", [None, "yes", "no"])
def test_real_verovio_written_invisible_repeat_realization(policy):
    measures = [measure(0), measure(1, {0: INVISIBLE}), measure(2, {4: backward(policy)})]
    if policy is not None:
        measures += [measure(3, {2: sound('fine="yes"')}), measure(4, {2: sound('dacapo="yes"')})]
    xml = score(measures)
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(admit_musicxml_document(xml.encode()).decode())
    toolkit.renderToMIDI()
    timing = toolkit.renderToTimemap()
    count = len(measures) * 4
    assert [e["on"][0] for e in timing if e.get("on")] == [
        f"n{q // 4}_{q % 4}" for q in range(count)
    ]
    assert max(e["qstamp"] for e in timing) == count
