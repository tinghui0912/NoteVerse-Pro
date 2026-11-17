"""Trace-context lookup for relays of durable background operations."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportDispatch, MailOutbox, PlaybackOutbox, ScoreRevisionRenderOutbox


@dataclass(frozen=True)
class DurableTraceContext:
    traceparent: str | None
    tracestate: str | None


def import_dispatch_trace_context(db: Session, dispatch_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=ImportDispatch.traceparent,
        tracestate_column=ImportDispatch.tracestate,
        identity_filter=ImportDispatch.dispatch_uuid == dispatch_uuid,
    )


def revision_render_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=ScoreRevisionRenderOutbox.traceparent,
        tracestate_column=ScoreRevisionRenderOutbox.tracestate,
        identity_filter=ScoreRevisionRenderOutbox.outbox_uuid == outbox_uuid,
    )


def playback_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=PlaybackOutbox.traceparent,
        tracestate_column=PlaybackOutbox.tracestate,
        identity_filter=PlaybackOutbox.outbox_uuid == outbox_uuid,
    )


def mail_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=MailOutbox.traceparent,
        tracestate_column=MailOutbox.tracestate,
        identity_filter=MailOutbox.outbox_uuid == outbox_uuid,
    )


def _trace_context_for(
    db: Session,
    *,
    traceparent_column: Any,
    tracestate_column: Any,
    identity_filter: Any,
) -> DurableTraceContext:
    record = db.execute(
        select(traceparent_column, tracestate_column).where(identity_filter)
    ).one_or_none()
    if record is None:
        return DurableTraceContext(traceparent=None, tracestate=None)
    return DurableTraceContext(traceparent=record[0], tracestate=record[1])
