from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectDelivery
from app.storage import ObjectStorage


from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import (
    PlaybackAssetKind,
    ScorePlaybackAsset,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.storage import object_storage


class PlaybackDeliveryReadModel:
    def __init__(
        self,
        *,
        access_policy: ScoreAccessPolicy,
    ) -> None:
        self.access_policy = access_policy

    def score_revision_delivery(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> StoredObjectDelivery:
        access = self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        return self.delivery_for_revision(
            db, require_persisted_id(access.revision.id, entity="score revision")
        )

    def delivery_for_revision(
        self,
        db: Session,
        revision_id: int,
    ) -> StoredObjectDelivery:
        asset = (
            db.execute(
                select(ScorePlaybackAsset).where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == PlaybackAssetKind.AUDIO,
                )
            )
        ).scalar_one_or_none()
        if asset is None:
            raise ResourceNotFoundException("playback_asset", code=ErrorCode.FILE_NOT_FOUND)
        return StoredObjectDelivery.for_object(asset.stored_object, asset.filename)


class PlaybackDeliveryService:
    """Authorize and stream previously generated playback assets for API traffic."""

    def __init__(
        self,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        delivery_read_model: PlaybackDeliveryReadModel | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.delivery_read_model = delivery_read_model or PlaybackDeliveryReadModel(
            access_policy=self.access_policy,
        )

    def score_revision_delivery(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> StoredObjectDelivery:
        return self.delivery_read_model.score_revision_delivery(
            db,
            score_uuid,
            revision_uuid,
            user_id,
        )
