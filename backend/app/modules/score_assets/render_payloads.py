from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    ImportArtifact,
    ImportJob,
    RenderOutbox,
    RenderTargetType,
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
)
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind


@dataclass(frozen=True)
class RenderOutboxPayload:
    outbox_uuid: str
    target_type: RenderTargetType
    render_profile: str
    source_fingerprint: str
    attempt: int
    max_attempts: int
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None
    score_uuid: str | None = None
    revision_uuid: str | None = None
    user_id: int | None = None
    job_uuid: str | None = None


@dataclass(frozen=True)
class RenderPayloadBuildResult:
    payload: RenderOutboxPayload | None
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
    ) -> RenderOutboxPayload | None:
        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if (
            score is None
            or score.deletion_status != ScoreDeletionStatus.ACTIVE
            or revision is None
            or outbox.requested_by_user_id is None
        ):
            return None

        return RenderOutboxPayload(
            outbox_uuid=outbox.outbox_uuid,
            target_type=outbox.target_type,
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            user_id=outbox.requested_by_user_id,
            render_profile=outbox.render_profile,
            source_fingerprint=outbox.source_fingerprint,
            attempt=0,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
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
        review_source = db.execute(
            select(ImportArtifact).where(
                ImportArtifact.job_id == outbox.import_job_id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
            )
        ).scalar_one_or_none()
        if job is None or review_source is None:
            return RenderPayloadBuildResult(None)
        if job.state != ImportJobState.PENDING_REVIEW:
            return RenderPayloadBuildResult(None, terminal_completed=True)
        if review_source.sha256 != outbox.source_fingerprint:
            return RenderPayloadBuildResult(None, terminal_completed=True)

        return RenderPayloadBuildResult(
            RenderOutboxPayload(
                outbox_uuid=outbox.outbox_uuid,
                target_type=outbox.target_type,
                job_uuid=job.job_uuid,
                render_profile=outbox.render_profile,
                source_fingerprint=outbox.source_fingerprint,
                attempt=0,
                max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
                originating_request_id=outbox.originating_request_id,
                traceparent=outbox.traceparent,
                tracestate=outbox.tracestate,
            )
        )
