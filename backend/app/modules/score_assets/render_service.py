from __future__ import annotations
from app.modules.storage_objects.retirement import retire_after_release, retire_released_objects

from app.modules.storage_objects.writes import write_object, adopt_written_object

import os
import tempfile
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.execution_manifests import (
    get_or_create_execution_manifest,
    get_or_create_execution_manifest_async,
)
from app.core.exceptions import (
    ResourceNotFoundException,
    ScoreRenderFailedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
    ScoreDeletionStatus,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.score import RenderAssetKind, RevisionSourceFormat
from app.modules.score_assets.render_asset_records import (
    build_render_asset_record,
    render_asset_usage,
    render_storage_key,
)
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_assets.render_execution_manifest import build_render_execution_manifest
from app.modules.score_assets.schemas import RenderAssetRead
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import storage_usage_service
from app.processing.engines.render import create_score_render_engine
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage


class RevisionRenderService:
    """Generate replaceable derived pages without mutating canonical revisions."""

    def __init__(
        self,
        repository: ScoreAssetRepository | None = None,
        score_repository: ScoreRepository | None = None,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or ScoreAssetRepository()
        self.score_repository = score_repository or ScoreRepository()
        self.storage = storage or object_storage
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
        try:
            source_key = source.stored_object.object_key
            pages = await db.run_sync(
                lambda sync: self._render_records(
                    sync,
                    score_uuid=score_uuid,
                    revision_uuid=revision_uuid,
                    revision_id=revision_id,
                    canonical_storage_key=source_key,
                    profile=profile,
                    uploaded_keys=uploaded_keys,
                )
            )
            access = await self.access_policy.authorize(
                db, score_uuid, ScoreAction.EDIT, user_id=user_id, revision_uuid=revision_uuid
            )
            manifest = await get_or_create_execution_manifest_async(
                db, build_render_execution_manifest()
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            new_records = []
            for item in pages:
                physical = await db.run_sync(
                    lambda sync: adopt_written_object(sync, item.pop("written"))
                )
                new_records.append(
                    build_render_asset_record(
                        stored_object=physical, execution_manifest_id=execution_manifest_id, **item
                    )
                )
        except Exception:
            await db.rollback()
            raise

        previous = [
            item
            for item in await self.repository.list_render_assets(db, revision_id)
            if isinstance(item, ScoreRenderAsset) and item.render_profile == profile
        ]
        previous_usage = render_asset_usage(previous)
        try:
            for item in previous:
                await db.delete(item)
                await retire_after_release(db, item.stored_object_id)
            await db.flush()
            for item in new_records:
                db.add(item)
            for item in new_records:
                await storage_usage_service.record_allocation(
                    db,
                    user_id=access.score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=item.stored_object.byte_size or 0,
                    reason="render_asset_created",
                    object_type="score_render_asset",
                    object_id=item.asset_uuid,
                    storage_key=item.stored_object.object_key,
                    auto_commit=False,
                )
            for usage in previous_usage:
                await storage_usage_service.record_release(
                    db,
                    user_id=access.score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=usage.size_bytes or 0,
                    reason="render_asset_replaced",
                    object_type="score_render_asset",
                    object_id=usage.asset_uuid,
                    storage_key=usage.storage_key,
                    auto_commit=False,
                )
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return [self.asset_service.render_asset_read(item, revision) for item in new_records]

    def render_for_worker(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        *,
        source_fingerprint: str,
        profile: str,
    ) -> list[ScoreRenderAsset]:
        """Generate an outbox-authorized render using the worker's sync session."""
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
            raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
        if revision.content_hash != source_fingerprint:
            raise ScoreRenderFailedException(
                code=ErrorCode.SCORE_PREVIEW_FAILED,
                details={"revision_id": revision_uuid, "reason": "source_fingerprint_mismatch"},
            )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = db.execute(
            select(ScoreRevisionSource).where(
                ScoreRevisionSource.revision_id == revision_id,
                ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
            )
        ).scalar_one_or_none()
        if source is None:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        uploaded_keys: list[str] = []
        try:
            pages = self._render_records(
                db,
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                revision_id=revision_id,
                canonical_storage_key=source.stored_object.object_key,
                profile=profile,
                uploaded_keys=uploaded_keys,
            )
            score = db.execute(
                select(Score)
                .where(Score.id == score.id, Score.deletion_status == ScoreDeletionStatus.ACTIVE)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one()
            manifest = get_or_create_execution_manifest(db, build_render_execution_manifest())
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            new_records = [
                build_render_asset_record(
                    stored_object=adopt_written_object(db, item.pop("written")),
                    execution_manifest_id=execution_manifest_id,
                    **item,
                )
                for item in pages
            ]
            previous = list(
                db.execute(
                    select(ScoreRenderAsset).where(
                        ScoreRenderAsset.revision_id == revision_id,
                        ScoreRenderAsset.kind == RenderAssetKind.RENDERED_PAGE,
                        ScoreRenderAsset.render_profile == profile,
                    )
                ).scalars()
            )
            previous_usage = render_asset_usage(previous)
            for item in previous:
                db.delete(item)
                retire_released_objects(db, item.stored_object_id)
            db.flush()
            for item in new_records:
                db.add(item)
            for item in new_records:
                storage_usage_service.record_allocation_sync(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=item.stored_object.byte_size or 0,
                    reason="render_asset_created",
                    object_type="score_render_asset",
                    object_id=item.asset_uuid,
                    storage_key=item.stored_object.object_key,
                    auto_commit=False,
                )
            for usage in previous_usage:
                storage_usage_service.record_release_sync(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=usage.size_bytes or 0,
                    reason="render_asset_replaced",
                    object_type="score_render_asset",
                    object_id=usage.asset_uuid,
                    storage_key=usage.storage_key,
                    auto_commit=False,
                )
            db.commit()
        except Exception:
            db.rollback()
            raise

        return new_records

    def _render_records(
        self,
        db: Session,
        *,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
        canonical_storage_key: str,
        profile: str,
        uploaded_keys: list[str],
    ) -> list[dict]:
        new_records: list[dict] = []
        os.makedirs(settings.WORK_ROOT, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            xml_path = os.path.join(work_dir, "score.musicxml")
            with open(xml_path, "wb") as target:
                target.write(self.storage.read_bytes(canonical_storage_key))
            engine = create_score_render_engine(output_folder=work_dir)
            result = engine.render_score(xml_path=xml_path, output_name="page")
            if not result["success"] or not result.get("files"):
                raise ScoreRenderFailedException(
                    code=str(result.get("code") or ErrorCode.SCORE_PREVIEW_FAILED),
                    details={"revision_id": revision_uuid},
                )
            generator = str(result.get("engine") or "score-renderer")
            for output in result["files"]:
                path = output["path"]
                with open(path, "rb") as source:
                    content = source.read()
                artifact_uuid = str(uuid.uuid4())
                page = int(output["page"])
                extension = os.path.splitext(path)[1] or ".svg"
                key = render_storage_key(
                    score_uuid=score_uuid,
                    revision_uuid=revision_uuid,
                    profile=profile,
                    page=page,
                    asset_uuid=artifact_uuid,
                    extension=extension,
                )
                stored = write_object(
                    db,
                    self.storage,
                    key=key,
                    content=content,
                    content_type=output["mime_type"],
                )
                uploaded_keys.append(stored.object_key)
                new_records.append(
                    dict(
                        asset_uuid=artifact_uuid,
                        revision_id=revision_id,
                        written=stored,
                        page_number=page,
                        profile=profile,
                        generator=generator,
                    )
                )
        return new_records
