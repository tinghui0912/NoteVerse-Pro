"""Application orchestration and outer transaction ownership for Take finalization."""

import asyncio
from datetime import timedelta
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.core.logger import logger
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage import AsyncObjectStorage
from app.storage.base import ObjectStorage
from app.storage.factory import object_storage
from app.utils.timezone import utc_now_naive
from .final_media import PerformanceTakeFinalMedia
from .writer import PerformanceTakeWriter
from .repository import PerformanceTakeRepository
from .manifest_persistence import manifest_from_row
from .recording_media_admission import recording_extension
from .schemas import PerformanceTakeRead
from .service import PerformanceTakeService
from .upload_reservation.domain import (
    FinalizeLease,
    ReservationTransitionError,
    UploadReservationStatus,
)
from .upload_reservation.persistence import lifecycle_from_row
from .upload_reservation.effects import apply_reservation_transition
from .upload_reservation.recovery import (
    PerformanceTakeFinalizationRecovery,
    is_transient_db_disconnect,
)

TAKE_FINALIZING_LEASE_SECONDS = 15 * 60


class PerformanceTakeFinalizationService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: ObjectStorage | None = None,
        storage_usage_service: StorageUsageService | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        usage = storage_usage_service or StorageUsageService()
        self.media = PerformanceTakeFinalMedia(AsyncObjectStorage(storage or object_storage))
        self.writer = PerformanceTakeWriter(self.repository, usage)
        self.recovery = PerformanceTakeFinalizationRecovery(self.repository, usage)
        self.takes = PerformanceTakeService(repository=self.repository, storage=storage)

    async def finalize_take(
        self, db: AsyncSession, user_id: int, reservation_id: str
    ) -> PerformanceTakeRead:
        row = await self.repository.get_reservation_by_uuid(db, user_id, reservation_id, lock=True)
        if row is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        manifest = manifest_from_row(row.manifest)
        existing = await self.repository.get_by_reservation(db, user_id, row.id)
        state = lifecycle_from_row(row)
        if state.status is UploadReservationStatus.COMPLETED and existing is None:
            raise ResourceNotFoundException("performance_take", manifest.take_uuid)
        state.assert_take_presence(existing is not None)
        if existing is not None:
            await db.commit()
            return await self.takes.get_take(db, user_id, manifest.take_uuid)
        now = utc_now_naive()
        token = str(uuid4())
        extension = recording_extension(
            manifest.snapshot.capture.kind, manifest.snapshot.capture.mime_type
        )
        lease = FinalizeLease(
            token,
            f"performance-takes/{user_id}/{manifest.take_uuid}/{token}.{extension}",
            now + timedelta(seconds=TAKE_FINALIZING_LEASE_SECONDS),
        )
        try:
            transition = state.begin_finalize(lease=lease, now=now)
        except ReservationTransitionError as error:
            if error.code == "reservation_expired":
                await apply_reservation_transition(
                    self.writer.storage_usage_service, db, row, state.expire(now=now), now=now
                )
            await db.commit()
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": state.status.value, "reason": error.code},
            ) from error
        await apply_reservation_transition(
            self.writer.storage_usage_service, db, row, transition, now=now
        )
        staging_key = row.staging_object_key
        await db.commit()
        try:
            candidate = await self.media.verify(manifest, lease, staging_key)
            # Long physical IO may outlive a connection; retry only the DB lock, never media.
            try:
                row = await self.repository.get_reservation_by_take_uuid(
                    db, user_id, manifest.take_uuid, lock=True
                )
            except Exception as error:
                if not is_transient_db_disconnect(error):
                    raise
                await self._discard_uncertain_session(db)
                row = await self.repository.get_reservation_by_take_uuid(
                    db, user_id, manifest.take_uuid, lock=True
                )
            if row is not None:
                winner = await self.repository.get_by_reservation(db, user_id, row.id)
                if winner is not None:
                    await self.recovery.recover_known_failure(
                        db, user_id=user_id, take_uuid=manifest.take_uuid, lease=lease
                    )
                    await db.commit()
                    return await self.takes.get_take(db, user_id, manifest.take_uuid)
            await self.writer.adopt(
                db,
                user_id=user_id,
                reservation_id=reservation_id,
                manifest=manifest,
                candidate=candidate,
            )
        except BaseException as error:
            # No semantic COMMIT has been invoked: rollback establishes a known non-commit.
            await db.rollback()
            disconnected = is_transient_db_disconnect(error)
            if disconnected:
                await db.invalidate()
            await self.recovery.recover_known_failure(
                db, user_id=user_id, take_uuid=manifest.take_uuid, lease=lease
            )
            await db.commit()
            if disconnected:
                raise ExternalServiceException(
                    "database",
                    details={"retryable": True, "operation": "performance_take_finalize"},
                ) from error
            if isinstance(error, ReservationTransitionError):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="status", details={"reason": error.code}
                ) from error
            raise

        # Only normal acknowledgement establishes success. Exception type cannot resolve COMMIT.
        try:
            await db.commit()
        except BaseException as error:
            try:
                await self._reconcile_unknown_commit(
                    db,
                    user_id=user_id,
                    take_uuid=manifest.take_uuid,
                    lease=lease,
                    cancelled=error if isinstance(error, asyncio.CancelledError) else None,
                )
            except Exception as recovery_error:
                # The persisted lease remains cleanup/recovery evidence if reconciliation fails.
                logger.bind(error_class=type(recovery_error).__name__).error(
                    "performance_take.finalize.lineage_recovery_failed"
                )
            raise ExternalServiceException(
                "database",
                details={"retryable": True, "operation": "performance_take_finalize"},
            ) from error
        return await self.takes.get_take(db, user_id, manifest.take_uuid)

    async def _reconcile_unknown_commit(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        take_uuid: str,
        lease: FinalizeLease,
        cancelled: asyncio.CancelledError | None,
    ) -> None:
        async def reconcile() -> None:
            # Discard is connection hygiene only; fresh persisted lineage decides the outcome.
            await self._discard_uncertain_session(db)
            await self.recovery.recover_unknown_commit(
                user_id=user_id, take_uuid=take_uuid, lease=lease
            )

        task = asyncio.create_task(reconcile())
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError as error:
                cancelled = error
            except Exception:
                if cancelled is None:
                    raise
        if cancelled is not None:
            if not task.cancelled():
                failure = task.exception()
                if failure is not None:
                    logger.bind(error_class=type(failure).__name__).error(
                        "performance_take.finalize.lineage_recovery_failed"
                    )
            raise cancelled
        task.result()

    @staticmethod
    async def _discard_uncertain_session(db: AsyncSession) -> None:
        try:
            await db.rollback()
        except Exception:
            logger.debug("performance_take.finalize.db_rollback_failed_after_uncertainty")
        try:
            await db.invalidate()
        except Exception:
            logger.debug("performance_take.finalize.db_invalidate_failed_after_uncertainty")
