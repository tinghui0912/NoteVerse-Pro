"""Finite exact primary/To-Coda transfers and generic positioned fact replay."""

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


def dc_measures(coda_local=1):
    return [
        measure(0),
        measure(1, {2: sound('tocoda="C1"')}),
        measure(2),
        measure(3, {2: sound('dacapo="yes"')}),
        measure(4, {coda_local: sound('coda="C1"')}),
    ]


def ds_measures(coda_local=1):
    return [
        measure(0),
        measure(1, {1: sound('segno="S1"')}),
        measure(2, {1: sound('tocoda="C1"')}),
        measure(3, {3: sound('dalsegno="S1"')}),
        measure(4, {coda_local: sound('coda="C1"')}),
    ]


def projection(xml):
    return project_performance_occurrences(
        parse_score_semantics(admit_musicxml_document(xml.encode()))
    )


def intervals(result):
    return [(o.measure_index, o.visit, o.written_start, o.written_end) for o in result.occurrences]


@pytest.mark.parametrize(
    "kind,expected,duration",
    [
        (
            "dc",
            [
                (0, 1, 0, 4),
                (1, 1, 4, 8),
                (2, 1, 8, 12),
                (3, 1, 12, 14),
                (0, 2, 0, 4),
                (1, 2, 4, 6),
                (4, 1, 17, 20),
            ],
            17250,
        ),
        (
            "ds",
            [
                (0, 1, 0, 4),
                (1, 1, 4, 8),
                (2, 1, 8, 12),
                (3, 1, 12, 15),
                (1, 2, 5, 8),
                (2, 2, 8, 9),
                (4, 1, 17, 20),
            ],
            16500,
        ),
    ],
)
def test_exact_coda_paths_are_three_finite_legs(kind, expected, duration):
    xml = score(dc_measures() if kind == "dc" else ds_measures())
    result = projection(xml)
    assert intervals(result) == expected
    assert result.end == (Fraction(23) if kind == "dc" else Fraction(22))
    assert result.written_spans == tuple((Fraction(q), Fraction(q + 4)) for q in range(0, 20, 4))
    assert all(
        type(value) is Fraction
        for o in result.occurrences
        for value in (o.written_start, o.written_end, o.performance_start, o.performance_end)
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == duration
    assert len(compile_practice_score(xml).notes) == 20


def rates(xml):
    model = parse_score_semantics(xml)
    return [
        (f.position, f.value)
        for f in project_performance_occurrences(model).project_facts(
            [WrittenPerformanceFact(t.point, t.quarter_bpm) for t in model.tempos]
        )
    ]


def test_illustrative_q16_coda_destination_is_distinct_from_q17_fixture():
    xml = score(ds_measures(coda_local=0))
    assert projection(xml).end == 23
    assert extract_musicxml_metadata(xml).playback_duration_ms == 17250


@pytest.mark.parametrize("reset,expected", [(False, 14700), (True, 15150)])
def test_source_tempo_carries_or_is_replaced_by_destination_at_same_performed_instant(
    reset, expected
):
    xml = score(dc_measures()).replace(
        '<sound tocoda="C1"/>', '<sound tempo="100"/><sound tocoda="C1"/>'
    )
    if reset:
        xml = xml.replace('<sound coda="C1"/>', '<sound tempo="80"/><sound coda="C1"/>')
    assert rates(xml) == ([(6, 100), (20, 100), (20, 80)] if reset else [(6, 100), (20, 100)])
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected


def test_coda_target_preceding_tempo_is_skipped_and_exact_entry_tempo_executes():
    xml = (
        score(ds_measures())
        .replace('<note id="n4_0">', '<sound tempo="80"/><note id="n4_0">')
        .replace('<sound coda="C1"/>', '<sound tempo="90"/><sound coda="C1"/>')
        .replace('<sound tocoda="C1"/>', '<sound tempo="100"/><sound tocoda="C1"/>')
    )
    assert rates(xml) == [(9, 100), (19, 100), (19, 90)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 14750


@pytest.mark.parametrize("exact,expected", [(False, 21000), (True, 15333)])
def test_segno_entry_preserves_primary_target_tempo_filtering(exact, expected):
    xml = score(ds_measures()).replace('<note id="n1_0">', '<sound tempo="60"/><note id="n1_0">')
    if exact:
        xml = xml.replace('<sound segno="S1"/>', '<sound tempo="90"/><sound segno="S1"/>')
    assert rates(xml) == ([(4, 60), (5, 90), (15, 90)] if exact else [(4, 60)])
    assert extract_musicxml_metadata(xml).playback_duration_ms == expected


def test_same_measure_forward_transfer_skips_only_the_second_leg_interior():
    xml = score([measure(0, {1: sound('tocoda="C1"'), 3: sound('dacapo="yes" coda="C1"')})])
    result = projection(xml)
    assert intervals(result) == [(0, 1, 0, 3), (0, 2, 0, 1), (0, 3, 3, 4)]
    assert extract_musicxml_metadata(xml).playback_duration_ms == 3750
    facts = result.project_facts(
        [WrittenPerformanceFact(WrittenPoint(0, Fraction(q)), str(q)) for q in (1, 2, 3)]
    )
    assert [(f.position, f.value) for f in facts] == [
        (1, "1"),
        (2, "2"),
        (3, "3"),
        (4, "1"),
        (4, "3"),
    ]


def test_second_leg_can_pass_the_disabled_primary_source_before_tocoda():
    xml = score(
        [
            measure(0),
            measure(1, {2: sound('dacapo="yes"')}),
            measure(2, {2: sound('tocoda="C1"')}),
            measure(3),
            measure(4, {1: sound('coda="C1"')}),
        ]
    )
    result = projection(xml)
    assert intervals(result) == [
        (0, 1, 0, 4),
        (1, 1, 4, 6),
        (0, 2, 0, 4),
        (1, 2, 4, 8),
        (2, 1, 8, 10),
        (4, 1, 17, 20),
    ]
    assert result.end == 19
    assert extract_musicxml_metadata(xml).playback_duration_ms == 14250


def test_tocoda_at_primary_target_is_one_zero_duration_second_leg():
    xml = (
        score(ds_measures())
        .replace('<sound tocoda="C1"/>', "")
        .replace('<sound segno="S1"/>', '<sound segno="S1" tocoda="C1"/>')
    )
    result = projection(xml)
    assert intervals(result)[-2:] == [(1, 2, 5, 5), (4, 1, 17, 20)]
    assert result.end == 18
    assert result.project_position(WrittenPoint(1, Fraction(5))) == (Fraction(5), Fraction(15))


def test_coda_at_score_end_gets_one_required_point_visit():
    xml = score(ds_measures(coda_local=4))
    result = projection(xml)
    assert intervals(result)[-1] == (4, 1, 20, 20)
    assert result.end == 19
    assert result.project_position(WrittenPoint(4, Fraction(20))) == (Fraction(19),)


def test_same_numeric_boundary_source_and_target_cannot_form_a_forward_transfer():
    xml = score(
        [
            measure(0),
            measure(1, {1: sound('segno="S1"'), 4: sound('tocoda="C1"')}),
            measure(2, {0: sound('coda="C1"')}),
            measure(3, {3: sound('dalsegno="S1"')}),
        ]
    )
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    assert [
        (f.point, f.tocoda, f.coda) for f in model.playback_navigation if f.tocoda or f.coda
    ] == [(WrittenPoint(1, Fraction(8)), "C1", None), (WrittenPoint(2, Fraction(8)), None, "C1")]
    with pytest.raises(PerformanceNavigationError, match="non_progressing_tocoda"):
        project_performance_occurrences(model)


@pytest.mark.parametrize("primary", ["", ' time-only="1"'])
@pytest.mark.parametrize("tocoda", ["", ' time-only="2"'])
def test_default_and_explicit_supported_phase_predicates_are_equivalent(primary, tocoda):
    xml = (
        score(ds_measures())
        .replace('dalsegno="S1"', f'dalsegno="S1"{primary}')
        .replace('tocoda="C1"', f'tocoda="C1"{tocoda}')
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == 16500


@pytest.mark.parametrize("opinion", ["none", "same", "partial", "different"])
def test_complete_multipart_coda_program_agreement_is_semantic(opinion):
    first = ds_measures()
    other = {
        "none": [measure(i) for i in range(5)],
        "same": [
            m.replace('<sound coda="C1"/>', '<barline location="middle" coda="C1"/>')
            .replace('<sound segno="S1"/>', '<barline location="middle" segno="S1"/>')
            .replace('tocoda="C1"', 'tocoda="C1" time-only="2"')
            .replace('dalsegno="S1"', 'dalsegno="S1" time-only="1"')
            for m in first
        ],
        "partial": [
            m.replace('<sound tocoda="C1"/>', "").replace('<sound coda="C1"/>', "") for m in first
        ],
        "different": ds_measures(coda_local=2),
    }[opinion]
    xml = score(first, other)
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    if opinion in {"partial", "different"}:
        with pytest.raises(PerformanceNavigationError, match="conflicting_part_navigation"):
            project_performance_occurrences(model)
    else:
        assert intervals(project_performance_occurrences(model)) == intervals(
            projection(score(first))
        )
        assert extract_musicxml_metadata(xml).playback_duration_ms == 16500


def test_same_point_coda_sound_and_barline_destinations_collapse():
    xml = score(ds_measures()).replace(
        '<sound coda="C1"/>', '<sound coda="C1"/><barline location="middle" coda="C1"/>'
    )
    assert projection(xml).end == 22


def test_endpoint_tocoda_does_not_replay_the_skipped_next_measure_start():
    xml = score(
        [
            measure(0),
            measure(1, {4: sound('tocoda="C1"')}),
            measure(2),
            measure(3, {2: sound('dacapo="yes"')}),
            measure(4, {0: sound('coda="C1"')}),
        ]
    )
    result = projection(xml)
    facts = result.project_facts(
        [
            WrittenPerformanceFact(WrittenPoint(1, Fraction(8)), "source-end"),
            WrittenPerformanceFact(WrittenPoint(2, Fraction(8)), "next-start"),
            WrittenPerformanceFact(WrittenPoint(4, Fraction(16)), "target-start"),
        ]
    )
    assert [(f.position, f.value) for f in facts] == [
        (8, "source-end"),
        (8, "next-start"),
        (22, "source-end"),
        (22, "target-start"),
    ]
    assert result.end == 26


def test_equal_numeric_coda_destinations_at_different_edges_are_ambiguous():
    measures = ds_measures(coda_local=0)
    measures[3] = measure(3, {3: sound('dalsegno="S1"'), 4: sound('coda="C1"')})
    with pytest.raises(PerformanceNavigationError, match="ambiguous_coda_destination"):
        projection(score(measures))


@pytest.mark.parametrize("kind,duration", [("dc", 5750), ("ds", 5500)])
def test_fractional_coda_source_and_target_coordinates_remain_exact(kind, duration):
    xml = score(dc_measures() if kind == "dc" else ds_measures()).replace(
        "<divisions>1</divisions>", "<divisions>3</divisions>"
    )
    assert projection(xml).end == (Fraction(23, 3) if kind == "dc" else Fraction(22, 3))
    assert extract_musicxml_metadata(xml).playback_duration_ms == duration


def test_later_part_can_supply_the_complete_coda_program():
    xml = score([measure(i) for i in range(5)], ds_measures())
    assert intervals(projection(xml)) == intervals(projection(score(ds_measures())))


def test_coda_destination_alone_is_inert_in_a_volta_program():
    xml = score(
        [
            measure(
                0, {0: '<barline location="left" coda="C1"><repeat direction="forward"/></barline>'}
            ),
            measure(
                1,
                {
                    0: '<barline location="left"><ending number="1" type="start"/></barline>',
                    4: '<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
                },
            ),
            measure(
                2,
                {
                    0: '<barline location="left"><ending number="2" type="start"/></barline>',
                    4: '<barline><ending number="2" type="discontinue"/></barline>',
                },
            ),
        ]
    )
    assert [o.measure_index for o in projection(xml).occurrences] == [0, 1, 0, 2]


def test_semantically_duplicate_tocoda_command_at_one_point_fires_once():
    xml = score(ds_measures()).replace(
        '<sound tocoda="C1"/>', '<sound tocoda="C1"/><sound tocoda="C1" time-only="2"/>'
    )
    assert extract_musicxml_metadata(xml).playback_duration_ms == 16500


@pytest.mark.parametrize(
    "change,error",
    [
        ("orphan", "unsupported_orphan_tocoda"),
        ("unresolved", "unresolved_coda_destination"),
        ("visual-only", "unresolved_coda_destination"),
        ("case", "unresolved_coda_destination"),
        ("ambiguous", "ambiguous_coda_destination"),
        ("equal", "non_progressing_tocoda"),
        ("backward", "unsupported_non_forward_tocoda"),
        ("unreachable", "unreachable_tocoda_after_primary_jump"),
        ("fine", "unsupported_fine_coda_combination"),
        ("numeric-fine", "unsupported_fine_coda_combination"),
        ("multiple", "unsupported_multiple_tocoda"),
        ("compound-ds", "unsupported_compound_navigation_event"),
        ("compound-dc", "unsupported_compound_navigation_event"),
        ("compound-fine", "unsupported_compound_navigation_event"),
        ("forward-repeat", "unclosed_repeat"),
        ("gated-coda", "unsupported_destination_time_only"),
        ("gated-segno", "unsupported_destination_time_only"),
        ("gated-tempo", "unsupported_time_only_playback"),
    ],
)
def test_unsupported_coda_programs_remain_admissible_but_fail_before_traversal(change, error):
    xml = score(ds_measures())
    transformations = {
        "orphan": lambda x: x.replace('<sound dalsegno="S1"/>', ""),
        "unresolved": lambda x: x.replace('<sound coda="C1"/>', ""),
        "visual-only": lambda x: x.replace(
            '<sound coda="C1"/>', "<direction><direction-type><coda/></direction-type></direction>"
        ),
        "case": lambda x: x.replace('<sound coda="C1"/>', '<sound coda="c1"/>'),
        "ambiguous": lambda x: x.replace('<note id="n4_2">', '<sound coda="C1"/><note id="n4_2">'),
        "equal": lambda x: x.replace('<sound coda="C1"/>', "").replace(
            'tocoda="C1"', 'tocoda="C1" coda="C1"'
        ),
        "backward": lambda x: x.replace('<sound coda="C1"/>', "").replace(
            '<note id="n2_0">', '<sound coda="C1"/><note id="n2_0">'
        ),
        "unreachable": lambda x: x.replace('<sound tocoda="C1"/>', "").replace(
            '<note id="n1_0">', '<sound tocoda="C1"/><note id="n1_0">'
        ),
        "fine": lambda x: x.replace('<note id="n0_0">', '<sound fine="yes"/><note id="n0_0">'),
        "numeric-fine": lambda x: x.replace(
            '<note id="n0_0">', '<sound fine="1.5"/><note id="n0_0">'
        ),
        "multiple": lambda x: x.replace('<note id="n2_2">', '<sound tocoda="C1"/><note id="n2_2">'),
        "compound-ds": lambda x: x.replace('dalsegno="S1"', 'dalsegno="S1" tocoda="C1"'),
        "compound-dc": lambda x: x.replace('dalsegno="S1"', 'dacapo="yes" tocoda="C1"'),
        "compound-fine": lambda x: x.replace('tocoda="C1"', 'tocoda="C1" fine="yes"'),
        "forward-repeat": lambda x: x.replace(
            '<note id="n0_0">', '<sound forward-repeat="yes"/><note id="n0_0">'
        ),
        "gated-coda": lambda x: x.replace('<sound coda="C1"/>', '<sound coda="C1" time-only="2"/>'),
        "gated-segno": lambda x: x.replace(
            '<sound segno="S1"/>', '<sound segno="S1" time-only="1"/>'
        ),
        "gated-tempo": lambda x: x.replace(
            '<note id="n0_0">', '<sound tempo="100" time-only="2"/><note id="n0_0">'
        ),
    }
    xml = transformations[change](xml)
    model = parse_score_semantics(admit_musicxml_document(xml.encode()))
    with pytest.raises(PerformanceNavigationError, match=f"^{error}$"):
        project_performance_occurrences(model)
    with pytest.raises(MetadataExtractionError, match=error):
        extract_musicxml_metadata(xml)


@pytest.mark.parametrize("predicate", ["1", "3", "1,2"])
def test_arbitrary_tocoda_predicates_are_not_generalized(predicate):
    xml = score(ds_measures()).replace('tocoda="C1"', f'tocoda="C1" time-only="{predicate}"')
    with pytest.raises(PerformanceNavigationError, match="unsupported_tocoda_time_only"):
        projection(xml)


@pytest.mark.parametrize(
    "markup,error",
    [
        ('<barline location="left"><repeat direction="forward"/></barline>', "unclosed_repeat"),
        ('<barline><repeat direction="backward" after-jump="yes"/></barline>', None),
        (
            '<barline location="left"><ending number="1" type="start"/></barline>',
            "unsupported_jump_ending_interaction",
        ),
    ],
)
def test_coda_repeat_program_validation_and_unreached_post_jump_context(markup, error):
    xml = score(ds_measures()).replace('<note id="n0_0">', markup + '<note id="n0_0">')
    if error:
        with pytest.raises(PerformanceNavigationError, match=error):
            projection(xml)
    else:
        assert projection(xml).end == 26


@pytest.mark.parametrize("kind", ["dc", "ds"])
def test_real_verovio_characterizes_measure_rounded_coda_gap(kind):
    xml = score(dc_measures() if kind == "dc" else ds_measures())
    toolkit = verovio.toolkit()
    toolkit.setOptions({"inputFrom": "xml"})
    assert toolkit.loadData(admit_musicxml_document(xml.encode()).decode())
    toolkit.renderToMIDI()
    timing = toolkit.renderToTimemap({"includeMeasures": True})
    events = [e for e in timing if e.get("on")]
    renderer_written_quarters = (
        list(range(16))
        + (list(range(8)) if kind == "dc" else list(range(4, 12)))
        + list(range(16, 20))
    )
    assert [e["on"][0].split("-rend")[0] for e in events] == [
        f"n{q // 4}_{q % 4}" for q in renderer_written_quarters
    ]
    assert max(Fraction(str(e["qstamp"])) for e in timing) == 28
    result = projection(xml)
    assert result.end == (23 if kind == "dc" else 22)
    exact_written_quarters = [
        q for o in result.occurrences for q in range(int(o.written_start), int(o.written_end))
    ]
    assert renderer_written_quarters != exact_written_quarters
