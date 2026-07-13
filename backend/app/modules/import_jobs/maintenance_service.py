from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import StorageUsageCategory
from app.modules.import_jobs.repository import SyncImportJobRepository
from app.modules.storage_usage.service import storage_usage_service
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
                if upload.uploader_user_id is not None and upload.size_bytes:
                    storage_usage_service.record_release_sync(
                        db,
                        user_id=upload.uploader_user_id,
                        category=StorageUsageCategory.UPLOAD,
                        bytes_count=upload.size_bytes,
                        reason="orphan_upload_deleted",
                        object_type="upload",
                        object_id=upload.sha256,
                        storage_key=upload.storage_key,
                    )
                db.delete(upload)
                deleted += 1
            except Exception as exc:
                logger.warning(f"Failed to delete orphan upload {upload.storage_key}: {exc}")
        if deleted:
            db.commit()
        return deleted


job_maintenance_service = ImportJobMaintenanceService()
