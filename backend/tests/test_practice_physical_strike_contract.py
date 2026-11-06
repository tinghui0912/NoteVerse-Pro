from __future__ import annotations
from copy import deepcopy
import json
import os
from pathlib import Path

import pytest
from pydantic import ValidationError
from app.modules.practice.bundle.schemas import PracticeScoreArtifactRead


def canonical():
    root = Path(os.environ.get("NOTEVERSE_REPO_ROOT", Path(__file__).resolve().parents[2]))
    return json.loads(
        (
            root
            / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
        ).read_text()
    )


def unison():
    value = canonical()
    original = value["notes"][0]
    value["notes"].insert(
        1,
        dict(
            original,
            noteId="lower-note",
            renderNoteId="lower-render",
            staffId="2",
            voiceId="2",
            eventId="lower-event",
        ),
    )
    value["events"].insert(1, dict(value["events"][0], eventId="lower-event"))
    value["moments"][0]["attacks"][0]["noteIds"].append("lower-note")
    return value


def test_single_canonical_notation_graph_retains_unison_and_continuation():
    value = unison()
    parsed = PracticeScoreArtifactRead.model_validate(value)
    assert parsed.schemaVersion == 1
    assert len(parsed.notes) == 8
    attack = parsed.moments[0].attacks[0]
    assert attack.pianoKey == 60
    assert len(attack.noteIds) == 2
    assert {n.renderNoteId for n in parsed.notes if n.noteId in attack.noteIds} == {
        "n1",
        "lower-render",
    }
    assert len(parsed.moments[3].continuationNoteIds) == 1
    assert [a.pianoKey for a in parsed.moments[3].attacks] == [69, 72]


@pytest.mark.parametrize(
    "kind",
    [
        "dangling",
        "duplicate-note",
        "duplicate-render",
        "wrong-key",
        "double-owner",
        "missing-reference",
        "key20",
        "key109",
        "fractional",
        "bool-key",
        "string-key",
        "duplicate-moment",
        "chronology",
        "endpoint",
        "nan-endpoint",
        "duplicate-reference",
        "dangling-event",
        "empty-moment",
        "continuation-as-attack",
        "missing-continuation",
        "duplicate-continuation",
        "unsupported-schema",
        "unknown-field",
    ],
)
def test_canonical_graph_rejects_corruption_without_repair(kind):
    value = unison()
    a = value["moments"][0]["attacks"][0]
    if kind == "dangling":
        a["noteIds"][0] = "missing"
    elif kind == "duplicate-note":
        value["notes"].append(deepcopy(value["notes"][0]))
    elif kind == "duplicate-render":
        value["notes"][1]["renderNoteId"] = value["notes"][0]["renderNoteId"]
    elif kind == "wrong-key":
        a["pianoKey"] = 62
    elif kind == "double-owner":
        value["moments"][0]["attacks"].append(dict(a, attackId="other", pianoKey=62))
    elif kind == "missing-reference":
        a["noteIds"].pop()
    elif kind in {"key20", "key109", "fractional", "bool-key", "string-key"}:
        value["notes"][-1]["pianoKey"] = {
            "key20": 20,
            "key109": 109,
            "fractional": 60.5,
            "bool-key": True,
            "string-key": "60",
        }[kind]
    elif kind == "duplicate-moment":
        value["moments"][1]["groupId"] = value["moments"][0]["groupId"]
    elif kind == "chronology":
        value["events"][0]["onsetTick"] = 99
    elif kind == "endpoint":
        value["moments"][0]["canonicalEndTick"] += 1
    elif kind == "nan-endpoint":
        value["moments"][0]["canonicalEndTick"] = float("nan")
    elif kind == "duplicate-reference":
        a["noteIds"].append(a["noteIds"][0])
    elif kind == "dangling-event":
        value["notes"][0]["eventId"] = "missing"
    elif kind == "empty-moment":
        value["moments"][0]["attacks"] = []
    elif kind == "continuation-as-attack":
        value["moments"][3]["attacks"][0]["noteIds"].append(
            value["moments"][3]["continuationNoteIds"][0]
        )
    elif kind == "missing-continuation":
        value["moments"][3]["continuationNoteIds"] = []
    elif kind == "duplicate-continuation":
        value["moments"][3]["continuationNoteIds"] *= 2
    elif kind == "unsupported-schema":
        value["schemaVersion"] = 999
    elif kind == "unknown-field":
        value["unexpectedField"] = []
    before = json.dumps(value, sort_keys=True)
    with pytest.raises(ValidationError):
        PracticeScoreArtifactRead.model_validate(value)
    assert json.dumps(value, sort_keys=True) == before
