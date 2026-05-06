"""Batch-submission orchestration for task-processing requests."""

import os
import uuid
from typing import List, Optional

import redis

from app.core.config import settings
from app.core.exceptions import ExternalServiceException, ResourceNotFoundException
from app.core.logger import logger
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.tasks.schemas import (
    BatchSubmitRequestLike,
    BatchSubmitResult,
    TaskProcessingOptions,
)
from app.modules.tasks.worker_service import sync_task_service
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class TaskSubmissionService:
    """Coordinate upload resolution, task creation, and worker dispatch."""

    async def submit_batch(
        self,
        current_user: User,
        request: BatchSubmitRequestLike,
    ) -> BatchSubmitResult:
        abs_paths = self._resolve_uploaded_paths(request.file_ids)
        self._ensure_worker_broker_available()

        task_uuid = str(uuid.uuid4())
        user_id = require_persisted_id(current_user.id, entity="user")
        self._create_pending_task(task_uuid, user_id, request)
        self._dispatch_batch_processing(task_uuid, abs_paths, request.options)

        return {"task_id": task_uuid, "count": len(abs_paths)}

    @staticmethod
    def _resolve_uploaded_paths(file_ids: List[str]) -> List[str]:
        import glob

        upload_dir = os.path.join(settings.UPLOAD_FOLDER, "scores")
        abs_paths: List[str] = []
        for file_id in file_ids:
            candidates = glob.glob(os.path.join(upload_dir, f"{file_id}.*"))
            if not candidates:
                raise ResourceNotFoundException(
                    resource_type="file",
                    resource_id=file_id,
                    code=ErrorCode.FILE_NOT_FOUND,
                )
            abs_paths.append(os.path.abspath(candidates[0]))
        return abs_paths

    @staticmethod
    def _ensure_worker_broker_available() -> None:
        try:
            redis_client = redis.Redis.from_url(
                settings.CELERY_BROKER_URL,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            redis_client.ping()
        except Exception as exc:
            raise ExternalServiceException(
                service="Redis",
                code=ErrorCode.EXTERNAL_SERVICE_ERROR,
                details={"error": str(exc)},
            )

    @staticmethod
    def _get_option_str(
        options: TaskProcessingOptions | None,
        key: str,
    ) -> str | None:
        value = options.get(key) if options else None
        return value if isinstance(value, str) else None

    @staticmethod
    def _create_pending_task(
        task_uuid: str,
        user_id: int,
        request: BatchSubmitRequestLike,
    ) -> None:
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            sync_task_service.create_task(
                sync_db,
                user_id=user_id,
                task_uuid=task_uuid,
                title=TaskSubmissionService._get_option_str(request.options, "title"),
                difficulty=TaskSubmissionService._get_option_str(
                    request.options,
                    "difficulty",
                ),
                requested_at=utc_now_naive(),
            )

            for file_id in request.file_ids:
                try:
                    sync_task_service.link_upload(sync_db, task_uuid, file_id)
                except Exception as exc:
                    logger.debug(
                        f"Failed to link upload {file_id} to task {task_uuid}: {exc}"
                    )
        finally:
            sync_db.close()

    @staticmethod
    def _dispatch_batch_processing(
        task_uuid: str,
        abs_paths: List[str],
        options: Optional[TaskProcessingOptions],
    ) -> None:
        from app.worker.tasks import process_images_task

        process_images_task.apply_async(args=[abs_paths, options], task_id=task_uuid)


task_submission_service = TaskSubmissionService()
