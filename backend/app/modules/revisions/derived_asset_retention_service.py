from __future__ import annotations
from app.modules.storage_objects.retirement import retire_after_release

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import (
    Score,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    StorageUsageCategory,
)
from app.db.models.score import RenderAssetKind
from app.modules.storage_usage.service import storage_usage_service


@dataclass(frozen=True)
class DerivedAssetRetentionResult:
    rendered_pages_deleted: int = 0
    playback_assets_deleted: int = 0
    object_retirements_queued: int = 0


class DerivedAssetRetentionService:
    def candidate_score_ids(self, db: Session) -> list[int]:
        return list(
            db.scalars(
                select(Score.id).where(Score.__table__.c.deleted_at.is_(None)).order_by(Score.id)
            )
        )

    def cleanup_for_score(
        self,
        db: Session,
        *,
        score_id: int,
    ) -> DerivedAssetRetentionResult:
        score = db.execute(self._score_for_cleanup_statement(score_id)).scalar_one_or_none()
        if score is None:
            return DerivedAssetRetentionResult()
        protected_ids = set(db.execute(self._protected_revision_ids_statement(score_id)).scalars())
        rendered_pages = list(
            db.execute(
                self._stale_rendered_pages_statement(score_id=score_id, protected_ids=protected_ids)
            ).scalars()
        )
        playback_assets = list(
            db.execute(
                self._stale_playback_assets_statement(
                    score_id=score_id, protected_ids=protected_ids
                )
            ).scalars()
        )
        owner_user_id = score.owner_user_id if score else None
        render_usage = [
            (asset.asset_uuid, asset.stored_object.object_key, asset.stored_object.byte_size)
            for asset in rendered_pages
        ]
        audio_usage = [
            (asset.asset_uuid, asset.stored_object.object_key, asset.stored_object.byte_size)
            for asset in playback_assets
        ]
        for asset in rendered_pages:
            db.delete(asset)
        for asset in playback_assets:
            db.delete(asset)
        if owner_user_id is not None:
            for asset_uuid, storage_key, size_bytes in render_usage:
                storage_usage_service.record_release(
                    db,
                    user_id=owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=size_bytes,
                    reason="derived_asset_retention",
                    object_type="score_render_asset",
                    object_id=asset_uuid,
                    storage_key=storage_key,
                )
            for asset_uuid, storage_key, size_bytes in audio_usage:
                storage_usage_service.record_release(
                    db,
                    user_id=owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=size_bytes,
                    reason="derived_asset_retention",
                    object_type="score_playback_asset",
                    object_id=asset_uuid,
                    storage_key=storage_key,
                )
        operations = retire_after_release(
            db, *(asset.stored_object_id for asset in rendered_pages + playback_assets)
        )
        db.flush()
        return DerivedAssetRetentionResult(
            rendered_pages_deleted=len(rendered_pages),
            playback_assets_deleted=len(playback_assets),
            object_retirements_queued=len(operations),
        )

    @staticmethod
    def _score_for_cleanup_statement(score_id: int):
        # Serialize cleanup with head changes and final derivative admission.
        return (
            select(Score)
            .where(Score.id == score_id, Score.__table__.c.deleted_at.is_(None))
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def _protected_revision_ids_statement(score_id: int):
        head = select(Score.head_revision_id).where(
            Score.id == score_id, col(Score.head_revision_id).is_not(None)
        )
        return head

    @staticmethod
    def _stale_rendered_pages_statement(*, score_id: int, protected_ids: set[int]):
        statement = (
            select(ScoreRenderAsset)
            .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
            .where(
                ScoreRevision.score_id == score_id,
                ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
            )
        )
        if protected_ids:
            statement = statement.where(col(ScoreRenderAsset.revision_id).not_in(protected_ids))
        return statement

    @staticmethod
    def _stale_playback_assets_statement(*, score_id: int, protected_ids: set[int]):
        statement = (
            select(ScorePlaybackAsset)
            .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
            .where(
                ScoreRevision.score_id == score_id,
            )
        )
        if protected_ids:
            statement = statement.where(col(ScorePlaybackAsset.revision_id).not_in(protected_ids))
        return statement


derived_asset_retention_service = DerivedAssetRetentionService()
