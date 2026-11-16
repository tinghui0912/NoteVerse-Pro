from app.storage import ObjectStorage
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col
from app.db.model_utils import require_persisted_id

from app.core.exceptions import ResourceNotFoundException
from app.db.models import Score, ScoreRevision, User
from app.db.models.score import RenderAssetKind
from app.modules.guest_previews.schemas import (
    GuestPreviewUpdateRequest,
    GuestPreviewSettingsRead,
    GuestPreviewPageRead,
    GuestPreviewRead,
)
from app.modules.playback.delivery import PlaybackDeliveryReadModel
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.storage_objects.reads import StoredObjectDelivery
from app.shared.constants import ErrorCode
from app.storage import object_storage


class GuestPreviewService:
    """Owner settings and presentation-only bearer access to the current Score head."""

    def __init__(
        self,
        *,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.assets = ScoreAssetRepository()
        self.playback = PlaybackDeliveryReadModel(access_policy=self.access_policy)

    def settings(self, db: Session, score_uuid: str, user_id: int) -> GuestPreviewSettingsRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        return self._settings(access.score)

    def update_settings(
        self, db: Session, score_uuid: str, user_id: int, request: GuestPreviewUpdateRequest
    ) -> GuestPreviewSettingsRead:
        self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        score = (
            db.execute(
                select(Score)
                .where(
                    Score.score_uuid == score_uuid,
                    Score.owner_user_id == user_id,
                    Score.__table__.c.deleted_at.is_(None),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if score is None:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        score.guest_preview_enabled = request.enabled
        db.commit()
        db.refresh(score)
        return self._settings(score)

    @staticmethod
    def _settings(score: Score) -> GuestPreviewSettingsRead:
        return GuestPreviewSettingsRead(
            enabled=score.guest_preview_enabled, token=score.guest_preview_token
        )

    def read(self, db: Session, token: str) -> GuestPreviewRead:
        score, revision = self._authorize(db, token)
        pages = self.assets.list_render_assets(
            db, require_persisted_id(revision.id, entity="revision"), RenderAssetKind.RENDERED_PAGE
        )
        audio = self.assets.playback_asset(db, require_persisted_id(revision.id, entity="revision"))
        owner = db.get(User, score.owner_user_id)
        return GuestPreviewRead(
            display_title=score.display_title,
            shared_by=(owner.display_name or "") if owner else "",
            render_assets=[
                GuestPreviewPageRead(asset_id=a.asset_uuid, page_number=a.page_number)
                for a in pages
                if a.page_number is not None
            ],
            audio_available=audio is not None,
        )

    def image(self, db: Session, token: str, asset_uuid: str) -> StoredObjectDelivery:
        _, revision = self._authorize(db, token)
        asset = self.assets.get_render_asset(db, asset_uuid)
        if (
            asset is None
            or asset.revision_id != revision.id
            or asset.kind != RenderAssetKind.RENDERED_PAGE
        ):
            raise ResourceNotFoundException("render_asset", code=ErrorCode.FILE_NOT_FOUND)
        return StoredObjectDelivery.for_object(asset.stored_object, asset.filename)

    def audio(self, db: Session, token: str) -> StoredObjectDelivery:
        _, revision = self._authorize(db, token)
        return self.playback.delivery_for_revision(
            db, require_persisted_id(revision.id, entity="revision")
        )

    def _authorize(self, db: Session, token: str) -> tuple[Score, ScoreRevision]:
        score = (
            db.execute(
                select(Score)
                .where(
                    Score.guest_preview_token == token,
                    col(Score.guest_preview_enabled).is_(True),
                    Score.__table__.c.deleted_at.is_(None),
                )
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        revision = (
            db.get(ScoreRevision, score.head_revision_id)
            if score is not None and score.head_revision_id is not None
            else None
        )
        if score is None or revision is None or revision.score_id != score.id:
            raise ResourceNotFoundException("guest_preview", code=ErrorCode.GUEST_PREVIEW_NOT_FOUND)
        return score, revision
