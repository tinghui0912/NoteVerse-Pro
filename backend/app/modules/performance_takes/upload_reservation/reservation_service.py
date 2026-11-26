from __future__ import annotations
from app.modules.account.resource_admission import lock_active_resource_user
from app.storage import ObjectStorage

from app.shared.performance_take_upload import UploadReservationStatus
from app.modules.performance_takes.object_keys import performance_take_staging_object_key

from dataclasses import asdict
from datetime import datetime, timedelta
from uuid import uuid4

from app.modules.performance_takes.manifest import TakeManifest
from app.modules.performance_takes.recording_media_admission import (
    normalize_recording_mime,
    is_admitted_recording_mime,
)
from app.modules.performance_takes.manifest_persistence import (
    manifest_from_row,
    manifest_to_row,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundException,
    ValidationException,
)
from app.db.models.performance_take_upload_reservation import (
    PerformanceTakeUploadReservation,
)
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.upload_reservation.domain import (
    ReservationTransitionError,
)
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
    initialize_lifecycle,
)
from app.modules.performance_takes.upload_reservation.domain import UploadReservationLifecycle
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeManifestRead,
    PerformanceTakeTempoPlan,
    PerformanceTakeUploadReservationRead,
    PerformanceTakeUploadReservationRequest,
    PerformanceTakeUploadMetadata,
)
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.planning.score_plan import (
    PlanningMoment,
    PracticePlanningScore,
    FullScopeSelection,
    RangeScopeSelection,
    ScoreTempoSelection,
    CustomTempoSelection,
    PracticePlanningError,
    resolve_practice_score_plan,
)
from app.modules.practice.score.domain import PracticeTempoSegment

from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.storage_usage.service import StorageUsageService
from app.modules.storage_quota.service import StorageQuotaService
from app.shared.error_codes import CustomerErrorCode
from app.storage.factory import object_storage
from app.shared.time import utc_now

from .effects import apply_reservation_transition
from .responses import reservation_read, completed_reservation_response

TAKE_UPLOAD_RESERVATION_SECONDS = 3600


