"""Shared executable recording-coordinate contract and strict runtime boundaries."""

import json
import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.performance_takes.recording_timebase import RecordingTimebase
from app.modules.performance_takes.schemas import PerformanceTakeUploadMetadata
from app.modules.performance_takes.manifest_persistence import manifest_from_row, manifest_to_row
from app.core.exceptions import ValidationException
from tests.test_take_manifest import value as manifest_value

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


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_request_and_manifest_hydration_apply_structure_and_semantics(case):
    manifest = manifest_value()
    request = manifest.admitted_upload_metadata.model_dump(mode="json")
    request["recording_timebase"] = case["value"]
    row = manifest_to_row(manifest)
    document = json.loads(row.manifest_json)
    document["manifest"]["recording_timebase"] = case["value"]
    row.manifest_json = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    row.manifest_sha256 = hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    if case["valid"]:
        assert (
            PerformanceTakeUploadMetadata.model_validate(request).recording_timebase.model_dump(
                mode="json"
            )
            == case["value"]
        )
        assert (
            manifest_from_row(row).snapshot.recording_timebase.model_dump(mode="json")
            == case["value"]
        )
    else:
        with pytest.raises(ValidationError):
            PerformanceTakeUploadMetadata.model_validate(request)
        with pytest.raises(ValidationException):
            manifest_from_row(row)
