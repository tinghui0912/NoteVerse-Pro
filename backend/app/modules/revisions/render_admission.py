"""Caller-owned admission of deduplicated rendering demands."""

import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.async_trace_context import get_async_trace_context
from app.core.request_correlation import get_request_id
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE
from app.db.models import ScoreRevisionRenderOutbox, ScoreRevisionRenderStatus
from app.modules.revisions.render_delivery import rearm_revision_outbox


def admit_revision_render(
    db: Session,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = SCORE_PRESENTATION_RENDER_PROFILE,
) -> ScoreRevisionRenderOutbox:
    existing = db.execute(
        select(ScoreRevisionRenderOutbox)
        .where(
            ScoreRevisionRenderOutbox.revision_id == revision_id,
            ScoreRevisionRenderOutbox.render_profile == render_profile,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == ScoreRevisionRenderStatus.SUPERSEDED:
            rearm_revision_outbox(existing)
        return existing
    outbox = _new_revision_render_outbox(
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_revision_render_outbox(
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = SCORE_PRESENTATION_RENDER_PROFILE,
) -> ScoreRevisionRenderOutbox:
    traceparent, tracestate = get_async_trace_context()
    return ScoreRevisionRenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=ScoreRevisionRenderStatus.PENDING,
    )
