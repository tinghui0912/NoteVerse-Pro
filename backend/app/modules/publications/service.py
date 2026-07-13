from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScorePublication,
    ScoreRevision,
    ScoreRevisionMetadata,
)
from app.db.models.score_access import PublicationStatus
from app.modules.metadata.service import MetadataProjectionService
from app.modules.publications.repository import PublicationRepository
from app.modules.publications.schemas import (
    PublicationRead,
    PublicationUpsertRequest,
    PublicScoreRead,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.derived_assets import score_derived_assets
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.schemas import ScoreTaxonomyTagRead
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class PublicationService:
    def __init__(
        self,
        repository: PublicationRepository | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        asset_service: ScoreAssetService | None = None,
        score_repository: ScoreRepository | None = None,
    ) -> None:
        self.repository = repository or PublicationRepository()
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.score_repository = score_repository or ScoreRepository()
        self.asset_service = asset_service or ScoreAssetService(
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
        revision_assets = await self.asset_service.list_revision_assets(
            db,
            score.score_uuid,
            user_id,
            revision_uuid=access.revision.revision_uuid,
            include_sources=publication.allow_download,
            public_slug=slug,
        )
        score_id = require_persisted_id(score.id, entity="score")
        derived_assets = await score_derived_assets(
            db,
            self.score_repository,
            score_id=score_id,
            revision=access.revision,
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
            metadata=(
                MetadataProjectionService.to_read(access.revision, projection)
                if projection
                else None
            ),
            derived_assets=derived_assets,
            revision_assets=revision_assets,
            capabilities=access.capabilities,
        )

    async def public_revision_source_delivery(
        self,
        db: AsyncSession,
        slug: str,
        source_uuid: str,
        user_id: int | None = None,
    ):
        publication = await self.repository.by_slug(db, slug)
        if not publication or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException(
                "publication", slug, ErrorCode.RESOURCE_NOT_FOUND
            )
        return await self.asset_service.source_delivery(
            db,
            source_uuid,
            user_id,
            public_slug=slug,
        )

    async def public_render_asset_delivery(
        self,
        db: AsyncSession,
        slug: str,
        render_asset_uuid: str,
        user_id: int | None = None,
        *,
        download: bool = True,
    ):
        publication = await self.repository.by_slug(db, slug)
        if not publication or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException(
                "publication", slug, ErrorCode.RESOURCE_NOT_FOUND
            )
        return await self.asset_service.render_asset_delivery(
            db,
            render_asset_uuid,
            user_id,
            public_slug=slug,
            download=download,
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
            allow_download=publication.allow_download,
            allow_practice=publication.allow_practice,
            published_at=publication.published_at,
            updated_at=publication.updated_at,
        )
