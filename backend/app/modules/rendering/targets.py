from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar
from app.modules.durable_work.delivery import DeliveryAttemptLease

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    ImportArtifact,
    ImportJob,
    RenderOutbox,
    RenderTargetType,
    Score,
    ScoreRevision,
)
from app.db.models.import_job import ImportJobState
from app.db.models.import_job import ImportArtifactKind


@dataclass(frozen=True, kw_only=True)
class ScoreRevisionRenderTarget:
    outbox_uuid: str
    score_uuid: str
    revision_uuid: str
    requested_by_user_id: int
    render_profile: str
    source_fingerprint: str
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None
    target_type: ClassVar[RenderTargetType] = RenderTargetType.SCORE_REVISION


@dataclass(frozen=True, kw_only=True)
class ReviewThumbnailRenderTarget:
    outbox_uuid: str
    job_uuid: str
    render_profile: str
    source_fingerprint: str
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None
    target_type: ClassVar[RenderTargetType] = RenderTargetType.REVIEW_THUMBNAIL


RenderTarget = ScoreRevisionRenderTarget | ReviewThumbnailRenderTarget


@dataclass(frozen=True)
class RenderAttempt:
    target: RenderTarget
    lease: DeliveryAttemptLease
    max_attempts: int


@dataclass(frozen=True)
class RenderPayloadBuildResult:
    payload: RenderTarget | None
    terminal_completed: bool = False


class RenderPayloadBuilder:
    def build(self, db: Session, outbox: RenderOutbox) -> RenderPayloadBuildResult:
        if outbox.target_type == RenderTargetType.SCORE_REVISION:
            return RenderPayloadBuildResult(self._build_revision_payload(db, outbox))
        if outbox.target_type == RenderTargetType.REVIEW_THUMBNAIL:
            return self._build_review_thumbnail_payload(db, outbox)
        return RenderPayloadBuildResult(None)

    @staticmethod
    def _build_revision_payload(
        db: Session,
        outbox: RenderOutbox,
    ) -> ScoreRevisionRenderTarget | None:
        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if (
            score is None
            or score.deleted_at is not None
            or revision is None
            or revision.score_id != score.id
            or outbox.requested_by_user_id is None
        ):
            return None

        return ScoreRevisionRenderTarget(
            outbox_uuid=outbox.outbox_uuid,
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            requested_by_user_id=outbox.requested_by_user_id,
            render_profile=outbox.render_profile,
            source_fingerprint=outbox.source_fingerprint,
            originating_request_id=outbox.originating_request_id,
            traceparent=outbox.traceparent,
            tracestate=outbox.tracestate,
        )

    @staticmethod
    def _build_review_thumbnail_payload(
        db: Session,
        outbox: RenderOutbox,
    ) -> RenderPayloadBuildResult:
        job = db.get(ImportJob, outbox.import_job_id)
        if job is None:
            return RenderPayloadBuildResult(None)
        if job.state != ImportJobState.READY_FOR_REVIEW:
            return RenderPayloadBuildResult(None, terminal_completed=True)
        review_source = db.execute(
            select(ImportArtifact).where(
                ImportArtifact.job_id == outbox.import_job_id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML,
            )
        ).scalar_one_or_none()
        if review_source is None:
            return RenderPayloadBuildResult(None)
        if review_source.stored_object.sha256 != outbox.source_fingerprint:
            return RenderPayloadBuildResult(None, terminal_completed=True)

        return RenderPayloadBuildResult(
            ReviewThumbnailRenderTarget(
                outbox_uuid=outbox.outbox_uuid,
                job_uuid=job.job_uuid,
                render_profile=outbox.render_profile,
                source_fingerprint=outbox.source_fingerprint,
                originating_request_id=outbox.originating_request_id,
                traceparent=outbox.traceparent,
                tracestate=outbox.tracestate,
            )
        )
