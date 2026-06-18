"""Batch-submission orchestration for task-processing requests."""

import uuid
from typing import List, Optional

from app.core.exceptions import ExternalServiceException, ResourceNotFoundException
from app.db.models import Task, TaskUpload, User
from app.db.model_utils import require_persisted_id
from app.db.models.task import TaskState
from app.modules.tasks.schemas import (
    BatchSubmitRequestLike,
    BatchSubmitResult,
    TaskProcessingOptions,
)
from app.modules.tasks.worker_service import sync_task_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class TaskSubmissionService:
    """Coordinate upload resolution, task creation, and worker dispatch."""

    def __init__(
        self,
        storage: FileStorage | None = None,
    ) -> None:
        self.storage = storage or file_storage

    async def submit_batch(
        self,
        current_user: User,
        request: BatchSubmitRequestLike,
    ) -> BatchSubmitResult:
        user_id = require_persisted_id(current_user.id, entity="user")
        idempotency_key = self._normalize_idempotency_key(
            getattr(request, "idempotency_key", None)
        )
        if idempotency_key:
            existing_task_uuid = self._get_existing_task_uuid(user_id, idempotency_key)
            if existing_task_uuid:
                return {"task_id": existing_task_uuid, "count": len(request.file_ids)}

        self._ensure_uploads_exist(user_id, request.file_ids)
        task_uuid = str(uuid.uuid4())
        self._create_pending_task(task_uuid, user_id, request, idempotency_key)
        try:
            self._dispatch_batch_processing(task_uuid, request.file_ids, request.options)
        except Exception as exc:
            self._mark_dispatch_failure(task_uuid, exc)
            raise ExternalServiceException(
                service="Celery",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"task_id": task_uuid, "error": str(exc)},
            ) from exc

        return {"task_id": task_uuid, "count": len(request.file_ids)}

    @staticmethod
    def _normalize_idempotency_key(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _get_existing_task_uuid(user_id: int, idempotency_key: str) -> str | None:
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            task = sync_task_service.get_task_by_idempotency_key(
                sync_db,
                user_id,
                idempotency_key,
            )
            return task.task_uuid if task else None
        finally:
            sync_db.close()

    def _ensure_uploads_exist(
        self,
        user_id: int,
        file_ids: List[str],
    ) -> None:
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            for file_id in file_ids:
                upload = sync_task_service.repository.get_upload_by_sha256(sync_db, file_id)
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
            sync_db.close()

    @staticmethod
    def _get_option_str(
        options: TaskProcessingOptions | None,
        key: str,
    ) -> str | None:
        value = options.get(key) if options else None
        return value if isinstance(value, str) else None

    def _create_pending_task(
        self,
        task_uuid: str,
        user_id: int,
        request: BatchSubmitRequestLike,
        idempotency_key: str | None,
    ) -> None:
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            now = utc_now_naive()
            task = Task(
                user_id=user_id,
                task_uuid=task_uuid,
                state=TaskState.PENDING,
                progress=0,
                title=TaskSubmissionService._get_option_str(request.options, "title"),
                difficulty=TaskSubmissionService._get_option_str(
                    request.options,
                    "difficulty",
                ),
                idempotency_key=idempotency_key,
                requested_at=now,
                created_at=now,
                updated_at=now,
            )
            sync_db.add(task)
            sync_db.flush()

            task_id = require_persisted_id(task.id, entity="task")

            for file_id in request.file_ids:
                upload = sync_task_service.repository.get_upload_by_sha256(sync_db, file_id)
                if not upload or upload.uploader_user_id != user_id:
                    raise ResourceNotFoundException(
                        resource_type="file",
                        resource_id=file_id,
                        code=ErrorCode.FILE_NOT_FOUND,
                    )
                sync_db.add(
                    TaskUpload(
                        task_id=task_id,
                        upload_id=require_persisted_id(upload.id, entity="upload"),
                    )
                )

            sync_db.commit()
        except Exception:
            sync_db.rollback()
            raise
        finally:
            sync_db.close()

    @staticmethod
    def _dispatch_batch_processing(
        task_uuid: str,
        file_ids: List[str],
        options: Optional[TaskProcessingOptions],
    ) -> None:
        from app.worker.tasks import process_images_task

        process_images_task.apply_async(args=[file_ids, options], task_id=task_uuid)

    @staticmethod
    def _mark_dispatch_failure(task_uuid: str, exc: Exception) -> None:
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            sync_task_service.finalize_failure(
                sync_db,
                task_uuid,
                error=f"Failed to dispatch task to Celery: {exc}",
                error_type=type(exc).__name__,
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
            )
        finally:
            sync_db.close()


task_submission_service = TaskSubmissionService()
