from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevision, ScoreRevisionMetadata, ScoreRevisionSource
from app.db.models.score import MetadataStatus, RevisionSourceFormat
from app.modules.metadata.schemas import MetadataRead
from app.modules.realtime.publisher import RealtimeEventTypes, publish_score_event_best_effort
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.processing.musicxml import (
    EXTRACTOR_VERSION,
    MetadataExtractionError,
    MusicXMLMetadata,
    extract_musicxml_metadata,
)
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class MetadataProjectionService:
    def __init__(
        self,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.score_repository = score_repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()

    async def get(
        self, db: AsyncSession, score_uuid: str, revision_uuid: str, user_id: int
    ) -> MetadataRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        projection = await db.get(
            ScoreRevisionMetadata,
            require_persisted_id(revision.id, entity="score revision"),
        )
        if not projection:
            raise ResourceNotFoundException(
                "metadata", revision_uuid, ErrorCode.RESOURCE_NOT_FOUND
            )
        return self.to_read(revision, projection)

    async def rebuild(
        self, db: AsyncSession, score_uuid: str, revision_uuid: str, user_id: int
    ) -> MetadataRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        source = await self.asset_repository.canonical_source(db, revision_id)
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        projection = await db.get(ScoreRevisionMetadata, revision_id)
        if not projection:
            projection = ScoreRevisionMetadata(
                revision_id=revision_id,
                status=MetadataStatus.PENDING,
                extractor_version=EXTRACTOR_VERSION,
            )
            db.add(projection)
        try:
            content = self.storage.read_bytes(source.storage_key)
        except Exception:
            self._mark_failed(projection, "source_read_failed")
        else:
            self._compute_into(projection, content)
        await db.commit()
        await db.refresh(projection)
        result = self.to_read(revision, projection)
        await publish_score_event_best_effort(
            db,
            score_id=score_uuid,
            revision_id=revision_uuid,
            type=RealtimeEventTypes.SCORE_METADATA_UPDATED,
            payload=result.model_dump(mode="json"),
        )
        return result

    @staticmethod
    def _compute_into(projection: ScoreRevisionMetadata, content: bytes) -> None:
        projection.extractor_version = EXTRACTOR_VERSION
        projection.computed_at = utc_now_naive()
        try:
            result = extract_musicxml_metadata(content)
        except MetadataExtractionError as exc:
            projection.status = MetadataStatus.FAILED
            projection.error_code = str(exc)
            projection.measure_count = None
            projection.playback_duration_ms = None
            projection.part_count = None
            projection.primary_key_fifths = None
            projection.primary_mode = None
            projection.key_signature_events = []
            projection.time_signature_events = []
            projection.tempo_events = []
            return
        MetadataProjectionService._apply_result(projection, result)

    @staticmethod
    def _apply_result(
        projection: ScoreRevisionMetadata, result: MusicXMLMetadata
    ) -> None:
        projection.status = MetadataStatus.READY
        projection.error_code = None
        projection.measure_count = result.measure_count
        projection.playback_duration_ms = result.playback_duration_ms
        projection.part_count = result.part_count
        projection.primary_key_fifths = result.primary_key_fifths
        projection.primary_mode = result.primary_mode
        projection.key_signature_events = result.key_signature_events
        projection.time_signature_events = result.time_signature_events
        projection.tempo_events = result.tempo_events
        projection.extractor_version = result.extractor_version

    @staticmethod
    def _mark_failed(projection: ScoreRevisionMetadata, error_code: str) -> None:
        projection.status = MetadataStatus.FAILED
        projection.error_code = error_code
        projection.computed_at = utc_now_naive()
        projection.measure_count = None
        projection.playback_duration_ms = None
        projection.part_count = None
        projection.primary_key_fifths = None
        projection.primary_mode = None
        projection.key_signature_events = []
        projection.time_signature_events = []
        projection.tempo_events = []

    @staticmethod
    def to_read(
        revision: ScoreRevision, projection: ScoreRevisionMetadata
    ) -> MetadataRead:
        return MetadataRead(
            revision_id=revision.revision_uuid,
            status=projection.status,
            measure_count=projection.measure_count,
            playback_duration_ms=projection.playback_duration_ms,
            part_count=projection.part_count,
            primary_key_fifths=projection.primary_key_fifths,
            primary_mode=projection.primary_mode,
            key_signature_events=projection.key_signature_events,
            time_signature_events=projection.time_signature_events,
            tempo_events=projection.tempo_events,
            extractor_version=projection.extractor_version,
            error_code=projection.error_code,
            computed_at=projection.computed_at,
        )


def rebuild_metadata_sync(
    db: Session,
    revision_id: int,
    storage: FileStorage | None = None,
) -> None:
    storage = storage or file_storage
    projection = db.get(ScoreRevisionMetadata, revision_id)
    if not projection:
        projection = ScoreRevisionMetadata(
            revision_id=revision_id,
            status=MetadataStatus.PENDING,
            extractor_version=EXTRACTOR_VERSION,
        )
        db.add(projection)
    source = db.execute(
        select(ScoreRevisionSource).where(
            ScoreRevisionSource.revision_id == revision_id,
            ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
        )
    ).scalar_one_or_none()
    if not source:
        MetadataProjectionService._mark_failed(
            projection, "canonical_source_missing"
        )
    else:
        try:
            content = storage.read_bytes(source.storage_key)
        except Exception:
            MetadataProjectionService._mark_failed(
                projection, "source_read_failed"
            )
        else:
            MetadataProjectionService._compute_into(projection, content)
    db.commit()
