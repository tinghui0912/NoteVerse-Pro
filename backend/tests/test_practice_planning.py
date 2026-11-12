"""Shared Python/browser contract for canonical scope and tempo planning."""

from dataclasses import asdict, FrozenInstanceError
import json
import os
from pathlib import Path
import pytest

from app.modules.practice.planning.score_plan import (
    PlanningMoment,
    PracticePlanningScore,
    FullScopeSelection,
    RangeScopeSelection,
    ScoreTempoSelection,
    CustomTempoSelection,
    PracticePlanningError,
    resolve_practice_score_plan,
)
from app.modules.practice.score.domain import PracticeTempoSegment

ROOT = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
CASES = json.loads(
    (ROOT / "contracts/practice/score-planning-cases.json").read_text(encoding="utf-8")
)["cases"]


def resolve(case):
    facts, scope, tempo = case["score"], case["scope"], case["tempoSelection"]
    score = PracticePlanningScore(
        tuple(
            PlanningMoment(m["groupId"], m["onsetTick"], m["canonicalEndTick"])
            for m in facts["moments"]
        ),
        facts["scoreEndTick"],
        tuple(PracticeTempoSegment(t["startTick"], t["bpm"]) for t in facts["scoreTempoSegments"]),
        facts["ticksPerQuarter"],
    )
    return resolve_practice_score_plan(
        score,
        FullScopeSelection()
        if scope["kind"] == "FULL"
        else RangeScopeSelection(scope["startGroupId"], scope["endGroupId"]),
        ScoreTempoSelection() if tempo["mode"] == "SCORE" else CustomTempoSelection(tempo["bpm"]),
    )


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_score_planning_contract(case):
    if "error" in case:
        with pytest.raises(PracticePlanningError) as caught:
            resolve(case)
        assert caught.value.field == case["error"]
        return
    plan = resolve(case)
    scope = {
        "kind": plan.scope.kind,
        "startTick": plan.scope.start_tick,
        "terminalTick": plan.scope.terminal_tick,
    }
    if plan.scope.kind == "RANGE":
        scope.update(startGroupId=plan.scope.start_group_id, endGroupId=plan.scope.end_group_id)
    assert {
        "scope": scope,
        "tempoPlan": {
            "selection": asdict(plan.tempo_plan.selection),
            "segments": [
                {"startTick": t.start_tick, "bpm": t.bpm, "source": t.source}
                for t in plan.tempo_plan.segments
            ],
        },
    } == case["expected"]


@pytest.mark.parametrize("bpm", [0, -1, True, "120", float("nan"), float("inf"), -float("inf")])
def test_custom_selection_requires_a_finite_positive_number(bpm):
    with pytest.raises(PracticePlanningError):
        resolve({**CASES[0], "tempoSelection": {"mode": "CUSTOM_FIXED_BPM", "bpm": bpm}})


@pytest.mark.parametrize("bpm", [20, 20.5, 80.5, 300.25, 5e-324, 1.7976931348623157e308])
def test_custom_planning_and_take_selection_preserve_exact_positive_bpm(bpm):
    from app.modules.performance_takes.schemas import CustomFixedBpmTempoPlanSelection

    selection = CustomFixedBpmTempoPlanSelection(mode="CUSTOM_FIXED_BPM", bpm=bpm)
    assert selection.bpm == bpm
    plan = resolve({**CASES[0], "tempoSelection": selection.model_dump()})
    assert plan.tempo_plan.selection.bpm == bpm
    assert plan.tempo_plan.segments[0].bpm == bpm


@pytest.mark.parametrize("bpm", [0, -1, True, "120", float("nan"), float("inf"), -float("inf")])
def test_take_custom_selection_requires_strict_positive_finite_bpm(bpm):
    from pydantic import ValidationError
    from app.modules.performance_takes.schemas import CustomFixedBpmTempoPlanSelection

    with pytest.raises(ValidationError):
        CustomFixedBpmTempoPlanSelection(mode="CUSTOM_FIXED_BPM", bpm=bpm)


def test_resolved_planning_values_are_immutable():
    plan = resolve(CASES[0])
    with pytest.raises(FrozenInstanceError):
        plan.scope.start_tick = 999
    with pytest.raises(FrozenInstanceError):
        plan.tempo_plan.segments[0].bpm = 1
