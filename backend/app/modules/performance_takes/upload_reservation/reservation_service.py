from __future__ import annotations
from app.modules.media_storage.delivery import MediaDeliveryService

from app.modules.performance_takes.upload_reservation.states import UploadReservationStatus

from dataclasses import asdict
from datetime import timedelta
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
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ResourceNotFoundException,
    ValidationException,
)
from app.db.models.performance_take_upload_reservation import (
    PerformanceTakeUploadReservation,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
)
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
from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now

from .effects import apply_reservation_transition
from .responses import reservation_read
from app.modules.media_storage.upload_sessions.service import UploadSessionService, lock_upload_user
from app.modules.media_storage.upload_sessions.domain import UploadPurpose
from app.modules.performance_takes.object_keys import performance_take_recording_object_key

TAKE_UPLOAD_RESERVATION_SECONDS = 3600


class PerformanceTakeReservationService:
    def __init__(
        self,
        *,
        quota: StorageQuotaService,
        delivery: MediaDeliveryService,
        storage_usage_service: StorageUsageService,
        uploads: UploadSessionService,
        practice_bundle_service: PracticeBundleService,
        repository: PerformanceTakeRepository | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.quota, self.uploads, self.storage_usage_service = quota, uploads, storage_usage_service
        self.takes = PerformanceTakeService(
            repository=self.repository, delivery=delivery, usage=storage_usage_service
        )
        self.practice_bundle_service = practice_bundle_service
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()

    def _replay_reservation(
        self,
        db: Session,
        row: PerformanceTakeUploadReservation,
        metadata: PerformanceTakeUploadMetadata,
    ) -> PerformanceTakeUploadReservationRead:
        manifest = manifest_from_row(row.manifest)
        if manifest.admitted_upload_metadata != metadata:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="client_request_id")
        take = self.repository.get_by_reservation(db, row.user_id, row.id)
        state = lifecycle_from_row(row)
        state.assert_take_presence(take is not None, allow_deleted_take=True)
        response = reservation_read(
            row,
            take=self.takes.get_take(db, row.user_id, manifest.take_uuid)
            if take is not None
            else None,
        )
        uuid, user_id, status = row.upload_session.session_uuid, row.user_id, row.status
        db.commit()
        db.close()
        if status == UploadReservationStatus.COMPLETED:
            if take is None:
                raise ResourceNotFoundException("performance_take", manifest.take_uuid)
            return response
        if status not in (UploadReservationStatus.RESERVED, UploadReservationStatus.FINALIZING):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="status")
        return response.model_copy(update={"upload_session": self.uploads.start(uuid, user_id)})

    def reserve_upload(
        self, db: Session, user_id: int, request: PerformanceTakeUploadReservationRequest
    ) -> PerformanceTakeUploadReservationRead:
        metadata = PerformanceTakeUploadMetadata.model_validate(
            request.model_dump(exclude={"client_request_id"})
        )
        media = metadata.media.model_copy(
            update={"mime_type": normalize_recording_mime(metadata.media.mime_type)}
        )
        metadata = metadata.model_copy(update={"media": media})
        if not is_admitted_recording_mime(media.kind, media.mime_type):
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="media_mime_type")
        try:
            self.uploads.policy.mode_for(
                UploadPurpose.PERFORMANCE_TAKE, media.byte_size, media.mime_type
            )
        except ValueError as error:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR, field="media_byte_size"
            ) from error
        existing = self.repository.get_reservation_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing is not None:
            lock_upload_user(db, user_id)
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
        lock_upload_user(db, user_id)
        self.quota.lock_user(db, user_id)
        existing = self.repository.get_reservation_by_client_request_id(
            db, user_id, request.client_request_id, lock=True
        )
        if existing is not None:
            return self._replay_reservation(db, existing, metadata)
        now, take_uuid = utc_now(), str(uuid4())
        expires = now + timedelta(seconds=self.uploads.policy.session_ttl_seconds)
        hold = self.quota.create_hold(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=media.byte_size,
            command_key="take:" + request.client_request_id,
            expires_at=expires,
            now=now,
        )
        manifest = TakeManifest(
            take_uuid,
            user_id,
            PerformanceTakeManifestRead.model_validate(
                {
                    "practice_binding": metadata.practice_binding,
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
        upload = self.uploads.admit(
            db,
            user_id=user_id,
            purpose=UploadPurpose.PERFORMANCE_TAKE,
            byte_size=media.byte_size,
            content_type=media.mime_type,
            final_key=performance_take_recording_object_key(
                user_id=user_id,
                take_uuid=take_uuid,
                object_generation=str(uuid4()),
                media_kind=media.kind,
                mime_type=media.mime_type,
            ),
        )
        manifest_row = self.repository.create_manifest(db, manifest_to_row(manifest))
        row = PerformanceTakeUploadReservation(
            user_id=user_id,
            client_request_id=request.client_request_id,
            upload_session_id=upload.id,
            upload_session=upload,
            quota_hold_id=hold.hold_id,
            expires_at=expires,
            manifest_id=manifest_row.id,
            manifest=manifest_row,
        )
        self.repository.create_reservation(db, row)
        return self._replay_reservation(db, row, metadata)

    def cancel_upload_reservation(self, db: Session, user_id: int, reservation_id: str) -> None:
        lock_upload_user(db, user_id)
        self.quota.lock_user(db, user_id)
        row = self.repository.get_reservation_by_uuid(db, user_id, reservation_id, lock=True)
        if row is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        transition = lifecycle_from_row(row).cancel(now=utc_now())
        apply_reservation_transition(
            self.storage_usage_service, self.quota, db, row, transition, now=utc_now()
        )
        self.uploads.cancel(db, row.upload_session_id)
        db.commit()
