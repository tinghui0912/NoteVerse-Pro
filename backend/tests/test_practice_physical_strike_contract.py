from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.practice.source_schemas import PracticeScoreArtifactRead


def _unison_artifact():
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    path = root / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
    value = json.loads(path.read_text())
    group, step = value["expectedPracticeGroups"][0], value["practiceAttackSteps"][0]
    lower = dict(group["expectedNotes"][0], expectedNoteId="lower:C4", eventId="lower-event", renderNoteId="lower-render")
    group["expectedNotes"].append(lower)
    group["renderNoteIds"].append("lower-render")
    group["eventIds"].append("lower-event")
    group["staffIds"] = ["1", "2"]
    group["voiceIds"] = ["1", "2"]
    group["strikeTargets"][0]["expectedNotes"].append(deepcopy(lower))
    group["strikeTargets"][0]["renderNoteIds"].append("lower-render")
    group["strikeTargets"][0]["eventIds"].append("lower-event")
    note = dict(step["attackTargets"][0]["notes"][0], stepNoteId="lower-step:C4", eventId="lower-event",
                renderNoteId="lower-render", staffIds=["2"], voiceIds=["2"])
    step["attackTargets"][0]["notes"].append(note)
    step["attackTargets"][0]["renderNoteIds"].append("lower-render")
    step["attackTargets"][0]["eventIds"].append("lower-event")
    step["eventIds"].append("lower-event")
    step["renderNoteIds"].append("lower-render")
    step["staffIds"] = ["1", "2"]
    step["voiceIds"] = ["1", "2"]
    return value


def test_boundary_preserves_same_pitch_notation_and_continuation_overlap():
    value = _unison_artifact()
    step = value["practiceAttackSteps"][0]
    step["continuation"].append(dict(step["attackTargets"][0]["notes"][0], stepNoteId="tie:C4", renderNoteId="tie-render"))
    step["renderNoteIds"].append("tie-render")
    before = deepcopy(value)
    parsed = PracticeScoreArtifactRead.model_validate(value)
    assert value == before
    assert parsed.schemaVersion == 2
    assert parsed.artifactId == "practice-score-artifact:7b0516d2970f8726"
    assert len(parsed.expectedPracticeGroups[0].strikeTargets) == 1
    assert len(parsed.expectedPracticeGroups[0].strikeTargets[0].expectedNotes) == 2
    assert parsed.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds == ["n1", "lower-render"]
    assert parsed.expectedPracticeGroups[0].renderNoteIds == ["n1", "lower-render"]
    assert parsed.practiceAttackSteps[0].renderNoteIds == ["n1", "lower-render", "tie-render"]
    assert parsed.practiceAttackSteps[0].attackTargets[0].renderNoteIds == ["n1", "lower-render"]
    assert len(parsed.practiceAttackSteps[0].attackTargets) == 1
    assert len(parsed.practiceAttackSteps[0].attackTargets[0].notes) == 2
    assert parsed.practiceAttackSteps[0].attackTargets[0].notes[1].voiceIds == ["2"]
    assert parsed.practiceAttackSteps[0].continuation[0].pianoKey == 60


@pytest.mark.parametrize("kind", ["group-pitch", "strike-pitch", "attack-pitch", "strike-note-pitch", "attack-note-pitch",
                                 "strike-empty", "attack-empty", "duplicate-note", "cross-owner", "missing-note",
                                 "strike-render", "attack-render"])
def test_artifact_boundary_rejects_corrupt_physical_targets_without_repair(kind):
    value = _unison_artifact()
    group, step = value["expectedPracticeGroups"][0], value["practiceAttackSteps"][0]
    strike, attack = group["strikeTargets"][0], step["attackTargets"][0]
    if kind == "group-pitch":
        group["pianoKeys"].append(60)
    elif kind == "strike-pitch":
        group["strikeTargets"].append(dict(deepcopy(strike), strikeId="second-C4"))
    elif kind == "attack-pitch":
        step["attackTargets"].append(dict(deepcopy(attack), attackId="second-C4"))
    elif kind == "strike-note-pitch":
        strike["expectedNotes"][0]["pianoKey"] = 62
    elif kind == "attack-note-pitch":
        attack["notes"][0]["pianoKey"] = 62
    elif kind == "strike-empty":
        strike["expectedNotes"] = []
    elif kind == "attack-empty":
        attack["notes"] = []
    elif kind == "duplicate-note":
        strike["expectedNotes"].append(deepcopy(strike["expectedNotes"][0]))
    elif kind == "cross-owner":
        chord = value["expectedPracticeGroups"][3]
        chord["strikeTargets"][1]["expectedNotes"].append(deepcopy(chord["expectedNotes"][0]))
        chord["strikeTargets"][1]["renderNoteIds"].append(chord["expectedNotes"][0]["renderNoteId"])
    elif kind == "missing-note":
        strike["expectedNotes"].pop()
        strike["renderNoteIds"].pop()
    elif kind == "strike-render":
        strike["renderNoteIds"] = ["wrong"]
    elif kind == "attack-render":
        attack["renderNoteIds"] = ["wrong"]
    before = deepcopy(value)
    serialized = json.dumps(value)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate(value)
    assert value == before
    assert json.dumps(value) == serialized
