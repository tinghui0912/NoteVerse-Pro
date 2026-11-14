from app.core.config import settings
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.db.models.performance_take import PerformanceTake
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.performance_takes.schemas import (
    PerformanceTakeRead,
    PerformanceTakeUploadReservationRead,
    PerformanceTakeUploadTarget,
)
from sqlalchemy.ext.asyncio import AsyncSession


def reservation_read(
    reservation: PerformanceTakeUploadReservation,
    *,
    upload_target=None,
    take: PerformanceTakeRead | None = None,
) -> PerformanceTakeUploadReservationRead:
    return PerformanceTakeUploadReservationRead(
        reservation_id=reservation.reservation_uuid,
        take_id=manifest_from_row(reservation.manifest).take_uuid,
        status=reservation.status,
        manifest=manifest_from_row(reservation.manifest).snapshot,
        upload_target=PerformanceTakeUploadTarget(
            url=upload_target.upload_url,
            method=upload_target.upload_method,
            headers=upload_target.upload_headers,
            expires_in=settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
        )
        if upload_target is not None
        else None,
        take=take,
    )


async def completed_reservation_response(
    takes: PerformanceTakeService,
    db: AsyncSession,
    reservation: PerformanceTakeUploadReservation,
    take: PerformanceTake,
) -> PerformanceTakeUploadReservationRead:
    return reservation_read(
        reservation,
        take=await takes.get_take(db, take.manifest.user_id, take.manifest.take_uuid),
    )
