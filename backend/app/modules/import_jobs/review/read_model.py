from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.exceptions import (
    FileException,
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import ImportArtifact, ImportJob, ImportJobUpload, Score, StoredObject, Upload
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.import_jobs.schemas import processing_options_adapter
from app.modules.import_jobs.review.schemas import (
    ImportJobReviewRead,
    ReviewArtifactRead,
    ReviewMusicXmlRead,
)
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage


class ImportReviewReadModel:
    def __init__(self, storage: ObjectStorage) -> None:
        self.storage = storage

    def detail(
        self,
        db: Session,
        job_uuid: str,
        user_id: int,
    ) -> ImportJobReviewRead:
        job = (
            db.execute(select(ImportJob).where(ImportJob.job_uuid == job_uuid))
        ).scalar_one_or_none()
        if not job:
            raise ResourceNotFoundException("job", job_uuid, ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(ErrorCode.NO_ACCESS, {"job_id": job_uuid})
        if job.state == ImportJobState.CONFIRMED and job.score_id is not None:
            score = db.get(Score, job.score_id)
            if score:
                return ImportJobReviewRead(
                    job_id=job.job_uuid,
                    state=job.state,
                    score_id=score.score_uuid,
                    display_title=score.display_title,
                    genres=score.genres,
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
            (db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id)))
            .scalars()
            .all()
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
        if not (self.storage.exists(musicxml_artifact.stored_object.object_key)):
            raise FileException(
                ErrorCode.FILE_NOT_FOUND, musicxml_artifact.stored_object.object_key
            )

        content = (self.storage.read_bytes(musicxml_artifact.stored_object.object_key)).decode(
            "utf-8"
        )
        options = processing_options_adapter.validate_python(
            job.requested_options if job.requested_options is not None else {}
        )
        display_title = options.get("display_title")
        original_images = self.upload_reads(db, job_id)
        return ImportJobReviewRead(
            job_id=job.job_uuid,
            state=job.state,
            display_title=display_title if isinstance(display_title, str) else None,
            genres=options.get("genres", []),
            musicxml=ReviewMusicXmlRead(
                artifact_id=musicxml_artifact.artifact_uuid,
                content=content,
                mime_type=musicxml_artifact.stored_object.content_type,
            ),
            original_images=original_images,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    def upload_reads(self, db: Session, job_id: int) -> list[ReviewArtifactRead]:
        rows = (
            db.execute(
                select(Upload, StoredObject)
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(ImportJobUpload.job_id == job_id)
                .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
            )
        ).all()
        return [
            ReviewArtifactRead(
                artifact_id=f"upload:{require_persisted_id(upload.id, entity='upload')}",
                filename=upload.original_filename,
                mime_type=blob.content_type,
                size=blob.byte_size,
                page_number=index + 1,
            )
            for index, (upload, blob) in enumerate(rows)
        ]
