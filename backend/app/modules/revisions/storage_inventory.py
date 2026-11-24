"""Revision-owned source allocations, including historical and tombstoned Scores."""

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.models.score import Score, ScoreRevision, ScoreRevisionSource
from app.db.models.stored_object import StoredObject
from app.db.models.storage_usage import StorageUsageCategory


class RevisionStorageInventoryProvider:
    categories = frozenset({StorageUsageCategory.SOURCE})

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        source = ScoreRevisionSource.__table__
        revision = ScoreRevision.__table__
        score = Score.__table__
        obj = StoredObject.__table__
        total = db.scalar(
            select(func.coalesce(func.sum(obj.c.byte_size), 0))
            .select_from(
                source.join(obj, source.c.stored_object_id == obj.c.id)
                .join(revision, source.c.revision_id == revision.c.id)
                .join(score, revision.c.score_id == score.c.id)
            )
            .where(score.c.owner_user_id == user_id)
        )
        return {StorageUsageCategory.SOURCE: int(total)}
