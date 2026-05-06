"""Async task application services for API-facing task workflows."""
from __future__ import annotations

from io import BytesIO
import os
import shutil
from typing import List, Optional

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
    BatchStatusEntry,
    BatchSubmitRequestLike,
    BatchSubmitResult,
    TaskListItem,
    TaskListResponse,
    TaskStatusResult,
    TaskUpdateResult,
)
from app.modules.tasks.submission_service import TaskSubmissionService


class TaskService:
    """Async task service."""

    def __init__(
        self,
        repository: Optional[TaskRepository] = None,
        submission_service: Optional[TaskSubmissionService] = None,
        archive_service: Optional[TaskArchiveService] = None,
    ):
        self.repository = repository or TaskRepository()
        self.submission_service = submission_service or TaskSubmissionService()
        self.archive_service = archive_service or TaskArchiveService(self.repository)

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

            for task in deletable_tasks:
                self._cleanup_task_files(task.task_uuid)

            share_ids = await self.repository.get_share_ids_for_tasks(db, task_db_ids)
            await self.repository.delete_task_graph(db, task_db_ids, share_ids=share_ids)

            await db.commit()

        return {
            "deleted_count": len(deletable_tasks),
            "skipped_running": skipped_running,
            "not_found": len(task_uuids) - len(tasks),
        }

    def _cleanup_task_files(self, task_uuid: str) -> None:
        temp_task_dir = os.path.join(settings.TEMP_FOLDER, task_uuid)
        if os.path.isdir(temp_task_dir):
            try:
                shutil.rmtree(temp_task_dir, ignore_errors=True)
                logger.info(f"Deleted temp task dir: {temp_task_dir}")
            except Exception as exc:
                logger.warning(f"Failed to delete temp task dir {temp_task_dir}: {exc}")

        output_task_dir = os.path.join(settings.OUTPUT_FOLDER, task_uuid)
        if os.path.isdir(output_task_dir):
            try:
                shutil.rmtree(output_task_dir, ignore_errors=True)
                logger.info(f"Deleted output task dir: {output_task_dir}")
            except Exception as exc:
                logger.warning(f"Failed to delete output task dir {output_task_dir}: {exc}")

    async def batch_status(
        self,
        db: AsyncSession,
        task_uuids: List[str],
        user_id: int,
    ) -> dict[str, BatchStatusEntry]:
        return await self.repository.batch_status(db, task_uuids, user_id)

    async def get_task_details(self, task_uuid: str) -> TaskStatusResult:
        from app.db.worker_session import get_db_session
        from app.modules.tasks.worker_service import sync_task_service

        sync_db = get_db_session()
        try:
            return sync_task_service.get_task_status(sync_db, task_uuid)
        finally:
            sync_db.close()

    async def submit_batch(
        self,
        current_user: User,
        request: BatchSubmitRequestLike,
    ) -> BatchSubmitResult:
        return await self.submission_service.submit_batch(current_user, request)

    async def build_archive(
        self,
        db: AsyncSession,
        current_user: User,
        request: BatchArchiveRequestLike,
    ) -> tuple[BytesIO, str, int, int]:
        return await self.archive_service.build_archive(db, current_user, request)


task_service = TaskService()
