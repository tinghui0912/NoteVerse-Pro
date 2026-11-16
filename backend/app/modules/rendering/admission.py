"""Caller-owned admission of deduplicated rendering demands."""

import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.async_trace_context import get_async_trace_context
from app.core.request_correlation import get_request_id
from app.db.models import RenderOutbox, RenderOutboxStatus, RenderTargetType
from app.modules.rendering.delivery import rearm_revision_outbox


def admit_revision_render(
    db: Session,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = "default",
) -> RenderOutbox:
    existing = db.execute(
        select(RenderOutbox)
        .where(
            RenderOutbox.revision_id == revision_id, RenderOutbox.render_profile == render_profile
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == RenderOutboxStatus.SUPERSEDED:
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
    render_profile: str = "default",
) -> RenderOutbox:
    traceparent, tracestate = get_async_trace_context()
    return RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )


def admit_review_thumbnail_render(
    db: Session,
    *,
    import_job_id: int,
    source_fingerprint: str,
    render_profile: str = "review-thumbnail",
) -> RenderOutbox:
    existing = db.execute(
        select(RenderOutbox).where(
            RenderOutbox.import_job_id == import_job_id,
            RenderOutbox.render_profile == render_profile,
            RenderOutbox.source_fingerprint == source_fingerprint,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    outbox = _new_review_thumbnail_outbox(
        import_job_id=import_job_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_review_thumbnail_outbox(
    *, import_job_id: int, source_fingerprint: str, render_profile: str
) -> RenderOutbox:
    traceparent, tracestate = get_async_trace_context()
    return RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=import_job_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )
