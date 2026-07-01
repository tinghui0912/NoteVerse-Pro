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
from app.db.models.score_access import ShareTargetMode
from app.modules.score_access.policy import (
    ScoreAccessPolicy,
    ScoreAction,
    hash_share_token,
)
from app.modules.artifacts.service import ArtifactDelivery, ArtifactService
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
    GrantContentRead,
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
        artifact_service: ArtifactService | None = None,
        score_repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or ScoreSharingRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.storage = storage or file_storage
        self.score_repository = score_repository or ScoreRepository()
        self.artifact_service = artifact_service or ArtifactService(
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
        target_revision_id = None
        target_revision_uuid = None
        if request.target_mode == ShareTargetMode.PINNED:
            target = await self.access_policy.resolve(
                db,
                score_uuid,
                user_id=user_id,
                revision_uuid=request.target_revision_id,
            )
            target_revision_id = require_persisted_id(
                target.revision.id, entity="score revision"
            )
            target_revision_uuid = target.revision.revision_uuid
        grant_uuid = str(uuid.uuid4())
        token = generate_share_token()
        now = utc_now_naive()
        expires_at = to_utc_naive(request.expires_at)
        grant = ScoreShareGrant(
            grant_uuid=grant_uuid,
            score_id=require_persisted_id(access.score.id, entity="score"),
            token_hash=hash_share_token(token),
            target_mode=request.target_mode,
            target_revision_id=target_revision_id,
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
            target_mode=grant.target_mode,
            target_revision_id=target_revision_uuid,
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
                    target_mode=grant.target_mode,
                    target_revision_id=await self.repository.revision_uuid(
                        db, grant.target_revision_id
                    ),
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
            target_mode=grant.target_mode,
            target_revision_id=await self.repository.revision_uuid(
                db, grant.target_revision_id
            ),
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
        artifacts = await self.artifact_service.list(
            db,
            score.score_uuid,
            user_id,
            revision_uuid=access.revision.revision_uuid,
            share_token=token,
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
                    db, require_persisted_id(score.id, entity="score")
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
            artifacts=artifacts,
        )

    async def grant_content(
        self, db: AsyncSession, token: str, user_id: int | None
    ) -> GrantContentRead:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            share_token=token,
        )
        artifact = await self.score_repository.canonical_artifact(
            db, require_persisted_id(access.revision.id, entity="score revision")
        )
        if not artifact:
            raise ResourceNotFoundException("artifact", token, ErrorCode.FILE_NOT_FOUND)
        return GrantContentRead(
            score_id=score.score_uuid,
            revision_id=access.revision.revision_uuid,
            content=self.storage.read_bytes(artifact.storage_key).decode("utf-8"),
            mime_type=artifact.mime_type,
        )

    async def grant_artifact_delivery(
        self,
        db: AsyncSession,
        token: str,
        artifact_uuid: str,
        user_id: int | None,
        *,
        download: bool = True,
    ) -> ArtifactDelivery:
        grant = await self._grant_by_token(db, token)
        score = await db.get(Score, grant.score_id)
        if not score:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        return await self.artifact_service.delivery(
            db,
            artifact_uuid,
            user_id,
            share_token=token,
            action=ScoreAction.DOWNLOAD if download else ScoreAction.VIEW,
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


