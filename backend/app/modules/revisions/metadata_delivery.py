"""Fenced revision metadata delivery; source reads and computation occur outside locks."""

from dataclasses import dataclass
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.revision_metadata_outbox import RevisionMetadataOutbox
from app.db.models import (
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRevisionMetadata,
    Score,
    StoredObject,
)
from app.db.models.score import RevisionSourceFormat
from app.modules.async_operations.durable_delivery import (
    DurableDeliveryLifecycle,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
    DeliveryAttemptLease,
    StaleDeliveryAttempt,
)
from app.modules.metadata.service import MetadataProjectionService
from app.modules.realtime.publisher import publish_score_event_sync_best_effort, RealtimeEventTypes
from app.processing.musicxml import (
    extract_musicxml_metadata,
    MetadataExtractionError,
    MusicXMLMetadata,
)
from app.utils.timezone import utc_now_naive
from app.core.logger import logger

from app.modules.revisions.metadata_policy import METADATA_BATCH_SIZE


def metadata_lifecycle() -> DurableDeliveryLifecycle[str]:
    return DurableDeliveryLifecycle(
        DeliveryStatuses("PENDING", "DISPATCHED", "PROCESSING", "FAILED", "COMPLETED"),
        DeliveryLifecyclePolicy(5, 60, 300, 300),
    )


@dataclass(frozen=True)
class MetadataPayload:
    outbox_uuid: str
    lease: DeliveryAttemptLease
    revision_id: int
    source_fingerprint: str
    source_key: str
    score_uuid: str
    revision_uuid: str
    originating_request_id: str | None
    traceparent: str | None
    tracestate: str | None


@dataclass(frozen=True)
class MetadataResult:
    metadata: MusicXMLMetadata | None
    error_code: str | None

    def __post_init__(self) -> None:
        if (self.metadata is None) == (self.error_code is None):
            raise ValueError("Metadata computation has exactly one result or semantic error")


def compute_metadata(content: bytes) -> MetadataResult:
    try:
        return MetadataResult(extract_musicxml_metadata(content), None)
    except MetadataExtractionError as exc:
        return MetadataResult(None, str(exc))


