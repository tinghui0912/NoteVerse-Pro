"""Immutable saved-performance hydration, ownership and request agreement."""

from dataclasses import FrozenInstanceError
import json
import pytest
from pydantic import ValidationError
from app.core.exceptions import ValidationException
from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.manifest_persistence import manifest_to_row, manifest_from_row
from app.modules.performance_takes.schemas import (
    PerformanceTakeManifestRead,
    PerformanceTakeUploadMetadata,
)


def value():
    return TakeManifest(
        "take",
        1,
        PerformanceTakeManifestRead.model_validate(
            {
                "practice_binding": {
                    "score_id": "score",
                    "revision_id": "revision",
                    "bundle_id": "bundle",
                },
                "artifact_id": "artifact",
                "score_title_snapshot": "Admission title",
                "media": {"kind": "AUDIO", "mime_type": "audio/webm", "byte_size": 42},
                "score_timebase": {"ticks_per_quarter": 60},
                "scope": {
                    "kind": "RANGE",
                    "start_tick": 30,
                    "terminal_tick": 113,
                    "start_group_id": "start",
                    "end_group_id": "end",
                },
                "tempo_plan": {
                    "selection": {"mode": "SCORE"},
                    "segments": [{"startTick": 0, "bpm": 120, "source": "MUSICXML"}],
                },
                "recording_timebase": {
                    "nominalMediaDurationUs": 1000001,
                    "activeSegments": [
                        {
                            "performanceStartUs": 17,
                            "performanceEndUs": 1000018,
                            "mediaStartUs": 0,
                            "mediaEndUs": 1000001,
                        }
                    ],
                },
            }
        ),
    )


def test_immutable_manifest_round_trip_preserves_exact_admitted_truth():
    original = value()
    row = manifest_to_row(original)
    assert manifest_from_row(row) == original
    assert row.tempo_plan == json.dumps(
        original.snapshot.tempo_plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    )
    with pytest.raises(FrozenInstanceError):
        original.take_uuid = "changed"
    with pytest.raises(ValidationError):
        original.snapshot.media.byte_size = 1
    with pytest.raises(ValidationError):
        original.snapshot.tempo_plan.segments[0].bpm = 60
    assert isinstance(original.snapshot.tempo_plan.segments, tuple)


@pytest.mark.parametrize(
    "field,bad",
    [
        ("take_uuid", ""),
        ("user_id", 0),
        ("practice_bundle_id", ""),
        ("practice_score_uuid", ""),
        ("practice_revision_uuid", ""),
        ("practice_artifact_id", ""),
        ("score_title_snapshot", ""),
        ("media_kind", "TEXT"),
        ("media_mime_type", "audio/webm;codecs=opus"),
        ("media_mime_type", "video/mp4"),
        ("media_byte_size", 0),
        ("media_byte_size", True),
        ("ticks_per_quarter", 0),
        ("ticks_per_quarter", 2**53),
        ("scope_start_tick", -1),
        ("scope_terminal_tick", 29),
        ("scope_type", "INVALID"),
        ("scope_start_group_id", None),
        ("tempo_plan", "{}"),
        ("tempo_plan", '{"selection":{"mode":"SCORE"},"segments":[]}'),
        ("recording_timebase", "{}"),
        ("recording_timebase", "not-json"),
    ],
)
def test_corrupt_manifest_fails_closed(field, bad):
    row = manifest_to_row(value())
    setattr(row, field, bad)
    with pytest.raises(ValidationException):
        manifest_from_row(row)


def test_full_scope_has_no_range_identity():
    row = manifest_to_row(value())
    row.scope_type = "FULL"
    with pytest.raises(ValidationException):
        manifest_from_row(row)
    row.scope_start_group_id = row.scope_end_group_id = None
    assert manifest_from_row(row).snapshot.scope.kind == "FULL"


def test_replay_compares_selection_against_exact_manifest_without_resolving_again():
    manifest = value()
    accepted = manifest.snapshot
    request = PerformanceTakeUploadMetadata.model_validate(
        {
            "practice_binding": accepted.practice_binding,
            "media": accepted.media,
            "scope": {"kind": "RANGE", "start_group_id": "start", "end_group_id": "end"},
            "tempo_selection": accepted.tempo_plan.selection,
            "recording_timebase": accepted.recording_timebase,
        }
    )
    assert manifest.agrees_with(request)
    for update in [
        {"scope": {"kind": "FULL"}},
        {"scope": {"kind": "RANGE", "start_group_id": "other", "end_group_id": "end"}},
        {"tempo_selection": {"mode": "CUSTOM_FIXED_BPM", "bpm": 120}},
        {"media": {"kind": "AUDIO", "mime_type": "audio/webm", "byte_size": 43}},
        {
            "practice_binding": {
                "score_id": "other",
                "revision_id": "revision",
                "bundle_id": "bundle",
            }
        },
    ]:
        assert not manifest.agrees_with(
            PerformanceTakeUploadMetadata.model_validate(
                {**request.model_dump(mode="json"), **update}
            )
        )
