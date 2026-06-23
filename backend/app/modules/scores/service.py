from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ProcessingJob,
    Score,
    ScoreArtifact,
    ScoreRevision,
    ScoreRevisionMetadata,
)
from app.db.models.processing_job import ProcessingJobState
from app.db.models.score import ScoreState
from app.modules.scores.repository import ScoreRepository
from app.modules.scores.schemas import (
    ScoreRead,
    ScoreTaxonomyTagRead,
    ScoreUpdateRequest,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.artifacts.render_service import RevisionRenderService
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class ScoreService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        render_service: RevisionRenderService | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.render_service = render_service or RevisionRenderService(
            access_policy=self.access_policy,
            storage=self.storage,
        )

    async def get(self, db: AsyncSession, score_uuid: str, user_id: int) -> ScoreRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.VIEW, user_id=user_id
        )
        return await self._read(db, access.score, access.capabilities)

    async def list_owned(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
        search: str | None = None,
    ) -> tuple[list[ScoreRead], int]:
        rows, total = await self.repository.list_owned(
            db, user_id, page=page, page_size=page_size, search=search
        )
        result: list[ScoreRead] = []
        for score in rows:
            access = await self.access_policy.authorize(
                db, score.score_uuid, ScoreAction.VIEW, user_id=user_id
            )
            result.append(await self._read(db, score, access.capabilities))
        return result, total

    async def batch_delete(
        self, db: AsyncSession, score_uuids: list[str], user_id: int
    ) -> int:
        removed = 0
        for score_uuid in score_uuids:
            try:
                await self.delete(db, score_uuid, user_id)
            except (ResourceNotFoundException, UnauthorizedException):
                continue
            removed += 1
        return removed

    async def update(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: ScoreUpdateRequest,
    ) -> ScoreRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        if score.version != request.expected_version:
            raise ConflictException(
                ErrorCode.REVISION_CONFLICT,
                {"expected_version": request.expected_version, "actual_version": score.version},
            )
        if request.title is not None:
            score.title = request.title.strip()
        if request.taxonomy_tags is not None:
            score_id = require_persisted_id(score.id, entity="score")
            await self.repository.replace_taxonomy_tags(
                db,
                score_id,
                [(tag.category, tag.code) for tag in request.taxonomy_tags],
            )
        score.version += 1
        score.updated_at = utc_now_naive()
        await db.commit()
        await db.refresh(score)
        return await self._read(db, score, access.capabilities)

    async def approve(self, db: AsyncSession, score_uuid: str, user_id: int) -> ScoreRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.APPROVE, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        if score.head_revision_id is None:
            raise ConflictException(ErrorCode.REVISION_NOT_FOUND, {"score_id": score_uuid})
        score.approved_revision_id = score.head_revision_id
        score.state = ScoreState.ACTIVE
        score.version += 1
        score.updated_at = utc_now_naive()
        if score.originating_job_id is not None:
            job = await db.get(ProcessingJob, score.originating_job_id)
            if job:
                job.state = ProcessingJobState.SUCCESS
                job.updated_at = utc_now_naive()
        await db.commit()
        await db.refresh(score)
        head = await db.get(ScoreRevision, score.head_revision_id)
        if head:
            try:
                await self.render_service.render(
                    db, score.score_uuid, head.revision_uuid, user_id
                )
            except Exception:
                await db.rollback()
        return await self._read(db, score, access.capabilities)

    async def delete(self, db: AsyncSession, score_uuid: str, user_id: int) -> None:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.DELETE, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        score_id = require_persisted_id(score.id, entity="score")
        keys = list(
            (
                await db.execute(
                    select(ScoreArtifact.storage_key)
                    .join(ScoreRevision, ScoreArtifact.revision_id == ScoreRevision.id)
                    .where(ScoreRevision.score_id == score_id)
                )
            ).scalars().all()
        )
        score.head_revision_id = None
        score.approved_revision_id = None
        await db.flush()
        await db.delete(score)
        await db.commit()
        for key in keys:
            try:
                self.storage.delete(key)
            except Exception:
                # Database deletion is authoritative; orphan cleanup retries storage removal.
                pass

    async def _read(
        self,
        db: AsyncSession,
        score: Score,
        capabilities: ScoreCapabilities,
    ) -> ScoreRead:
        head = await db.get(ScoreRevision, score.head_revision_id) if score.head_revision_id else None
        approved = await db.get(ScoreRevision, score.approved_revision_id) if score.approved_revision_id else None
        job = await self.repository.originating_job(db, score.originating_job_id)
        projection = (
            await db.get(ScoreRevisionMetadata, score.head_revision_id)
            if score.head_revision_id
            else None
        )
        return ScoreRead(
            score_id=score.score_uuid,
            title=score.title,
            taxonomy_tags=[
                ScoreTaxonomyTagRead(
                    category=category,
                    code=code,
                    source=source,
                    confidence=confidence,
                )
                for category, code, source, confidence in await self.repository.taxonomy_tags(
                    db, require_persisted_id(score.id, entity="score")
                )
            ],
            state=score.state,
            version=score.version,
            head_revision_id=head.revision_uuid if head else None,
            approved_revision_id=approved.revision_uuid if approved else None,
            originating_job_id=job.job_uuid if job else None,
            metadata=(
                MetadataProjectionService.to_read(head, projection)
                if head and projection
                else None
            ),
            capabilities=capabilities,
            created_at=score.created_at,
            updated_at=score.updated_at,
        )
