"""Bulk-hydrated Customer ImportJob presentation."""

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import ImportJob
from app.db.models.import_job import ImportJobState
from .public_errors import public_import_job_error_code
from .repository import ImportJobRepository
from .schemas import ImportArtifactRead, ImportJobRead, processing_options_adapter


class ImportJobReadModel:
    def __init__(self, repository: ImportJobRepository | None = None) -> None:
        self.repository = repository or ImportJobRepository()

    def detail(self, db: Session, job: ImportJob) -> ImportJobRead:
        return (self.details_for_jobs(db, [job]))[0]

    def details_for_jobs(self, db: Session, jobs: Sequence[ImportJob]) -> list[ImportJobRead]:
        if not jobs:
            return []
        job_ids = [require_persisted_id(job.id, entity="import job") for job in jobs]
        score_uuids = self.repository.score_uuids(
            db, {job.score_id for job in jobs if job.score_id is not None}
        )
        digests = self.repository.execution_manifest_digests(
            db, {job.execution_manifest_id for job in jobs if job.execution_manifest_id is not None}
        )
        previews = self.repository.preview_artifacts_for_jobs(db, job_ids)
        uploads = self.repository.uploads_for_jobs(db, job_ids)
        thumbnails: dict[int, ImportArtifactRead] = {}
        for preview in previews:
            if preview["job_id"] not in thumbnails:
                thumbnails[preview["job_id"]] = ImportArtifactRead(
                    artifact_id=preview["artifact_uuid"],
                    filename=preview["filename"],
                    page_number=preview["page_number"],
                    size=preview["byte_size"],
                    mime_type=preview["content_type"],
                )
        images: dict[int, list[ImportArtifactRead]] = defaultdict(list)
        for upload in uploads:
            images[upload["job_id"]].append(
                ImportArtifactRead(
                    artifact_id=f"upload:{upload['upload_row_id']}",
                    filename=upload["original_filename"],
                    page_number=upload["page_number"],
                    size=upload["byte_size"],
                    mime_type=upload["content_type"],
                    upload_id=upload["upload_uuid"],
                    original_filename=upload["original_filename"],
                )
            )
        result = []
        for job in jobs:
            job_id = require_persisted_id(job.id, entity="import job")
            options = processing_options_adapter.validate_python(
                job.requested_options if job.requested_options is not None else {}
            )
            result.append(
                ImportJobRead(
                    job_id=job.job_uuid,
                    score_id=score_uuids.get(job.score_id) if job.score_id is not None else None,
                    state=job.state,
                    progress=job.progress,
                    display_title=options.get("display_title"),
                    genres=options.get("genres", []),
                    thumbnail=thumbnails.get(job_id),
                    created_at=job.created_at,
                    updated_at=job.updated_at,
                    processing_started_at=job.processing_started_at,
                    processing_finished_at=job.processing_finished_at,
                    confirmed_at=job.confirmed_at,
                    public_code=public_import_job_error_code(job)
                    if job.state == ImportJobState.FAILED
                    else None,
                    execution_manifest_sha256=digests.get(job.execution_manifest_id)
                    if job.execution_manifest_id is not None
                    else None,
                    original_images=images[job_id],
                )
            )
        return result
