from __future__ import annotations

from dataclasses import dataclass
import io
import zipfile

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import FileException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreArtifact, ScoreRevision
from app.db.models.score import ArtifactKind
from app.modules.artifacts.repository import ArtifactRepository
from app.modules.artifacts.schemas import (
    ArtifactAccessRead,
    ArtifactDiagnosticsRead,
    ArtifactRead,
)
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


@dataclass(frozen=True)
class ArtifactDelivery:
    filename: str
    media_type: str
    path: str | None = None
    redirect_url: str | None = None


class ArtifactService:
    def __init__(
        self,
        repository: ArtifactRepository | None = None,
        score_repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or ArtifactRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()

    async def list(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        kind: ArtifactKind | None = None,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> list[ArtifactRead]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        return [
            self._read(item, revision)
            for item in await self.repository.list_for_revision(db, revision_id, kind)
        ]

    async def delivery(
        self,
        db: AsyncSession,
        artifact_uuid: str,
        user_id: int | None,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
        action: ScoreAction = ScoreAction.DOWNLOAD,
    ) -> ArtifactDelivery:
        artifact, _revision = await self._authorized_artifact(
            db,
            artifact_uuid,
            user_id,
            action,
            share_token=share_token,
            public_slug=public_slug,
        )
        self._require_object(artifact)
        if self.storage.backend_name != "local":
            url = self.storage.download_url(
                artifact.storage_key,
                filename=artifact.filename,
                content_type=artifact.mime_type,
            )
            if not url:
                raise FileException(ErrorCode.FILE_NOT_FOUND, artifact.storage_key)
            return ArtifactDelivery(
                filename=artifact.filename,
                media_type=artifact.mime_type,
                redirect_url=url,
            )
        path = self.storage.materialize_to_local(
            artifact.storage_key, self.storage.local_path(artifact.storage_key)
        )
        return ArtifactDelivery(
            filename=artifact.filename,
            media_type=artifact.mime_type,
            path=path,
        )

    async def access_url(
        self,
        db: AsyncSession,
        artifact_uuid: str,
        user_id: int | None,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> ArtifactAccessRead:
        artifact, _revision = await self._authorized_artifact(
            db,
            artifact_uuid,
            user_id,
            ScoreAction.VIEW,
            share_token=share_token,
            public_slug=public_slug,
        )
        self._require_object(artifact)
        if self.storage.backend_name == "local":
            url = f"{settings.API_V1_STR}/artifacts/{artifact_uuid}/download"
            expires = None
        else:
            signed = self.storage.download_url(artifact.storage_key)
            if not signed:
                raise FileException(ErrorCode.FILE_NOT_FOUND, artifact.storage_key)
            url = signed
            expires = settings.S3_PRESIGN_EXPIRE_SECONDS
        return ArtifactAccessRead(
            artifact_id=artifact.artifact_uuid,
            url=url,
            filename=artifact.filename,
            mime_type=artifact.mime_type,
            expires_in=expires,
        )

    async def diagnostics(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> ArtifactDiagnosticsRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        items = await self.repository.list_for_revision(
            db, require_persisted_id(revision.id, entity="score revision")
        )
        missing = [item.artifact_uuid for item in items if not self.storage.exists(item.storage_key)]
        return ArtifactDiagnosticsRead(
            revision_id=revision.revision_uuid,
            artifact_count=len(items),
            missing_artifact_ids=missing,
        )

    async def cleanup_missing_derived(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> int:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        items = await self.repository.list_for_revision(
            db, require_persisted_id(revision.id, entity="score revision")
        )
        removed = 0
        for item in items:
            if item.kind == ArtifactKind.MUSICXML or self.storage.exists(item.storage_key):
                continue
            await db.delete(item)
            removed += 1
        await db.commit()
        return removed

    async def archive(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int | None,
        *,
        revision_uuid: str | None = None,
        kind: ArtifactKind,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> tuple[io.BytesIO, str]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.DOWNLOAD,
            user_id=user_id,
            revision_uuid=revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        artifacts = await self.repository.list_for_revision(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            kind,
        )
        if not artifacts:
            raise ResourceNotFoundException("artifact", score_uuid, ErrorCode.FILE_NOT_FOUND)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for artifact in artifacts:
                self._require_object(artifact)
                bundle.writestr(artifact.filename, self.storage.read_bytes(artifact.storage_key))
        archive.seek(0)
        return archive, f"score-{score_uuid}-{kind.value.lower()}.zip"

    async def _authorized_artifact(
        self,
        db: AsyncSession,
        artifact_uuid: str,
        user_id: int | None,
        action: ScoreAction,
        *,
        share_token: str | None = None,
        public_slug: str | None = None,
    ) -> tuple[ScoreArtifact, ScoreRevision]:
        artifact = await self.repository.get(db, artifact_uuid)
        if not artifact:
            raise ResourceNotFoundException("artifact", artifact_uuid, ErrorCode.FILE_NOT_FOUND)
        revision = await self.repository.revision_for_artifact(db, artifact)
        if not revision:
            raise ResourceNotFoundException("revision", artifact_uuid, ErrorCode.REVISION_NOT_FOUND)
        score = await db.get(Score, revision.score_id)
        if not score:
            raise ResourceNotFoundException("score", artifact_uuid, ErrorCode.SCORE_NOT_FOUND)
        await self.access_policy.authorize(
            db,
            score.score_uuid,
            action,
            user_id=user_id,
            revision_uuid=revision.revision_uuid,
            share_token=share_token,
            public_slug=public_slug,
        )
        return artifact, revision

    def _require_object(self, artifact: ScoreArtifact) -> None:
        if not self.storage.exists(artifact.storage_key):
            raise FileException(ErrorCode.FILE_NOT_FOUND, artifact.storage_key)

    def _read(self, artifact: ScoreArtifact, revision: ScoreRevision) -> ArtifactRead:
        return ArtifactRead(
            artifact_id=artifact.artifact_uuid,
            revision_id=revision.revision_uuid,
            kind=artifact.kind,
            filename=artifact.filename,
            mime_type=artifact.mime_type,
            size_bytes=artifact.size_bytes,
            sha256=artifact.sha256,
            page_number=artifact.page_number,
            render_profile=artifact.render_profile,
            generator=artifact.generator,
            generator_version=artifact.generator_version,
            created_at=artifact.created_at,
            available=self.storage.exists(artifact.storage_key),
        )
