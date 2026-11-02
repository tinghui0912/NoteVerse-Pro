"""Current upload protocol and structural persistence ownership."""

import inspect

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.main import app
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService


def test_upload_reservation_owns_idempotency_and_unique_take_lineage():
    reservation = PerformanceTakeUploadReservation.__table__
    assert {"reservation_uuid", "storage_reservation_id", "client_request_id", "take_uuid"} <= set(
        reservation.columns.keys()
    )
    take = PerformanceTake.__table__
    lineage = take.c.upload_reservation_id
    assert lineage.nullable is False
    assert (
        next(iter(lineage.foreign_keys)).target_fullname
        == "performance_take_upload_reservations.id"
    )
    assert any(
        [column.name for column in constraint.columns] == ["upload_reservation_id"]
        for constraint in take.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    )
    assert set(PerformanceTakeUploadReservationRequest.model_fields) == {
        "source",
        "media",
        "scope",
        "tempo_selection",
        "recording_timebase",
        "client_request_id",
    }


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


def test_durable_provenance_is_self_contained():
    from app.modules.performance_takes.schemas import (
        PerformanceTakeSourceIdentity,
        PerformanceTakeRead,
    )

    assert set(PerformanceTakeSourceIdentity.model_fields) == {"source_id"}
    assert PerformanceTakeRead.model_fields["source_id"].is_required()
    expected = {
        "id",
        "reservation_uuid",
        "user_id",
        "source_id",
        "source_score_uuid",
        "source_revision_uuid",
        "source_artifact_id",
        "client_request_id",
        "take_uuid",
        "linked_score_id",
        "score_title_snapshot",
        "scope_type",
        "scope_start_beat",
        "scope_terminal_beat",
        "scope_start_group_id",
        "scope_end_group_id",
        "tempo_plan",
        "recording_timebase",
        "duration_ms",
        "media_kind",
        "media_mime_type",
        "media_byte_size",
        "storage_backend",
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
    assert set(PerformanceTakeUploadReservation.__table__.columns.keys()) == expected



def test_request_exposes_selection_and_evidence_while_response_exposes_resolved_truth():
    from app.modules.performance_takes.schemas import (
        PerformanceTakeFullScopeSelection, PerformanceTakeRangeScopeSelection,
        PerformanceTakeUploadReservationRead,
    )
    assert set(PerformanceTakeFullScopeSelection.model_fields) == {"kind"}
    assert set(PerformanceTakeRangeScopeSelection.model_fields) == {"kind", "start_group_id", "end_group_id"}
    assert {"resolved_scope", "resolved_tempo_plan"} <= set(PerformanceTakeUploadReservationRead.model_fields)


def test_strict_request_rejects_writable_resolved_facts():
    import copy
    import pytest
    from pydantic import ValidationError
    payload = {
        "client_request_id": "intent", "source": {"source_id": "source"},
        "media": {"kind": "AUDIO", "byte_size": 10, "mime_type": "audio/webm", "duration_ms": 1000},
        "scope": {"kind": "FULL"}, "tempo_selection": {"mode": "SCORE"},
        "recording_timebase": {"nominalMediaDurationMs": 1000, "activeSegments": [{"perfStartMs": 0, "perfEndMs": 1000, "mediaStartMs": 0, "mediaEndMs": 1000}]},
    }
    original = copy.deepcopy(payload)
    assert PerformanceTakeUploadReservationRequest.model_validate(payload).scope.kind == "FULL"
    assert payload == original
    for fields in [
        {"scope": {"kind": "FULL", "start_beat": 999, "terminal_beat": 1000}},
        {"tempo_plan": {"selection": {"mode": "SCORE"}, "segments": [{"startBeat": 0, "bpm": 200, "source": "CUSTOM"}]}},
        {"tempo_selection": {"mode": "SCORE", "segments": []}},
    ]:
        with pytest.raises(ValidationError):
            PerformanceTakeUploadReservationRequest.model_validate({**payload, **fields})
