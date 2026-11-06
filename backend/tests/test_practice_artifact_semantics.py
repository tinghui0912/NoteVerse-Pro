"""Backend-only musical graph corruption corpus; transport structure is tested separately."""

from copy import deepcopy
import json
from pathlib import Path
import pytest
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead
from app.modules.practice.score.artifact_validation import validate_practice_score_artifact

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "apps/customer-web/src/lib/practice/__fixtures__/canonical-practice-score-artifact.json"
)


def canonical():
    return json.loads(FIXTURE.read_text())


def mutate(value, kind):
    notes, events, moments = value["notes"], value["events"], value["moments"]
    attack = moments[0]["attacks"][0]
    if kind == "duplicate note":
        notes.append(deepcopy(notes[0]))
    elif kind == "duplicate event":
        events.insert(1, deepcopy(events[0]))
    elif kind == "duplicate render":
        notes[1]["renderNoteId"] = notes[0]["renderNoteId"]
    elif kind == "dangling note event":
        notes[0]["eventId"] = "missing"
    elif kind == "event without notation":
        events.insert(1, {**events[0], "eventId": "unowned"})
    elif kind == "event chronology":
        events.reverse()
    elif kind == "score extent":
        value["scoreEndTick"] = 1
    elif kind == "unsafe event end":
        events[-1]["durationTicks"] = 9007199254740991
    elif kind == "duplicate moment":
        moments[1]["groupId"] = moments[0]["groupId"]
    elif kind == "missing moment":
        moments.pop()
    elif kind == "moment onset":
        moments[0]["onsetTick"] = 1
    elif kind == "duplicate attack identity":
        moments[1]["attacks"][0]["attackId"] = attack["attackId"]
    elif kind == "duplicate physical key":
        moments[0]["attacks"].append({**attack, "attackId": "other"})
    elif kind == "wrong key ownership":
        attack["pianoKey"] = 62
    elif kind == "multiply owned note":
        attack["noteIds"].append(attack["noteIds"][0])
    elif kind == "missing attack reference":
        moments[3]["attacks"].pop()
    elif kind == "dangling attack reference":
        attack["noteIds"][0] = "missing"
    elif kind == "continuation mismatch":
        moments[3]["continuationNoteIds"] = []
    elif kind == "duplicate continuation":
        moments[3]["continuationNoteIds"] *= 2
    elif kind == "attack as continuation":
        moments[0]["continuationNoteIds"].append(notes[0]["noteId"])
    elif kind == "continuation as attack":
        moments[3]["attacks"][0]["noteIds"].append(moments[3]["continuationNoteIds"][0])
    elif kind == "tie endpoint":
        moments[2]["canonicalEndTick"] -= 1
    elif kind == "meter chronology":
        value["meterSegments"].append(deepcopy(value["meterSegments"][0]))
    elif kind == "missing initial meter":
        value["meterSegments"][0]["startTick"] = 1
    elif kind == "meter exact grid":
        value["meterSegments"][0]["denominator"] = 16
    elif kind == "meter extent":
        value["meterSegments"].append(
            {**value["meterSegments"][0], "startTick": value["scoreEndTick"] + 1}
        )
    elif kind == "tempo chronology":
        value["scoreTempoSegments"].reverse()
    elif kind == "tempo extent":
        value["scoreTempoSegments"][-1]["startTick"] = value["scoreEndTick"] + 1
    elif kind == "whole artifact no targets":
        for note in notes:
            note["tieTypes"] = ["stop"]
    else:
        raise AssertionError(kind)


@pytest.mark.parametrize(
    "kind",
    [
        "duplicate note",
        "duplicate event",
        "duplicate render",
        "dangling note event",
        "event without notation",
        "event chronology",
        "score extent",
        "unsafe event end",
        "duplicate moment",
        "missing moment",
        "moment onset",
        "duplicate attack identity",
        "duplicate physical key",
        "wrong key ownership",
        "multiply owned note",
        "missing attack reference",
        "dangling attack reference",
        "continuation mismatch",
        "duplicate continuation",
        "attack as continuation",
        "continuation as attack",
        "tie endpoint",
        "meter chronology",
        "missing initial meter",
        "meter exact grid",
        "meter extent",
        "tempo chronology",
        "tempo extent",
        "whole artifact no targets",
    ],
)
def test_semantic_corruption_of_structurally_valid_artifact(kind):
    value = canonical()
    mutate(value, kind)
    before = deepcopy(value)
    transport = PracticeScoreArtifactRead.model_validate(value)
    with pytest.raises(ValueError):
        validate_practice_score_artifact(transport.model_dump())
    assert value == before


def test_canonical_artifact_semantic_admission_preserves_exact_value():
    value = canonical()
    before = deepcopy(value)
    validate_practice_score_artifact(PracticeScoreArtifactRead.model_validate(value).model_dump())
    assert value == before


def test_fractional_grid_tie_chain_endpoint():
    value = canonical()
    # The canonical fixture already contains cross-subdivision tied notes and an exact endpoint.
    assert value["moments"][2]["canonicalEndTick"] == 9
    validate_practice_score_artifact(value)
