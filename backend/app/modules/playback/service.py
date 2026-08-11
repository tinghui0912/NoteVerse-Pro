from __future__ import annotations

import hashlib
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
from app.db.models.score_access import PublicationStatus
from app.modules.playback.delivery import PlaybackDelivery, PlaybackDeliveryReadModel
from app.modules.playback.execution_manifest import build_playback_execution_manifest
from app.processing.engines.playback import FluidSynthAudioRenderer
from app.modules.publications.repository import PublicationRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction, hash_share_token
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.score_sharing.repository import ScoreSharingRepository
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage


class PlaybackService:
    def __init__(
        self,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        renderer: FluidSynthAudioRenderer | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        sharing_repository: ScoreSharingRepository | None = None,
        publication_repository: PublicationRepository | None = None,
        delivery_read_model: PlaybackDeliveryReadModel | None = None,
    ) -> None:
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.renderer = renderer or FluidSynthAudioRenderer()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.sharing_repository = sharing_repository or ScoreSharingRepository()
        self.publication_repository = publication_repository or PublicationRepository()
        self.delivery_read_model = delivery_read_model or PlaybackDeliveryReadModel(
            storage=self.storage,
            access_policy=self.access_policy,
        )

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

        source_content = self.storage.read_bytes(source.storage_key)
        audio = self.renderer.render(source_content)
        asset_uuid = str(uuid.uuid4())
        stored = self.storage.put_bytes(
            key=self._playback_storage_key(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                asset_uuid=asset_uuid,
                extension=audio.extension,
            ),
            content=audio.content,
            content_type=audio.mime_type,
        )
        previous = (
            await db.execute(
                select(ScorePlaybackAsset).where(
                    ScorePlaybackAsset.revision_id == revision_id,
                    ScorePlaybackAsset.kind == asset_kind,
                )
            )
        ).scalar_one_or_none()
        old_key = previous.storage_key if previous else None
        previous_usage = self._playback_asset_usage(previous)
        try:
            manifest = await get_or_create_execution_manifest_async(
                db, build_playback_execution_manifest(soundfont_sha256=audio.soundfont_sha256)
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            if previous is not None:
                await db.delete(previous)
                await db.flush()
            asset = ScorePlaybackAsset(
                asset_uuid=asset_uuid,
                revision_id=revision_id,
                kind=asset_kind,
                storage_backend=self.storage.backend_name,
                storage_key=stored.storage_key,
                filename=stored.filename,
                mime_type=audio.mime_type,
                size_bytes=stored.size_bytes,
                sha256=hashlib.sha256(audio.content).hexdigest(),
                execution_manifest_id=execution_manifest_id,
                duration_ms=audio.duration_ms,
                source_fingerprint=source_fingerprint,
                generator=audio.generator,
                generator_version=audio.generator_version,
            )
            db.add(asset)
            await db.commit()
            await db.refresh(asset)
        except Exception:
            await db.rollback()
            self._delete_storage_key_best_effort(stored.storage_key)
            raise

        await storage_usage_service.record_allocation(
            db,
            user_id=score.owner_user_id,
            category=StorageUsageCategory.DERIVED_AUDIO,
            bytes_count=asset.size_bytes,
            reason="playback_asset_created",
            object_type="score_playback_asset",
            object_id=asset.asset_uuid,
            storage_key=asset.storage_key,
        )
        if previous_usage is not None:
            old_asset_uuid, old_storage_key, old_size_bytes = previous_usage
            await storage_usage_service.record_release(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=old_size_bytes,
                reason="playback_asset_replaced",
                object_type="score_playback_asset",
                object_id=old_asset_uuid,
                storage_key=old_storage_key,
            )
        if old_key and old_key != stored.storage_key:
            self._delete_storage_key_best_effort(old_key)
        return asset

    async def score_revision_delivery(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
    ) -> PlaybackDelivery:
        return await self.delivery_read_model.score_revision_delivery(
            db,
            score_uuid,
            revision_uuid,
            user_id,
        )

    async def grant_delivery(
        self,
        db: AsyncSession,
        token: str,
        user_id: int | None,
    ) -> PlaybackDelivery:
        grant = await self.sharing_repository.grant_by_token_hash(db, hash_share_token(token))
        if grant is None:
            raise ResourceNotFoundException("share_grant", code=ErrorCode.SHARE_NOT_FOUND)
        score = await db.get(Score, grant.score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", token, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            share_token=token,
        )
        return await self.delivery_read_model.delivery_for_revision(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            score_id=require_persisted_id(score.id, entity="score"),
        )

    async def public_delivery(
        self,
        db: AsyncSession,
        slug: str,
        user_id: int | None,
    ) -> PlaybackDelivery:
        publication = await self.publication_repository.by_slug(db, slug)
        if publication is None or publication.status != PublicationStatus.PUBLISHED:
            raise ResourceNotFoundException("publication", slug, ErrorCode.RESOURCE_NOT_FOUND)
        score = await db.get(Score, publication.score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", slug, ErrorCode.SCORE_NOT_FOUND)
        access = await self.access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            public_slug=slug,
        )
        return await self.delivery_read_model.delivery_for_revision(
            db,
            require_persisted_id(access.revision.id, entity="score revision"),
            score_id=require_persisted_id(score.id, entity="score"),
        )

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
            source=self.storage.read_bytes(source.storage_key),
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
        stored = self.storage.put_bytes(
            key=self._playback_storage_key(
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                asset_uuid=asset_uuid,
                extension=audio.extension,
            ),
            content=audio.content,
            content_type=audio.mime_type,
        )
        previous = db.execute(
            select(ScorePlaybackAsset).where(
                ScorePlaybackAsset.revision_id == revision_id,
                ScorePlaybackAsset.kind == asset_kind,
            )
        ).scalar_one_or_none()
        old_key = previous.storage_key if previous else None
        score = db.execute(
            select(Score)
            .join(ScoreRevision, ScoreRevision.score_id == Score.id)
            .where(
                ScoreRevision.id == revision_id,
                Score.deletion_status == ScoreDeletionStatus.ACTIVE,
            )
        ).scalar_one()
        previous_usage = self._playback_asset_usage(previous)
        try:
            manifest = get_or_create_execution_manifest(
                db, build_playback_execution_manifest(soundfont_sha256=audio.soundfont_sha256)
            )
            execution_manifest_id = require_persisted_id(manifest.id, entity="execution manifest")
            if previous is not None:
                db.delete(previous)
                db.flush()
            asset = ScorePlaybackAsset(
                asset_uuid=asset_uuid,
                revision_id=revision_id,
                kind=asset_kind,
                storage_backend=self.storage.backend_name,
                storage_key=stored.storage_key,
                filename=stored.filename,
                mime_type=audio.mime_type,
                size_bytes=stored.size_bytes,
                sha256=hashlib.sha256(audio.content).hexdigest(),
                execution_manifest_id=execution_manifest_id,
                duration_ms=audio.duration_ms,
                source_fingerprint=source_fingerprint,
                generator=audio.generator,
                generator_version=audio.generator_version,
            )
            db.add(asset)
            db.commit()
            db.refresh(asset)
        except Exception:
            db.rollback()
            self._delete_storage_key_best_effort(stored.storage_key)
            raise

        storage_usage_service.record_allocation_sync(
            db,
            user_id=score.owner_user_id,
            category=StorageUsageCategory.DERIVED_AUDIO,
            bytes_count=asset.size_bytes,
            reason="playback_asset_created",
            object_type="score_playback_asset",
            object_id=asset.asset_uuid,
            storage_key=asset.storage_key,
        )
        if previous_usage is not None:
            old_asset_uuid, old_storage_key, old_size_bytes = previous_usage
            storage_usage_service.record_release_sync(
                db,
                user_id=score.owner_user_id,
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=old_size_bytes,
                reason="playback_asset_replaced",
                object_type="score_playback_asset",
                object_id=old_asset_uuid,
                storage_key=old_storage_key,
            )
        if old_key and old_key != stored.storage_key:
            self._delete_storage_key_best_effort(old_key)
        return asset

    @staticmethod
    def _playback_storage_key(
        *,
        score_uuid: str,
        revision_uuid: str,
        asset_uuid: str,
        extension: str,
    ) -> str:
        return f"scores/{score_uuid}/revisions/{revision_uuid}/playback/{asset_uuid}{extension}"

    @staticmethod
    def _playback_asset_usage(
        asset: ScorePlaybackAsset | None,
    ) -> tuple[str, str, int] | None:
        if asset is None:
            return None
        return (asset.asset_uuid, asset.storage_key, asset.size_bytes)

    def _delete_storage_key_best_effort(self, storage_key: str) -> None:
        try:
            self.storage.delete(storage_key)
        except Exception:
            pass


playback_service = PlaybackService()
