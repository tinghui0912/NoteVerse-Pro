"""Take reservation projections compose the bound upload capability."""

from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.performance_takes.schemas import (
    PerformanceTakeRead,
    PerformanceTakeUploadReservationRead,
)
from app.modules.media_storage.upload_sessions.schemas import UploadSessionRead


def reservation_read(
    reservation: PerformanceTakeUploadReservation,
    *,
    upload_session: UploadSessionRead | None = None,
    take: PerformanceTakeRead | None = None,
) -> PerformanceTakeUploadReservationRead:
    manifest = manifest_from_row(reservation.manifest)
    return PerformanceTakeUploadReservationRead(
        reservation_id=reservation.reservation_uuid,
        take_id=manifest.take_uuid,
        status=reservation.status,
        manifest=manifest.snapshot,
        upload_session=upload_session,
        take=take,
    )
