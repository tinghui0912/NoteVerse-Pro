"""Standalone Upload allocation excludes every Upload promoted to any Score input."""

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models.upload import Upload
from app.db.models.score import ScoreInputAsset
from app.db.models.stored_object import StoredObject
from app.db.models.storage_usage import StorageUsageCategory


class UploadStorageInventoryProvider:
    categories = frozenset({StorageUsageCategory.UPLOAD})

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        upload = Upload.__table__
        inputs = ScoreInputAsset.__table__
        obj = StoredObject.__table__
        total = db.scalar(
            select(func.coalesce(func.sum(obj.c.byte_size), 0))
            .select_from(upload.join(obj, upload.c.stored_object_id == obj.c.id))
            .where(
                upload.c.uploader_user_id == user_id,
                ~select(inputs.c.id).where(inputs.c.upload_id == upload.c.id).exists(),
            )
        )
        return {StorageUsageCategory.UPLOAD: int(total)}
