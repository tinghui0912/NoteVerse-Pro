"""Final Take recordings contribute to the current UPLOAD accounting category."""

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_manifest import PerformanceTakeManifest
from app.db.models.stored_object import StoredObject
from app.modules.storage_governance.usage.domain import StorageUsageCategory


class PerformanceTakeStorageInventoryProvider:
    categories = frozenset({StorageUsageCategory.UPLOAD})

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        take = PerformanceTake.__table__
        manifest = PerformanceTakeManifest.__table__
        obj = StoredObject.__table__
        total = db.scalar(
            select(func.coalesce(func.sum(obj.c.byte_size), 0))
            .select_from(
                take.join(obj, take.c.recording_object_id == obj.c.id).join(
                    manifest, take.c.manifest_id == manifest.c.id
                )
            )
            .where(manifest.c.user_id == user_id)
        )
        return {StorageUsageCategory.UPLOAD: int(total)}
