from __future__ import annotations
from app.storage import AsyncObjectStorage
from app.modules.storage_objects.retirement import retire_after_release
from app.modules.storage_objects.writes import write_object_async, adopt_written_object

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.import_jobs.events import ImportJobConfirmed
from app.modules.domain_events.journal import append_fact
from app.modules.import_jobs.projections import catch_up_import_projections_best_effort
from app.modules.score_assets.render_outbox_service import (
    create_review_thumbnail_render_outbox,
)
from app.modules.revisions.writer import (
    revision_writer,
    PreparedRevisionSource,
    InitialRevisionWrite,
)
from app.modules.revisions.fast_path import revision_fast_path
from app.modules.import_jobs.review.confirmation_assets import (
    prewrite_review_thumbnail,
    adopt_review_thumbnail,
    promote_uploads_to_score_inputs,
)
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
from app.modules.import_jobs.schemas import processing_options_adapter
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import ObjectStorage, object_storage
from app.utils.timezone import utc_now_naive


class ImportReviewService:
    def __init__(
        self,
        storage: ObjectStorage | None = None,
        score_repository: ScoreRepository | None = None,
        read_model: ImportReviewReadModel | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.async_storage = AsyncObjectStorage(self.storage)
        self.score_repository = score_repository or ScoreRepository()
        self.read_model = read_model or ImportReviewReadModel(self.storage)

    async def detail(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
    ) -> ImportJobReviewRead:
        return await self.read_model.detail(db, job_uuid, user_id)

    async def confirm(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
        request: ReviewConfirmRequest,
    ) -> ReviewConfirmRead:
        # Confirmation can release owned binaries; acquire its delivery lock first.
        dispatch = (
            await db.execute(
                select(ImportDispatch)
                .join(ImportJob, ImportJob.id == ImportDispatch.job_id)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update(of=ImportDispatch)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        job = (
            await db.execute(
                select(ImportJob)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if dispatch is None:
            raise RuntimeError("Import job requires a durable dispatch")
        if job.score_id is not None:
            score = await db.get(Score, job.score_id)
            if score:
                return ReviewConfirmRead(score_id=score.score_uuid)
        if job.state != ImportJobState.PENDING_REVIEW:
            raise ConflictException(
                ErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        content = admit_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()
        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        now = utc_now_naive()
        title = self._confirmed_title(job, request)
        genres = self._confirmed_genres(job, request)
        key = f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        reservation = await storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="review_confirm",
            object_type="score_revision_source",
        )
        business_committed = False
        try:
            stored = await write_object_async(
                db,
                self.async_storage,
                key=key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
            thumbnail_write = await prewrite_review_thumbnail(
                db,
                storage=self.async_storage,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
            )
        except Exception:
            await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

        try:
            await db.execute(
                select(ImportDispatch)
                .where(ImportDispatch.job_id == job.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            job = (
                await db.execute(
                    select(ImportJob)
                    .where(ImportJob.job_uuid == job_uuid)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if job is None:
                raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
            if job.score_id is not None:
                existing = await db.get(Score, job.score_id)
                if existing is not None:
                    await storage_usage_service.release_reservation(db, reservation.reservation_id)
                    return ReviewConfirmRead(score_id=existing.score_uuid)
            if job.user_id != user_id or job.state != ImportJobState.PENDING_REVIEW:
                raise ConflictException(ErrorCode.VALIDATION_ERROR, {"job_id": job_uuid})
            score = Score(
                score_uuid=score_uuid,
                owner_user_id=user_id,
                title=title,
                genres=[genre.value for genre in genres],
                originating_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
                updated_at=now,
            )
            db.add(score)
            await db.flush()
            score_id = require_persisted_id(score.id, entity="score")
            prepared = PreparedRevisionSource(
                revision_uuid,
                stored,
                content_hash,
                "review-confirm",
                "1",
                reservation.reservation_id,
            )
            write_result = await db.run_sync(
                lambda sync: revision_writer.write(
                    sync,
                    InitialRevisionWrite(
                        score_uuid,
                        user_id,
                        prepared,
                        require_persisted_id(job.id, entity="job"),
                        f"job-confirm:{job_uuid}",
                    ),
                )
            )
            revision_id = require_persisted_id(write_result.revision.id, entity="revision")
            await adopt_review_thumbnail(db, thumbnail_write, revision_id=revision_id)
            promoted_inputs = await promote_uploads_to_score_inputs(
                db,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_id=score_id,
            )
            job.score_id = score_id
            job.state = ImportJobState.CONFIRMED
            job.updated_at = now
            for promoted in promoted_inputs:
                await storage_usage_service.record_release(
                    db,
                    user_id=user_id,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=promoted.size_bytes,
                    reason="upload_promoted_to_score_input",
                    object_type="upload",
                    object_id=promoted.upload_uuid,
                    storage_key=promoted.storage_key,
                    auto_commit=False,
                )
                await storage_usage_service.record_allocation(
                    db,
                    user_id=user_id,
                    category=StorageUsageCategory.INPUT_ASSET,
                    bytes_count=promoted.size_bytes,
                    reason="score_input_asset_created",
                    object_type="score_input_asset",
                    object_id=promoted.asset_uuid,
                    storage_key=promoted.storage_key,
                    auto_commit=False,
                )
            await ImportJobDeletionService().cleanup_binary_artifacts(db, job, user_id)
            await db.run_sync(
                lambda sync: append_fact(
                    sync,
                    ImportJobConfirmed(
                        job_id=job_uuid,
                        recipient_user_id=user_id,
                        score_id=score_uuid,
                        score_title=title,
                    ),
                    occurred_at=now,
                )
            )
            await db.commit()
            business_committed = True
            await revision_fast_path(write_result)
        except Exception:
            await db.rollback()
            if not business_committed:
                await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

        await db.run_sync(catch_up_import_projections_best_effort)
        return ReviewConfirmRead(score_id=score_uuid)

    async def update(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
        request: ReviewUpdateRequest,
    ) -> ImportJobReviewRead:
        job = (
            await db.execute(
                select(ImportJob).where(ImportJob.job_uuid == job_uuid).with_for_update()
            )
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if job.state != ImportJobState.PENDING_REVIEW:
            raise ConflictException(
                ErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        content = admit_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()
        job_id = require_persisted_id(job.id, entity="import job")
        artifact = (
            await db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if artifact is None:
            raise ResourceNotFoundException("import_artifact", job_uuid, ErrorCode.XML_NOT_FOUND)

        stored = await write_object_async(
            db,
            self.async_storage,
            key=f"jobs/{job_uuid}/{ImportArtifactKind.REVIEW_MUSICXML.value}/{uuid.uuid4()}.musicxml",
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
        job = (
            await db.execute(
                select(ImportJob)
                .where(ImportJob.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        if job.user_id != user_id or job.state != ImportJobState.PENDING_REVIEW:
            raise ConflictException(ErrorCode.VALIDATION_ERROR, {"job_id": job_uuid})
        artifact = (
            await db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        previous_object = artifact.stored_object
        old_artifact_uuid = artifact.artifact_uuid
        old_storage_key = artifact.stored_object.object_key
        old_size_bytes = artifact.stored_object.byte_size or 0
        try:
            artifact.stored_object = await db.run_sync(
                lambda sync: adopt_written_object(sync, stored)
            )
            artifact.filename = stored.object_key.rsplit("/", 1)[-1]
            await db.flush()
            await retire_after_release(db, previous_object.id)
            job.updated_at = utc_now_naive()
            await create_review_thumbnail_render_outbox(
                db,
                import_job_id=job_id,
                source_fingerprint=content_hash,
            )
            await storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=old_size_bytes,
                reason="review_musicxml_replaced",
                object_type="import_artifact",
                object_id=old_artifact_uuid,
                storage_key=old_storage_key,
                auto_commit=False,
            )
            await storage_usage_service.record_allocation(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=stored.size_bytes,
                reason="review_musicxml_updated",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=stored.object_key,
                auto_commit=False,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

        return await self.detail(db, job_uuid, user_id)

    @staticmethod
    def _confirmed_title(
        job: ImportJob,
        request: ReviewConfirmRequest,
    ) -> str:
        if request.title is not None:
            return request.title.strip()
        options = job.requested_options if isinstance(job.requested_options, dict) else {}
        requested_title = options.get("title")
        return (
            requested_title.strip()
            if isinstance(requested_title, str) and requested_title.strip()
            else "Untitled score"
        )

    @staticmethod
    def _confirmed_genres(job: ImportJob, request: ReviewConfirmRequest) -> list[ScoreGenre]:
        if request.genres is not None:
            return request.genres
        options = processing_options_adapter.validate_python(
            job.requested_options if job.requested_options is not None else {}
        )
        return options.get("genres", [])


import_review_service = ImportReviewService()
