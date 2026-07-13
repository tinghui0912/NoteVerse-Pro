from __future__ import annotations

import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceNotFoundException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    LibraryEntrySourceType,
    Score,
    ScoreLibraryEntry,
    ScoreShareGrant,
    ShareGrantRedemption,
    User,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction, hash_share_token
from app.modules.score_assets.derived_assets import score_derived_assets
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.service import ScoreAssetDelivery, ScoreAssetService
from app.modules.metadata.service import MetadataProjectionService
from app.modules.scores.repository import ScoreRepository
from app.storage import FileStorage, file_storage
from app.db.models import ScoreRevisionMetadata
from app.modules.score_sharing.repository import ScoreSharingRepository
from app.modules.score_sharing.schemas import (
    GrantBookmarkRead,
    GrantAccessRead,
    GrantCreateRequest,
    GrantCreatedRead,
    GrantRead,
    ShareActorRead,
)
from app.modules.scores.schemas import ScoreTaxonomyTagRead
from app.shared.constants import ErrorCode
from app.utils.timezone import to_utc_naive, utc_now_naive


SHARE_TOKEN_BYTES = 32


def generate_share_token() -> str:
    return secrets.token_urlsafe(SHARE_TOKEN_BYTES)


class ScoreSharingService:
    def __init__(
        self,
        repository: ScoreSharingRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        asset_service: ScoreAssetService | None = None,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or ScoreSharingRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.storage = storage or file_storage
        self.score_repository = score_repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.asset_service = asset_service or ScoreAssetService(
            score_repository=self.score_repository,
            storage=self.storage,
            access_policy=self.access_policy,
        )

    async def create_grant(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: GrantCreateRequest,
    ) -> GrantCreatedRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_SHARING, user_id=user_id
        )
        grant_uuid = str(uuid.uuid4())
        token = generate_share_token()
        now = utc_now_naive()
        expires_at = to_utc_naive(request.expires_at)
        grant = ScoreShareGrant(
            grant_uuid=grant_uuid,
            score_id=require_persisted_id(access.score.id, entity="score"),
            token_hash=hash_share_token(token),
            allow_download=request.allow_download,
            allow_practice=request.allow_practice,
            expires_at=expires_at,
            created_by_user_id=user_id,
            created_at=now,
        )
        db.add(grant)
        await db.commit()
        return GrantCreatedRead(
            grant_id=grant.grant_uuid,
            token=token,
            allow_download=grant.allow_download,
            allow_practice=grant.allow_practice,
            expires_at=grant.expires_at,
            created_at=grant.created_at,
        )

    async def list_grants(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> list[GrantRead]:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.MANAGE_SHARING, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        result: list[GrantRead] = []
        for grant in await self.repository.grants(db, score_id):
            result.append(
                GrantRead(
                    grant_id=grant.grant_uuid,
                    token=None,
                    allow_download=grant.allow_download,
                    allow_practice=grant.allow_practice,
                    expires_at=grant.expires_at,
                    revoked_at=grant.revoked_at,
                    created_at=grant.created_at,
                )
            )
        return result

    async def revoke_grant(
        self, db: AsyncSession, grant_uuid: str, user_id: int
    ) -> GrantRead:
        grant = await self._managed_grant(db, grant_uuid, user_id)
        if grant.revoked_at is None:
            grant.revoked_at = utc_now_naive()
        await db.commit()
        return await self._grant_read(db, grant)

    async def restore_grant(
        self, db: AsyncSession, grant_uuid: str, user_id: int
    ) -> GrantRead:
        grant = await self._managed_grant(db, grant_uuid, user_id)
        if grant.expires_at is not None and grant.expires_at <= utc_now_naive():
            raise ValidationException(ErrorCode.SHARE_EXPIRED, field="expires_at")
        grant.revoked_at = None
        await db.commit()
        return await self._grant_read(db, grant)

    async def delete_grant(
        self, db: AsyncSession, grant_uuid: str, user_id: int
    ) -> None:
        grant = await self._managed_grant(db, grant_uuid, user_id)
        await db.delete(grant)
        await db.commit()

    async def _grant_read(
        self, db: AsyncSession, grant: ScoreShareGrant
    ) -> GrantRead:
        return GrantRead(
            grant_id=grant.grant_uuid,
            token=None,
            allow_download=grant.allow_download,
            allow_practice=grant.allow_practice,
            expires_at=grant.expires_at,
            revoked_at=grant.revoked_at,
            created_at=grant.created_at,
        )

    async def access_grant(
        self, db: AsyncSession, token: str, user_id: int | None
    ) -> GrantAccessRead:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.resolve(
            db, score.score_uuid, user_id=user_id, share_token=token
        )
        projection = await db.get(
            ScoreRevisionMetadata,
            require_persisted_id(access.revision.id, entity="score revision"),
        )
        revision_assets = await self.asset_service.list_revision_assets(
            db,
            score.score_uuid,
            user_id,
            revision_uuid=access.revision.revision_uuid,
            include_sources=grant.allow_download,
            share_token=token,
        )
        score_id = require_persisted_id(score.id, entity="score")
        derived_assets = await score_derived_assets(
            db,
            self.asset_repository,
            score_id=score_id,
            revision=access.revision,
        )
        shared_by = await db.get(User, grant.created_by_user_id)
        return GrantAccessRead(
            score_id=score.score_uuid,
            revision_id=access.revision.revision_uuid,
            title=score.title,
            taxonomy_tags=[
                ScoreTaxonomyTagRead(
                    category=category,
                    code=code,
                    source=source,
                    confidence=confidence,
                )
                for category, code, source, confidence in await self.score_repository.taxonomy_tags(
                    db, score_id
                )
            ],
            shared_by=(
                ShareActorRead(
                    display_name=shared_by.display_name,
                    avatar_url=shared_by.avatar_url,
                )
                if shared_by
                else None
            ),
            shared_at=grant.created_at,
            capabilities=access.capabilities,
            metadata=(
                MetadataProjectionService.to_read(access.revision, projection)
                if projection
                else None
            ),
            derived_assets=derived_assets,
            revision_assets=revision_assets,
        )

    async def grant_revision_source_delivery(
        self,
        db: AsyncSession,
        token: str,
        source_uuid: str,
        user_id: int | None,
    ) -> ScoreAssetDelivery:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        return await self.asset_service.source_delivery(
            db,
            source_uuid,
            user_id,
            share_token=token,
        )

    async def grant_render_asset_delivery(
        self,
        db: AsyncSession,
        token: str,
        render_asset_uuid: str,
        user_id: int | None,
        *,
        download: bool = True,
    ) -> ScoreAssetDelivery:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        return await self.asset_service.render_asset_delivery(
            db,
            render_asset_uuid,
            user_id,
            share_token=token,
            download=download,
        )

    async def bookmark_grant(
        self, db: AsyncSession, token: str, user_id: int
    ) -> GrantBookmarkRead:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        await self.access_policy.resolve(
            db, score.score_uuid, user_id=user_id, share_token=token
        )
        grant_id = require_persisted_id(grant.id, entity="share grant")
        if not await self.repository.redemption(db, grant_id, user_id):
            db.add(ShareGrantRedemption(grant_id=grant_id, user_id=user_id))
        entry = await self._library_entry(db, grant.score_id, user_id)
        if entry:
            if not entry.is_favorite:
                entry.is_favorite = True
            entry.updated_at = utc_now_naive()
        else:
            entry = ScoreLibraryEntry(
                score_id=grant.score_id,
                user_id=user_id,
                source_type=LibraryEntrySourceType.BOOKMARK,
                is_favorite=True,
            )
            db.add(entry)
        await db.commit()
        await db.refresh(entry)
        return GrantBookmarkRead(
            entry_id=entry.entry_uuid,
            score_id=score.score_uuid,
            title=score.title,
            available=True,
            unavailable_reason=None,
            created_at=entry.created_at,
        )

    async def _grant_by_token(
        self, db: AsyncSession, token: str
    ) -> ScoreShareGrant:
        grant = await self.repository.grant_by_token_hash(db, hash_share_token(token))
        if not grant:
            raise ResourceNotFoundException("share_grant", code=ErrorCode.SHARE_NOT_FOUND)
        if grant.revoked_at is not None:
            raise ValidationException(ErrorCode.SHARE_REVOKED, field="token")
        if grant.expires_at is not None and grant.expires_at <= utc_now_naive():
            raise ValidationException(ErrorCode.SHARE_EXPIRED, field="token")
        return grant

    async def _library_entry(
        self, db: AsyncSession, score_id: int, user_id: int
    ) -> ScoreLibraryEntry | None:
        return (
            await db.execute(
                select(ScoreLibraryEntry).where(
                    ScoreLibraryEntry.score_id == score_id,
                    ScoreLibraryEntry.user_id == user_id,
                    ScoreLibraryEntry.source_type == LibraryEntrySourceType.BOOKMARK,
                    ScoreLibraryEntry.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    async def _grant_by_uuid(
        self, db: AsyncSession, grant_uuid: str
    ) -> ScoreShareGrant:
        grant = await self.repository.grant_by_uuid(db, grant_uuid)
        if not grant:
            raise ResourceNotFoundException(
                "share_grant", grant_uuid, ErrorCode.SHARE_NOT_FOUND
            )
        return grant

    async def _managed_grant(
        self, db: AsyncSession, grant_uuid: str, user_id: int
    ) -> ScoreShareGrant:
        grant = await self._grant_by_uuid(db, grant_uuid)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", grant_uuid, ErrorCode.SCORE_NOT_FOUND)
        await self.access_policy.authorize(
            db, score.score_uuid, ScoreAction.MANAGE_SHARING, user_id=user_id
        )
        return grant


