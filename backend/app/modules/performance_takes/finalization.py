"""Application orchestration and outer transaction ownership for Take finalization."""

import asyncio
from datetime import timedelta
from uuid import uuid4
from sqlalchemy.orm import Session
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.core.logger import logger
from app.modules.storage_usage.service import StorageUsageService
from app.shared.error_codes import CustomerErrorCode
from app.storage import ObjectStorage
from app.storage.factory import object_storage
from app.shared.time import utc_now
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
        self.media = PerformanceTakeFinalMedia(storage or object_storage)
        self.writer = PerformanceTakeWriter(self.repository, usage)
        self.recovery = PerformanceTakeFinalizationRecovery(self.repository, usage)
        self.takes = PerformanceTakeService(repository=self.repository, storage=storage)

    def finalize_take(self, db: Session, user_id: int, reservation_id: str) -> PerformanceTakeRead:
        row = self.repository.get_reservation_by_uuid(db, user_id, reservation_id, lock=True)
        if row is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        manifest = manifest_from_row(row.manifest)
        existing = self.repository.get_by_reservation(db, user_id, row.id)
        state = lifecycle_from_row(row)
        if state.status is UploadReservationStatus.COMPLETED and existing is None:
            raise ResourceNotFoundException("performance_take", manifest.take_uuid)
        state.assert_take_presence(existing is not None)
        if existing is not None:
            db.commit()
            return self.takes.get_take(db, user_id, manifest.take_uuid)
        now = utc_now()
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
                apply_reservation_transition(
                    self.writer.storage_usage_service, db, row, state.expire(now=now), now=now
                )
            db.commit()
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": state.status.value, "reason": error.code},
            ) from error
        apply_reservation_transition(
            self.writer.storage_usage_service, db, row, transition, now=now
        )
        staging_key = row.staging_object_key
        db.commit()
        try:
            candidate = self.media.verify(manifest, lease, staging_key)
            # Long physical IO may outlive a connection; retry only the DB lock, never media.
            try:
                row = self.repository.get_reservation_by_take_uuid(
                    db, user_id, manifest.take_uuid, lock=True
                )
            except Exception as error:
                if not is_transient_db_disconnect(error):
                    raise
                self._discard_uncertain_session(db)
                row = self.repository.get_reservation_by_take_uuid(
                    db, user_id, manifest.take_uuid, lock=True
                )
            if row is not None:
                winner = self.repository.get_by_reservation(db, user_id, row.id)
                if winner is not None:
                    self.recovery.recover_known_failure(
                        db, user_id=user_id, take_uuid=manifest.take_uuid, lease=lease
                    )
                    db.commit()
                    return self.takes.get_take(db, user_id, manifest.take_uuid)
            self.writer.adopt(
                db,
                user_id=user_id,
                reservation_id=reservation_id,
                manifest=manifest,
                candidate=candidate,
            )
        except BaseException as error:
            # No semantic COMMIT has been invoked: rollback establishes a known non-commit.
            db.rollback()
            disconnected = is_transient_db_disconnect(error)
            if disconnected:
                db.invalidate()
            self.recovery.recover_known_failure(
                db, user_id=user_id, take_uuid=manifest.take_uuid, lease=lease
            )
            db.commit()
            if disconnected:
                raise ExternalServiceException(
                    "database",
                    details={"retryable": True, "operation": "performance_take_finalize"},
                ) from error
            if isinstance(error, ReservationTransitionError):
                raise ValidationException(
                    CustomerErrorCode.VALIDATION_ERROR,
                    field="status",
                    details={"reason": error.code},
                ) from error
            raise

        # Only normal acknowledgement establishes success. Exception type cannot resolve COMMIT.
        try:
            db.commit()
        except BaseException as error:
            try:
                self._reconcile_unknown_commit(
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
        return self.takes.get_take(db, user_id, manifest.take_uuid)

    def _reconcile_unknown_commit(
        self,
        db: Session,
        *,
        user_id: int,
        take_uuid: str,
        lease: FinalizeLease,
        cancelled: asyncio.CancelledError | None,
    ) -> None:
        try:
            self._discard_uncertain_session(db)
            self.recovery.recover_unknown_commit(user_id=user_id, take_uuid=take_uuid, lease=lease)
        finally:
            if cancelled is not None:
                raise cancelled

    @staticmethod
    def _discard_uncertain_session(db: Session) -> None:
        try:
            db.rollback()
        except Exception:
            logger.debug("performance_take.finalize.db_rollback_failed_after_uncertainty")
        try:
            db.invalidate()
        except Exception:
            logger.debug("performance_take.finalize.db_invalidate_failed_after_uncertainty")
