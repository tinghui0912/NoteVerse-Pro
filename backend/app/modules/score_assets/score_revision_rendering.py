from __future__ import annotations


from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator
from app.modules.score_access.queries import active_score_predicate
from app.modules.media_storage.reads import StoredObjectReadTarget, read_admitted_bytes
from app.modules.media_storage.retirement import retire_after_release


from app.modules.media_storage.adoption import adopt_written_objects
from app.modules.media_storage.write_contracts import ObjectWriteItem

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
from app.db.models import Score, ScoreRenderAsset, ScoreRevision, ScoreRevisionSource
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.score_assets.domain import RenderAssetKind
from app.modules.revisions.domain import RevisionSourceFormat
from app.modules.score_assets.render_asset_records import (
    build_render_asset_record,
    render_asset_usage,
    rendered_page_object_key,
)
from app.modules.rendering.execution_manifest import build_render_execution_manifest
from app.modules.revisions.render_delivery import ScoreRevisionRenderDelivery
from app.modules.durable_work.delivery import DeliveryAttemptLease, StaleDeliveryAttempt
from app.modules.revisions.presentation_demand import (
    lock_presentation_score,
    admit_generated_revision,
)

from app.modules.rendering.renderer import RenderedPage, RenderExecutionError, render_musicxml
from app.shared.error_codes import CustomerErrorCode


class ScoreRevisionRenderService:
    """Generate replaceable derived pages without mutating canonical revisions."""

    def __init__(
        self,
        *,
        usage: StorageUsageService,
        writes: ObjectWriteCoordinator,
        delivery: ScoreRevisionRenderDelivery,
        work_root: str,
    ) -> None:
        self.delivery, self.work_root = delivery, work_root
        self.usage = usage
        self.writes = writes
        self.storage = writes.storage

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
                active_score_predicate(),
            )
        ).scalar_one_or_none()
        if score is None:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        revision = db.execute(
            select(ScoreRevision).where(
                ScoreRevision.score_id == score.id,
                ScoreRevision.revision_uuid == revision_uuid,
            )
        ).scalar_one_or_none()
        if revision is None:
            raise ResourceNotFoundException(
                "revision", revision_uuid, CustomerErrorCode.REVISION_NOT_FOUND
            )
        if revision.content_hash != source_fingerprint:
            raise ScoreRenderFailedException(
                code=CustomerErrorCode.SCORE_PREVIEW_FAILED,
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
            raise ResourceNotFoundException(
                "source", revision_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )

        canonical_source = StoredObjectReadTarget.from_object(source.stored_object)
        score_id = require_persisted_id(score.id, entity="score")
        db.commit()
        try:
            pages = self._render_records(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                revision_id=revision_id,
                canonical_source=canonical_source,
                profile=profile,
            )
            score = lock_presentation_score(db, score_id)
            self.delivery.require_revision_attempt(
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
            self.usage.committed_bytes(db, score.owner_user_id, lock=True)
            adopted = adopt_written_objects(db, [item.pop("written") for item in pages])
            new_records = [
                build_render_asset_record(
                    stored_object=obj, execution_manifest_id=execution_manifest_id, **item
                )
                for obj, item in zip(adopted, pages, strict=True)
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
            db.flush()
            for item in new_records:
                db.add(item)
            for item in new_records:
                self.usage.record_allocation(
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
                self.usage.record_release(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_RENDER,
                    bytes_count=usage.size_bytes or 0,
                    reason="render_asset_replaced",
                    object_type="score_render_asset",
                    object_id=usage.asset_uuid,
                    storage_key=usage.storage_key,
                )
            retire_after_release(db, *(item.stored_object_id for item in previous))
            if not self.delivery.complete(db, outbox_uuid, lease=lease):
                raise StaleDeliveryAttempt("Render completion lost execution ownership")
            db.flush()
        except Exception:
            db.rollback()
            raise

        return new_records

    def _render_records(
        self,
        *,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
        canonical_source: StoredObjectReadTarget,
        profile: str,
    ) -> list[dict]:
        outputs = self._render_pages(
            read_admitted_bytes(self.storage, canonical_source), revision_uuid
        )
        descriptors = [
            self._render_descriptor(output, score_uuid, revision_uuid, revision_id, profile)
            for output in outputs
        ]
        receipts = self.writes.write_batch(
            tuple(
                ObjectWriteItem(key, content, media_type)
                for _, key, media_type, content in descriptors
            )
        )
        return [
            dict(written=receipt, **descriptor[0])
            for receipt, descriptor in zip(receipts, descriptors, strict=True)
        ]

    @staticmethod
    def _render_descriptor(
        output: RenderedPage, score_uuid: str, revision_uuid: str, revision_id: int, profile: str
    ) -> tuple[dict, str, str, bytes]:
        artifact_uuid = str(uuid.uuid4())
        key = rendered_page_object_key(
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

    def _render_pages(self, content: bytes, revision_uuid: str) -> list[RenderedPage]:
        try:
            return render_musicxml(content, output_name="page", work_root=self.work_root)
        except RenderExecutionError as error:
            try:
                code = (
                    CustomerErrorCode(error.engine_code)
                    if error.engine_code
                    else CustomerErrorCode.SCORE_PREVIEW_FAILED
                )
            except ValueError:
                code = CustomerErrorCode.SCORE_PREVIEW_FAILED
            raise ScoreRenderFailedException(
                code=code,
                details={"revision_id": revision_uuid, "engine_code": error.engine_code},
            ) from error
