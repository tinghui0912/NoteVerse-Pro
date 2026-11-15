from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevision, ScoreRevisionMetadata
from app.db.models.score import MetadataStatus
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.scores.repository import ScoreRepository
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.processing.musicxml import (
    MusicXMLMetadata,
)
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage
from app.shared.time import utc_now


class MetadataProjectionService:
    def __init__(
        self,
        score_repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.score_repository = score_repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or object_storage
        self.access_policy = access_policy or ScoreAccessPolicy()

    def get(self, db: Session, score_uuid: str, revision_uuid: str, user_id: int) -> MetadataRead:
        access = self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        projection = db.get(
            ScoreRevisionMetadata,
            require_persisted_id(revision.id, entity="score revision"),
        )
        if not projection:
            raise ResourceNotFoundException("metadata", revision_uuid, ErrorCode.RESOURCE_NOT_FOUND)
        return self.to_read(revision, projection)

    @staticmethod
    def _apply_result(projection: ScoreRevisionMetadata, result: MusicXMLMetadata) -> None:
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
        projection.computed_at = utc_now()
        projection.measure_count = None
        projection.playback_duration_ms = None
        projection.part_count = None
        projection.primary_key_fifths = None
        projection.primary_mode = None
        projection.key_signature_events = []
        projection.time_signature_events = []
        projection.tempo_events = []

    @staticmethod
    def to_read(revision: ScoreRevision, projection: ScoreRevisionMetadata) -> MetadataRead:
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
            computed_at=projection.computed_at,
        )
