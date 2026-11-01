from __future__ import annotations

import asyncio
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.modules.score_access.policy import ScoreAccessContext, ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.practice.score.piano_key import PracticeScoreInvalidError
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from .builder import PracticeSourceBuilder
from .domain import (
    AuthorizedPracticeSource,
    PracticeSource,
    PracticeSourceRef,
)
from .repository import PracticeSourceRepository
from .schemas import (
    PracticeSourceRead,
    PracticeSourceNotationRead,
    PracticeScoreArtifactRead,
)


class PracticeSourceService:
    """Authorize revision source, resolve one immutable durable PracticeSource."""

    def __init__(
        self,
        *,
        access_policy: ScoreAccessPolicy | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: FileStorage | None = None,
        builder: PracticeSourceBuilder | None = None,
        repository: PracticeSourceRepository | None = None,
    ) -> None:
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or file_storage
        self.builder = builder or PracticeSourceBuilder()
        self.repository = repository or PracticeSourceRepository(self.storage)

    async def resolve_source(
        self, db: AsyncSession, score_uuid: str, user_id: int, revision_uuid: str
    ) -> AuthorizedPracticeSource:
        access, path = await self._authorized_musicxml_path(
            db, score_uuid=score_uuid, user_id=user_id, revision_uuid=revision_uuid
        )
        try:
            canonical = await asyncio.to_thread(path.read_bytes)
            candidate = await asyncio.to_thread(
                self.builder.build,
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
                canonical_musicxml=canonical,
            )
        except PracticeScoreInvalidError as error:
            logger.bind(
                event="practice.score.invalid",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=error).warning("Invalid Practice score")
            raise ValidationException(code=ErrorCode.PRACTICE_SCORE_INVALID) from error
        except Exception as error:
            logger.bind(
                event="practice.source.failed",
                score_id=access.score.score_uuid,
                revision_id=access.revision.revision_uuid,
            ).opt(exception=error).warning("Practice source construction failed")
            raise ExternalServiceException(
                service="practice_source", code=ErrorCode.PRACTICE_SOURCE_FAILED
            ) from error
        score_db_id = require_persisted_id(access.score.id, entity="score")
        revision_db_id = require_persisted_id(access.revision.id, entity="score revision")
        score_title = access.score.title
        source_ref, source = await self.repository.get_or_create(
            db, candidate, live_revision_id=revision_db_id
        )
        return AuthorizedPracticeSource(
            source, source_ref, score_db_id, revision_db_id, score_title
        )

    async def _authorized_musicxml_path(
        self, db: AsyncSession, *, score_uuid: str, user_id: int, revision_uuid: str
    ) -> tuple[ScoreAccessContext, Path]:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.PRACTICE, user_id=user_id, revision_uuid=revision_uuid
        )
        source = await self.asset_repository.canonical_source(
            db, require_persisted_id(access.revision.id, entity="score revision")
        )
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        path = self.storage.materialize_to_local(
            source.storage_key, self.storage.local_path(source.storage_key)
        )
        return access, Path(path)

    @staticmethod
    def source_read(source: PracticeSource, *, include_notation: bool) -> PracticeSourceRead:
        return PracticeSourceRead(
            source_id=source.source_id,
            artifact=PracticeScoreArtifactRead.model_validate(source.artifact.value),
            notation=PracticeSourceNotationRead(musicxml=source.prepared_musicxml.content)
            if include_notation
            else None,
        )

    async def read_source(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        revision_uuid: str,
        *,
        include_notation: bool = False,
    ) -> PracticeSourceRead:
        authorized = await self.resolve_source(db, score_uuid, user_id, revision_uuid)
        return self.source_read(authorized.source, include_notation=include_notation)

    async def require_source(
        self, db: AsyncSession, practice_source_id: int | None, *, lock: bool = False
    ) -> PracticeSourceRef:
        return await self.repository.require_ready(db, practice_source_id, lock=lock)

    async def find_source(
        self, db: AsyncSession, practice_source_id: int | None
    ) -> PracticeSourceRef | None:
        return await self.repository.find_ready(db, practice_source_id)

    async def list_sources(self, db: AsyncSession, ids: set[int]) -> dict[int, PracticeSourceRef]:
        return await self.repository.list_ready(db, ids)

    async def release_source_reference(
        self, db: AsyncSession, practice_source_id: int | None
    ) -> None:
        await self.repository.enqueue_if_unowned(db, practice_source_id)

    async def read_source_by_id(
        self,
        db: AsyncSession,
        practice_source_id: int | None,
        *,
        include_notation: bool = False,
    ) -> PracticeSourceRead:
        source = await self.repository.read(db, practice_source_id)
        return self.source_read(source, include_notation=include_notation)
