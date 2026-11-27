"""Immutable execution facts for one Score Revision render attempt."""

from dataclasses import dataclass
from sqlalchemy.orm import Session
from app.db.models import ScoreRevisionRenderOutbox, Score, ScoreRevision
from app.modules.durable_work.delivery import DeliveryAttemptLease


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


@dataclass(frozen=True)
class ScoreRevisionRenderAttempt:
    target: ScoreRevisionRenderTarget
    lease: DeliveryAttemptLease
    max_attempts: int


def revision_render_target(
    db: Session, outbox: ScoreRevisionRenderOutbox
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
