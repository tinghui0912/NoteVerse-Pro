"""Async task application services for API-facing task workflows."""
from __future__ import annotations

from io import BytesIO
import os
import shutil
from typing import Iterable, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.constants import ErrorCode
from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.core.logger import logger
from app.db.models import Task, User
from app.db.model_utils import require_persisted_id

from app.modules.tasks.archive_service import TaskArchiveService
from app.modules.tasks.repository import TaskRepository
from app.modules.tasks.schemas import (
    BatchArchiveRequestLike,
    BatchDeleteResult,
    TaskListItem,
    TaskListResponse,
    TaskStatusResult,
    TaskUpdateResult,
)
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class TaskService:
    """Async task service."""

    def __init__(
        self,
        repository: Optional[TaskRepository] = None,
        archive_service: Optional[TaskArchiveService] = None,
        storage: Optional[FileStorage] = None,
    ):
        self.repository = repository or TaskRepository()
        self.archive_service = archive_service or TaskArchiveService(self.repository)
        self.storage = storage or file_storage

    async def list_tasks(
        self,
        db: AsyncSession,
        user_id: int,
        page: int = 1,
        page_size: int = 20,
        state: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        search: Optional[str] = None,
    ) -> TaskListResponse:
        total = await self.repository.count_tasks(db, user_id, state=state, search=search)
        tasks = await self.repository.list_tasks(
            db,
            user_id,
            page=page,
            page_size=page_size,
            state=state,
            sort_by=sort_by,
            sort_order=sort_order,
            search=search,
        )

        task_ids = [require_persisted_id(task.id, entity="task") for task in tasks]
        thumbnail_types = await self.repository.get_thumbnail_types(db, task_ids)

        task_list: List[TaskListItem] = []
        for task in tasks:
            task_list.append(
                {
                    "task_id": task.task_uuid,
                    "state": task.state,
                    "progress": task.progress or 0,
                    "current_step": task.current_step,
                    "title": task.title,
                    "difficulty": task.difficulty,
                    "thumbnail_type": thumbnail_types.get(require_persisted_id(task.id, entity="task")),
                    "created_at": task.created_at.isoformat() if task.created_at else None,
                    "started_at": task.started_at.isoformat() if task.started_at else None,
                    "finished_at": task.finished_at.isoformat() if task.finished_at else None,
                    "error": task.error,
                    "code": task.code,
                }
            )

        return {"tasks": task_list, "total": total}

    async def get_task(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: Optional[int] = None,
    ) -> Task:
        task = await self.repository.get_task_by_uuid(db, task_uuid)

        if not task:
            raise ResourceNotFoundException(
                resource_type="task",
                resource_id=task_uuid,
                code=ErrorCode.TASK_NOT_FOUND,
            )

        if user_id and task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_ACCESS,
                details={"task_id": task_uuid},
            )

        return task

    async def update_task(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
        title: Optional[str] = None,
        difficulty: Optional[str] = None,
    ) -> TaskUpdateResult:
        task = await self.get_task(db, task_uuid)

        if task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_EDIT_ACCESS,
                details={"task_id": task_uuid},
            )

        if title is not None:
            task.title = title
        if difficulty is not None:
            task.difficulty = difficulty
        task.updated_at = utc_now_naive()

        await db.commit()

        return {"title": task.title, "difficulty": task.difficulty}

    async def delete_task(
        self,
        db: AsyncSession,
        task_uuid: str,
        user_id: int,
    ) -> None:
        task = await self.get_task(db, task_uuid)

        if task.user_id != user_id:
            raise UnauthorizedException(
                code=ErrorCode.NO_DELETE_ACCESS,
                details={"task_id": task_uuid},
            )

        if task.state == "PROGRESS":
            raise ValidationException(
                code=ErrorCode.TASK_RUNNING,
                field="state",
            )

        task_id_db = require_persisted_id(task.id, entity="task")
        files_by_task = await self.repository.list_files_for_tasks(db, [task_id_db])
        storage_keys = [file.storage_key for file in files_by_task.get(task_id_db, [])]
        self._cleanup_task_files(task.task_uuid, storage_keys)

        await self.repository.delete_single_task_graph(db, task_id_db)
        await db.commit()

    async def batch_delete(
        self,
        db: AsyncSession,
        task_uuids: List[str],
        user_id: int,
    ) -> BatchDeleteResult:
        if not task_uuids:
            raise ValidationException(
                code=ErrorCode.NO_TASK_IDS,
                field="task_ids",
            )

        tasks = await self.repository.get_tasks_by_uuids_for_user(db, task_uuids, user_id)

        if not tasks:
            return {"deleted_count": 0, "skipped_running": 0, "not_found": len(task_uuids)}

        deletable_tasks = [t for t in tasks if t.state != "PROGRESS"]
        skipped_running = len(tasks) - len(deletable_tasks)

        if deletable_tasks:
            task_db_ids = [require_persisted_id(t.id, entity="task") for t in deletable_tasks]
            files_by_task = await self.repository.list_files_for_tasks(db, task_db_ids)

            for task in deletable_tasks:
                task_db_id = require_persisted_id(task.id, entity="task")
                storage_keys = [
                    file.storage_key for file in files_by_task.get(task_db_id, [])
                ]
                self._cleanup_task_files(task.task_uuid, storage_keys)

            share_ids = await self.repository.get_share_ids_for_tasks(db, task_db_ids)
            await self.repository.delete_task_graph(db, task_db_ids, share_ids=share_ids)

            await db.commit()

        return {
            "deleted_count": len(deletable_tasks),
            "skipped_running": skipped_running,
            "not_found": len(task_uuids) - len(tasks),
        }

    def _cleanup_task_files(
        self,
        task_uuid: str,
        storage_keys: Iterable[str] = (),
    ) -> None:
        for storage_key in sorted(set(storage_keys)):
            try:
                self.storage.delete(storage_key)
                logger.info(f"Deleted task storage object: {storage_key}")
            except Exception as exc:
                logger.warning(
                    f"Failed to delete task storage object {storage_key}: {exc}"
                )

        work_task_dir = os.path.join(settings.WORK_ROOT, task_uuid)
        if os.path.isdir(work_task_dir):
            try:
                shutil.rmtree(work_task_dir, ignore_errors=True)
                logger.info(f"Deleted task work dir: {work_task_dir}")
            except Exception as exc:
                logger.warning(f"Failed to delete task work dir {work_task_dir}: {exc}")

    async def get_task_details(self, task_uuid: str) -> TaskStatusResult:
        from app.db.worker_session import get_db_session
        from app.modules.tasks.legacy_projection_service import legacy_task_projection_service

        sync_db = get_db_session()
        try:
            return legacy_task_projection_service.get_task_status(sync_db, task_uuid)
        finally:
            sync_db.close()

    async def build_archive(
        self,
        db: AsyncSession,
        current_user: User,
        request: BatchArchiveRequestLike,
    ) -> tuple[BytesIO, str, int, int]:
        return await self.archive_service.build_archive(db, current_user, request)


task_service = TaskService()
