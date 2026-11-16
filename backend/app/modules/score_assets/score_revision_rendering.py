from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectReadTarget, read_admitted_bytes
from app.storage import ObjectStorage
from app.modules.storage_objects.retirement import retire_after_release

from app.modules.storage_objects.writes import (
    write_object,
    adopt_written_object,
)

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.execution_manifests import (
    get_or_create_execution_manifest,
)
from app.core.exceptions import (
    ResourceNotFoundException,
    ScoreRenderFailedException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    Score,
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
from app.modules.rendering.execution_manifest import build_render_execution_manifest
from app.modules.rendering.delivery import render_outbox_service
from app.modules.durable_work.delivery import DeliveryAttemptLease, StaleDeliveryAttempt
from app.modules.score_assets.schemas import RenderAssetRead
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.repository import ScoreRepository
from app.modules.revisions.presentation_demand import (
    lock_presentation_score,
    admit_generated_revision,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import storage_usage_service
from app.modules.rendering.renderer import RenderedPage, RenderExecutionError, render_musicxml
from app.shared.constants import ErrorCode
from app.storage import object_storage


class ScoreRevisionRenderService:
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

    def render(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        *,
        profile: str = "default",
    ) -> list[RenderAssetRead]:
        access = self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = self.repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        uploaded_keys: list[str] = []
        try:
            content = read_admitted_bytes(
                self.storage, StoredObjectReadTarget.from_object(source.stored_object)
            )
            outputs = self._render_pages(content, revision_uuid)
            pages = []
            for output in outputs:
                item, key, media_type, content = self._render_descriptor(
                    output, score_uuid, revision_uuid, revision_id, profile
                )
                written = write_object(
                    db, self.storage, key=key, content=content, content_type=media_type
                )
                uploaded_keys.append(written.object_key)
                pages.append(dict(written=written, **item))
            access = self.access_policy.authorize(
                db, score_uuid, ScoreAction.EDIT, user_id=user_id, revision_uuid=revision_uuid
            )
            manifest = get_or_create_execution_manifest(db, build_render_execution_manifest())
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            new_records = []
            for item in pages:
                physical = adopt_written_object(db, item.pop("written"))
                new_records.append(
                    build_render_asset_record(
                        stored_object=physical, execution_manifest_id=execution_manifest_id, **item
                    )
                )
        except Exception:
            db.rollback()
            raise

        previous = [
            item
            for item in self.repository.list_render_assets(db, revision_id)
            if isinstance(item, ScoreRenderAsset) and item.render_profile == profile
        ]
        previous_usage = render_asset_usage(previous)
        try:
            for item in previous:
                db.delete(item)
                retire_after_release(db, item.stored_object_id)
            db.flush()
            for item in new_records:
                db.add(item)
            for item in new_records:
                storage_usage_service.record_allocation(
                    db,
                    user_id=access.score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=item.stored_object.byte_size or 0,
                    reason="render_asset_created",
                    object_type="score_render_asset",
                    object_id=item.asset_uuid,
                    storage_key=item.stored_object.object_key,
                )
            for usage in previous_usage:
                storage_usage_service.record_release(
                    db,
                    user_id=access.score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=usage.size_bytes or 0,
                    reason="render_asset_replaced",
                    object_type="score_render_asset",
                    object_id=usage.asset_uuid,
                    storage_key=usage.storage_key,
                )
            db.commit()
        except Exception:
            db.rollback()
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
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
    ) -> list[ScoreRenderAsset]:
        """Generate an outbox-authorized render using the worker's sync session."""
        score = db.execute(
            select(Score).where(
                Score.score_uuid == score_uuid,
                Score.__table__.c.deleted_at.is_(None),
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
                canonical_source=StoredObjectReadTarget.from_object(source.stored_object),
                profile=profile,
                uploaded_keys=uploaded_keys,
            )
            score = lock_presentation_score(db, score.id)
            render_outbox_service.require_revision_attempt(
                db,
                outbox_uuid=outbox_uuid,
                lease=lease,
                score_id=require_persisted_id(score.id, entity="score") if score else -1,
                revision_id=revision_id,
                source_fingerprint=source_fingerprint,
                profile=profile,
            )
            admit_generated_revision(db, score, revision_id, source_fingerprint)
            assert score is not None
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
                retire_after_release(db, item.stored_object_id)
            db.flush()
            for item in new_records:
                db.add(item)
            for item in new_records:
                storage_usage_service.record_allocation(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=item.stored_object.byte_size or 0,
                    reason="render_asset_created",
                    object_type="score_render_asset",
                    object_id=item.asset_uuid,
                    storage_key=item.stored_object.object_key,
                )
            for usage in previous_usage:
                storage_usage_service.record_release(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=usage.size_bytes or 0,
                    reason="render_asset_replaced",
                    object_type="score_render_asset",
                    object_id=usage.asset_uuid,
                    storage_key=usage.storage_key,
                )
            if not render_outbox_service.complete(db, outbox_uuid, lease=lease):
                raise StaleDeliveryAttempt("Render completion lost execution ownership")
            db.flush()
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
        canonical_source: StoredObjectReadTarget,
        profile: str,
        uploaded_keys: list[str],
    ) -> list[dict]:
        outputs = self._render_pages(
            read_admitted_bytes(self.storage, canonical_source), revision_uuid
        )
        records = []
        for output in outputs:
            item, key, media_type, content = self._render_descriptor(
                output, score_uuid, revision_uuid, revision_id, profile
            )
            stored = write_object(
                db, self.storage, key=key, content=content, content_type=media_type
            )
            uploaded_keys.append(stored.object_key)
            records.append(dict(written=stored, **item))
        return records

    @staticmethod
    def _render_descriptor(
        output: RenderedPage, score_uuid: str, revision_uuid: str, revision_id: int, profile: str
    ) -> tuple[dict, str, str, bytes]:
        artifact_uuid = str(uuid.uuid4())
        key = render_storage_key(
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            profile=profile,
            page=output.page_number,
            asset_uuid=artifact_uuid,
            extension=output.extension,
        )
        item = dict(
            asset_uuid=artifact_uuid,
            revision_id=revision_id,
            page_number=output.page_number,
            profile=profile,
            generator=output.generator,
        )
        return item, key, output.mime_type, output.content

    @staticmethod
    def _render_pages(content: bytes, revision_uuid: str) -> list[RenderedPage]:
        try:
            return render_musicxml(content, output_name="page")
        except RenderExecutionError as error:
            raise ScoreRenderFailedException(
                code=error.engine_code or ErrorCode.SCORE_PREVIEW_FAILED,
                details={"revision_id": revision_uuid},
            ) from error
