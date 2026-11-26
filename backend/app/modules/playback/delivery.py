from __future__ import annotations

from app.modules.media_storage.delivery import MediaDeliveryService
from app.modules.media_storage.reads import StoredObjectDelivery


from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScorePlaybackAsset
from app.modules.playback.domain import PlaybackAssetKind
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.shared.error_codes import CustomerErrorCode


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
        access = self.access_policy.authorize_revision(
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
            raise ResourceNotFoundException("playback_asset", code=CustomerErrorCode.FILE_NOT_FOUND)
        return StoredObjectDelivery.for_object(asset.stored_object, asset.filename)


class PlaybackDeliveryService:
    """Authorize and stream previously generated playback assets for API traffic."""

    def __init__(
        self,
        access_policy: ScoreAccessPolicy | None = None,
        delivery_read_model: PlaybackDeliveryReadModel | None = None,
        *,
        delivery: MediaDeliveryService,
    ) -> None:
        self.delivery = delivery
        self.storage = delivery.storage
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
