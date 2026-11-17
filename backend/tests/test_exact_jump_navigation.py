"""Exact single D.C./D.S. traversal and generic partial-interval fact replay."""

from tests.support.performance_plan import performed_duration_ms

from fractions import Fraction

import pytest
from tests.support.canonical_musicxml import sound, measure, score_measures, dc_score, ds_score
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


def projection(xml):
    return project_performance_occurrences(
        parse_score_semantics(admit_musicxml_document(xml.encode()))
    )


def intervals(result):
    return [(o.measure_index, o.visit, o.written_start, o.written_end) for o in result.occurrences]


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_exact_mid_measure_jump_and_fine_produce_partial_occurrences_and_15000ms(kind):
    xml = dc_score() if kind == "dc" else ds_score()
    result = projection(xml)
    assert intervals(result) == (
        [(0, 1, 0, 4), (1, 1, 4, 8), (2, 1, 8, 12), (3, 1, 12, 14), (0, 2, 0, 4), (1, 2, 4, 6)]
        if kind == "dc"
        else [
            (0, 1, 0, 4),
            (1, 1, 4, 8),
            (2, 1, 8, 12),
            (3, 1, 12, 15),
            (1, 2, 5, 8),
            (2, 2, 8, 10),
        ]
    )
    assert result.end == Fraction(20)
    assert result.written_spans == tuple((Fraction(q), Fraction(q + 4)) for q in range(0, 16, 4))
    assert all(
        type(value) is Fraction
        for o in result.occurrences
        for value in (o.written_start, o.written_end, o.performance_start, o.performance_end)
    )
    assert performed_duration_ms(xml) == 15000
    assert len(compile_practice_score(xml).notes) == 16


@pytest.mark.parametrize("kind,end", [("dc", 30), ("ds", 26)])
def test_primary_jump_without_fine_is_taken_only_once_and_terminates(kind, end):
    result = projection(dc_score(False) if kind == "dc" else ds_score(False))
    assert result.end == end
    assert intervals(result)[-1] == (3, 2, 12, 16)


def test_partial_occurrences_filter_facts_before_target_and_after_fine():
    result = projection(ds_score())
    facts = result.project_facts(
        [
            WrittenPerformanceFact(WrittenPoint(1, Fraction(4)), "before"),
            WrittenPerformanceFact(WrittenPoint(1, Fraction(5)), "entry"),
            WrittenPerformanceFact(WrittenPoint(1, Fraction(7)), "later"),
            WrittenPerformanceFact(WrittenPoint(2, Fraction(10)), "fine"),
            WrittenPerformanceFact(WrittenPoint(2, Fraction(11)), "after"),
            WrittenPerformanceFact(WrittenPoint(3, Fraction(15)), "source"),
            WrittenPerformanceFact(WrittenPoint(3, Fraction(16)), "past-source"),
        ]
    )
    assert [(f.position, f.value) for f in facts] == [
        (4, "before"),
        (5, "entry"),
        (7, "later"),
        (10, "fine"),
        (11, "after"),
        (15, "source"),
        (15, "entry"),
        (17, "later"),
        (20, "fine"),
    ]
    assert result.project_position(WrittenPoint(1, Fraction(4))) == (Fraction(4),)
    assert result.project_position(WrittenPoint(1, Fraction(5))) == (Fraction(5), Fraction(15))
    with pytest.raises(PerformanceNavigationError, match="outside_occurrence"):
        result.occurrences[4].project_position(Fraction(4))


