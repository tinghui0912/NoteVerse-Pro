"""The exact shared performance contract preserves navigation and encounter identity."""

from dataclasses import FrozenInstanceError
from fractions import Fraction

import pytest

from app.processing.musicxml.metadata import extract_musicxml_metadata
from app.score_semantics.musicxml_score import parse_score_semantics
from app.score_semantics.performance_plan import build_performance_plan
from tests.test_exact_jump_navigation import dc_score, ds_score
from tests.test_exact_coda_navigation import dc_measures, ds_measures
from tests.test_invisible_forward_repeats import INVISIBLE, measure, score, backward
from tests.test_post_jump_repeats import jump_measures, repeat, sound


def plan(xml):
    return build_performance_plan(parse_score_semantics(xml))


@pytest.mark.parametrize(
    "xml,order,end,duration",
    [
        (score([measure(0), measure(1)]), [0, 1], 8, 6000),
        (
            score([measure(0, {0: repeat("forward")}), measure(1, {4: backward()})]),
            [0, 1, 0, 1],
            16,
            12000,
        ),
        (dc_score(), [0, 1, 2, 3, 0, 1], 20, 15000),
        (ds_score(), [0, 1, 2, 3, 1, 2], 20, 15000),
        (score(dc_measures()), [0, 1, 2, 3, 0, 1, 4], 23, 17250),
        (score(ds_measures()), [0, 1, 2, 3, 1, 2, 4], 22, 16500),
        (score(jump_measures("yes")), [0, 1, 0, 1, 2, 3, 0, 1, 0, 1, 2], 40, 30000),
        (score(jump_measures("no")), [0, 1, 0, 1, 2, 3, 0, 1, 2], 32, 24000),
        (
            score([measure(0), measure(1, {0: INVISIBLE}), measure(2, {4: backward()})]),
            [0, 1, 2, 1, 2],
            20,
            15000,
        ),
    ],
)
def test_plan_is_the_exact_navigation_contract(xml, order, end, duration):
    result = plan(xml)
    assert [o.measure_index for o in result.projection.occurrences] == order
    assert result.projection.end == Fraction(end)
    assert result.initial_tempo_bpm == Fraction(80)
    assert result.tempo_events == ()
    assert extract_musicxml_metadata(xml).playback_duration_ms == duration


@pytest.mark.parametrize(
    "back,final,order", [("1", "2", [0, 1, 0, 2]), ("1,2", "3", [0, 1, 0, 1, 0, 2])]
)
def test_plan_preserves_official_volta_passes(back, final, order):
    xml = score(
        [
            measure(0, {0: repeat("forward")}),
            measure(
                1,
                {
                    0: f'<barline location="left"><ending number="{back}" type="start"/></barline>',
                    4: f'<barline location="right"><ending number="{back}" type="stop"/><repeat direction="backward"/></barline>',
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
    assert [o.measure_index for o in plan(xml).projection.occurrences] == order


def boundary_tempos():
    return score(
        [
            measure(0, {0: repeat("forward") + sound('tempo="80"')}),
            measure(1, {4: sound('tempo="100"') + backward()}),
            measure(2),
        ]
    )


def test_same_performance_quarter_preserves_source_then_destination_encounters():
    result = plan(boundary_tempos())
    assert [(t.occurrence_ordinal, t.position, t.bpm) for t in result.tempo_events] == [
        (0, 0, 80),
        (1, 8, 100),
        (2, 8, 80),
        (3, 16, 100),
    ]
    assert extract_musicxml_metadata(boundary_tempos()).playback_duration_ms == 14400
    with pytest.raises(FrozenInstanceError):
        result.initial_tempo_bpm = Fraction(100)
    with pytest.raises(FrozenInstanceError):
        result.tempo_events[0].bpm = Fraction(100)


@pytest.mark.parametrize("explicit", [False, True])
def test_default_is_initial_state_and_never_a_fake_encounter(explicit):
    xml = score([measure(0, {0: sound('tempo="100"')} if explicit else {})])
    result = plan(xml)
    assert result.initial_tempo_bpm == Fraction(80)
    assert [(t.position, t.bpm) for t in result.tempo_events] == ([(0, 100)] if explicit else [])


def test_dc_source_tempo_precedes_destination_tempo_at_one_performance_quarter():
    xml = (
        dc_score()
        .replace('<note id="n0_0">', sound('tempo="80"') + '<note id="n0_0">')
        .replace('<sound dacapo="yes"/>', sound('tempo="100"') + '<sound dacapo="yes"/>')
    )
    result = plan(xml)
    assert [(t.occurrence_ordinal, t.position, t.bpm) for t in result.tempo_events] == [
        (0, 0, 80),
        (3, 14, 100),
        (4, 14, 80),
    ]
    assert all(type(t.position) is type(t.bpm) is Fraction for t in result.tempo_events)
    assert extract_musicxml_metadata(xml).playback_duration_ms == 15000


def test_same_value_source_encounters_are_not_deduplicated():
    xml = score([measure(0, {0: sound('tempo="100"') * 2})])
    result = plan(xml)
    assert [(t.occurrence_ordinal, t.position, t.bpm) for t in result.tempo_events] == [
        (0, 0, 100),
        (0, 0, 100),
    ]
