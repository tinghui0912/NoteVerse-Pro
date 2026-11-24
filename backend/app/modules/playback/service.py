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

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.execution_manifests import (
    get_or_create_execution_manifest,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    PlaybackAssetKind,
    Score,
    ScorePlaybackAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.score import RevisionSourceFormat
from app.modules.playback.asset_records import (
    build_playback_asset_record,
    playback_asset_usage,
    playback_audio_object_key,
)
from app.modules.playback.execution_manifest import build_playback_execution_manifest
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.durable_work.delivery import DeliveryAttemptLease, StaleDeliveryAttempt
from app.processing.engines.playback import FluidSynthAudioRenderer
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.storage_usage.service import storage_usage_service
from app.modules.revisions.presentation_demand import admit_generated_revision
from app.shared.error_codes import CustomerErrorCode
from app.storage import object_storage


class PlaybackGenerationService:
    """Generate durable playback audio assets in Worker-owned execution paths."""

    def __init__(
        self,
        storage: ObjectStorage | None = None,
        renderer: FluidSynthAudioRenderer | None = None,
        asset_repository: ScoreAssetRepository | None = None,
    ) -> None:
        self.storage = storage or object_storage
        self.renderer = renderer or FluidSynthAudioRenderer()
        self.asset_repository = asset_repository or ScoreAssetRepository()

    def render(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        *,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset:
        if asset_kind != PlaybackAssetKind.AUDIO:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="asset_kind")

        score = (
            db.execute(
                select(Score).where(
                    Score.score_uuid == score_uuid,
                    Score.__table__.c.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if not score:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        revision = (
            db.execute(
                select(ScoreRevision).where(
                    ScoreRevision.score_id == score.id,
                    ScoreRevision.revision_uuid == revision_uuid,
                )
            )
        ).scalar_one_or_none()
        if not revision:
            raise ResourceNotFoundException(
                "revision", revision_uuid, CustomerErrorCode.REVISION_NOT_FOUND
            )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        if revision.content_hash != source_fingerprint:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR, field="source_fingerprint"
            )

        source = self.asset_repository.canonical_source(db, revision_id)
        if source is None:
            raise ResourceNotFoundException(
                "source", revision_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )

        source_content = read_admitted_bytes(
            self.storage, StoredObjectReadTarget.from_object(source.stored_object)
        )
        audio = self.renderer.render(source_content)
        asset_uuid = str(uuid.uuid4())
        stored = write_object(
            db,
            self.storage,
            key=playback_audio_object_key(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                asset_uuid=asset_uuid,
                extension=audio.extension,
            ),
            content=audio.content,
            content_type=audio.mime_type,
        )
        score = (
            db.execute(
                select(Score)
                .where(Score.id == score.id, Score.__table__.c.deleted_at.is_(None))
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        previous = (
            db.execute(
                select(ScorePlaybackAsset).where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == asset_kind,
                )
            )
        ).scalar_one_or_none()
        previous_usage = playback_asset_usage(previous)
        try:
            manifest = get_or_create_execution_manifest(
                db, build_playback_execution_manifest(soundfont_sha256=audio.soundfont_sha256)
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            if previous is not None:
                db.delete(previous)
                db.flush()
            asset = build_playback_asset_record(
                asset_uuid=asset_uuid,
                revision_id=revision_id,
                asset_kind=asset_kind,
                stored_object=adopt_written_object(db, stored),
                audio=audio,
                execution_manifest_id=execution_manifest_id,
                source_fingerprint=source_fingerprint,
            )
            db.add(asset)
            storage_usage_service.record_allocation(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=asset.stored_object.byte_size,
                reason="playback_asset_created",
                object_type="score_playback_asset",
                object_id=asset.asset_uuid,
                storage_key=asset.stored_object.object_key,
            )
            if previous_usage is not None:
                storage_usage_service.record_release(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=previous_usage.size_bytes,
                    reason="playback_asset_replaced",
                    object_type="score_playback_asset",
                    object_id=previous_usage.asset_uuid,
                    storage_key=previous_usage.storage_key,
                )
            if previous is not None:
                retire_after_release(db, previous.stored_object_id)
            db.commit()
        except Exception:
            db.rollback()
            raise

        db.refresh(asset)
        return asset

    def render_for_worker(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        *,
        source_fingerprint: str,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
        asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset:
        if asset_kind != PlaybackAssetKind.AUDIO:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="asset_kind")

        score = db.execute(
            select(Score).where(
                Score.score_uuid == score_uuid,
                Score.__table__.c.deleted_at.is_(None),
            )
        ).scalar_one_or_none()
        if not score:
            raise ResourceNotFoundException("score", score_uuid, CustomerErrorCode.SCORE_NOT_FOUND)
        revision = db.execute(
            select(ScoreRevision).where(
                ScoreRevision.score_id == score.id,
                ScoreRevision.revision_uuid == revision_uuid,
            )
        ).scalar_one_or_none()
        if not revision:
            raise ResourceNotFoundException(
                "revision", revision_uuid, CustomerErrorCode.REVISION_NOT_FOUND
            )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        if revision.content_hash != source_fingerprint:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR, field="source_fingerprint"
            )

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

        return self._render_worker_asset(
            db,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            revision_id=revision_id,
            source_fingerprint=source_fingerprint,
            asset_kind=asset_kind,
            source=read_admitted_bytes(
                self.storage, StoredObjectReadTarget.from_object(source.stored_object)
            ),
            outbox_uuid=outbox_uuid,
            lease=lease,
        )

    def _render_worker_asset(
        self,
        db: Session,
        *,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind,
        source: bytes,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
    ) -> ScorePlaybackAsset:
        audio = self.renderer.render(source)
        asset_uuid = str(uuid.uuid4())
        stored = write_object(
            db,
            self.storage,
            key=playback_audio_object_key(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                asset_uuid=asset_uuid,
                extension=audio.extension,
            ),
            content=audio.content,
            content_type=audio.mime_type,
        )
        score = db.execute(
            select(Score)
            .where(Score.score_uuid == score_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        playback_outbox_service.require_attempt(
            db,
            outbox_uuid=outbox_uuid,
            lease=lease,
            score_id=require_persisted_id(score.id, entity="score") if score else -1,
            revision_id=revision_id,
            source_fingerprint=source_fingerprint,
            asset_kind=asset_kind,
        )
        admit_generated_revision(db, score, revision_id, source_fingerprint)
        assert score is not None
        previous = db.execute(
            select(ScorePlaybackAsset).where(
                ScorePlaybackAsset.revision_id == revision_id,
                ScorePlaybackAsset.kind == asset_kind,
            )
        ).scalar_one_or_none()
        previous_usage = playback_asset_usage(previous)
        try:
            manifest = get_or_create_execution_manifest(
                db, build_playback_execution_manifest(soundfont_sha256=audio.soundfont_sha256)
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            if previous is not None:
                db.delete(previous)
                db.flush()
            asset = build_playback_asset_record(
                asset_uuid=asset_uuid,
                revision_id=revision_id,
                asset_kind=asset_kind,
                stored_object=adopt_written_object(db, stored),
                audio=audio,
                execution_manifest_id=execution_manifest_id,
                source_fingerprint=source_fingerprint,
            )
            db.add(asset)
            storage_usage_service.record_allocation(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=asset.stored_object.byte_size,
                reason="playback_asset_created",
                object_type="score_playback_asset",
                object_id=asset.asset_uuid,
                storage_key=asset.stored_object.object_key,
            )
            if previous_usage is not None:
                storage_usage_service.record_release(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=previous_usage.size_bytes,
                    reason="playback_asset_replaced",
                    object_type="score_playback_asset",
                    object_id=previous_usage.asset_uuid,
                    storage_key=previous_usage.storage_key,
                )
            if previous is not None:
                retire_after_release(db, previous.stored_object_id)
            if not playback_outbox_service.complete(db, outbox_uuid, lease=lease):
                raise StaleDeliveryAttempt("Playback completion lost execution ownership")
            db.flush()
        except Exception:
            db.rollback()
            raise

        return asset
