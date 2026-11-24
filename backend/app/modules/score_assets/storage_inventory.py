"""Rendered-page and playback semantic allocations remain independent of physical reuse."""

from sqlalchemy import select, func, literal, union_all
from sqlalchemy.orm import Session

from app.db.models.score import Score, ScoreRevision, ScoreRenderAsset
from app.db.models.playback import ScorePlaybackAsset
from app.db.models.stored_object import StoredObject
from app.db.models.storage_usage import StorageUsageCategory


class ScoreAssetStorageInventoryProvider:
    categories = frozenset(
        {StorageUsageCategory.DERIVED_RENDER, StorageUsageCategory.DERIVED_AUDIO}
    )

    def used_bytes_for_user(self, db: Session, user_id: int) -> dict[StorageUsageCategory, int]:
        score = Score.__table__
        revision = ScoreRevision.__table__
        obj = StoredObject.__table__
        allocations = union_all(
            *(
                select(obj.c.byte_size, literal(category.value).label("category"))
                .select_from(
                    owner.join(obj, owner.c.stored_object_id == obj.c.id)
                    .join(revision, owner.c.revision_id == revision.c.id)
                    .join(score, revision.c.score_id == score.c.id)
                )
                .where(score.c.owner_user_id == user_id)
                for category, owner in (
                    (StorageUsageCategory.DERIVED_RENDER, ScoreRenderAsset.__table__),
                    (StorageUsageCategory.DERIVED_AUDIO, ScorePlaybackAsset.__table__),
                )
            )
        ).subquery()
        totals = dict(
            db.execute(
                select(allocations.c.category, func.sum(allocations.c.byte_size)).group_by(
                    allocations.c.category
                )
            ).all()
        )
        return {category: int(totals.get(category.value, 0)) for category in self.categories}
