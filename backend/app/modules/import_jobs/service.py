from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectDelivery
from app.storage import ObjectStorage

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.models import ImportJob, ImportJobUpload, StoredObject, Upload, User
from app.db.models.import_job import ImportJobState
from app.db.model_utils import require_persisted_id
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.import_jobs.public_errors import public_import_job_error_code
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.schemas import (
    ImportJobRead,
    ImportJobProcessingOptions,
    processing_options_adapter,
    ImportJobStatusEntry,
    ImportJobSubmitRequestLike,
    ImportJobSubmitResult,
)
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.import_jobs.read_model import ImportJobReadModel
from app.storage import object_storage
from app.shared.error_codes import CustomerErrorCode


@dataclass(frozen=True)
class RetryJobRequest:
    upload_ids: list[str]
    options: ImportJobProcessingOptions | None
    idempotency_key: str | None = None


class ImportJobService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
        submission_service: ImportJobSubmissionService | None = None,
        storage: ObjectStorage | None = None,
        deletion_service: ImportJobDeletionService | None = None,
        read_model: ImportJobReadModel | None = None,
    ) -> None:
        self.repository = repository or ImportJobRepository()
        self.read_model = read_model or ImportJobReadModel(self.repository)
        self.submission_service = submission_service or ImportJobSubmissionService(self.repository)
        self.storage = storage or object_storage
        self.deletion_service = deletion_service or ImportJobDeletionService()

    def submit(
        self, db: Session, current_user: User, request: ImportJobSubmitRequestLike
    ) -> ImportJobSubmitResult:
        return self.submission_service.submit(db, current_user, request)

    def retry(
        self,
        db: Session,
        job_uuid: str,
        current_user: User,
        user_id: int,
    ) -> ImportJobSubmitResult:
        job = self.get_owned_job(db, job_uuid, user_id)
        if job.state != ImportJobState.FAILED:
            raise ValidationException(code=CustomerErrorCode.VALIDATION_ERROR, field="state")
        job_id = require_persisted_id(job.id, entity="import job")
        rows = db.execute(
            select(Upload.upload_uuid)
            .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
            .where(ImportJobUpload.job_id == job_id)
            .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
        )
        upload_ids = list(rows.scalars().all())
        if not upload_ids:
            raise ResourceNotFoundException(
                "job_upload", job_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        options = (
            processing_options_adapter.validate_python(job.requested_options)
            if job.requested_options is not None
            else None
        )
        return self.submission_service.submit(
            db,
            current_user,
            RetryJobRequest(
                upload_ids=upload_ids,
                options=options,
            ),
        )

    def list_jobs(
        self,
        db: Session,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ImportJobRead], int]:
        rows, total = self.repository.list_for_user(db, user_id, page=page, page_size=page_size)
        return self.read_model.details_for_jobs(db, rows), total

    def get_owned_job(
        self,
        db: Session,
        job_uuid: str,
        user_id: int,
    ) -> ImportJob:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ResourceNotFoundException(
                resource_type="job", resource_id=job_uuid, code=CustomerErrorCode.JOB_NOT_FOUND
            )
        if job.user_id != user_id:
            raise UnauthorizedException(
                code=CustomerErrorCode.NO_ACCESS, details={"job_id": job_uuid}
            )
        return job

    def detail(self, db: Session, job_uuid: str, user_id: int) -> ImportJobRead:
        job = self.get_owned_job(db, job_uuid, user_id)
        return self.read_model.detail(db, job)

    def batch_status(
        self,
        db: Session,
        job_uuids: list[str],
        user_id: int,
    ) -> dict[str, ImportJobStatusEntry]:
        jobs = self.repository.batch_status(db, job_uuids, user_id)
        score_uuids = self.repository.score_uuids(
            db,
            {
                job.score_id
                for job in jobs
                if job.state == ImportJobState.CONFIRMED and job.score_id is not None
            },
        )
        return {
            job.job_uuid: {
                "state": job.state,
                "progress": job.progress,
                "public_code": public_import_job_error_code(job)
                if job.state == ImportJobState.FAILED
                else None,
                "score_id": score_uuids.get(job.score_id)
                if job.state == ImportJobState.CONFIRMED
                else None,
            }
            for job in jobs
        }

    def delete(self, db: Session, job_uuid: str, user_id: int) -> None:
        job = self.get_owned_job(db, job_uuid, user_id)
        self.deletion_service.delete_job(db, job, user_id)
        db.commit()

    def artifact_delivery(
        self,
        db: Session,
        job_uuid: str,
        artifact_uuid: str,
        user_id: int,
    ) -> StoredObjectDelivery:
        job = self.get_owned_job(db, job_uuid, user_id)
        if artifact_uuid.startswith("upload:"):
            return self._upload_delivery(db, job, artifact_uuid)
        artifact = self.repository.artifact_by_uuid(db, artifact_uuid)
        if not artifact or artifact.job_id != job.id:
            raise ResourceNotFoundException(
                "import_artifact", artifact_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        return StoredObjectDelivery.for_object(artifact.stored_object, artifact.filename)

    def _upload_delivery(
        self,
        db: Session,
        job: ImportJob,
        artifact_uuid: str,
    ) -> StoredObjectDelivery:
        raw_upload_id = artifact_uuid.removeprefix("upload:")
        if not raw_upload_id.isdigit():
            raise ResourceNotFoundException(
                "import_upload", artifact_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        upload_id = int(raw_upload_id)
        job_id = require_persisted_id(job.id, entity="import job")
        row = (
            db.execute(
                select(ImportJobUpload, Upload, StoredObject)
                .join(Upload, ImportJobUpload.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(
                    ImportJobUpload.job_id == job_id,
                    ImportJobUpload.upload_id == upload_id,
                )
            )
        ).first()
        if row is None:
            raise ResourceNotFoundException(
                "import_upload", artifact_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        _, upload, blob = row
        filename = upload.original_filename
        return StoredObjectDelivery.for_object(blob, filename)


job_service = ImportJobService()
