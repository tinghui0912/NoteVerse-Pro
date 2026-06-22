from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.modules.jobs.repository import SyncJobRepository
from app.modules.jobs.worker_service import sync_job_service
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class JobMaintenanceResult:
    stale_pending_failed: int = 0
    stale_progress_failed: int = 0
    orphan_uploads_deleted: int = 0


class JobMaintenanceService:
    def __init__(
        self,
        repository: SyncJobRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or SyncJobRepository()
        self.storage = storage or file_storage

    def run(self, db: Session) -> JobMaintenanceResult:
        return JobMaintenanceResult(
            stale_pending_failed=self.fail_stale_pending(db),
            stale_progress_failed=self.fail_stale_progress(db),
            orphan_uploads_deleted=self.cleanup_orphan_uploads(db),
        )

    def fail_stale_pending(self, db: Session) -> int:
        cutoff = utc_now_naive() - timedelta(seconds=settings.JOB_PENDING_STALE_SECONDS)
        jobs = self.repository.list_stale_pending(db, cutoff)
        for job in jobs:
            sync_job_service.finalize_failure(
                db, job.job_uuid, "Job dispatch did not start before timeout", "StalePendingJob", "job_stale"
            )
        return len(jobs)

    def fail_stale_progress(self, db: Session) -> int:
        cutoff = utc_now_naive() - timedelta(seconds=settings.JOB_PROGRESS_STALE_SECONDS)
        jobs = self.repository.list_stale_progress(db, cutoff)
        for job in jobs:
            sync_job_service.finalize_failure(
                db, job.job_uuid, "Job worker heartbeat expired", "StaleProgressJob", "job_stale"
            )
        return len(jobs)

    def cleanup_orphan_uploads(self, db: Session) -> int:
        cutoff = utc_now_naive() - timedelta(seconds=settings.ORPHAN_UPLOAD_TTL_SECONDS)
        deleted = 0
        for upload in self.repository.list_orphan_uploads(db, cutoff):
            try:
                self.storage.delete(upload.storage_key)
                db.delete(upload)
                deleted += 1
            except Exception as exc:
                logger.warning(f"Failed to delete orphan upload {upload.storage_key}: {exc}")
        if deleted:
            db.commit()
        return deleted


job_maintenance_service = JobMaintenanceService()
