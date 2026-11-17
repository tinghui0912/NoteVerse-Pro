"""Bulk-hydrated Customer ImportJob presentation."""

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import ImportJob
from app.db.models.import_job import ImportJobState
from .public_errors import public_import_job_error_code
from .repository import ImportJobRepository
from .requested_options import decode_requested_options
from .schemas import ImportArtifactRead, ImportJobRead


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
        uploads = self.repository.uploads_for_jobs(db, job_ids)
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
            options = decode_requested_options(job.requested_options)
            result.append(
                ImportJobRead(
                    job_id=job.job_uuid,
                    score_id=score_uuids.get(job.score_id) if job.score_id is not None else None,
                    state=job.state,
                    progress=job.progress,
                    display_title=options.display_title,
                    genres=options.genres,
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
