from __future__ import annotations

import uuid

from app.core.exceptions import ExternalServiceException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ProcessingJob, ProcessingJobUpload, Task, TaskUpload, User
from app.db.models.processing_job import ProcessingJobState
from app.db.models.task import TaskState
from app.modules.jobs.schemas import JobProcessingOptions, JobSubmitRequestLike, JobSubmitResult
from app.modules.jobs.worker_service import sync_job_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class JobSubmissionService:
    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    async def submit(self, current_user: User, request: JobSubmitRequestLike) -> JobSubmitResult:
        user_id = require_persisted_id(current_user.id, entity="user")
        idempotency_key = self._normalize_key(request.idempotency_key)
        if idempotency_key:
            existing = self._existing_job_uuid(user_id, idempotency_key)
            if existing:
                return {"job_id": existing, "count": len(request.file_ids)}

        self._ensure_uploads_exist(user_id, request.file_ids)
        job_uuid = str(uuid.uuid4())
        self._create_pending_job(job_uuid, user_id, request, idempotency_key)
        try:
            self._dispatch(job_uuid, request.file_ids, request.options)
        except Exception as exc:
            self._mark_dispatch_failure(job_uuid, exc)
            raise ExternalServiceException(
                service="Celery",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"job_id": job_uuid, "error": str(exc)},
            ) from exc
        return {"job_id": job_uuid, "count": len(request.file_ids)}

    @staticmethod
    def _normalize_key(value: object) -> str | None:
        return value.strip() or None if isinstance(value, str) else None

    @staticmethod
    def _existing_job_uuid(user_id: int, key: str) -> str | None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            job = sync_job_service.repository.get_by_idempotency_key(db, user_id, key)
            return job.job_uuid if job else None
        finally:
            db.close()

    def _ensure_uploads_exist(self, user_id: int, file_ids: list[str]) -> None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            for file_id in file_ids:
                upload = sync_job_service.repository.get_upload_by_sha256(db, file_id)
                if (
                    upload
                    and upload.uploader_user_id == user_id
                    and self.storage.find_score_upload(file_id)
                ):
                    continue
                raise ResourceNotFoundException(
                    resource_type="file",
                    resource_id=file_id,
                    code=ErrorCode.FILE_NOT_FOUND,
                )
        finally:
            db.close()

    @staticmethod
    def _option(options: JobProcessingOptions | None, key: str) -> str | None:
        value = options.get(key) if options else None
        return value if isinstance(value, str) else None

    def _create_pending_job(
        self,
        job_uuid: str,
        user_id: int,
        request: JobSubmitRequestLike,
        idempotency_key: str | None,
    ) -> None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            now = utc_now_naive()
            job = ProcessingJob(
                job_uuid=job_uuid,
                user_id=user_id,
                state=ProcessingJobState.PENDING,
                progress=0,
                idempotency_key=idempotency_key,
                requested_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(job)
            db.flush()
            job_id = require_persisted_id(job.id, entity="processing job")

            # Temporary read-model projection for review/results until P1-3 creates Score.
            legacy_task = Task(
                user_id=user_id,
                task_uuid=job_uuid,
                state=TaskState.PENDING,
                progress=0,
                title=self._option(request.options, "title"),
                difficulty=self._option(request.options, "difficulty"),
                idempotency_key=idempotency_key,
                requested_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(legacy_task)
            db.flush()
            task_id = require_persisted_id(legacy_task.id, entity="legacy task projection")

            for file_id in request.file_ids:
                upload = sync_job_service.repository.get_upload_by_sha256(db, file_id)
                if not upload or upload.uploader_user_id != user_id:
                    raise ResourceNotFoundException(
                        resource_type="file",
                        resource_id=file_id,
                        code=ErrorCode.FILE_NOT_FOUND,
                    )
                upload_id = require_persisted_id(upload.id, entity="upload")
                db.add(ProcessingJobUpload(job_id=job_id, upload_id=upload_id))
                db.add(TaskUpload(task_id=task_id, upload_id=upload_id))
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _dispatch(
        job_uuid: str,
        file_ids: list[str],
        options: JobProcessingOptions | None,
    ) -> None:
        from app.worker.tasks import process_images_job

        process_images_job.apply_async(args=[file_ids, options], task_id=job_uuid)

    @staticmethod
    def _mark_dispatch_failure(job_uuid: str, exc: Exception) -> None:
        from app.db.worker_session import get_db_session

        db = get_db_session()
        try:
            sync_job_service.finalize_failure(
                db,
                job_uuid,
                error=f"Failed to dispatch job to Celery: {exc}",
                error_type=type(exc).__name__,
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
            )
        finally:
            db.close()


job_submission_service = JobSubmissionService()
