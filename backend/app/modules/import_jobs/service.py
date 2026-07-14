from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import FileException, ResourceNotFoundException, UnauthorizedException, ValidationException
from app.db.models import ImportArtifact, ImportJob, ImportJobUpload, StorageUsageCategory, Upload, User
from app.db.models.import_job import ImportJobState
from app.db.model_utils import require_persisted_id
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.schemas import ImportJobDetail, ImportJobProcessingOptions, ImportJobStatusEntry, ImportJobSubmitRequestLike, ImportJobSubmitResult
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.import_jobs.worker_service import sync_import_job_service
from app.modules.storage_usage.service import storage_usage_service
from app.storage import FileStorage, file_storage
from app.shared.constants import ErrorCode


@dataclass(frozen=True)
class ImportArtifactDelivery:
    filename: str
    media_type: str
    path: str | None = None
    redirect_url: str | None = None


@dataclass(frozen=True)
class RetryJobRequest:
    file_ids: list[str]
    options: ImportJobProcessingOptions | None
    idempotency_key: str | None = None


@dataclass(frozen=True)
class StoredObjectCleanup:
    category: StorageUsageCategory
    object_type: str
    object_id: str
    storage_key: str
    bytes_count: int
    reason: str


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
        job_id = require_persisted_id(job.id, entity="import job")
        orphan_uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        cleanup_objects = await self._collect_delete_cleanup_objects(db, job_id, orphan_uploads)
        await db.delete(job)
        await db.flush()
        for upload in orphan_uploads:
            await db.delete(upload)
        await db.commit()
        for cleanup_object in cleanup_objects:
            await self._delete_storage_and_release_usage(db, user_id, cleanup_object)

    async def cleanup_binary_artifacts(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
    ) -> None:
        job = await self.get_owned_job(db, job_uuid, user_id)
        if job.state == ImportJobState.RUNNING:
            raise ValidationException(code=ErrorCode.JOB_RUNNING, field="state")
        job_id = require_persisted_id(job.id, entity="import job")
        orphan_uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        cleanup_objects = await self._collect_delete_cleanup_objects(db, job_id, orphan_uploads)
        await db.execute(sa_delete(ImportArtifact).where(ImportArtifact.job_id == job_id))
        await db.execute(sa_delete(ImportJobUpload).where(ImportJobUpload.job_id == job_id))
        await db.flush()
        for upload in orphan_uploads:
            await db.delete(upload)
        await db.commit()
        for cleanup_object in cleanup_objects:
            await self._delete_storage_and_release_usage(db, user_id, cleanup_object)

    async def _collect_delete_cleanup_objects(
        self,
        db: AsyncSession,
        job_id: int,
        orphan_uploads: list[Upload],
    ) -> list[StoredObjectCleanup]:
        artifacts = list(
            (
                await db.execute(
                    select(ImportArtifact).where(ImportArtifact.job_id == job_id)
                )
            )
            .scalars()
            .all()
        )
        cleanup_objects = [
            StoredObjectCleanup(
                category=StorageUsageCategory.TEMP_IMPORT,
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.storage_key,
                bytes_count=artifact.size_bytes or 0,
                reason="import_job_deleted",
            )
            for artifact in artifacts
        ]
        cleanup_objects.extend(
            StoredObjectCleanup(
                category=StorageUsageCategory.UPLOAD,
                object_type="upload",
                object_id=upload.sha256,
                storage_key=upload.storage_key,
                bytes_count=upload.size_bytes or 0,
                reason="import_job_deleted",
            )
            for upload in orphan_uploads
        )
        return cleanup_objects

    async def _orphan_uploads_after_job_delete(
        self,
        db: AsyncSession,
        job_id: int,
    ) -> list[Upload]:
        uploads = list(
            (
                await db.execute(
                    select(Upload)
                    .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                    .where(ImportJobUpload.job_id == job_id)
                )
            )
            .scalars()
            .all()
        )
        orphan_uploads: list[Upload] = []
        for upload in uploads:
            upload_id = require_persisted_id(upload.id, entity="upload")
            ref_count = (
                await db.execute(
                    select(func.count(ImportJobUpload.id)).where(
                        ImportJobUpload.upload_id == upload_id,
                        ImportJobUpload.job_id != job_id,
                    )
                )
            ).scalar_one()
            if ref_count == 0:
                orphan_uploads.append(upload)
        return orphan_uploads

    async def _delete_storage_and_release_usage(
        self,
        db: AsyncSession,
        user_id: int,
        cleanup_object: StoredObjectCleanup,
    ) -> None:
        self.storage.delete(cleanup_object.storage_key)
        await storage_usage_service.record_release(
            db,
            user_id=user_id,
            category=cleanup_object.category,
            bytes_count=cleanup_object.bytes_count,
            reason=cleanup_object.reason,
            object_type=cleanup_object.object_type,
            object_id=cleanup_object.object_id,
            storage_key=cleanup_object.storage_key,
        )

    async def artifact_delivery(
        self,
        db: AsyncSession,
        job_uuid: str,
        artifact_uuid: str,
        user_id: int,
    ) -> ImportArtifactDelivery:
        job = await self.get_owned_job(db, job_uuid, user_id)
        if artifact_uuid.startswith("upload:"):
            return await self._upload_delivery(db, job, artifact_uuid)
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
            return ImportArtifactDelivery(
                filename=artifact.filename,
                media_type=media_type,
                redirect_url=url,
            )
        return ImportArtifactDelivery(
            filename=artifact.filename,
            media_type=media_type,
            path=self.storage.materialize_to_local(
                artifact.storage_key, self.storage.local_path(artifact.storage_key)
            ),
        )

    async def _upload_delivery(
        self,
        db: AsyncSession,
        job: ImportJob,
        artifact_uuid: str,
    ) -> ImportArtifactDelivery:
        raw_upload_id = artifact_uuid.removeprefix("upload:")
        if not raw_upload_id.isdigit():
            raise ResourceNotFoundException("import_upload", artifact_uuid, ErrorCode.FILE_NOT_FOUND)
        upload_id = int(raw_upload_id)
        job_id = require_persisted_id(job.id, entity="import job")
        row = (
            await db.execute(
                select(ImportJobUpload, Upload)
                .join(Upload, ImportJobUpload.upload_id == Upload.id)
                .where(
                    ImportJobUpload.job_id == job_id,
                    ImportJobUpload.upload_id == upload_id,
                )
            )
        ).first()
        if row is None:
            raise ResourceNotFoundException("import_upload", artifact_uuid, ErrorCode.FILE_NOT_FOUND)
        _, upload = row
        if not self.storage.exists(upload.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, upload.storage_key)
        media_type = upload.mime_type or "application/octet-stream"
        filename = upload.original_filename or upload.filename
        if self.storage.backend_name != "local":
            url = self.storage.download_url(
                upload.storage_key,
                filename=filename,
                content_type=media_type,
            )
            if not url:
                raise FileException(ErrorCode.FILE_NOT_FOUND, upload.storage_key)
            return ImportArtifactDelivery(
                filename=filename,
                media_type=media_type,
                redirect_url=url,
            )
        return ImportArtifactDelivery(
            filename=filename,
            media_type=media_type,
            path=self.storage.materialize_to_local(
                upload.storage_key,
                self.storage.local_path(upload.storage_key),
            ),
        )


job_service = ImportJobService()
