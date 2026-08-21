from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import (
    PlaybackAssetKind,
    Score,
    ScoreDeletionStatus,
    ScorePlaybackAsset,
    ScoreRevision,
)
from app.db.models.score_access import PublicationStatus
from app.modules.publications.repository import PublicationRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction, hash_share_token
from app.modules.score_sharing.repository import ScoreSharingRepository
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


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


class PlaybackDeliveryService:
    """Authorize and stream previously generated playback assets for API traffic."""

    def __init__(
        self,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        sharing_repository: ScoreSharingRepository | None = None,
        publication_repository: PublicationRepository | None = None,
        delivery_read_model: PlaybackDeliveryReadModel | None = None,
    ) -> None:
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.sharing_repository = sharing_repository or ScoreSharingRepository()
        self.publication_repository = publication_repository or PublicationRepository()
        self.delivery_read_model = delivery_read_model or PlaybackDeliveryReadModel(
            storage=self.storage,
            access_policy=self.access_policy,
        )

    async def score_revision_delivery(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> PlaybackDelivery:
        return await self.delivery_read_model.score_revision_delivery(
            db,
            score_uuid,
            revision_uuid,
            user_id,
        )

    async def grant_delivery(
        self,
        db: AsyncSession,
        token: str,
        user_id: int | None,
    ) -> PlaybackDelivery:
        grant = await self.sharing_repository.grant_by_token_hash(db, hash_share_token(token))
        if grant is None:
            raise ResourceNotFoundException("share_grant", code=ErrorCode.SHARE_NOT_FOUND)
        score = await db.get(Score, grant.score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            share_token=token,
        )
        return await self.delivery_read_model.delivery_for_revision(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            score_id=require_persisted_id(score.id, entity="score"),
        )

    async def public_delivery(
        self,
        db: AsyncSession,
        slug: str,
        user_id: int | None,
    ) -> PlaybackDelivery:
        publication = await self.publication_repository.by_slug(db, slug)
        if publication is None or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException("publication", slug, ErrorCode.RESOURCE_NOT_FOUND)
        score = await db.get(Score, publication.score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", slug, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            public_slug=slug,
        )
        return await self.delivery_read_model.delivery_for_revision(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            score_id=require_persisted_id(score.id, entity="score"),
        )
