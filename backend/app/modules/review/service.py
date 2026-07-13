from __future__ import annotations

import hashlib
import uuid
import xml.etree.ElementTree as ET

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    LibraryEntrySourceType,
    ImportArtifact,
    ImportJob,
    NotificationEvent,
    Score,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import (
    MetadataStatus,
    RenderAssetKind,
    RevisionOrigin,
    RevisionSourceFormat,
)
from app.modules.library.service import LibraryService
from app.modules.score_assets.render_outbox_service import (
    create_review_thumbnail_render_outbox,
)
from app.modules.notifications.service import NotificationTypes
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.review.schemas import (
    ImportJobReviewRead,
    ReviewArtifactRead,
    ReviewConfirmRead,
    ReviewConfirmRequest,
    ReviewMusicXmlRead,
    ReviewUpdateRequest,
)
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.taxonomy import ordered_unique_pairs
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class ReviewService:
    def __init__(
        self,
        storage: FileStorage | None = None,
        score_repository: ScoreRepository | None = None,
        library_service: LibraryService | None = None,
    ) -> None:
        self.storage = storage or file_storage
        self.score_repository = score_repository or ScoreRepository()
        self.library_service = library_service or LibraryService()

    async def detail(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
    ) -> ImportJobReviewRead:
        job = (
            await db.execute(
                select(ImportJob).where(ImportJob.job_uuid == job_uuid)
            )
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if job.state == ImportJobState.CONFIRMED and job.score_id is not None:
            score = await db.get(Score, job.score_id)
            if score:
                return ImportJobReviewRead(
                    job_id=job.job_uuid,
                    state=job.state,
                    score_id=score.score_uuid,
                    title=score.title,
                    taxonomy_tags=[],
                    musicxml=None,
                    original_images=[],
                    created_at=job.created_at,
                    updated_at=job.updated_at,
                )
        if job.state != ImportJobState.PENDING_REVIEW:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="state",
                details={"state": job.state.value},
            )

        job_id = require_persisted_id(job.id, entity="import job")
        artifacts = list(
            (
                await db.execute(
                    select(ImportArtifact).where(ImportArtifact.job_id == job_id)
                )
            ).scalars().all()
        )
        musicxml_artifact = next(
            (
                artifact
                for artifact in artifacts
                if artifact.kind == FileKind.REVIEW_MUSICXML.value
            ),
            None,
        )
        if musicxml_artifact is None:
            raise ResourceNotFoundException("import_artifact", job_uuid, ErrorCode.XML_NOT_FOUND)
        if not self.storage.exists(musicxml_artifact.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, musicxml_artifact.storage_key)

        content = self.storage.read_bytes(musicxml_artifact.storage_key).decode("utf-8")
        options = job.requested_options if isinstance(job.requested_options, dict) else {}
        title = options.get("title")
        taxonomy_tags = options.get("taxonomy_tags")
        return ImportJobReviewRead(
            job_id=job.job_uuid,
            state=job.state,
            title=title if isinstance(title, str) else None,
            taxonomy_tags=taxonomy_tags if isinstance(taxonomy_tags, list) else [],
            musicxml=ReviewMusicXmlRead(
                artifact_id=musicxml_artifact.artifact_uuid,
                content=content,
                mime_type=musicxml_artifact.mime_type,
                sha256=musicxml_artifact.sha256,
            ),
            original_images=self._artifact_reads(artifacts, FileKind.ORIGINAL_IMAGE.value),
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

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
                return ReviewConfirmRead(score_id=score.score_uuid)
        if job.state != ImportJobState.PENDING_REVIEW:
            raise ConflictException(
                ErrorCode.VALIDATION_ERROR,
                {"job_id": job_uuid, "state": job.state.value},
            )

        content = request.content.encode("utf-8")
        self._validate_musicxml(content)
        content_hash = hashlib.sha256(content).hexdigest()
        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        now = utc_now_naive()
        title = self._confirmed_title(job, request)
        taxonomy_pairs = self._confirmed_taxonomy_pairs(job, request)
        key = f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        stored = self.storage.put_bytes(
            key=key,
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )

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
            db.add(
                ScoreRevisionSource(
                    source_uuid=str(uuid.uuid4()),
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
            await self._copy_review_thumbnail_to_score_revision(
                db,
                job_id=require_persisted_id(job.id, entity="import job"),
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                revision_id=revision_id,
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
        except Exception:
            await db.rollback()
            try:
                self.storage.delete(stored.storage_key)
            except Exception:
                pass
            raise

        await revision_derivative_service.rebuild_metadata_best_effort(
            db,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            user_id=user_id,
            storage=self.storage,
        )
        return ReviewConfirmRead(score_id=score_uuid)

    async def _copy_review_thumbnail_to_score_revision(
        self,
        db: AsyncSession,
        *,
        job_id: int,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
    ) -> None:
        thumbnail = (
            await db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == FileKind.RESULT_THUMBNAIL.value,
                )
                .order_by(ImportArtifact.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if thumbnail is None:
            return
        content = self.storage.read_bytes(thumbnail.storage_key)
        artifact_uuid = str(uuid.uuid4())
        extension = "." + thumbnail.filename.rsplit(".", 1)[-1] if "." in thumbnail.filename else ".svg"
        stored = self.storage.put_bytes(
            key=(
                f"scores/{score_uuid}/revisions/{revision_uuid}/renders/"
                f"default/001-{artifact_uuid}{extension}"
            ),
            content=content,
            content_type=thumbnail.mime_type or "image/svg+xml",
        )
        db.add(
            ScoreRenderAsset(
                asset_uuid=artifact_uuid,
                revision_id=revision_id,
                kind=RenderAssetKind.RENDERED_PAGE,
                storage_backend=self.storage.backend_name,
                storage_key=stored.storage_key,
                filename=stored.filename,
                mime_type=thumbnail.mime_type or "image/svg+xml",
                size_bytes=stored.size_bytes,
                sha256=hashlib.sha256(content).hexdigest(),
                page_number=1,
                render_profile="default",
                generator="review-thumbnail",
                generator_version="1",
            )
        )

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
        self._validate_musicxml(content)
        content_hash = hashlib.sha256(content).hexdigest()
        job_id = require_persisted_id(job.id, entity="import job")
        artifact = (
            await db.execute(
                select(ImportArtifact)
                .where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == FileKind.REVIEW_MUSICXML.value,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if artifact is None:
            raise ResourceNotFoundException("import_artifact", job_uuid, ErrorCode.XML_NOT_FOUND)

        old_storage_key = artifact.storage_key
        stored = self.storage.put_bytes(
            key=f"jobs/{job_uuid}/{FileKind.REVIEW_MUSICXML.value}/{uuid.uuid4()}.musicxml",
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
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
        except Exception:
            await db.rollback()
            try:
                self.storage.delete(stored.storage_key)
            except Exception:
                pass
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
    def _artifact_reads(
        artifacts: list[ImportArtifact],
        kind: str,
    ) -> list[ReviewArtifactRead]:
        return [
            ReviewArtifactRead(
                artifact_id=artifact.artifact_uuid,
                filename=artifact.filename,
                mime_type=artifact.mime_type,
                size=artifact.size_bytes,
                sha256=artifact.sha256,
                page_number=artifact.page_number,
            )
            for artifact in artifacts
            if artifact.kind == kind
        ]

    @staticmethod
    def _validate_musicxml(content: bytes) -> None:
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
        if root.tag.split("}")[-1] not in {"score-partwise", "score-timewise"}:
            raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID)

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
