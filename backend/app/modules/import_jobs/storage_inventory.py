"""Import artifacts are logical allocations of their ImportJob user."""

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models.import_job import ImportJob, ImportArtifact
from app.db.models.stored_object import StoredObject
from app.db.models.storage_usage import StorageUsageCategory


class ImportJobStorageInventoryProvider:
    categories = frozenset({StorageUsageCategory.TEMP_IMPORT})

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        artifact = ImportArtifact.__table__
        job = ImportJob.__table__
        obj = StoredObject.__table__
        total = db.scalar(
            select(func.coalesce(func.sum(obj.c.byte_size), 0))
            .select_from(
                artifact.join(obj, artifact.c.stored_object_id == obj.c.id).join(
                    job, artifact.c.job_id == job.c.id
                )
            )
            .where(job.c.user_id == user_id)
        )
        return {StorageUsageCategory.TEMP_IMPORT: int(total)}
