"""Current upload protocol and structural persistence ownership."""

import inspect

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.main import app
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService


def test_manifest_and_lifecycle_persistence_ownership():
    from app.db.models import PerformanceTakeManifest
    from sqlalchemy import UniqueConstraint

    manifest = PerformanceTakeManifest.__table__
    reservation = PerformanceTakeUploadReservation.__table__
    take = PerformanceTake.__table__
    assert set(manifest.columns.keys()) == {
        "id",
        "take_uuid",
        "user_id",
        "manifest_json",
        "manifest_sha256",
        "created_at",
    }
    assert set(take.columns.keys()) == {
        "id",
        "manifest_id",
        "linked_score_id",
        "recording_object_id",
        "created_at",
        "updated_at",
    }
    assert set(reservation.columns.keys()) == {
        "id",
        "reservation_uuid",
        "user_id",
        "manifest_id",
        "client_request_id",
        "staging_object_key",
        "storage_reservation_id",
        "expires_at",
        "last_put_url_expires_at",
        "staging_cleanup_after",
        "staging_cleanup_completed_at",
        "finalizing_object_key",
        "orphan_final_object_keys",
        "finalizing_token",
        "finalizing_expires_at",
        "status",
        "created_at",
        "updated_at",
    }
    assert not reservation.c.manifest_id.nullable and not take.c.manifest_id.nullable
    assert any(
        isinstance(c, UniqueConstraint) and [column.name for column in c.columns] == ["manifest_id"]
        for c in take.constraints
    )
    assert {fk.target_fullname for fk in manifest.foreign_keys} == {"users.id"}
    owner_fk = next(
        fk
        for fk in reservation.foreign_key_constraints
        if fk.name == "fk_take_reservation_manifest_owner"
    )
    assert [c.name for c in owner_fk.columns] == ["manifest_id", "user_id"]


def test_finalize_contract_consumes_only_user_scoped_reservation_identity():
    assert list(inspect.signature(PerformanceTakeUploadService.finalize_take).parameters) == [
        "self",
        "db",
        "user_id",
        "reservation_id",
    ]
    operation = app.openapi()["paths"][
        "/api/v1/performance-takes/upload-reservations/{reservation_id}/finalize"
    ]["post"]
    assert "requestBody" not in operation
    assert [
        (parameter["name"], parameter["in"])
        for parameter in operation["parameters"]
        if parameter["in"] in {"path", "query"}
    ] == [("reservation_id", "path")]


def test_manifest_is_the_common_api_snapshot():
    from app.modules.performance_takes.schemas import (
        PerformanceTakeManifestRead,
        PerformanceTakeRead,
        PerformanceTakeUploadReservationRead,
    )

    assert set(PerformanceTakeManifestRead.model_fields) == {
        "practice_binding",
        "artifact_id",
        "score_title_snapshot",
        "capture",
        "scope",
        "score_timebase",
        "tempo_plan",
        "recording_timebase",
    }
    assert set(PerformanceTakeRead.model_fields) == {
        "take_id",
        "manifest",
        "recording_media",
        "linked_score_id",
        "can_open_score",
        "created_at",
    }
    assert set(PerformanceTakeUploadReservationRead.model_fields) == {
        "reservation_id",
        "take_id",
        "status",
        "manifest",
        "upload_target",
        "take",
    }


def test_strict_request_rejects_writable_resolved_facts():
    import copy
    import pytest
    from pydantic import ValidationError

    payload = {
        "client_request_id": "intent",
        "practice_binding": {
            "score_id": "score-uuid-10",
            "revision_id": "revision-uuid-100",
            "bundle_id": "source",
        },
        "media": {"kind": "AUDIO", "byte_size": 10, "mime_type": "audio/webm"},
        "scope": {"kind": "FULL"},
        "tempo_selection": {"mode": "SCORE"},
        "recording_timebase": {
            "nominalMediaDurationUs": 1000000,
            "activeSegments": [
                {
                    "performanceStartUs": 0,
                    "performanceEndUs": 1000000,
                    "mediaStartUs": 0,
                    "mediaEndUs": 1000000,
                }
            ],
        },
    }
    original = copy.deepcopy(payload)
    assert PerformanceTakeUploadReservationRequest.model_validate(payload).scope.kind == "FULL"
    assert payload == original
    for fields in [
        {"scope": {"kind": "FULL", "start_tick": 999, "terminal_tick": 1000}},
        {
            "tempo_plan": {
                "selection": {"mode": "SCORE"},
                "segments": [{"startTick": 0, "bpm": 200, "source": "CUSTOM"}],
            }
        },
        {"tempo_selection": {"mode": "SCORE", "segments": []}},
    ]:
        with pytest.raises(ValidationError):
            PerformanceTakeUploadReservationRequest.model_validate({**payload, **fields})


def test_take_delivery_and_deletion_are_locator_and_completed_semantic_contracts():
    from app.modules.performance_takes.schemas import (
        PerformanceTakePlaybackRead,
        PerformanceTakeDeleteResponse,
        PerformanceTakeRecordingMediaRead,
    )

    assert set(PerformanceTakePlaybackRead.model_fields) == {
        "take_id",
        "playback_url",
        "download_url",
        "expires_in",
    }
    assert set(PerformanceTakeRecordingMediaRead.model_fields) == {"mime_type", "byte_size"}
    assert PerformanceTakeDeleteResponse(take_id="take").model_dump() == {
        "take_id": "take",
        "deleted": True,
    }
