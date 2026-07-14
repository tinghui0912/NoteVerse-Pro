from __future__ import annotations

import hashlib
import os
import tempfile
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import (
    ResourceNotFoundException,
    ScoreRenderFailedException,
    UnauthorizedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScoreDeletionStatus,
    ScoreMembership,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.score import RenderAssetKind, RevisionSourceFormat
from app.db.models.score_access import MembershipRole
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.schemas import RenderAssetRead
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import storage_usage_service
from app.processing.engines.render import create_score_render_engine
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


class RevisionRenderService:
    """Generate replaceable derived pages without mutating canonical revisions."""

    def __init__(
        self,
        repository: ScoreAssetRepository | None = None,
        score_repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or ScoreAssetRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.asset_service = ScoreAssetService(
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
    ) -> list[RenderAssetRead]:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = await self.repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        uploaded_keys: list[str] = []
        new_records = self._render_records(
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            revision_id=revision_id,
            canonical_storage_key=source.storage_key,
            profile=profile,
            uploaded_keys=uploaded_keys,
        )

        previous = [
            item
            for item in await self.repository.list_render_assets(db, revision_id)
            if isinstance(item, ScoreRenderAsset) and item.render_profile == profile
        ]
        previous_usage = [
            (item.asset_uuid, item.storage_key, item.size_bytes)
            for item in previous
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
        for item in new_records:
            await storage_usage_service.record_allocation(
                db,
                user_id=access.score.owner_user_id,
                category=StorageUsageCategory.DERIVED_RENDER,
                bytes_count=item.size_bytes,
                reason="render_asset_created",
                object_type="score_render_asset",
                object_id=item.asset_uuid,
                storage_key=item.storage_key,
            )
        for asset_uuid, storage_key, size_bytes in previous_usage:
            await storage_usage_service.record_release(
                db,
                user_id=access.score.owner_user_id,
                category=StorageUsageCategory.DERIVED_RENDER,
                bytes_count=size_bytes,
                reason="render_asset_replaced",
                object_type="score_render_asset",
                object_id=asset_uuid,
                storage_key=storage_key,
            )
        for item in previous:
            try:
                self.storage.delete(item.storage_key)
            except Exception:
                pass
        return [self.asset_service.render_asset_read(item, revision) for item in new_records]

    def render_sync(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        *,
        profile: str = "default",
    ) -> list[ScoreRenderAsset]:
        score, revision = self._authorized_revision_sync(
            db,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            user_id=user_id,
        )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = db.execute(
            select(ScoreRevisionSource).where(
                ScoreRevisionSource.revision_id == revision_id,
                ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
            )
        ).scalar_one_or_none()
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        uploaded_keys: list[str] = []
        new_records = self._render_records(
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            revision_id=revision_id,
            canonical_storage_key=source.storage_key,
            profile=profile,
            uploaded_keys=uploaded_keys,
        )
        previous = list(
            db.execute(
                select(ScoreRenderAsset).where(
                    ScoreRenderAsset.revision_id == revision_id,
                    ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
                    ScoreRenderAsset.render_profile == profile,
                )
            ).scalars()
        )
        old_keys = [item.storage_key for item in previous]
        previous_usage = [
            (item.asset_uuid, item.storage_key, item.size_bytes)
            for item in previous
        ]
        try:
            for item in previous:
                db.delete(item)
            db.flush()
            for item in new_records:
                db.add(item)
            db.commit()
        except Exception:
            db.rollback()
            for key in uploaded_keys:
                try:
                    self.storage.delete(key)
                except Exception:
                    pass
            raise
        for item in new_records:
            storage_usage_service.record_allocation_sync(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_RENDER,
                bytes_count=item.size_bytes,
                reason="render_asset_created",
                object_type="score_render_asset",
                object_id=item.asset_uuid,
                storage_key=item.storage_key,
            )
        for asset_uuid, storage_key, size_bytes in previous_usage:
            storage_usage_service.record_release_sync(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_RENDER,
                bytes_count=size_bytes,
                reason="render_asset_replaced",
                object_type="score_render_asset",
                object_id=asset_uuid,
                storage_key=storage_key,
            )
        for key in old_keys:
            try:
                self.storage.delete(key)
            except Exception:
                pass
        return new_records

    def _authorized_revision_sync(
        self,
        db: Session,
        *,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> tuple[Score, ScoreRevision]:
        score = db.execute(
            select(Score).where(
                Score.score_uuid == score_uuid,
                Score.deletion_status == ScoreDeletionStatus.ACTIVE,
            )
        ).scalar_one_or_none()
        if score is None:
            raise ResourceNotFoundException("score", score_uuid, ErrorCode.SCORE_NOT_FOUND)
        revision = db.execute(
            select(ScoreRevision).where(
                ScoreRevision.score_id == score.id,
                ScoreRevision.revision_uuid == revision_uuid,
            )
        ).scalar_one_or_none()
        if revision is None:
            raise ResourceNotFoundException(
                "revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        if user_id == score.owner_user_id:
            return score, revision
        membership = db.execute(
            select(ScoreMembership).where(
                ScoreMembership.score_id == score.id,
                ScoreMembership.user_id == user_id,
                ScoreMembership.__table__.c.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        if membership is not None and membership.role == MembershipRole.EDITOR:
            return score, revision
        raise UnauthorizedException(ErrorCode.NO_EDIT_ACCESS, {"score_id": score_uuid})

    def _render_records(
        self,
        *,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
        canonical_storage_key: str,
        profile: str,
        uploaded_keys: list[str],
    ) -> list[ScoreRenderAsset]:
        new_records: list[ScoreRenderAsset] = []
        os.makedirs(settings.WORK_ROOT, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            xml_path = os.path.join(work_dir, "score.musicxml")
            with open(xml_path, "wb") as target:
                target.write(self.storage.read_bytes(canonical_storage_key))
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
                    ScoreRenderAsset(
                        asset_uuid=artifact_uuid,
                        revision_id=revision_id,
                        kind=RenderAssetKind.RENDERED_PAGE,
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
        return new_records
