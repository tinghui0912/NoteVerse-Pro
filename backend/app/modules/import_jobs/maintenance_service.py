from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import StorageBlob, StorageUsageCategory, Upload
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
                blob = db.get(StorageBlob, upload.blob_id)
                if blob is None:
                    db.delete(upload)
                    deleted += 1
                    continue
                blob_ref_count = db.query(Upload).filter_by(blob_id=upload.blob_id).count()
                should_delete_blob = blob_ref_count <= 1
                if upload.uploader_user_id is not None and blob.size_bytes:
                    storage_usage_service.record_release_sync(
                        db,
                        user_id=upload.uploader_user_id,
                        category=StorageUsageCategory.UPLOAD,
                        bytes_count=blob.size_bytes,
                        reason="orphan_upload_deleted",
                        object_type="upload",
                        object_id=upload.upload_uuid,
                        storage_key=blob.storage_key,
                    )
                db.delete(upload)
                if should_delete_blob:
                    db.delete(blob)
                    self.storage.delete(blob.storage_key)
                deleted += 1
            except Exception as exc:
                logger.warning(f"Failed to delete orphan upload {upload.upload_uuid}: {exc}")
        if deleted:
            db.commit()
        return deleted


job_maintenance_service = ImportJobMaintenanceService()
