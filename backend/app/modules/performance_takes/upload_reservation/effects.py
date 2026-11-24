"""Business reservation transitions compose quota and usage in the caller transaction."""

from datetime import datetime
from sqlalchemy.orm import Session
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.storage_usage.service import StorageUsageService
from app.modules.storage_quota.contracts import StorageQuotaCommands
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from .domain import ReservationTransition
from .persistence import apply_transition


def apply_reservation_transition(
    storage_usage_service: StorageUsageService,
    quota: StorageQuotaCommands,
    db: Session,
    reservation: PerformanceTakeUploadReservation,
    transition: ReservationTransition,
    *,
    now: datetime,
) -> None:
    effects = transition.effects
    if effects.release_quota_hold:
        quota.release_hold(db, reservation.quota_hold_id, now=now)
    if effects.commit_storage_object_key is not None:
        manifest = manifest_from_row(reservation.manifest)
        hold = quota.lock_hold(db, reservation.quota_hold_id)
        if (
            hold.user_id != reservation.user_id
            or hold.category != StorageUsageCategory.UPLOAD
            or hold.bytes_held != manifest.snapshot.capture.byte_size
        ):
            raise ValueError("Take reservation quota lineage disagrees with its manifest")
        if not quota.consume_hold(db, reservation.quota_hold_id):
            raise ValueError("New Take completion requires an unconsumed quota hold")
        storage_usage_service.record_allocation(
            db,
            user_id=reservation.user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=hold.bytes_held,
            reason="performance_take_created",
            object_type="performance_take",
            object_id=manifest.take_uuid,
            storage_key=effects.commit_storage_object_key,
        )
    apply_transition(reservation, transition, now=now)
