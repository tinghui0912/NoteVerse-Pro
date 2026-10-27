from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.practice.source_schemas import PracticeScoreArtifactRead, PracticeTargetRead


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
    assert parsed.schemaVersion == 1
    assert parsed.artifactId == "practice-score-artifact:ec2262af8d689ffb"
    assert len(parsed.expectedPracticeGroups[0].strikeTargets) == 1
    assert len(parsed.expectedPracticeGroups[0].strikeTargets[0].expectedNotes) == 2
    assert parsed.expectedPracticeGroups[0].strikeTargets[0].renderNoteIds == ["n1", "lower-render"]
    assert parsed.expectedPracticeGroups[0].renderNoteIds == ["n1", "lower-render"]
    assert parsed.practiceAttackSteps[0].renderNoteIds == ["n1", "lower-render", "tie-render"]
    assert parsed.practiceAttackSteps[0].attackTargets[0].renderNoteIds == ["n1", "lower-render"]
    assert len(parsed.practiceAttackSteps[0].attackTargets) == 1
    assert len(parsed.practiceAttackSteps[0].attackTargets[0].notes) == 2
    assert parsed.practiceAttackSteps[0].attackTargets[0].notes[1].voiceIds == ["2"]
    assert parsed.practiceAttackSteps[0].continuation[0].pitch == "C4"


@pytest.mark.parametrize("kind", ["group-pitch", "strike-pitch", "attack-pitch", "strike-note-pitch", "attack-note-pitch",
                                 "strike-empty", "attack-empty", "duplicate-note", "cross-owner", "missing-note",
                                 "strike-render", "attack-render"])
def test_artifact_boundary_rejects_corrupt_physical_targets_without_repair(kind):
    value = _unison_artifact()
    group, step = value["expectedPracticeGroups"][0], value["practiceAttackSteps"][0]
    strike, attack = group["strikeTargets"][0], step["attackTargets"][0]
    if kind == "group-pitch":
        group["pitches"].append("C4")
    elif kind == "strike-pitch":
        group["strikeTargets"].append(dict(deepcopy(strike), strikeId="second-C4"))
    elif kind == "attack-pitch":
        step["attackTargets"].append(dict(deepcopy(attack), attackId="second-C4"))
    elif kind == "strike-note-pitch":
        strike["expectedNotes"][0]["pitch"] = "D4"
    elif kind == "attack-note-pitch":
        attack["notes"][0]["pitch"] = "D4"
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


def _catalog_target():
    note = dict(step_note_id="upper:C4", event_id="upper", pitch="C4", render_note_id="upper-render", staff_ids=["1"], voice_ids=["1"])
    lower = dict(note, step_note_id="lower:C4", event_id="lower", render_note_id="lower-render", staff_ids=["2"], voice_ids=["2"])
    attack = dict(attack_id="C4", pitch="C4", notes=[note, lower], render_note_ids=["upper-render", "lower-render"])
    continuation = dict(note, step_note_id="tie:C4", render_note_id="tie-render")
    return dict(index=0, group_id="g", onset_beat=0, step_id="s", pitches=["C4"], attack_targets=[attack],
                continuation=[continuation], render_note_ids=["upper-render", "lower-render", "tie-render"])


def test_target_catalog_boundary_preserves_unison_and_continuation_overlap():
    parsed = PracticeTargetRead.model_validate(_catalog_target())
    assert len(parsed.attack_targets) == 1
    assert len(parsed.attack_targets[0].notes) == 2
    assert parsed.attack_targets[0].render_note_ids == ["upper-render", "lower-render"]
    assert parsed.render_note_ids == ["upper-render", "lower-render", "tie-render"]
    assert parsed.continuation[0].pitch == parsed.attack_targets[0].pitch


@pytest.mark.parametrize("kind", ["duplicate-attack", "duplicate-group", "wrong-pitch", "missing-render", "empty-notes"])
def test_target_catalog_boundary_rejects_malformed_physical_targets(kind):
    value = _catalog_target()
    if kind == "duplicate-attack":
        value["attack_targets"].append(dict(deepcopy(value["attack_targets"][0]), attack_id="duplicate-C4"))
    elif kind == "duplicate-group":
        value["pitches"].append("C4")
    elif kind == "wrong-pitch":
        value["attack_targets"][0]["notes"][0]["pitch"] = "D4"
    elif kind == "missing-render":
        value["attack_targets"][0]["render_note_ids"] = []
    elif kind == "empty-notes":
        value["attack_targets"][0]["notes"] = []
    before = deepcopy(value)
    with pytest.raises(ValidationError):
        PracticeTargetRead.model_validate(value)
    assert value == before


