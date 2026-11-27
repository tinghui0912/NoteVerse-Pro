"""Hydration and mutation of reservation business state; physical identity comes from its session."""

from datetime import datetime
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from .domain import FinalizeLease, UploadReservationLifecycle, ReservationTransition


def lifecycle_from_row(row: PerformanceTakeUploadReservation) -> UploadReservationLifecycle:
    lease = (
        FinalizeLease(
            row.finalizing_token, row.upload_session.final_object_key, row.finalizing_expires_at
        )
        if row.finalizing_token is not None and row.finalizing_expires_at is not None
        else None
    )
    return UploadReservationLifecycle(row.status, row.expires_at, lease)


def apply_transition(
    row: PerformanceTakeUploadReservation, transition: ReservationTransition, *, now: datetime
) -> None:
    if lifecycle_from_row(row) != transition.before:
        raise ValueError("Reservation transition has stale business facts")
    row.status = transition.after.status
    lease = transition.after.lease
    row.finalizing_token = lease.token if lease else None
    row.finalizing_expires_at = lease.expires_at if lease else None
    row.updated_at = now
