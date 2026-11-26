"""The transaction participant that admits a verified recording as a durable Take."""

from app.modules.score_access.queries import active_score_predicate

from app.modules.account.resource_admission import lock_active_resource_user
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.score import Score
from app.db.models.performance_take import PerformanceTake
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.modules.media_storage.upload_sessions.domain import UploadPurpose, UploadMode
from app.db.models.take_processing_outbox import TakeProcessingOutbox
from .processing_states import TakeMediaStatus
from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.shared.time import utc_now
from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode
from .manifest import TakeManifest
from .manifest_persistence import manifest_from_row
from .repository import PerformanceTakeRepository
from .upload_reservation.domain import FinalizeLease
from .upload_reservation.persistence import lifecycle_from_row
from .upload_reservation.effects import apply_reservation_transition


class PerformanceTakeWriter:
    def __init__(
        self,
        repository: PerformanceTakeRepository,
        storage_usage_service: StorageUsageService,
        *,
        quota: StorageQuotaService,
        uploads: UploadSessionService,
    ) -> None:
        self.repository = repository
        self.storage_usage_service = storage_usage_service
        self.quota = quota
        self.uploads = uploads

    def adopt(
        self,
        db: Session,
        *,
        user_id: int,
        reservation_id: str,
        manifest: TakeManifest,
        lease: FinalizeLease,
    ) -> PerformanceTake:
        current_score = self.lock_allocation_parent(db, manifest)
        lock_active_resource_user(db, user_id)
        self.quota.lock_user(db, user_id)
        # Refresh under the authoritative row lock; callers cannot supply an unlocked row.
        reservation = self.repository.get_reservation_by_uuid(
            db, user_id, reservation_id, lock=True
        )
        if reservation is None or user_id != manifest.user_id:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="reservation_id")
        state = lifecycle_from_row(reservation)
        current_lease = state.require_current_lease(
            token=lease.token, object_key=lease.object_key, now=utc_now()
        )
        if current_lease != lease:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="candidate")
        if manifest_from_row(reservation.manifest) != manifest:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="manifest")
        if (
            reservation.upload_session.expected_byte_size,
            reservation.upload_session.expected_content_type,
        ) != (manifest.snapshot.capture.byte_size, manifest.snapshot.capture.mime_type):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="manifest")
        transition = state.complete(token=lease.token, object_key=lease.object_key, now=utc_now())
        blob = self.uploads.consume(
            db,
            uuid=reservation.upload_session.session_uuid,
            user_id=user_id,
            purpose=UploadPurpose.PERFORMANCE_TAKE,
        )
        take = PerformanceTake(
            owner_user_id=reservation.user_id,
            recording_object_id=blob.id,
            recording_object=blob,
            manifest_id=reservation.manifest_id,
            manifest=reservation.manifest,
            media_status=TakeMediaStatus.READY
            if reservation.upload_session.mode == UploadMode.SINGLE_PUT
            else TakeMediaStatus.UPLOADED,
            linked_score_id=current_score.id if current_score is not None else None,
        )
        self.repository.create_take(db, take)
        if take.media_status == TakeMediaStatus.UPLOADED:
            db.add(TakeProcessingOutbox(take_id=take.id))
        apply_reservation_transition(
            self.storage_usage_service, self.quota, db, reservation, transition, now=utc_now()
        )
        db.flush()
        return take

    @staticmethod
    def lock_allocation_parent(db: Session, manifest: TakeManifest) -> Score | None:
        """A linked Score precedes user capacity locks, matching Score graph cleanup."""
        return db.scalar(
            select(Score)
            .where(
                Score.score_uuid == manifest.snapshot.practice_binding.score_id,
                active_score_predicate(),
            )
            .with_for_update(read=True, key_share=True)
            .execution_options(populate_existing=True)
        )
