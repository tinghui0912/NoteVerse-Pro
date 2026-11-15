from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import StoredObject, StorageUsageCategory
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.retirement import retire_after_release
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class JobMaintenanceResult:
    orphan_uploads_deleted: int = 0


class ImportJobMaintenanceService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
    ) -> None:
        self.repository = repository or ImportJobRepository()

    def run(self, db: Session) -> JobMaintenanceResult:
        return JobMaintenanceResult(
            orphan_uploads_deleted=self.cleanup_orphan_uploads(db),
        )

    def cleanup_orphan_uploads(self, db: Session) -> int:
        cutoff = utc_now_naive() - timedelta(seconds=settings.ORPHAN_UPLOAD_TTL_SECONDS)
        deleted = 0
        for upload in self.repository.list_orphan_uploads(db, cutoff):
            try:
                with db.begin_nested():
                    blob = db.get(StoredObject, upload.stored_object_id)
                    if blob is None:
                        db.delete(upload)
                        deleted += 1
                        continue
                    if upload.uploader_user_id is not None and blob.byte_size:
                        storage_usage_service.record_release(
                            db,
                            user_id=upload.uploader_user_id,
                            category=StorageUsageCategory.UPLOAD,
                            bytes_count=blob.byte_size,
                            reason="orphan_upload_deleted",
                            object_type="upload",
                            object_id=upload.upload_uuid,
                            storage_key=blob.object_key,
                        )
                    db.delete(upload)
                    retire_after_release(db, blob.id)
                    deleted += 1
            except Exception as exc:
                logger.bind(
                    event="import_job.orphan_upload_delete_failed",
                    upload_id=upload.upload_uuid,
                    stored_object_id=upload.stored_object_id,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).warning("Orphan upload deletion failed")
        if deleted:
            db.commit()
        return deleted


job_maintenance_service = ImportJobMaintenanceService()
