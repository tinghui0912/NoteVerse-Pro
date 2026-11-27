"""Exact source-local Practice score coordinates and shared artifact witnesses."""

from fractions import Fraction
from pathlib import Path
import json
import os
import pytest
from app.modules.practice.score.time import PracticeScoreTimebase, MAX_JSON_SAFE_INTEGER, score_tick
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.artifact import practice_score_artifact_from_timeline
from app.modules.practice.planning.score_plan import (
    PlanningMoment,
    PracticePlanningScore,
    RangeScopeSelection,
    ScoreTempoSelection,
    resolve_practice_score_plan,
)


def test_minimal_triplet_and_mixed_denominator_timebases():
    triplet = PracticeScoreTimebase.derive(map(Fraction, [0, Fraction(1, 3), Fraction(2, 3), 1]))
    assert triplet.ticks_per_quarter == 3
    assert [triplet.to_tick(Fraction(n, 3)) for n in range(4)] == [0, 1, 2, 3]
    mixed = PracticeScoreTimebase.derive([Fraction(1, 2), Fraction(1, 3), Fraction(1, 5)])
    assert mixed.ticks_per_quarter == 30
    assert [mixed.to_tick(Fraction(1, d)) for d in (2, 3, 5)] == [15, 10, 6]
    with pytest.raises(PracticeScoreInvalidError):
        mixed.to_tick(Fraction(1, 7))


@pytest.mark.parametrize("value", [True, 1.0, -1, MAX_JSON_SAFE_INTEGER + 1])
def test_tick_rejects_nonportable_identity(value):
    with pytest.raises(PracticeScoreInvalidError):
        score_tick(value)


@pytest.mark.parametrize(
    "positions",
    [
        [Fraction(1, MAX_JSON_SAFE_INTEGER + 1)],
        [Fraction(MAX_JSON_SAFE_INTEGER + 1)],
        [Fraction(MAX_JSON_SAFE_INTEGER, 2), Fraction(1, 3)],
    ],
)
def test_timebase_and_scaled_extent_fail_closed(positions):
    with pytest.raises(PracticeScoreInvalidError):
        PracticeScoreTimebase.derive(positions)


def test_shared_backend_generated_exact_artifact():
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    compiled = compile_practice_score(
        (Path(__file__).parent / "fixtures/musicxml/exact-practice-score.musicxml").read_bytes()
    )
    timeline = practice_timeline_from_compiled(compiled)
    artifact = practice_score_artifact_from_timeline(
        timeline,


        score_tempo_segments=compiled.tempo_segments,
    )
    assert artifact == json.loads(
        (
            root
            / "apps/customer-web/src/lib/practice/__fixtures__/exact-practice-score-artifact.json"
        ).read_text()
    )
    assert compiled.timebase.ticks_per_quarter == 60
    assert [e["onsetTick"] for e in artifact["events"]] == [0, 20, 50, 62, 90, 110, 140]
    assert artifact["scoreEndTick"] == 165  # includes final written rest
    assert [s["startTick"] for s in artifact["scoreTempoSegments"]] == [30, 113]
    assert [m.measure_duration_ticks(60) for m in timeline.meter_segments] == [90, 75]
    assert [
        compiled.timebase.meter_pulse_ticks(m.denominator) for m in timeline.meter_segments
    ] == [30, 15]
    assert timeline.moments[3].canonical_end_tick == 110
    score = PracticePlanningScore(
        tuple(
            PlanningMoment(m.group_id, m.onset_tick, m.canonical_end_tick) for m in timeline.moments
        ),
        timeline.score_end_tick,
        compiled.tempo_segments,
        60,
    )
    scope = resolve_practice_score_plan(
        score,
        RangeScopeSelection(timeline.moments[3].group_id, timeline.moments[3].group_id),
        ScoreTempoSelection(),
    ).scope
    assert (scope.start_tick, scope.terminal_tick) == (62, 110)


def test_compiler_rejects_unsafe_grid_and_extent():
    def xml(divisions, duration):
        return f'<score-partwise><part id="P1"><measure><attributes><divisions>{divisions}</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note id="n"><pitch><step>C</step><octave>4</octave></pitch><duration>{duration}</duration></note></measure></part></score-partwise>'.encode()

    for divisions, duration in ((MAX_JSON_SAFE_INTEGER + 1, 1), (1, MAX_JSON_SAFE_INTEGER + 1)):
        with pytest.raises(PracticeScoreInvalidError):
            compile_practice_score(xml(divisions, duration))
    assert compile_practice_score(xml(10000000, 1)).timebase.ticks_per_quarter == 10000000