class PerformanceTakeReservationService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: ObjectStorage | None = None,
        storage_usage_service: StorageUsageService | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
        practice_bundle_service: PracticeBundleService | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.takes = PerformanceTakeService(
            repository=repository,
            storage=storage,
            score_access_policy=score_access_policy,
        )
        self.storage = storage or object_storage
        self.storage_usage_service = storage_usage_service or StorageUsageService()
        self.quota = StorageQuotaService(self.storage_usage_service)
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()
        self.practice_bundle_service = practice_bundle_service or PracticeBundleService(
            access_policy=self.score_access_policy,
            storage=storage,
        )

    def _put_url_expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS)

    def _expire_reservation(
        self,
        db: Session,
        reservation: PerformanceTakeUploadReservation,
    ) -> str:
        now = utc_now()
        apply_reservation_transition(
            self.storage_usage_service,
            self.quota,
            db,
            reservation,
            lifecycle_from_row(reservation).expire(now=now),
            now=now,
        )
        db.commit()
        return reservation.staging_object_key

    def _replay_reservation(
        self,
        db: Session,
        reservation: PerformanceTakeUploadReservation,
        metadata: PerformanceTakeUploadMetadata,
    ) -> PerformanceTakeUploadReservationRead:
        state = lifecycle_from_row(reservation)
        status = state.status
        completed_take = self.repository.get_by_reservation(db, reservation.user_id, reservation.id)
        if state.status is UploadReservationStatus.COMPLETED and completed_take is None:
            raise ResourceNotFoundException("performance_take", reservation.manifest.take_uuid)
        state.assert_take_presence(completed_take is not None)
        if status not in {
            UploadReservationStatus.RESERVED,
            UploadReservationStatus.FINALIZING,
            UploadReservationStatus.COMPLETED,
        }:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{status.value.lower()}"},
            )
        if manifest_from_row(reservation.manifest).admitted_upload_metadata != metadata:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "client_request_id_reuse_conflict"},
            )
        if completed_take is not None:
            return completed_reservation_response(self.takes, db, reservation, completed_take)
        if status == UploadReservationStatus.FINALIZING:
            return reservation_read(reservation)
        if status != UploadReservationStatus.RESERVED:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{status.value.lower()}"},
            )
        if reservation.expires_at <= utc_now():
            self._expire_reservation(db, reservation)
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "client_request_id_expired_use_new_id"},
            )
        upload_target = self.storage.generate_put_upload_url(
            key=reservation.staging_object_key,
            content_type=manifest_from_row(reservation.manifest).snapshot.capture.mime_type,
            content_length=manifest_from_row(reservation.manifest).snapshot.capture.byte_size,
        )
        now = utc_now()
        apply_reservation_transition(
            self.storage_usage_service,
            self.quota,
            db,
            reservation,
            lifecycle_from_row(reservation).refresh_upload(
                now=now, put_expires_at=self._put_url_expires_at(now)
            ),
            now=now,
        )
        response = reservation_read(reservation, upload_target=upload_target)
        db.commit()
        return response

    def reserve_upload(
        self,
        db: Session,
        user_id: int,
        request: PerformanceTakeUploadReservationRequest,
    ) -> PerformanceTakeUploadReservationRead:
        metadata = PerformanceTakeUploadMetadata.model_validate(
            request.model_dump(exclude={"client_request_id"})
        )
        media = metadata.media
        media = media.model_copy(update={"mime_type": normalize_recording_mime(media.mime_type)})
        metadata = metadata.model_copy(update={"media": media})
        if not is_admitted_recording_mime(media.kind, media.mime_type):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="media_mime_type")
        # Discovery does not admit a command or acquire a business row lock.
        existing = self.repository.get_reservation_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing is not None:
            lock_active_resource_user(db, user_id)
            self.quota.lock_user(db, user_id)
            existing = self.repository.get_reservation_by_client_request_id(
                db, user_id, request.client_request_id, lock=True
            )
            if existing is None:
                raise ResourceNotFoundException("upload_reservation", request.client_request_id)
            return self._replay_reservation(db, existing, metadata)
        authorized_bundle = self.practice_bundle_service.authorize_bundle_for_save(
            db,
            user_id,
            metadata.practice_binding.score_id,
            metadata.practice_binding.revision_id,
            metadata.practice_binding.bundle_id,
        )
        bundle_ref = authorized_bundle.bundle_ref
        artifact = authorized_bundle.bundle.artifact.value
        score = PracticePlanningScore(
            tuple(
                PlanningMoment(moment["groupId"], moment["onsetTick"], moment["canonicalEndTick"])
                for moment in artifact["moments"]
            ),
            artifact["scoreEndTick"],
            tuple(
                PracticeTempoSegment(segment["startTick"], segment["bpm"])
                for segment in artifact["scoreTempoSegments"]
            ),
            artifact["ticksPerQuarter"],
        )
        scope_selection = (
            FullScopeSelection()
            if metadata.scope.kind == "FULL"
            else RangeScopeSelection(metadata.scope.start_group_id, metadata.scope.end_group_id)
        )
        tempo_selection = (
            ScoreTempoSelection()
            if metadata.tempo_selection.mode == "SCORE"
            else CustomTempoSelection(metadata.tempo_selection.bpm)
        )
        try:
            plan = resolve_practice_score_plan(score, scope_selection, tempo_selection)
        except PracticePlanningError as error:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR, field=error.field
            ) from error
        tempo_plan = PerformanceTakeTempoPlan.model_validate(
            {
                "selection": asdict(plan.tempo_plan.selection),
                "segments": [
                    {"startTick": segment.start_tick, "bpm": segment.bpm, "source": segment.source}
                    for segment in plan.tempo_plan.segments
                ],
            }
        )
        # Save admission holds the Score/Bundle parents before user capacity locks.
        # Recheck the client identity after serialization; a competing creator may have won.
        lock_active_resource_user(db, user_id)
        self.quota.lock_user(db, user_id)
        existing = self.repository.get_reservation_by_client_request_id(
            db, user_id, request.client_request_id, lock=True
        )
        if existing is not None:
            return self._replay_reservation(db, existing, metadata)
        take_uuid = str(uuid4())
        staging_key = performance_take_staging_object_key(
            user_id=user_id, take_uuid=take_uuid, media_kind=media.kind, mime_type=media.mime_type
        )
        upload_target = self.storage.generate_put_upload_url(
            key=staging_key, content_type=media.mime_type, content_length=media.byte_size
        )
        now = utc_now()
        hold = self.quota.create_hold(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=media.byte_size,
            command_key="take:" + request.client_request_id,
            expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
            now=now,
        )
        put_expiry = self._put_url_expires_at(now)
        manifest = TakeManifest(
            take_uuid,
            user_id,
            PerformanceTakeManifestRead.model_validate(
                {
                    "practice_binding": {
                        "bundle_id": bundle_ref.bundle_id,
                        "score_id": authorized_bundle.score_uuid,
                        "revision_id": authorized_bundle.revision_uuid,
                    },
                    "artifact_id": bundle_ref.artifact_id,
                    "score_display_title_snapshot": authorized_bundle.score_display_title,
                    "capture": media,
                    "score_timebase": {"ticks_per_quarter": score.ticks_per_quarter},
                    "scope": {
                        key: value for key, value in asdict(plan.scope).items() if value is not None
                    },
                    "tempo_plan": tempo_plan,
                    "recording_timebase": metadata.recording_timebase,
                }
            ),
        )
        manifest_row = manifest_to_row(manifest)
        reservation = PerformanceTakeUploadReservation(
            user_id=user_id,
            client_request_id=request.client_request_id,
            staging_object_key=staging_key,
            quota_hold_id=hold.hold_id,
            expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
        )
        initialize_lifecycle(
            reservation,
            UploadReservationLifecycle.reserved(
                expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
                put_expires_at=put_expiry,
            ),
        )
        try:
            self.repository.create_manifest(db, manifest_row)
            reservation.manifest_id = manifest_row.id
            reservation.manifest = manifest_row
            self.repository.create_reservation(db, reservation)
            response = reservation_read(reservation, upload_target=upload_target)
            db.commit()
        except IntegrityError:
            db.rollback()
            lock_active_resource_user(db, user_id)
            self.quota.lock_user(db, user_id)
            winner = self.repository.get_reservation_by_client_request_id(
                db,
                user_id,
                request.client_request_id,
                lock=True,
            )
            if winner is None:
                raise
            return self._replay_reservation(db, winner, metadata)
        except Exception:
            db.rollback()
            raise
        return response

    def cancel_upload_reservation(
        self,
        db: Session,
        user_id: int,
        reservation_id: str,
    ) -> None:
        lock_active_resource_user(db, user_id)
        self.quota.lock_user(db, user_id)
        reservation = self.repository.get_reservation_by_uuid(
            db, user_id, reservation_id, lock=True
        )
        if reservation is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        now = utc_now()
        state = lifecycle_from_row(reservation)
        take = self.repository.get_by_reservation(db, user_id, reservation.id)
        state.assert_take_presence(take is not None, allow_deleted_take=True)
        try:
            transition = state.cancel(now=now)
        except ReservationTransitionError as error:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR, field="status", details={"reason": error.code}
            ) from error
        apply_reservation_transition(
            self.storage_usage_service, self.quota, db, reservation, transition, now=now
        )
        db.commit()
