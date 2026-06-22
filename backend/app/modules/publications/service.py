from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScoreArtifact,
    ScorePublication,
    ScoreRevision,
    ScoreRevisionMetadata,
)
from app.db.models.score import ArtifactKind
from app.db.models.score_access import PublicationStatus
from app.modules.artifacts.service import ArtifactService
from app.modules.metadata.service import MetadataProjectionService
from app.modules.publications.repository import PublicationRepository
from app.modules.publications.schemas import (
    PublicationRead,
    PublicationUpsertRequest,
    PublicScoreContentRead,
    PublicScoreRead,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive
from app.storage import FileStorage, file_storage


class PublicationService:
    def __init__(
        self,
        repository: PublicationRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        artifact_service: ArtifactService | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or PublicationRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.storage = storage or file_storage
        self.artifact_service = artifact_service or ArtifactService(
            access_policy=self.access_policy
        )

    async def publish(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: PublicationUpsertRequest,
    ) -> PublicationRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.PUBLISH,
            user_id=user_id,
            revision_uuid=request.revision_id,
        )
        score = access.score
        revision = access.revision
        score_id = require_persisted_id(score.id, entity="score")
        publication = await self.repository.by_score(db, score_id)
        now = utc_now_naive()
        if publication:
            if request.public_slug and request.public_slug != publication.public_slug:
                publication.public_slug = request.public_slug
            publication.published_revision_id = require_persisted_id(
                revision.id, entity="score revision"
            )
            publication.status = PublicationStatus.PUBLISHED
            publication.discoverability = request.discoverability
            publication.allow_download = request.allow_download
            publication.allow_practice = request.allow_practice
            publication.updated_at = now
        else:
            publication = ScorePublication(
                score_id=score_id,
                public_slug=request.public_slug or self._default_slug(score),
                published_revision_id=require_persisted_id(
                    revision.id, entity="score revision"
                ),
                status=PublicationStatus.PUBLISHED,
                discoverability=request.discoverability,
                allow_download=request.allow_download,
                allow_practice=request.allow_practice,
                published_by_user_id=user_id,
                published_at=now,
                updated_at=now,
            )
            db.add(publication)
        await db.commit()
        await db.refresh(publication)
        return self._read(publication, score, revision.revision_uuid)

    async def get_for_score(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> PublicationRead | None:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.VIEW, user_id=user_id
        )
        publication = await self.repository.by_score(
            db, require_persisted_id(access.score.id, entity="score")
        )
        if not publication:
            return None
        revision = await db.get(ScoreRevision, publication.published_revision_id)
        if not revision:
            return None
        return self._read(publication, access.score, revision.revision_uuid)

    async def unpublish(
        self, db: AsyncSession, score_uuid: str, user_id: int
    ) -> PublicationRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.PUBLISH, user_id=user_id
        )
        publication = await self.repository.by_score(
            db, require_persisted_id(access.score.id, entity="score")
        )
        if not publication:
            raise ResourceNotFoundException(
                "publication", score_uuid, ErrorCode.RESOURCE_NOT_FOUND
            )
        publication.status = PublicationStatus.UNPUBLISHED
        publication.updated_at = utc_now_naive()
        await db.commit()
        revision = await db.get(ScoreRevision, publication.published_revision_id)
        return self._read(
            publication,
            access.score,
            revision.revision_uuid if revision else access.revision.revision_uuid,
        )

    async def public_detail(
        self, db: AsyncSession, slug: str, user_id: int | None = None
    ) -> PublicScoreRead:
        publication = await self.repository.by_slug(db, slug)
        if not publication or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException(
                "publication", slug, ErrorCode.RESOURCE_NOT_FOUND
            )
        score = await db.get(Score, publication.score_id)
        if not score:
            raise ResourceNotFoundException("score", slug, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            public_slug=slug,
        )
        artifacts = await self.artifact_service.list(
            db,
            score.score_uuid,
            user_id,
            revision_uuid=access.revision.revision_uuid,
            public_slug=slug,
        )
        projection = await db.get(
            ScoreRevisionMetadata,
            require_persisted_id(access.revision.id, entity="score revision"),
        )
        return PublicScoreRead(
            publication=self._read(
                publication, score, access.revision.revision_uuid
            ),
            title=score.title,
            difficulty=score.difficulty,
            metadata=(
                MetadataProjectionService.to_read(access.revision, projection)
                if projection
                else None
            ),
            artifacts=artifacts,
            capabilities=access.capabilities,
        )

    async def public_content(
        self, db: AsyncSession, slug: str, user_id: int | None = None
    ) -> PublicScoreContentRead:
        publication = await self.repository.by_slug(db, slug)
        if not publication or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException(
                "publication", slug, ErrorCode.RESOURCE_NOT_FOUND
            )
        score = await db.get(Score, publication.score_id)
        if not score:
            raise ResourceNotFoundException("score", slug, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            public_slug=slug,
        )
        artifact = (
            await db.execute(
                select(ScoreArtifact).where(
                    ScoreArtifact.revision_id == access.revision.id,
                    ScoreArtifact.kind == ArtifactKind.MUSICXML,
                )
            )
        ).scalar_one_or_none()
        if not artifact:
            raise ResourceNotFoundException("artifact", slug, ErrorCode.FILE_NOT_FOUND)
        return PublicScoreContentRead(
            score_id=score.score_uuid,
            revision_id=access.revision.revision_uuid,
            content=self.storage.read_bytes(artifact.storage_key).decode("utf-8"),
            mime_type=artifact.mime_type,
        )

    async def public_artifact_delivery(
        self,
        db: AsyncSession,
        slug: str,
        artifact_uuid: str,
        user_id: int | None = None,
        *,
        download: bool = True,
    ):
        publication = await self.repository.by_slug(db, slug)
        if not publication or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException(
                "publication", slug, ErrorCode.RESOURCE_NOT_FOUND
            )
        return await self.artifact_service.delivery(
            db,
            artifact_uuid,
            user_id,
            public_slug=slug,
            action=ScoreAction.DOWNLOAD if download else ScoreAction.VIEW,
        )

    @staticmethod
    def _default_slug(score: Score) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", score.title.lower()).strip("-")
        return f"{base or 'score'}-{score.score_uuid[:8]}"

    @staticmethod
    def _read(
        publication: ScorePublication, score: Score, revision_uuid: str
    ) -> PublicationRead:
        return PublicationRead(
            public_slug=publication.public_slug,
            score_id=score.score_uuid,
            revision_id=revision_uuid,
            status=publication.status,
            discoverability=publication.discoverability,
            allow_download=publication.allow_download,
            allow_practice=publication.allow_practice,
            published_at=publication.published_at,
            updated_at=publication.updated_at,
        )
