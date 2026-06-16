"""Maintenance jobs for task and upload reliability."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import Task
from app.db.models.task import TaskState
from app.modules.tasks.worker_repository import SyncTaskRepository
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class MaintenanceResult:
    """Counts for maintenance actions."""

    stale_pending_failed: int = 0
    stale_progress_failed: int = 0
    orphan_uploads_deleted: int = 0


class TaskMaintenanceService:
    """Recover stuck task records and clean unused upload files."""

    def __init__(
        self,
        repository: SyncTaskRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or SyncTaskRepository()
        self.storage = storage or file_storage

    def run(self, db: Session) -> MaintenanceResult:
        """Run all maintenance routines."""

        stale_pending_failed = self.fail_stale_pending_tasks(db)
        stale_progress_failed = self.fail_stale_progress_tasks(db)
        orphan_uploads_deleted = self.cleanup_orphan_uploads(db)
        return MaintenanceResult(
            stale_pending_failed=stale_pending_failed,
            stale_progress_failed=stale_progress_failed,
            orphan_uploads_deleted=orphan_uploads_deleted,
        )

    def fail_stale_pending_tasks(self, db: Session) -> int:
        """Fail tasks that were created but never started."""

        cutoff = utc_now_naive() - timedelta(seconds=settings.TASK_PENDING_STALE_SECONDS)
        tasks = self.repository.list_stale_pending_tasks(db, cutoff)
        for task in tasks:
            self._fail_task(
                task,
                error="Task dispatch did not start before the pending timeout",
                error_type="StalePendingTask",
            )

        if tasks:
            db.commit()
        return len(tasks)

    def fail_stale_progress_tasks(self, db: Session) -> int:
        """Fail tasks whose worker heartbeat is stale."""

        cutoff = utc_now_naive() - timedelta(seconds=settings.TASK_PROGRESS_STALE_SECONDS)
        tasks = self.repository.list_stale_progress_tasks(db, cutoff)
        for task in tasks:
            self._fail_task(
                task,
                error="Task worker heartbeat expired before completion",
                error_type="StaleProgressTask",
            )

        if tasks:
            db.commit()
        return len(tasks)

    def cleanup_orphan_uploads(self, db: Session) -> int:
        """Delete uploads that were never linked to a task."""

        cutoff = utc_now_naive() - timedelta(seconds=settings.ORPHAN_UPLOAD_TTL_SECONDS)
        uploads = self.repository.list_orphan_uploads(db, cutoff)
        deleted = 0

        for upload in uploads:
            try:
                self.storage.delete(upload.storage_key)
                db.delete(upload)
                deleted += 1
            except Exception as exc:
                logger.warning(
                    f"Failed to delete orphan upload {upload.storage_key}: {exc}"
                )

        if deleted:
            db.commit()
        return deleted

    @staticmethod
    def _fail_task(task: Task, *, error: str, error_type: str) -> None:
        now = utc_now_naive()
        task.state = TaskState.FAILURE
        task.progress = 0
        task.error = error
        task.error_type = error_type
        task.code = "task_stale"
        task.finished_at = now
        task.updated_at = now


task_maintenance_service = TaskMaintenanceService()
