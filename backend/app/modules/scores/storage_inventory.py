"""Each Score input is charged to that Score owner, including shared Upload bytes."""

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models.score import Score, ScoreInputAsset
from app.db.models.upload import Upload
from app.db.models.stored_object import StoredObject
from app.modules.storage_governance.usage.domain import StorageUsageCategory


class ScoreInputStorageInventoryProvider:
    categories = frozenset({StorageUsageCategory.INPUT_ASSET})

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        score = Score.__table__
        inputs = ScoreInputAsset.__table__
        upload = Upload.__table__
        obj = StoredObject.__table__
        total = db.scalar(
            select(func.coalesce(func.sum(obj.c.byte_size), 0))
            .select_from(
                inputs.join(upload, inputs.c.upload_id == upload.c.id)
                .join(obj, upload.c.stored_object_id == obj.c.id)
                .join(score, inputs.c.score_id == score.c.id)
            )
            .where(score.c.owner_user_id == user_id)
        )
        return {StorageUsageCategory.INPUT_ASSET: int(total)}
