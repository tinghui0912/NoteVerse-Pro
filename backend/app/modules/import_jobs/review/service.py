from __future__ import annotations
from app.composition.storage_resources import storage_quota_service
from app.modules.account.resource_admission import lock_active_resource_user
from uuid import uuid4
from datetime import timedelta
from app.shared.time import utc_now

from app.modules.revisions.object_keys import canonical_revision_source_object_key
from app.modules.import_jobs.object_keys import review_musicxml_object_key
from app.modules.import_jobs.artifact_records import REVIEW_MUSICXML_MIME_TYPE
from app.storage import ObjectStorage
from app.modules.storage_objects.retirement import retire_after_release
from app.modules.storage_objects.writes import write_object, adopt_written_object

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportDispatch,
    Score,
    StorageUsageCategory,
)
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.lifecycle import mark_confirmed
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.import_jobs.notifications import (
    admit_import_confirmation_consequences,
)
from app.modules.revisions.writer import (
    revision_writer,
    PreparedRevisionSource,
    InitialRevisionWrite,
)
from app.modules.revisions.post_commit import revision_post_commit
from app.core.logger import logger
from app.modules.scores.input_asset_lifecycle import score_input_asset_lifecycle
from app.modules.import_jobs.review.read_model import ImportReviewReadModel
from app.modules.import_jobs.review.schemas import (
    ImportJobReviewRead,
    ReviewConfirmRead,
    ReviewConfirmRequest,
    ReviewUpdateRequest,
)
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.genres import ScoreGenre
from app.processing.musicxml.admission import admit_musicxml_document
from app.modules.import_jobs.requested_options import (
    ImportJobRequestedOptionsV1,
    decode_requested_options,
)
from app.modules.storage_usage.service import storage_usage_service
from app.shared.error_codes import CustomerErrorCode
from app.db.models.import_job import ImportArtifactKind
from app.storage import object_storage
from app.processing.musicxml.notation_title import extract_notation_title


