"""Shared executable recording-coordinate contract and strict runtime boundaries."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.performance_takes.schemas import RecordingTimebase

CASES = json.loads(
    (
        Path(__file__).resolve().parents[2] / "contracts/practice/recording-timebase-cases.json"
    ).read_text()
)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_recording_timebase_contract(case):
    if case["valid"]:
        value = RecordingTimebase.model_validate(case["value"])
        assert value.model_dump(mode="json") == case["value"]
        assert RecordingTimebase.model_validate_json(value.model_dump_json()) == value
    else:
        with pytest.raises(ValidationError):
            RecordingTimebase.model_validate(case["value"])


@pytest.mark.parametrize("coordinate", [float("nan"), float("inf"), float("-inf"), 1.0])
def test_coordinates_require_strict_integers(coordinate):
    value = {
        "nominalMediaDurationUs": 1,
        "activeSegments": [
            {
                "performanceStartUs": coordinate,
                "performanceEndUs": 1,
                "mediaStartUs": 0,
                "mediaEndUs": 1,
            }
        ],
    }
    with pytest.raises(ValidationError):
        RecordingTimebase.model_validate(value)


def test_finalized_coordinates_are_immutable():
    value = RecordingTimebase.model_validate(next(case["value"] for case in CASES if case["valid"]))
    with pytest.raises(ValidationError):
        value.nominalMediaDurationUs = 3
    with pytest.raises(ValidationError):
        value.activeSegments[0].mediaStartUs = 3
