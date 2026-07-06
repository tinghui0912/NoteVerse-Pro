from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.modules.import_jobs.repository import SyncImportJobRepository
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class JobMaintenanceResult:
    orphan_uploads_deleted: int = 0


class ImportJobMaintenanceService:
    def __init__(
        self,
        repository: SyncImportJobRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or SyncImportJobRepository()
        self.storage = storage or file_storage

    def run(self, db: Session) -> JobMaintenanceResult:
        return JobMaintenanceResult(
            orphan_uploads_deleted=self.cleanup_orphan_uploads(db),
        )

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


job_maintenance_service = ImportJobMaintenanceService()
