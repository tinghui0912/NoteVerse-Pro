"""Immutable saved-performance hydration, ownership and request agreement."""

from dataclasses import FrozenInstanceError
import json
import hashlib
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
                "capture": {"kind": "AUDIO", "mime_type": "audio/webm", "byte_size": 42},
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
    assert json.loads(row.manifest_json) == {
        "schemaVersion": 1,
        "manifest": original.snapshot.model_dump(mode="json"),
    }
    assert row.manifest_json == original.canonical_document_json
    assert row.manifest_sha256 == hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    with pytest.raises(FrozenInstanceError):
        original.take_uuid = "changed"
    with pytest.raises(ValidationError):
        original.snapshot.capture.byte_size = 1
    with pytest.raises(ValidationError):
        original.snapshot.tempo_plan.segments[0].bpm = 60
    assert isinstance(original.snapshot.tempo_plan.segments, tuple)


def test_equivalent_semantic_values_have_identical_document_bytes_and_digest():
    original = value()
    snapshot = original.snapshot.model_dump(mode="json")
    equivalent = TakeManifest(
        "separate-take",
        2,
        PerformanceTakeManifestRead.model_validate(dict(reversed(list(snapshot.items())))),
    )
    assert equivalent.canonical_document_json.encode(
        "utf-8"
    ) == original.canonical_document_json.encode("utf-8")
    assert equivalent.document_sha256 == original.document_sha256
    snapshot["score_title_snapshot"] = "演奏 Café"
    changed = TakeManifest("take", 1, PerformanceTakeManifestRead.model_validate(snapshot))
    assert "演奏 Café" in changed.canonical_document_json
    assert changed.document_sha256 != original.document_sha256
    assert TakeManifest.from_document("take", 1, changed.canonical_document_json) == changed


@pytest.mark.parametrize(
    "path,bad",
    [
        (("practice_binding", "bundle_id"), ""),
        (("practice_binding", "score_id"), ""),
        (("practice_binding", "revision_id"), ""),
        (("artifact_id",), ""),
        (("score_title_snapshot",), ""),
        (("capture", "kind"), "TEXT"),
        (("capture", "mime_type"), "audio/webm;codecs=opus"),
        (("capture", "mime_type"), "video/mp4"),
        (("capture", "byte_size"), 0),
        (("capture", "byte_size"), True),
        (("score_timebase", "ticks_per_quarter"), 0),
        (("score_timebase", "ticks_per_quarter"), 2**53),
        (("scope", "start_tick"), -1),
        (("scope", "terminal_tick"), 29),
        (("scope", "kind"), "INVALID"),
        (("scope", "start_group_id"), None),
        (("tempo_plan",), {}),
        (("tempo_plan", "segments"), []),
        (("recording_timebase",), {}),
    ],
)
def test_semantically_corrupt_document_fails_closed_with_matching_digest(path, bad):
    row = manifest_to_row(value())
    document = json.loads(row.manifest_json)
    target = document["manifest"]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = bad
    row.manifest_json = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    row.manifest_sha256 = hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize(
    "document",
    [
        "not-json",
        "[]",
        "{}",
        '{"schemaVersion":1}',
        '{"schemaVersion":1,"manifest":{},"extra":0}',
        '{"schemaVersion":2,"manifest":{}}',
        '{"schemaVersion":true,"manifest":{}}',
        '{"schemaVersion":1.0,"manifest":{}}',
        '{"schemaVersion":NaN,"manifest":{}}',
        '{"schemaVersion":Infinity,"manifest":{}}',
        '{"schemaVersion":-Infinity,"manifest":{}}',
    ],
)
def test_malformed_or_unsupported_document_fails_closed(document):
    row = manifest_to_row(value())
    row.manifest_json = document
    row.manifest_sha256 = hashlib.sha256(document.encode("utf-8")).hexdigest()
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize("version", [0, 2, True, 1.0, "1", None])
def test_document_version_requires_the_supported_exact_integer(version):
    row = manifest_to_row(value())
    document = json.loads(row.manifest_json)
    document["schemaVersion"] = version
    row.manifest_json = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    row.manifest_sha256 = hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize("change", ["missing-version", "extra-field"])
def test_document_envelope_requires_exact_fields(change):
    row = manifest_to_row(value())
    document = json.loads(row.manifest_json)
    if change == "missing-version":
        del document["schemaVersion"]
    else:
        document["unexpected"] = 1
    row.manifest_json = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    row.manifest_sha256 = hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize("digest", ["0" * 64, "A" * 64, "g" * 64, "a" * 63, "a" * 65, "", None])
def test_document_requires_exact_lowercase_sha256_agreement(digest):
    row = manifest_to_row(value())
    row.manifest_sha256 = digest
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize("formatting", ["whitespace", "ordering", "duplicate-key"])
def test_persisted_document_requires_exact_canonical_bytes(formatting):
    row = manifest_to_row(value())
    document = json.loads(row.manifest_json)
    if formatting == "whitespace":
        row.manifest_json = json.dumps(document, indent=2)
    elif formatting == "ordering":
        row.manifest_json = json.dumps(
            dict(reversed(list(document.items()))), separators=(",", ":")
        )
    else:
        row.manifest_json = row.manifest_json.replace(
            '"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'
        )
    row.manifest_sha256 = hashlib.sha256(row.manifest_json.encode("utf-8")).hexdigest()
    with pytest.raises(ValidationException):
        manifest_from_row(row)


@pytest.mark.parametrize("field,bad", [("take_uuid", ""), ("user_id", 0)])
def test_manifest_relational_identity_is_validated(field, bad):
    row = manifest_to_row(value())
    setattr(row, field, bad)
    with pytest.raises(ValidationException):
        manifest_from_row(row)


def test_replay_compares_selection_against_exact_manifest_without_resolving_again():
    manifest = value()
    accepted = manifest.snapshot
    request = PerformanceTakeUploadMetadata.model_validate(
        {
            "practice_binding": accepted.practice_binding,
            "media": accepted.capture,
            "scope": {"kind": "RANGE", "start_group_id": "start", "end_group_id": "end"},
            "tempo_selection": accepted.tempo_plan.selection,
            "recording_timebase": accepted.recording_timebase,
        }
    )
    assert manifest.admitted_upload_metadata == request
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
        assert manifest.admitted_upload_metadata != PerformanceTakeUploadMetadata.model_validate(
            {**request.model_dump(mode="json"), **update}
        )


def test_replay_projection_contains_request_semantics_independently_of_resolved_facts():
    manifest = value()
    snapshot = manifest.snapshot.model_dump(mode="json")
    snapshot.update(artifact_id="another-artifact", score_title_snapshot="Another title")
    snapshot["score_timebase"]["ticks_per_quarter"] = 120
    snapshot["scope"].update(start_tick=31, terminal_tick=114)
    snapshot["tempo_plan"]["segments"] = [{"startTick": 0, "bpm": 80, "source": "MUSICXML"}]
    resolved = TakeManifest("take", 1, PerformanceTakeManifestRead.model_validate(snapshot))
    assert resolved.document_sha256 != manifest.document_sha256
    assert resolved.admitted_upload_metadata == manifest.admitted_upload_metadata
