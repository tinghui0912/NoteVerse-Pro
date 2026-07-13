from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    Score,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    StorageUsageCategory,
)
from app.db.models.score import RenderAssetKind
from app.modules.storage_usage.service import storage_usage_service
from app.storage import FileStorage, file_storage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DerivedAssetRetentionResult:
    rendered_pages_deleted: int = 0
    playback_assets_deleted: int = 0
    storage_objects_deleted: int = 0


class DerivedAssetRetentionService:
    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    async def cleanup_for_score_best_effort(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int | None = None,
    ) -> DerivedAssetRetentionResult:
        try:
            return await self.cleanup_for_score(
                db,
                score_id=score_id,
                head_revision_id=head_revision_id,
                retain_recent_revisions=retain_recent_revisions,
            )
        except Exception as exc:
            await db.rollback()
            logger.warning("Failed to cleanup derived assets for score %s: %s", score_id, exc)
            return DerivedAssetRetentionResult()

    async def cleanup_for_score(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int | None = None,
    ) -> DerivedAssetRetentionResult:
        keep_ids = await self._revision_ids_to_keep(
            db,
            score_id=score_id,
            head_revision_id=head_revision_id,
            retain_recent_revisions=retain_recent_revisions,
        )
        rendered_pages = list(
            (
                await db.execute(
                    self._stale_rendered_pages_statement(score_id=score_id, keep_ids=keep_ids)
                )
            ).scalars()
        )
        playback_assets = list(
            (
                await db.execute(
                    self._stale_playback_assets_statement(score_id=score_id, keep_ids=keep_ids)
                )
            ).scalars()
        )
        score = await db.get(Score, score_id)
        owner_user_id = score.owner_user_id if score else None
        render_usage = [
            (asset.asset_uuid, asset.storage_key, asset.size_bytes)
            for asset in rendered_pages
        ]
        audio_usage = [
            (asset.asset_uuid, asset.storage_key, asset.size_bytes)
            for asset in playback_assets
        ]
        storage_keys = [asset.storage_key for asset in rendered_pages + playback_assets]
        for asset in rendered_pages:
            await db.delete(asset)
        for asset in playback_assets:
            await db.delete(asset)
        await db.commit()
        if owner_user_id is not None:
            for asset_uuid, storage_key, size_bytes in render_usage:
                await storage_usage_service.record_release(
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
                await storage_usage_service.record_release(
                    db,
                    user_id=owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=size_bytes,
                    reason="derived_asset_retention",
                    object_type="score_playback_asset",
                    object_id=asset_uuid,
                    storage_key=storage_key,
                )
        deleted_objects = self._delete_storage_objects(storage_keys)
        return DerivedAssetRetentionResult(
            rendered_pages_deleted=len(rendered_pages),
            playback_assets_deleted=len(playback_assets),
            storage_objects_deleted=deleted_objects,
        )

    def cleanup_due_scores(self, db: Session) -> DerivedAssetRetentionResult:
        scores = list(db.execute(select(Score.id, Score.head_revision_id)).all())
        total = DerivedAssetRetentionResult()
        for score_id, head_revision_id in scores:
            result = self.cleanup_for_score_sync(
                db,
                score_id=score_id,
                head_revision_id=head_revision_id,
            )
            total = DerivedAssetRetentionResult(
                rendered_pages_deleted=total.rendered_pages_deleted + result.rendered_pages_deleted,
                playback_assets_deleted=total.playback_assets_deleted + result.playback_assets_deleted,
                storage_objects_deleted=total.storage_objects_deleted + result.storage_objects_deleted,
            )
        return total

    def cleanup_for_score_sync(
        self,
        db: Session,
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int | None = None,
    ) -> DerivedAssetRetentionResult:
        keep_ids = self._revision_ids_to_keep_sync(
            db,
            score_id=score_id,
            head_revision_id=head_revision_id,
            retain_recent_revisions=retain_recent_revisions,
        )
        rendered_pages = list(
            db.execute(
                self._stale_rendered_pages_statement(score_id=score_id, keep_ids=keep_ids)
            ).scalars()
        )
        playback_assets = list(
            db.execute(
                self._stale_playback_assets_statement(score_id=score_id, keep_ids=keep_ids)
            ).scalars()
        )
        score = db.get(Score, score_id)
        owner_user_id = score.owner_user_id if score else None
        render_usage = [
            (asset.asset_uuid, asset.storage_key, asset.size_bytes)
            for asset in rendered_pages
        ]
        audio_usage = [
            (asset.asset_uuid, asset.storage_key, asset.size_bytes)
            for asset in playback_assets
        ]
        storage_keys = [asset.storage_key for asset in rendered_pages + playback_assets]
        for asset in rendered_pages:
            db.delete(asset)
        for asset in playback_assets:
            db.delete(asset)
        db.commit()
        if owner_user_id is not None:
            for asset_uuid, storage_key, size_bytes in render_usage:
                storage_usage_service.record_release_sync(
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
                storage_usage_service.record_release_sync(
                    db,
                    user_id=owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=size_bytes,
                    reason="derived_asset_retention",
                    object_type="score_playback_asset",
                    object_id=asset_uuid,
                    storage_key=storage_key,
                )
        deleted_objects = self._delete_storage_objects(storage_keys)
        return DerivedAssetRetentionResult(
            rendered_pages_deleted=len(rendered_pages),
            playback_assets_deleted=len(playback_assets),
            storage_objects_deleted=deleted_objects,
        )

    async def _revision_ids_to_keep(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int | None,
    ) -> set[int]:
        retain = self._retain_count(retain_recent_revisions)
        keep_ids = {head_revision_id} if head_revision_id is not None else set()
        if retain == 0:
            return keep_ids
        statement = self._recent_historical_revisions_statement(
            score_id=score_id,
            head_revision_id=head_revision_id,
            retain_recent_revisions=retain,
        )
        keep_ids.update((await db.execute(statement)).scalars().all())
        return keep_ids

    def _revision_ids_to_keep_sync(
        self,
        db: Session,
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int | None,
    ) -> set[int]:
        retain = self._retain_count(retain_recent_revisions)
        keep_ids = {head_revision_id} if head_revision_id is not None else set()
        if retain == 0:
            return keep_ids
        statement = self._recent_historical_revisions_statement(
            score_id=score_id,
            head_revision_id=head_revision_id,
            retain_recent_revisions=retain,
        )
        keep_ids.update(db.execute(statement).scalars().all())
        return keep_ids

    @staticmethod
    def _retain_count(retain_recent_revisions: int | None) -> int:
        retain = (
            settings.DERIVED_ASSET_RETAIN_RECENT_REVISIONS
            if retain_recent_revisions is None
            else retain_recent_revisions
        )
        if retain < 0:
            raise ValueError("retain_recent_revisions must be non-negative")
        return retain

    @staticmethod
    def _recent_historical_revisions_statement(
        *,
        score_id: int,
        head_revision_id: int | None,
        retain_recent_revisions: int,
    ):
        statement = select(ScoreRevision.id).where(ScoreRevision.score_id == score_id)
        if head_revision_id is not None:
            statement = statement.where(ScoreRevision.id != head_revision_id)
        return statement.order_by(ScoreRevision.revision_number.desc()).limit(
            retain_recent_revisions
        )

    @staticmethod
    def _stale_rendered_pages_statement(*, score_id: int, keep_ids: set[int]):
        statement = (
            select(ScoreRenderAsset)
            .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
            .where(
                ScoreRevision.score_id == score_id,
                ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
            )
        )
        if keep_ids:
            statement = statement.where(ScoreRenderAsset.revision_id.not_in(keep_ids))
        return statement

    @staticmethod
    def _stale_playback_assets_statement(*, score_id: int, keep_ids: set[int]):
        statement = (
            select(ScorePlaybackAsset)
            .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
            .where(ScoreRevision.score_id == score_id)
        )
        if keep_ids:
            statement = statement.where(ScorePlaybackAsset.revision_id.not_in(keep_ids))
        return statement

    def _delete_storage_objects(self, storage_keys: list[str]) -> int:
        deleted = 0
        for key in storage_keys:
            try:
                if self.storage.delete(key):
                    deleted += 1
            except Exception as exc:
                logger.warning("Failed to delete derived asset object %s: %s", key, exc)
        return deleted


derived_asset_retention_service = DerivedAssetRetentionService()
