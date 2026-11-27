from __future__ import annotations


from app.platform.config.import_dispatch import ImportDispatchSettings

from app.modules.storage_governance.usage.service import StorageUsageService

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.orm import Session
from app.modules.uploads.repository import UploadRepository

from app.core.logger import logger
from app.db.models import StoredObject
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.import_jobs.repository import ImportJobRepository

from app.modules.media_storage.retirement import retire_after_release
from app.shared.time import utc_now


@dataclass(frozen=True)
class JobMaintenanceResult:
    orphan_uploads_deleted: int = 0


class ImportJobMaintenanceService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
        *,
        usage: StorageUsageService,
        config: ImportDispatchSettings,
    ) -> None:
        self.config = config
        self.usage = usage
        self.repository = repository or ImportJobRepository()

    def run(self, db: Session) -> JobMaintenanceResult:
        return JobMaintenanceResult(
            orphan_uploads_deleted=self.cleanup_orphan_uploads(db),
        )

    def cleanup_orphan_uploads(self, db: Session) -> int:
        cutoff = utc_now() - timedelta(seconds=self.config.ORPHAN_UPLOAD_TTL_SECONDS)
        deleted = 0
        for upload in self.repository.list_orphan_uploads(db, cutoff):
            try:
                with db.begin_nested():
                    if upload.uploader_user_id is None:
                        raise RuntimeError("Orphan Upload requires an owner")
                    self.usage.committed_bytes(db, upload.uploader_user_id, lock=True)
                    uploads = UploadRepository()
                    upload = uploads.get_upload_by_uuid(db, upload.upload_uuid, lock=True)
                    if upload is None or uploads.upload_reference_count(db, upload.id) > 0:
                        continue
                    blob = db.get(StoredObject, upload.stored_object_id)
                    if blob is None:
                        raise RuntimeError("Orphan Upload is missing StoredObject authority")
                    if blob is not None and upload.uploader_user_id is not None and blob.byte_size:
                        self.usage.record_release(
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
                    if blob is not None:
                        retire_after_release(db, blob.id)
                deleted += 1
            except Exception as exc:
                logger.bind(
                    event="import_job.orphan_upload_delete_failed",
                    upload_id=upload.upload_uuid,
                    stored_object_id=upload.stored_object_id,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).warning("Orphan upload deletion failed")
        return deleted
