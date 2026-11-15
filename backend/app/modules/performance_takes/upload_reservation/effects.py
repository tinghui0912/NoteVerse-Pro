"""Transaction-participating application of reservation transitions and quota effects."""

from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.modules.storage_usage.service import StorageUsageService
from .domain import ReservationTransition
from .persistence import apply_transition


async def apply_reservation_transition(
    storage_usage_service: StorageUsageService,
    db: AsyncSession,
    reservation: PerformanceTakeUploadReservation,
    transition: ReservationTransition,
    *,
    now: datetime,
) -> None:
    apply_transition(reservation, transition, now=now)
    effects = transition.effects
    if effects.release_storage_reservation:
        await storage_usage_service.release_reservation(db, reservation.storage_reservation_id)
    if effects.commit_storage_object_key is not None:
        await storage_usage_service.commit_reservation(
            db,
            reservation_id=reservation.storage_reservation_id,
            object_type="performance_take",
            object_id=reservation.manifest.take_uuid,
            storage_key=effects.commit_storage_object_key,
        )
