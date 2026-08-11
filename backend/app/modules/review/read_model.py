from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.exceptions import (
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import ImportArtifact, ImportJob, ImportJobUpload, Score, StorageBlob, Upload
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.review.schemas import (
    ImportJobReviewRead,
    ReviewArtifactRead,
    ReviewMusicXmlRead,
)
from app.shared.constants import ErrorCode
from app.storage import FileStorage


class ReviewReadModel:
    def __init__(self, storage: FileStorage) -> None:
        self.storage = storage

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
                if artifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value
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
        original_images = await self.upload_reads(db, job_id)
        return ImportJobReviewRead(
            job_id=job.job_uuid,
            state=job.state,
            title=title if isinstance(title, str) else None,
            taxonomy_tags=taxonomy_tags if isinstance(taxonomy_tags, list) else [],
            musicxml=ReviewMusicXmlRead(
                artifact_id=musicxml_artifact.artifact_uuid,
                content=content,
                mime_type=musicxml_artifact.mime_type,
            ),
            original_images=original_images,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    async def upload_reads(self, db: AsyncSession, job_id: int) -> list[ReviewArtifactRead]:
        rows = (
            await db.execute(
                select(Upload, StorageBlob)
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(ImportJobUpload.job_id == job_id)
                .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
            )
        ).all()
        return [
            ReviewArtifactRead(
                artifact_id=f"upload:{require_persisted_id(upload.id, entity='upload')}",
                filename=upload.original_filename or blob.filename,
                mime_type=blob.mime_type,
                size=blob.size_bytes,
                page_number=index + 1,
            )
            for index, (upload, blob) in enumerate(rows)
        ]
