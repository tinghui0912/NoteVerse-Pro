from __future__ import annotations
from app.modules.storage_objects.retirement import retire_after_release, retire_released_objects

from app.modules.storage_objects.writes import (
    write_object,
    write_object_async,
    adopt_written_object,
)

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.execution_manifests import (
    get_or_create_execution_manifest,
    get_or_create_execution_manifest_async,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    PlaybackAssetKind,
    Score,
    ScoreDeletionStatus,
    ScorePlaybackAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.score import RevisionSourceFormat
from app.modules.playback.asset_records import (
    build_playback_asset_record,
    playback_asset_usage,
    playback_storage_key,
)
from app.modules.playback.execution_manifest import build_playback_execution_manifest
from app.processing.engines.playback import FluidSynthAudioRenderer
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.storage_usage.service import storage_usage_service
from app.modules.revisions.presentation_demand import admit_generated_revision
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage


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

    async def render(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        *,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset:
        if asset_kind != PlaybackAssetKind.AUDIO:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="asset_kind")

        score = (
            await db.execute(
                select(Score).where(
                    Score.score_uuid == score_uuid,
                    Score.deletion_status == ScoreDeletionStatus.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if not score:
            raise ResourceNotFoundException("score", score_uuid, ErrorCode.SCORE_NOT_FOUND)
        revision = (
            await db.execute(
                select(ScoreRevision).where(
                    ScoreRevision.score_id == score.id,
                    ScoreRevision.revision_uuid == revision_uuid,
                )
            )
        ).scalar_one_or_none()
        if not revision:
            raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
        revision_id = require_persisted_id(revision.id, entity="score revision")
        if revision.content_hash != source_fingerprint:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_fingerprint")

        source = await self.asset_repository.canonical_source(db, revision_id)
        if source is None:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        source_content = self.storage.read_bytes(source.stored_object.object_key)
        audio = self.renderer.render(source_content)
        asset_uuid = str(uuid.uuid4())
        stored = await write_object_async(
            db,
            self.storage,
            key=playback_storage_key(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                asset_uuid=asset_uuid,
                extension=audio.extension,
            ),
            content=audio.content,
            content_type=audio.mime_type,
        )
        score = (
            await db.execute(
                select(Score)
                .where(Score.id == score.id, Score.deletion_status == ScoreDeletionStatus.ACTIVE)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        previous = (
            await db.execute(
                select(ScorePlaybackAsset).where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == asset_kind,
                )
            )
        ).scalar_one_or_none()
        previous_usage = playback_asset_usage(previous)
        try:
            manifest = await get_or_create_execution_manifest_async(
                db, build_playback_execution_manifest(soundfont_sha256=audio.soundfont_sha256)
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            if previous is not None:
                await db.delete(previous)
                await retire_after_release(db, previous.stored_object_id)
                await db.flush()
            asset = build_playback_asset_record(
                asset_uuid=asset_uuid,
                revision_id=revision_id,
                asset_kind=asset_kind,
                stored_object=await db.run_sync(lambda sync: adopt_written_object(sync, stored)),
                audio=audio,
                execution_manifest_id=execution_manifest_id,
                source_fingerprint=source_fingerprint,
            )
            db.add(asset)
            await storage_usage_service.record_allocation(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=asset.stored_object.byte_size,
                reason="playback_asset_created",
                object_type="score_playback_asset",
                object_id=asset.asset_uuid,
                storage_key=asset.stored_object.object_key,
                auto_commit=False,
            )
            if previous_usage is not None:
                await storage_usage_service.record_release(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=previous_usage.size_bytes,
                    reason="playback_asset_replaced",
                    object_type="score_playback_asset",
                    object_id=previous_usage.asset_uuid,
                    storage_key=previous_usage.storage_key,
                    auto_commit=False,
                )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

        await db.refresh(asset)
        return asset

    def render_sync(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        *,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
    ) -> ScorePlaybackAsset:
        if asset_kind != PlaybackAssetKind.AUDIO:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="asset_kind")

        score = db.execute(
            select(Score).where(
                Score.score_uuid == score_uuid,
                Score.deletion_status == ScoreDeletionStatus.ACTIVE,
            )
        ).scalar_one_or_none()
        if not score:
            raise ResourceNotFoundException("score", score_uuid, ErrorCode.SCORE_NOT_FOUND)
        revision = db.execute(
            select(ScoreRevision).where(
                ScoreRevision.score_id == score.id,
                ScoreRevision.revision_uuid == revision_uuid,
            )
        ).scalar_one_or_none()
        if not revision:
            raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
        revision_id = require_persisted_id(revision.id, entity="score revision")
        if revision.content_hash != source_fingerprint:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_fingerprint")

        source = db.execute(
            select(ScoreRevisionSource).where(
                ScoreRevisionSource.revision_id == revision_id,
                ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
            )
        ).scalar_one_or_none()
        if source is None:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)

        return self._render_asset_sync(
            db,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
            revision_id=revision_id,
            source_fingerprint=source_fingerprint,
            asset_kind=asset_kind,
            source=self.storage.read_bytes(source.stored_object.object_key),
        )

    def _render_asset_sync(
        self,
        db: Session,
        *,
        score_uuid: str,
        revision_uuid: str,
        revision_id: int,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind,
        source: bytes,
    ) -> ScorePlaybackAsset:
        audio = self.renderer.render(source)
        asset_uuid = str(uuid.uuid4())
        stored = write_object(
            db,
            self.storage,
            key=playback_storage_key(
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
                retire_released_objects(db, previous.stored_object_id)
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
            storage_usage_service.record_allocation_sync(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=asset.stored_object.byte_size,
                reason="playback_asset_created",
                object_type="score_playback_asset",
                object_id=asset.asset_uuid,
                storage_key=asset.stored_object.object_key,
                auto_commit=False,
            )
            if previous_usage is not None:
                storage_usage_service.record_release_sync(
                    db,
                    user_id=score.owner_user_id,
                    category=StorageUsageCategory.DERIVED_AUDIO,
                    bytes_count=previous_usage.size_bytes,
                    reason="playback_asset_replaced",
                    object_type="score_playback_asset",
                    object_id=previous_usage.asset_uuid,
                    storage_key=previous_usage.storage_key,
                    auto_commit=False,
                )
            db.commit()
        except Exception:
            db.rollback()
            raise

        db.refresh(asset)
        return asset
