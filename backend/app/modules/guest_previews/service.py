from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreDeletionStatus, ScoreGuestPreviewGrant, ScoreRevision, User
from app.db.models.score import RenderAssetKind
from app.modules.guest_previews.repository import GuestPreviewRepository
from app.modules.guest_previews.schemas import (
    GuestPreviewCreateRequest,
    GuestPreviewCreatedRead,
    GuestPreviewListItem,
    GuestPreviewPageRead,
    GuestPreviewRead,
)
from app.modules.playback.delivery import PlaybackDelivery, PlaybackDeliveryReadModel
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.revisions.derived_asset_retention_service import DerivedAssetRetentionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.service import ScoreAssetDelivery
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import to_utc_naive, utc_now_naive


class GuestPreviewService:
    """Owner-managed, expiring presentation access to one immutable revision."""

    def __init__(
        self,
        *,
        repository: GuestPreviewRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or GuestPreviewRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.assets = ScoreAssetRepository()
        self.playback = PlaybackDeliveryReadModel(
            storage=self.storage, access_policy=self.access_policy
        )

    async def create(
        self, db: AsyncSession, score_uuid: str, user_id: int, request: GuestPreviewCreateRequest
    ) -> GuestPreviewCreatedRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        now = utc_now_naive()
        expires_at = (
            to_utc_naive(request.expires_at)
            if request.expires_at is not None
            else now + timedelta(days=7)
        )
        if expires_at is None or not now < expires_at <= now + timedelta(days=30):
            raise ValidationException(field="expires_at")
        # Score -> outboxes is also the worker claim lock order. Keep the revision
        # resolved by this command even when another save has advanced the head.
        score = (
            await db.execute(
                select(Score)
                .where(Score.id == access.score.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        derivative_work = await revision_derivative_service.ensure_preview_work(
            db,
            score_id=require_persisted_id(score.id, entity="score"),
            revision_id=require_persisted_id(access.revision.id, entity="revision"),
            requested_by_user_id=user_id,
            source_fingerprint=access.revision.content_hash,
            storage=self.storage,
        )
        token = secrets.token_urlsafe(32)
        preview = ScoreGuestPreviewGrant(
            score_id=require_persisted_id(access.score.id, entity="score"),
            revision_id=require_persisted_id(access.revision.id, entity="revision"),
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=expires_at,
            created_by_user_id=user_id,
        )
        db.add(preview)
        await db.commit()
        await revision_derivative_service.dispatch_after_commit(derivative_work)
        await db.refresh(preview)
        return GuestPreviewCreatedRead(**self._read(preview).model_dump(), token=token)

    async def list(
        self, db: AsyncSession, score_uuid: str, user_id: int, *, limit: int
    ) -> list[GuestPreviewListItem]:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        return [
            self._read(p)
            for p in await self.repository.list_for_score(
                db, require_persisted_id(access.score.id, entity="score"), limit
            )
        ]

    async def revoke(
        self, db: AsyncSession, preview_uuid: str, user_id: int
    ) -> GuestPreviewListItem:
        preview = await self._managed(db, preview_uuid, user_id)
        if preview.revoked_at is None:
            preview.revoked_at = utc_now_naive()
            db.add(preview)
        score_id = preview.score_id
        await db.commit()
        await DerivedAssetRetentionService(storage=self.storage).cleanup_for_score_best_effort(
            db, score_id=score_id
        )
        await db.refresh(preview)
        return self._read(preview)

    async def delete(self, db: AsyncSession, preview_uuid: str, user_id: int) -> None:
        preview = await self._managed(db, preview_uuid, user_id)
        score_id = preview.score_id
        await db.delete(preview)
        await db.commit()
        await DerivedAssetRetentionService(storage=self.storage).cleanup_for_score_best_effort(
            db, score_id=score_id
        )

    async def read(self, db: AsyncSession, token: str) -> GuestPreviewRead:
        preview, score = await self._authorize(db, token)
        pages = await self.assets.list_render_assets(
            db, preview.revision_id, RenderAssetKind.RENDERED_PAGE
        )
        audio = await self.assets.playback_asset(db, preview.revision_id)
        actor = await db.get(User, preview.created_by_user_id)
        return GuestPreviewRead(
            title=score.title,
            shared_by=actor.display_name if actor else "",
            created_at=preview.created_at,
            expires_at=preview.expires_at,
            render_assets=[
                GuestPreviewPageRead(asset_id=a.asset_uuid, page_number=a.page_number)
                for a in pages
                if a.page_number is not None and self.storage.exists(a.storage_key)
            ],
            audio_available=audio is not None and self.storage.exists(audio.storage_key),
        )

    async def image(self, db: AsyncSession, token: str, asset_uuid: str) -> ScoreAssetDelivery:
        preview, _ = await self._authorize(db, token)
        asset = await self.assets.get_render_asset(db, asset_uuid)
        if (
            asset is None
            or asset.revision_id != preview.revision_id
            or asset.kind != RenderAssetKind.RENDERED_PAGE
            or not self.storage.exists(asset.storage_key)
        ):
            raise ResourceNotFoundException("render_asset", code=ErrorCode.FILE_NOT_FOUND)
        return ScoreAssetDelivery(
            filename=asset.filename, media_type=asset.mime_type, storage_key=asset.storage_key
        )

    async def audio(self, db: AsyncSession, token: str) -> PlaybackDelivery:
        preview, _ = await self._authorize(db, token)
        return await self.playback.delivery_for_revision(db, preview.revision_id)

    async def _authorize(
        self, db: AsyncSession, token: str
    ) -> tuple[ScoreGuestPreviewGrant, Score]:
        preview = await self.repository.by_token_hash(
            db, hashlib.sha256(token.encode()).hexdigest()
        )
        if preview is None:
            raise ResourceNotFoundException("guest_preview", code=ErrorCode.GUEST_PREVIEW_NOT_FOUND)
        if preview.revoked_at is not None:
            raise UnauthorizedException(ErrorCode.GUEST_PREVIEW_REVOKED)
        if preview.expires_at <= utc_now_naive():
            raise UnauthorizedException(ErrorCode.GUEST_PREVIEW_EXPIRED)
        score = await db.get(Score, preview.score_id)
        revision = await db.get(ScoreRevision, preview.revision_id)
        if (
            score is None
            or score.deletion_status != ScoreDeletionStatus.ACTIVE
            or revision is None
            or revision.score_id != preview.score_id
        ):
            raise ResourceNotFoundException("guest_preview", code=ErrorCode.GUEST_PREVIEW_NOT_FOUND)
        return preview, score

    async def _managed(
        self, db: AsyncSession, preview_uuid: str, user_id: int
    ) -> ScoreGuestPreviewGrant:
        preview = await self.repository.by_uuid(db, preview_uuid)
        if preview is None:
            raise ResourceNotFoundException("guest_preview", code=ErrorCode.GUEST_PREVIEW_NOT_FOUND)
        score = await db.get(Score, preview.score_id)
        if score is None:
            raise ResourceNotFoundException("score", code=ErrorCode.SCORE_NOT_FOUND)
        await self.access_policy.authorize(
            db, score.score_uuid, ScoreAction.MANAGE_GUEST_PREVIEWS, user_id=user_id
        )
        return preview

    @staticmethod
    def _read(preview: ScoreGuestPreviewGrant) -> GuestPreviewListItem:
        return GuestPreviewListItem(
            preview_id=preview.preview_uuid,
            expires_at=preview.expires_at,
            revoked_at=preview.revoked_at,
            created_at=preview.created_at,
        )
