from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import FileException, ResourceNotFoundException, UnauthorizedException, ValidationException
from app.db.models import ImportJob, ImportJobUpload, Upload, User
from app.db.models.import_job import ImportJobState
from app.db.model_utils import require_persisted_id
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.schemas import ImportJobDetail, ImportJobProcessingOptions, ImportJobStatusEntry, ImportJobSubmitRequestLike, ImportJobSubmitResult
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.import_jobs.worker_service import sync_import_job_service
from app.modules.artifacts.service import ArtifactDelivery
from app.storage import FileStorage, file_storage
from app.shared.constants import ErrorCode


@dataclass(frozen=True)
class RetryJobRequest:
    file_ids: list[str]
    options: ImportJobProcessingOptions | None
    idempotency_key: str | None = None


class ImportJobService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
        submission_service: ImportJobSubmissionService | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or ImportJobRepository()
        self.submission_service = submission_service or ImportJobSubmissionService()
        self.storage = storage or file_storage

    async def submit(self, current_user: User, request: ImportJobSubmitRequestLike) -> ImportJobSubmitResult:
        return await self.submission_service.submit(current_user, request)

    async def retry(
        self,
        db: AsyncSession,
        job_uuid: str,
        current_user: User,
        user_id: int,
    ) -> ImportJobSubmitResult:
        job = await self.get_owned_job(db, job_uuid, user_id)
        if job.state != ImportJobState.FAILURE:
            raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="state")
        job_id = require_persisted_id(job.id, entity="import job")
        rows = await db.execute(
            select(Upload.sha256)
            .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
            .where(ImportJobUpload.job_id == job_id)
        )
        file_ids = list(rows.scalars().all())
        if not file_ids:
            raise ResourceNotFoundException("job_upload", job_uuid, ErrorCode.FILE_NOT_FOUND)
        options = (
            job.requested_options
            if isinstance(job.requested_options, dict)
            else None
        )
        return await self.submission_service.submit(
            current_user,
            RetryJobRequest(
                file_ids=file_ids,
                options=options,  # type: ignore[arg-type]
            ),
        )

    async def list_jobs(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ImportJobDetail], int]:
        rows, total = await self.repository.list_for_user(
            db, user_id, page=page, page_size=page_size
        )
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            return [sync_import_job_service.get_detail(sync_db, row.job_uuid) for row in rows], total
        finally:
            sync_db.close()

    async def get_owned_job(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
    ) -> ImportJob:
        job = await self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ResourceNotFoundException(
                resource_type="job", resource_id=job_uuid, code=ErrorCode.JOB_NOT_FOUND
            )
        if job.user_id != user_id:
            raise UnauthorizedException(code=ErrorCode.NO_ACCESS, details={"job_id": job_uuid})
        return job

    async def detail(self, db: AsyncSession, job_uuid: str, user_id: int) -> ImportJobDetail:
        await self.get_owned_job(db, job_uuid, user_id)
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            return sync_import_job_service.get_detail(sync_db, job_uuid)
        finally:
            sync_db.close()

    async def batch_status(
        self,
        db: AsyncSession,
        job_uuids: list[str],
        user_id: int,
    ) -> dict[str, ImportJobStatusEntry]:
        jobs = await self.repository.batch_status(db, job_uuids, user_id)
        return {
            job.job_uuid: {
                "state": job.state,
                "progress": job.progress,
                "error": job.error,
                "score_id": None,
            }
            for job in jobs
        }

    async def delete(self, db: AsyncSession, job_uuid: str, user_id: int) -> None:
        job = await self.get_owned_job(db, job_uuid, user_id)
        if job.state == ImportJobState.RUNNING:
            raise ValidationException(code=ErrorCode.JOB_RUNNING, field="state")
        require_persisted_id(job.id, entity="import job")
        await db.delete(job)
        await db.commit()

    async def artifact_delivery(
        self,
        db: AsyncSession,
        job_uuid: str,
        artifact_uuid: str,
        user_id: int,
    ) -> ArtifactDelivery:
        job = await self.get_owned_job(db, job_uuid, user_id)
        artifact = await self.repository.artifact_by_uuid(db, artifact_uuid)
        if not artifact or artifact.job_id != job.id:
            raise ResourceNotFoundException(
                "import_artifact", artifact_uuid, ErrorCode.FILE_NOT_FOUND
            )
        if not self.storage.exists(artifact.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, artifact.storage_key)
        media_type = artifact.mime_type or "application/octet-stream"
        if self.storage.backend_name != "local":
            url = self.storage.download_url(
                artifact.storage_key,
                filename=artifact.filename,
                content_type=media_type,
            )
            if not url:
                raise FileException(ErrorCode.FILE_NOT_FOUND, artifact.storage_key)
            return ArtifactDelivery(
                filename=artifact.filename,
                media_type=media_type,
                redirect_url=url,
            )
        return ArtifactDelivery(
            filename=artifact.filename,
            media_type=media_type,
            path=self.storage.materialize_to_local(
                artifact.storage_key, self.storage.local_path(artifact.storage_key)
            ),
        )


job_service = ImportJobService()