class RevisionMetadataDelivery:
    def get(self, db: Session, uuid: str) -> RevisionMetadataOutbox | None:
        return db.scalar(
            select(RevisionMetadataOutbox)
            .where(RevisionMetadataOutbox.outbox_uuid == uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def claim(self, db: Session, uuid: str) -> MetadataPayload | None:
        row = self.get(db, uuid)
        if row is None:
            return None
        lease = metadata_lifecycle().claim(row, token=str(uuid4()), now=utc_now_naive())
        if lease is None:
            return None
        try:
            source = self._source(db, row)
        except ValueError:
            metadata_lifecycle().fail_attempt(
                row, lease=lease, error="canonical_source_unavailable", now=utc_now_naive()
            )
            logger.bind(
                event="revision_metadata.source_unavailable", outbox_id=uuid, attempt=lease.attempt
            ).error("revision_metadata.source_unavailable")
            return None
        return MetadataPayload(
            uuid,
            lease,
            row.revision_id,
            row.source_fingerprint,
            source.object_key,
            source.score_uuid,
            source.revision_uuid,
            row.originating_request_id,
            row.traceparent,
            row.tracestate,
        )

    @staticmethod
    def _source(db: Session, row: RevisionMetadataOutbox):
        source = db.execute(
            select(StoredObject.object_key, Score.score_uuid, ScoreRevision.revision_uuid)
            .select_from(ScoreRevisionSource)
            .join(StoredObject, ScoreRevisionSource.stored_object_id == StoredObject.id)
            .join(ScoreRevision, ScoreRevisionSource.revision_id == ScoreRevision.id)
            .join(Score, ScoreRevision.score_id == Score.id)
            .where(
                ScoreRevision.id == row.revision_id,
                ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
                ScoreRevision.content_hash == row.source_fingerprint,
                StoredObject.sha256 == row.source_fingerprint,
            )
        ).one_or_none()
        if source is None:
            raise ValueError("Metadata requires matching immutable canonical source")
        return source

    def adopt(self, db: Session, payload: MetadataPayload, result: MetadataResult) -> None:
        score = db.scalar(
            select(Score)
            .where(Score.score_uuid == payload.score_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if score is None or score.deleted_at is not None:
            raise StaleDeliveryAttempt("Metadata aggregate is no longer active")
        row = self.get(db, payload.outbox_uuid)
        if row is None or not metadata_lifecycle().attempt_matches(row, payload.lease):
            raise StaleDeliveryAttempt("Metadata execution lease is stale")
        if (
            row.revision_id != payload.revision_id
            or row.source_fingerprint != payload.source_fingerprint
        ):
            raise StaleDeliveryAttempt("Metadata target disagrees with execution")
        self._source(db, row)
        projection = db.get(ScoreRevisionMetadata, row.revision_id, populate_existing=True)
        if projection is None:
            raise ValueError("RevisionWriter must admit metadata before execution")
        if result.metadata is not None:
            MetadataProjectionService._apply_result(projection, result.metadata)
            projection.computed_at = utc_now_naive()
        else:
            MetadataProjectionService._mark_failed(
                projection, result.error_code or "metadata_extraction_failed"
            )
        assert metadata_lifecycle().complete_attempt(row, lease=payload.lease, now=utc_now_naive())
        publish_score_event_sync_best_effort(
            db,
            score_id=payload.score_uuid,
            revision_id=payload.revision_uuid,
            type=RealtimeEventTypes.SCORE_METADATA_UPDATED,
            payload={},
        )
        db.flush()

    def fail(self, db: Session, uuid: str, lease: DeliveryAttemptLease, error: str) -> bool:
        row = self.get(db, uuid)
        return row is not None and metadata_lifecycle().fail_attempt(
            row, lease=lease, error=error, now=utc_now_naive()
        )

    def mark_dispatched(self, db: Session, uuid: str) -> bool:
        row = self.get(db, uuid)
        return row is not None and metadata_lifecycle().dispatch(row, now=utc_now_naive())

    def rearm(self, db: Session, uuid: str) -> None:
        target = db.scalar(
            select(Score)
            .join(ScoreRevision, ScoreRevision.score_id == Score.id)
            .join(RevisionMetadataOutbox, RevisionMetadataOutbox.revision_id == ScoreRevision.id)
            .where(RevisionMetadataOutbox.outbox_uuid == uuid)
            .with_for_update(of=Score)
            .execution_options(populate_existing=True)
        )
        row = self.get(db, uuid)
        if target is None or target.deleted_at is not None or row is None:
            raise ValueError("Metadata rebuild requires an active revision")
        if row.status in ("PROCESSING", "DISPATCHED"):
            raise ValueError("Metadata execution already owns this delivery")
        metadata_lifecycle().rearm(row, now=utc_now_naive())

    def release_dispatch(self, db: Session, uuid: str, error: str) -> None:
        row = self.get(db, uuid)
        if row is not None:
            metadata_lifecycle().release_dispatch(row, error=error, now=utc_now_naive())

    def recover_and_list_due(self, db: Session) -> list[str]:
        now, lifecycle = utc_now_naive(), metadata_lifecycle()
        rows = db.scalars(
            select(RevisionMetadataOutbox)
            .where(RevisionMetadataOutbox.status.in_(["DISPATCHED", "PROCESSING"]))
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        ).all()
        for row in rows:
            lifecycle.recover_lease(row, error="Metadata delivery lease expired", now=now)
        db.flush()
        return list(
            db.scalars(
                select(RevisionMetadataOutbox.outbox_uuid)
                .where(
                    RevisionMetadataOutbox.status.in_(["PENDING", "FAILED"]),
                    RevisionMetadataOutbox.next_attempt_at <= now,
                    RevisionMetadataOutbox.attempt_count < lifecycle.policy.max_attempts,
                )
                .order_by(RevisionMetadataOutbox.id)
                .limit(METADATA_BATCH_SIZE)
            )
        )


metadata_delivery = RevisionMetadataDelivery()
