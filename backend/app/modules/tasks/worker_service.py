"""
Worker-only synchronous task service.

This is the canonical worker helper boundary under the tasks module.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.models import File, Task, TaskStep, TaskUpload
from app.db.model_utils import require_persisted_id
from app.db.models.task import TaskState, TaskStepStatus
from app.modules.tasks.schemas import (
    TaskFileReplaceItem,
    TaskStatusFileItem,
    TaskStatusResult,
    TaskStatusUploadItem,
)
from app.modules.tasks.worker_repository import SyncTaskRepository
from app.utils.timezone import utc_now_naive


def _kind_value(kind: object) -> str:
    if isinstance(kind, Enum):
        return str(kind.value)
    return str(kind)


class SyncTaskService:
    """Synchronous task helper for Celery workers."""

    def __init__(self, repository: SyncTaskRepository | None = None) -> None:
        self.repository = repository or SyncTaskRepository()

    @staticmethod
    def _reset_session_state(db: Session) -> None:
        """Clear stale session state before worker-side sync updates."""

        db.expire_all()
        try:
            db.commit()
        except Exception:
            db.rollback()

    def create_task(
        self,
        db: Session,
        user_id: int,
        task_uuid: str,
        title: Optional[str] = None,
        difficulty: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        requested_at: Optional[datetime] = None,
    ) -> Task:
        task = Task(
            user_id=user_id,
            task_uuid=task_uuid,
            state=TaskState.PENDING,
            progress=0,
            title=title,
            difficulty=difficulty,
            idempotency_key=idempotency_key,
            requested_at=(requested_at or utc_now_naive()),
            created_at=utc_now_naive(),
            updated_at=utc_now_naive(),
        )
        db.add(task)
        db.commit()
        return task

    def get_task_by_idempotency_key(
        self,
        db: Session,
        user_id: int,
        idempotency_key: str,
    ) -> Task | None:
        return self.repository.get_task_by_idempotency_key(db, user_id, idempotency_key)

    def update_progress(
        self,
        db: Session,
        task_uuid: str,
        state: TaskState | str,
        progress: int,
        current_step: Optional[str] = None,
        code: Optional[str] = None,
        error: Optional[str] = None,
        error_type: Optional[str] = None,
        started_at: Optional[datetime] = None,
    ) -> None:
        self._reset_session_state(db)

        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            return

        task.state = state if isinstance(state, TaskState) else TaskState(state)
        task.progress = progress
        task.current_step = current_step or task.current_step

        if code is not None:
            task.code = code
        if error is not None:
            task.error = error
        if error_type is not None:
            task.error_type = error_type
        if started_at is not None and not task.started_at:
            task.started_at = started_at

        now = utc_now_naive()
        task.last_heartbeat_at = now
        task.updated_at = now
        db.commit()

    def finalize_success(
        self,
        db: Session,
        task_uuid: str,
        total_time_seconds: Optional[int] = None,
        finished_at: Optional[datetime] = None,
    ) -> None:
        self._reset_session_state(db)

        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            return

        task.state = TaskState.PENDING_REVIEW
        task.progress = 100
        now = utc_now_naive()
        task.last_heartbeat_at = now
        task.finished_at = finished_at or now

        if total_time_seconds is not None:
            task.total_time_seconds = total_time_seconds

        task.updated_at = now
        db.commit()

    def finalize_failure(
        self,
        db: Session,
        task_uuid: str,
        error: str,
        error_type: str,
        code: Optional[str] = None,
    ) -> None:
        self._reset_session_state(db)

        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            return

        task.state = TaskState.FAILURE
        task.progress = 0
        task.error = error
        task.error_type = error_type

        if code:
            task.code = code

        now = utc_now_naive()
        task.last_heartbeat_at = now
        task.finished_at = now
        task.updated_at = now
        db.commit()

    def upsert_step(
        self,
        db: Session,
        task_uuid: str,
        name: str,
        status: TaskStepStatus | str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        step_order: Optional[int] = None,
    ) -> TaskStep:
        self._reset_session_state(db)

        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            raise ValueError(f"Task {task_uuid} not found")

        task_id_db = require_persisted_id(task.id, entity="task")
        step = self.repository.get_step(db, task_id_db, name)

        if step:
            step.status = (
                status if isinstance(status, TaskStepStatus) else TaskStepStatus(status)
            )
            if start_time:
                step.start_time = start_time
            if end_time:
                step.end_time = end_time
            if step_order is not None:
                step.step_order = step_order
        else:
            step = TaskStep(
                task_id=task_id_db,
                name=name,
                status=(
                    status if isinstance(status, TaskStepStatus) else TaskStepStatus(status)
                ),
                start_time=start_time or utc_now_naive(),
                end_time=end_time,
                step_order=step_order,
            )
            db.add(step)

        db.commit()
        return step

    def replace_files(
        self,
        db: Session,
        task_uuid: str,
        kind: str,
        files_list: List[TaskFileReplaceItem],
    ) -> None:
        kind = _kind_value(kind)
        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            return

        task_id_db = require_persisted_id(task.id, entity="task")
        self.repository.delete_files_by_kind(db, task_id_db, kind)

        for file_info in files_list:
            new_file = File(
                task_id=task_id_db,
                kind=kind,
                storage_backend=file_info.get("storage_backend"),
                storage_key=file_info.get("storage_key"),
                filename=file_info.get("filename"),
                page_number=file_info.get("page_number"),
                size_bytes=file_info.get("size"),
                mime_type=file_info.get("mime_type"),
            )
            db.add(new_file)

        db.commit()

    def add_file(
        self,
        db: Session,
        task_uuid: str,
        kind: str,
        storage_backend: str,
        storage_key: str,
        filename: str,
        page_number: Optional[int] = None,
        size: Optional[int] = None,
        mime: Optional[str] = None,
    ) -> File:
        kind = _kind_value(kind)
        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            raise ValueError(f"Task {task_uuid} not found")

        task_id_db = require_persisted_id(task.id, entity="task")
        new_file = File(
            task_id=task_id_db,
            kind=kind,
            storage_backend=storage_backend,
            storage_key=storage_key,
            filename=filename,
            page_number=page_number,
            size_bytes=size,
            mime_type=mime,
        )
        db.add(new_file)
        db.commit()
        return new_file

    def link_upload(
        self,
        db: Session,
        task_uuid: str,
        upload_sha256: str,
    ) -> None:
        task = self.repository.get_task_by_uuid(db, task_uuid)
        if not task:
            return

        upload = self.repository.get_upload_by_sha256(db, upload_sha256)
        if not upload:
            return

        task_id_db = require_persisted_id(task.id, entity="task")
        upload_id_db = require_persisted_id(upload.id, entity="upload")
        existing = self.repository.get_task_upload_link(db, task_id_db, upload_id_db)

        if not existing:
            task_upload = TaskUpload(task_id=task_id_db, upload_id=upload_id_db)
            db.add(task_upload)
            db.commit()

    def get_task_status(
        self,
        db: Session,
        task_id: str,
    ) -> TaskStatusResult:
        task = self.repository.get_task_by_uuid(db, task_id)
        if not task:
            return {"error": "Task not found"}

        task_id_db = require_persisted_id(task.id, entity="task")
        steps = self.repository.list_steps_for_task(db, task_id_db)
        files = self.repository.list_files_for_task(db, task_id_db)
        files_by_kind: Dict[str, List[TaskStatusFileItem]] = {}
        for file_row in files:
            if file_row.kind not in files_by_kind:
                files_by_kind[file_row.kind] = []
            files_by_kind[file_row.kind].append(
                {
                    "storage_key": file_row.storage_key,
                    "filename": file_row.filename,
                    "page_number": file_row.page_number,
                    "size": file_row.size_bytes,
                    "mime_type": file_row.mime_type,
                }
            )

        task_uploads = self.repository.list_task_upload_rows(db, task_id_db)

        upload_ids: List[TaskStatusUploadItem] = []
        for task_upload, upload in task_uploads:
            upload_ids.append(
                {
                    "upload_id": upload.id,
                    "sha256": upload.sha256,
                    "original_filename": upload.original_filename,
                }
            )

        return {
            "task_id": task.task_uuid,
            "state": task.state,
            "progress": task.progress,
            "current_step": task.current_step,
            "title": task.title,
            "difficulty": task.difficulty,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "finished_at": task.finished_at.isoformat() if task.finished_at else None,
            "error": task.error,
            "code": task.code,
            "steps": [
                {
                    "name": step.name,
                    "status": step.status,
                    "start_time": step.start_time.isoformat() if step.start_time else None,
                    "end_time": step.end_time.isoformat() if step.end_time else None,
                }
                for step in steps
            ],
            "files": files_by_kind,
            "upload_ids": upload_ids,
        }

sync_task_service = SyncTaskService()
