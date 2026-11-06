from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.db.models.stored_object import StoredObject
from app.db.models import PerformanceTake, PerformanceTakeUploadReservation
from app.modules.performance_takes.upload_reservation.domain import UploadReservationStatus
from app.modules.performance_takes.upload_reservation.persistence import (
    apply_transition,
    lifecycle_from_row,
)
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import ObjectStorage
from app.utils.timezone import utc_now_naive


class UploadReservationCleanupService:
    """Bounded recovery and reference-aware cleanup of reservation-owned objects."""

    def cleanup_expired_reservations(
        self, db: Session, storage: ObjectStorage, storage_usage_service: StorageUsageService
    ) -> int:
        now = utc_now_naive()
        ids = list(
            db.scalars(
                select(PerformanceTakeUploadReservation.id)
                .where(
                    or_(
                        (
                            PerformanceTakeUploadReservation.status
                            == UploadReservationStatus.RESERVED.value
                        )
                        & (PerformanceTakeUploadReservation.expires_at <= now),
                        (
                            PerformanceTakeUploadReservation.status
                            == UploadReservationStatus.FINALIZING.value
                        )
                        & (PerformanceTakeUploadReservation.finalizing_expires_at <= now),
                        (
                            PerformanceTakeUploadReservation.status.in_(
                                [
                                    UploadReservationStatus.COMPLETED.value,
                                    UploadReservationStatus.CANCELLED.value,
                                    UploadReservationStatus.EXPIRED.value,
                                ]
                            )
                        )
                        & PerformanceTakeUploadReservation.staging_cleanup_completed_at.is_(None)
                        & (PerformanceTakeUploadReservation.staging_cleanup_after <= now),
                        PerformanceTakeUploadReservation.orphan_final_object_keys != "[]",
                    )
                )
                .order_by(PerformanceTakeUploadReservation.created_at)
                .limit(100)
            )
        )
        db.commit()
        cleaned = 0
        for row_id in ids:
            # Commit recovery before slow storage IO. A candidate is eligible
            # only after its lease has relinquished it and its grace has elapsed.
            with db.begin():
                row = db.scalar(
                    select(PerformanceTakeUploadReservation)
                    .where(PerformanceTakeUploadReservation.id == row_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if row is None:
                    continue
                state = lifecycle_from_row(row)
                take = db.scalar(
                    select(PerformanceTake).where(PerformanceTake.manifest_id == row.manifest_id)
                )
                state.assert_take_presence(take is not None, allow_deleted_take=True)
                transition = state.recover_due(now=now)
                apply_transition(row, transition, now=now)
                effects = transition.effects
                if effects.release_storage_reservation:
                    storage_usage_service.release_reservation_sync(
                        db, row.storage_reservation_id, auto_commit=False
                    )
                state = transition.after
                staging_key = row.staging_object_key if state.can_cleanup_staging(now=now) else None
                orphan_keys = tuple(
                    candidate.key
                    for candidate in state.cleanup_candidates(now=now)
                    if db.scalar(
                        select(StoredObject.id).where(
                            StoredObject.object_key == candidate.key,
                        )
                    )
                    is None
                )
            absent: set[str] = set()
            staging_absent = False
            try:
                if staging_key is not None:
                    if storage.exists(staging_key):
                        storage.delete(staging_key)
                    staging_absent = not storage.exists(staging_key)
                for key in orphan_keys:
                    # Candidates are immutable unique lease keys; recovery never
                    # installs an abandoned candidate as a new current lease.
                    if storage.exists(key):
                        storage.delete(key)
                    if not storage.exists(key):
                        absent.add(key)
            except Exception:
                logger.bind(resource_id=row_id).opt(exception=True).error(
                    "performance_take_upload_reservation.cleanup_object_delete_failed"
                )
            with db.begin():
                row = db.scalar(
                    select(PerformanceTakeUploadReservation)
                    .where(PerformanceTakeUploadReservation.id == row_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                if row is None:
                    continue
                state = lifecycle_from_row(row)
                # A refreshed grace or newly observed Take always wins over a
                # stale cleanup result.
                referenced = set(
                    db.scalars(
                        select(StoredObject.object_key).where(
                            StoredObject.object_key.in_(absent),
                        )
                    )
                )
                absent -= referenced
                completion = state.finish_cleanup(
                    now=now, absent_candidates=frozenset(absent), staging_absent=staging_absent
                )
                apply_transition(row, completion, now=now)
                if transition.after != transition.before or completion.after != completion.before:
                    cleaned += 1
        return cleaned


upload_reservation_cleanup_service = UploadReservationCleanupService()
