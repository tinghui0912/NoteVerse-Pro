"""Application orchestration and outer transaction ownership for Take finalization."""

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
        committing = False
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
                await self._discard_connection(db)
                row = await self.repository.get_reservation_by_take_uuid(
                    db, user_id, manifest.take_uuid, lock=True
                )
            if row is not None:
                winner = await self.repository.get_by_reservation(db, user_id, row.id)
                if winner is not None:
                    await self.recovery.recover(
                        db,
                        user_id=user_id,
                        take_uuid=manifest.take_uuid,
                        lease=lease,
                        unknown_outcome=False,
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
            committing = True
            await db.commit()
        except BaseException as error:
            disconnected = is_transient_db_disconnect(error)
            if disconnected:
                await self._discard_connection(db)
                await self.recovery.after_disconnect(
                    user_id=user_id, take_uuid=manifest.take_uuid, lease=lease
                )
                raise ExternalServiceException(
                    "database",
                    details={"retryable": True, "operation": "performance_take_finalize"},
                ) from error
            # A failed COMMIT with no reliable acknowledgement is conservatively unknown.
            await db.rollback()
            await self.recovery.recover(
                db,
                user_id=user_id,
                take_uuid=manifest.take_uuid,
                lease=lease,
                unknown_outcome=committing,
            )
            await db.commit()
            if isinstance(error, ReservationTransitionError):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="status", details={"reason": error.code}
                ) from error
            raise
        return await self.takes.get_take(db, user_id, manifest.take_uuid)

    @staticmethod
    async def _discard_connection(db: AsyncSession) -> None:
        try:
            await db.rollback()
        except Exception:
            logger.debug("performance_take.finalize.db_rollback_failed_after_disconnect")
        await db.invalidate()
