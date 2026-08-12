from __future__ import annotations

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
    LibraryEntrySourceType,
    ImportArtifact,
    ImportJob,
    NotificationEvent,
    Score,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import MetadataStatus, RevisionOrigin, RevisionSourceFormat
from app.modules.library.service import LibraryService
from app.modules.import_jobs.service import ImportJobService
from app.modules.score_assets.render_outbox_service import (
    create_review_thumbnail_render_outbox,
)
from app.modules.notifications.service import NotificationTypes
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.review.confirmation_assets import (
    copy_review_thumbnail_to_score_revision,
    promote_uploads_to_score_inputs,
)
from app.modules.review.read_model import ReviewReadModel
from app.modules.review.schemas import (
    ImportJobReviewRead,
    ReviewConfirmRead,
    ReviewConfirmRequest,
    ReviewUpdateRequest,
)
from app.modules.scores.repository import ScoreRepository
from app.processing.musicxml.validation import validate_musicxml_document
from app.modules.scores.taxonomy import ordered_unique_pairs
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class ReviewService:
    def __init__(
        self,
        storage: FileStorage | None = None,
        score_repository: ScoreRepository | None = None,
        library_service: LibraryService | None = None,
        read_model: ReviewReadModel | None = None,
    ) -> None:
        self.storage = storage or file_storage
        self.score_repository = score_repository or ScoreRepository()
        self.library_service = library_service or LibraryService()
        self.read_model = read_model or ReviewReadModel(self.storage)

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
        job = (
            await db.execute(
                select(ImportJob)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if job.score_id is not None:
            score = await db.get(Score, job.score_id)
            if score:
                await ImportJobService(storage=self.storage).cleanup_binary_artifacts(
                    db,
                    job_uuid,
                    user_id,
                )
                return ReviewConfirmRead(score_id=score.score_uuid)
        if job.state != ImportJobState.PENDING_REVIEW:
            raise ConflictException(
                ErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        validate_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()
        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        now = utc_now_naive()
        title = self._confirmed_title(job, request)
        taxonomy_pairs = self._confirmed_taxonomy_pairs(job, request)
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
            stored = self.storage.put_bytes(
                key=key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

        business_committed = False
        try:
            score = Score(
                score_uuid=score_uuid,
                owner_user_id=user_id,
                title=title,
                originating_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
                updated_at=now,
            )
            db.add(score)
            await db.flush()
            score_id = require_persisted_id(score.id, entity="score")
            revision = ScoreRevision(
                revision_uuid=revision_uuid,
                score_id=score_id,
                revision_number=1,
                content_hash=content_hash,
                idempotency_key=f"job-confirm:{job_uuid}",
                origin=RevisionOrigin.OMR,
                created_by_user_id=user_id,
                created_by_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
            )
            db.add(revision)
            await db.flush()
            revision_id = require_persisted_id(revision.id, entity="score revision")
            source_uuid = str(uuid.uuid4())
            db.add(
                ScoreRevisionSource(
                    source_uuid=source_uuid,
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    storage_backend=self.storage.backend_name,
                    storage_key=stored.storage_key,
                    filename=stored.filename,
                    mime_type="application/vnd.recordare.musicxml+xml",
                    size_bytes=stored.size_bytes,
                    sha256=content_hash,
                    generator="review-confirm",
                    generator_version="1",
                    created_at=now,
                )
            )
            await copy_review_thumbnail_to_score_revision(
                db,
                storage=self.storage,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                revision_id=revision_id,
            )
            promoted_inputs = await promote_uploads_to_score_inputs(
                db,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_id=score_id,
            )
            db.add(
                ScoreRevisionMetadata(
                    revision_id=revision_id,
                    status=MetadataStatus.PENDING,
                    extractor_version="pending",
                )
            )
            await revision_derivative_service.enqueue(
                db,
                score_id=score_id,
                revision_id=revision_id,
                requested_by_user_id=user_id,
                source_fingerprint=content_hash,
            )
            score.head_revision_id = revision_id
            await self.score_repository.replace_taxonomy_tags(db, score_id, taxonomy_pairs)
            await self.library_service.ensure_entry(
                db,
                user_id=user_id,
                score_id=score_id,
                source_type=LibraryEntrySourceType.SELF_ADDED,
            )
            job.score_id = score_id
            job.state = ImportJobState.CONFIRMED
            job.updated_at = now
            await self._attach_score_to_import_notification(
                db,
                job_uuid=job_uuid,
                user_id=user_id,
                score_uuid=score_uuid,
                score_title=title,
            )
            await db.commit()
            business_committed = True
            await storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=stored.storage_key,
            )
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
                )
        except Exception:
            await db.rollback()
            if not business_committed:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
                await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

        await revision_derivative_service.rebuild_metadata_best_effort(
            db,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            user_id=user_id,
            storage=self.storage,
        )
        await ImportJobService(storage=self.storage).cleanup_binary_artifacts(
            db,
            job_uuid,
            user_id,
        )
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
                select(ImportJob)
                .where(ImportJob.job_uuid == job_uuid)
                .with_for_update()
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
        validate_musicxml_document(content)
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

        old_artifact_uuid = artifact.artifact_uuid
        old_storage_key = artifact.storage_key
        old_size_bytes = artifact.size_bytes or 0
        stored = self.storage.put_bytes(
            key=f"jobs/{job_uuid}/{ImportArtifactKind.REVIEW_MUSICXML.value}/{uuid.uuid4()}.musicxml",
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
        business_committed = False
        try:
            artifact.storage_backend = self.storage.backend_name
            artifact.storage_key = stored.storage_key
            artifact.filename = stored.filename
            artifact.mime_type = "application/vnd.recordare.musicxml+xml"
            artifact.size_bytes = stored.size_bytes
            artifact.sha256 = content_hash
            job.updated_at = utc_now_naive()
            await create_review_thumbnail_render_outbox(
                db,
                import_job_id=job_id,
                source_fingerprint=content_hash,
            )
            await db.commit()
            business_committed = True
        except Exception:
            await db.rollback()
            if not business_committed:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
            raise

        try:
            await storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=old_size_bytes,
                reason="review_musicxml_replaced",
                object_type="import_artifact",
                object_id=old_artifact_uuid,
                storage_key=old_storage_key,
            )
            await storage_usage_service.record_allocation(
                db,
                user_id=user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=stored.size_bytes,
                reason="review_musicxml_updated",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=stored.storage_key,
            )
        except Exception:
            await db.rollback()
            raise

        if old_storage_key != stored.storage_key:
            try:
                self.storage.delete(old_storage_key)
            except Exception:
                pass
        return await self.detail(db, job_uuid, user_id)

    @staticmethod
    async def _attach_score_to_import_notification(
        db: AsyncSession,
        *,
        job_uuid: str,
        user_id: int,
        score_uuid: str,
        score_title: str,
    ) -> None:
        event = (
            await db.execute(
                select(NotificationEvent).where(
                    NotificationEvent.recipient_user_id == user_id,
                    NotificationEvent.type == NotificationTypes.IMPORT_COMPLETED,
                    NotificationEvent.resource_type == "job",
                    NotificationEvent.resource_id == job_uuid,
                )
            )
        ).scalar_one_or_none()
        if event is None:
            return
        data = dict(event.data or {})
        data["score_id"] = score_uuid
        data["score_title"] = score_title
        event.score_id = score_uuid
        event.data = data

    @staticmethod
    def _confirmed_title(
        job: ImportJob,
        request: ReviewConfirmRequest,
    ) -> str:
        if request.title is not None:
            return request.title.strip()
        options = job.requested_options if isinstance(job.requested_options, dict) else {}
        requested_title = options.get("title")
        return requested_title.strip() if isinstance(requested_title, str) and requested_title.strip() else "Untitled score"

    @staticmethod
    def _confirmed_taxonomy_pairs(
        job: ImportJob,
        request: ReviewConfirmRequest,
    ) -> list[tuple[str, str]]:
        if request.taxonomy_tags is not None:
            return ordered_unique_pairs(
                (item.category, item.code) for item in request.taxonomy_tags
            )
        options = job.requested_options if isinstance(job.requested_options, dict) else {}
        requested_tags = options.get("taxonomy_tags")
        if not isinstance(requested_tags, list):
            return []
        pairs: list[tuple[str, str]] = []
        for tag in requested_tags:
            if not isinstance(tag, dict):
                continue
            category = tag.get("category")
            code = tag.get("code")
            if isinstance(category, str) and isinstance(code, str):
                pairs.append((category, code))
        return ordered_unique_pairs(pairs)


review_service = ReviewService()
