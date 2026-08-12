from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import PlaybackAssetKind, ScorePlaybackAsset, ScoreRevision
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.storage import FileStorage


@dataclass(frozen=True)
class PlaybackDelivery:
    filename: str
    media_type: str
    storage_key: str


class PlaybackDeliveryReadModel:
    def __init__(
        self,
        *,
        storage: FileStorage,
        access_policy: ScoreAccessPolicy,
    ) -> None:
        self.storage = storage
        self.access_policy = access_policy

    async def score_revision_delivery(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> PlaybackDelivery:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        return await self.delivery_for_revision(
            db, require_persisted_id(access.revision.id, entity="score revision")
        )

    async def delivery_for_revision(
        self,
        db: AsyncSession,
        revision_id: int,
        *,
        score_id: int | None = None,
    ) -> PlaybackDelivery:
        asset = (
            await db.execute(
                select(ScorePlaybackAsset).where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == PlaybackAssetKind.AUDIO,
                )
            )
        ).scalar_one_or_none()
        if (asset is None or not self.storage.exists(asset.storage_key)) and score_id is not None:
            fallback = (
                await db.execute(
                    select(ScorePlaybackAsset)
                    .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
                    .where(
                        ScoreRevision.score_id == score_id,
                        ScoreRevision.id != revision_id,
                        ScorePlaybackAsset.kind == PlaybackAssetKind.AUDIO,
                    )
                    .order_by(
                        col(ScoreRevision.revision_number).desc(),
                        col(ScorePlaybackAsset.created_at).asc(),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if fallback is not None and self.storage.exists(fallback.storage_key):
                asset = fallback
        if asset is None or not self.storage.exists(asset.storage_key):
            raise ResourceNotFoundException("playback_asset", code=ErrorCode.FILE_NOT_FOUND)
        return PlaybackDelivery(
            filename=asset.filename,
            media_type=asset.mime_type,
            storage_key=asset.storage_key,
        )