@pytest.mark.parametrize("reset,expected", [(False, 14100), (True, 15000)])
def test_source_tempo_executes_before_jump_and_destination_tempo_reexecutes(reset, expected):
    xml = dc_score().replace('<sound dacapo="yes"/>', '<sound tempo="100"/><sound dacapo="yes"/>')
    if reset:
        xml = xml.replace('<note id="n0_0">', '<sound tempo="80"/><note id="n0_0">')
    model = parse_score_semantics(xml)
    facts = project_performance_occurrences(model).project_facts(
        [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
    )
    assert [(f.position, f.value) for f in facts] == (
        [(0, 80), (14, 100), (14, 80)] if reset else [(14, 100)]
    )
    assert performed_duration_ms(xml) == expected


@pytest.mark.parametrize("at_target,expected", [(False, 17000), (True, 14000)])
def test_ds_replays_target_tempo_but_never_replays_earlier_measure_tempo(at_target, expected):
    xml = (
        ds_score()
        .replace('<note id="n1_0">', '<sound tempo="60"/><note id="n1_0">')
        .replace('<sound dalsegno="S1"/>', '<sound tempo="100"/><sound dalsegno="S1"/>')
    )
    if at_target:
        xml = xml.replace('<sound segno="S1"/>', '<sound tempo="90"/><sound segno="S1"/>')
    model = parse_score_semantics(xml)
    facts = project_performance_occurrences(model).project_facts(
        [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
    )
    assert [(f.position, f.value) for f in facts] == (
        [(4, 60), (5, 90), (15, 100), (15, 90)] if at_target else [(4, 60), (15, 100)]
    )
    assert performed_duration_ms(xml) == expected


def test_fine_point_facts_execute_before_termination():
    xml = dc_score().replace('<sound fine="yes"/>', '<sound tempo="100"/><sound fine="yes"/>')
    model = parse_score_semantics(xml)
    facts = project_performance_occurrences(model).project_facts(
        [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
    )
    assert [(f.position, f.value) for f in facts] == [(6, 100), (20, 100)]


def test_source_at_measure_start_has_one_point_visit_before_transfer():
    result = projection(score_measures(measure(0), measure(1, {0: sound('dacapo="yes"')})))
    assert intervals(result) == [(0, 1, 0, 4), (1, 1, 4, 4), (0, 2, 0, 4), (1, 2, 4, 8)]
    facts = result.project_facts([WrittenPerformanceFact(WrittenPoint(1, Fraction(4)), "source")])
    assert [(f.occurrence_ordinal, f.position) for f in facts] == [(1, 4), (3, 8)]


def test_target_at_measure_end_has_one_point_visit_before_next_measure():
    xml = score_measures(
        measure(0, {4: sound('segno="S1"')}), measure(1), measure(2, {2: sound('dalsegno="S1"')})
    )
    result = projection(xml)
    assert intervals(result) == [
        (0, 1, 0, 4),
        (1, 1, 4, 8),
        (2, 1, 8, 10),
        (0, 2, 4, 4),
        (1, 2, 4, 8),
        (2, 2, 8, 12),
    ]
    facts = result.project_facts(
        [
            WrittenPerformanceFact(WrittenPoint(0, Fraction(4)), "endpoint"),
            WrittenPerformanceFact(WrittenPoint(1, Fraction(4)), "next-start"),
        ]
    )
    assert [(f.position, f.value) for f in facts] == [
        (4, "endpoint"),
        (4, "next-start"),
        (10, "endpoint"),
        (10, "next-start"),
    ]


def test_fine_at_destination_origin_stops_in_one_zero_duration_visit():
    result = projection(
        score_measures(measure(0, {0: sound('fine="yes"'), 2: sound('dacapo="yes"')}))
    )
    assert intervals(result) == [(0, 1, 0, 2), (0, 2, 0, 0)]
    assert [
        (f.position, f.value)
        for f in result.project_facts(
            [WrittenPerformanceFact(WrittenPoint(0, Fraction(0)), "entry")]
        )
    ] == [(0, "entry"), (2, "entry")]


def test_fine_at_next_measure_start_preserves_both_boundary_owners():
    xml = score_measures(
        measure(0, {4: sound('segno="S1"')}),
        measure(1, {0: sound('fine="yes"')}),
        measure(2, {2: sound('dalsegno="S1"')}),
    )
    result = projection(xml)
    assert intervals(result)[-2:] == [(0, 2, 4, 4), (1, 2, 4, 4)]
    assert result.end == 10


def test_same_measure_backward_jump_is_two_distinct_entries_without_artificial_splits():
    xml = score_measures(
        measure(0, {1: sound('segno="S1"'), 2: sound('fine="yes"'), 3: sound('dalsegno="S1"')})
    )
    assert intervals(projection(xml)) == [(0, 1, 0, 3), (0, 2, 1, 2)]


def test_fine_before_ds_target_is_not_encountered_on_the_second_leg():
    xml = (
        ds_score()
        .replace('<sound fine="yes"/>', "")
        .replace('<note id="n0_1">', '<sound fine="yes"/><note id="n0_1">')
    )
    assert projection(xml).end == 26


@pytest.mark.parametrize("primary", ["", ' time-only="1"'])
@pytest.mark.parametrize("fine", ["", ' time-only="2"'])
def test_supported_default_and_explicit_jump_fine_predicates(primary, fine):
    xml = (
        dc_score()
        .replace('dacapo="yes"', f'dacapo="yes"{primary}')
        .replace('fine="yes"', f'fine="yes"{fine}')
    )
    assert performed_duration_ms(xml) == 15000


@pytest.mark.parametrize("kind", ["segno", "coda"])
def test_playback_destinations_without_commands_are_inert_in_repeated_scores(kind):
    xml = score_measures(
        measure(
            0, {0: f'<barline location="left" {kind}="L"><repeat direction="forward"/></barline>'}
        ),
        measure(1, {4: '<barline><repeat direction="backward"/></barline>'}),
    )
    assert [o.measure_index for o in projection(xml).occurrences] == [0, 1, 0, 1]


@pytest.mark.parametrize("opinion", ["none", "same", "partial", "different"])
def test_multipart_program_agreement_is_semantic_and_complete(opinion):
    first = [
        measure(0),
        measure(1, {0: sound('segno="S1"'), 2: sound('fine="yes"')}),
        measure(2, {2: sound('dalsegno="S1"')}),
    ]
    second = {
        "none": [measure(i) for i in range(3)],
        "same": [
            measure(0),
            measure(
                1,
                {0: '<barline location="left" segno="S1"/>', 2: sound('fine="yes" time-only="2"')},
            ),
            measure(2, {2: sound('dalsegno="S1" time-only="1"')}),
        ],
        "partial": [measure(0), measure(1, {0: sound('segno="S1"')}), measure(2)],
        "different": [
            measure(0),
            measure(1, {1: sound('segno="S1"'), 2: sound('fine="yes"')}),
            measure(2, {2: sound('dalsegno="S1"')}),
        ],
    }[opinion]
    xml = score_measures(*first, other=second)
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    if opinion in {"partial", "different"}:
        with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
            project_performance_occurrences(model)
    else:
        assert intervals(project_performance_occurrences(model)) == intervals(
            projection(score_measures(*first))
        )
        assert performed_duration_ms(xml) == 9000


def test_same_point_sound_and_barline_destination_duplicates_collapse():
    xml = score_measures(
        measure(0),
        measure(1, {0: sound('segno="S1"') + '<barline location="left" segno="S1"/>'}),
        measure(2, {2: sound('dalsegno="S1"')}),
    )
    assert projection(xml).end == 18


@pytest.mark.parametrize(
    "location,measure_index,local,target",
    [("middle", 1, 1, 5), ("left", 1, 0, 4), ("right", 0, 4, 4)],
)
def test_ds_resolves_barline_playback_destinations_with_exact_boundary_ownership(
    location, measure_index, local, target
):
    xml = score_measures(
        *[
            measure(
                i,
                (
                    {local: f'<barline location="{location}" segno="S1"><segno/></barline>'}
                    if i == measure_index
                    else {}
                )
                | ({2: sound('fine="yes"')} if i == 2 else {})
                | ({3: sound('dalsegno="S1"')} if i == 3 else {}),
            )
            for i in range(4)
        ]
    )
    result = projection(xml)
    assert (result.occurrences[4].measure_index, result.occurrences[4].written_start) == (
        measure_index,
        target,
    )
    assert result.end == 15 + 10 - target


def test_duplicate_primary_representation_at_one_semantic_point_is_one_command():
    xml = dc_score().replace(
        '<sound dacapo="yes"/>', '<sound dacapo="yes"/><sound dacapo="yes" time-only="1"/>'
    )
    assert performed_duration_ms(xml) == 15000


@pytest.mark.parametrize(
    "body,error",
    [
        ({0: sound('dacapo="yes"')}, "non_progressing_dacapo"),
        (
            {1: sound('dacapo="yes"'), 3: sound('dacapo="yes"')},
            "unsupported_multiple_primary_jumps",
        ),
        (
            {1: sound('dacapo="yes"'), 3: sound('dalsegno="S1"')},
            "unsupported_multiple_primary_jumps",
        ),
        (
            {0: sound('segno="S1"'), 2: sound('dalsegno="S1"'), 3: sound('dalsegno="S1"')},
            "unsupported_multiple_primary_jumps",
        ),
        ({1: sound('dalsegno="missing"')}, "unresolved_jump_destination"),
        (
            {
                1: "<direction><direction-type><segno/></direction-type></direction>",
                3: sound('dalsegno="S1"'),
            },
            "unresolved_jump_destination",
        ),
        ({0: sound('segno="s1"'), 3: sound('dalsegno="S1"')}, "unresolved_jump_destination"),
        (
            {0: sound('segno="S1"'), 1: sound('segno="S1"'), 3: sound('dalsegno="S1"')},
            "ambiguous_jump_destination",
        ),
        ({1: sound('segno="S1" dalsegno="S1"')}, "non_progressing_dalsegno"),
        ({1: sound('dalsegno="S1"'), 2: sound('segno="S1"')}, "unsupported_non_backward_dalsegno"),
        ({1: sound('fine="yes"')}, "unsupported_orphan_fine"),
        ({1: sound('fine="1.5"'), 3: sound('dacapo="yes"')}, "unsupported_numeric_fine_duration"),
        (
            {1: sound('fine="yes"'), 2: sound('fine="yes"'), 3: sound('dacapo="yes"')},
            "unsupported_multiple_fines",
        ),
        ({1: sound('tocoda="C1"')}, "unsupported_orphan_tocoda"),
        ({1: sound('forward-repeat="yes"')}, "unsupported_forward_repeat_position"),
        ({1: sound('dacapo="yes" dalsegno="S1"')}, "unsupported_compound_navigation_event"),
        ({1: sound('dacapo="yes" fine="yes"')}, "unsupported_compound_navigation_event"),
        ({1: sound('dalsegno="S1" tocoda="C1"')}, "unsupported_compound_navigation_event"),
        ({1: sound('dacapo="yes" time-only="2"')}, "unsupported_jump_time_only"),
        ({1: sound('dacapo="yes" time-only="1,2"')}, "unsupported_jump_time_only"),
        (
            {1: sound('fine="yes" time-only="1"'), 3: sound('dacapo="yes"')},
            "unsupported_fine_time_only",
        ),
        (
            {1: sound('fine="yes" time-only="1,2"'), 3: sound('dacapo="yes"')},
            "unsupported_fine_time_only",
        ),
    ],
)
def test_unsupported_programs_stay_admissible_but_fail_before_traversal(body, error):
    xml = score_measures(measure(0, body))
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match=f"^{error}$"):
        project_performance_occurrences(model)
    assert extract_musicxml_metadata(xml).measure_count > 0


@pytest.mark.parametrize(
    "markup,error",
    [
        ('<barline location="left"><repeat direction="forward"/></barline>', "unclosed_repeat"),
        ('<barline><repeat direction="backward"/></barline>', "ambiguous_repeat_after_jump"),
        (
            '<barline location="left"><ending number="1" type="start"/></barline>',
            "unsupported_jump_ending_interaction",
        ),
    ],
)
def test_jump_requires_valid_repeat_structure_explicit_policy_and_no_endings(markup, error):
    with pytest.raises(PerformanceNavigationError, match=error):
        projection(dc_score().replace('<note id="n0_0">', markup + '<note id="n0_0">'))


def test_gated_tempo_is_not_executed_by_the_jump_state():
    xml = dc_score().replace(
        '<note id="n0_0">', '<sound tempo="100" time-only="2"/><note id="n0_0">'
    )
    with pytest.raises(PerformanceNavigationError, match="unsupported_time_only_playback"):
        projection(xml)


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_fractional_navigation_positions_stay_exact(kind):
    xml = (dc_score() if kind == "dc" else ds_score()).replace(
        "<divisions>1</divisions>", "<divisions>3</divisions>"
    )
    result = projection(xml)
    assert result.end == Fraction(20, 3)
    assert performed_duration_ms(xml) == 5000
    assert result.occurrences[3].written_end == (Fraction(14, 3) if kind == "dc" else Fraction(5))


def test_same_numeric_destination_at_different_measure_edges_is_ambiguous():
    xml = score_measures(
        measure(0, {4: sound('segno="S1"')}),
        measure(1, {0: sound('segno="S1"')}),
        measure(2, {2: sound('dalsegno="S1"')}),
    )
    with pytest.raises(PerformanceNavigationError, match="ambiguous_jump_destination"):
        projection(xml)


def test_canonical_sound_offsets_resolve_exact_jump_and_fine_points():
    xml = score_measures(
        measure(0),
        measure(1, {0: '<sound segno="S1"><offset>1</offset></sound>'}),
        measure(
            2, {3: '<direction><offset sound="yes">-1</offset><sound fine="yes"/></direction>'}
        ),
        measure(3, {2: '<sound dalsegno="S1"><offset>1</offset></sound>'}),
    )
    assert intervals(projection(xml))[-2:] == [(1, 2, 5, 8), (2, 2, 8, 10)]
    assert performed_duration_ms(xml) == 15000


def test_unresolved_cross_measure_boundary_jump_point_fails_without_guessing_side():
    xml = score_measures(
        measure(0, {3: '<sound dacapo="yes"><offset>5</offset></sound>'}), measure(1), measure(2)
    )
    with pytest.raises(PerformanceNavigationError, match="ambiguous_cross_measure_boundary"):
        projection(xml)


def test_gated_destination_in_executable_program_is_not_silently_used():
    xml = ds_score().replace('segno="S1"/>', 'segno="S1" time-only="2"/>', 1)
    with pytest.raises(PerformanceNavigationError, match="unsupported_destination_time_only"):
        projection(xml)


def test_destination_metadata_can_share_one_unambiguous_command_event():
    xml = dc_score().replace('dacapo="yes"', 'dacapo="yes" coda="C1"')
    assert performed_duration_ms(xml) == 15000


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_real_verovio_written_jump_realization(kind):
    xml = dc_score() if kind == "dc" else ds_score()
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml", "expandNever": True})
    assert toolkit.loadData(admit_musicxml_document(xml.encode()).decode())
    toolkit.renderToMIDI()
    timing = toolkit.renderToTimemap()
    assert [e["on"][0] for e in timing if e.get("on")] == [f"n{q // 4}_{q % 4}" for q in range(16)]
    assert max(e["qstamp"] for e in timing) == 16