class ImportReviewService:
    def __init__(
        self,
        storage: ObjectStorage | None = None,
        score_repository: ScoreRepository | None = None,
        read_model: ImportReviewReadModel | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.score_repository = score_repository or ScoreRepository()
        self.read_model = read_model or ImportReviewReadModel(self.storage)

    def detail(
        self,
        db: Session,
        job_uuid: str,
        user_id: int,
    ) -> ImportJobReviewRead:
        return self.read_model.detail(db, job_uuid, user_id)

    def confirm(
        self,
        db: Session,
        job_uuid: str,
        user_id: int,
        request: ReviewConfirmRequest,
    ) -> ReviewConfirmRead:
        # Confirmation can release owned binaries; acquire its delivery lock first.
        dispatch = (
            db.execute(
                select(ImportDispatch)
                .join(ImportJob, ImportJob.id == ImportDispatch.job_id)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update(of=ImportDispatch)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        job = (
            db.execute(
                select(ImportJob)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, CustomerErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if dispatch is None:
            raise RuntimeError("Import job requires a durable dispatch")
        if job.state == ImportJobState.CONFIRMED:
            score = (
                ImportJobRepository()
                .live_scores_for_import_jobs(
                    db, {require_persisted_id(job.id, entity="import job")}
                )
                .get(job.id)
            )
            if score:
                return ReviewConfirmRead(score_id=score.score_uuid)
        if job.state != ImportJobState.READY_FOR_REVIEW:
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        content = admit_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()
        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        now = utc_now()
        options = decode_requested_options(job.requested_options)
        display_title = self._confirmed_display_title(options, request, content)
        genres = self._confirmed_genres(options, request)
        key = canonical_revision_source_object_key(
            score_uuid=score_uuid, revision_uuid=revision_uuid
        )
        lock_active_resource_user(db, user_id)
        reservation = storage_quota_service.create_hold(
            db,
            user_id=user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            command_key=str(uuid4()),
            expires_at=utc_now() + timedelta(minutes=15),
        )
        try:
            db.commit()
            stored = write_object(
                db,
                self.storage,
                key=key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            db.rollback()
            storage_quota_service.release_hold(db, reservation.hold_id)
            db.commit()
            raise

        try:
            db.execute(
                select(ImportDispatch)
                .where(ImportDispatch.job_id == job.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            job = (
                db.execute(
                    select(ImportJob)
                    .where(ImportJob.job_uuid == job_uuid)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if job is None:
                raise ResourceNotFoundException("job", job_uuid, CustomerErrorCode.JOB_NOT_FOUND)
            if job.state == ImportJobState.CONFIRMED:
                existing = (
                    ImportJobRepository()
                    .live_scores_for_import_jobs(
                        db, {require_persisted_id(job.id, entity="import job")}
                    )
                    .get(job.id)
                )
                if existing is not None:
                    storage_quota_service.release_hold(db, reservation.hold_id)
                    db.commit()
                    return ReviewConfirmRead(score_id=existing.score_uuid)
            if job.user_id != user_id or job.state != ImportJobState.READY_FOR_REVIEW:
                raise ConflictException(CustomerErrorCode.VALIDATION_ERROR, {"job_id": job_uuid})
            score = Score(
                score_uuid=score_uuid,
                owner_user_id=user_id,
                display_title=display_title,
                genres=[genre.value for genre in genres],
                created_from_import_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
                updated_at=now,
            )
            db.add(score)
            db.flush()
            score_id = require_persisted_id(score.id, entity="score")
            prepared = PreparedRevisionSource(
                revision_uuid,
                stored,
                content_hash,
                "review-confirm",
                "1",
                reservation.hold_id,
            )
            write_result = revision_writer.write(
                db,
                InitialRevisionWrite(
                    score_uuid,
                    user_id,
                    prepared,
                    f"job-confirm:{job_uuid}",
                ),
            )
            score_input_asset_lifecycle.promote_import_uploads(
                db,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_id=score_id,
                user_id=user_id,
            )
            mark_confirmed(job, now=utc_now())
            ImportJobDeletionService().cleanup_binary_artifacts(db, job, user_id)
            admit_import_confirmation_consequences(
                db,
                job,
                score_id=score_uuid,
                score_display_title=display_title,
            )
            db.commit()
        except Exception:
            db.rollback()
            storage_quota_service.release_hold(db, reservation.hold_id)
            db.commit()
            raise

        work = write_result.post_commit_work
        if work is not None:
            try:
                revision_post_commit.dispatch_best_effort(work)
            except Exception as exc:
                logger.bind(
                    event="revision_post_commit.coordinator_failed",
                    score_id=work.score_id,
                    revision_id=work.revision_id,
                    exception_type=type(exc).__name__,
                ).warning("revision_post_commit.coordinator_failed")

        return ReviewConfirmRead(score_id=score_uuid)

    def update(
        self,
        db: Session,
        job_uuid: str,
        user_id: int,
        request: ReviewUpdateRequest,
    ) -> ImportJobReviewRead:
        job = (
            db.execute(select(ImportJob).where(ImportJob.job_uuid == job_uuid).with_for_update())
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, CustomerErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(CustomerErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if job.state != ImportJobState.READY_FOR_REVIEW:
            raise ConflictException(
                CustomerErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        content = admit_musicxml_document(content)
        job_id = require_persisted_id(job.id, entity="import job")
        artifact = (
            db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if artifact is None:
            raise ResourceNotFoundException(
                "import_artifact", job_uuid, CustomerErrorCode.XML_NOT_FOUND
            )

        stored = write_object(
            db,
            self.storage,
            key=review_musicxml_object_key(
                job_uuid=job_uuid, content_sha256=hashlib.sha256(content).hexdigest()
            ),
            content=content,
            content_type=REVIEW_MUSICXML_MIME_TYPE,
        )
        job = (
            db.execute(
                select(ImportJob)
                .where(ImportJob.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if job.user_id != user_id or job.state != ImportJobState.READY_FOR_REVIEW:
            raise ConflictException(CustomerErrorCode.VALIDATION_ERROR, {"job_id": job_uuid})
        lock_active_resource_user(db, user_id)
        artifact = (
            db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        storage_usage_service.committed_bytes(db, user_id, lock=True)
        previous_object = artifact.stored_object
        old_artifact_uuid = artifact.artifact_uuid
        old_storage_key = artifact.stored_object.object_key
        old_size_bytes = artifact.stored_object.byte_size or 0
        try:
            artifact.stored_object = adopt_written_object(db, stored)
            artifact.filename = stored.object_key.rsplit("/", 1)[-1]
            db.flush()
            job.updated_at = utc_now()
            storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=old_size_bytes,
                reason="review_musicxml_replaced",
                object_type="import_artifact",
                object_id=old_artifact_uuid,
                storage_key=old_storage_key,
            )
            storage_usage_service.record_allocation(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=stored.size_bytes,
                reason="review_musicxml_updated",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=stored.object_key,
            )
            retire_after_release(db, previous_object.id)
            db.commit()
        except Exception:
            db.rollback()
            raise

        return self.detail(db, job_uuid, user_id)

    @staticmethod
    def _confirmed_display_title(
        options: ImportJobRequestedOptionsV1,
        request: ReviewConfirmRequest,
        content: bytes,
    ) -> str:
        if request.display_title is not None:
            return request.display_title.strip()
        requested_display_title = options.display_title
        return (
            requested_display_title.strip()
            if requested_display_title is not None and requested_display_title.strip()
            else extract_notation_title(content) or "Untitled score"
        )

    @staticmethod
    def _confirmed_genres(
        options: ImportJobRequestedOptionsV1, request: ReviewConfirmRequest
    ) -> list[ScoreGenre]:
        if request.genres is not None:
            return request.genres
        return options.genres


import_review_service = ImportReviewService()