@pytest.mark.parametrize("kind", [
    "strike-render-alias", "attack-render-alias", "group-render-alias", "missing-group-render",
    "missing-step-attack-render", "missing-step-continuation-render", "duplicate-step-note",
    "cross-target-step-note", "attack-continuation-step-note", "empty-step-note", "empty-continuation-note",
    "empty-strike-render", "empty-attack-render", "duplicate-group-render", "duplicate-step-render",
    "empty-group-render", "empty-step-render", "attack-continuation-render",
])
def test_artifact_boundary_rejects_corrupt_notation_identities_without_repair(kind):
    value = _unison_artifact()
    group, step = value["expectedPracticeGroups"][0], value["practiceAttackSteps"][0]
    strike, attack = group["strikeTargets"][0], step["attackTargets"][0]
    chord = value["practiceAttackSteps"][3]
    if kind == "strike-render-alias":
        strike["expectedNotes"][1]["renderNoteId"] = "n1"
        strike["renderNoteIds"] = ["n1"]
    elif kind == "attack-render-alias":
        attack["notes"][1]["renderNoteId"] = "n1"
        attack["renderNoteIds"] = ["n1"]
    elif kind == "group-render-alias":
        group["expectedNotes"][1]["renderNoteId"] = "n1"
        group["renderNoteIds"] = ["n1"]
    elif kind == "missing-group-render":
        group["renderNoteIds"].pop()
    elif kind == "missing-step-attack-render":
        step["renderNoteIds"].pop()
    elif kind == "missing-step-continuation-render":
        chord["renderNoteIds"] = [r for t in chord["attackTargets"] for r in t["renderNoteIds"]]
    elif kind == "duplicate-step-note":
        attack["notes"][1]["stepNoteId"] = attack["notes"][0]["stepNoteId"]
    elif kind == "cross-target-step-note":
        chord["attackTargets"][1]["notes"][0]["stepNoteId"] = chord["attackTargets"][0]["notes"][0]["stepNoteId"]
    elif kind == "attack-continuation-step-note":
        chord["continuation"][0]["stepNoteId"] = chord["attackTargets"][0]["notes"][0]["stepNoteId"]
    elif kind == "empty-step-note":
        attack["notes"][0]["stepNoteId"] = ""
    elif kind == "empty-continuation-note":
        chord["continuation"][0]["stepNoteId"] = ""
    elif kind == "empty-strike-render":
        strike["expectedNotes"][0]["renderNoteId"] = ""
    elif kind == "empty-attack-render":
        attack["notes"][0]["renderNoteId"] = ""
    elif kind == "duplicate-group-render":
        group["renderNoteIds"].append("n1")
    elif kind == "duplicate-step-render":
        step["renderNoteIds"].append("n1")
    elif kind == "empty-group-render":
        group["renderNoteIds"][0] = ""
    elif kind == "empty-step-render":
        step["renderNoteIds"][0] = ""
    elif kind == "attack-continuation-render":
        chord["continuation"][0]["renderNoteId"] = chord["attackTargets"][0]["notes"][0]["renderNoteId"]
    before, serialized = deepcopy(value), json.dumps(value)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate(value)
    assert value == before
    assert json.dumps(value) == serialized


@pytest.mark.parametrize("kind", ["nested-render-alias", "duplicate-step-note", "attack-continuation-step-note",
                                 "empty-step-note", "missing-flat-render", "duplicate-flat-render", "empty-render"])
def test_catalog_boundary_rejects_corrupt_notation_identities_without_repair(kind):
    value = _catalog_target()
    attack = value["attack_targets"][0]
    if kind == "nested-render-alias":
        attack["notes"][1]["render_note_id"] = "upper-render"
        attack["render_note_ids"] = ["upper-render"]
        value["render_note_ids"] = ["upper-render", "tie-render"]
    elif kind == "duplicate-step-note":
        attack["notes"][1]["step_note_id"] = attack["notes"][0]["step_note_id"]
    elif kind == "attack-continuation-step-note":
        value["continuation"][0]["step_note_id"] = attack["notes"][0]["step_note_id"]
    elif kind == "empty-step-note":
        attack["notes"][0]["step_note_id"] = ""
    elif kind == "missing-flat-render":
        value["render_note_ids"].pop()
    elif kind == "duplicate-flat-render":
        value["render_note_ids"].append("upper-render")
    elif kind == "empty-render":
        attack["notes"][0]["render_note_id"] = ""
    before, serialized = deepcopy(value), json.dumps(value)
    with pytest.raises(ValidationError):
        PracticeTargetRead.model_validate(value)
    assert value == before
    assert json.dumps(value) == serialized


def test_identity_aggregate_order_does_not_mutate_input():
    value = _unison_artifact()
    value["expectedPracticeGroups"][0]["renderNoteIds"].reverse()
    value["practiceAttackSteps"][0]["renderNoteIds"].reverse()
    before = deepcopy(value)
    PracticeScoreArtifactRead.model_validate(value)
    assert value == before
