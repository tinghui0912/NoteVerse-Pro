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
from app.processing.practice_score.piano_key import PracticeScoreInvalidError
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from .builder import PracticeSourceBuilder
from .domain import (
    AuthorizedPracticeSource,
    PinnedPracticeSource,
    PracticeSourceBundle,
    PracticeSourceSnapshotRef,
)
from .repository import PracticeSourceRepository
from .schemas import (
    PracticeSourceArtifactRead,
    PracticeSourceContentRead,
    PracticeScoreArtifactRead,
)


class PracticeSourceService:
    """Authorize revision source, derive one bundle and own its durable materialization."""

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

    async def get_source(
        self, db: AsyncSession, score_uuid: str, user_id: int, revision_uuid: str
    ) -> AuthorizedPracticeSource:
        access, path = await self._authorized_musicxml_path(
            db, score_uuid=score_uuid, user_id=user_id, revision_uuid=revision_uuid
        )
        try:
            canonical = await asyncio.to_thread(path.read_bytes)
            bundle = await asyncio.to_thread(
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
        return AuthorizedPracticeSource(
            bundle,
            require_persisted_id(access.score.id, entity="score"),
            require_persisted_id(access.revision.id, entity="score revision"),
            access.score.title,
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
    def artifact_read(bundle: PracticeSourceBundle) -> PracticeSourceArtifactRead:
        return PracticeSourceArtifactRead(
            source_id=bundle.source_id,
            artifact=PracticeScoreArtifactRead.model_validate(bundle.artifact.value),
        )

    @staticmethod
    def content_read(bundle: PracticeSourceBundle) -> PracticeSourceContentRead:
        return PracticeSourceContentRead(
            source_id=bundle.source_id,
            score_id=bundle.score_id,
            revision_id=bundle.revision_id,
            content=bundle.prepared_musicxml.content,
            mime_type=bundle.prepared_musicxml.mime_type,
        )

    async def get_artifact(
        self, db: AsyncSession, score_uuid: str, user_id: int, revision_uuid: str
    ) -> PracticeSourceArtifactRead:
        return self.artifact_read(
            (await self.get_source(db, score_uuid, user_id, revision_uuid)).bundle
        )

    async def get_content(
        self, db: AsyncSession, score_uuid: str, user_id: int, revision_uuid: str
    ) -> PracticeSourceContentRead:
        return self.content_read(
            (await self.get_source(db, score_uuid, user_id, revision_uuid)).bundle
        )

    async def pin_source(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        score_id: str,
        revision_id: str,
        expected_artifact_id: str,
    ) -> PinnedPracticeSource:
        try:
            authorized = await self.get_source(db, score_id, user_id, revision_id)
        except ResourceNotFoundException as error:
            if error.code == ErrorCode.REVISION_NOT_FOUND:
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="revision_id"
                ) from error
            raise
        bundle = authorized.bundle
        if bundle.artifact.artifact_id != expected_artifact_id:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="artifact_id",
                details={"reason": "source_artifact_identity_mismatch"},
            )
        snapshot = await self.repository.materialize(db, bundle)
        return PinnedPracticeSource(
            snapshot,
            authorized.score_db_id,
            authorized.revision_db_id,
            bundle.score_id,
            bundle.revision_id,
            authorized.score_title,
        )

    async def snapshot(
        self, db: AsyncSession, snapshot_id: int | None, *, lock: bool = False
    ) -> PracticeSourceSnapshotRef:
        return await self.repository.require_ready(db, snapshot_id, lock=lock)

    async def find_snapshot(
        self, db: AsyncSession, snapshot_id: int | None
    ) -> PracticeSourceSnapshotRef | None:
        return await self.repository.find_ready(db, snapshot_id)

    async def list_snapshots(
        self, db: AsyncSession, ids: set[int]
    ) -> dict[int, PracticeSourceSnapshotRef]:
        return await self.repository.list_ready(db, ids)

    async def release_snapshot(self, db: AsyncSession, snapshot_id: int | None) -> None:
        await self.repository.enqueue_if_unreferenced(db, snapshot_id)

    async def get_snapshot_content(
        self, db: AsyncSession, snapshot_id: int | None
    ) -> PracticeSourceContentRead:
        return self.content_read(await self.repository.read_bundle(db, snapshot_id))

    async def get_snapshot_artifact(
        self, db: AsyncSession, snapshot_id: int | None
    ) -> PracticeSourceArtifactRead:
        return self.artifact_read(await self.repository.read_bundle(db, snapshot_id))
