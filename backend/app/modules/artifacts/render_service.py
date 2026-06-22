from __future__ import annotations

import hashlib
import os
import tempfile
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, ScoreRenderFailedException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreArtifact
from app.db.models.score import ArtifactKind
from app.modules.artifacts.repository import ArtifactRepository
from app.modules.artifacts.schemas import ArtifactRead
from app.modules.artifacts.service import ArtifactService
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.processing.engines.render import create_score_render_engine
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


class RevisionRenderService:
    """Generate replaceable derived pages without mutating canonical revisions."""

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
        self.artifact_service = ArtifactService(
            self.repository,
            self.score_repository,
            self.storage,
            self.access_policy,
        )

    async def render(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        *,
        profile: str = "default",
    ) -> list[ArtifactRead]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        canonical = next(
            iter(
                await self.repository.list_for_revision(
                    db, revision_id, ArtifactKind.MUSICXML
                )
            ),
            None,
        )
        if not canonical:
            raise ResourceNotFoundException("artifact", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        uploaded_keys: list[str] = []
        new_records: list[ScoreArtifact] = []
        os.makedirs(settings.WORK_ROOT, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            xml_path = os.path.join(work_dir, "score.musicxml")
            with open(xml_path, "wb") as target:
                target.write(self.storage.read_bytes(canonical.storage_key))
            engine = create_score_render_engine(output_folder=work_dir)
            result = engine.render_score(xml_path=xml_path, output_name="page")
            if not result["success"] or not result.get("files"):
                raise ScoreRenderFailedException(
                    code=str(result.get("code") or ErrorCode.SCORE_RENDER_FAILED),
                    details={"error": result.get("error"), "revision_id": revision_uuid},
                )
            generator = str(result.get("engine") or "score-renderer")
            for output in result["files"]:
                path = output["path"]
                with open(path, "rb") as source:
                    content = source.read()
                artifact_uuid = str(uuid.uuid4())
                page = int(output["page"])
                extension = os.path.splitext(path)[1] or ".svg"
                key = (
                    f"scores/{score_uuid}/revisions/{revision_uuid}/renders/"
                    f"{profile}/{page:03d}-{artifact_uuid}{extension}"
                )
                stored = self.storage.put_bytes(
                    key=key,
                    content=content,
                    content_type=output["mime_type"],
                )
                uploaded_keys.append(stored.storage_key)
                new_records.append(
                    ScoreArtifact(
                        artifact_uuid=artifact_uuid,
                        revision_id=revision_id,
                        kind=ArtifactKind.RENDERED_PAGE,
                        storage_backend=self.storage.backend_name,
                        storage_key=stored.storage_key,
                        filename=stored.filename,
                        mime_type=output["mime_type"],
                        size_bytes=stored.size_bytes,
                        sha256=hashlib.sha256(content).hexdigest(),
                        page_number=page,
                        render_profile=profile,
                        generator=generator,
                        generator_version="1",
                    )
                )

        previous = [
            item
            for item in await self.repository.list_for_revision(
                db, revision_id, ArtifactKind.RENDERED_PAGE
            )
            if item.render_profile == profile
        ]
        try:
            for item in previous:
                await db.delete(item)
            await db.flush()
            for item in new_records:
                db.add(item)
            await db.commit()
        except Exception:
            await db.rollback()
            for key in uploaded_keys:
                try:
                    self.storage.delete(key)
                except Exception:
                    pass
            raise
        for item in previous:
            try:
                self.storage.delete(item.storage_key)
            except Exception:
                pass
        return [self.artifact_service._read(item, revision) for item in new_records]
