"""Current upload protocol and structural persistence ownership."""

import inspect

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.main import app
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.service import PerformanceTakeService


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
        "tempo_plan",
        "recording_timebase",
        "client_request_id",
    }


def test_finalize_contract_consumes_only_user_scoped_reservation_identity():
    assert list(inspect.signature(PerformanceTakeService.finalize_take).parameters) == [
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
